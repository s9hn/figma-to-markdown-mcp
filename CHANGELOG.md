# Changelog

All notable changes to this project will be documented in this file.

## [3.0.0] - 2026-04-30

### Breaking Changes

- Renamed the npm package from `figma-to-markdown-mcp` to `figma-compaction-mcp`.
- Renamed the recommended MCP server id from `figma-to-markdown` to `figma-compaction`.
- Replaced `get_figma_as_markdown` with `get_figma_compact_context` as the public MCP entrypoint.
- Removed the Markdown-oriented public output contract in favor of compact plain-text context only.

### Changed

- Renamed the package and public server identity to `figma-compaction-mcp` / `figma-compaction`.
- Made `get_figma_compact_context` the only public MCP tool and compact context the only public output contract.
- Removed legacy serializer/output paths in favor of compact-context-only transport and response handling.
- Renamed analyzer and runtime identifiers to remove the previous product naming.
- Reworked README, AGENTS guidance, SPEC, tests, and package metadata around the compact-context-first contract.
- Updated npm and GitHub metadata to the `figma-compaction-mcp` naming.

### Added

- Added compact-context serializer modules and line-based DSL output as the primary caller-facing format.
- Added a live loss audit script for compact fidelity checks.

### Migration

- Reinstall the package with `npm install -g figma-compaction-mcp` or switch your MCP client to `npx -y figma-compaction-mcp`.
- Update MCP client registrations, prompts, and automation to call `get_figma_compact_context` first.
- If your setup hard-coded the old GitHub repository URL, move it to `https://github.com/s9hn/figma-compaction-mcp`.

### Validation

- `npm test`
- `npm run build`
- `npm pack --dry-run`
