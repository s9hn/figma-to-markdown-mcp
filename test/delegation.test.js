import test from "node:test";
import assert from "node:assert/strict";
import { buildImplementationDelegationPrompt } from "../src/delegation.js";

test("buildImplementationDelegationPrompt includes the normalized node id in the prompt", () => {
  const prompt = buildImplementationDelegationPrompt({
    figmaUrl:
      "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=25481-16139&m=dev",
    targetPackage: "com.example.feature.preview",
  });

  assert.match(prompt, /Node ID: 25481:16139/u);
});

test("buildImplementationDelegationPrompt includes compact-context-first implementation rules", () => {
  const prompt = buildImplementationDelegationPrompt({
    figmaUrl:
      "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=25481-16139&m=dev",
    targetPackage:
      "com.example.feature.preview",
    componentName: "ExampleComponent",
  });

  assert.match(prompt, /Node ID: 25481:16139/u);
  assert.match(prompt, /Target package: com\.example\.feature\.preview/u);
  assert.match(prompt, /get_figma_compact_context/u);
  assert.match(prompt, /Use the returned compact context as the primary implementation input\./u);
  assert.match(prompt, /Treat screenshots as visual reference only\./u);
});

test("buildImplementationDelegationPrompt rejects URLs without node id", () => {
  assert.throws(
    () => buildImplementationDelegationPrompt({
      figmaUrl: "https://www.figma.com/design/ExampleFileKey123/Example-File",
      targetPackage: "com.example.feature",
    }),
    /node-id/u
  );
});

test("buildImplementationDelegationPrompt rejects a missing targetPackage", () => {
  assert.throws(
    () => buildImplementationDelegationPrompt({
      figmaUrl: "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=1-2",
    }),
    /targetPackage/u
  );
});

test("buildImplementationDelegationPrompt omits component name line when componentName is not provided", () => {
  const prompt = buildImplementationDelegationPrompt({
    figmaUrl:
      "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=1-2",
    targetPackage: "com.example.feature",
  });

  assert.doesNotMatch(prompt, /Component name:/u);
});
