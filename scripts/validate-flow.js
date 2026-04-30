import { serializeDesignContextToCompactContext } from "../src/compact-context.js";
import { parseFigmaUrl } from "../src/url.js";

const figmaUrl = "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=123-456&m=dev";
const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);

const upstreamBlocks = [
  String.raw`const imgVector9 = "http://localhost:3845/assets/example-asset-1.svg";
const imgVector8 = "http://localhost:3845/assets/example-asset-2.svg";
const imgAsset = "http://localhost:3845/assets/example-asset-3.svg";

function ExampleBackIcon({ className }: { className?: string }) {
  return (
    <div className={className || "relative size-[40px]"} data-node-id="100:200" data-name="example_back_icon">
      <div className="absolute inset-[28.75%_58.75%_28.75%_20%]" data-node-id="300:400">
        <div className="absolute inset-[-2.7%_-5.41%_-2.7%_-10.81%]">
          <img alt="" className="block max-w-none size-full" src={imgVector9} />
        </div>
      </div>
      <div className="absolute bottom-1/2 left-[21.25%] right-[33.75%] top-1/2" data-node-id="300:401">
        <div className="absolute inset-[-0.65px_0]">
          <img alt="" className="block max-w-none size-full" src={imgVector8} />
        </div>
      </div>
    </div>
  );
}

export default function ExampleHeader() {
  return (
    <div className="bg-[var(--color\/neutral\/100,#f6f6f6)] content-stretch flex gap-[var(--spacing\/spacing-8,0px)] items-center justify-end relative size-full" data-node-id="123:456" data-name="example header">
      <div className="content-stretch flex flex-[1_0_0] gap-[var(--spacing\/spacing-8,8px)] items-center min-w-px px-[var(--spacing\/spacing-10,10px)] py-[var(--spacing\/spacing-4,4px)] relative" data-node-id="I123:456;456:789">
        <div className="content-stretch flex flex-[1_0_0] h-[40px] items-center min-w-px relative" data-node-id="I123:456;123:553">
          <ExampleBackIcon className="relative shrink-0 size-[40px]" />
          <div className="content-stretch flex flex-[1_0_0] h-[24px] items-center min-w-px pl-[var(--spacing\/spacing-2,2px)] relative" data-node-id="I123:456;123:555">
            <div className="flex flex-[1_0_0] flex-col font-['Inter:Regular',sans-serif] h-[24px] justify-center leading-[0] min-w-px not-italic overflow-hidden relative text-[19px] text-[color:var(--color\/neutral\/900,black)] text-ellipsis whitespace-nowrap" data-node-id="I123:456;123:556">
              <p className="leading-[24px] overflow-hidden text-ellipsis">Title</p>
            </div>
          </div>
        </div>
        <div className="content-stretch flex gap-[var(--gap\/gap-2,2px)] h-[40px] items-center justify-end relative shrink-0 w-[124px]" data-node-id="I123:456;123:557">
          <div className="relative shrink-0 size-[40px]" data-node-id="I123:456;123:102" data-name="asset slot">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgAsset} />
          </div>
          <div className="relative shrink-0 size-[40px]" data-node-id="I123:456;123:105" data-name="asset slot">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgAsset} />
          </div>
          <div className="relative shrink-0 size-[40px]" data-node-id="I123:456;123:108" data-name="asset slot">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgAsset} />
          </div>
        </div>
      </div>
    </div>
  );
}`,
  String.raw`SUPER CRITICAL: The generated React+Tailwind code MUST be converted to match the target project's technology stack and styling system.
1. Analyze the target codebase to identify: technology stack, styling approach, component patterns, and design tokens
2. Convert React syntax to the target framework/library
3. Transform all Tailwind classes to the target styling system while preserving exact visual design
4. Follow the project's existing patterns and conventions
DO NOT install any Tailwind as a dependency unless the user instructs you to do so.`,
  String.raw`Node ids have been added to the code as data attributes, e.g. \`data-node-id="1:2"\`.`,
  String.raw`These styles are contained in the design: Header Title: Font(family: "Inter", style: Regular, size: 19, weight: 400, lineHeight: 24, letterSpacing: 0).`,
  String.raw`Image assets are stored on a localhost server. Clients can use these images directly in code as a way to view the image assets the same way they would other remote servers.`,
];

const metadataBlocks = [
  `<instance id="123:456" name="example header" x="40" y="40" width="375" height="48" />`,
];

const compact = serializeDesignContextToCompactContext({
  fileKey,
  nodeId,
  contentBlocks: upstreamBlocks,
  metadataBlocks,
});

const rawChars = upstreamBlocks.join("\n\n").length + metadataBlocks.join("\n\n").length;
const compactChars = compact.length;
const savedChars = rawChars - compactChars;
const savedTokens = approxTokens(rawChars) - approxTokens(compactChars);

const report = [
  "# Scenario Validation",
  "",
  "Scenario:",
  `- ${figmaUrl}`,
  "",
  "## Transform",
  "- upstream source: Figma MCP `get_design_context`",
  "- package output: compact implementation context",
  "- metadata source: optional `get_metadata` block",
  "",
  "## Payload Size",
  "",
  "| payload | chars | approx tokens |",
  "| --- | --- | --- |",
  `| upstream blocks | ${rawChars} | ${approxTokens(rawChars)} |`,
  `| compact context | ${compactChars} | ${approxTokens(compactChars)} |`,
  "",
  "## Reduction",
  "",
  `- chars saved: ${savedChars}`,
  `- approx tokens saved: ${savedTokens}`,
  "",
  "## Required Facts",
  "",
  "| fact | present |",
  "| --- | --- |",
  `| source line | ${yes(compact.includes("src|figma|get_design_context|123:456|ExampleFileKey123"))} |`,
  `| summary line | ${yes(compact.includes("sum|example header"))} |`,
  `| element lines | ${yes(compact.includes("el|"))} |`,
  `| text lines | ${yes(compact.includes("tx|"))} |`,
  `| typography lines | ${yes(compact.includes("ty|"))} |`,
  `| asset lines | ${yes(compact.includes("as|imgAsset"))} |`,
  `| raw code removed | ${yes(!compact.includes("export default function ExampleHeader"))} |`,
  `| node id preserved | ${yes(compact.includes("123:456"))} |`,
  `| file key preserved | ${yes(compact.includes("ExampleFileKey123"))} |`,
  `| title text preserved | ${yes(compact.includes("Title"))} |`,
  `| title font preserved | ${yes(compact.includes("Inter"))} |`,
  "",
  "## Preview",
  "",
  compact,
];

console.log(report.join("\n"));

function approxTokens(chars) {
  return Math.ceil(chars / 4);
}

function yes(value) {
  return value ? "yes" : "no";
}
