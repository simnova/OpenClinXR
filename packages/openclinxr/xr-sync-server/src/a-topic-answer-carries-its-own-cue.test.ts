import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// FOLLOWUP-2 (card tsk_01ffa76a77357230): the cue-author rule end to end.
// Only the public entrypoint ./index.js is imported relatively: live actor
// cueIds come from server state snapshots, stored cueIds from the persisted
// trace file, replayed cueIds from the replay room's client snapshots. The
// rule under test: a resolved topic answer carries `cue-answer:<replyId>`,
// the cast opening keeps cue-opening-01, anything else keeps the scripted
// C3 cue for its turn count.
const ACTOR = "patient_jordan_cole_v1";
const MECH = "mechanism_of_injury_history";
const ROM = "knee_rom_exam_requested";
const WEATHER = "do you like the weather in june";
const OPENING_CUE = "cue-opening-01";
const TRACE_SUFFIX = ".conversation-trace.json";

const TIMING = { doorwaySeconds: 1, encounterSeconds: 8, noteSeconds: 1, breakAfterStationOrders: [] };
const neverFires = <T extends { eventSchedule: Array<{ atSecond: number }> }>(scenario: T): T => ({
  ...scenario,
  status: "approved",
  eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })),
});
const KNEE = neverFires(clinicKneePainScenario);
const CHEST = { ...edChestPainScenario, status: "approved" };

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-cue",
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
async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
type LiveState = { phase: string; actors: Record<string, { speaking: boolean; replyId: string; cueId: string }> };
const snap = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;

async function ask(server: EncounterServer, learner: SyncConnection, payload: Record<string, unknown>): Promise<{ replyId: string; cueId: string }> {
  expect(await learner.sendIntent("select-actor", { actorId: ACTOR })).toMatchObject({ status: "ack" });
  expect(await learner.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
  expect(await learner.sendIntent("utterance-end", { actorId: ACTOR, ...payload })).toMatchObject({ status: "ack" });
  const actor = snap(server).actors[ACTOR] ?? { speaking: false, replyId: "", cueId: "" };
  return { replyId: actor.replyId, cueId: actor.cueId };
}

interface SharedLive {
  live: Array<{ replyId: string; cueId: string }>;
  stored: Array<{ turnId: number; actorId: string; replyId: string; cueId: string }>;
  traceDir: string;
}
let shared: Promise<SharedLive> | null = null;
function liveRun(): Promise<SharedLive> {
  if (shared === null) {
    shared = (async (): Promise<SharedLive> => {
      const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-cue-"));
      const server = await boot({ examBlueprint: blueprint(), scenarios: [KNEE, CHEST], dialogueSeeds: scenarioDialogueSeedBank, traceDir });
      const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
      leavers.push(() => learner.leave());
      await waitFor(() => snap(server).phase === "encounter", 5000, "slot-a encounter");
      const live = [
        await ask(server, learner, {}),
        await ask(server, learner, { topicTag: MECH }),
        await ask(server, learner, { topicTag: MECH }),
        await ask(server, learner, { topicTag: ROM }),
        await ask(server, learner, { text: WEATHER }),
        await ask(server, learner, { text: WEATHER }),
      ];
      await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), 30000, "review index");
      await server.close();
      const name = readdirSync(traceDir).find(
        (entry) => entry.endsWith(TRACE_SUFFIX) && (JSON.parse(readFileSync(join(traceDir, entry), "utf8")) as { stationId: string }).stationId === "slot-a",
      );
      if (name === undefined) throw new Error("no slot-a trace");
      const trace = JSON.parse(readFileSync(join(traceDir, name), "utf8")) as {
        turns: Array<{ turnId: number; actorId: string; replyId: string; cueId: string }>;
      };
      return { live, stored: trace.turns, traceDir };
    })();
  }
  return shared;
}

type ObservedTurn = { turnId: number; actorId: string; replyId: string; cueId: string };
async function replayObserved(replayDir: string, stationId: string, scenarios: unknown[]): Promise<ObservedTurn[]> {
  const server = await boot({ replayDir, replayStepMs: 120, scenarios, dialogueSeeds: scenarioDialogueSeedBank });
  const conn = await connect(server.url, { roomOptions: { replayStationId: stationId } });
  leavers.push(() => conn.leave());
  const seen: ObservedTurn[] = [];
  let done = false;
  conn.onState((raw) => {
    const s = raw as { replayDone?: boolean; turnId?: number; actors?: Record<string, { speaking: boolean; replyId: string; cueId: string } | undefined> };
    const turnId = s.turnId ?? 0;
    for (const [id, actor] of Object.entries(s.actors ?? {})) {
      if (actor?.speaking === true && !seen.some((t) => t.turnId === turnId && t.actorId === id)) {
        seen.push({ turnId, actorId: id, replyId: actor.replyId, cueId: actor.cueId });
      }
    }
    if (s.replayDone === true) done = true;
  });
  await waitFor(() => done, 30000, "replayDone");
  return seen;
}

const strip = (turns: Array<{ turnId: number; actorId: string; replyId: string; cueId: string }>): ObservedTurn[] =>
  turns.map((t) => ({ turnId: t.turnId, actorId: t.actorId, replyId: t.replyId, cueId: t.cueId }));

