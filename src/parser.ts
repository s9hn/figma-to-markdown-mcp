import { z } from "zod";

export interface FigmaNode {
  id?: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  // Text
  characters?: string;
  style?: {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    textAlignHorizontal?: string;
  };
  // Layout
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  // Size
  absoluteBoundingBox?: { width: number; height: number };
  // Fill/Color
  fills?: Array<{
    type: string;
    color?: { r: number; g: number; b: number; a?: number };
  }>;
  cornerRadius?: number;
  opacity?: number;
}

const FigmaColorSchema = z
  .object({
    r: z.number(),
    g: z.number(),
    b: z.number(),
    a: z.number().optional(),
  })
  .passthrough();

const FigmaFillSchema = z
  .object({
    type: z.string(),
    color: FigmaColorSchema.optional(),
  })
  .passthrough();

const FigmaStyleSchema = z
  .object({
    fontSize: z.number().optional(),
    fontFamily: z.string().optional(),
    fontWeight: z.number().optional(),
    textAlignHorizontal: z.string().optional(),
  })
  .passthrough();

const FigmaNodeSchema: z.ZodType<FigmaNode> = z.lazy(() =>
  z
    .object({
      id: z.string().optional(),
      name: z.string(),
      type: z.string(),
      visible: z.boolean().optional(),
      children: z.array(FigmaNodeSchema).optional(),
      characters: z.string().optional(),
      style: FigmaStyleSchema.optional(),
      layoutMode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]).optional(),
      paddingLeft: z.number().optional(),
      paddingRight: z.number().optional(),
      paddingTop: z.number().optional(),
      paddingBottom: z.number().optional(),
      itemSpacing: z.number().optional(),
      absoluteBoundingBox: z
        .object({
          width: z.number(),
          height: z.number(),
        })
        .passthrough()
        .optional(),
      fills: z.array(FigmaFillSchema).optional(),
      cornerRadius: z.number().optional(),
      opacity: z.number().optional(),
    })
    .passthrough()
);

const CONTAINER_TYPES = new Set([
  "FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "GROUP", "SECTION",
]);

function normalizeInlineText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"');
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function extractFill(fills: FigmaNode["fills"]): string | null {
  const fill = fills?.[0];
  if (fill?.type === "SOLID" && fill.color) {
    return rgbToHex(fill.color.r, fill.color.g, fill.color.b);
  }
  return null;
}

function containerProps(node: FigmaNode): string {
  const p: string[] = [];
  if (node.layoutMode && node.layoutMode !== "NONE") {
    p.push(`layout: ${node.layoutMode.toLowerCase()}`);
  }
  if (node.itemSpacing !== undefined) p.push(`gap: ${node.itemSpacing}`);
  const pad = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft];
  if (pad.some((v) => v !== undefined)) p.push(`padding: ${pad.map((v) => v ?? 0).join(" ")}`);
  if (node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    p.push(`size: ${Math.round(width)}x${Math.round(height)}`);
  }
  const bg = extractFill(node.fills);
  if (bg) p.push(`bg: ${bg}`);
  if (node.cornerRadius !== undefined) p.push(`radius: ${node.cornerRadius}`);
  if (node.opacity !== undefined) p.push(`opacity: ${node.opacity}`);
  return p.join(", ");
}

function textProps(node: FigmaNode): string {
  const p: string[] = [];
  if (node.style?.fontSize !== undefined) p.push(`size: ${node.style.fontSize}`);
  if (node.style?.fontWeight !== undefined) p.push(`weight: ${node.style.fontWeight}`);
  const color = extractFill(node.fills);
  if (color) p.push(`color: ${color}`);
  return p.join(", ");
}

export function parseFigmaNode(input: unknown): FigmaNode {
  return FigmaNodeSchema.parse(input);
}

export function figmaToMarkdown(
  node: FigmaNode,
  maxDepth = 5,
  depth = 0
): string {
  if (node.visible === false) return "";

  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  if (CONTAINER_TYPES.has(node.type)) {
    const level = Math.min(depth + 1, 6);
    const h = "#".repeat(level);
    const props = containerProps(node);
    const name = normalizeInlineText(node.name);
    lines.push(`${h} ${name} (${node.type})${props ? ` [${props}]` : ""}`);

    if (node.children?.length) {
      if (depth < maxDepth) {
        for (const child of node.children) {
          const md = figmaToMarkdown(child, maxDepth, depth + 1);
          if (md) lines.push(md);
        }
      } else {
        lines.push(`${indent}  ... (${node.children.length} children truncated)`);
      }
    }
  } else if (node.type === "TEXT") {
    const chars = normalizeInlineText(node.characters ?? "");
    const preview = chars.length > 80 ? chars.slice(0, 80) + "…" : chars;
    const props = textProps(node);
    lines.push(`${indent}- Text: "${preview}"${props ? ` [${props}]` : ""}`);
  } else {
    const props = containerProps(node);
    const name = normalizeInlineText(node.name);
    lines.push(`${indent}- ${name} (${node.type})${props ? ` [${props}]` : ""}`);
  }

  return lines.filter(Boolean).join("\n");
}
