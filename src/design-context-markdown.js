// HTML void elements — self-closing by spec, no closing tag in JSX output from Figma MCP.
const VOID_TAGS = new Set(["img", "input", "br", "hr", "meta", "link"]);

export function serializeDesignContextToMarkdown(options) {
  const fileKey = options?.fileKey;
  const nodeId = options?.nodeId;
  const contentBlocks = normalizeStringArray(options?.contentBlocks);
  const metadataBlocks = normalizeStringArray(options?.metadataBlocks);
  const supplementTools = normalizeStringArray(options?.supplementTools);

  if (typeof fileKey !== "string" || fileKey.trim() === "") {
    throw new Error("`fileKey` must be a non-empty string.");
  }

  if (typeof nodeId !== "string" || nodeId.trim() === "") {
    throw new Error("`nodeId` must be a non-empty string.");
  }

  if (contentBlocks.length === 0) {
    throw new Error("At least one design-context block is required.");
  }

  const analysis = analyzeDesignContext({
    contentBlocks,
    metadataBlocks,
  });

  const lines = [
    "# Figma Design Context",
    "",
    "## Source",
    "- provider: `figma-mcp`",
    "- transformed-by: `figma-to-markdown`",
    "- primary tool: `get_design_context`",
    supplementTools.length > 0
      ? `- supplements: ${supplementTools.map((tool) => `\`${tool}\``).join(", ")}`
      : "- supplements: none",
    `- node-id: \`${nodeId}\``,
    `- file-key: \`${fileKey}\``,
    "- mode: compact implementation handoff",
    "- raw upstream code: omitted by default to reduce agent input size",
  ];

  const nodeSummary = buildNodeSummaryLines(analysis.metadataSummary, analysis.componentName);
  if (nodeSummary.length > 0) {
    lines.push("", "## Node Summary", ...nodeSummary);
  }

  if (analysis.elementSpecLines.length > 0) {
    lines.push("", "## Compact Element Spec", ...analysis.elementSpecLines);
  }

  if (analysis.textSpecLines.length > 0) {
    lines.push("", "## Text Spec", ...analysis.textSpecLines);
  }

  if (analysis.assetLines.length > 0) {
    lines.push("", "## Asset Spec", ...analysis.assetLines);
  }

  if (analysis.noteLines.length > 0) {
    lines.push("", "## Preserved Notes", ...analysis.noteLines);
  }

  if (analysis.warningLines.length > 0) {
    lines.push("", "## QA Flags", ...analysis.warningLines);
  }

  return lines.join("\n");
}

function analyzeDesignContext({ contentBlocks, metadataBlocks }) {
  const codeBlocks = [];
  const noteBlocks = [];

  for (const block of contentBlocks) {
    if (looksLikeCode(block)) {
      codeBlocks.push(block);
    } else {
      noteBlocks.push(block);
    }
  }

  const metadataSummary = extractMetadataSummary(metadataBlocks);
  const assetMap = mergeAssetMaps(codeBlocks);
  const componentMap = mergeComponentMaps(codeBlocks, assetMap);
  const rootNode = extractPrimaryRootNode(codeBlocks, componentMap, assetMap);
  const componentName = extractDefaultComponentName(codeBlocks);

  return {
    metadataSummary,
    componentName,
    elementSpecLines: rootNode ? summarizeElementSpecs(rootNode) : [],
    textSpecLines: rootNode ? summarizeTextSpecs(rootNode, noteBlocks) : summarizeTextNotes(noteBlocks),
    assetLines: rootNode ? summarizeAssets(rootNode, componentMap) : summarizeAssetNotes(noteBlocks),
    noteLines: summarizeNotes(noteBlocks, metadataSummary.notes),
    warningLines: summarizeWarnings({
      codeBlocks,
      rootNode,
      metadataSummary,
    }),
  };
}

