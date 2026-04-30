import { analyzeDesignContext } from "./design-context-analyzer.js";

const DEFAULT_MODE = "balanced";
const DEFAULT_TASK = "implement";
const CHROME_LABELS = new Set([
  "status bar",
  "header bar",
  "navigation background",
  "navigation item",
]);

export function serializeDesignContextToCompactContext(options) {
  const fileKey = options?.fileKey;
  const nodeId = options?.nodeId;
  const contentBlocks = normalizeStringArray(options?.contentBlocks);
  const metadataBlocks = normalizeStringArray(options?.metadataBlocks);

  if (typeof fileKey !== "string" || fileKey.trim() === "") {
    throw new Error("`fileKey` must be a non-empty string.");
  }

  if (typeof nodeId !== "string" || nodeId.trim() === "") {
    throw new Error("`nodeId` must be a non-empty string.");
  }

  if (contentBlocks.length === 0) {
    throw new Error("At least one design-context block is required.");
  }

  const mode = options?.mode ?? DEFAULT_MODE;
  const task = options?.task ?? DEFAULT_TASK;
  const includeAssets = options?.includeAssets !== false;
  const includeTextSpecs = options?.includeTextSpecs !== false;
  const includeTraceIds = options?.includeTraceIds !== false;
  const warningLines = normalizeStringArray(options?.warningLines);

  const analysis = analyzeDesignContext({
    contentBlocks,
    metadataBlocks,
  });

  const lines = [];
  lines.push(`src|figma|get_design_context|${includeTraceIds ? nodeId : "-"}|${sanitizeValue(fileKey)}`);

  const summaryName = decodeEntities(
    analysis.metadataSummary.name ?? analysis.componentName ?? "node"
  );
  const summaryType = String(analysis.metadataSummary.type ?? "unknown").toLowerCase();
  const summaryFrame = normalizeFrame(analysis.metadataSummary.frame);
  const summaryOrigin = normalizeOrigin(analysis.metadataSummary.origin);
  lines.push(
    `sum|${sanitizeValue(summaryName)}|${sanitizeValue(summaryType)}|${summaryFrame}|${summaryOrigin}`
  );

  if (analysis.rootNode) {
    for (const elementLine of buildElementLines(analysis.rootNode, {
      includeTraceIds,
      mode,
      task,
    })) {
      lines.push(elementLine);
    }

    if (includeTextSpecs) {
      const textPayload = buildTextPayload(analysis.rootNode, {
        includeTraceIds,
        mode,
        task,
      });

      for (const textLine of textPayload.textLines) {
        lines.push(textLine);
      }

      for (const typographyLine of textPayload.typographyLines) {
        lines.push(typographyLine);
      }
    }

    if (includeAssets) {
      for (const assetLine of buildAssetLines(analysis.rootNode, {
        includeTraceIds,
        mode,
        task,
      })) {
        lines.push(assetLine);
      }
    }
  }

  if (mode !== "minimal") {
    for (const warningLine of warningLines) {
      lines.push(`wa|bridge|${sanitizeValue(warningLine)}`);
    }

    for (const warningLine of analysis.warningLines) {
      lines.push(`wa|analysis|${sanitizeValue(warningLine.replace(/^- /u, ""))}`);
    }
  }

  return lines.join("\n");
}

function buildElementLines(rootNode, options) {
  const nodes = flattenNodes(rootNode);
  const elementLines = [];

  for (const [index, node] of nodes.entries()) {
    const isRoot = index === 0;
    if (!shouldKeepElement(node, isRoot, options)) {
      continue;
    }

    const props = buildElementProps(node, isRoot);
    if (props.length === 0 && !isRoot) {
      continue;
    }

    const id = options.includeTraceIds
      ? sanitizeValue(node.dataNodeId ?? `${node.tag}_${index + 1}`)
      : "-";
    const label = buildNodeLabel(node, isRoot);
    elementLines.push(`el|${id}|${label}|${props.join(";")}`);
  }

  return dedupe(elementLines);
}

function shouldKeepElement(node, isRoot, options) {
  if (isRoot) {
    return true;
  }

  if (node.tag === "img" || node.tag === "p") {
    return false;
  }

  if (options.task !== "inspect" && isChromeNode(node)) {
    return false;
  }

  if (node.assetUrl) {
    return false;
  }

  if (buildElementProps(node, false).length === 0) {
    return false;
  }

  return true;
}

