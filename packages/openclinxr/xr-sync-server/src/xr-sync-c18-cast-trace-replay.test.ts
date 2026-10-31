import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clinicKneePainScenario, edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterAll, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C18 RED (planted by root, 2026-10-31): the saved trace and the faculty replay of a cast station say what the
// live station said.
// Contract (names are the spec), for a C16/C17 cast session (createEncounterServer({ examBlueprint, scenarios,
// traceDir })):
//   Each station's persisted conversation trace (after close) carries top-level scenarioId (the cast scenario;
//   "" off a cast station). Its turns record the replyId/cueId the live room used: an actor's first turn in the
//   station is `${actorId}:opening` with cueId "cue-opening-01", later turns the C3 table. Its emotions follow
//   that scenario's emotionPolicy (knee: no learner_acknowledgement/learner_interruption transition, so every
//   transition holds at "anxious"), not the C4 probe policy. Off a cast station, traces are unchanged.
//   C10 replay (createEncounterServer({ replayDir: <that traceDir>, replayStepMs })) of a cast station shows the
//   same replyIds, and the replayed actors never show an emotion the live station never had (no "neutral" or
//   "reassured" on a knee actor).
//   No persisted file contains an opening utterance (C17 review-safety rule).
// Fixture note: knee copied with status "approved" (C16 precedent). Timings are illustrative test values.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 9, noteSeconds: 1, breakAfterStationOrders: [] };
const KNEE_APPROVED = { ...clinicKneePainScenario, status: "approved" as const };
const CHEST = edChestPainScenario;
const INDEX_FILE = "exam-session.review-index.json";
const TRACE_SUFFIX = ".conversation-trace.json";
const STEP_MS = 100;

function blueprint(): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c18",
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

type LiveState = { stationId: string; phase: string; actors: Record<string, { speaking: boolean; replyId: string }> };
const live = (server: EncounterServer): LiveState => JSON.parse(server.getStateJSON()) as LiveState;

async function turn(server: EncounterServer, learner: SyncConnection, actorId: string): Promise<string> {
  expect(await learner.sendIntent("select-actor", { actorId })).toMatchObject({ status: "ack" });
  await learner.sendIntent("utterance-start", {});
  await learner.sendIntent("utterance-end", {});
  await waitFor(() => live(server).actors[actorId]?.speaking === true, 5000, `${actorId} speaking`);
  const replyId = live(server).actors[actorId]?.replyId ?? "";
  await waitFor(() => live(server).actors[actorId]?.speaking === false, 10000, `${actorId} reply ends`);
  return replyId;
}

const firstActor = (scenario: typeof CHEST): string => {
  const actor = scenario.actors[0];
  if (!actor) throw new Error("fixture has no actor");
  return actor.actorId;
};

type Trace = {
  stationId: string;
  scenarioId?: unknown;
  turns: Array<{ actorId: string; replyId: string; cueId: string }>;
  emotions: Array<{ to: string }>;
};
interface Recorded {
  traceDir: string;
  liveReplyIds: Record<string, string[]>;
  traces: Map<string, Trace>;
}

/** One recorded cast session shared by every clause: slot-a chest (two turns of one actor), slot-b knee (one turn). */
let recorded: Promise<Recorded> | null = null;
function recordCastSession(): Promise<Recorded> {
  recorded ??= (async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c18-"));
    const server = await boot({ examBlueprint: blueprint(), scenarios: [CHEST, KNEE_APPROVED], traceDir });
    const learner = await joinRoom(server, { actors: ["a1", "a2"] });
    const liveReplyIds: Record<string, string[]> = { "slot-a": [], "slot-b": [] };
    await waitFor(() => live(server).phase === "encounter", 5000, "slot-a encounter");
    liveReplyIds["slot-a"]?.push(await turn(server, learner, firstActor(CHEST)));
    liveReplyIds["slot-a"]?.push(await turn(server, learner, firstActor(CHEST)));
    await waitFor(() => live(server).stationId === "slot-b" && live(server).phase === "encounter", 20000, "slot-b encounter");
    liveReplyIds["slot-b"]?.push(await turn(server, learner, firstActor(KNEE_APPROVED)));
    await waitFor(() => readdirSync(traceDir).includes(INDEX_FILE), 30000, "review index");
    await server.close();
    const traces = new Map<string, Trace>();
    for (const file of readdirSync(traceDir).filter((name) => name.endsWith(TRACE_SUFFIX))) {
      const trace = JSON.parse(readFileSync(join(traceDir, file), "utf8")) as Trace;
      traces.set(trace.stationId, trace);
    }
    return { traceDir, liveReplyIds, traces };
  })();
  return recorded;
}
function traceOf(session: Recorded, stationId: string): Trace {
  const trace = session.traces.get(stationId);
  if (!trace) throw new Error(`no trace for ${stationId}`);
  return trace;
}

