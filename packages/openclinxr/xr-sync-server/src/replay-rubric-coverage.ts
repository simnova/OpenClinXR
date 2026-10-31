import type { TraceTagRubricCoverage } from "./trace-tag-coverage.js";

export interface ReplayRubricCoverageCount {
  id: string;
  observedCount: number;
  requiredCount: number;
}

/** Replay reads persisted index coverage; it never recomputes coverage from trace events. */
export function replayRubricCoverageCounts(coverage: readonly TraceTagRubricCoverage[]): ReplayRubricCoverageCount[] {
  return coverage.map((entry) => ({
    id: entry.rubricId,
    observedCount: entry.observedTags.length,
    requiredCount: entry.observedTags.length + entry.missingTags.length,
  }));
}
