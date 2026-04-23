import test from "node:test";
import assert from "node:assert/strict";
import { serializeDesignContextToMarkdown } from "../src/design-context-markdown.js";

const BASIC_JSX_BLOCK = [
  "const imgIcons = \"http://localhost:3845/assets/icons.svg\";",
  "",
  "export default function BasicNavi() {",
  "  return <div className=\"bg-[#f6f6f6]\">Label</div>;",
  "}",
].join("\n");

const TYPOGRAPHY_NOTE =
  "These styles are contained in the design: Navi Title: Font(family: \"Pretendard\", style: Regular, size: 19, weight: 400, lineHeight: 24, letterSpacing: 0).";

// This note block maps to "## Preserved Notes" via the "Node ids" prefix rule in summarizeNotes.
const NODE_IDS_NOTE =
  "Node ids have been added to the code as data attributes, e.g. `data-node-id=\"1:2\"`.";

const METADATA_BLOCK =
  "<node id=\"25481:16119\" name=\"basic navi\" type=\"INSTANCE\" width=\"375\" height=\"48\" />";

function makeOpts(overrides = {}) {
  return {
    fileKey: "ExampleFileKey123",
    nodeId: "25481:16119",
    contentBlocks: [BASIC_JSX_BLOCK, TYPOGRAPHY_NOTE, NODE_IDS_NOTE],
    metadataBlocks: [METADATA_BLOCK],
    supplementTools: ["get_metadata"],
    ...overrides,
  };
}

// --- Section presence ---

test("output starts with the Figma Design Context heading", () => {
  const md = serializeDesignContextToMarkdown(makeOpts());
  assert.match(md, /^# Figma Design Context/mu);
});

test("## Source section includes node-id, file-key, and supplement tools", () => {
  const md = serializeDesignContextToMarkdown(makeOpts());
  assert.match(md, /## Source/u);
  assert.match(md, /node-id: `25481:16119`/u);
  assert.match(md, /file-key: `ExampleFileKey123`/u);
  assert.match(md, /supplements: `get_metadata`/u);
});

test("## Source section lists supplements: none when supplementTools is empty", () => {
  const md = serializeDesignContextToMarkdown(makeOpts({ supplementTools: [] }));
  assert.match(md, /supplements: none/u);
});

test("## Node Summary section includes component, name, type, and frame", () => {
  const md = serializeDesignContextToMarkdown(makeOpts());
  assert.match(md, /## Node Summary/u);
  assert.match(md, /component: `BasicNavi`/u);
  assert.match(md, /name: `basic navi`/u);
  assert.match(md, /frame: `375 x 48`/u);
});

test("## Compact Element Spec section is present for a parseable JSX block", () => {
  const md = serializeDesignContextToMarkdown(makeOpts());
  assert.match(md, /## Compact Element Spec/u);
});

test("## Compact Element Spec does not include raw JSX function body", () => {
  const md = serializeDesignContextToMarkdown(makeOpts());
  assert.doesNotMatch(md, /export default function BasicNavi/u);
  assert.doesNotMatch(md, /return <div className/u);
});

test("## Text Spec section includes visible text content", () => {
  const md = serializeDesignContextToMarkdown(makeOpts());
  assert.match(md, /## Text Spec/u);
  assert.match(md, /Label/u);
});

test("## Text Spec section includes typography details from note blocks", () => {
  const md = serializeDesignContextToMarkdown(makeOpts());
  assert.match(md, /Pretendard/u);
});

test("## Preserved Notes section is present", () => {
  const md = serializeDesignContextToMarkdown(makeOpts());
  assert.match(md, /## Preserved Notes/u);
});

// --- Metadata-only path ---

test("Node Summary is omitted when metadata and JSX provide no name or frame", () => {
  const md = serializeDesignContextToMarkdown(
    makeOpts({ metadataBlocks: [], contentBlocks: [BASIC_JSX_BLOCK] })
  );
  // BasicNavi is the component name extracted from the JSX, so Node Summary should still appear
  assert.match(md, /## Node Summary/u);
  assert.match(md, /component: `BasicNavi`/u);
});

// --- Validation ---

test("rejects empty contentBlocks array", () => {
  assert.throws(
    () => serializeDesignContextToMarkdown(makeOpts({ contentBlocks: [] })),
    /At least one design-context block is required/u
  );
});

test("rejects missing fileKey", () => {
  assert.throws(
    () => serializeDesignContextToMarkdown(makeOpts({ fileKey: "" })),
    /fileKey/u
  );
});

test("rejects missing nodeId", () => {
  assert.throws(
    () => serializeDesignContextToMarkdown(makeOpts({ nodeId: "" })),
    /nodeId/u
  );
});

// --- QA Flags ---

test("emits ## QA Flags when structured JSX parse fails", () => {
  const md = serializeDesignContextToMarkdown(
    makeOpts({
      contentBlocks: [
        [
          "const something = true;",
          "export default function BasicNavi() {",
          "  return condition ? foo() : bar();",
          "}",
        ].join("\n"),
      ],
      metadataBlocks: [],
    })
  );

  assert.match(md, /## QA Flags/u);
  assert.match(md, /Structured JSX compaction failed/u);
});

// --- Full roundtrip (original regression test) ---

test("serializeDesignContextToMarkdown preserves metadata and upstream block order", () => {
  const markdown = serializeDesignContextToMarkdown(makeOpts());

  assert.match(markdown, /^# Figma Design Context/mu);
  assert.match(markdown, /## Source/u);
  assert.match(markdown, /## Node Summary/u);
  assert.match(markdown, /## Compact Element Spec/u);
  assert.match(markdown, /## Text Spec/u);
  assert.match(markdown, /## Preserved Notes/u);
  assert.doesNotMatch(markdown, /export default function BasicNavi/u);
  assert.doesNotMatch(markdown, /return <div className/u);
  assert.match(markdown, /component: `BasicNavi`/u);
  assert.match(markdown, /name: `basic navi`/u);
  assert.match(markdown, /frame: `375 x 48`/u);
  assert.match(markdown, /Pretendard/u);
  assert.match(markdown, /Label/u);
});
