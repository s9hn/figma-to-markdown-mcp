import type { GetFigmaCompactContextResult } from "./figma-mcp.js";

export function buildCompactToolSuccessResponse(result: GetFigmaCompactContextResult) {
  return {
    content: [{ type: "text" as const, text: result.content }],
    structuredContent: {
      status: result.status,
      format: result.format,
      version: result.version,
      mode: result.mode,
      task: result.task,
      summary: result.summary,
      content: result.content,
      stats: result.stats,
      trace: result.trace ?? null,
      warnings: result.warnings,
      nodeDiagnostics: result.nodeDiagnostics ?? null,
      fallback: result.fallback ?? null,
    },
  };
}
