import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { serializeDesignContextToCompactContext } from "./compact-context.js";

const DEFAULT_FIGMA_MCP_URL = "http://127.0.0.1:3845/mcp";
const INTERNAL_CLIENT_INFO = {
  name: "figma-compaction-internal-client",
  version: "3.0.0",
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

interface FigmaCompactionRuntime {
  connectFigmaClient: (figmaMcpUrl: string) => Promise<ConnectedClient>;
}

export interface SuggestedUpstreamToolCall {
  name: string;
  arguments: Record<string, unknown>;
  note?: string;
}

export type BridgeStatus = "ok" | "partial_node" | "truncated";

export interface ParentCandidate {
  nodeId?: string;
  name?: string;
  type: string;
  width?: number;
  height?: number;
}

export interface NodeDiagnostics {
  nodeId: string | null;
  name: string | null;
  type: string | null;
  width: number | null;
  height: number | null;
  x: number | null;
  y: number | null;
  directChildCount: number | null;
  descendantCount: number | null;
  textNodeCount: number | null;
  topLevelChildTypes: string[];
  firstTextNames: string[];
  looksPartial: boolean;
  reasons: string[];
  parentCandidates: ParentCandidate[];
  parentCandidatesUnavailableReason?: string;
}

interface MetadataNode {
  type: string;
  id: string | null;
  name: string | null;
  width: number | null;
  height: number | null;
  x: number | null;
  y: number | null;
  children: MetadataNode[];
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

export interface GetFigmaCompactContextOptions {
  figmaUrl: string;
  includeMetadata?: boolean;
  maxOutputChars?: number;
  figmaMcpUrl?: string;
  runtime?: Partial<FigmaCompactionRuntime>;
  mode?: CompactMode;
  task?: CompactTask;
  includeAssets?: boolean;
  includeTextSpecs?: boolean;
  includeTraceIds?: boolean;
}

export type CompactMode = "minimal" | "balanced" | "debug";
export type CompactTask = "implement" | "inspect" | "summarize";

export interface CompactContextFallback {
  reason: string;
  recommendedTool: "get_design_context";
  suggestedCalls: SuggestedUpstreamToolCall[];
}

export interface GetFigmaCompactContextResult {
  status: "ok" | "fallback";
  format: "compact-context";
  version: "1";
  mode: CompactMode;
  task: CompactTask;
  summary: string;
  content: string;
  stats: {
    rawChars: number;
    compactChars: number;
    reductionPct?: number;
  };
  trace?: {
    figmaUrl: string;
    fileKey?: string;
    nodeId: string;
    upstreamTools: string[];
  };
  warnings: string[];
  nodeDiagnostics?: NodeDiagnostics;
  fallback?: CompactContextFallback;
}

interface PreparedBridgeContext {
  parsed: ParsedFigmaUrl;
  figmaMcpUrl: string;
  rawChars: number;
  contentBlocks: string[];
  filteredMetadataBlocks: string[];
  notes: string[];
  nodeDiagnostics?: NodeDiagnostics;
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
  overrides: Partial<FigmaCompactionRuntime> | undefined
): FigmaCompactionRuntime {
  return {
    connectFigmaClient,
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
      const errorText = extractToolText(result) || "Unknown tool error";
      if (result.isError || isMissingNodeMessage(errorText)) {
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

function extractToolTextBlocks(result: CallToolResultLike): string[] {
  return (
    result.content
      ?.map((item) => stringifyContentItem(item))
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim())
      .filter((value) => value.length > 0) ?? []
  );
}

function extractToolText(result: CallToolResultLike): string {
  return extractToolTextBlocks(result).join("\n\n");
}

function isMissingNodeMessage(text: string): boolean {
  return /^No node could be found for the provided nodeId:/u.test(text.trim());
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

function filterMetadataBlocks(blocks: string[]): string[] {
  return blocks.filter(
    (block) =>
      !block.startsWith(
        "IMPORTANT: After you call this tool, you MUST call get_design_context"
      )
  );
}

function extractQuotedAttribute(attrs: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = attrs.match(new RegExp(`${escapedName}\\s*=\\s*"([^"]*)"`, "u"));
  return match?.[1] ?? null;
}

function parseNumericAttribute(attrs: string, name: string): number | null {
  const value = extractQuotedAttribute(attrs, name);
  if (value === null) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function createMetadataNode(type: string, attrs: string): MetadataNode {
  return {
    type,
    id: extractQuotedAttribute(attrs, "id"),
    name: extractQuotedAttribute(attrs, "name"),
    width: parseNumericAttribute(attrs, "width"),
    height: parseNumericAttribute(attrs, "height"),
    x: parseNumericAttribute(attrs, "x"),
    y: parseNumericAttribute(attrs, "y"),
    children: [],
  };
}

function parseMetadataTree(block: string): MetadataNode | null {
  const roots: MetadataNode[] = [];
  const stack: MetadataNode[] = [];
  const pattern = /<\/?([a-z_]+)\b([^>]*)>/giu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(block)) !== null) {
    const rawTag = match[0];
    const type = match[1].toLowerCase();
    const attrs = match[2] ?? "";

    if (rawTag.startsWith("</")) {
      while (stack.length > 0) {
        const current = stack.pop();
        if (current?.type === type) {
          break;
        }
      }
      continue;
    }

    const node = createMetadataNode(type, attrs);
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }

    if (!rawTag.endsWith("/>")) {
      stack.push(node);
    }
  }

  return roots[0] ?? null;
}

function countMetadataNodes(root: MetadataNode): number {
  return 1 + root.children.reduce((sum, child) => sum + countMetadataNodes(child), 0);
}

function countTextNodes(root: MetadataNode): number {
  const self = root.type === "text" ? 1 : 0;
  return self + root.children.reduce((sum, child) => sum + countTextNodes(child), 0);
}

function collectTextNames(root: MetadataNode): string[] {
  const names: string[] = [];

  const visit = (node: MetadataNode) => {
    if (node.type === "text" && node.name) {
      names.push(node.name);
    }
    for (const child of node.children) {
      visit(child);
    }
  };

  visit(root);
  return [...new Set(names)];
}

function analyzeNodeDiagnostics(metadataBlocks: string[]): NodeDiagnostics | undefined {
  for (const block of metadataBlocks) {
    const root = parseMetadataTree(block);
    if (!root) {
      continue;
    }

    const directChildCount = root.children.length;
    const descendantCount = Math.max(0, countMetadataNodes(root) - 1);
    const textNodeCount = countTextNodes(root);
    const topLevelChildTypes = [...new Set(root.children.map((child) => child.type))];
    const firstTextNames = collectTextNames(root).slice(0, 3);
    const reasons: string[] = [];

    const singleTextChild =
      directChildCount === 1 &&
      root.children[0]?.type === "text" &&
      descendantCount === 1;
    const smallTextBand =
      root.width !== null &&
      root.height !== null &&
      root.width >= 240 &&
      root.width <= 480 &&
      root.height <= 120;

    let looksPartial = false;

    if (root.type === "text") {
      looksPartial = true;
      reasons.push("Selected node is a text layer rather than a container root.");
    }

    if (smallTextBand) {
      looksPartial = true;
      reasons.push(`Selected frame is compact (${root.width} x ${root.height}) and may be a localized sub-block.`);
    }

    if (singleTextChild && smallTextBand) {
      looksPartial = true;
      reasons.push("Selected subtree contains one direct text child and no additional structure.");
    }

    if (looksPartial && textNodeCount > 0) {
      reasons.push(`Visible text nodes in subtree: ${textNodeCount}.`);
    }

    return {
      nodeId: root.id,
      name: root.name,
      type: root.type,
      width: root.width,
      height: root.height,
      x: root.x,
      y: root.y,
      directChildCount,
      descendantCount,
      textNodeCount,
      topLevelChildTypes,
      firstTextNames,
      looksPartial,
      reasons: [...new Set(reasons)],
      parentCandidates: [],
      parentCandidatesUnavailableReason: looksPartial
        ? "Upstream `get_metadata` only exposed the selected subtree, so ancestor frame candidates were not available."
        : undefined,
    };
  }

  return undefined;
}

function findMetadataPath(root: MetadataNode, targetNodeId: string): MetadataNode[] | null {
  if (root.id === targetNodeId) {
    return [root];
  }

  for (const child of root.children) {
    const path = findMetadataPath(child, targetNodeId);
    if (path) {
      return [root, ...path];
    }
  }

  return null;
}

function toParentCandidate(node: MetadataNode): ParentCandidate | null {
  if (!["frame", "instance", "symbol", "component", "component-set", "section"].includes(node.type)) {
    return null;
  }

  return {
    nodeId: node.id ?? undefined,
    name: node.name ?? undefined,
    type: node.type,
    width: node.width ?? undefined,
    height: node.height ?? undefined,
  };
}

function buildParentCandidatesFromPath(path: MetadataNode[]): ParentCandidate[] {
  const target = path[path.length - 1];
  const ancestors = path.slice(0, -1).reverse();
  const candidates: ParentCandidate[] = [];

  for (const node of ancestors) {
    const candidate = toParentCandidate(node);
    if (!candidate) {
      continue;
    }

    if (candidate.nodeId && candidate.nodeId === target.id) {
      continue;
    }

    candidates.push(candidate);
    if (candidates.length >= 5) {
      break;
    }
  }

  return candidates;
}

function isProbeContainerType(type: string): boolean {
  return ["frame", "instance", "symbol", "component", "component-set", "section", "canvas"].includes(type);
}

function shouldProbeContainerCandidate(
  node: MetadataNode,
  targetNodeId: string,
  diagnostics: NodeDiagnostics
): boolean {
  if (!node.id || node.id === targetNodeId || !isProbeContainerType(node.type)) {
    return false;
  }

  if (diagnostics.width !== null && node.width !== null && node.width < diagnostics.width) {
    return false;
  }

  if (diagnostics.height !== null && node.height !== null && node.height < diagnostics.height) {
    return false;
  }

  return true;
}

function collectProbeCandidateIds(
  root: MetadataNode,
  targetNodeId: string,
  diagnostics: NodeDiagnostics,
  limit: number
): string[] {
  const queue = [...root.children];
  const candidates: string[] = [];
  const seen = new Set<string>();

  while (queue.length > 0 && candidates.length < limit) {
    const node = queue.shift();
    if (!node) {
      continue;
    }

    if (shouldProbeContainerCandidate(node, targetNodeId, diagnostics)) {
      seen.add(node.id as string);
      candidates.push(node.id as string);
    }

    if (node.type === "canvas" || node.type === "section") {
      for (const child of node.children) {
        if (child.id && !seen.has(child.id)) {
          queue.push(child);
        }
      }
    }
  }

  return candidates;
}

async function probeCandidateContainersForPath(
  client: FigmaMcpClientLike,
  metadataTool: ToolDefinition,
  parsed: ParsedFigmaUrl,
  diagnostics: NodeDiagnostics,
  targetNodeId: string,
  initialCandidateIds: string[]
): Promise<{ parentCandidates: ParentCandidate[] | null; probedCount: number }> {
  const queue = initialCandidateIds.map((nodeId) => ({ nodeId, depth: 1 }));
  const seen = new Set(initialCandidateIds);
  let probedCount = 0;
  const maxProbes = 8;
  const maxDepth = 2;
  const maxChildCandidatesPerProbe = 6;

  while (queue.length > 0 && probedCount < maxProbes) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    probedCount += 1;

    try {
      const candidateArgs = buildToolArgs(metadataTool, { ...parsed, nodeId: current.nodeId });
      const result = await callToolWithFallback(
        client,
        metadataTool,
        "get_metadata",
        candidateArgs
      );
      const blocks = extractToolTextBlocks(result);

      for (const block of blocks) {
        const root = parseMetadataTree(block);
        if (!root) {
          continue;
        }

        const path = findMetadataPath(root, targetNodeId);
        if (path && path.length >= 2) {
          const parentCandidates = buildParentCandidatesFromPath(path);
          if (parentCandidates.length > 0) {
            return { parentCandidates, probedCount };
          }
        }

        if (current.depth >= maxDepth) {
          continue;
        }

        for (const candidateId of collectProbeCandidateIds(
          root,
          targetNodeId,
          diagnostics,
          maxChildCandidatesPerProbe
        )) {
          if (seen.has(candidateId)) {
            continue;
          }

          seen.add(candidateId);
          queue.push({ nodeId: candidateId, depth: current.depth + 1 });
        }
      }
    } catch {
      continue;
    }
  }

  return { parentCandidates: null, probedCount };
}

async function enrichParentCandidates(
  client: FigmaMcpClientLike,
  metadataTool: ToolDefinition | undefined,
  parsed: ParsedFigmaUrl,
  diagnostics: NodeDiagnostics
): Promise<NodeDiagnostics> {
  if (!metadataTool || !parsed.nodeId || diagnostics.parentCandidates.length > 0) {
    return diagnostics;
  }

  const targetNodeId = parsed.nodeId.replace(/-/g, ":");
  const hitCanvasIds: string[] = [];
  let probedContainerCount = 0;

  for (let index = 1; index <= 10; index += 1) {
    const canvasNodeId = `0:${index}`;

    try {
      const canvasArgs = buildToolArgs(metadataTool, { ...parsed, nodeId: canvasNodeId });
      const result = await callToolWithFallback(
        client,
        metadataTool,
        "get_metadata",
        canvasArgs
      );
      const blocks = extractToolTextBlocks(result);

      if (blocks.length === 0 || blocks.every((block) => isMissingNodeMessage(block))) {
        continue;
      }

      hitCanvasIds.push(canvasNodeId);

      for (const block of blocks) {
        const root = parseMetadataTree(block);
        if (!root) {
          continue;
        }

        const path = findMetadataPath(root, targetNodeId);
        if (!path || path.length < 2) {
          continue;
        }

        const parentCandidates = buildParentCandidatesFromPath(path);
        if (parentCandidates.length === 0) {
          continue;
        }

        return {
          ...diagnostics,
          parentCandidates,
          parentCandidatesUnavailableReason: undefined,
        };
      }

      const initialCandidateIds = blocks
        .map((block) => parseMetadataTree(block))
        .filter((root): root is MetadataNode => Boolean(root))
        .flatMap((root) => collectProbeCandidateIds(root, targetNodeId, diagnostics, 6));

      if (initialCandidateIds.length === 0) {
        continue;
      }

      const probed = await probeCandidateContainersForPath(
        client,
        metadataTool,
        parsed,
        diagnostics,
        targetNodeId,
        initialCandidateIds
      );
      probedContainerCount += probed.probedCount;

      if (probed.parentCandidates && probed.parentCandidates.length > 0) {
        return {
          ...diagnostics,
          parentCandidates: probed.parentCandidates,
          parentCandidatesUnavailableReason: undefined,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    ...diagnostics,
    parentCandidatesUnavailableReason:
      hitCanvasIds.length > 0
        ? probedContainerCount > 0
          ? `Canvas metadata was available and ${probedContainerCount} related container candidate${probedContainerCount === 1 ? " was" : "s were"} probed, but no ancestor path to the selected node could be reconstructed.`
          : "Canvas metadata was available, but no ancestor path to the selected node could be reconstructed."
        : "Canvas-level metadata was not available, so ancestor frame candidates could not be reconstructed.",
  };
}

function buildResultSummary(
  status: BridgeStatus,
  diagnostics: NodeDiagnostics | undefined,
  truncated: boolean
): string {
  const parts: string[] = [];
  if (diagnostics?.name) {
    parts.push(diagnostics.name);
  }
  if (diagnostics?.type) {
    parts.push(diagnostics.type);
  }
  if (diagnostics && diagnostics.width !== null && diagnostics.height !== null) {
    parts.push(`${diagnostics.width} x ${diagnostics.height}`);
  }
  if (diagnostics && diagnostics.directChildCount !== null) {
    parts.push(`${diagnostics.directChildCount} direct child${diagnostics.directChildCount === 1 ? "" : "ren"}`);
  }
  if (diagnostics && diagnostics.textNodeCount !== null) {
    parts.push(`${diagnostics.textNodeCount} text node${diagnostics.textNodeCount === 1 ? "" : "s"}`);
  }
  if (status === "partial_node") {
    parts.push("looks partial");
  }
  if (truncated) {
    parts.push("truncated");
  }

  return parts.length > 0 ? parts.join(" / ") : "Compact context ready.";
}

function calculateReductionPct(rawChars: number, compactChars: number): number | undefined {
  if (rawChars <= 0) {
    return undefined;
  }

  return Number((((rawChars - compactChars) / rawChars) * 100).toFixed(2));
}

function truncateCompactDocument(
  content: string,
  maxChars: number | undefined
): { text: string; truncated: boolean; omittedChars: number; reason?: string } {
  if (maxChars === undefined || content.length <= maxChars) {
    return { text: content, truncated: false, omittedChars: 0 };
  }

  const truncationLine = "\nwa|truncated|Output was truncated to the configured output budget.";
  const budget = Math.max(0, maxChars - truncationLine.length);
  const candidate = content.slice(0, budget);
  const lineBoundary = candidate.lastIndexOf("\n");
  const cutoff = lineBoundary >= Math.floor(budget * 0.75) ? lineBoundary : candidate.length;
  const text = `${candidate.slice(0, cutoff).trimEnd()}${truncationLine}`;

  return {
    text,
    truncated: true,
    omittedChars: Math.max(0, content.length - text.length),
    reason: "Output was truncated to the configured `max_output_chars` budget.",
  };
}

function buildCompactFallbackResult(
  parsed: ParsedFigmaUrl,
  figmaMcpUrl: string,
  reason: string,
  mode: CompactMode,
  task: CompactTask
): GetFigmaCompactContextResult {
  const suggestedCalls = buildSuggestedUpstreamToolCalls(parsed);
  const fallback: CompactContextFallback = {
    reason,
    recommendedTool: "get_design_context",
    suggestedCalls,
  };
  const content = [
    `src|figma|get_design_context|${parsed.nodeId ?? "-"}|${parsed.fileKey ?? "-"}`,
    `wa|fallback|${reason}`,
  ].join("\n");

  return {
    status: "fallback",
    format: "compact-context",
    version: "1",
    mode,
    task,
    summary: `Fallback required: ${reason}`,
    content,
    stats: {
      rawChars: 0,
      compactChars: content.length,
    },
    trace: parsed.nodeId ? {
      figmaUrl: parsed.figmaUrl,
      fileKey: parsed.fileKey,
      nodeId: parsed.nodeId,
      upstreamTools: ["get_design_context", "get_metadata"],
    } : undefined,
    warnings: ["fallback"],
    fallback,
  };
}

async function prepareBridgeContext(
  parsed: ParsedFigmaUrl,
  options: GetFigmaCompactContextOptions
): Promise<PreparedBridgeContext> {
  if (!parsed.nodeId) {
    throw new Error("Figma URL must include a node-id query parameter.");
  }

  const figmaMcpUrl = options.figmaMcpUrl ?? process.env.FIGMA_MCP_URL ?? DEFAULT_FIGMA_MCP_URL;
  const runtime = createRuntime(options.runtime);
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
    const contentBlocks = extractToolTextBlocks(designResult);
    if (contentBlocks.length === 0) {
      throw new Error("Upstream Figma MCP returned no usable text design context for compaction.");
    }

    let metadataBlocks: string[] = [];
    if (options.includeMetadata !== false) {
      if (!metadataTool) {
        notes.push("Upstream Figma MCP did not expose `get_metadata`, so metadata-derived node summary was omitted.");
      } else {
        try {
          const metadataArgs = buildToolArgs(metadataTool, parsed);
          const metadataResult = await callToolWithFallback(
            connection.client,
            metadataTool,
            "get_metadata",
            metadataArgs
          );
          metadataBlocks = extractToolTextBlocks(metadataResult);
          if (metadataBlocks.length === 0) {
            notes.push("Upstream `get_metadata` returned no usable text, so metadata-derived node summary was omitted.");
          }
        } catch (error) {
          notes.push(`Upstream \`get_metadata\` failed and was omitted: ${describeError(error)}`);
        }
      }
    }

    const designRaw = contentBlocks.join("\n\n");
    const metadataRaw = metadataBlocks.join("\n\n");
    const rawChars = metadataRaw.length + designRaw.length;
    const filteredMetadataBlocks = filterMetadataBlocks(metadataBlocks);
    let nodeDiagnostics = analyzeNodeDiagnostics(filteredMetadataBlocks);

    if (nodeDiagnostics?.looksPartial) {
      nodeDiagnostics = await enrichParentCandidates(
        connection.client,
        metadataTool,
        parsed,
        nodeDiagnostics
      );
    }

    if (nodeDiagnostics?.looksPartial) {
      notes.push(`Selected node may be a partial implementation root: ${nodeDiagnostics.reasons.join(" ")}`);
      if (nodeDiagnostics.parentCandidates.length > 0) {
        notes.push(
          `Parent frame candidates: ${nodeDiagnostics.parentCandidates
            .map((candidate) => {
              const size =
                candidate.width !== undefined && candidate.height !== undefined
                  ? ` (${candidate.width} x ${candidate.height})`
                  : "";
              return `${candidate.name ?? candidate.type}${candidate.nodeId ? ` [${candidate.nodeId}]` : ""}${size}`;
            })
            .join(", ")}`
        );
      }
      if (nodeDiagnostics.parentCandidatesUnavailableReason) {
        notes.push(nodeDiagnostics.parentCandidatesUnavailableReason);
      }
    }

    return {
      parsed,
      figmaMcpUrl,
      rawChars,
      contentBlocks,
      filteredMetadataBlocks,
      notes,
      nodeDiagnostics,
    };
  } finally {
    await closeClientQuietly(connection);
  }
}

export async function getFigmaCompactContext(
  options: GetFigmaCompactContextOptions
): Promise<GetFigmaCompactContextResult> {
  const parsed = parseFigmaUrl(options.figmaUrl);
  const figmaMcpUrl = options.figmaMcpUrl ?? process.env.FIGMA_MCP_URL ?? DEFAULT_FIGMA_MCP_URL;
  const mode = options.mode ?? "balanced";
  const task = options.task ?? "implement";

  try {
    const prepared = await prepareBridgeContext(parsed, options);
    const serializerWarnings = mode === "debug"
      ? prepared.notes
      : prepared.nodeDiagnostics?.looksPartial
        ? ["Selected node may be a partial implementation root."]
        : [];
    let compactBase: string;
    try {
      compactBase = serializeDesignContextToCompactContext({
        fileKey: prepared.parsed.fileKey ?? "",
        nodeId: prepared.parsed.nodeId ?? "",
        contentBlocks: prepared.contentBlocks,
        metadataBlocks: prepared.filteredMetadataBlocks,
        mode,
        task,
        includeAssets: options.includeAssets,
        includeTextSpecs: options.includeTextSpecs,
        includeTraceIds: options.includeTraceIds,
        warningLines: serializerWarnings,
      });
    } catch (error) {
      return buildCompactFallbackResult(
        parsed,
        figmaMcpUrl,
        `Compaction failed inside the bridge: ${describeError(error)}`,
        mode,
        task
      );
    }

    if (!compactBase.trim()) {
      return buildCompactFallbackResult(
        parsed,
        figmaMcpUrl,
        "Compaction produced no usable design context.",
        mode,
        task
      );
    }

    const truncatedCompact = truncateCompactDocument(compactBase, options.maxOutputChars);
    const warnings = [
      ...(prepared.nodeDiagnostics?.looksPartial ? ["partial_node"] : []),
      ...(truncatedCompact.truncated ? ["truncated"] : []),
    ];
    const compactStatus: BridgeStatus = prepared.nodeDiagnostics?.looksPartial
      ? "partial_node"
      : truncatedCompact.truncated
        ? "truncated"
        : "ok";

    return {
      status: "ok",
      format: "compact-context",
      version: "1",
      mode,
      task,
      summary: buildResultSummary(compactStatus, prepared.nodeDiagnostics, truncatedCompact.truncated),
      content: truncatedCompact.text,
      stats: {
        rawChars: prepared.rawChars,
        compactChars: truncatedCompact.text.length,
        reductionPct: calculateReductionPct(prepared.rawChars, truncatedCompact.text.length),
      },
      trace: parsed.nodeId ? {
        figmaUrl: parsed.figmaUrl,
        fileKey: parsed.fileKey,
        nodeId: parsed.nodeId,
        upstreamTools: prepared.filteredMetadataBlocks.length > 0
          ? ["get_design_context", "get_metadata"]
          : ["get_design_context"],
      } : undefined,
      warnings,
      nodeDiagnostics: prepared.nodeDiagnostics,
    };
  } catch (error) {
    return buildCompactFallbackResult(
      parsed,
      figmaMcpUrl,
      `${describeError(error)} If you're using the desktop Figma MCP, make sure Figma Desktop is open and the local MCP server is enabled at ${figmaMcpUrl}.`,
      mode,
      task
    );
  }
}
