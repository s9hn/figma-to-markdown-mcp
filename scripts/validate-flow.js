import { serializeDesignContextToMarkdown } from "../src/design-context-markdown.js";
import { parseFigmaUrl } from "../src/url.js";

const figmaUrl = "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=123-456&m=dev";
const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);

const upstreamBlocks = [
  String.raw`const imgVector9 = "http://localhost:3845/assets/example-asset-1.svg";
const imgVector8 = "http://localhost:3845/assets/example-asset-2.svg";
const imgIcons = "http://localhost:3845/assets/example-asset-3.svg";

function Large40IcNaviBackAndroid({ className }: { className?: string }) {
  return (
    <div className={className || "relative size-[40px]"} data-node-id="100:200" data-name="large 40 / ic_navi_back_android">
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

export default function BasicNavi() {
  return (
    <div className="bg-[var(--color\/neutral\/100,#f6f6f6)] content-stretch flex gap-[var(--spacing\/spacing-8,0px)] items-center justify-end relative size-full" data-node-id="123:456" data-name="basic navi">
      <div className="content-stretch flex flex-[1_0_0] gap-[var(--spacing\/spacing-8,8px)] items-center min-w-px px-[var(--spacing\/spacing-10,10px)] py-[var(--spacing\/spacing-4,4px)] relative" data-node-id="I123:456;456:789">
        <div className="content-stretch flex flex-[1_0_0] h-[40px] items-center min-w-px relative" data-node-id="I123:456;123:553">
          <Large40IcNaviBackAndroid className="relative shrink-0 size-[40px]" />
          <div className="content-stretch flex flex-[1_0_0] h-[24px] items-center min-w-px pl-[var(--spacing\/spacing-2,2px)] relative" data-node-id="I123:456;123:555">
            <div className="flex flex-[1_0_0] flex-col font-['Pretendard:Regular',sans-serif] h-[24px] justify-center leading-[0] min-w-px not-italic overflow-hidden relative text-[19px] text-[color:var(--color\/neutral\/900,black)] text-ellipsis whitespace-nowrap" data-node-id="I123:456;123:556">
              <p className="leading-[24px] overflow-hidden text-ellipsis">Label</p>
            </div>
          </div>
        </div>
        <div className="content-stretch flex gap-[var(--gap\/gap-2,2px)] h-[40px] items-center justify-end relative shrink-0 w-[124px]" data-node-id="I123:456;123:557">
          <div className="relative shrink-0 size-[40px]" data-node-id="I123:456;123:102" data-name="icons">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIcons} />
          </div>
          <div className="relative shrink-0 size-[40px]" data-node-id="I123:456;123:105" data-name="icons">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIcons} />
          </div>
          <div className="relative shrink-0 size-[40px]" data-node-id="I123:456;123:108" data-name="icons">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIcons} />
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
  String.raw`These styles are contained in the design: Navi Title: Font(family: "Pretendard", style: Regular, size: 19, weight: 400, lineHeight: 24, letterSpacing: 0).`,
  String.raw`Image assets are stored on a localhost server. Clients can use these images directly in code as a way to view the image assets the same way they would other remote servers.`,
];

const metadataBlocks = [
  `<instance id="123:456" name="basic navi" x="40" y="40" width="375" height="48" />`,
];

const markdown = serializeDesignContextToMarkdown({
  fileKey,
  nodeId,
  contentBlocks: upstreamBlocks,
  metadataBlocks,
  supplementTools: ["get_metadata"],
});

const rawChars = upstreamBlocks.join("\n\n").length + metadataBlocks.join("\n\n").length;
const markdownChars = markdown.length;
const savedChars = rawChars - markdownChars;
const savedTokens = approxTokens(rawChars) - approxTokens(markdownChars);

const report = [
  "# Scenario Validation",
  "",
  "Scenario:",
  `- ${figmaUrl}`,
  "",
  "## Transform",
  "- upstream source: Figma MCP `get_design_context`",
  "- package output: compact implementation markdown",
  "- metadata source: optional `get_metadata` block",
  "",
  "## Payload Size",
  "",
  "| payload | chars | approx tokens |",
  "| --- | --- | --- |",
  `| upstream blocks | ${rawChars} | ${approxTokens(rawChars)} |`,
  `| markdown document | ${markdownChars} | ${approxTokens(markdownChars)} |`,
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
  `| source section | ${yes(markdown.includes("## Source"))} |`,
  `| node summary section | ${yes(markdown.includes("## Node Summary"))} |`,
  `| compact element spec | ${yes(markdown.includes("## Compact Element Spec"))} |`,
  `| text spec | ${yes(markdown.includes("## Text Spec"))} |`,
  `| asset spec | ${yes(markdown.includes("## Asset Spec"))} |`,
  `| raw code removed | ${yes(!markdown.includes("export default function BasicNavi"))} |`,
  `| node id preserved | ${yes(markdown.includes("123:456"))} |`,
  `| file key preserved | ${yes(markdown.includes("ExampleFileKey123"))} |`,
  `| title text preserved | ${yes(markdown.includes("Label"))} |`,
  `| title font preserved | ${yes(markdown.includes("Pretendard"))} |`,
  `| asset refs preserved | ${yes(markdown.includes("imgIcons"))} |`,
  "",
  "## Preview",
  "",
  markdown,
];

console.log(report.join("\n"));

function approxTokens(chars) {
  return Math.ceil(chars / 4);
}

function yes(value) {
  return value ? "yes" : "no";
}
