#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getFigmaLinkAsMarkdown } from "./figma-mcp.js";

const server = new McpServer({
  name: "figma-to-markdown",
  version: "2.0.0",
}, {
  instructions:
    "When a user provides a Figma node URL or asks to implement a Figma design, call get_figma_as_markdown first. If that tool returns a bridge fallback handoff, immediately continue with the standard Figma MCP tools for the same node. Do not call upstream Figma MCP get_design_context directly unless the user explicitly asks for the raw Figma MCP output, the bridge returned a fallback handoff, or you are debugging this server.",
});

server.tool(
  "get_figma_as_markdown",
  "Use this first when a user provides a Figma node URL or asks to implement a Figma component. This tool fetches design context from a local Figma MCP server, compacts it inside this server, and returns only reduced Markdown instead of raw upstream Figma payloads. If the bridge cannot safely fetch or compact the node, it returns a fallback handoff telling the agent to continue with the standard Figma MCP directly.",
  {
    figma_url: z
      .string()
      .describe("Full Figma node URL, for example https://www.figma.com/design/...?...&node-id=4-5734"),
    max_output_chars: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional maximum number of chars to keep from compacted design context. Omit this to avoid forced truncation."),
    include_metadata: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include a compacted node outline from Figma MCP get_metadata (default: true)"),
  },
  async ({ figma_url, max_output_chars, include_metadata }) => {
    try {
      const result = await getFigmaLinkAsMarkdown({
        figmaUrl: figma_url,
        maxOutputChars: max_output_chars,
        includeMetadata: include_metadata,
      });

      return {
        content: [{ type: "text", text: result.markdown }],
        structuredContent: {
          source: result.source,
          rawChars: result.rawChars,
          outputChars: result.outputChars,
          fallback: result.fallback ?? null,
        },
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text", text: `Figma MCP bridge error: ${message}` }],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
