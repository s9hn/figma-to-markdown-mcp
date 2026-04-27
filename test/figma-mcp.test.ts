import assert from "node:assert/strict";
import test from "node:test";
import { getFigmaLinkAsMarkdown } from "../src/figma-mcp.ts";

interface FakeConnectionOptions {
  designText: string;
  metadataText?: string;
  failMetadata?: string;
}

function createFakeConnection(options: FakeConnectionOptions) {
  return {
    client: {
      async listTools() {
        return {
          tools: [
            { name: "get_design_context", inputSchema: { properties: { nodeId: {} } } },
            { name: "get_metadata", inputSchema: { properties: { nodeId: {} } } },
          ],
        };
      },
      async callTool(params: { name: string }) {
        if (params.name === "get_design_context") {
          return {
            content: [{ type: "text", text: options.designText }],
          };
        }

        if (params.name === "get_metadata") {
          if (options.failMetadata) {
            throw new Error(options.failMetadata);
          }

          return {
            content: [{ type: "text", text: options.metadataText ?? "" }],
          };
        }

        throw new Error(`Unexpected tool: ${params.name}`);
      },
      async close() {
        return undefined;
      },
    },
    transport: {},
  };
}

test("getFigmaLinkAsMarkdown compacts upstream design context without leaking verbose attributes", async () => {
  const result = await getFigmaLinkAsMarkdown({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-2",
    runtime: {
      connectFigmaClient: async () =>
        createFakeConnection({
          designText: [
            "```tsx",
            'const imgHero = "http://localhost:3845/assets/hero.png";',
            '<div data-node-id="1:2" data-testid="hero" data-name="Hero" className={className || "flex gap-2"} style={{}}>',
            "  Hello",
            "</div>",
            "```",
          ].join("\n"),
          metadataText: '<FRAME name="Hero" id="1:2" width="100" height="48"><TEXT name="Label" id="1:3" width="40" height="20" /></FRAME>',
        }),
    },
  });

  assert.equal(result.fallback, undefined);
  assert.match(result.markdown, /# Figma Context/);
  assert.match(result.markdown, /## Design Context/);
  assert.match(result.markdown, /asset imgHero: \/assets\/hero\.png/);
  assert.doesNotMatch(result.markdown, /http:\/\/localhost:3845/);
  assert.doesNotMatch(result.markdown, /data-node-id=/);
  assert.doesNotMatch(result.markdown, /data-testid=/);
  assert.doesNotMatch(result.markdown, /style=\{\{\}\}/);
});

test("getFigmaLinkAsMarkdown keeps design-context success when metadata fetch fails", async () => {
  const result = await getFigmaLinkAsMarkdown({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-2",
    runtime: {
      connectFigmaClient: async () =>
        createFakeConnection({
          designText: "<div>Hello</div>",
          failMetadata: "metadata unavailable",
        }),
    },
  });

  assert.equal(result.fallback, undefined);
  assert.match(result.markdown, /## Design Context/);
  assert.match(result.markdown, /## Notes/);
  assert.match(
    result.markdown,
    /Upstream `get_metadata` failed and was omitted: Figma MCP tool "get_metadata" failed: metadata unavailable/
  );
});

test("getFigmaLinkAsMarkdown returns upstream handoff fallback when bridge fetch fails", async () => {
  const result = await getFigmaLinkAsMarkdown({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-2",
    runtime: {
      connectFigmaClient: async () => {
        throw new Error("mock bridge connection failure");
      },
    },
  });

  assert.equal(result.fallback?.required, true);
  assert.match(result.markdown, /# Figma Bridge Fallback/);
  assert.match(result.markdown, /get_design_context/);
  assert.match(result.markdown, /mock bridge connection failure/);
  assert.deepEqual(result.fallback?.nodeIdVariants, ["1-2", "1:2"]);
});

test("getFigmaLinkAsMarkdown retries alternate node-id variants when upstream returns tool-level errors", async () => {
  const attemptedNodeIds: string[] = [];
  const result = await getFigmaLinkAsMarkdown({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-2",
    runtime: {
      connectFigmaClient: async () => ({
        client: {
          async listTools() {
            return {
              tools: [
                { name: "get_design_context", inputSchema: { properties: { nodeId: {} } } },
              ],
            };
          },
          async callTool(params: { name: string; arguments?: Record<string, unknown> }) {
            const nodeId = String(params.arguments?.nodeId ?? "");
            attemptedNodeIds.push(nodeId);
            if (nodeId === "1-2") {
              return {
                content: [{ type: "text", text: "No node could be found for the provided nodeId: 1:2" }],
                isError: true,
              };
            }

            return {
              content: [{ type: "text", text: "<div>Recovered via alternate node id</div>" }],
            };
          },
          async close() {
            return undefined;
          },
        },
        transport: {},
      }),
    },
  });

  assert.equal(result.fallback, undefined);
  assert.deepEqual(attemptedNodeIds, ["1-2", "1:2"]);
  assert.match(result.markdown, /Recovered via alternate node id/);
});

test("getFigmaLinkAsMarkdown returns upstream handoff fallback when design compaction fails", async () => {
  const result = await getFigmaLinkAsMarkdown({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-2",
    runtime: {
      connectFigmaClient: async () =>
        createFakeConnection({
          designText: "<div>Hello</div>",
        }),
      compactDesignContext: () => {
        throw new Error("design compactor boom");
      },
    },
  });

  assert.equal(result.fallback?.required, true);
  assert.match(result.markdown, /Compaction failed inside the bridge: design compactor boom/);
  assert.match(result.markdown, /standard Figma MCP directly/);
});
