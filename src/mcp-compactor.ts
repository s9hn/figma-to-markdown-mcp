export interface CompactedSection {
  text: string;
  truncated: boolean;
}

function normalizeTextBlock(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripOuterCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```[A-Za-z0-9_-]*\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : trimmed;
}

function compactReactLikeDesignContext(value: string): string {
  return value
    .replace(/https?:\/\/localhost:\d+/g, "")
    .replace(/\sdata-node-id="[^"]*"/g, "")
    .replace(/\sdata-name="[^"]*"/g, "")
    .replace(/\sdata-testid="[^"]*"/g, "")
    .replace(/\sdata-figma-name="[^"]*"/g, "")
    .replace(/\salt=""/g, "")
    .replace(/\sstyle=\{\{\}\}/g, "")
    .replace(/\sclassName=""/g, "")
    .replace(
      /className=\{className \|\| "([^"]+)"\}/g,
      'className="$1"'
    )
    .replace(
      /\(\{\s*className\s*\}:\s*\{\s*className\?:\s*string;\s*\}\s*\)/g,
      "({ className })"
    )
    .replace(/const (img[A-Za-z0-9_]+) = "([^"]+)";/g, (_match, name, path) => {
      const shortened = String(path).replace(/^https?:\/\/localhost:\d+/, "");
      return `asset ${name}: ${shortened}`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateAtBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;

  const candidate = value.slice(0, maxChars);
  const paragraphBoundary = candidate.lastIndexOf("\n\n");
  const lineBoundary = candidate.lastIndexOf("\n");

  if (paragraphBoundary >= Math.floor(maxChars * 0.6)) {
    return candidate.slice(0, paragraphBoundary).trimEnd();
  }

  if (lineBoundary >= Math.floor(maxChars * 0.75)) {
    return candidate.slice(0, lineBoundary).trimEnd();
  }

  return candidate.trimEnd();
}

function extractXmlAttr(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}="([^"]*)"`);
  const match = tag.match(pattern);
  return match?.[1];
}

export function compactDesignContext(
  source: string,
  maxChars = 16000
): CompactedSection {
  const normalized = normalizeTextBlock(
    compactReactLikeDesignContext(stripOuterCodeFence(source))
  );
  if (!normalized) {
    return { text: "", truncated: false };
  }

  const compacted = truncateAtBoundary(normalized, maxChars);
  return {
    text: compacted,
    truncated: compacted.length < normalized.length,
  };
}

export function compactMetadataOutline(
  xml: string,
  maxLines = 120
): CompactedSection {
  const normalized = normalizeTextBlock(xml).replace(/>\s*</g, ">\n<");
  if (!normalized) {
    return { text: "", truncated: false };
  }

  const tokens = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const lines: string[] = [];
  let depth = 0;
  let truncated = false;

  for (const token of tokens) {
    if (token.startsWith("<?") || token.startsWith("<!--")) {
      continue;
    }

    if (token.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      continue;
    }

    const match = token.match(/^<([A-Za-z0-9:_-]+)([^>]*)\/?>$/);
    if (!match) {
      continue;
    }

    const [, tagName, attrs] = match;
    const selfClosing = token.endsWith("/>");
    const name = extractXmlAttr(attrs, "name");
    const id = extractXmlAttr(attrs, "id");
    const type = extractXmlAttr(attrs, "type") ?? tagName;
    const width = extractXmlAttr(attrs, "width");
    const height = extractXmlAttr(attrs, "height");
    const x = extractXmlAttr(attrs, "x");
    const y = extractXmlAttr(attrs, "y");

    const details: string[] = [];
    if (id) details.push(`id: ${id}`);
    if (width && height) details.push(`size: ${width}x${height}`);
    if (x && y) details.push(`pos: ${x},${y}`);

    const label = name || id || type;
    lines.push(
      `${"  ".repeat(depth)}- ${label} (${type})${details.length ? ` [${details.join(", ")}]` : ""}`
    );

    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }

    if (!selfClosing) {
      depth += 1;
    }
  }

  if (truncated) {
    lines.push("- ... (additional metadata nodes truncated)");
  }

  return {
    text: lines.join("\n"),
    truncated,
  };
}

export function inferCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "text";
  if (/<[A-Z][A-Za-z0-9]*[\s>]/.test(trimmed) || /className=/.test(trimmed)) {
    return "tsx";
  }
  if (/^<[^>]+>/.test(trimmed)) {
    return "html";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }
  return "text";
}

export function formatReductionLabel(rawChars: number, outputChars: number): string {
  if (rawChars <= 0) {
    return `Output ${outputChars} chars`;
  }

  const reduction = Math.round((1 - outputChars / rawChars) * 100);
  if (reduction >= 0) {
    return `Reduced ~${reduction}% (${rawChars} → ${outputChars} chars)`;
  }

  return `Expanded ~${Math.abs(reduction)}% (${rawChars} → ${outputChars} chars)`;
}
