# Compact Context Spec

Status: draft for `3.0.0`

This document defines the compact-context-first public contract for this project.

## 1. Product Position

- Goal: prune upstream Figma MCP `get_design_context` into compact implementation context.
- Optional supplement: `get_metadata` for summary, diagnostics, and partial-node hints.
- Safety rule: if compaction is not trustworthy, return a fallback handoff instead of echoing raw upstream payload.

## 2. Public Surface

Primary tool:

`get_figma_compact_context`

Rules:

- New hosts and prompts should route to `get_figma_compact_context`.
- Docs, routing instructions, and examples should treat compact context as the default contract.
- Raw upstream output should only appear after an explicit fallback handoff or direct debugging request.

## 3. Input Schema

```ts
type CompactMode = "minimal" | "balanced" | "debug";
type CompactTask = "implement" | "inspect" | "summarize";

interface GetFigmaCompactContextInput {
  figma_url: string;
  mode?: CompactMode;
  task?: CompactTask;
  include_assets?: boolean;
  include_text_specs?: boolean;
  include_trace_ids?: boolean;
  include_metadata?: boolean;
  max_output_chars?: number;
}
```

## 4. Output Envelope

```ts
type CompactStatus = "ok" | "fallback";

interface CompactStats {
  rawChars: number;
  compactChars: number;
  reductionPct?: number;
}

interface CompactTrace {
  figmaUrl: string;
  fileKey?: string;
  nodeId: string;
  upstreamTools: string[];
}

interface CompactFallback {
  reason: string;
  recommendedTool: "get_design_context";
  suggestedCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

interface CompactContextResult {
  status: CompactStatus;
  format: "compact-context";
  version: "1";
  mode: CompactMode;
  task: CompactTask;
  summary: string;
  content: string;
  stats: CompactStats;
  trace?: CompactTrace;
  warnings?: string[];
  nodeDiagnostics?: unknown;
  fallback?: CompactFallback;
}
```

## 5. Compact DSL

The transport body is plain text. It should stay framework-agnostic and compact.

```text
src|figma|get_design_context|{nodeId}|{fileKey}
sum|{name}|{type}|{width}x{height}|{x},{y}
el|{id}|{label}|{prop-list}
tx|{id}|{visible-text}|{text-style-token}
ty|{token}|{fontFamily}|{fontWeight}|{fontSize}|{lineHeight}|{color}
as|{token}|{kind}|{nodeId}|{name}|{source}
wa|{warning-code}|{message}
```

Constraints:

- Keep implementation-critical structure, text, typography, assets, and trace ids.
- Drop raw JSX, React wrappers, Tailwind boilerplate, and chrome-like nodes when safe.
- Keep the content implementation-ready without section-heading overhead.

## 6. Fallback Contract

When compaction fails or is unsafe:

- do not return raw upstream payload through this server
- return a compact fallback handoff
- recommend direct `get_design_context`
- include node-id retry guidance when relevant

## 7. Validation Direction

Release gates should favor compact fidelity over presentation.

Minimum validation:

- unit tests for compact serializer behavior
- MCP round-trip tests for `get_figma_compact_context`
- regression coverage for parser bugs that affect retained text or typography
- live loss audit runs against representative nodes