describe("topic answers carry their own cue (end to end)", () => {
  it("C1: two turns resolving to the SAME topic answer carry the same cueId, exactly cue-answer plus replyId", async () => {
    const { live, stored } = await liveRun();
    expect(live[1]?.replyId).toBe(live[2]?.replyId);
    expect(live[2]?.cueId).toBe(live[1]?.cueId);
    expect(live[2]?.cueId).toBe(`cue-answer:${live[2]?.replyId}`);
    expect(stored[1]?.replyId).toBe(live[1]?.replyId);
    expect(stored[1]?.cueId).toBe(live[1]?.cueId);
    expect(stored[2]?.replyId).toBe(live[2]?.replyId);
    expect(stored[2]?.cueId).toBe(live[2]?.cueId);
  }, 120000);

  it("C2 counterweight: two DIFFERENT topic answers on the same actor carry different cueIds", async () => {
    const { live, stored } = await liveRun();
    expect(live[1]?.replyId).not.toBe(live[3]?.replyId);
    expect(live[1]?.cueId).toBe(`cue-answer:${live[1]?.replyId}`);
    expect(live[3]?.cueId).toBe(`cue-answer:${live[3]?.replyId}`);
    expect(live[1]?.cueId).not.toBe(live[3]?.cueId);
    expect(stored[1]?.cueId).toBe(live[1]?.cueId);
    expect(stored[3]?.cueId).toBe(live[3]?.cueId);
  }, 120000);

  it("C3 known-good: the cast opening keeps the opening cue; fallback keeps the scripted C3 cue by turn count", async () => {
    const { live, stored } = await liveRun();
    expect(live[0]?.replyId).toBe(`${ACTOR}:opening`);
    expect(live[0]?.cueId).toBe(OPENING_CUE);
    expect(live[4]?.cueId).toBe("cue-followup-02");
    expect(live[5]?.cueId).toBe("cue-recap-03");
    expect(strip(stored)).toEqual(live.map((turn, index) => ({ turnId: index + 1, actorId: ACTOR, replyId: turn.replyId, cueId: turn.cueId })));
  }, 120000);

  it("C3 no-cast counterweight: without a cast the scripted C3 cues by turn count agree in live and stored", async () => {
    // No blueprint/scenarios: the default roster, no cast voice, no topic
    // answers. The scripted table (conversation-trace.ts C3_REPLY_TABLE,
    // picked by (turnCount-1)%3) gives turns 1..3 cue-greeting-01,
    // cue-followup-02, cue-recap-03. Live cueIds come from server state,
    // stored cueIds from the trace file persisted on dispose.
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-cue-nocast-"));
    const server = await boot({ traceDir });
    const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
    leavers.push(() => learner.leave());
    const live: string[] = [];
    for (let i = 0; i < 3; i++) {
      expect(await learner.sendIntent("select-actor", { actorId: "a1" })).toMatchObject({ status: "ack" });
      expect(await learner.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
      expect(await learner.sendIntent("utterance-end", { actorId: "a1" })).toMatchObject({ status: "ack" });
      live.push(snap(server).actors["a1"]?.cueId ?? "");
    }
    await server.close();
    const expected = ["cue-greeting-01", "cue-followup-02", "cue-recap-03"];
    expect(live).toEqual(expected);
    let name: string | undefined;
    await waitFor(() => {
      name = readdirSync(traceDir).find((entry) => entry.endsWith(TRACE_SUFFIX));
      return name !== undefined;
    }, 15000, "no-cast trace file");
    const trace = JSON.parse(readFileSync(join(traceDir, name as string), "utf8")) as {
      turns: Array<{ turnId: number; actorId: string; cueId: string }>;
    };
    expect(trace.turns.map((turn) => turn.turnId)).toEqual([1, 2, 3]);
    expect(trace.turns.map((turn) => turn.cueId)).toEqual(expected);
    expect(trace.turns.map((turn) => turn.cueId)).toEqual(live);
  }, 120000);

  it("S0 LIVE==REPLAY: the live turn cueIds in the stored trace equal the cueIds the replayed station shows", async () => {
    const { live, stored, traceDir } = await liveRun();
    const replayed = await replayObserved(traceDir, "slot-a", [KNEE, CHEST]);
    expect(replayed).toEqual(strip(stored));
    expect(replayed.map((t) => t.cueId)).toEqual(live.map((t) => t.cueId));
  }, 120000);

  it("STORED_EQ fixture guard (passes under a reducer revert by design): every stored c46 fixture turn cue equals what the replay produces", async () => {
    const fixture = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "xr-sync-c46-nurse-two-topic.fixture.json"), "utf8"),
    ) as { trace: { stationId: string; turns: Array<{ turnId: number; actorId: string; replyId: string; cueId: string }> } };
    const dir = mkdtempSync(join(tmpdir(), "xr-sync-cue-c46-"));
    const traceFile = "c46-station.conversation-trace.json";
    writeFileSync(join(dir, traceFile), JSON.stringify(fixture.trace));
    writeFileSync(
      join(dir, "exam-session.review-index.json"),
      JSON.stringify({ schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: 1, stations: [{ stationId: fixture.trace.stationId, stationIndex: 0, scenarioId: "ed_chest_pain_priority_v1", traceFile, phases: [], turnCount: fixture.trace.turns.length, turnEnds: [], observerPresent: false, notePresent: false, noteChars: 0, noteFile: null }] }),
    );
    const replayed = await replayObserved(dir, fixture.trace.stationId, [{ ...edChestPainScenario, status: "approved" }]);
    expect(replayed).toEqual(strip(fixture.trace.turns));
  }, 120000);
});