function summarizeWarnings({ codeBlocks, rootNode, metadataSummary }) {
  const warnings = [];

  if (codeBlocks.length > 0 && !rootNode) {
    warnings.push("- Structured JSX compaction failed for the upstream code block. Fallback output may be incomplete; use raw Figma MCP or screenshot verification if implementation needs more detail.");
  }

  if (!metadataSummary.name && !metadataSummary.frame) {
    warnings.push("- Upstream metadata was limited. Node frame or name could not be verified from `get_metadata`.");
  }

  return warnings;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function buildNodeSummaryLines(metadataSummary, componentName) {
  const lines = [];

  if (componentName) {
    lines.push(`- component: \`${componentName}\``);
  }

  if (metadataSummary.name) {
    lines.push(`- name: \`${metadataSummary.name}\``);
  }

  if (metadataSummary.type) {
    lines.push(`- type: \`${metadataSummary.type}\``);
  }

  if (metadataSummary.frame) {
    lines.push(`- frame: \`${metadataSummary.frame}\``);
  }

  if (metadataSummary.origin) {
    lines.push(`- origin: \`${metadataSummary.origin}\``);
  }

  return lines;
}

function extractMetadataSummary(metadataBlocks) {
  const summary = {
    type: null,
    name: null,
    frame: null,
    origin: null,
    notes: [],
  };

  for (const block of metadataBlocks) {
    const xml = parseMetadataXml(block);
    if (xml) {
      summary.type ??= xml.type;
      summary.name ??= xml.name;
      summary.frame ??= xml.frame;
      summary.origin ??= xml.origin;
      continue;
    }

    summary.notes.push(block);
  }

  return summary;
}

function parseMetadataXml(block) {
  const match = block.match(/^<([a-z_]+)\s+([^>]+?)\/?>$/iu);
  if (!match) {
    return null;
  }

  const type = match[1];
  const attrs = new Map();

  for (const attrMatch of match[2].matchAll(/([a-z-]+)="([^"]*)"/giu)) {
    attrs.set(attrMatch[1], attrMatch[2]);
  }

  const width = attrs.get("width");
  const height = attrs.get("height");
  const x = attrs.get("x");
  const y = attrs.get("y");

  return {
    type,
    name: attrs.get("name") ?? null,
    frame: width && height ? `${width} x ${height}` : null,
    origin: x && y ? `x ${x}, y ${y}` : null,
  };
}

function mergeAssetMaps(codeBlocks) {
  const assetMap = new Map();

  for (const block of codeBlocks) {
    for (const match of block.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*"([^"]+)"/gu)) {
      assetMap.set(match[1], match[2]);
    }
  }

  return assetMap;
}

function mergeComponentMaps(codeBlocks, assetMap) {
  const componentMap = new Map();

  for (const block of codeBlocks) {
    for (const match of block.matchAll(/function\s+([A-Za-z][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{\s*return\s*(?:\(([\s\S]*?)\)|([\s\S]*?));\s*\}/gu)) {
      const functionName = match[1];
      const jsx = match[2] ?? match[3];
      const rootNode = parseJsxTree(jsx, new Map(), assetMap);

      if (!rootNode) {
        continue;
      }

      componentMap.set(functionName, {
        functionName,
        displayName: rootNode.dataName ?? functionName,
        nodeId: rootNode.dataNodeId ?? null,
        style: rootNode.style,
        assetRefs: collectAssetRefs(rootNode),
      });
    }
  }

  return componentMap;
}

function extractPrimaryRootNode(codeBlocks, componentMap, assetMap) {
  for (const block of codeBlocks) {
    const jsx = extractDefaultReturnJsx(block);
    if (!jsx) {
      continue;
    }

    const rootNode = parseJsxTree(jsx, componentMap, assetMap);
    if (rootNode) {
      return rootNode;
    }
  }

  return null;
}

function extractDefaultReturnJsx(block) {
  const match = block.match(/export\s+default\s+function\s+[A-Za-z0-9_]*\s*\([^)]*\)\s*\{\s*return\s*(?:\(([\s\S]*?)\)|([\s\S]*?));\s*\}/u);
  return match?.[1] ?? match?.[2] ?? null;
}

function extractDefaultComponentName(codeBlocks) {
  for (const block of codeBlocks) {
    const match = block.match(/export\s+default\s+function\s+([A-Za-z][A-Za-z0-9_]*)/u);
    if (match) {
      return match[1];
    }
  }

  return null;
}

// Heuristic stack-based JSX parser — not a full AST. Tuned for Figma MCP's React+Tailwind output
// format. Handles self-closing tags and void HTML elements but does not support expression blocks.
function parseJsxTree(jsx, componentMap, assetMap) {
  const roots = [];
  const stack = [];
  const pattern = /<\/?([A-Za-z][A-Za-z0-9_]*)\b([^>]*)>/gs;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(jsx)) !== null) {
    const rawTag = match[0];
    const tag = match[1];
    const attrs = match[2] ?? "";
    const between = jsx.slice(lastIndex, match.index);
    attachTextToCurrentNode(stack, between);

    if (rawTag.startsWith("</")) {
      popUntilTag(stack, tag);
    } else {
      const node = createNode(tag, attrs, componentMap, assetMap);

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        roots.push(node);
      }

      if (!isSelfClosingTag(rawTag, tag)) {
        stack.push(node);
      }
    }

    lastIndex = pattern.lastIndex;
  }

  attachTextToCurrentNode(stack, jsx.slice(lastIndex));

  return roots[0] ?? null;
}

