import { parseFigmaUrl } from "./url.js";

export function buildImplementationDelegationPrompt(options) {
  const figmaUrl = options?.figmaUrl;
  const targetPackage = options?.targetPackage;
  const componentName = options?.componentName?.trim();

  // parseFigmaUrl validates the URL, requires node-id, and normalizes "123-456" to "123:456"
  const { nodeId } = parseFigmaUrl(figmaUrl);

  if (typeof targetPackage !== "string" || targetPackage.trim() === "") {
    throw new Error("`targetPackage` must be a non-empty string.");
  }

  const lines = [
    "Implement the Figma design below in the target package.",
    "",
    "Task",
    `- Figma URL: ${figmaUrl}`,
    `- Node ID: ${nodeId}`,
    `- Target package: ${targetPackage.trim()}`,
  ];

  if (componentName) {
    lines.push(`- Component name: ${componentName}`);
  }

  lines.push(
    "",
    "Execution Rules",
    "- Read the node through `get_design_context_compact` before any raw Figma MCP design-context call.",
    "- Use the returned markdown document as the primary implementation context.",
    "- Only call raw Figma MCP tools when the compact markdown is missing a fact required for implementation.",
    "- Preserve layout, text, metadata, typography, assets, and node traceability while adapting to the target codebase.",
    "- Treat screenshots as visual reference only. Prefer the markdown document for layout, spacing, typography, color, visibility, and component metadata.",
    "- Do not invent assets, text, spacing, or dimensions.",
    "",
    "Deliverables",
    "- Implement the UI in the target package.",
    "- Add preview or example wiring if the repository pattern expects it.",
    "- Report which files changed and whether the upstream markdown required manual interpretation."
  );

  return lines.join("\n");
}
