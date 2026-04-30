import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDesignContext } from "../src/design-context-analyzer.js";
import { serializeDesignContextToCompactContext } from "../src/compact-context.js";

const BASIC_JSX_BLOCK = [
  "const imgAsset = \"http://localhost:3845/assets/example-image.svg\";",
  "",
  "export default function ExampleHeader() {",
  "  return (",
  "    <div data-node-id=\"25481:16119\" data-name=\"example header\" className=\"flex flex-col gap-[var(--spacing/spacing-8,8px)] bg-[var(--color/neutral/0,white)] rounded-[var(--radius/radius-20,20px)]\">",
  "      <div data-node-id=\"25481:16120\" className=\"font-['Inter:Regular',sans-serif] text-[19px] leading-[24px] text-[color:var(--color/neutral/900,#000)]\">",
  "        <p>Title</p>",
  "      </div>",
  "      <div data-node-id=\"25481:16121\" data-name=\"asset slot\">",
  "        <img alt=\"\" src={imgAsset} />",
  "      </div>",
  "    </div>",
  "  );",
  "}",
].join("\n");

const METADATA_BLOCK =
  "<instance id=\"25481:16119\" name=\"example header\" x=\"40\" y=\"40\" width=\"375\" height=\"48\" />";

test("analyzeDesignContext exposes the parsed root node and metadata summary", () => {
  const analysis = analyzeDesignContext({
    contentBlocks: [BASIC_JSX_BLOCK],
    metadataBlocks: [METADATA_BLOCK],
  });

  assert.equal(analysis.componentName, "ExampleHeader");
  assert.equal(analysis.metadataSummary.name, "example header");
  assert.equal(analysis.metadataSummary.frame, "375 x 48");
  assert.equal(analysis.rootNode?.dataNodeId, "25481:16119");
});

test("serializeDesignContextToCompactContext emits compact DSL lines with traceable text and asset facts", () => {
  const compact = serializeDesignContextToCompactContext({
    fileKey: "ExampleFileKey123",
    nodeId: "25481:16119",
    contentBlocks: [BASIC_JSX_BLOCK],
    metadataBlocks: [METADATA_BLOCK],
  });

  assert.match(compact, /^src\|figma\|get_design_context\|25481:16119\|ExampleFileKey123/mu);
  assert.match(compact, /sum\|example header\|instance\|375x48\|40,40/u);
  assert.match(compact, /el\|25481:16119\|screen\|/u);
  assert.match(compact, /tx\|25481:16120\|Title\|t1/u);
  assert.match(compact, /ty\|t1\|Inter\|400\|19\|24\|#000/u);
  assert.match(compact, /as\|imgAsset\|asset\|25481:16121\|asset_slot\|\/assets\/example-image\.svg/u);
  assert.doesNotMatch(compact, /export default function/u);
});

test("serializeDesignContextToCompactContext rejects missing identifiers or empty content", () => {
  assert.throws(
    () => serializeDesignContextToCompactContext({
      fileKey: "",
      nodeId: "25481:16119",
      contentBlocks: [BASIC_JSX_BLOCK],
    }),
    /fileKey/u
  );

  assert.throws(
    () => serializeDesignContextToCompactContext({
      fileKey: "ExampleFileKey123",
      nodeId: "",
      contentBlocks: [BASIC_JSX_BLOCK],
    }),
    /nodeId/u
  );

  assert.throws(
    () => serializeDesignContextToCompactContext({
      fileKey: "ExampleFileKey123",
      nodeId: "25481:16119",
      contentBlocks: [],
    }),
    /design-context block/u
  );
});
