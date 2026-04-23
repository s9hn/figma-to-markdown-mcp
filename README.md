# figma-to-markdown-mcp

Compact markdown layer in front of Figma MCP for implementation workflows.

This package accepts a normal Figma node link, calls Figma Desktop MCP `get_design_context` internally, and returns compact markdown that an implementation agent can read before touching raw upstream design-context output.

## What It Does

```text
User -> implementation request + Figma node URL
     -> figma-to-markdown MCP
     -> Figma MCP get_design_context (+ optional get_metadata)
     -> transformed compact markdown
     -> implementation agent
```

The server is intended to be registered like any other MCP server. The agent should call `get_design_context_compact` first, use the returned markdown as primary context, and only fall back to raw Figma MCP tools if the compact markdown is missing a fact needed for implementation.

The compact markdown is lossy for raw code, but not for implementation-critical facts. It keeps:

- source metadata
- node name, type, frame, origin when available
- compact element/layout spec
- text and typography facts
- asset references
- preserved implementation notes

It omits:

- full raw React/Tailwind passthrough by default
- repetitive wrapper code that only increases token cost

## Requirements

- Figma Desktop app running
- Dev Mode MCP enabled in Figma Desktop settings
- The document containing the requested node must be the active tab in Figma Desktop

## Registration

Local repo registration example:

```toml
[mcp_servers.figma-to-markdown]
command = "node"
args = ["/ABS/PATH/TO/figma-to-markdown-mcp/src/index.js"]
```

If installed from a package manager that exposes the binary:

```toml
[mcp_servers.figma-to-markdown]
command = "figma-to-markdown-mcp"
args = []
```

## Intended Agent Flow

1. User sends a normal Figma node URL and asks for an implementation.
2. The agent calls `get_design_context_compact` first.
3. This MCP fetches upstream Figma design context internally.
4. The raw upstream payload is compacted into markdown.
5. The agent implements from the compact markdown.
6. Only if facts are missing should the agent read raw Figma MCP output.

## Tool

### `get_design_context_compact`

Input:

```json
{
  "figma_url": "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=123-456",
  "include_stats": false
}
```

Output:

````markdown
# Figma Design Context

## Source
- provider: `figma-mcp`
- transformed-by: `figma-to-markdown`
- primary tool: `get_design_context`
- supplements: `get_metadata`
- node-id: `123:456`
- file-key: `ExampleFileKey123`
- mode: compact implementation handoff
- raw upstream code: omitted by default to reduce agent input size

## Node Summary
- component: `BasicNavi`
- name: `basic navi`
- type: `instance`
- frame: `375 x 48`

## Compact Element Spec
- `basic navi` -> flex, items center; bg `#f6f6f6 (neutral/100)`
- inner content row -> flex, flex `1 0 0`, gap `8px (spacing-8)`; px `10px (spacing-10)`, py `4px (spacing-4)`
- right icon row -> w `124px`, h `40px`; gap `2px (gap-2)`, items center, justify end

## Text Spec
- text "Label" -> font `Pretendard Regular`, size `19px`, line `24px`, color `neutral/900`

## Preserved Notes
- Convert upstream React/Tailwind semantics to the target framework and styling system.
- Node ids are available for traceability.
````

## Notes

- `file-key` is extracted from the input link for traceability
- upstream Figma MCP tools remain node-id scoped internally
- `get_metadata` is supplemental and may be unavailable without failing the main transform
- the compact markdown is the default handoff format for implementation agents
- when compaction confidence is low, the output includes a `## QA Flags` section

## Scripts

Run tests:

```bash
npm test
```

Run the scenario validation report:

```bash
npm run validate:flow
```

Generate an implementation handoff prompt:

```bash
npm run delegate:implementation -- \
  --figma-url "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=123-456&m=dev" \
  --target-package "com.example.feature.preview" \
  --component-name "ExampleBasicNavi"
```