function isChromeNode(node) {
  const label = decodeEntities(String(node.dataName ?? "")).toLowerCase();
  if (CHROME_LABELS.has(label)) {
    return true;
  }

  return label.includes("status bar") || label.includes("header bar") || label.includes("navigation");
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

function buildTextPayload(rootNode, options) {
  const entries = collectTextEntries(rootNode)
    .filter((entry) => entry.text !== "")
    .filter((entry) => {
      if (options.task === "inspect") {
        return true;
      }

      return !hasChromeAncestor(entry.ancestors);
    });

  const typographyTokenMap = new Map();
  const typographyOrder = [];
  const textLines = [];

  for (const entry of entries) {
    const typography = parseTypography(entry.typography);
    const typographyKey = JSON.stringify(typography);
    let token = typographyTokenMap.get(typographyKey);
    if (!token) {
      token = `t${typographyTokenMap.size + 1}`;
      typographyTokenMap.set(typographyKey, token);
      typographyOrder.push([token, typography]);
    }

    const nodeId = options.includeTraceIds ? sanitizeValue(entry.nodeId ?? "-") : "-";
    textLines.push(`tx|${nodeId}|${sanitizeValue(entry.text)}|${token}`);
  }

  const typographyLines = typographyOrder.map(([token, typography]) =>
    `ty|${token}|${sanitizeValue(typography.fontFamily)}|${typography.fontWeight}|${typography.fontSize}|${typography.lineHeight}|${sanitizeValue(typography.color)}`
  );

  return {
    textLines: dedupe(textLines),
    typographyLines,
  };
}

function buildAssetLines(rootNode, options) {
  const lines = [];

  walkWithAncestors(rootNode, [], (node, ancestors) => {
    if (options.task !== "inspect" && (isChromeNode(node) || hasChromeAncestor(ancestors))) {
      return;
    }

    if (!node.assetUrl || !node.srcRef) {
      return;
    }

    const traceNode = resolveAssetTraceNode(ancestors);
    const nodeId = options.includeTraceIds ? sanitizeValue(traceNode.dataNodeId ?? "-") : "-";
    lines.push(
      `as|${sanitizeValue(node.srcRef)}|asset|${nodeId}|${buildNodeLabel(traceNode, false)}|${sanitizeValue(compressAssetUrl(node.assetUrl))}`
    );
  });

  return dedupe(lines);
}

function resolveAssetTraceNode(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const candidate = ancestors[index];
    if (typeof candidate.dataNodeId === "string" || typeof candidate.dataName === "string") {
      return candidate;
    }
  }

  return ancestors[ancestors.length - 1];
}

function hasChromeAncestor(ancestors) {
  return ancestors.some(
    (ancestor, index) =>
      index > 0 &&
      index < ancestors.length - 1 &&
      isChromeNode(ancestor)
  );
}

function collectTextEntries(rootNode) {
  const entries = [];

  walkWithAncestors(rootNode, [], (node, ancestors) => {
    if (!Array.isArray(node.texts) || node.texts.length === 0) {
      return;
    }

    const nodeId = [...ancestors]
      .reverse()
      .find((item) => typeof item.dataNodeId === "string")?.dataNodeId ?? null;

    entries.push({
      text: collapseWhitespace(node.texts.join(" ")),
      nodeId,
      typography: mergeTypographyTokens(ancestors.map((item) => item.style.typography)),
      ancestors,
    });
  });

  return dedupeBy(entries, (entry) => `${entry.text}|${entry.nodeId ?? ""}|${entry.typography.join("|")}`);
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

function compressAssetUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname || url;
  } catch {
    return url;
  }
}

function normalizeFrame(frame) {
  if (typeof frame !== "string" || frame.trim() === "") {
    return "-";
  }

  return sanitizeValue(frame.replace(/\s*x\s*/u, "x"));
}

function normalizeOrigin(origin) {
  if (typeof origin !== "string" || origin.trim() === "") {
    return "-";
  }

  const match = origin.match(/x\s+([^,]+),\s*y\s+(.+)$/u);
  if (!match) {
    return sanitizeValue(origin);
  }

  return `${sanitizeValue(match[1])},${sanitizeValue(match[2])}`;
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

function collapseWhitespace(text) {
  return String(text).replace(/\s+/gu, " ").trim();
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

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((value) => typeof value === "string")
    .map((value) => stripOuterCodeFence(value).trim())
    .filter((value) => value.length > 0);
}

function stripOuterCodeFence(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```[A-Za-z0-9_-]*\n([\s\S]*?)\n```$/u);
  return match ? match[1] : value;
}

function dedupe(values) {
  return [...new Set(values)];
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