function createNode(tag, attrs, componentMap, assetMap) {
  const className = extractClassName(attrs);
  const srcRef = extractIdentifierAttribute(attrs, "src");
  const componentMeta = /^[A-Z]/u.test(tag) ? componentMap.get(tag) ?? null : null;

  return {
    tag,
    dataNodeId: extractQuotedAttribute(attrs, "data-node-id") ?? componentMeta?.nodeId ?? null,
    dataName: extractQuotedAttribute(attrs, "data-name") ?? componentMeta?.displayName ?? null,
    className,
    style: summarizeClassTokens(className),
    srcRef,
    assetUrl: srcRef ? assetMap.get(srcRef) ?? null : null,
    componentMeta,
    texts: [],
    children: [],
  };
}

function extractQuotedAttribute(attrs, name) {
  const escapedName = escapeRegex(name);
  const direct = attrs.match(new RegExp(`${escapedName}\\s*=\\s*"([^"]*)"`, "su"));
  if (direct) {
    return direct[1];
  }

  const wrapped = attrs.match(new RegExp(`${escapedName}\\s*=\\s*\\{\\s*"([^"]*)"\\s*\\}`, "su"));
  return wrapped?.[1] ?? null;
}

function extractIdentifierAttribute(attrs, name) {
  const escapedName = escapeRegex(name);
  const wrapped = attrs.match(new RegExp(`${escapedName}\\s*=\\s*\\{\\s*([A-Za-z0-9_.$-]+)\\s*\\}`, "su"));
  return wrapped?.[1] ?? null;
}

function extractClassName(attrs) {
  const direct = attrs.match(/className\s*=\s*"([^"]*)"/su);
  if (direct) {
    return direct[1];
  }

  const fallback = attrs.match(/className\s*=\s*\{[\s\S]*?"([^"]*)"[\s\S]*?\}/su);
  return fallback?.[1] ?? null;
}

function attachTextToCurrentNode(stack, text) {
  if (stack.length === 0) {
    return;
  }

  const cleaned = cleanText(text);
  if (!cleaned) {
    return;
  }

  stack[stack.length - 1].texts.push(cleaned);
}

function cleanText(text) {
  const cleaned = text
    .replace(/\s+/gu, " ")
    .trim();

  if (cleaned === "" || /[{}]/u.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function popUntilTag(stack, tag) {
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.tag === tag) {
      return;
    }
  }
}

function isSelfClosingTag(rawTag, tag) {
  return rawTag.endsWith("/>") || VOID_TAGS.has(tag.toLowerCase());
}

