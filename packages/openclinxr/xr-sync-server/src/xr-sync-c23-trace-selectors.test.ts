import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C23b grade fixes (RED planted by root, 2026-10-31):
//   1 A trace whose cast carries topicAnswers that is present but not an array refuses that station's replay join
//     ("replay-bad-trace"), like a malformed element does; the unmutated trace replays (known-good).
//   2 dialogueSeeds with a repeated seedId inside one cast scenario refuses boot naming "dialogueSeeds", so a
//     persisted `${actorId}:seed:${seedId}` selector names one authored answer.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 3, noteSeconds: 1, breakAfterStationOrders: [] };
const neverFires = <T extends { eventSchedule: Array<{ atSecond: number }> }>(scenario: T): T => ({
  ...scenario,
  status: "approved",
  eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })),
});
const KNEE = neverFires(clinicKneePainScenario);
const CHEST = neverFires(edChestPainScenario);
const INDEX_FILE = "exam-session.review-index.json";
const TRACE_SUFFIX = ".conversation-trace.json";
const kneeSeeds = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === KNEE.scenarioId)?.seeds ?? [];
const jordan = KNEE.actors[0]?.actorId ?? "";

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c23b-selectors",
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
afterEach(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

const bootServer = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const live = (server: EncounterServer): { phase: string } => JSON.parse(server.getStateJSON()) as { phase: string };

/** Record a cast session where Jordan answers one authored topic; returns the trace dir. */
async function recordSession(): Promise<string> {
  const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c23b-sel-"));
  const server = await bootServer({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: scenarioDialogueSeedBank, traceDir });
  servers.push(server);
  const learner: SyncConnection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
  leavers.push(() => learner.leave());
  await waitFor(() => live(server).phase === "encounter", 5000, "encounter");
  for (const payload of [{}, { topicTag: "mechanism_of_injury_history" }]) {
    expect(await learner.sendIntent("select-actor", { actorId: jordan })).toMatchObject({ status: "ack" });
    expect(await learner.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
    expect(await learner.sendIntent("utterance-end", { actorId: jordan, ...payload })).toMatchObject({ status: "ack" });
  }
  await waitFor(() => readdirSync(traceDir).includes(INDEX_FILE), 30000, "review index");
  await server.close();
  return traceDir;
}

function slotATraceFile(traceDir: string): string {
  for (const name of readdirSync(traceDir).filter((file) => file.endsWith(TRACE_SUFFIX))) {
    const trace = JSON.parse(readFileSync(join(traceDir, name), "utf8")) as { stationId: string };
    if (trace.stationId === "slot-a") return join(traceDir, name);
  }
  throw new Error("no slot-a trace");
}

describe("xr-sync-server C23b trace selectors and seed ids", () => {
  it("known-good: the recorded C23 trace replays; a non-array topicAnswers refuses the station's replay join", async () => {
    const traceDir = await recordSession();
    const file = slotATraceFile(traceDir);
    const trace = JSON.parse(readFileSync(file, "utf8")) as { cast?: Record<string, unknown> };
    expect(Array.isArray(trace.cast?.["topicAnswers"])).toBe(true);
    const replay = await bootServer({ replayDir: traceDir, replayStepMs: 10 });
    servers.push(replay);
    const reviewer = await connect(replay.url, { roomOptions: { replayStationId: "slot-a" } });
    await reviewer.leave();
    for (const bad of ["x", {}, 7, null]) {
      writeFileSync(file, JSON.stringify({ ...trace, cast: { ...trace.cast, topicAnswers: bad } }));
      const server = await bootServer({ replayDir: traceDir, replayStepMs: 10 });
      servers.push(server);
      await expect(connect(server.url, { roomOptions: { replayStationId: "slot-a" } }), JSON.stringify(bad)).rejects.toThrow();
    }
  }, 60000);

  it("refuses a repeated seedId within one cast scenario", async () => {
    const [first, second] = kneeSeeds.filter((seed) => seed.actorId === jordan && seed.safetyExpectation === "responds_from_visible_facts");
    if (!first || !second) throw new Error("fixture needs two Jordan seeds");
    const twin = { ...second, seedId: first.seedId };
    await expect(
      bootServer({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: [{ scenarioId: KNEE.scenarioId, seeds: [first, twin] }] }),
    ).rejects.toThrow(/dialogueSeeds/);
  }, 20000);
});
