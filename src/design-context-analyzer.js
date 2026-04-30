// HTML void elements — self-closing by spec, no closing tag in JSX output from Figma MCP.
const VOID_TAGS = new Set(["img", "input", "br", "hr", "meta", "link"]);

export function analyzeDesignContext({ contentBlocks, metadataBlocks }) {
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
    rootNode,
    noteBlocks,
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
    .map((v) => stripOuterCodeFence(v).trim())
    .filter((v) => v.length > 0);
}

function stripOuterCodeFence(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```[A-Za-z0-9_-]*\n([\s\S]*?)\n```$/u);
  return match ? match[1] : value;
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
  const match = block.trim().match(/^<([a-z_]+)\s+([^>]+?)\/?>/iu);
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
    const jsx = extractDefaultReturnJsx(block) ?? extractStandaloneJsxBlock(block);
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

function extractStandaloneJsxBlock(block) {
  const startIndex = block.search(/<[A-Za-z][A-Za-z0-9_:-]*(?:\s|>|\/>)/u);
  if (startIndex === -1) {
    return null;
  }

  return block.slice(startIndex).trim();
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
  const pattern = /<\/?([A-Za-z][A-Za-z0-9_]*)\b((?:"[^"]*"|'[^']*'|\{[^{}]*\}|[^"'{}>])*)>/gs;
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
      if (looksLikeColorValue(value)) {
        pushUnique(summary.typography, `color ${describeBracketValue(value.startsWith("color:") ? value.slice(6) : value)}`);
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

function looksLikeColorValue(value) {
  if (value.startsWith("color:")) {
    return true;
  }

  return /^(?:#|rgb\(|rgba\(|hsl\(|hsla\(|var\(|oklch\(|oklab\(|currentColor$)/iu.test(value);
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
  const moduleLikeCode =
    /(?:^|\n)(?:import |export |const |let |var |function |type |interface )/u.test(text) &&
    /(?:className=|return\s*\(|return\s+|<\w|=>\s*\(|src=)/u.test(text);
  const jsxOnlyBlock = /^\s*<[A-Za-z][A-Za-z0-9_:-]*(?:\s|>|\/>)/u.test(text);
  return moduleLikeCode || jsxOnlyBlock;
}
