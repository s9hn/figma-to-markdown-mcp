# figma-to-markdown-mcp

Current version: `1.1.1`

`figma-to-markdown-mcp` is an MCP bridge that fetches Figma MCP context internally and returns compacted Markdown to the calling agent.

The product goal is simple: when a developer pastes a Figma node URL into an agent prompt, the agent should consume the reduced Markdown from this server, not the raw upstream Figma payload.

## Why This Exists

Figma MCP responses can be large enough to consume substantial model context. This server sits between the agent and Figma MCP, fetches the node context internally, compacts it, and only then returns the reduced output.

This means:

- raw upstream Figma MCP output stays inside this server process
- the calling agent only spends tokens on the final compacted result
- users can keep a simple workflow: install one MCP server and paste Figma links naturally

## Architecture

```text
User prompt with Figma link
  -> Agent calls get_figma_as_markdown
  -> figma-to-markdown-mcp connects to local Figma MCP
  -> get_design_context / get_metadata
  -> internal compaction
  -> compacted Markdown returned to the agent
  -> agent implements from the reduced result
```

## Upstream Requirement

URL-based fetching uses the local Figma desktop MCP server.

- Default upstream endpoint: `http://127.0.0.1:3845/mcp`
- Override with env var: `FIGMA_MCP_URL`
- In Figma Desktop, enable Dev Mode and turn on the desktop MCP server

## Install

```bash
npm install -g figma-to-markdown-mcp
```

## Tools

### `get_figma_as_markdown`

Use this first when the user provides a Figma node URL and asks to implement, inspect, or summarize that design.

Parameters:

- `figma_url`: full Figma node URL, for example `https://www.figma.com/design/qWVshatQ9eqoIn4fdEZqWy/SDG?node-id=25481-16119&m=dev`
- `max_output_chars`: optional output budget for compacted design context, default `16000`
- `include_metadata`: optional compacted `get_metadata` outline, default `true`

Behavior:

- accepts full Figma URLs, including prompt forms like `@https://...`
- connects to local Figma MCP internally
- calls `get_design_context` and optionally `get_metadata`
- compacts upstream output before returning it
- returns Markdown only, not the raw upstream MCP payload
- if bridge fetch or compaction fails, returns a fallback handoff that tells the agent to continue with the standard Figma MCP directly

### `figma_to_markdown`

Legacy raw-payload tool.

Parameters:

- `figma_json`: raw Figma node JSON string
- `max_depth`: optional traversal depth, default `5`

Use this only when raw Figma JSON is already available and URL-based internal fetching is not needed.

## Agent Guidance

If your agent supports repo instructions, add rules equivalent to:

1. If a prompt contains a Figma node URL, call `get_figma_as_markdown` before any direct Figma MCP tool.
2. If `get_figma_as_markdown` returns a bridge fallback handoff, continue with the standard Figma MCP tools for the same node.
3. Do not call upstream Figma MCP `get_design_context` directly unless the user explicitly asks for raw output, the bridge returned fallback, or you are debugging the bridge.
4. Implement from the compacted Markdown returned by this server whenever the bridge succeeds.

This repository also encodes that routing intent in:

- server initialization instructions
- `get_figma_as_markdown` tool description
- [AGENTS.md](./AGENTS.md)

## Verified Link Example

The local bridge was verified against this live desktop-MCP link:

`https://www.figma.com/design/qWVshatQ9eqoIn4fdEZqWy/SDG?node-id=25481-16119&m=dev`

The bridge successfully connected to local Figma MCP, fetched the node, and returned compacted Markdown for `basic navi`.

## Project Structure

```text
src/
  index.ts          MCP server entry and tool registration
  figma-mcp.ts      Internal MCP client bridge to local Figma MCP
  mcp-compactor.ts  Compaction for Figma MCP text / metadata output
  parser.ts         Raw figma_json -> Markdown conversion
dist/               Compiled output
```

## Development

```bash
npm install
npm run build
npm run dev
```

## Deployment

- `npm run build` generates `dist/`
- `prepublishOnly` runs the build before publish
- publish artifact is driven by `package.json#files`

Recommended release sync:

1. Update source under `src/`
2. Update `README.md`, `AGENTS.md`, and `CHANGELOG.md`
3. Run `npm run build`
4. Publish the package

## Limitation

This server can strongly guide agents to prefer `get_figma_as_markdown`, but final tool selection still depends on the MCP host or agent. It cannot forcibly override host-side tool routing by itself.

When the bridge itself cannot safely fetch or compact a node, it returns a compact fallback handoff instead of leaking raw upstream payload through this server response.

## Release Notes

See [CHANGELOG.md](./CHANGELOG.md).
