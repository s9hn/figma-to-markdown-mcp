import assert from "node:assert/strict";
import test from "node:test";
import { getFigmaCompactContext } from "../src/figma-mcp.ts";

interface FakeConnectionOptions {
  designText: string;
  metadataText?: string;
  metadataByNodeId?: Record<string, string>;
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
      async callTool(params: { name: string; arguments?: Record<string, unknown> }) {
        if (params.name === "get_design_context") {
          return {
            content: [{ type: "text", text: options.designText }],
          };
        }

        if (params.name === "get_metadata") {
          if (options.failMetadata) {
            throw new Error(options.failMetadata);
          }

          const nodeId = String(params.arguments?.nodeId ?? "");
          if (options.metadataByNodeId && nodeId in options.metadataByNodeId) {
            return {
              content: [{ type: "text", text: options.metadataByNodeId[nodeId] }],
            };
          }

          if (options.metadataByNodeId && !(nodeId in options.metadataByNodeId)) {
            return {
              content: [{ type: "text", text: `No node could be found for the provided nodeId: ${nodeId}` }],
            };
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

test("getFigmaCompactContext returns compact DSL without leaking verbose attributes", async () => {
  const result = await getFigmaCompactContext({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-2",
    runtime: {
      connectFigmaClient: async () =>
        createFakeConnection({
          designText: [
            "```tsx",
            'const imgAsset = "http://localhost:3845/assets/example-image.png";',
            "<div data-node-id=\"1:2\" data-testid=\"asset-card\" data-name=\"Example Card\" className=\"flex flex-col gap-[var(--spacing/spacing-8,8px)] bg-[var(--color/neutral/0,white)] rounded-[var(--radius/radius-20,20px)]\">",
            "  <p className=\"font-['Inter:SemiBold',sans-serif] text-[20px] leading-[24px] text-[color:var(--color/neutral/700,#333)]\">Title</p>",
            "</div>",
            "```",
          ].join("\n"),
          metadataText: '<FRAME name="Example Card" id="1:2" width="100" height="48" x="10" y="20"><TEXT name="Title" id="1:3" width="40" height="20" /></FRAME>',
        }),
    },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.format, "compact-context");
  assert.match(result.content, /^src\|figma\|get_design_context\|1-2\|FILE123/mu);
  assert.match(result.content, /sum\|Example Card\|frame\|100x48\|10,20/u);
  assert.match(result.content, /tx\|1:2\|Title\|t1/u);
  assert.match(result.content, /ty\|t1\|Inter\|600\|20\|24\|#333/u);
  assert.doesNotMatch(result.content, /http:\/\/localhost:3845/u);
  assert.doesNotMatch(result.content, /data-testid=/u);
  assert.doesNotMatch(result.content, /export default function/u);
});

test("getFigmaCompactContext preserves arbitrary text colors and ignores > inside data-name attributes", async () => {
  const result = await getFigmaCompactContext({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-1",
    runtime: {
      connectFigmaClient: async () =>
        createFakeConnection({
          designText: [
            "```tsx",
            "export default function ExampleFlow() {",
            "  return (",
            "    <div data-node-id=\"1:1\" data-name=\"Example Flow > Detail Step\" className=\"bg-[var(--color/neutral/0,white)]\">",
            "      <div data-node-id=\"1:2\" className=\"font-['Inter:SemiBold',sans-serif] text-[16px] text-[color:var(--color/neutral/700,#333)]\">",
            "        <p>",
            "          <span className=\"leading-[20px]\">Body</span>",
            "          <span className=\"leading-[20px] text-[#ff7979]\">*</span>",
            "        </p>",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            "```",
          ].join("\n"),
          metadataText: '<FRAME name="Example Flow" id="1:1" width="100" height="48" x="0" y="0"><TEXT name="Body" id="1:2" width="40" height="20" /></FRAME>',
        }),
    },
  });

  assert.equal(result.status, "ok");
  assert.doesNotMatch(result.content, /Detail Step">/u);

  const starTextLine = result.content.match(/tx\|1:2\|\*\|(t\d+)/u);
  assert.ok(starTextLine, "star text token should be present");
  assert.match(result.content, new RegExp(`ty\\|${starTextLine[1]}\\|Inter\\|600\\|16\\|20\\|#ff7979`, "u"));
});

test("getFigmaCompactContext drops chrome nodes for implement tasks but keeps them for inspect tasks", async () => {
  const runtime = {
    connectFigmaClient: async () =>
      createFakeConnection({
        designText: [
          "```tsx",
          "export default function ExampleScreen() {",
          "  return (",
          "    <div data-node-id=\"1:1\" data-name=\"Example Screen\" className=\"flex flex-col bg-[var(--color/neutral/0,white)]\">",
          "      <div data-node-id=\"1:2\" data-name=\"Header Bar\" className=\"flex h-[54px] items-center justify-center\">",
          "        <p className=\"font-['Inter:Regular',sans-serif] text-[12px] leading-[16px] text-[color:var(--color/neutral/700,#333)]\">9:41</p>",
          "      </div>",
          "      <div data-node-id=\"1:3\" data-name=\"Content Block\" className=\"flex flex-col gap-[var(--spacing/spacing-8,8px)] bg-[var(--color/neutral/0,white)] rounded-[var(--radius/radius-20,20px)]\">",
          "        <p className=\"font-['Inter:SemiBold',sans-serif] text-[16px] leading-[20px] text-[color:var(--color/neutral/700,#333)]\">Body</p>",
          "      </div>",
          "    </div>",
          "  );",
          "}",
          "```",
        ].join("\n"),
        metadataText: '<FRAME name="Example Screen" id="1:1" width="375" height="812" x="0" y="0"><FRAME name="Header Bar" id="1:2" width="375" height="54" /><FRAME name="Content Block" id="1:3" width="343" height="120" /></FRAME>',
      }),
  };

  const implementResult = await getFigmaCompactContext({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-1",
    task: "implement",
    runtime,
  });
  const inspectResult = await getFigmaCompactContext({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-1",
    task: "inspect",
    runtime,
  });

  assert.equal(implementResult.status, "ok");
  assert.equal(inspectResult.status, "ok");
  assert.doesNotMatch(implementResult.content, /status_bar|9:41/u);
  assert.match(implementResult.content, /tx\|1:3\|Body\|t1/u);
  assert.match(inspectResult.content, /status_bar|9:41/u);
  assert.match(inspectResult.content, /tx\|1:2\|9:41\|t1/u);
});

test("getFigmaCompactContext keeps implementation output when metadata fetch fails", async () => {
  const result = await getFigmaCompactContext({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-2",
    runtime: {
      connectFigmaClient: async () =>
        createFakeConnection({
          designText: "<div>Hello</div>",
          failMetadata: "metadata unavailable",
        }),
    },
  });

  assert.equal(result.status, "ok");
  assert.match(result.content, /tx\|-?\|Hello\|t1/u);
  assert.deepEqual(result.trace?.upstreamTools, ["get_design_context"]);
});

test("getFigmaCompactContext returns compact fallback when bridge fetch fails", async () => {
  const result = await getFigmaCompactContext({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-2",
    runtime: {
      connectFigmaClient: async () => {
        throw new Error("mock bridge connection failure");
      },
    },
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.fallback?.recommendedTool, "get_design_context");
  assert.match(result.content, /^src\|figma\|get_design_context\|1-2\|FILE123/mu);
  assert.match(result.content, /wa\|fallback\|mock bridge connection failure/u);
});

test("getFigmaCompactContext retries alternate node-id variants when upstream returns tool-level errors", async () => {
  const attemptedNodeIds: string[] = [];
  const result = await getFigmaCompactContext({
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

  assert.equal(result.status, "ok");
  assert.deepEqual(attemptedNodeIds, ["1-2", "1:2"]);
  assert.match(result.content, /Recovered via alternate node id/u);
});

test("getFigmaCompactContext truncates only when maxOutputChars is explicitly provided", async () => {
  const tailMarker = "TAIL_MARKER_SHOULD_BE_TRUNCATED";
  const longDesignText = `<div>${"B".repeat(500)}${tailMarker}</div>`;
  const result = await getFigmaCompactContext({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=1-2",
    maxOutputChars: 120,
    runtime: {
      connectFigmaClient: async () =>
        createFakeConnection({
          designText: longDesignText,
        }),
    },
  });

  assert.equal(result.status, "ok");
  assert.match(result.summary, /truncated/u);
  assert.match(result.warnings.join(","), /truncated/u);
  assert.doesNotMatch(result.content, new RegExp(tailMarker));
  assert.match(result.content, /wa\|truncated\|Output was truncated/u);
});

test("getFigmaCompactContext flags likely partial nodes from metadata diagnostics", async () => {
  const result = await getFigmaCompactContext({
    figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=4-4956",
    runtime: {
      connectFigmaClient: async () =>
        createFakeConnection({
          designText: [
            "export default function ExampleField() {",
            "  return (",
            "    <div className=\"flex flex-col p-[20px] relative size-full\" data-node-id=\"4:4956\">",
            "      <div className=\"font-['Inter:SemiBold',sans-serif] text-[20px] w-full\" data-node-id=\"4:4957\">",
            "        <p>Choice field</p>",
            "      </div>",
            "    </div>",
            "  );",
            "}",
          ].join("\n"),
          metadataText: [
            '<frame id="4:4956" name="Example Field Block" x="0" y="0" width="343" height="64">',
            '  <text id="4:4957" name="Choice field" x="20" y="20" width="303" height="24" />',
            "</frame>",
          ].join("\n"),
          metadataByNodeId: {
            "4:4956": [
              '<frame id="4:4956" name="Example Field Block" x="0" y="0" width="343" height="64">',
              '  <text id="4:4957" name="Choice field" x="20" y="20" width="303" height="24" />',
              "</frame>",
            ].join("\n"),
            "0:2": [
              '<canvas id="0:2" name="Canvas Root" x="0" y="0" width="0" height="0">',
              '  <frame id="4:4301" name="Example Screen Root" x="1249" y="1330" width="375" height="812">',
              '    <frame id="4:4303" name="scroll_region" x="0" y="68" width="375" height="886">',
              '      <frame id="4:4304" name="content_region" x="0" y="10" width="375" height="876">',
              '        <frame id="4:4306" name="Section Group A" x="16" y="38" width="343" height="738">',
              '          <frame id="4:4307" name="Section Group B" x="0" y="0" width="343" height="498">',
              '            <frame id="4:4956" name="Example Field Block" x="0" y="206" width="343" height="64">',
              '              <text id="4:4957" name="Choice field" x="20" y="20" width="303" height="24" />',
              "            </frame>",
              "          </frame>",
              "        </frame>",
              "      </frame>",
              "    </frame>",
              "  </frame>",
              "</canvas>",
            ].join("\n"),
          },
        }),
    },
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.warnings, ["partial_node"]);
  assert.match(result.summary, /343 x 64/u);
  assert.equal(result.nodeDiagnostics?.looksPartial, true);
  assert.equal(result.nodeDiagnostics?.directChildCount, 1);
  assert.equal(result.nodeDiagnostics?.textNodeCount, 1);
  assert.equal(result.nodeDiagnostics?.parentCandidatesUnavailableReason, undefined);
  assert.equal(result.nodeDiagnostics?.parentCandidates.length, 5);
  assert.equal(result.nodeDiagnostics?.parentCandidates[0]?.nodeId, "4:4307");
  assert.equal(result.nodeDiagnostics?.parentCandidates[4]?.nodeId, "4:4301");
});
