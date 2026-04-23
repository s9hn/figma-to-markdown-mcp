#!/usr/bin/env node

import process from "node:process";
import { serializeDesignContextToMarkdown } from "./design-context-markdown.js";
import { fetchDesignContext } from "./figma-mcp-client.js";
import { parseFigmaUrl } from "./url.js";

const SERVER_INFO = {
  name: "figma-to-markdown",
  version: "1.0.0",
};

const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
];

const tools = [
  {
    name: "get_design_context_compact",
    description:
      "Call this first for a Figma node URL. It fetches upstream Figma get_design_context internally, removes raw React/Tailwind passthrough, and returns compact markdown with layout, text, asset, and implementation notes.",
    inputSchema: {
      type: "object",
      properties: {
        figma_url: {
          type: "string",
          description:
            "Full Figma design URL including node-id query parameter, e.g. https://www.figma.com/design/FILE_KEY/Name?node-id=123-456",
        },
        include_stats: {
          type: "boolean",
          description: "Append markdown size statistics to the output",
          default: false,
        },
      },
      required: ["figma_url"],
      additionalProperties: false,
    },
  },
];

let buffer = Buffer.alloc(0);
let transportStyle = "unknown";

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainMessages();
});

process.stdin.on("end", () => {
  process.exit(0);
});

function drainMessages() {
  while (true) {
    const rawMessage = readNextMessage();
    if (rawMessage === null) {
      return;
    }
    if (rawMessage.length === 0) {
      continue;
    }

    let request;
    try {
      request = JSON.parse(rawMessage);
    } catch (error) {
      writeError(null, -32700, `Invalid JSON payload: ${error.message}`);
      continue;
    }

    handleMessage(request);
  }
}

function readNextMessage() {
  if (usesContentLengthTransport()) {
    return readContentLengthMessage();
  }

  return readJsonLineMessage();
}

// Auto-detect transport on first message. MCP clients using Content-Length framing (LSP-style,
// e.g. Claude Desktop) start with "Content-Length: N\r\n\r\n{...}". Clients using JSON-line
// framing (e.g. Claude Code CLI) send one JSON object per newline-terminated line.
function usesContentLengthTransport() {
  if (transportStyle === "content-length") {
    return true;
  }

  if (transportStyle === "json-line") {
    return false;
  }

  const preview = buffer.slice(0, 32).toString("utf8");
  return /^Content-Length:/iu.test(preview);
}

function readContentLengthMessage() {
  const separatorIndex = buffer.indexOf("\r\n\r\n");
  if (separatorIndex === -1) {
    return null;
  }

  const headerBlock = buffer.slice(0, separatorIndex).toString("utf8");
  const headers = parseHeaders(headerBlock);
  const contentLength = Number.parseInt(headers["content-length"] ?? "", 10);

  if (!Number.isFinite(contentLength) || contentLength < 0) {
    writeError(null, -32700, "Invalid or missing Content-Length header.");
    buffer = Buffer.alloc(0);
    return null;
  }

  const messageStart = separatorIndex + 4;
  const messageEnd = messageStart + contentLength;
  if (buffer.length < messageEnd) {
    return null;
  }

  transportStyle = "content-length";
  const rawMessage = buffer.slice(messageStart, messageEnd).toString("utf8");
  buffer = buffer.slice(messageEnd);
  return rawMessage;
}

function readJsonLineMessage() {
  const newlineIndex = buffer.indexOf("\n");
  if (newlineIndex === -1) {
    return null;
  }

  const rawLine = buffer.slice(0, newlineIndex).toString("utf8");
  buffer = buffer.slice(newlineIndex + 1);
  transportStyle = "json-line";
  return rawLine.replace(/\r$/u, "").trim();
}

function parseHeaders(headerBlock) {
  const headers = {};

  for (const line of headerBlock.split("\r\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    headers[name] = value;
  }

  return headers;
}

async function handleMessage(message) {
  const { id, method, params } = message;

  try {
    switch (method) {
      case "initialize":
        writeResult(id, {
          protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
          capabilities: {
            tools: {},
          },
          serverInfo: SERVER_INFO,
        });
        return;

      case "notifications/initialized":
        return;

      case "ping":
        writeResult(id, {});
        return;

      case "tools/list":
        writeResult(id, { tools });
        return;

      case "tools/call":
        writeResult(id, await handleToolCall(params?.name, params?.arguments ?? {}));
        return;

      default:
        writeError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    writeError(id, -32603, error.message);
  }
}

// Echo the client's requested version if supported; fall back to the most widely deployed version
// rather than rejecting, to avoid breaking clients that send a version we haven't listed yet.
function negotiateProtocolVersion(requestedVersion) {
  if (SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)) {
    return requestedVersion;
  }

  return "2025-03-26";
}

async function handleToolCall(name, args) {
  switch (name) {
    case "get_design_context_compact":
      return callGetDesignContextCompact(args);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function callGetDesignContextCompact(args) {
  if (typeof args.figma_url !== "string") {
    return toolError("`figma_url` must be a string.");
  }

  if (args.include_stats !== undefined && typeof args.include_stats !== "boolean") {
    return toolError("`include_stats` must be a boolean when provided.");
  }

  let fileKey;
  let nodeId;
  try {
    ({ fileKey, nodeId } = parseFigmaUrl(args.figma_url));
  } catch (error) {
    return toolError(error.message);
  }

  // Hard failure: upstream Figma MCP is unreachable or returned a tool-level error.
  // There is no data to fall back to, so propagate the error directly.
  let designContext;
  try {
    designContext = await fetchDesignContext(nodeId);
  } catch (error) {
    return toolError(error.message);
  }

  const { contentBlocks, metadataBlocks, supplementTools } = designContext;

  // Soft failure: upstream data was fetched successfully but compact serialization failed.
  // Return the raw upstream blocks so the agent can still complete the implementation task,
  // and include the error message so the agent knows compaction was skipped.
  try {
    // Allow tests to force a compaction error without modifying production logic.
    if (process.env.FIGMA_MCP_MOCK_COMPACT_ERROR) {
      throw new Error(process.env.FIGMA_MCP_MOCK_COMPACT_ERROR);
    }

    const markdown = serializeDesignContextToMarkdown({
      fileKey,
      nodeId,
      contentBlocks,
      metadataBlocks,
      supplementTools,
    });

    let text = markdown;
    if (args.include_stats === true) {
      text += [
        "",
        "## Stats",
        `- chars: ${markdown.length}`,
        `- approx tokens: ${Math.ceil(markdown.length / 4)}`,
      ].join("\n");
    }

    return { content: [{ type: "text", text }] };
  } catch (compactionError) {
    const text = buildRawFallback({ compactionError, fileKey, nodeId, contentBlocks, metadataBlocks });
    return { content: [{ type: "text", text }] };
  }
}

function buildRawFallback({ compactionError, fileKey, nodeId, contentBlocks, metadataBlocks }) {
  const header = [
    `> Compact markdown generation failed: ${compactionError.message}`,
    `> Returning raw upstream Figma MCP output as fallback.`,
    `> node-id: \`${nodeId}\` | file-key: \`${fileKey}\``,
  ].join("\n");

  const blocks = [...metadataBlocks, ...contentBlocks].join("\n\n---\n\n");
  return `${header}\n\n${blocks}`;
}

function toolError(text) {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

function writeResult(id, result) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function writeError(id, code, message) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
}

function writeMessage(message) {
  const json = JSON.stringify(message);
  if (transportStyle === "json-line") {
    process.stdout.write(`${json}\n`);
    return;
  }

  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}
