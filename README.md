# figma-to-markdown-mcp

Languages: [English](./README.md) | [한국어](./README.ko.md)

Current version: `2.0.0`

`figma-to-markdown-mcp` is an MCP server for Figma-link workflows. It fetches Figma design context internally, compacts it inside the server, and returns reduced Markdown to the calling agent instead of the full upstream payload.

## What It Is

This project is for teams that want agents to work from Figma node URLs without exposing the full upstream Figma MCP payload to the caller model whenever the bridge can safely handle the request.

The intended flow is simple:

1. A user gives an agent a Figma node URL.
2. The agent calls `get_figma_as_markdown`.
3. This server fetches Figma context internally.
4. The server compacts the upstream result.
5. The agent receives reduced Markdown and works from that output.

## Why Use It

The main reason to use this server is token reduction.

Raw Figma MCP responses can be large enough to consume a meaningful part of the caller model context before implementation even begins. This bridge keeps that upstream payload inside the server whenever possible, compacts it first, and only returns the reduced result to the agent.

- Lower token usage for Figma-link prompts
- Smaller model-context footprint before implementation starts
- Cleaner implementation input for agents
- Less raw upstream noise in caller context
- A built-in fallback path when the bridge cannot safely complete

## How It Works

This server sits between your agent and the local Figma Desktop MCP server.

```text
User prompt with Figma link
  -> Agent calls get_figma_as_markdown
  -> figma-to-markdown-mcp connects to local Figma Desktop MCP
  -> get_design_context / get_metadata
  -> internal compaction
  -> compacted Markdown returned to the agent
```

The public entrypoint is `get_figma_as_markdown`.

- `figma_url`: required full Figma node URL
- `include_metadata`: optional, default `true`
- `max_output_chars`: optional explicit output budget; if omitted, the bridge does not force truncation

When the bridge succeeds, it returns compacted Markdown. When the bridge cannot safely fetch or compact the node, it returns a fallback handoff so the agent can continue with standard Figma MCP tools directly.

Example URL shape:

`https://www.figma.com/design/FILE_KEY/FILE_NAME?node-id=NODE_ID&m=dev`

## Requirements

To use the Figma-link bridge flow, you need:

- Figma Desktop
- Dev Mode enabled in Figma Desktop
- Desktop MCP server enabled in Figma Desktop
- Node.js 18+

Default upstream Figma MCP endpoint:

`http://127.0.0.1:3845/mcp`

Override with:

`FIGMA_MCP_URL`

## Installation

Install globally:

```bash
npm install -g figma-to-markdown-mcp
```

Or run with `npx`:

```bash
npx figma-to-markdown-mcp
```

## MCP Client Registration

Register this server in your MCP client.

Example using `npx`:

```json
{
  "mcpServers": {
    "figma-to-markdown": {
      "command": "npx",
      "args": ["-y", "figma-to-markdown-mcp"]
    }
  }
}
```

Example using a global install:

```json
{
  "mcpServers": {
    "figma-to-markdown": {
      "command": "figma-to-markdown-mcp",
      "args": []
    }
  }
}
```

Your client may use JSON, TOML, or another config format, but the command registration model is the same.

## How To Use It

1. Open Figma Desktop and enable Dev Mode and the desktop MCP server.
2. Register `figma-to-markdown-mcp` in your MCP client.
3. Give your agent a Figma node URL.
4. Have the agent call `get_figma_as_markdown` first.
5. Use the returned compacted Markdown for implementation, inspection, or summarization.
6. If the server returns a fallback handoff, continue with the standard Figma MCP tools for the same node.

In practice:

- Small and medium components usually return compacted Markdown directly.
- Large screens can still return larger output when needed.
- Only set `max_output_chars` when you intentionally want a hard output budget.

## Limitations

- Final tool routing still depends on the MCP host or agent. This server can strongly guide usage, but it cannot forcibly override host-side routing.
- When the bridge cannot safely complete a request, it returns a compact fallback handoff instead of passing raw upstream payloads through this server response.

## Other Information

- Release history: [CHANGELOG.md](./CHANGELOG.md)
- Source repository: https://github.com/s9hn/figma-to-markdown-mcp
- Contributions: issues and pull requests are welcome on GitHub
- Issues: [GitHub Issues](https://github.com/s9hn/figma-to-markdown-mcp/issues)
- License: MIT
