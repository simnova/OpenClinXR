import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C16 RED (planted by root, 2026-10-30): each blueprint station is cast from its scenario.
// Contract (names are the spec):
//   createEncounterServer({ examBlueprint, scenarios }) where scenarios is a @openclinxr/shared-schemas Scenario[]
//   aligned to the blueprint's slots sorted by (order, slotId): scenarios[i] fills slot i (the same mapping
//   @openclinxr/exam-assembly assembleExamForm uses).
//   Boot refuses (rejects, message names "scenarios"): scenarios without examBlueprint; scenarios.length !== slot
//   count; any scenario whose status is not "approved" (assembleExamForm's rule).
//   Per station (live state): scenarioId and scenarioTitle of the slot's scenario ("" without scenarios);
//   actors = exactly that scenario's actors[].actorId (the default physician/patient roster and client
//   roomOptions.actors are ignored on a cast station); each actor's emotion starts at scenario.emotionPolicy.baseline
//   when the scenario has one, else "neutral"; select-actor for an id outside the cast rejects "unknown-actor".
//   C9 review index (cast session): each station entry carries scenarioId.
//   Without scenarios, C15 behaviour is unchanged.
// Fixture note: the knee scenario is a bank draft; the test copies it with status "approved" to build a two-scenario
// form (the bank holds one approved scenario). Slot ids, labels and 1 s timings are illustrative.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1, breakAfterStationOrders: [] };
const SESSION_TIMEOUT_MS = 15000;
const INDEX_FILE = "exam-session.review-index.json";
const KNEE_APPROVED = { ...clinicKneePainScenario, status: "approved" };
const CHEST = edChestPainScenario;

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c16",
    title: "Fixture two-station form",
    stationSlots: [
      { slotId: "slot-b", order: 2, label: "Fixture label B", requiredEnvironmentIds: [], requiredTraceTags: [] },
      { slotId: "slot-a", order: 1, label: "Fixture label A", requiredEnvironmentIds: [], requiredTraceTags: [] },
    ],
    timing: TIMING,
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
}

const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

const boot = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
async function start(options: Record<string, unknown>): Promise<EncounterServer> {
  const server = await boot(options);
  servers.push(server);
  return server;
}
async function joinLearner(server: EncounterServer, actors: string[] = ["a1", "a2"]): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions: { actors } });
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

type LiveState = {
  stationId: string;
  phase: string;
  scenarioId?: unknown;
  scenarioTitle?: unknown;
  actors: Record<string, { id: string; emotion: string }>;
};
const state = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;
const castIds = (scenario: { actors: Array<{ actorId: string }> }): string[] => scenario.actors.map((a) => a.actorId);

describe("xr-sync-server C16 scenario cast", () => {
  it("known-good: a blueprint server without scenarios keeps the default roster and empty scenario fields", async () => {
    const server = await start({ examBlueprint: blueprint() });
    await joinLearner(server);
    const s = state(server);
    expect(Object.keys(s.actors).sort()).toEqual(["a1", "a2", "patient", "physician"]);
    expect([s.scenarioId ?? "", s.scenarioTitle ?? ""]).toEqual(["", ""]);
  }, 20000);

  it("the first station is cast from scenarios[0]: ids, title, exact roster, neutral baseline", async () => {
    const server = await start({ examBlueprint: blueprint(), scenarios: [CHEST, KNEE_APPROVED] });
    await joinLearner(server, ["intruder"]);
    const s = state(server);
    expect(s.stationId).toBe("slot-a");
    expect([s.scenarioId, s.scenarioTitle]).toEqual([CHEST.scenarioId, CHEST.title]);
    expect(Object.keys(s.actors).sort()).toEqual([...castIds(CHEST)].sort());
    expect(Object.values(s.actors).map((a) => a.emotion)).toEqual(castIds(CHEST).map(() => "neutral"));
  }, 20000);

  it("a scenario emotionPolicy sets the cast's starting emotion", async () => {
    const baseline = KNEE_APPROVED.emotionPolicy?.baseline;
    expect(baseline).toBeDefined();
    const server = await start({ examBlueprint: blueprint(), scenarios: [KNEE_APPROVED, CHEST] });
    await joinLearner(server);
    const s = state(server);
    expect(s.scenarioId).toBe(KNEE_APPROVED.scenarioId);
    expect(Object.keys(s.actors).sort()).toEqual([...castIds(KNEE_APPROVED)].sort());
    expect(new Set(Object.values(s.actors).map((a) => a.emotion))).toEqual(new Set([baseline]));
  }, 20000);

  it("select-actor outside the cast rejects unknown-actor; a cast actor is accepted", async () => {
    const server = await start({ examBlueprint: blueprint(), scenarios: [CHEST, KNEE_APPROVED] });
    const learner = await joinLearner(server);
    await waitFor(() => state(server).phase === "encounter", 5000, "encounter");
    const outsider = await learner.sendIntent("select-actor", { actorId: "physician" });
    expect(outsider).toMatchObject({ status: "reject", reason: "unknown-actor" });
    const cast = await learner.sendIntent("select-actor", { actorId: castIds(CHEST)[0] });
    expect(cast).toMatchObject({ status: "ack" });
  }, 20000);

  it("the second station is recast live and the review index records each scenario", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c16-"));
    const server = await start({ examBlueprint: blueprint(), scenarios: [CHEST, KNEE_APPROVED], traceDir });
    await joinLearner(server);
    await waitFor(() => state(server).stationId === "slot-b", SESSION_TIMEOUT_MS, "second station");
    const second = state(server);
    expect([second.scenarioId, second.scenarioTitle]).toEqual([KNEE_APPROVED.scenarioId, KNEE_APPROVED.title]);
    expect(Object.keys(second.actors).sort()).toEqual([...castIds(KNEE_APPROVED)].sort());
    await waitFor(() => readdirSync(traceDir).includes(INDEX_FILE), SESSION_TIMEOUT_MS * 2, "review index");
    const index = JSON.parse(readFileSync(join(traceDir, INDEX_FILE), "utf8")) as {
      stations: Array<{ stationId: string; scenarioId?: unknown }>;
    };
    expect(index.stations.map((s) => [s.stationId, s.scenarioId])).toEqual([
      ["slot-a", CHEST.scenarioId],
      ["slot-b", KNEE_APPROVED.scenarioId],
    ]);
  }, 40000);

  it("boot refuses scenarios without a blueprint, a count mismatch, or an unapproved scenario", async () => {
    await expect(boot({ scenarios: [CHEST], stations: ["s1"] })).rejects.toThrow(/scenarios/);
    await expect(boot({ examBlueprint: blueprint(), scenarios: [CHEST] })).rejects.toThrow(/scenarios/);
    await expect(boot({ examBlueprint: blueprint(), scenarios: [CHEST, clinicKneePainScenario] })).rejects.toThrow(/scenarios/);
  }, 20000);
});
