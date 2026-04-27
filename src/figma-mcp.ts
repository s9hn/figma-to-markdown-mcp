import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  compactDesignContext,
  compactMetadataOutline,
  formatReductionLabel,
  inferCodeFence,
} from "./mcp-compactor.js";

const DEFAULT_FIGMA_MCP_URL = "http://127.0.0.1:3845/mcp";
const INTERNAL_CLIENT_INFO = {
  name: "figma-to-markdown-internal-client",
  version: "1.1.1",
};

interface ParsedFigmaUrl {
  figmaUrl: string;
  fileKey?: string;
  nodeId?: string;
}

interface ToolDefinition {
  name: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
  };
}

interface CallToolResultLike {
  content?: unknown[];
  isError?: boolean;
}

interface ListToolsResultLike {
  tools: ToolDefinition[];
  nextCursor?: string;
}

interface FigmaMcpClientLike {
  listTools: (params?: { cursor?: string }) => Promise<ListToolsResultLike>;
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  close: () => Promise<void>;
}

interface ConnectedClient {
  client: FigmaMcpClientLike;
  transport: unknown;
}

interface FigmaMarkdownRuntime {
  connectFigmaClient: (figmaMcpUrl: string) => Promise<ConnectedClient>;
  compactDesignContext: typeof compactDesignContext;
  compactMetadataOutline: typeof compactMetadataOutline;
}

export interface SuggestedUpstreamToolCall {
  name: string;
  arguments: Record<string, unknown>;
  note?: string;
}

export interface UpstreamFallback {
  required: true;
  reason: string;
  nodeIdVariants: string[];
  suggestedTools: SuggestedUpstreamToolCall[];
}

function hasTerminateSession(
  value: unknown
): value is { terminateSession: () => Promise<void> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "terminateSession" in value &&
    typeof (value as { terminateSession?: unknown }).terminateSession === "function"
  );
}

export interface GetFigmaMarkdownOptions {
  figmaUrl: string;
  includeMetadata?: boolean;
  maxOutputChars?: number;
  figmaMcpUrl?: string;
  runtime?: Partial<FigmaMarkdownRuntime>;
}

export interface GetFigmaMarkdownResult {
  markdown: string;
  rawChars: number;
  outputChars: number;
  source: {
    figmaUrl: string;
    fileKey?: string;
    nodeId?: string;
    figmaMcpUrl: string;
  };
  fallback?: UpstreamFallback;
}

function parseFigmaUrl(figmaUrl: string): ParsedFigmaUrl {
  const sanitized = figmaUrl.trim().replace(/^@+/, "").replace(/^<|>$/g, "");
  let url: URL;
  try {
    url = new URL(sanitized);
  } catch {
    throw new Error("Invalid Figma URL");
  }

  const nodeId = url.searchParams.get("node-id") ?? url.searchParams.get("nodeId") ?? undefined;
  const segments = url.pathname.split("/").filter(Boolean);

  let fileKey: string | undefined;
  const branchIndex = segments.indexOf("branch");
  if (branchIndex >= 0 && segments[branchIndex + 1]) {
    fileKey = segments[branchIndex + 1];
  }

  if (!fileKey) {
    for (const marker of ["design", "file", "proto", "board"]) {
      const markerIndex = segments.indexOf(marker);
      if (markerIndex >= 0 && segments[markerIndex + 1]) {
        fileKey = segments[markerIndex + 1];
        break;
      }
    }
  }

  return { figmaUrl: sanitized, fileKey, nodeId };
}

async function closeClientQuietly(connection: ConnectedClient | undefined): Promise<void> {
  if (!connection) return;

  const { client, transport } = connection;
  if (hasTerminateSession(transport)) {
    await transport.terminateSession().catch(() => undefined);
  }

  await client.close().catch(() => undefined);
}