function summarizeClassTokens(className) {
  const summary = {
    frame: [],
    layout: [],
    spacing: [],
    typography: [],
    decoration: [],
    extras: [],
  };

  if (typeof className !== "string" || className.trim() === "") {
    return summary;
  }

  const tokens = className.trim().split(/\s+/u);

  for (const token of tokens) {
    if (token === "flex") {
      pushUnique(summary.layout, "flex");
      continue;
    }

    if (token === "flex-col") {
      pushUnique(summary.layout, "column");
      continue;
    }

    if (token === "items-center") {
      pushUnique(summary.layout, "items center");
      continue;
    }

    if (token === "justify-end") {
      pushUnique(summary.layout, "justify end");
      continue;
    }

    if (token === "justify-center") {
      pushUnique(summary.layout, "justify center");
      continue;
    }

    if (token.startsWith("flex-[")) {
      pushUnique(summary.layout, `flex ${stripBrackets(token.slice(5))}`);
      continue;
    }

    if (token.startsWith("gap-[")) {
      pushUnique(summary.layout, `gap ${describeBracketValue(stripBrackets(token.slice(4)))}`);
      continue;
    }

    if (token.startsWith("size-[")) {
      pushUnique(summary.frame, `size ${describeBracketValue(stripBrackets(token.slice(5)))}`);
      continue;
    }

    if (token.startsWith("w-[")) {
      pushUnique(summary.frame, `w ${describeBracketValue(stripBrackets(token.slice(2)))}`);
      continue;
    }

    if (token.startsWith("h-[")) {
      pushUnique(summary.frame, `h ${describeBracketValue(stripBrackets(token.slice(2)))}`);
      continue;
    }

    if (token.startsWith("px-[")) {
      pushUnique(summary.spacing, `px ${describeBracketValue(stripBrackets(token.slice(3)))}`);
      continue;
    }

    if (token.startsWith("py-[")) {
      pushUnique(summary.spacing, `py ${describeBracketValue(stripBrackets(token.slice(3)))}`);
      continue;
    }

    if (token.startsWith("pl-[")) {
      pushUnique(summary.spacing, `pl ${describeBracketValue(stripBrackets(token.slice(3)))}`);
      continue;
    }

    if (token.startsWith("pr-[")) {
      pushUnique(summary.spacing, `pr ${describeBracketValue(stripBrackets(token.slice(3)))}`);
      continue;
    }

    if (token.startsWith("pt-[")) {
      pushUnique(summary.spacing, `pt ${describeBracketValue(stripBrackets(token.slice(3)))}`);
      continue;
    }

    if (token.startsWith("pb-[")) {
      pushUnique(summary.spacing, `pb ${describeBracketValue(stripBrackets(token.slice(3)))}`);
      continue;
    }

    if (token.startsWith("bg-[")) {
      pushUnique(summary.decoration, `bg ${describeBracketValue(stripBrackets(token.slice(3)))}`);
      continue;
    }

    if (token.startsWith("font-[")) {
      pushUnique(summary.typography, `font ${describeFontToken(stripBrackets(token.slice(5)))}`);
      continue;
    }

    if (token.startsWith("text-[")) {
      const value = stripBrackets(token.slice(5));
      if (value.startsWith("color:")) {
        pushUnique(summary.typography, `color ${describeBracketValue(value.slice(6))}`);
      } else {
        pushUnique(summary.typography, `size ${describeBracketValue(value)}`);
      }
      continue;
    }

    if (token.startsWith("leading-[")) {
      pushUnique(summary.typography, `line ${describeBracketValue(stripBrackets(token.slice(8)))}`);
      continue;
    }

    if (token === "text-ellipsis") {
      pushUnique(summary.typography, "ellipsis");
      continue;
    }

    if (token === "whitespace-nowrap") {
      pushUnique(summary.typography, "nowrap");
      continue;
    }

    if (token === "overflow-hidden") {
      pushUnique(summary.typography, "overflow hidden");
      continue;
    }

    if (IGNORABLE_TOKENS.has(token)) {
      continue;
    }

    pushUnique(summary.extras, token);
  }

  return summary;
}

// Tailwind classes that carry no implementation-relevant information for the target platform.
// Positioning helpers (relative/absolute) and Figma-generated layout resets are omitted
// because they are artefacts of the React output format, not design intent.
const IGNORABLE_TOKENS = new Set([
  "relative",
  "absolute",
  "content-stretch",
  "min-w-px",
  "shrink-0",
  "size-full",
  "block",
  "max-w-none",
  "not-italic",
  "inset-0",
  "bottom-1/2",
  "top-1/2",
]);

