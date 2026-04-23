import http from "node:http";

const FIGMA_MCP_HOST = "127.0.0.1";
const FIGMA_MCP_PORT = Number(process.env.FIGMA_MCP_PORT) || 3845;
const FIGMA_MCP_PATH = "/mcp";
const TIMEOUT_MS = 10_000;
// Set FIGMA_MCP_MOCK_RESPONSE to a JSON-encoded fetchDesignContext return value to skip the live
// Figma Desktop HTTP call during tests. Set FIGMA_MCP_MOCK_ERROR to a raw error string to force
// the error path without needing a running Figma Desktop instance.
const MOCK_RESPONSE_ENV = "FIGMA_MCP_MOCK_RESPONSE";
const MOCK_ERROR_ENV = "FIGMA_MCP_MOCK_ERROR";

function postMcp(sessionId, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Content-Length": Buffer.byteLength(json, "utf8"),
    };
    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
    }

    const req = http.request(
      {
        hostname: FIGMA_MCP_HOST,
        port: FIGMA_MCP_PORT,
        path: FIGMA_MCP_PATH,
        method: "POST",
        headers,
      },
      (res) => {
        const responseSessionId = res.headers["mcp-session-id"] ?? null;
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf8"), sessionId: responseSessionId });
        });
        res.on("error", reject);
      }
    );

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error("Figma MCP request timed out"));
    });
    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        reject(new Error("Figma Desktop app is not running or Dev Mode MCP is disabled. Open Figma Desktop and enable Dev Mode MCP server."));
      } else {
        reject(err);
      }
    });
    req.write(json);
    req.end();
  });
}

// Figma Desktop MCP can respond with either text/event-stream (SSE) or plain JSON depending on
// the client's Accept header and the server version. Parse SSE "data:" lines first; if none are
// found fall back to treating the entire body as a single JSON message.
function parseSseBody(body) {
  const messages = [];
  for (const block of body.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          messages.push(JSON.parse(line.slice(6)));
        } catch {
          // skip malformed lines
        }
      }
    }
  }
  if (messages.length === 0) {
    try {
      const parsed = JSON.parse(body.trim());
      if (parsed) messages.push(parsed);
    } catch {
      // not JSON either
    }
  }
  return messages;
}

function extractResultText(result) {
  return (result.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text);
}

function resolveMsg(messages, id) {
  return messages.find((m) => m.id === id) ?? messages[messages.length - 1];
}

export async function fetchDesignContext(nodeId) {
  maybeThrowMockError(nodeId);

  const mockResponse = readMockResponse();
  if (mockResponse) {
    return mockResponse;
  }

  // Step 1: initialize and get session ID
  const initRes = await postMcp(null, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "figma-to-markdown-mcp", version: "0.2.0" },
    },
  });

  const sessionId = initRes.sessionId;

  // MCP spec requires clients to send notifications/initialized after initialize, but the server
  // does not reply. Fire-and-forget; errors are intentionally ignored.
  postMcp(sessionId, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  }).catch(() => {});

  // Step 2: call get_design_context and get_metadata in parallel
  const [contextResResult, metadataResResult] = await Promise.allSettled([
    postMcp(sessionId, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_design_context",
        arguments: { nodeId },
      },
    }),
    postMcp(sessionId, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_metadata",
        arguments: { nodeId },
      },
    }),
  ]);

  if (contextResResult.status !== "fulfilled") {
    throw contextResResult.reason;
  }

  const contextResult = parseToolResult(contextResResult.value.body, 2);
  const contentBlocks = extractResultText(contextResult)
    .map((text) => text.trim())
    .filter((text) => text.length > 0);

  if (contentBlocks.length === 0) {
    throw new Error("Figma MCP returned no usable design context.");
  }

  const metadataBlocks = [];
  const supplementTools = [];

  if (metadataResResult.status === "fulfilled") {
    try {
      const metadataResult = parseToolResult(metadataResResult.value.body, 3);
      const texts = extractResultText(metadataResult)
        .map((text) => text.trim())
        .filter((text) => text.length > 0);

      if (texts.length > 0) {
        metadataBlocks.push(...texts);
        supplementTools.push("get_metadata");
      }
    } catch {
      // metadata is supplemental; continue without it
    }
  }

  return { contentBlocks, metadataBlocks, supplementTools };
}

function parseToolResult(body, id) {
  const messages = parseSseBody(body);
  if (messages.length === 0) {
    throw new Error("Figma MCP returned an empty response.");
  }

  const msg = resolveMsg(messages, id);

  if (msg.error) {
    throw new Error(`Figma MCP error: ${msg.error.message}`);
  }

  const result = msg.result;
  if (!result) {
    throw new Error("Figma MCP response has no result.");
  }

  if (result.isError) {
    const text = result.content?.find((content) => content.type === "text")?.text ?? "Unknown error";
    throw new Error(normalizeUpstreamToolErrorMessage(text));
  }

  return result;
}

function maybeThrowMockError(nodeId) {
  const raw = process.env[MOCK_ERROR_ENV];
  if (!raw) {
    return;
  }

  throw new Error(normalizeUpstreamToolErrorMessage(raw, nodeId));
}

function normalizeUpstreamToolErrorMessage(text, nodeId = null) {
  const raw = String(text ?? "").trim();

  if (/No node could be found for the provided nodeId/iu.test(raw)) {
    const resolvedNodeId = extractNodeIdFromErrorText(raw) ?? nodeId;
    return [
      `Figma MCP could not resolve node \`${resolvedNodeId ?? "unknown"}\`.`,
      "Make sure Figma Desktop is open, Dev Mode MCP is enabled, and the document containing this node is the active tab.",
    ].join(" ");
  }

  return `Figma MCP tool error: ${raw || "Unknown error"}`;
}

function extractNodeIdFromErrorText(text) {
  const match = text.match(/nodeId:\s*([0-9:.-]+)/iu);
  return match?.[1]?.replace(/-/gu, ":")?.replace(/[.]+$/u, "") ?? null;
}

function readMockResponse() {
  const raw = process.env[MOCK_RESPONSE_ENV];
  if (!raw) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${MOCK_RESPONSE_ENV}: ${error.message}`);
  }

  const contentBlocks = normalizeMockBlocks(parsed.contentBlocks);
  if (contentBlocks.length === 0) {
    throw new Error(`${MOCK_RESPONSE_ENV} must include at least one content block.`);
  }

  return {
    contentBlocks,
    metadataBlocks: normalizeMockBlocks(parsed.metadataBlocks),
    supplementTools: Array.isArray(parsed.supplementTools)
      ? parsed.supplementTools.filter((tool) => typeof tool === "string" && tool.trim() !== "")
      : [],
  };
}

function normalizeMockBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks
    .filter((block) => typeof block === "string")
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}
