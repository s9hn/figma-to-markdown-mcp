export function parseFigmaUrl(figmaUrl) {
  if (typeof figmaUrl !== "string" || figmaUrl.trim() === "") {
    throw new Error("`figma_url` must be a non-empty string.");
  }

  let url;
  try {
    url = new URL(figmaUrl);
  } catch {
    throw new Error("`figma_url` must be a valid URL.");
  }

  // Branch URLs: /design/{fileKey}/{name}/branch/{branchKey}/... — use branchKey as the effective file key.
  // Standard URLs: /design/{fileKey}/... or /file/{fileKey}/...
  const branchMatch = url.pathname.match(/\/branch\/([^/]+)/);
  const standardMatch = url.pathname.match(/\/(?:file|design)\/([^/]+)/);
  const pathMatch = branchMatch ?? standardMatch;
  if (!pathMatch) {
    throw new Error(
      "Could not extract file key from Figma URL. " +
        "Expected path like /design/FILE_KEY/... or /file/FILE_KEY/..."
    );
  }
  const fileKey = pathMatch[1];

  const rawNodeId = url.searchParams.get("node-id");
  if (!rawNodeId) {
    throw new Error("Figma URL must include a `node-id` query parameter.");
  }

  const nodeId = rawNodeId.replace(/-/gu, ":");
  if (!/^\d+:\d+$/u.test(nodeId)) {
    throw new Error("`node-id` must normalize to the form `123:456`.");
  }

  return { fileKey, nodeId };
}
