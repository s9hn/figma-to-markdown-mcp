import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getFigmaCompactContext } from "../dist/figma-mcp.js";
import { analyzeDesignContext } from "../dist/design-context-analyzer.js";

const DEFAULT_FIGMA_MCP_URL = "http://127.0.0.1:3845/mcp";
const INTERNAL_CLIENT_INFO = {
  name: "figma-compact-loss-audit",
  version: "0.0.0",
};

const CHROME_LABELS = new Set([
  "status bar",
  "header bar",
  "navigation background",
  "navigation item",
]);

async function main() {
  const figmaUrl = process.argv[2];
  const figmaMcpUrl = process.argv[3] ?? DEFAULT_FIGMA_MCP_URL;

  if (!figmaUrl) {
    console.error("Usage: node scripts/audit-compact-loss.mjs <figma-url> [figma-mcp-url]");
    process.exitCode = 1;
    return;
  }

  const upstream = await fetchUpstream(figmaUrl, figmaMcpUrl);
  const analysis = analyzeDesignContext({
    contentBlocks: upstream.designBlocks,
    metadataBlocks: upstream.metadataBlocks,
  });

  if (!analysis.rootNode) {
    throw new Error("Raw upstream design context could not be parsed into a root node.");
  }

  const compact = await getFigmaCompactContext({
    figmaUrl,
    figmaMcpUrl,
    mode: "balanced",
    task: "implement",
  });

  if (compact.status !== "ok") {
    throw new Error(`Compact audit requires a non-fallback result. Received: ${compact.summary}`);
  }

  const rawTextEntries = collectRawTextEntries(analysis.rootNode);
  const rawAssets = collectRawAssets(analysis.rootNode);
  const rawElements = collectRawStyledElements(analysis.rootNode);
  const rawStylePropTotal = rawElements.reduce((sum, entry) => sum + entry.props.length, 0);

  const compactDoc = parseCompactDocument(compact.content);
  const compactChromeElementIds = compactDoc.elements
    .filter((entry) => isChromeLabel(entry.label))
    .map((entry) => entry.id);

  const textAudit = auditTexts(rawTextEntries, compactDoc.texts, compactDoc.typography);
  const assetAudit = auditAssets(rawAssets, compactDoc.assets);
  const elementAudit = auditElements(rawElements, compactDoc.elementsById);
  const traceCoverage = auditTraceCoverage(compactDoc);
  const suspiciousTypography = auditTypographyAnomalies(compactDoc.typography);

  const semanticPreserved = textAudit.matchedRawCount + assetAudit.matchedCount;
  const semanticTotal = rawTextEntries.length + rawAssets.length;
  const typographyPreserved = textAudit.typographyFieldMatches;
  const typographyTotal = textAudit.typographyFieldTotal;
  const structurePreserved = elementAudit.matchedElementCount;
  const structureTotal = rawElements.length;
  const stylePreserved = elementAudit.matchedPropCount;
  const styleTotal = rawStylePropTotal;

  const overallPreserved =
    semanticPreserved +
    typographyPreserved +
    structurePreserved +
    stylePreserved;
  const overallTotal =
    semanticTotal +
    typographyTotal +
    structureTotal +
    styleTotal;

  const report = {
    figmaUrl,
    figmaMcpUrl,
    compactStatus: compact.status,
    reduction: {
      rawChars: compact.stats.rawChars,
      compactChars: compact.stats.compactChars,
      reductionPct: compact.stats.reductionPct ?? null,
    },
    raw: {
      textCount: rawTextEntries.length,
      assetCount: rawAssets.length,
      styledElementCount: rawElements.length,
      stylePropCount: rawStylePropTotal,
    },
    compacted: {
      elementCount: compactDoc.elements.length,
      textCount: compactDoc.texts.length,
      assetCount: compactDoc.assets.length,
      warningCount: compactDoc.warnings.length,
      warnings: compactDoc.warnings,
      traceCoveragePct: pct(traceCoverage.tracedCount, traceCoverage.totalCount),
      chromeLeakCount: compactChromeElementIds.length,
      chromeLeakIds: compactChromeElementIds,
      suspiciousTypography,
    },
    loss: {
      semanticLossPct: lossPct(semanticPreserved, semanticTotal),
      typographyLossPct: lossPct(typographyPreserved, typographyTotal),
      structureLossPct: lossPct(structurePreserved, structureTotal),
      stylePropLossPct: lossPct(stylePreserved, styleTotal),
      overallAtomicLossPct: lossPct(overallPreserved, overallTotal),
    },
    textAudit,
    assetAudit,
    elementAudit,
  };

  console.log(JSON.stringify(report, null, 2));
}

