import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getFigmaCompactContext,
  type GetFigmaCompactContextOptions,
  type GetFigmaCompactContextResult,
} from "./figma-mcp.js";
import { buildCompactToolSuccessResponse } from "./tool-response.js";

export type GetFigmaCompactContextHandler = (
  options: GetFigmaCompactContextOptions
) => Promise<GetFigmaCompactContextResult>;

export function createFigmaCompactionServer(
  getFigmaCompact: GetFigmaCompactContextHandler = getFigmaCompactContext
) {
  const server = new McpServer({
    name: "figma-compaction",
    version: "3.0.0",
  }, {
    instructions:
      "When a user provides a Figma node URL or asks to implement, inspect, or summarize a Figma design, call get_figma_compact_context first. Treat compact plain-text context as the primary contract. If the bridge returns a fallback handoff, immediately continue with the standard Figma MCP tools for the same node. Do not call upstream Figma MCP get_design_context directly unless the user explicitly asks for the raw Figma MCP output, the bridge returned a fallback handoff, or you are debugging this server.",
  });

  server.tool(
    "get_figma_compact_context",
    "Use this first when a user provides a Figma node URL or asks to implement a Figma component. This tool fetches design context from a local Figma MCP server, prunes it inside this server, and returns compact plain-text context instead of raw upstream payloads. If the bridge cannot safely compact the node, it returns a fallback handoff telling the agent to continue with the standard Figma MCP directly.",
    {
      figma_url: z
        .string()
        .describe("Full Figma node URL, for example https://www.figma.com/design/...?...&node-id=4-5734"),
      mode: z
        .enum(["minimal", "balanced", "debug"])
        .optional()
        .default("balanced")
        .describe("Compaction mode. `balanced` is recommended for normal implementation work."),
      task: z
        .enum(["implement", "inspect", "summarize"])
        .optional()
        .default("implement")
        .describe("Intent hint used to tune pruning rules."),
      include_assets: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include compact asset references when preserved nodes use them."),
      include_text_specs: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include visible text lines and typography tokens."),
      include_trace_ids: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include Figma node ids in compact output for traceability."),
      max_output_chars: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional maximum number of chars to keep from compacted design context."),
      include_metadata: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include metadata-derived node summary when upstream get_metadata is available."),
    },
    async ({
      figma_url,
      mode,
      task,
      include_assets,
      include_text_specs,
      include_trace_ids,
      max_output_chars,
      include_metadata,
    }) => {
      try {
        const result = await getFigmaCompact({
          figmaUrl: figma_url,
          mode,
          task,
          includeAssets: include_assets,
          includeTextSpecs: include_text_specs,
          includeTraceIds: include_trace_ids,
          maxOutputChars: max_output_chars,
          includeMetadata: include_metadata,
        });

        return buildCompactToolSuccessResponse(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Figma MCP bridge error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