async function connectFigmaClient(figmaMcpUrl: string): Promise<ConnectedClient> {
  const url = new URL(figmaMcpUrl);

  const streamableClient = new Client(INTERNAL_CLIENT_INFO);
  const streamableTransport = new StreamableHTTPClientTransport(url);

  try {
    await streamableClient.connect(streamableTransport);
    return { client: streamableClient, transport: streamableTransport };
  } catch (streamableError) {
    await streamableClient.close().catch(() => undefined);

    const sseClient = new Client(INTERNAL_CLIENT_INFO);
    const sseTransport = new SSEClientTransport(url);

    try {
      await sseClient.connect(sseTransport);
      return { client: sseClient, transport: sseTransport };
    } catch (sseError) {
      await sseClient.close().catch(() => undefined);
      const streamableMessage =
        streamableError instanceof Error ? streamableError.message : String(streamableError);
      const sseMessage = sseError instanceof Error ? sseError.message : String(sseError);
      throw new Error(
        `Unable to connect to Figma MCP at ${figmaMcpUrl}. Streamable HTTP failed: ${streamableMessage}. SSE fallback failed: ${sseMessage}.`
      );
    }
  }
}

async function listAllTools(client: FigmaMcpClientLike): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);

  return tools;
}

function createRuntime(
  overrides: Partial<FigmaMarkdownRuntime> | undefined
): FigmaMarkdownRuntime {
  return {
    connectFigmaClient,
    compactDesignContext,
    compactMetadataOutline,
    ...overrides,
  };
}

function buildNodeIdVariants(nodeId: string): string[] {
  const variants = [nodeId];
  if (nodeId.includes("-")) {
    variants.push(nodeId.replace(/-/g, ":"));
  } else if (nodeId.includes(":")) {
    variants.push(nodeId.replace(/:/g, "-"));
  }

  return variants.filter((value, index) => variants.indexOf(value) === index);
}

function getToolProperties(tool: ToolDefinition | undefined): Set<string> {
  const properties = tool?.inputSchema?.properties;
  return new Set(properties ? Object.keys(properties) : []);
}

function buildToolArgs(tool: ToolDefinition | undefined, parsed: ParsedFigmaUrl): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const properties = getToolProperties(tool);

  const setIfSupported = (key: string, value: unknown) => {
    if (properties.has(key) && value !== undefined) {
      args[key] = value;
    }
  };

  setIfSupported("fileKey", parsed.fileKey);
  setIfSupported("nodeId", parsed.nodeId);
  setIfSupported("figma_url", parsed.figmaUrl);
  setIfSupported("figmaUrl", parsed.figmaUrl);
  setIfSupported("url", parsed.figmaUrl);
  setIfSupported("nodeUrl", parsed.figmaUrl);
  setIfSupported("clientFrameworks", "unknown");
  setIfSupported("clientLanguages", "unknown");

  if (!Object.keys(args).length) {
    if (parsed.fileKey) args.fileKey = parsed.fileKey;
    if (parsed.nodeId) args.nodeId = parsed.nodeId;
  }

  return args;
}

function expandNodeIdArgs(args: Record<string, unknown>): Array<Record<string, unknown>> {
  const nodeId = typeof args.nodeId === "string" ? args.nodeId : undefined;
  if (!nodeId) return [args];

  return buildNodeIdVariants(nodeId).map((value) => ({ ...args, nodeId: value }));
}