function stripBrackets(value) {
  return value.replace(/^\[/u, "").replace(/\]$/u, "");
}

function describeBracketValue(value) {
  const unescaped = value.replaceAll("\\/", "/");

  if (unescaped.startsWith("var(") && unescaped.endsWith(")")) {
    return describeVarValue(unescaped);
  }

  return unescaped.replace(/^['"]|['"]$/gu, "");
}

function describeVarValue(value) {
  const match = value.match(/^var\(--([^,]+),(.+)\)$/u);
  if (!match) {
    return value;
  }

  const tokenName = formatDesignTokenName(match[1]);
  const fallback = match[2].trim();
  return `${fallback} (${tokenName})`;
}

function formatDesignTokenName(name) {
  if (name.startsWith("color/")) {
    return name.slice("color/".length);
  }

  if (name.startsWith("spacing/")) {
    return name.slice("spacing/".length);
  }

  if (name.startsWith("gap/")) {
    return name.slice("gap/".length);
  }

  return name;
}

function describeFontToken(value) {
  return value
    .replace(/^'/u, "")
    .replace(/',sans-serif$/u, "")
    .replace(":", " ");
}

function summarizeElementSpecs(rootNode) {
  const flatNodes = flattenNodes(rootNode).filter((node, index) => isSignificantElementNode(node, index === 0));
  const grouped = collapseConsecutiveNodes(flatNodes.map(buildElementSummary).filter(Boolean));

  return grouped.map((item) => {
    const parts = [];

    if (item.count > 1) {
      parts.push(`- ${item.label} x${item.count}`);
      if (item.nodeIds.length > 0) {
        parts.push(`ids ${item.nodeIds.map((nodeId) => `\`${nodeId}\``).join(", ")}`);
      }
    } else {
      parts.push(`- ${item.label}`);
      if (item.nodeIds[0]) {
        parts.push(`id \`${item.nodeIds[0]}\``);
      }
    }

    if (item.spec) {
      parts.push(item.spec);
    }

    return parts.join(" -> ");
  });
}

function isSignificantElementNode(node, isRoot) {
  if (isRoot) {
    return true;
  }

  if (node.tag === "img") {
    return false;
  }

  if (node.tag === "p") {
    return false;
  }

  if (node.assetUrl || node.componentMeta) {
    return true;
  }

  if (node.dataName || node.dataNodeId) {
    return true;
  }

  if (hasStyleDetails(node.style)) {
    return true;
  }

  return false;
}

function hasStyleDetails(style) {
  return style.frame.length > 0 ||
    style.layout.length > 0 ||
    style.spacing.length > 0 ||
    style.typography.length > 0 ||
    style.decoration.length > 0 ||
    style.extras.length > 0;
}

function buildElementSummary(node) {
  const label = formatNodeLabel(node);
  const styleParts = summarizeStyleParts(node.style);
  const directText = node.texts.length > 0 ? collapseWhitespace(node.texts.join(" ")) : null;
  const assetPart = node.assetUrl
    ? `asset \`${node.srcRef}\` (${compressAssetUrl(node.assetUrl)})`
    : node.componentMeta?.assetRefs?.length > 0
      ? `assets ${node.componentMeta.assetRefs.map((asset) => `\`${asset.ref}\``).join(", ")}`
      : null;

  const specParts = [...styleParts];
  if (directText) {
    specParts.push(`text "${directText}"`);
  }
  if (assetPart) {
    specParts.push(assetPart);
  }

  return {
    groupKey: `${label}|${specParts.join("|")}`,
    label,
    nodeIds: node.dataNodeId ? [node.dataNodeId] : [],
    spec: specParts.join("; "),
    count: 1,
  };
}

function collapseConsecutiveNodes(items) {
  const collapsed = [];

  for (const item of items) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.groupKey === item.groupKey) {
      previous.count += 1;
      previous.nodeIds.push(...item.nodeIds);
      continue;
    }

    collapsed.push({
      ...item,
      nodeIds: [...item.nodeIds],
    });
  }

  return collapsed;
}

function summarizeStyleParts(style) {
  const parts = [];

  if (style.frame.length > 0) {
    parts.push(style.frame.join(", "));
  }

  if (style.layout.length > 0) {
    parts.push(style.layout.join(", "));
  }

  if (style.spacing.length > 0) {
    parts.push(style.spacing.join(", "));
  }

  if (style.decoration.length > 0) {
    parts.push(style.decoration.join(", "));
  }

  if (style.extras.length > 0) {
    parts.push(`extra ${style.extras.join(", ")}`);
  }

  return parts;
}

function summarizeTextSpecs(rootNode, noteBlocks) {
  const lines = [];
  for (const entry of collectTextEntries(rootNode)) {
    const parts = [`- text "${entry.text}"`];

    if (entry.nodeId) {
      parts.push(`id \`${entry.nodeId}\``);
    }

    if (entry.typography.length > 0) {
      parts.push(`-> ${entry.typography.join(", ")}`);
    }

    lines.push(parts.join(" "));
  }

  for (const line of summarizeTextNotes(noteBlocks)) {
    if (!lines.includes(line)) {
      lines.push(line);
    }
  }

  return lines;
}

