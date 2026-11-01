import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C23 RED (carried C22 defect): replay requiredCount must count each required
// trace tag once, as the C21 index coverage does (trace-tag-coverage.ts).
const STATION_ID = "slot-a";
const TRACE_FILE = "slot-a.conversation-trace.json";
const SCENARIO = {
  ...edChestPainScenario,
  reviewRubric: [
    // Listed twice and recorded in the index: 2 distinct tags.
    { rubricId: "c23-dup-recorded", label: "C23 duplicate recorded", requiredTraceTags: ["c23_a", "c23_a", "c23_b"] },
    // Listed twice, absent from the index (the fallback path): 1 distinct tag.
    { rubricId: "c23-dup-absent", label: "C23 duplicate absent", requiredTraceTags: ["c23_c", "c23_c"] },
    // Counterweight: three distinct tags, absent from the index.
    { rubricId: "c23-distinct", label: "C23 distinct", requiredTraceTags: ["c23_d", "c23_e", "c23_f"] },
  ],
};

function writeReplayDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-c23-replay-"));
  writeFileSync(join(dir, TRACE_FILE), JSON.stringify({
    schema: "openclinxr.xr-sync.conversation-trace.v1",
    stationId: STATION_ID,
    scenarioId: SCENARIO.scenarioId,
    events: [],
    turns: [],
    emotions: [],
  }));
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
    schema: "openclinxr.xr-sync.exam-session-review-index.v1",
    complete: true,
    stationCount: 1,
    stations: [{
      stationId: STATION_ID,
      stationIndex: 0,
      traceFile: TRACE_FILE,
      phases: ["doorway", "encounter", "note", "closed"],
      turnCount: 0,
      turnEnds: [],
      observerPresent: false,
      notePresent: false,
      noteChars: 0,
      noteFile: null,
      rubricCoverage: [{ rubricId: "c23-dup-recorded", observedTags: ["c23_a"], missingTags: ["c23_b"] }],
    }],
  }));
  return dir;
}

const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

async function joinReplay(server: EncounterServer): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions: { replayStationId: STATION_ID } });
  leavers.push(() => connection.leave());
  return connection;
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("xr-sync-server C23 replay requiredCount", () => {
  it("counts a rubric item's required trace tags once each, recorded or not", async () => {
    const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)({
      replayDir: writeReplayDir(),
      scenarios: [SCENARIO],
      replayStepMs: 10,
    });
    servers.push(server);
    const reviewer = await joinReplay(server);
    let coverage: Array<{ id: string; observedCount: number; requiredCount: number }> | undefined;
    reviewer.onState((state) => { coverage = state.replayRubricCoverage; });
    await waitFor(() => coverage !== undefined && coverage.length > 0, "coverage state");
    expect(coverage).toEqual([
      { id: "c23-dup-recorded", observedCount: 1, requiredCount: 2 },
      { id: "c23-dup-absent", observedCount: 0, requiredCount: 1 },
      { id: "c23-distinct", observedCount: 0, requiredCount: 3 },
    ]);
  });
});
