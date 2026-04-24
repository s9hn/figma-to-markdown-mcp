# Changelog

All notable changes to this project will be documented here.

## [1.0.2] - 2026-04-24

Patch release to normalize npm publish metadata and remove publish-time package warnings.

### Fixed
- Normalized the npm `bin` entry to `src/index.js`
- Normalized `repository.url` to the canonical `git+https` form expected by npm
- Bumped package and runtime version strings to `1.0.2`
- Updated repository docs for the `1.0.2` release

## [1.0.1] - 2026-04-24

Patch release to align published version metadata and repository release notes.

### Changed
- Bumped package and runtime version strings to `1.0.1`
- Updated README version reference
- Added the `1.0.1` changelog entry for repository release tracking

## [1.0.0] - 2026-04-23

Initial public release.

### Added
- `get_design_context_compact` tool — fetches Figma design context and returns compact implementation markdown
- Automatic compaction of raw React/Tailwind passthrough from Figma MCP output
- Layout, text, typography, asset, and implementation note extraction
- `## QA Flags` section surfaced when compaction confidence is low
- Raw fallback returned when compaction fails, so agents are never left without data
- `include_stats` parameter for token size reporting
- Support for both Content-Length and JSON-line MCP transport framing
- Branch URL support for Figma branch links
- Node.js 18+ compatibility
