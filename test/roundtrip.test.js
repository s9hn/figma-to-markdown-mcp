import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { parseFigmaUrl } from "../src/url.js";

test("parseFigmaUrl extracts fileKey and nodeId from standard design URL", () => {
  const result = parseFigmaUrl(
    "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=25481-16139&m=dev"
  );

  assert.equal(result.fileKey, "ExampleFileKey123");
  assert.equal(result.nodeId, "25481:16139");
});

test("parseFigmaUrl uses branchKey for branch URLs", () => {
  const result = parseFigmaUrl(
    "https://www.figma.com/design/MAINKEY/Name/branch/BRANCHKEY/BranchName?node-id=1-2"
  );

  assert.equal(result.fileKey, "BRANCHKEY");
  assert.equal(result.nodeId, "1:2");
});

/**
 * Spawns the MCP server process with optional environment overrides.
 * Returns send/readMessage helpers and the child process itself.
 * Callers are responsible for calling child.stdin.end() and child.kill() when done.
 */
function spawnMcpServer(envOverrides = {}) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, ...envOverrides },
  });

  const send = (payload) => {
    const json = JSON.stringify(payload);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
  };

  const readMessage = async () => {
    let buffer = Buffer.alloc(0);

    while (true) {
      const separatorIndex = buffer.indexOf("\r\n\r\n");
      if (separatorIndex !== -1) {
        const headerBlock = buffer.slice(0, separatorIndex).toString("utf8");
        const match = headerBlock.match(/Content-Length:\s*(\d+)/iu);

        if (!match) {
          throw new Error("Missing Content-Length header in server response.");
        }

        const contentLength = Number.parseInt(match[1], 10);
        const messageStart = separatorIndex + 4;
        const messageEnd = messageStart + contentLength;

        if (buffer.length >= messageEnd) {
          const raw = buffer.slice(messageStart, messageEnd).toString("utf8");
          buffer = buffer.slice(messageEnd);
          return JSON.parse(raw);
        }
      }

      const chunk = await new Promise((resolve, reject) => {
        child.stdout.once("data", resolve);
        child.once("error", reject);
        child.once("exit", (code) => {
          reject(new Error(`Server exited before responding. Code: ${code}`));
        });
      });

      buffer = Buffer.concat([buffer, chunk]);
    }
  };

  return { child, send, readMessage };
}

async function initializeMcpServer(send, readMessage) {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    },
  });

  const response = await readMessage();

  send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });

  return response;
}

const MOCK_DESIGN_CONTEXT_RESPONSE = JSON.stringify({
  contentBlocks: [
    [
      "const imgIcons = \"http://localhost:3845/assets/icons.svg\";",
      "",
      "export default function BasicNavi() {",
      "  return <div className=\"bg-[#f6f6f6]\">Label</div>;",
      "}",
    ].join("\n"),
    "Node ids have been added to the code as data attributes, e.g. `data-node-id=\"1:2\"`.",
    "These styles are contained in the design: Navi Title: Font(family: \"Pretendard\", style: Regular, size: 19, weight: 400, lineHeight: 24, letterSpacing: 0).",
  ],
  metadataBlocks: [
    "<node id=\"25481:16119\" name=\"basic navi\" type=\"INSTANCE\" width=\"375\" height=\"48\" />",
  ],
  supplementTools: ["get_metadata"],
});

test("MCP server responds to initialize, tools/list and get_design_context_compact", async () => {
  const { child, send, readMessage } = spawnMcpServer({
    FIGMA_MCP_MOCK_RESPONSE: MOCK_DESIGN_CONTEXT_RESPONSE,
  });

  const initializeResponse = await initializeMcpServer(send, readMessage);
  assert.equal(initializeResponse.result.serverInfo.name, "figma-to-markdown");

  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  const toolsResponse = await readMessage();
  assert.equal(toolsResponse.result.tools.length, 1);
  assert.equal(toolsResponse.result.tools[0].name, "get_design_context_compact");

  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "get_design_context_compact",
      arguments: {
        figma_url: "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=25481-16119&m=dev",
      },
    },
  });

  const response = await readMessage();
  const text = response.result.content[0].text;

  assert.ok(!response.result.isError, `Expected success but got error: ${text}`);
  assert.match(text, /^# Figma Design Context/mu);
  assert.match(text, /## Compact Element Spec/u);
  assert.match(text, /## Text Spec/u);
  assert.match(text, /## Preserved Notes/u);
  assert.match(text, /Pretendard/u);
  assert.doesNotMatch(text, /export default function BasicNavi/u);

  child.stdin.end();
  child.kill();
});

test("get_design_context_compact returns upstream failure when Figma MCP is unavailable", async () => {
  const { child, send, readMessage } = spawnMcpServer({
    FIGMA_MCP_PORT: "1",
    FIGMA_MCP_MOCK_RESPONSE: "",
  });

  await initializeMcpServer(send, readMessage);

  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_design_context_compact",
      arguments: {
        figma_url: "https://www.figma.com/design/abc123/Name?node-id=1-2",
      },
    },
  });

  const response = await readMessage();
  assert.equal(response.result.isError, true);
  assert.match(
    response.result.content[0].text,
    /Figma Desktop app is not running|connect ECONNREFUSED|connect EACCES|connect EPERM/u
  );

  child.stdin.end();
  child.kill();
});

test("get_design_context_compact falls back to raw upstream content when compaction fails", async () => {
  const { child, send, readMessage } = spawnMcpServer({
    FIGMA_MCP_MOCK_RESPONSE: MOCK_DESIGN_CONTEXT_RESPONSE,
    FIGMA_MCP_MOCK_COMPACT_ERROR: "simulated compaction error",
  });

  await initializeMcpServer(send, readMessage);

  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_design_context_compact",
      arguments: {
        figma_url: "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=25481-16119&m=dev",
      },
    },
  });

  const response = await readMessage();
  const text = response.result.content[0].text;

  // Not a hard error — agent still receives usable data
  assert.ok(!response.result.isError, `Expected soft fallback but got hard error: ${text}`);
  // Error message is communicated to the agent
  assert.match(text, /simulated compaction error/u);
  assert.match(text, /Returning raw upstream Figma MCP output as fallback/u);
  // Raw upstream data is present so the agent can still implement the design
  assert.match(text, /BasicNavi/u);

  child.stdin.end();
  child.kill();
});

test("get_design_context_compact returns a normalized active-tab guidance message for missing nodes", async () => {
  const { child, send, readMessage } = spawnMcpServer({
    FIGMA_MCP_MOCK_ERROR:
      "No node could be found for the provided nodeId: 25481:16119. Make sure the Figma desktop app is open and the document containing the node is the active tab.",
  });

  await initializeMcpServer(send, readMessage);

  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_design_context_compact",
      arguments: {
        figma_url: "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=25481-16119&m=dev",
      },
    },
  });

  const response = await readMessage();
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /could not resolve node `25481:16119`/u);
  assert.match(response.result.content[0].text, /document containing this node is the active tab/u);

  child.stdin.end();
  child.kill();
});
