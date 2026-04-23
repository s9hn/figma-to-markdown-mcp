import test from "node:test";
import assert from "node:assert/strict";
import { parseFigmaUrl } from "../src/url.js";

test("parseFigmaUrl extracts fileKey and nodeId from a /design/ URL", () => {
  const result = parseFigmaUrl(
    "https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=25481-16119&m=dev"
  );

  assert.equal(result.fileKey, "ExampleFileKey123");
  assert.equal(result.nodeId, "25481:16119");
});

test("parseFigmaUrl extracts fileKey and nodeId from a legacy /file/ URL", () => {
  const result = parseFigmaUrl(
    "https://www.figma.com/file/LegacyFileKey456/Legacy-File?node-id=1-2"
  );

  assert.equal(result.fileKey, "LegacyFileKey456");
  assert.equal(result.nodeId, "1:2");
});

test("parseFigmaUrl uses branchKey as fileKey for branch URLs", () => {
  const result = parseFigmaUrl(
    "https://www.figma.com/design/MAINKEY/Name/branch/BRANCHKEY/BranchName?node-id=1-2"
  );

  assert.equal(result.fileKey, "BRANCHKEY");
  assert.equal(result.nodeId, "1:2");
});

test("parseFigmaUrl normalizes node-id dashes to colons", () => {
  const result = parseFigmaUrl(
    "https://www.figma.com/design/AnyKey/Name?node-id=100-200"
  );

  assert.equal(result.nodeId, "100:200");
});

test("parseFigmaUrl rejects an empty string", () => {
  assert.throws(() => parseFigmaUrl(""), /must be a non-empty string/u);
});

test("parseFigmaUrl rejects a non-string argument", () => {
  assert.throws(() => parseFigmaUrl(null), /must be a non-empty string/u);
  assert.throws(() => parseFigmaUrl(undefined), /must be a non-empty string/u);
  assert.throws(() => parseFigmaUrl(42), /must be a non-empty string/u);
});

test("parseFigmaUrl rejects an invalid URL", () => {
  assert.throws(() => parseFigmaUrl("not a url"), /must be a valid URL/u);
});

test("parseFigmaUrl rejects a URL without a recognizable file path", () => {
  assert.throws(
    () => parseFigmaUrl("https://www.figma.com/proto/ExampleFileKey123/Name?node-id=1-2"),
    /Could not extract file key/u
  );
});

test("parseFigmaUrl rejects a URL missing node-id", () => {
  assert.throws(
    () => parseFigmaUrl("https://www.figma.com/design/ExampleFileKey123/Name"),
    /node-id/u
  );
});

test("parseFigmaUrl rejects a node-id that does not normalize to N:N form", () => {
  assert.throws(
    () => parseFigmaUrl("https://www.figma.com/design/ExampleFileKey123/Name?node-id=abc"),
    /node-id.*must normalize/u
  );
});
