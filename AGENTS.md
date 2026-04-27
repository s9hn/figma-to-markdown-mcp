# AGENTS.md — figma-to-markdown-mcp

## Project Context
- This project is open source and intended for public use.
- It is an MCP server that sits between an AI agent and Figma design data.
- The core product value is token reduction: the agent should receive compacted Markdown, not raw Figma node payloads.

## Core Intent
- When a developer pastes a full Figma node URL into an agent prompt, the agent should call `get_figma_as_markdown` from this server first.
- This server should internally call Figma MCP, compact the upstream result, and return only the reduced Markdown/context.
- The server acts as a middle layer that keeps raw Figma MCP output out of the caller model context whenever possible.

## Routing Rules
- Prefer `get_figma_as_markdown` over direct Figma MCP `get_design_context` when the user asks to implement, inspect, or summarize a Figma link.
- If `get_figma_as_markdown` returns a fallback handoff, continue with the standard Figma MCP tools for that same node.
- Only use raw upstream Figma MCP output directly when the user explicitly asks for it or when debugging this bridge.
- If the prompt contains an `@https://www.figma.com/...` link, treat it as a normal Figma URL after removing the leading `@`.

## Primary User Scenario
1. User tells the agent: `[specific Figma link] implement this`.
2. Agent calls Figma To Markdown MCP.
3. Figma To Markdown MCP internally calls Figma MCP to get node/context data.
4. Figma To Markdown MCP compacts the upstream design payload.
5. Figma To Markdown MCP returns reduced Markdown/context to the agent.
6. Agent starts implementation from the compacted result instead of the original Figma payload.

## Product Direction
- Main UX goal: install with `npm`, register one MCP server, then use Figma links naturally in prompts.
- Avoid requiring users to set up a separate Figma API key when possible.
- Preferred internal source is the local Figma desktop MCP server at `http://127.0.0.1:3845/mcp`.
- If raw Figma data stays inside this server process, agent token usage is paid only on the final compacted output.

## Architecture Notes
- This project supports both raw `figma_json` compaction and link-based internal fetching through a local Figma MCP server.
- The implementation model is: this process is an MCP server outwardly and an MCP client inwardly.
- Do not return raw Figma JSON or large upstream MCP payloads to the caller except for tightly scoped debugging.
- Parser/compaction logic should stay separate from transport and Figma-fetching logic.

## Constraints
- Keep AGENTS context short and practical for future AI contributors.
- Treat token reduction, predictable routing, and low-friction setup as first-order product requirements.
- Prefer solutions that preserve the “one MCP install, paste Figma link, implement” workflow.
- If the bridge cannot safely compact the upstream response, hand off cleanly to the normal Figma MCP flow instead of returning raw upstream payload from this server.
