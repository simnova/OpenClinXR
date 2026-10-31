import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterAll, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C20 RED (planted by root, 2026-10-31): faculty score a replayed cast station against ITS scenario's reviewRubric.
// Contract (names are the spec):
//   createEncounterServer({ replayDir, scoreDir, scenarios }) - scenarios is a Scenario[] bank (server config only).
//   A replayed station whose trace carries a C18 scenarioId found in scenarios is scored against that scenario's
//   reviewRubric: rubric ids = reviewRubric[].rubricId, in order. Replay state carries replayRubric
//   [{ id, label }] for the station being replayed ([] when the station has no scenario rubric) so the headset can
//   show the checklist. score-station validates the items key set against that rubric ("invalid-score" otherwise).
//   The score file gains scenarioId and its items follow the scenario rubric order; no label text in the file
//   (C13 rule). A station whose scenarioId is not in scenarios rejects score-station "scoring-disabled".
//   Boot refuses scenarios together with reviewRubric (message names both "scenarios" and "reviewRubric"). Without scenarios, C13
//   behaviour (server reviewRubric for every station) is unchanged.
// Fixture note: the recorded session is a C16 cast session (knee approved copy, C16 precedent); timings illustrative.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 3, noteSeconds: 1, breakAfterStationOrders: [] };
const KNEE_APPROVED = { ...clinicKneePainScenario, status: "approved" as const };
const CHEST = edChestPainScenario;
const INDEX_FILE = "exam-session.review-index.json";
const STEP_MS = 50;

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c20",
    title: "Fixture two-station form",
    stationSlots: [
      { slotId: "slot-a", order: 1, label: "Fixture label A", requiredEnvironmentIds: [], requiredTraceTags: [] },
      { slotId: "slot-b", order: 2, label: "Fixture label B", requiredEnvironmentIds: [], requiredTraceTags: [] },
    ],
    timing: TIMING,
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
}

const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
afterAll(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

const bootServer = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
async function boot(options: Record<string, unknown>): Promise<EncounterServer> {
  const server = await bootServer(options);
  servers.push(server);
  return server;
}
async function joinRoom(server: EncounterServer, roomOptions: Record<string, unknown>): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions });
  leavers.push(() => connection.leave());
  return connection;
}
async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** One recorded cast session (slot-a chest, slot-b knee) shared by every clause. */
let recorded: Promise<string> | null = null;
function recordCastSession(): Promise<string> {
  recorded ??= (async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c20-trace-"));
    const server = await boot({ examBlueprint: blueprint(), scenarios: [CHEST, KNEE_APPROVED], traceDir });
    await joinRoom(server, { actors: ["a1", "a2"] });
    await waitFor(() => readdirSync(traceDir).includes(INDEX_FILE), 30000, "review index");
    await server.close();
    return traceDir;
  })();
  return recorded;
}

type ReplayState = { replayDone?: boolean; replayRubric?: Array<{ id: string; label: string }>; scoreChecked?: number };
async function replayStation(options: Record<string, unknown>, stationId: string) {
  const server = await boot({ replayStepMs: STEP_MS, ...options });
  const reviewer = await joinRoom(server, { replayStationId: stationId });
  let last: ReplayState = {};
  reviewer.onState((raw) => {
    last = raw as ReplayState;
  });
  await waitFor(() => last.replayDone === true, 20000, "replayDone");
  return { reviewer, state: () => last };
}
const rubricIds = (scenario: typeof CHEST): string[] => scenario.reviewRubric.map((item) => item.rubricId);
const allChecked = (scenario: typeof CHEST): Record<string, boolean> =>
  Object.fromEntries(rubricIds(scenario).map((id, index) => [id, index % 2 === 0]));

describe("xr-sync-server C20 scenario review rubric", () => {
  it("known-good: with a server reviewRubric and no scenarios, C13 scoring still validates against it", async () => {
    const replayDir = await recordCastSession();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c20-score-"));
    const { reviewer } = await replayStation({ replayDir, scoreDir, reviewRubric: [{ id: "r1", label: "R1" }] }, "slot-a");
    expect(await reviewer.sendIntent("score-station", { items: { r1: true } })).toMatchObject({ status: "ack" });
  }, 60000);

  it("the replay state carries the station's scenario rubric for the headset checklist", async () => {
    const replayDir = await recordCastSession();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c20-score-"));
    const { state } = await replayStation({ replayDir, scoreDir, scenarios: [CHEST, KNEE_APPROVED] }, "slot-b");
    expect(state().replayRubric).toEqual(KNEE_APPROVED.reviewRubric.map((item) => ({ id: item.rubricId, label: item.label })));
  }, 60000);

  it("score-station validates against the station's own scenario rubric", async () => {
    const replayDir = await recordCastSession();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c20-score-"));
    const { reviewer } = await replayStation({ replayDir, scoreDir, scenarios: [CHEST, KNEE_APPROVED] }, "slot-a");
    expect(await reviewer.sendIntent("score-station", { items: allChecked(KNEE_APPROVED) })).toMatchObject({
      status: "reject",
      reason: "invalid-score",
    });
    expect(await reviewer.sendIntent("score-station", { items: allChecked(CHEST) })).toMatchObject({ status: "ack" });
  }, 60000);

  it("the score file names the scenario and follows its rubric order, with no label text", async () => {
    const replayDir = await recordCastSession();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c20-score-"));
    const { reviewer } = await replayStation({ replayDir, scoreDir, scenarios: [CHEST, KNEE_APPROVED] }, "slot-a");
    expect(await reviewer.sendIntent("score-station", { items: allChecked(CHEST) })).toMatchObject({ status: "ack" });
    const text = readFileSync(join(scoreDir, "slot-a.faculty-score.json"), "utf8");
    const file = JSON.parse(text) as { scenarioId?: unknown; items: Array<{ id: string; checked: boolean }>; rubricSize: number };
    expect(file.scenarioId).toBe(CHEST.scenarioId);
    expect(file.items).toEqual(rubricIds(CHEST).map((id, index) => ({ id, checked: index % 2 === 0 })));
    expect(file.rubricSize).toBe(CHEST.reviewRubric.length);
    for (const item of CHEST.reviewRubric) expect(text).not.toContain(item.label);
  }, 60000);

  it("a station whose scenario is not in the bank cannot be scored", async () => {
    const replayDir = await recordCastSession();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c20-score-"));
    const { reviewer, state } = await replayStation({ replayDir, scoreDir, scenarios: [CHEST] }, "slot-b");
    expect(state().replayRubric).toEqual([]);
    expect(await reviewer.sendIntent("score-station", { items: allChecked(KNEE_APPROVED) })).toMatchObject({
      status: "reject",
      reason: "scoring-disabled",
    });
  }, 60000);

  it("boot refuses scenarios together with a server reviewRubric", async () => {
    const replayDir = await recordCastSession();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c20-score-"));
    await expect(
      bootServer({ replayDir, scoreDir, scenarios: [CHEST], reviewRubric: [{ id: "r1", label: "R1" }] }),
    ).rejects.toThrow(/scenarios[\s\S]*reviewRubric|reviewRubric[\s\S]*scenarios/);
  }, 60000);
});
