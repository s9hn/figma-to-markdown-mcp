import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFigmaCompactionServer } from "../src/server.ts";

test("get_figma_compact_context keeps compact content in structuredContent across an MCP round-trip", async () => {
  const server = createFigmaCompactionServer(
    async () => ({
      status: "ok",
      format: "compact-context",
      version: "1",
      mode: "balanced",
      task: "implement",
      summary: "Frame / 343 x 64",
      content: "src|figma|get_design_context|4:4956|FILE123\nsum|Frame|frame|343x64|0,0",
      stats: {
        rawChars: 2341,
        compactChars: 1120,
        reductionPct: 52.16,
      },
      trace: {
        figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=4-4956",
        fileKey: "FILE123",
        nodeId: "4-4956",
        upstreamTools: ["get_design_context", "get_metadata"],
      },
      warnings: [],
    })
  );
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({
      name: "get_figma_compact_context",
      arguments: {
        figma_url: "https://www.figma.com/design/FILE123/Example?node-id=4-4956",
      },
    });
    const payload = result as {
      content?: Array<{ text?: string }>;
      structuredContent?: {
        format?: string;
        content?: string;
        mode?: string;
      };
    };

    assert.equal(payload.content?.[0]?.text, "src|figma|get_design_context|4:4956|FILE123\nsum|Frame|frame|343x64|0,0");
    assert.equal(payload.structuredContent?.format, "compact-context");
    assert.equal(payload.structuredContent?.mode, "balanced");
    assert.match(payload.structuredContent?.content ?? "", /^src\|figma/u);
  } finally {
    await client.close();
    await server.close();
  }
});
