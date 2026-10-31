import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

const SCENARIO = edChestPainScenario;
const STATION_ID = "slot-a";
const TRACE_FILE = "slot-a.conversation-trace.json";

function writeReplayDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-c22-replay-"));
  writeFileSync(join(dir, TRACE_FILE), JSON.stringify({
    schema: "openclinxr.xr-sync.conversation-trace.v1",
    stationId: STATION_ID,
    scenarioId: SCENARIO.scenarioId,
    events: [],
    turns: [],
    emotions: [],
  }));
  const recorded = SCENARIO.reviewRubric.at(-1);
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
      rubricCoverage: recorded === undefined ? [] : [{
        rubricId: recorded.rubricId,
        observedTags: recorded.requiredTraceTags.slice(0, 1),
        missingTags: [],
      }],
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

async function boot(options: Record<string, unknown>): Promise<EncounterServer> {
  const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)(options);
  servers.push(server);
  return server;
}

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

describe("xr-sync-server C22 replay alignment", () => {
  it("does not seed scoreChecked from a scenario score file that fails the scenario rubric validator", async () => {
    const replayDir = writeReplayDir();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c22-score-"));
    const rubric = SCENARIO.reviewRubric.map((item) => ({ id: item.rubricId, checked: true }));
    writeFileSync(join(scoreDir, `${STATION_ID}.faculty-score.json`), JSON.stringify({
      schema: "openclinxr.xr-sync.faculty-score.v1",
      stationId: STATION_ID,
      scenarioId: "wrong-scenario",
      items: rubric,
      checkedCount: rubric.length,
      rubricSize: rubric.length,
    }));
    const server = await boot({ replayDir, scoreDir, scenarios: [SCENARIO], replayStepMs: 10 });
    const reviewer = await joinReplay(server);
    let checked: number | undefined;
    reviewer.onState((state) => { checked = state.scoreChecked; });
    await waitFor(() => checked !== undefined, "score state");
    expect(checked).toBe(0);
  });

  it("aligns replayRubricCoverage to the scenario rubric ids and required counts", async () => {
    const replayDir = writeReplayDir();
    const server = await boot({ replayDir, scenarios: [SCENARIO], replayStepMs: 10 });
    const reviewer = await joinReplay(server);
    let coverage: Array<{ id: string; observedCount: number; requiredCount: number }> | undefined;
    reviewer.onState((state) => { coverage = state.replayRubricCoverage; });
    await waitFor(() => coverage !== undefined, "coverage state");
    const recorded = SCENARIO.reviewRubric.at(-1);
    expect(coverage).toEqual(SCENARIO.reviewRubric.map((item) => ({
      id: item.rubricId,
      observedCount: item.rubricId === recorded?.rubricId ? Math.min(1, item.requiredTraceTags.length) : 0,
      requiredCount: item.requiredTraceTags.length,
    })));
  });
});
