# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-04-27

### Changed

- Stopped exposing the legacy `figma_to_markdown` raw-JSON tool and narrowed the public MCP surface to the URL-based `get_figma_as_markdown` workflow.
- Changed `max_output_chars` so truncation is opt-in instead of enforced by default, allowing large screens to return larger compacted output when needed.
- Reworked the README around the user workflow, token-reduction value, architecture, setup, and MCP registration guidance.
- Updated AGENTS guidance to describe the bridge as a link-based internal-fetching server.
- Cleaned the build so `dist/` is removed before compilation, preventing deleted artifacts such as the old parser output from being published.

### Fixed

- Added `npm ci` to the GitHub Actions CI workflow so tests run with installed dependencies.
- Added tests covering the new no-default-truncation behavior and explicit truncation behavior when `max_output_chars` is set.

## [1.1.1] - 2026-04-27

### Changed

- Restored npm package metadata fields such as `repository`, `homepage`, `bugs`, `license`, `author`, and `engines` for cleaner package and registry presentation.
- Stopped ignoring `AGENTS.md` and included the repository guidance file alongside the bridge release.
- Restored a fuller repository `.gitignore` so local artifacts are filtered more consistently during development and release work.

## [1.1.0] - 2026-04-27

### Added

- Added `get_figma_as_markdown`, a URL-based MCP tool that accepts a full Figma node link, calls a local Figma MCP server internally, and returns compacted Markdown instead of raw upstream payloads.
- Added an internal Figma MCP client with Streamable HTTP first and SSE fallback support for local desktop MCP connections.
- Added compactors for Figma MCP `get_design_context` and `get_metadata` responses so upstream output can be reduced before it reaches the calling agent.
- Added server-level routing instructions so compatible hosts are told to prefer `get_figma_as_markdown` for Figma links.
- Added explicit bridge fallback handoff output for `get_figma_as_markdown` so agents can continue with the standard Figma MCP tools when internal fetch or compaction cannot safely complete.
- Added structured fallback metadata in the tool response, including suggested upstream tool calls and node-id retry variants.
- Added automated tests covering the compacted-success path, optional metadata failure handling, and upstream/compaction fallback behavior.

### Changed

- Updated package metadata, AGENTS guidance, and README usage/deployment docs to reflect the internal Figma MCP bridge architecture.
- Improved design-context compaction by stripping verbose upstream attributes and shortening localhost asset references.
- Updated server instructions, AGENTS guidance, and README routing docs so agents know to use direct Figma MCP only after the bridge returns fallback.
- Strengthened compaction by stripping more verbose passthrough attributes such as `data-testid`, `data-figma-name`, empty `style={{}}`, and empty `className=""`.
- Made `get_metadata` truly optional during bridge fetch so metadata failure no longer aborts successful design-context compaction.

## [1.0.1] - 2026-04-24

### Changed

- Simplified `max_depth` handling by relying on the Zod default value.
- Split JSON parse errors and parser errors into separate failure paths.
- Updated size summary text to report `Expanded ~X%` when the output is larger than the input.
- Limited published package contents to `dist` through the `files` field.

### Fixed

- Added Figma node shape validation before conversion to prevent invalid payloads from producing misleading output.
- Normalized inline text so line breaks and quotes do not break the generated Markdown structure.
- Preserved zero-valued layout and visual properties such as `gap`, `padding`, `radius`, and `opacity`.

### Repository

- Added a repository `.gitignore` for local-only files.
- Removed local-only workspace artifacts and permission settings from the project tree.
- Added repository docs for current scope and release tracking.