function parseFigmaUrl(figmaUrl) {
  const sanitized = figmaUrl.trim().replace(/^@+/, "").replace(/^<|>$/g, "");
  const url = new URL(sanitized);
  const nodeId = url.searchParams.get("node-id") ?? url.searchParams.get("nodeId") ?? undefined;
  const segments = url.pathname.split("/").filter(Boolean);

  let fileKey;
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

async function fetchUpstream(figmaUrl, figmaMcpUrl) {
  const parsed = parseFigmaUrl(figmaUrl);
  const connection = await connectFigmaClient(figmaMcpUrl);

  try {
    const tools = await listAllTools(connection.client);
    const designTool = tools.find((tool) => tool.name === "get_design_context");
    const metadataTool = tools.find((tool) => tool.name === "get_metadata");
    const designArgs = buildToolArgs(designTool, parsed);
    const designResult = await callToolWithFallback(connection.client, designTool, "get_design_context", designArgs);
    const designBlocks = extractToolTextBlocks(designResult);
    const metadataBlocks = [];

    if (metadataTool) {
      try {
        const metadataArgs = buildToolArgs(metadataTool, parsed);
        const metadataResult = await callToolWithFallback(connection.client, metadataTool, "get_metadata", metadataArgs);
        metadataBlocks.push(...filterMetadataBlocks(extractToolTextBlocks(metadataResult)));
      } catch {
        // Keep the audit running on design context even if metadata is unavailable.
      }
    }

    return { designBlocks, metadataBlocks };
  } finally {
    await closeClientQuietly(connection);
  }
}

async function connectFigmaClient(figmaMcpUrl) {
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
      const streamableMessage = streamableError instanceof Error ? streamableError.message : String(streamableError);
      const sseMessage = sseError instanceof Error ? sseError.message : String(sseError);
      throw new Error(
        `Unable to connect to Figma MCP at ${figmaMcpUrl}. Streamable HTTP failed: ${streamableMessage}. SSE fallback failed: ${sseMessage}.`
      );
    }
  }
}

async function closeClientQuietly(connection) {
  if (!connection) {
    return;
  }

  const { client, transport } = connection;
  if (typeof transport?.terminateSession === "function") {
    await transport.terminateSession().catch(() => undefined);
  }
  await client.close().catch(() => undefined);
}

async function listAllTools(client) {
  const tools = [];
  let cursor;

  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);

  return tools;
}

function getToolProperties(tool) {
  const properties = tool?.inputSchema?.properties;
  return new Set(properties ? Object.keys(properties) : []);
}

