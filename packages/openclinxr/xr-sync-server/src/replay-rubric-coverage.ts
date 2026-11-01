import type { TraceTagRubricCoverage } from "./trace-tag-coverage.js";
import { readScoreChecked, type ReviewRubricItem } from "./faculty-score.js";
import { readValidScenarioScoreFile } from "./scenario-rubric.js";

export interface ReplayRubricCoverageCount {
  id: string;
  observedCount: number;
  requiredCount: number;
}

/** Replay reads persisted index coverage; it never recomputes coverage from trace events. */
export function replayRubricCoverageCounts(
  coverage: readonly TraceTagRubricCoverage[],
  rubric?: ReadonlyArray<{ id: string; requiredTraceTags?: string[] }>,
): ReplayRubricCoverageCount[] {
  if (rubric === undefined) {
    return coverage.map((entry) => ({
      id: entry.rubricId,
      observedCount: entry.observedTags.length,
      requiredCount: entry.observedTags.length + entry.missingTags.length,
    }));
  }
  const byId = new Map(coverage.map((entry) => [entry.rubricId, entry]));
  return rubric.map((item) => ({
    id: item.id,
    observedCount: byId.get(item.id)?.observedTags.length ?? 0,
    requiredCount: new Set(item.requiredTraceTags ?? []).size,
  }));
}

/** Seed replay score state through the same strict validator as badges/sign-off. */
export function replayScoreChecked(
  scoreDir: string | null,
  stationId: string,
  scenarioBank: Map<string, ReviewRubricItem[]> | null,
  scenario: { scenarioId: string; rubric: ReviewRubricItem[] } | null,
): number {
  if (scenarioBank === null) {
    return readScoreChecked(scoreDir, stationId);
  }
  if (scoreDir === null || scenario === null) {
    return 0;
  }
  return readValidScenarioScoreFile(scoreDir, stationId, scenario.scenarioId, scenario.rubric)?.checkedCount ?? 0;
}
