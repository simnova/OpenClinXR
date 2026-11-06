/**
 * C13/C20 replay-room rubric state helpers, split out of station-replay.ts for the file-size gate
 * (moved verbatim; labels reach headset state only, never a persisted file).
 */
import { ArraySchema } from "@colyseus/schema";
import { replayRubricCoverageCounts } from "./replay-rubric-coverage.js";
import { ReplayRubricCoverageState, type ReplayRubricCoverageStateInstance, ReplayRubricState, type ReplayRubricStateInstance } from "./schema.js";

/**
 * Fill replay-room state.replayRubric with the station's scenario checklist
 * (labels reach headset state only, never a persisted file). Null rubric
 * means the station has no scenario rubric: the state carries [].
 */
export function setReplayRubricState(state: { replayRubric: unknown }, rubric: { id: string; label: string }[] | null): void {
  const rows = new ArraySchema<ReplayRubricStateInstance>();
  for (const entry of rubric ?? []) {
    const row = new ReplayRubricState();
    row.id = entry.id;
    row.label = entry.label;
    rows.push(row);
  }
  (state as { replayRubric: typeof rows }).replayRubric = rows;
}

export function setReplayRubricCoverageState(
  state: { replayRubricCoverage: unknown },
  coverage: Array<{ rubricId: string; observedTags: string[]; missingTags: string[] }> | null,
  rubric: Array<{ id: string; requiredTraceTags?: string[] }> | null = null,
): void {
  const rows = new ArraySchema<ReplayRubricCoverageStateInstance>();
  for (const entry of replayRubricCoverageCounts(coverage ?? [], rubric ?? undefined)) {
    const row = new ReplayRubricCoverageState();
    row.id = entry.id;
    row.observedCount = entry.observedCount;
    row.requiredCount = entry.requiredCount;
    rows.push(row);
  }
  (state as { replayRubricCoverage: typeof rows }).replayRubricCoverage = rows;
}
