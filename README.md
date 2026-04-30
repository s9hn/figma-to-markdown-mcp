# figma-compaction-mcp

Languages: [English](./README.md) | [Korean](./README.ko.md)

Current version: `3.0.0`

`figma-compaction-mcp` is an MCP server for Figma-link workflows. It fetches upstream Figma design context internally, prunes it into compact plain-text context, and returns that reduced result to the calling agent instead of the full upstream payload.

## What It Is

This project is for teams that want agents to work from Figma node URLs without pushing raw upstream Figma MCP output into the caller model context whenever the bridge can safely handle the request.

The intended flow is simple:

1. A user gives an agent a Figma node URL.
2. The agent calls `get_figma_compact_context`.
3. This server fetches upstream Figma context internally.
4. The server compacts the upstream result into a small line-based DSL.
5. The agent receives compact implementation context and works from that output.

## Why Use It

The main reason to use this server is token reduction without losing implementation-critical facts.

Raw Figma MCP responses can be large enough to consume a meaningful part of the caller model context before implementation even begins. This bridge keeps that upstream payload inside the server whenever possible, compacts it first, and only returns the reduced result to the agent.

- Lower token usage for Figma-link prompts
- Smaller model-context footprint before implementation starts
- Cleaner implementation input for agents
- Less raw upstream noise in caller context
- Traceable output with node ids, typography tokens, asset refs, warnings, and fallback hints
- A built-in fallback path when the bridge cannot safely complete

## How It Works

This server sits between your agent and the local Figma Desktop MCP server.

```text
User prompt with Figma link
  -> Agent calls get_figma_compact_context
  -> figma-compaction-mcp connects to local Figma Desktop MCP
  -> get_design_context / get_metadata
  -> internal compaction
  -> compact plain-text context returned to the agent
```

The public entrypoint is `get_figma_compact_context`.

- `figma_url`: required full Figma node URL
- `mode`: optional compaction mode, one of `minimal`, `balanced`, `debug`
- `task`: optional intent hint, one of `implement`, `inspect`, `summarize`
- `include_assets`: optional, default `true`
- `include_text_specs`: optional, default `true`
- `include_trace_ids`: optional, default `true`
- `include_metadata`: optional, default `true`
- `max_output_chars`: optional explicit output budget

When the bridge succeeds, it returns compact plain-text context plus structured fields for stats, traceability, warnings, and diagnostics. When the bridge cannot safely fetch or compact the node, it returns a fallback handoff so the agent can continue with standard Figma MCP tools directly.

Example compact output:

```text
src|figma|get_design_context|4:5100|FILE_KEY
sum|Example screen|frame|375x876|535,258
el|4:5107|field_card|w343;layout:column;r20;p:16,20,20,20;bg:#ffffff
tx|4:5106|Section title|t1
ty|t1|Inter|600|20|24|#333333
as|imgAsset|asset|4:5107|asset_slot|/assets/example-image.png
```

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
npm install -g figma-compaction-mcp
```

Or run with `npx`:

```bash
npx figma-compaction-mcp
```

## MCP Client Registration

Register this server in your MCP client.

Example using `npx`:

```json
{
  "mcpServers": {
    "figma-compaction": {
      "command": "npx",
      "args": ["-y", "figma-compaction-mcp"]
    }
  }
}
```

Example using a global install:

```json
{
  "mcpServers": {
    "figma-compaction": {
      "command": "figma-compaction-mcp",
      "args": []
    }
  }
}
```

Your client may use JSON, TOML, or another config format, but the command registration model is the same.

## How To Use It

1. Open Figma Desktop and enable Dev Mode and the desktop MCP server.
2. Register `figma-compaction-mcp` in your MCP client.
3. Give your agent a Figma node URL.
4. Have the agent call `get_figma_compact_context` first.
5. Use the returned compact context for implementation, inspection, or summarization.
6. If the server returns a fallback handoff, continue with the standard Figma MCP tools for the same node.

In practice:

- Small and medium components usually return compact context directly.
- Large screens can still return larger output when the retained structure, text, and assets matter.
- `balanced` mode is the default for normal implementation work.
- Only set `max_output_chars` when you intentionally want a hard output budget.

## Limitations

- Final tool routing still depends on the MCP host or agent. This server can strongly guide usage, but it cannot forcibly override host-side routing.
- When the bridge cannot safely complete a request, it returns a compact fallback handoff instead of passing raw upstream payloads through this server response.
- Compaction is optimized for implementation relevance, so purely decorative wrappers and chrome-like nodes may be pruned outside inspect-oriented flows.

## Other Information

- Release history: [CHANGELOG.md](./CHANGELOG.md)
- Compact contract draft: [SPEC.md](./SPEC.md)
- Source repository: https://github.com/s9hn/figma-compaction-mcp
- Contributions: issues and pull requests are welcome on GitHub
- Issues: [GitHub Issues](https://github.com/s9hn/figma-compaction-mcp/issues)
- License: MIT
