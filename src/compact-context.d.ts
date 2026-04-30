export interface SerializeDesignContextToCompactContextOptions {
  fileKey: string;
  nodeId: string;
  contentBlocks: string[];
  metadataBlocks?: string[];
  mode?: "minimal" | "balanced" | "debug";
  task?: "implement" | "inspect" | "summarize";
  includeAssets?: boolean;
  includeTextSpecs?: boolean;
  includeTraceIds?: boolean;
  warningLines?: string[];
}

export function serializeDesignContextToCompactContext(
  options: SerializeDesignContextToCompactContextOptions
): string;
