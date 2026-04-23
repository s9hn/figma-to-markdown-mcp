# Contributing

## Intended Flow

1. User provides a normal Figma node URL and asks for an implementation.
2. Agent calls `get_design_context_compact`.
3. This MCP internally calls Figma MCP and reads the upstream node payload.
4. The MCP returns transformed compact markdown.
5. Agent implements from the compact markdown.
6. Token consumption should improve relative to reading raw upstream output directly.

## Architecture Notes

- Raw React/Tailwind passthrough is removed by default.
- Compact output preserves source, metadata, layout, text, typography, assets, and implementation notes.
- Missing-node and active-tab errors are normalized into a clearer message.
- Parse-confidence issues are surfaced via `## QA Flags`.

## Known Constraints

- The Figma Desktop document must be the active tab because upstream Figma MCP requires it. This project cannot eliminate that dependency.
- Structured compaction is based on JSX-like upstream responses and heuristic token parsing. Complex conditional rendering, fragments, or large non-JSX upstream formats may degrade compaction quality.
- Token measurement is approximate (`chars / 4`), not billing-accurate.

## Testing Checklist

Before submitting a pull request, verify the following:

- MCP `initialize` works
- MCP `tools/list` exposes `get_design_context_compact`
- URL parsing supports standard and branch URLs
- Compact output removes raw upstream code
- Compact output preserves critical design facts
- Upstream missing-node error is normalized
- Compaction failure is surfaced via `QA Flags`
- Validation script measures reduction against a realistic fixture

Run the test suite and scenario validation:

```bash
npm test
npm run validate:flow
```
