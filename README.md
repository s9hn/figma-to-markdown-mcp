# figma-to-markdown-mcp

[![npm version](https://img.shields.io/npm/v/figma-to-markdown-mcp.svg)](https://www.npmjs.com/package/figma-to-markdown-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/s9hn/figma-to-markdown-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/s9hn/figma-to-markdown-mcp/actions/workflows/ci.yml)

A compact markdown layer in front of [Figma MCP](https://www.figma.com/developers/mcp) for AI implementation workflows.

This MCP server accepts a Figma node URL, calls Figma Desktop MCP `get_design_context` internally, and returns compact markdown — stripping out raw React/Tailwind passthrough that inflates token cost without adding implementation value.

**~45% token reduction** on typical design context payloads (sample: 1,053 → 582 tokens).

---

## How It Works

```
User  →  implementation request + Figma node URL
      →  figma-to-markdown MCP
      →  Figma Desktop MCP  (get_design_context + get_metadata)
      →  compact markdown
      →  implementation agent
```

The compact output keeps what matters for implementation:

| Kept | Removed |
| --- | --- |
| Source metadata | Raw React/Tailwind passthrough |
| Node name, type, frame | Repetitive wrapper boilerplate |
| Layout and spacing spec | Verbose class attribute dumps |
| Text and typography facts | |
| Asset references | |
| Implementation notes | |

---

## Requirements

- [Figma Desktop](https://www.figma.com/downloads/) app running
- Dev Mode MCP enabled in Figma Desktop settings
- The document containing the requested node must be the active tab
- Node.js 18 or later

---

## Installation

No install step required. Use `npx` and it runs on demand:

```bash
npx figma-to-markdown-mcp
```

Or install globally if you prefer:

```bash
npm install -g figma-to-markdown-mcp
```

---

## Registration

Register the server in your MCP client's config file. The JSON format is the same across clients — only the file location differs.

### Claude Desktop

Config file: `~/Library/Application Support/Claude/claude_desktop_config.json`

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

### Claude Code

Config file: `.claude/settings.json` (project) or `~/.claude/settings.json` (global)

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

### Cursor

Config file: `.cursor/mcp.json`

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

### Codex CLI

Config file: `~/.codex/config.toml` (global) or `.codex/config.toml` (project)

```toml
[mcp_servers.figma-to-markdown]
command = "npx"
args = ["-y", "figma-to-markdown-mcp"]
```

---

## Usage

Once registered, give your agent a Figma node URL and ask for an implementation.

**Agent flow:**

1. User sends a Figma node URL with an implementation request.
2. Agent calls `get_design_context_compact` with the URL.
3. This server fetches design context from Figma Desktop MCP internally.
4. Raw output is compacted into markdown and returned.
5. Agent implements from the compact markdown.
6. Only if facts are missing should the agent fall back to raw Figma MCP tools.

**Tool: `get_design_context_compact`**

```json
{
  "figma_url": "https://www.figma.com/design/FILE_KEY/Name?node-id=123-456",
  "include_stats": false
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `figma_url` | string | yes | Full Figma URL including `node-id` query parameter |
| `include_stats` | boolean | no | Append token size statistics to the output |

**Example output:**

````markdown
# Figma Design Context

## Source
- provider: `figma-mcp`
- transformed-by: `figma-to-markdown`
- node-id: `123:456`
- file-key: `ExampleFileKey123`
- mode: compact implementation handoff

## Node Summary
- component: `BasicNavi`
- type: `instance`
- frame: `375 x 48`

## Compact Element Spec
- `basic navi` → flex, items center; bg `#f6f6f6 (neutral/100)`
- inner content row → flex, flex `1 0 0`, gap `8px`; px `10px`, py `4px`

## Text Spec
- text "Label" → font `Pretendard Regular`, size `19px`, line `24px`, color `neutral/900`
````

---

## Notes

- `file-key` is extracted from the input URL for traceability.
- `get_metadata` is fetched in parallel as a supplement and will not fail the main request if unavailable.
- When compaction confidence is low, the output includes a `## QA Flags` section.
- Raw upstream code is omitted by default. Set `include_stats: true` to see payload size.

---

## Version & License

- Current version: **1.0.0**
- License: [MIT](./LICENSE)
- [Changelog](./CHANGELOG.md)
- [Contributing](./CONTRIBUTING.md)
