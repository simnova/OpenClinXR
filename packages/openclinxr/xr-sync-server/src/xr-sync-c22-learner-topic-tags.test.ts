import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C22 RED (planted by root, 2026-10-31): on a cast station the learner names what they are asking about, and the
// C21 review coverage counts it.
// Contract (names are the spec):
//   Cast station state topicMenu: string[] = the station scenario's requiredTraceTags, deduped, scenario order,
//   minus "patient_note_submitted" (that tag comes from the note, C21). Off a cast station topicMenu is [].
//   utterance-end payload may carry topicTag. On a cast station: a string in topicMenu is accepted and the trace's
//   utterance-end event records tag = topicTag (so C21 producedTraceTags counts it); a string not in topicMenu
//   rejects "unknown-topic" and opens no turn; a non-string rejects "bad-utterance-payload". The actor's reply is
//   unchanged (C3/C17). Without topicTag nothing changes. Off a cast station topicTag is ignored (C3 rule: client
//   fields other than actorId are ignored) and the trace event carries no tag.
// Fixture: both schedules copied to atSecond = the encounter length so they never fire (C19 clause 3), which leaves
// the learner as the only tag source. Timings are illustrative test values.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 5, noteSeconds: 1, breakAfterStationOrders: [] };
const neverFires = <T extends { eventSchedule: Array<{ atSecond: number }> }>(scenario: T): T => ({
  ...scenario,
  status: "approved",
  eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })),
});
const CHEST = neverFires(edChestPainScenario);
const KNEE = neverFires(clinicKneePainScenario);
const INDEX_FILE = "exam-session.review-index.json";
const TRACE_SUFFIX = ".conversation-trace.json";
const NOTE_TAG = "patient_note_submitted";
const menuOf = (scenario: { requiredTraceTags: string[] }): string[] =>
  [...new Set(scenario.requiredTraceTags)].filter((tag) => tag !== NOTE_TAG);

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c22",
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
async function boot(options: Record<string, unknown>): Promise<EncounterServer> {
  const server = await bootServer(options);
  servers.push(server);
  return server;
}
async function joinRoom(server: EncounterServer): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
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
  turnId: number;
  topicMenu?: unknown;
  actors: Record<string, { speaking: boolean; replyId: string }>;
};
const live = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;
const firstActor = (scenario: typeof CHEST): string => {
  const actor = scenario.actors[0];
  if (!actor) throw new Error("fixture has no actor");
  return actor.actorId;
};
async function ask(learner: SyncConnection, actorId: string, payload: Record<string, unknown>) {
  expect(await learner.sendIntent("select-actor", { actorId })).toMatchObject({ status: "ack" });
  expect(await learner.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
  return learner.sendIntent("utterance-end", payload);
}
type Trace = { stationId: string; events: Array<Record<string, unknown>> };
function readTraces(traceDir: string): Map<string, Trace> {
  const traces = new Map<string, Trace>();
  for (const file of readdirSync(traceDir).filter((name) => name.endsWith(TRACE_SUFFIX))) {
    const trace = JSON.parse(readFileSync(join(traceDir, file), "utf8")) as Trace;
    traces.set(trace.stationId, trace);
  }
  return traces;
}
const utteranceEnds = (trace: Trace | undefined) => (trace?.events ?? []).filter((e) => e["kind"] === "utterance-end");

describe("xr-sync-server C22 learner topic tags", () => {
  it("known-good: off a cast station a topicTag is ignored and the trace carries no tag", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c22-plain-"));
    const server = await boot({ timing: { doorwaySeconds: 1, encounterSeconds: 4, noteSeconds: 1 }, traceDir });
    const learner = await joinRoom(server);
    await waitFor(() => live(server).phase === "encounter", 5000, "encounter");
    expect(await ask(learner, "a1", { topicTag: "history_opqrst" })).toMatchObject({ status: "ack" });
    await server.close();
    const ends = [...readTraces(traceDir).values()].flatMap((trace) => utteranceEnds(trace));
    expect(ends.length).toBe(1);
    expect(ends[0]).not.toHaveProperty("tag");
  }, 20000);

  it("a cast station publishes its own scenario topic menu", async () => {
    const server = await boot({ examBlueprint: blueprint(), scenarios: [CHEST, KNEE] });
    await joinRoom(server);
    await waitFor(() => live(server).phase === "encounter", 5000, "slot-a encounter");
    expect(live(server).topicMenu).toEqual(menuOf(CHEST));
    await waitFor(() => live(server).stationId === "slot-b" && live(server).phase === "encounter", 20000, "slot-b encounter");
    expect(live(server).topicMenu).toEqual(menuOf(KNEE));
  }, 40000);

  it("a topic outside the station's menu is refused and opens no turn", async () => {
    const server = await boot({ examBlueprint: blueprint(), scenarios: [CHEST, KNEE] });
    const learner = await joinRoom(server);
    await waitFor(() => live(server).phase === "encounter", 5000, "encounter");
    const before = live(server).turnId;
    // A knee tag is a real scenario tag, just not this station's.
    expect(await ask(learner, firstActor(CHEST), { topicTag: "weight_bearing_question" })).toMatchObject({
      status: "reject",
      reason: "unknown-topic",
    });
    expect(await learner.sendIntent("utterance-end", { topicTag: NOTE_TAG })).toMatchObject({ status: "reject", reason: "unknown-topic" });
    expect(await learner.sendIntent("utterance-end", { topicTag: 7 })).toMatchObject({ status: "reject", reason: "bad-utterance-payload" });
    expect(live(server).turnId).toBe(before);
    expect(Object.values(live(server).actors).some((a) => a.speaking)).toBe(false);
  }, 20000);

  it("an asked topic is traced and counted by the C21 review coverage", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c22-"));
    const server = await boot({ examBlueprint: blueprint(), scenarios: [CHEST, KNEE], traceDir });
    const learner = await joinRoom(server);
    await waitFor(() => live(server).phase === "encounter", 5000, "encounter");
    const topic = menuOf(CHEST)[0] ?? "";
    const actorId = firstActor(CHEST);
    expect(await ask(learner, actorId, { topicTag: topic })).toMatchObject({ status: "ack" });
    await waitFor(() => live(server).actors[actorId]?.speaking === true, 3000, "reply");
    expect(live(server).actors[actorId]?.replyId).toBe(`${actorId}:opening`);
    await waitFor(() => readdirSync(traceDir).includes(INDEX_FILE), 30000, "review index");
    await server.close();
    expect(utteranceEnds(readTraces(traceDir).get("slot-a"))).toEqual([
      expect.objectContaining({ kind: "utterance-end", actorId, tag: topic }),
    ]);
    const index = JSON.parse(readFileSync(join(traceDir, INDEX_FILE), "utf8")) as { stations: Array<Record<string, unknown>> };
    const slotA = index.stations.find((entry) => entry["stationId"] === "slot-a");
    expect(slotA?.["observedTraceTags"]).toEqual([topic]);
    const holder = CHEST.reviewRubric.find((item) => item.requiredTraceTags.includes(topic));
    const coverage = (slotA?.["rubricCoverage"] as Array<{ rubricId: string; observedTags: string[] }> | undefined) ?? [];
    expect(coverage.find((item) => item.rubricId === holder?.rubricId)?.observedTags).toEqual([topic]);
  }, 40000);
});