function collectTextEntries(rootNode) {
  const entries = [];

  walkWithAncestors(rootNode, [], (node, ancestors) => {
    if (node.texts.length === 0) {
      return;
    }

    const typography = mergeTypographyTokens(ancestors.map((item) => item.style.typography));
    const nodeId = [...ancestors]
      .reverse()
      .find((item) => item.dataNodeId)?.dataNodeId ?? null;

    entries.push({
      text: collapseWhitespace(node.texts.join(" ")),
      nodeId,
      typography,
    });
  });

  return dedupeBy(entries, (entry) => `${entry.text}|${entry.nodeId ?? ""}|${entry.typography.join("|")}`);
}

function walkWithAncestors(node, ancestors, visitor) {
  const nextAncestors = [...ancestors, node];
  visitor(node, nextAncestors);

  for (const child of node.children) {
    walkWithAncestors(child, nextAncestors, visitor);
  }
}

function mergeTypographyTokens(tokenLists) {
  const scalar = new Map();
  const flags = [];

  for (const tokens of tokenLists) {
    for (const token of tokens) {
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

  // "line 0" appears when Figma emits a leading-[0] class as a reset; it has no typographic meaning.
  return [...scalar.values(), ...flags].filter((token) => token !== "line 0");
}

function summarizeTextNotes(noteBlocks) {
  const lines = [];

  for (const block of noteBlocks) {
    if (!block.startsWith("These styles are contained in the design:")) {
      continue;
    }

    const raw = block.replace("These styles are contained in the design:", "").trim();
    const typography = parseTypographyNote(raw);
    if (typography) {
      lines.push(`- ${typography}`);
    } else {
      lines.push(`- typography note: ${raw}`);
    }
  }

  return lines;
}

function parseTypographyNote(note) {
  const match = note.match(/^([^:]+):\s*Font\(family:\s*"([^"]+)",\s*style:\s*([^,]+),\s*size:\s*([^,]+),\s*weight:\s*([^,]+),\s*lineHeight:\s*([^,]+),\s*letterSpacing:\s*([^)]+)\)\.?$/u);
  if (!match) {
    return null;
  }

  return `${match[1].trim()}: ${match[2]} ${match[3].trim()}, size ${match[4].trim()}, weight ${match[5].trim()}, line ${match[6].trim()}, letter-spacing ${match[7].trim()}`;
}

function summarizeAssets(rootNode, componentMap) {
  const items = [];

  for (const node of flattenNodes(rootNode)) {
    if (node.assetUrl) {
      items.push({
        groupKey: `asset|${node.srcRef}|${node.assetUrl}|${node.className ?? ""}`,
        label: `- \`${node.srcRef}\``,
        detail: `${compressAssetUrl(node.assetUrl)}${node.className ? `; ${summarizeStyleParts(node.style).join(", ")}` : ""}`,
      });
      continue;
    }

    if (node.componentMeta?.assetRefs?.length > 0) {
      const refs = node.componentMeta.assetRefs.map((asset) => `\`${asset.ref}\``).join(", ");
      const groupedUrl = node.componentMeta.assetRefs.map((asset) => compressAssetUrl(asset.url)).join(", ");
      items.push({
        groupKey: `component|${node.tag}|${refs}|${node.className ?? ""}`,
        label: `- ${formatNodeLabel(node)}`,
        detail: `uses ${refs}; ${groupedUrl}`,
      });
    }
  }

  const collapsed = collapseConsecutiveAssetItems(items);
  return collapsed.map((item) => `${item.label}${item.count > 1 ? ` x${item.count}` : ""} -> ${item.detail}`);
}

function collapseConsecutiveAssetItems(items) {
  const collapsed = [];

  for (const item of items) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.groupKey === item.groupKey) {
      previous.count += 1;
      continue;
    }

    collapsed.push({
      ...item,
      count: 1,
    });
  }

  return collapsed;
}