type ReplaySnapshot = { replayDone?: boolean; actors?: Record<string, { id: string; speaking: boolean; replyId: string; emotion: string }> };
async function replay(traceDir: string, stationId: string): Promise<{ replyIds: string[]; emotions: Map<string, Set<string>> }> {
  const server = await boot({ replayDir: traceDir, replayStepMs: STEP_MS });
  const reviewer = await joinRoom(server, { replayStationId: stationId });
  const replyIds: string[] = [];
  const emotions = new Map<string, Set<string>>();
  let done = false;
  reviewer.onState((raw) => {
    const s = raw as ReplaySnapshot;
    for (const actor of Object.values(s.actors ?? {})) {
      if (actor.speaking && replyIds.at(-1) !== actor.replyId) replyIds.push(actor.replyId);
      if (!emotions.has(actor.id)) emotions.set(actor.id, new Set());
      emotions.get(actor.id)?.add(actor.emotion);
    }
    if (s.replayDone === true) done = true;
  });
  await waitFor(() => done, 30000, "replayDone");
  return { replyIds, emotions };
}

describe("xr-sync-server C18 cast trace and replay", () => {
  it("known-good: the live cast station used the opening line, then the C3 table (C17 behaviour)", async () => {
    const session = await recordCastSession();
    const actor = firstActor(CHEST);
    expect(session.liveReplyIds["slot-a"]?.[0]).toBe(`${actor}:opening`);
    expect(session.liveReplyIds["slot-a"]?.[1]).toMatch(/^c3-/);
  }, 90000);

  it("each saved trace names its cast scenario", async () => {
    const session = await recordCastSession();
    expect([traceOf(session, "slot-a").scenarioId, traceOf(session, "slot-b").scenarioId]).toEqual([
      CHEST.scenarioId,
      KNEE_APPROVED.scenarioId,
    ]);
  }, 90000);

  it("saved trace turns record the replyIds and cueIds the live station used", async () => {
    const session = await recordCastSession();
    const actor = firstActor(CHEST);
    const turns = traceOf(session, "slot-a").turns;
    expect(turns.map((t) => t.replyId)).toEqual(session.liveReplyIds["slot-a"]);
    expect(turns[0]).toMatchObject({ actorId: actor, replyId: `${actor}:opening`, cueId: "cue-opening-01" });
    expect(traceOf(session, "slot-b").turns.map((t) => t.replyId)).toEqual(session.liveReplyIds["slot-b"]);
  }, 90000);

  it("saved trace emotions follow the scenario policy: the knee station holds at anxious", async () => {
    const session = await recordCastSession();
    const emotions = traceOf(session, "slot-b").emotions;
    expect(emotions.length).toBeGreaterThan(0);
    expect(new Set(emotions.map((e) => e.to))).toEqual(new Set([KNEE_APPROVED.emotionPolicy?.baseline]));
  }, 90000);

  it("faculty replay of a cast station shows the live replyIds", async () => {
    const session = await recordCastSession();
    const replayed = await replay(session.traceDir, "slot-a");
    expect(replayed.replyIds).toEqual(session.liveReplyIds["slot-a"]);
  }, 90000);

  it("faculty replay of the knee station never shows an emotion the live station did not have", async () => {
    const session = await recordCastSession();
    const replayed = await replay(session.traceDir, "slot-b");
    const kneeActor = firstActor(KNEE_APPROVED);
    expect(replayed.emotions.get(kneeActor)).toEqual(new Set([KNEE_APPROVED.emotionPolicy?.baseline]));
  }, 90000);

  it("no persisted file carries an opening utterance", async () => {
    const session = await recordCastSession();
    const openings = [...CHEST.actors, ...KNEE_APPROVED.actors].map((a) => a.openingUtterance);
    for (const file of readdirSync(session.traceDir)) {
      const text = readFileSync(join(session.traceDir, file), "utf8");
      for (const opening of openings) expect(text).not.toContain(opening);
    }
  }, 90000);
});