async function callToolWithFallback(
  client: FigmaMcpClientLike,
  tool: ToolDefinition | undefined,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResultLike> {
  if (!tool) {
    throw new Error(`Required Figma MCP tool "${name}" is not available.`);
  }

  let lastError: unknown;
  for (const candidateArgs of expandNodeIdArgs(args)) {
    try {
      const result = (await client.callTool({
        name,
        arguments: candidateArgs,
      })) as CallToolResultLike;
      if (result.isError) {
        const errorText = extractToolText(result) || "Unknown tool error";
        throw new Error(errorText);
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Figma MCP tool "${name}" failed: ${message}`);
}

function stringifyContentItem(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;

  const record = item as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;

  if (record.resource && typeof record.resource === "object") {
    const resource = record.resource as Record<string, unknown>;
    if (typeof resource.text === "string") return resource.text;
  }

  return null;
}

function extractToolText(result: CallToolResultLike): string {
  const textBlocks =
    result.content
      ?.map((item) => stringifyContentItem(item))
      .filter((value): value is string => Boolean(value)) ?? [];

  return textBlocks.join("\n\n");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildSuggestedUpstreamToolCalls(parsed: ParsedFigmaUrl): SuggestedUpstreamToolCall[] {
  const primaryNodeId = parsed.nodeId;
  if (!primaryNodeId) {
    return [];
  }

  return [
    {
      name: "get_design_context",
      arguments: { nodeId: primaryNodeId },
      note: "Call this first on the standard Figma MCP.",
    },
    {
      name: "get_metadata",
      arguments: { nodeId: primaryNodeId },
      note: "Optional supplement for node outline and frame metadata.",
    },
  ];
}

function buildUpstreamFallbackMarkdown(
  parsed: ParsedFigmaUrl,
  figmaMcpUrl: string,
  reason: string,
  fallback: UpstreamFallback
): string {
  const lines: string[] = [];
  lines.push("# Figma Bridge Fallback");
  lines.push(`- source: ${parsed.figmaUrl}`);
  if (parsed.fileKey) lines.push(`- file_key: ${parsed.fileKey}`);
  if (parsed.nodeId) lines.push(`- node_id: ${parsed.nodeId}`);
  lines.push(`- attempted_via: ${figmaMcpUrl}`);
  lines.push(`- reason: ${reason}`);
  lines.push("- action: call the standard Figma MCP directly for this node.");
  lines.push("");
  lines.push("## Next Step");
  lines.push(
    "The bridge did not safely produce compacted Markdown, so this response is handing off to the normal Figma MCP flow instead of returning raw upstream payload from inside the bridge."
  );
  lines.push("");
  lines.push("## Suggested Upstream Calls");
  for (const toolCall of fallback.suggestedTools) {
    lines.push(`### ${toolCall.name}`);
    if (toolCall.note) {
      lines.push(toolCall.note);
    }
    lines.push("```json");
    lines.push(JSON.stringify(toolCall.arguments, null, 2));
    lines.push("```");
    lines.push("");
  }
  lines.push("## Retry Note");
  lines.push(
    `- If the direct Figma MCP cannot resolve the node, retry nodeId using one of: ${fallback.nodeIdVariants.join(", ")}`
  );
  lines.push("- This fallback keeps raw upstream payload out of this bridge response.");
  return lines.join("\n").trimEnd();
}

function buildUpstreamFallbackResult(
  parsed: ParsedFigmaUrl,
  figmaMcpUrl: string,
  reason: string
): GetFigmaMarkdownResult {
  const nodeIdVariants = parsed.nodeId ? buildNodeIdVariants(parsed.nodeId) : [];
  const fallback: UpstreamFallback = {
    required: true,
    reason,
    nodeIdVariants,
    suggestedTools: buildSuggestedUpstreamToolCalls(parsed),
  };
  const markdown = buildUpstreamFallbackMarkdown(parsed, figmaMcpUrl, reason, fallback);
  return {
    markdown,
    rawChars: 0,
    outputChars: markdown.length,
    source: {
      figmaUrl: parsed.figmaUrl,
      fileKey: parsed.fileKey,
      nodeId: parsed.nodeId,
      figmaMcpUrl,
    },
    fallback,
  };
}

function buildMarkdown(
  parsed: ParsedFigmaUrl,
  figmaMcpUrl: string,
  metadataOutline: string,
  metadataTruncated: boolean,
  designContext: string,
  designContextTruncated: boolean,
  rawChars: number,
  notes: string[]
): string {
  const lines: string[] = [];
  lines.push("# Figma Context");
  lines.push(`- source: ${parsed.figmaUrl}`);
  if (parsed.fileKey) lines.push(`- file_key: ${parsed.fileKey}`);
  if (parsed.nodeId) lines.push(`- node_id: ${parsed.nodeId}`);
  lines.push(`- fetched_via: ${figmaMcpUrl}`);
  lines.push(
    "- upstream_note: raw Figma MCP payload stayed inside this server; only the compacted Markdown below is returned."
  );

  if (metadataOutline) {
    lines.push("");
    lines.push("## Node Outline");
    lines.push(metadataOutline);
  }

  if (designContext) {
    lines.push("");
    lines.push("## Design Context");
    lines.push(`\`\`\`${inferCodeFence(designContext)}`);
    lines.push(designContext);
    lines.push("```");
  }

  if (metadataTruncated) {
    notes.push("Metadata outline was truncated to keep the response compact.");
  }
  if (designContextTruncated) {
    notes.push("Design context was truncated to the configured output budget.");
  }

  if (notes.length) {
    lines.push("");
    lines.push("## Notes");
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
  }

  const markdown = lines.join("\n");
  return `${markdown}\n\n---\n> ${formatReductionLabel(rawChars, markdown.length)}`;
}

export async function getFigmaLinkAsMarkdown(
  options: GetFigmaMarkdownOptions
): Promise<GetFigmaMarkdownResult> {
  const parsed = parseFigmaUrl(options.figmaUrl);
  const figmaMcpUrl = options.figmaMcpUrl ?? process.env.FIGMA_MCP_URL ?? DEFAULT_FIGMA_MCP_URL;
  const runtime = createRuntime(options.runtime);

  if (!parsed.nodeId) {
    throw new Error("Figma URL must include a node-id query parameter.");
  }

  let connection: ConnectedClient | undefined;
  try {
    connection = await runtime.connectFigmaClient(figmaMcpUrl);
    const tools = await listAllTools(connection.client);
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const notes: string[] = [];

    const designTool = toolsByName.get("get_design_context");
    const metadataTool = toolsByName.get("get_metadata");

    const baseArgs = buildToolArgs(designTool, parsed);
    const designResult = await callToolWithFallback(
      connection.client,
      designTool,
      "get_design_context",
      baseArgs
    );
    const designRaw = extractToolText(designResult);
    if (!designRaw.trim()) {
      return buildUpstreamFallbackResult(
        parsed,
        figmaMcpUrl,
        "Upstream Figma MCP returned no usable text design context for compaction."
      );
    }

    let metadataRaw = "";
    if (options.includeMetadata !== false) {
      if (!metadataTool) {
        notes.push("Upstream Figma MCP did not expose `get_metadata`, so the node outline was omitted.");
      } else {
        try {
          const metadataArgs = buildToolArgs(metadataTool, parsed);
          const metadataResult = await callToolWithFallback(
            connection.client,
            metadataTool,
            "get_metadata",
            metadataArgs
          );
          metadataRaw = extractToolText(metadataResult);
          if (!metadataRaw.trim()) {
            notes.push("Upstream `get_metadata` returned no usable text, so the node outline was omitted.");
          }
        } catch (error) {
          notes.push(`Upstream \`get_metadata\` failed and was omitted: ${describeError(error)}`);
        }
      }
    }

    let compactedMetadata = { text: "", truncated: false };
    if (metadataRaw.trim()) {
      try {
        compactedMetadata = runtime.compactMetadataOutline(metadataRaw);
      } catch (error) {
        notes.push(`Metadata compaction failed and was omitted: ${describeError(error)}`);
      }
    }

    let compactedDesign;
    try {
      compactedDesign = runtime.compactDesignContext(
        designRaw,
        options.maxOutputChars
      );
    } catch (error) {
      return buildUpstreamFallbackResult(
        parsed,
        figmaMcpUrl,
        `Compaction failed inside the bridge: ${describeError(error)}`
      );
    }

    if (!compactedDesign.text.trim()) {
      return buildUpstreamFallbackResult(
        parsed,
        figmaMcpUrl,
        "Compaction produced no usable design context."
      );
    }

    const rawChars = metadataRaw.length + designRaw.length;
    const markdown = buildMarkdown(
      parsed,
      figmaMcpUrl,
      compactedMetadata.text,
      compactedMetadata.truncated,
      compactedDesign.text,
      compactedDesign.truncated,
      rawChars,
      notes
    );

    return {
      markdown,
      rawChars,
      outputChars: markdown.length,
      source: {
        figmaUrl: parsed.figmaUrl,
        fileKey: parsed.fileKey,
        nodeId: parsed.nodeId,
        figmaMcpUrl,
      },
    };
  } catch (error) {
    return buildUpstreamFallbackResult(
      parsed,
      figmaMcpUrl,
      `${describeError(error)} If you're using the desktop Figma MCP, make sure Figma Desktop is open and the local MCP server is enabled at ${figmaMcpUrl}.`
    );
  } finally {
    await closeClientQuietly(connection);
  }
}
