import test from "node:test";
import assert from "node:assert/strict";
import { buildCompactToolSuccessResponse } from "../src/tool-response.ts";

test("buildCompactToolSuccessResponse keeps compact content in structuredContent", () => {
  const response = buildCompactToolSuccessResponse({
    status: "ok",
    format: "compact-context",
    version: "1",
    mode: "balanced",
    task: "implement",
    summary: "Example Field Block / frame / 343 x 64",
    content: "src|figma|get_design_context|4:4956|FILE123\nsum|Frame|frame|343x64|0,0",
    stats: {
      rawChars: 2341,
      compactChars: 1631,
      reductionPct: 30.33,
    },
    trace: {
      figmaUrl: "https://www.figma.com/design/FILE123/Example?node-id=4-4956",
      fileKey: "FILE123",
      nodeId: "4-4956",
      upstreamTools: ["get_design_context", "get_metadata"],
    },
    warnings: ["partial_node"],
    nodeDiagnostics: {
      nodeId: "4:4956",
      name: "Example Field Block",
      type: "frame",
      width: 343,
      height: 64,
      x: 0,
      y: 0,
      directChildCount: 1,
      descendantCount: 1,
      textNodeCount: 1,
      topLevelChildTypes: ["text"],
      firstTextNames: ["Choice field"],
      looksPartial: true,
      reasons: [
        "Selected frame is compact (343 x 64) and may be a localized sub-block.",
        "Selected subtree contains one direct text child and no additional structure.",
      ],
      parentCandidates: [],
      parentCandidatesUnavailableReason:
        "Upstream `get_metadata` only exposed the selected subtree, so ancestor frame candidates were not available.",
    },
  });

  assert.equal(response.content[0].text, "src|figma|get_design_context|4:4956|FILE123\nsum|Frame|frame|343x64|0,0");
  assert.equal(response.structuredContent.format, "compact-context");
  assert.equal(response.structuredContent.stats.reductionPct, 30.33);
  assert.deepEqual(response.structuredContent.warnings, ["partial_node"]);
  assert.equal(response.structuredContent.nodeDiagnostics?.looksPartial, true);
});