function summarizeAssetNotes(noteBlocks) {
  const lines = [];

  for (const block of noteBlocks) {
    if (block.startsWith("Image assets are stored on a localhost server.")) {
      lines.push("- Upstream image and SVG assets may be referenced through the local Figma asset server.");
    }
  }

  return lines;
}

function summarizeNotes(noteBlocks, metadataNotes) {
  const lines = [];

  for (const block of [...metadataNotes, ...noteBlocks]) {
    if (looksLikeCode(block) || block.startsWith("These styles are contained in the design:")) {
      continue;
    }

    if (block.startsWith("SUPER CRITICAL:")) {
      lines.push("- Convert upstream React/Tailwind semantics to the target framework and styling system.");
      for (const line of block.split("\n").slice(1)) {
        const cleaned = line.replace(/^\d+\.\s*/u, "").trim();
        if (cleaned) {
          lines.push(`- ${cleaned}`);
        }
      }
      continue;
    }

    if (block.startsWith("Node ids have been added to the code as data attributes")) {
      lines.push("- Upstream node ids are available for traceability.");
      continue;
    }

    if (block.startsWith("Image assets are stored on a localhost server.")) {
      lines.push("- Asset URLs from Figma can be used for inspection or extraction when needed.");
      continue;
    }

    if (block.startsWith("IMPORTANT: After you call this tool, you MUST call get_screenshot")) {
      lines.push("- Screenshot retrieval is recommended when visual confirmation is needed.");
      continue;
    }

    lines.push(`- ${collapseWhitespace(block)}`);
  }

  return dedupe(lines);
}

function flattenNodes(rootNode) {
  const nodes = [];

  walk(rootNode, (node) => {
    nodes.push(node);
  });

  return nodes;
}

function walk(node, visitor) {
  visitor(node);
  for (const child of node.children) {
    walk(child, visitor);
  }
}

function collectAssetRefs(rootNode) {
  const refs = [];

  walk(rootNode, (node) => {
    if (node.srcRef && node.assetUrl) {
      refs.push({
        ref: node.srcRef,
        url: node.assetUrl,
      });
    }
  });

  return dedupeBy(refs, (item) => `${item.ref}|${item.url}`);
}

function formatNodeLabel(node) {
  if (node.dataName) {
    return `\`${node.dataName}\``;
  }

  if (node.componentMeta?.displayName) {
    return `\`${node.componentMeta.displayName}\``;
  }

  return `\`${node.tag}\``;
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

function collapseWhitespace(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function pushUnique(list, value) {
  if (!list.includes(value)) {
    list.push(value);
  }
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

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// Two-signal heuristic: a block must look like a JS/TS module AND contain JSX-specific markers.
// This prevents misclassifying prose notes that happen to start with "type" or "const".
function looksLikeCode(text) {
  return /(?:^|\n)(?:import |export |const |let |var |function |type |interface )/u.test(text) &&
    /(?:className=|return\s*\(|return\s+|<\w|=>\s*\(|src=)/u.test(text);
}