function buildToolArgs(tool, parsed) {
  const args = {};
  const properties = getToolProperties(tool);

  const setIfSupported = (key, value) => {
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

function buildNodeIdVariants(nodeId) {
  const variants = [nodeId];
  if (nodeId.includes("-")) {
    variants.push(nodeId.replace(/-/g, ":"));
  } else if (nodeId.includes(":")) {
    variants.push(nodeId.replace(/:/g, "-"));
  }
  return variants.filter((value, index) => variants.indexOf(value) === index);
}

function expandNodeIdArgs(args) {
  const nodeId = typeof args.nodeId === "string" ? args.nodeId : undefined;
  if (!nodeId) {
    return [args];
  }
  return buildNodeIdVariants(nodeId).map((value) => ({ ...args, nodeId: value }));
}

async function callToolWithFallback(client, tool, name, args) {
  if (!tool) {
    throw new Error(`Required Figma MCP tool "${name}" is not available.`);
  }

  let lastError;
  for (const candidateArgs of expandNodeIdArgs(args)) {
    try {
      const result = await client.callTool({
        name,
        arguments: candidateArgs,
      });
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

function stringifyContentItem(item) {
  if (!item || typeof item !== "object") return null;

  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (item.resource && typeof item.resource === "object" && typeof item.resource.text === "string") {
    return item.resource.text;
  }

  return null;
}

function extractToolTextBlocks(result) {
  return (
    result.content
      ?.map((item) => stringifyContentItem(item))
      .filter((value) => Boolean(value))
      .map((value) => value.trim())
      .filter((value) => value.length > 0) ?? []
  );
}

function extractToolText(result) {
  return extractToolTextBlocks(result).join("\n\n");
}

function isMissingNodeMessage(text) {
  return /^No node could be found for the provided nodeId:/u.test(String(text).trim());
}

function filterMetadataBlocks(blocks) {
  return blocks.filter(
    (block) =>
      !block.startsWith("IMPORTANT: After you call this tool, you MUST call get_design_context")
  );
}

function collectRawTextEntries(rootNode) {
  const entries = [];
  walkWithAncestors(rootNode, [], (node, ancestors) => {
    if (!Array.isArray(node.texts) || node.texts.length === 0) {
      return;
    }

    if (ancestors.some((ancestor, index) => index < ancestors.length - 1 && isChromeNode(ancestor))) {
      return;
    }

    const typography = parseTypographyFromClassNames(ancestors.map((item) => item.className));
    const nodeId = [...ancestors].reverse().find((item) => typeof item.dataNodeId === "string")?.dataNodeId ?? null;
    entries.push({
      key: `${nodeId ?? "-"}|${collapseWhitespace(node.texts.join(" "))}`,
      nodeId,
      text: collapseWhitespace(node.texts.join(" ")),
      typography,
    });
  });

  return dedupeBy(entries, (entry) => entry.key);
}

function collectRawAssets(rootNode) {
  const entries = [];
  walk(rootNode, (node) => {
    if (isChromeNode(node) || !node.assetUrl || !node.srcRef) {
      return;
    }

    entries.push({
      key: `${node.srcRef}|${compressAssetUrl(node.assetUrl)}`,
      srcRef: node.srcRef,
      assetUrl: compressAssetUrl(node.assetUrl),
      nodeId: node.dataNodeId ?? null,
    });
  });

  return dedupeBy(entries, (entry) => entry.key);
}

function collectRawStyledElements(rootNode) {
  const entries = [];
  const nodes = flattenNodes(rootNode);

  for (const [index, node] of nodes.entries()) {
    const isRoot = index === 0;
    if (!isRoot && isChromeNode(node)) {
      continue;
    }

    if (!isRoot && (node.tag === "img" || node.tag === "p")) {
      continue;
    }

    const id = node.dataNodeId ?? null;
    if (!id) {
      continue;
    }

    const props = buildElementProps(node, isRoot);
    if (props.length === 0 && !isRoot) {
      continue;
    }

    entries.push({
      id,
      label: buildNodeLabel(node, isRoot),
      props,
    });
  }

  return dedupeBy(entries, (entry) => entry.id);
}

function parseCompactDocument(content) {
  const elements = [];
  const texts = [];
  const typography = new Map();
  const assets = [];
  const warnings = [];

  for (const rawLine of String(content).split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const parts = line.split("|");
    const kind = parts[0];

    if (kind === "el" && parts.length >= 4) {
      const props = parts[3] ? parts[3].split(";").filter(Boolean) : [];
      elements.push({ id: parts[1], label: parts[2], props });
      continue;
    }

    if (kind === "tx" && parts.length >= 4) {
      texts.push({ id: parts[1], text: parts[2], token: parts[3] });
      continue;
    }

    if (kind === "ty" && parts.length >= 7) {
      typography.set(parts[1], {
        fontFamily: parts[2],
        fontWeight: Number(parts[3]),
        fontSize: Number(parts[4]),
        lineHeight: Number(parts[5]),
        color: parts[6],
      });
      continue;
    }

    if (kind === "as" && parts.length >= 6) {
      assets.push({
        srcRef: parts[1],
        nodeId: parts[3],
        label: parts[4],
        assetUrl: parts[5],
      });
      continue;
    }

    if (kind === "wa" && parts.length >= 3) {
      warnings.push(parts.slice(1).join("|"));
    }
  }

  return {
    elements,
    elementsById: new Map(elements.map((entry) => [entry.id, entry])),
    texts,
    typography,
    assets,
    warnings,
  };
}

function auditTexts(rawEntries, compactTexts, compactTypography) {
  const exactBuckets = new Map();
  const textBuckets = new Map();
  const extraTexts = [];
  const matchedCompactIndexes = new Set();
  const missing = [];

  for (const [index, entry] of compactTexts.entries()) {
    const exactKey = `${entry.id}|${entry.text}`;
    pushBucket(exactBuckets, exactKey, { ...entry, index });
    pushBucket(textBuckets, entry.text, { ...entry, index });
  }

  let matchedRawCount = 0;
  let typographyFieldMatches = 0;
  const typographyFieldTotal = rawEntries.length * 5;
  const mismatchedTypography = [];

  for (const rawEntry of rawEntries) {
    const exactKey = `${rawEntry.nodeId ?? "-"}|${rawEntry.text}`;
    const exactMatch = shiftUnmatched(exactBuckets.get(exactKey), matchedCompactIndexes);
    const fallbackMatch = exactMatch ?? shiftUnmatched(textBuckets.get(rawEntry.text), matchedCompactIndexes);

    if (!fallbackMatch) {
      missing.push({
        nodeId: rawEntry.nodeId,
        text: rawEntry.text,
      });
      continue;
    }

    matchedRawCount += 1;
    matchedCompactIndexes.add(fallbackMatch.index);

    const compactTy = compactTypography.get(fallbackMatch.token);
    const fieldMatches = compareTypography(rawEntry.typography, compactTy);
    typographyFieldMatches += fieldMatches.matchCount;

    if (fieldMatches.matchCount !== 5) {
      mismatchedTypography.push({
        nodeId: rawEntry.nodeId,
        text: rawEntry.text,
        expected: rawEntry.typography,
        actual: compactTy ?? null,
      });
    }
  }

  for (const [index, entry] of compactTexts.entries()) {
    if (!matchedCompactIndexes.has(index)) {
      extraTexts.push(entry.text);
    }
  }

  return {
    rawCount: rawEntries.length,
    compactCount: compactTexts.length,
    matchedRawCount,
    missing,
    extraTexts: [...new Set(extraTexts)],
    recallPct: pct(matchedRawCount, rawEntries.length),
    precisionPct: pct(matchedRawCount, compactTexts.length),
    typographyFieldMatches,
    typographyFieldTotal,
    typographyFieldAccuracyPct: pct(typographyFieldMatches, typographyFieldTotal),
    mismatchedTypography,
  };
}

function auditAssets(rawAssets, compactAssets) {
  const compactKeys = new Set(compactAssets.map((entry) => `${entry.srcRef}|${entry.assetUrl}`));
  const missing = [];
  let matchedCount = 0;

  for (const asset of rawAssets) {
    if (compactKeys.has(asset.key)) {
      matchedCount += 1;
    } else {
      missing.push(asset);
    }
  }

  const rawKeys = new Set(rawAssets.map((entry) => entry.key));
  const extra = compactAssets.filter((entry) => !rawKeys.has(`${entry.srcRef}|${entry.assetUrl}`));

  return {
    rawCount: rawAssets.length,
    compactCount: compactAssets.length,
    matchedCount,
    missing,
    extra,
    recallPct: pct(matchedCount, rawAssets.length),
    precisionPct: pct(matchedCount, compactAssets.length),
  };
}

function auditElements(rawElements, compactElementsById) {
  const missingElements = [];
  const missingPropSamples = [];
  let matchedElementCount = 0;
  let matchedPropCount = 0;

  for (const element of rawElements) {
    const compactElement = compactElementsById.get(element.id);
    if (!compactElement) {
      missingElements.push({
        id: element.id,
        label: element.label,
        props: element.props,
      });
      continue;
    }

    matchedElementCount += 1;
    const compactPropSet = new Set(compactElement.props);
    for (const prop of element.props) {
      if (compactPropSet.has(prop)) {
        matchedPropCount += 1;
      } else if (missingPropSamples.length < 20) {
        missingPropSamples.push({
          id: element.id,
          label: element.label,
          prop,
        });
      }
    }
  }

  const rawElementIds = new Set(rawElements.map((entry) => entry.id));
  const extraElements = [...compactElementsById.values()]
    .filter((entry) => !rawElementIds.has(entry.id))
    .slice(0, 20);

  const totalPropCount = rawElements.reduce((sum, entry) => sum + entry.props.length, 0);

  return {
    rawCount: rawElements.length,
    compactCount: compactElementsById.size,
    matchedElementCount,
    matchedPropCount,
    totalPropCount,
    recallPct: pct(matchedElementCount, rawElements.length),
    stylePropRecallPct: pct(matchedPropCount, totalPropCount),
    missingElements: missingElements.slice(0, 20),
    missingPropSamples,
    extraElements,
  };
}

function auditTraceCoverage(compactDoc) {
  const traceables = [
    ...compactDoc.elements.map((entry) => entry.id),
    ...compactDoc.texts.map((entry) => entry.id),
    ...compactDoc.assets.map((entry) => entry.nodeId),
  ];

  const totalCount = traceables.length;
  const tracedCount = traceables.filter((id) => typeof id === "string" && id !== "-" && id.trim() !== "").length;
  return { tracedCount, totalCount };
}

function auditTypographyAnomalies(typography) {
  const issues = [];
  for (const [token, spec] of typography.entries()) {
    if (
      !Number.isFinite(spec.fontSize) ||
      !Number.isFinite(spec.lineHeight) ||
      spec.fontSize <= 0 ||
      spec.fontSize > 200 ||
      spec.lineHeight < 0 ||
      spec.lineHeight > 300
    ) {
      issues.push({
        token,
        ...spec,
      });
    }
  }
  return issues;
}

function compareTypography(expected, actual) {
  if (!actual) {
    return { matchCount: 0 };
  }

  const fields = [
    ["fontFamily", expected.fontFamily, actual.fontFamily],
    ["fontWeight", expected.fontWeight, actual.fontWeight],
    ["fontSize", expected.fontSize, actual.fontSize],
    ["lineHeight", expected.lineHeight, actual.lineHeight],
    ["color", canonicalizeColor(expected.color), canonicalizeColor(actual.color)],
  ];

  let matchCount = 0;
  for (const [, left, right] of fields) {
    if (left === right) {
      matchCount += 1;
    }
  }

  return { matchCount };
}

function canonicalizeColor(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s*\(.*\)$/u, "")
    .toLowerCase();
}

function parseTypographyFromClassNames(classNames) {
  const parsed = {
    fontFamily: "unknown",
    fontWeight: 400,
    fontSize: 0,
    lineHeight: 0,
    color: "unknown",
  };

  for (const className of classNames) {
    const value = String(className ?? "");
    if (!value) {
      continue;
    }

    const familyMatch = value.match(/font-\['([^:'\]]+)(?::([^'\]]+))?',sans-serif\]/u);
    if (familyMatch) {
      parsed.fontFamily = familyMatch[1];
      parsed.fontWeight = mapFontWeight(familyMatch[2] ?? "");
    }

    const weightMatch = value.match(/(?:^|\s)font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?:\s|$)/u);
    if (weightMatch) {
      parsed.fontWeight = mapFontWeight(weightMatch[1]);
    }

    const sizeMatch = value.match(/(?:^|\s)text-\[(\d+(?:\.\d+)?)px\](?:\s|$)/u);
    if (sizeMatch) {
      parsed.fontSize = Number(sizeMatch[1]);
    }

    const leadingMatch = value.match(/leading-\[(\d+(?:\.\d+)?)px\]/u);
    if (leadingMatch) {
      parsed.lineHeight = Number(leadingMatch[1]);
    }

    const colorVarMatch = value.match(/text-\[color:var\([^,]+,\s*([^)]+)\)\]/u);
    if (colorVarMatch) {
      parsed.color = sanitizeValue(colorVarMatch[1]);
      continue;
    }

    const colorDirectMatch = value.match(/(?:^|\s)text-\[(#[0-9a-fA-F]{3,8})\](?:\s|$)/u);
    if (colorDirectMatch) {
      parsed.color = colorDirectMatch[1];
    }
  }

  return parsed;
}

function buildElementProps(node, isRoot) {
  const props = [];
  const frameInfo = parseFrameTokens(node.style.frame);
  const layoutInfo = parseLayoutTokens(node.style.layout);
  const spacingInfo = parseSpacingTokens(node.style.spacing);
  const decorationInfo = parseDecorationTokens(node.style.decoration);
  const radiusInfo = parseRadiusTokens(node.style.extras);

  if (frameInfo.width) props.push(`w${frameInfo.width}`);
  if (frameInfo.height) props.push(`h${frameInfo.height}`);
  if (frameInfo.size) props.push(`size${frameInfo.size}`);
  if (layoutInfo.layout) props.push(`layout:${layoutInfo.layout}`);
  if (layoutInfo.gap) props.push(`gap:${layoutInfo.gap}`);
  if (layoutInfo.items) props.push(`items:${layoutInfo.items}`);
  if (layoutInfo.justify) props.push(`justify:${layoutInfo.justify}`);
  if (spacingInfo.padding) props.push(`p:${spacingInfo.padding}`);
  if (spacingInfo.px) props.push(`px:${spacingInfo.px}`);
  if (spacingInfo.py) props.push(`py:${spacingInfo.py}`);
  if (spacingInfo.pt) props.push(`pt:${spacingInfo.pt}`);
  if (spacingInfo.pb) props.push(`pb:${spacingInfo.pb}`);
  if (spacingInfo.pl) props.push(`pl:${spacingInfo.pl}`);
  if (spacingInfo.pr) props.push(`pr:${spacingInfo.pr}`);
  if (decorationInfo.background) props.push(`bg:${decorationInfo.background}`);
  if (radiusInfo.radius) props.push(`r${radiusInfo.radius}`);

  if (isRoot && props.length === 0) {
    return ["root"];
  }

  return props;
}

function parseTypography(tokens) {
  const parsed = {
    fontFamily: "unknown",
    fontWeight: 400,
    fontSize: 0,
    lineHeight: 0,
    color: "unknown",
  };

  for (const token of tokens) {
    if (token.startsWith("font ")) {
      const value = token.slice("font ".length).trim();
      const [family, style] = value.split(/\s+(?=[A-Z][a-z])/u);
      parsed.fontFamily = family ?? value;
      parsed.fontWeight = mapFontWeight(style ?? value);
      continue;
    }

    if (token.startsWith("size ")) {
      parsed.fontSize = parseCssNumber(token.slice("size ".length));
      continue;
    }

    if (token.startsWith("line ")) {
      parsed.lineHeight = parseCssNumber(token.slice("line ".length));
      continue;
    }

    if (token.startsWith("color ")) {
      parsed.color = extractColor(token.slice("color ".length));
    }
  }

  return parsed;
}

function parseFrameTokens(tokens) {
  const parsed = {};
  for (const token of tokens) {
    if (token.startsWith("w ")) {
      parsed.width = parseCssNumber(token.slice(2));
      continue;
    }
    if (token.startsWith("h ")) {
      parsed.height = parseCssNumber(token.slice(2));
      continue;
    }
    if (token.startsWith("size ")) {
      parsed.size = parseCssNumber(token.slice(5));
    }
  }
  return parsed;
}

function parseLayoutTokens(tokens) {
  const parsed = {};
  for (const token of tokens) {
    if (token === "column") {
      parsed.layout = "column";
      continue;
    }
    if (token.startsWith("gap ")) {
      parsed.gap = parseCssNumber(token.slice(4));
      continue;
    }
    if (token.startsWith("items ")) {
      parsed.items = sanitizeValue(token.slice(6).replace(/\s+/gu, "_"));
      continue;
    }
    if (token.startsWith("justify ")) {
      parsed.justify = sanitizeValue(token.slice(8).replace(/\s+/gu, "_"));
    }
  }
  return parsed;
}

function parseSpacingTokens(tokens) {
  const parsed = {};
  for (const token of tokens) {
    if (token.startsWith("p ")) {
      parsed.padding = parseCssNumber(token.slice(2));
      continue;
    }
    if (token.startsWith("px ")) {
      parsed.px = parseCssNumber(token.slice(3));
      continue;
    }
    if (token.startsWith("py ")) {
      parsed.py = parseCssNumber(token.slice(3));
      continue;
    }
    if (token.startsWith("pt ")) {
      parsed.pt = parseCssNumber(token.slice(3));
      continue;
    }
    if (token.startsWith("pb ")) {
      parsed.pb = parseCssNumber(token.slice(3));
      continue;
    }
    if (token.startsWith("pl ")) {
      parsed.pl = parseCssNumber(token.slice(3));
      continue;
    }
    if (token.startsWith("pr ")) {
      parsed.pr = parseCssNumber(token.slice(3));
    }
  }
  return parsed;
}

function parseDecorationTokens(tokens) {
  const parsed = {};
  for (const token of tokens) {
    if (token.startsWith("bg ")) {
      parsed.background = extractColor(token.slice(3));
    }
  }
  return parsed;
}

function parseRadiusTokens(tokens) {
  const parsed = {};
  for (const token of tokens) {
    if (!token.startsWith("rounded-[")) {
      continue;
    }
    const numberMatch = token.match(/([0-9]+)px/u);
    if (numberMatch) {
      parsed.radius = Number(numberMatch[1]);
    }
  }
  return parsed;
}

function mergeTypographyTokens(tokenLists) {
  const scalar = new Map();
  const flags = [];

  for (const tokens of tokenLists) {
    for (const token of tokens ?? []) {
      if (token.startsWith("font ")) {
        scalar.set("font", token);
        continue;
      }
      if (token.startsWith("size ")) {
        scalar.set("size", token);
        continue;
      }
      if (token.startsWith("color ")) {
        scalar.set("color", token);
        continue;
      }
      if (token.startsWith("line ")) {
        scalar.set("line", token);
        continue;
      }
      if (!flags.includes(token)) {
        flags.push(token);
      }
    }
  }

  return [...scalar.values(), ...flags].filter((token) => token !== "line 0");
}

function flattenNodes(rootNode) {
  const nodes = [];
  walk(rootNode, (node) => nodes.push(node));
  return nodes;
}

function walk(node, visitor) {
  visitor(node);
  for (const child of node.children ?? []) {
    walk(child, visitor);
  }
}

function walkWithAncestors(node, ancestors, visitor) {
  const nextAncestors = [...ancestors, node];
  visitor(node, nextAncestors);
  for (const child of node.children ?? []) {
    walkWithAncestors(child, nextAncestors, visitor);
  }
}

function buildNodeLabel(node, isRoot) {
  if (isRoot) {
    return "screen";
  }

  const source = decodeEntities(String(node.dataName ?? node.componentMeta?.displayName ?? node.tag));
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_");

  return slug || String(node.tag ?? "node").toLowerCase();
}

function isChromeNode(node) {
  const label = decodeEntities(String(node.dataName ?? "")).toLowerCase();
  return isChromeLabel(label);
}

function isChromeLabel(label) {
  const normalized = decodeEntities(String(label ?? "")).toLowerCase();
  return CHROME_LABELS.has(normalized) || normalized.includes("status bar") || normalized.includes("navi");
}

function compressAssetUrl(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/");
    return segments[segments.length - 1] || url;
  } catch {
    return url;
  }
}

function mapFontWeight(style) {
  const normalized = String(style).toLowerCase();
  if (normalized.includes("semibold")) return 600;
  if (normalized.includes("medium")) return 500;
  if (normalized.includes("bold")) return 700;
  return 400;
}

function parseCssNumber(value) {
  const match = String(value).match(/-?\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : 0;
}

function extractColor(value) {
  const match = String(value).match(/#[0-9a-fA-F]{3,8}/u);
  return match ? match[0] : sanitizeValue(value);
}

function sanitizeValue(value) {
  return collapseWhitespace(String(value))
    .replace(/\|/gu, "/")
    .replace(/\n/gu, " ");
}

function decodeEntities(value) {
  return String(value)
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}

function collapseWhitespace(text) {
  return String(text).replace(/\s+/gu, " ").trim();
}

function dedupeBy(values, keyFn) {
  const seen = new Set();
  const deduped = [];

  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

function pushBucket(map, key, value) {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    map.set(key, [value]);
  }
}

function shiftUnmatched(bucket, matchedIndexes) {
  if (!bucket) {
    return null;
  }

  while (bucket.length > 0) {
    const entry = bucket.shift();
    if (!matchedIndexes.has(entry.index)) {
      return entry;
    }
  }

  return null;
}

function pct(value, total) {
  if (!total) {
    return null;
  }
  return Number(((value / total) * 100).toFixed(2));
}

function lossPct(preserved, total) {
  if (!total) {
    return null;
  }
  return Number((100 - (preserved / total) * 100).toFixed(2));
}

await main();
