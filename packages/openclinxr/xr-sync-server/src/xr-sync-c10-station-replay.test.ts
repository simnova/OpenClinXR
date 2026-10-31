import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type EncounterSnapshot, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C10 RED (planted by root, 2026-10-30): faculty replays one recorded station on the headset.
// Contract (names are the spec):
//   createEncounterServer({ replayDir, replayStepMs }) - server config only. replayDir holds a C9
//     exam-session.review-index.json plus the per-station traces it names.
//   a client joins with roomOptions.replayStationId = an index stationId; unknown/missing id -> join refused.
//     Two reviewers of different stations at once each get their own station (no room sharing).
//   the room advances ONE recorded trace event per replayStepMs on the room clock into schema state:
//     mode "replay", stationId, phase (from phase-changed), turnId, actors[id].speaking/replyId/cueId/emotion,
//     lastTurnEnd ("completed" | "interrupted" | "closed-by-phase", "" before the first end), replayDone true
//     after the last event. replyId/cueId come from trace.turns and emotion from trace.emotions as
//     RECORDED: replay is not a recompute through the current reply table (the table may change
//     between recording and review; fixture ids below are deliberately absent from C3_REPLY_TABLE).
//   every intent in a replay room is rejected "replay-read-only"; replay writes nothing into replayDir.
//   C9 carry-over: rotationFaults.failNextStationCreate = N makes the next N station createRoom calls
//     throw; the session then writes the review index with complete false and only the stations that ran.
// Fixture ids and the 200 ms step are illustrative test values, not product values.

const STEP_MS = 200; // 4 patch intervals (50 ms) per event, so a turn start and its end never coalesce (C4 lesson)
const REPLAY_TIMEOUT_MS = 20000; // 15 events x 200 ms = 3 s; 20 s bounds a loaded host

const ev = (kind: string, extra: Record<string, unknown> = {}) => ({ seq: null, kind, actorId: "", turnId: null, ...extra });

// station-2: the C9 quest1 recorded trace (evidence/c9/quest1/trace/9wJYbIscj) with ids swapped to fx-*.
const TRACE_S2 = {
  schema: "openclinxr.xr-sync.conversation-trace.v1",
  stationId: "station-2",
  events: [
    ev("phase-changed", { phase: "doorway" }), ev("observer-joined"), ev("phase-changed", { phase: "encounter" }),
    ev("select-actor", { seq: 500, actorId: "a1" }), ev("utterance-start", { seq: 519 }),
    ev("utterance-end", { seq: 521, actorId: "a1", turnId: 1 }), ev("turn-completed", { actorId: "a1", turnId: 1 }),
    ev("utterance-start", { seq: 559 }), ev("utterance-end", { seq: 561, actorId: "a1", turnId: 2 }),
    ev("utterance-start", { seq: 563, turnId: 2 }), ev("utterance-end", { seq: 565, actorId: "a1", turnId: 3 }),
    ev("turn-completed", { actorId: "a1", turnId: 3 }), ev("phase-changed", { phase: "note" }),
    ev("phase-changed", { phase: "closed" }), ev("observer-left"),
  ],
  turns: [
    { turnId: 1, actorId: "a1", replyId: "fx-reply-a", cueId: "cue-fx-a", startSeq: 521, end: "completed", endSeq: null },
    { turnId: 2, actorId: "a1", replyId: "fx-reply-b", cueId: "cue-fx-b", startSeq: 561, end: "interrupted", endSeq: 563 },
    { turnId: 3, actorId: "a1", replyId: "fx-reply-c", cueId: "cue-fx-c", startSeq: 565, end: "completed", endSeq: null },
  ],
  emotions: [
    { from: "neutral", to: "reassured", trigger: "learner_acknowledgement", changed: true, turnIndex: 1 },
    { from: "reassured", to: "reassured", trigger: "learner_acknowledgement", changed: false, turnIndex: 2 },
    { from: "reassured", to: "concerned", trigger: "learner_interruption", changed: true, turnIndex: 2 },
    { from: "concerned", to: "neutral", trigger: "learner_acknowledgement", changed: true, turnIndex: 3 },
  ],
};
// station-1: a different actor, two completed turns, one emotion change. Distinct from station-2 on every axis.
const TRACE_S1 = {
  schema: "openclinxr.xr-sync.conversation-trace.v1",
  stationId: "station-1",
  events: [
    ev("phase-changed", { phase: "doorway" }), ev("phase-changed", { phase: "encounter" }),
    ev("select-actor", { seq: 10, actorId: "a2" }), ev("utterance-start", { seq: 11 }),
    ev("utterance-end", { seq: 12, actorId: "a2", turnId: 1 }), ev("turn-completed", { actorId: "a2", turnId: 1 }),
    ev("utterance-start", { seq: 13 }), ev("utterance-end", { seq: 14, actorId: "a2", turnId: 2 }),
    ev("turn-completed", { actorId: "a2", turnId: 2 }), ev("phase-changed", { phase: "note" }),
    ev("phase-changed", { phase: "closed" }),
  ],
  turns: [
    { turnId: 1, actorId: "a2", replyId: "fx-reply-p", cueId: "cue-fx-p", startSeq: 12, end: "completed", endSeq: null },
    { turnId: 2, actorId: "a2", replyId: "fx-reply-q", cueId: "cue-fx-q", startSeq: 14, end: "completed", endSeq: null },
  ],
  emotions: [
    { from: "neutral", to: "reassured", trigger: "learner_acknowledgement", changed: true, turnIndex: 1 },
    { from: "reassured", to: "reassured", trigger: "learner_acknowledgement", changed: false, turnIndex: 2 },
  ],
};

function writeReplayDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-c10-"));
  writeFileSync(join(dir, "S1fx.conversation-trace.json"), JSON.stringify(TRACE_S1));
  writeFileSync(join(dir, "S2fx.conversation-trace.json"), JSON.stringify(TRACE_S2));
  const entry = (t: { stationId: string; turns: Array<{ end: string }> }, i: number, file: string, obs: boolean) => ({
    stationId: t.stationId, stationIndex: i, traceFile: file, phases: ["doorway", "encounter", "note", "closed"],
    turnCount: t.turns.length, turnEnds: t.turns.map((x) => x.end), observerPresent: obs,
  });
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
    schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: 2,
    stations: [entry(TRACE_S1, 0, "S1fx.conversation-trace.json", false), entry(TRACE_S2, 1, "S2fx.conversation-trace.json", true)],
  }));
  return dir;
}

function dirContents(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), "utf8")]));
}

type ReplaySnapshot = EncounterSnapshot & { mode?: string; lastTurnEnd?: string; replayDone?: boolean };

interface Observed {
  turns: Array<{ turnId: number; actorId: string; replyId: string; cueId: string }>;
  ends: string[];
  emotions: string[];
  phases: string[];
  last: ReplaySnapshot | null;
}

function observe(connection: SyncConnection): Observed {
  const seen: Observed = { turns: [], ends: [], emotions: [], phases: [], last: null };
  const wasSpeaking = new Map<string, boolean>();
  connection.onState((raw) => {
    const s = raw as ReplaySnapshot;
    seen.last = s;
    if (s.phase && seen.phases.at(-1) !== s.phase) seen.phases.push(s.phase);
    for (const actor of Object.values(s.actors ?? {})) {
      // A turn end is observed as speaking true -> false; lastTurnEnd names how it ended.
      if (wasSpeaking.get(actor.id) === true && !actor.speaking) seen.ends.push(s.lastTurnEnd ?? "");
      wasSpeaking.set(actor.id, actor.speaking);
    }
    for (const actor of Object.values(s.actors ?? {})) {
      if (actor.speaking && !seen.turns.some((t) => t.turnId === s.turnId)) {
        seen.turns.push({ turnId: s.turnId, actorId: actor.id, replyId: actor.replyId, cueId: actor.cueId });
      }
      if (actor.emotion && actor.emotion !== (seen.emotions.at(-1) ?? "neutral")) seen.emotions.push(actor.emotion);
    }
  });
  return seen;
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

describe("xr-sync-server C10 station replay from trace", () => {
  it("known-good: without replayDir a replayStationId join lands in a live room that acks intents", async () => {
    const server = await boot({});
    const learner = await joinRoom(server, { actors: ["a1", "a2"], replayStationId: "station-2" });
    const result = await learner.sendIntent("select-actor", { actorId: "a1" });
    expect(result.status).toBe("ack");
  }, 30000);

  it("replays station-2 as recorded: turns with recorded ids, ends, emotions, phases, then done", async () => {
    const server = await boot({ replayDir: writeReplayDir(), replayStepMs: STEP_MS });
    const reviewer = await joinRoom(server, { replayStationId: "station-2" });
    const seen = observe(reviewer);
    await waitFor(() => seen.last?.replayDone === true, REPLAY_TIMEOUT_MS, "replayDone");
    expect(seen.last?.mode).toBe("replay");
    expect(seen.last?.stationId).toBe("station-2");
    expect(seen.turns).toEqual(TRACE_S2.turns.map(({ turnId, actorId, replyId, cueId }) => ({ turnId, actorId, replyId, cueId })));
    expect(seen.ends).toEqual(["completed", "interrupted", "completed"]);
    expect(seen.emotions).toEqual(["reassured", "concerned", "neutral"]);
    expect(seen.phases).toEqual(["doorway", "encounter", "note", "closed"]);
  }, 40000);

  it("is read-only: every intent rejected replay-read-only and replayDir is byte-identical after close", async () => {
    const dir = writeReplayDir();
    const before = dirContents(dir);
    const server = await boot({ replayDir: dir, replayStepMs: STEP_MS });
    const reviewer = await joinRoom(server, { replayStationId: "station-2", actors: ["a1"] });
    const seen = observe(reviewer);
    for (const [kind, payload] of [["pose", { x: 1, y: 1, z: 1 }], ["select-actor", { actorId: "a1" }], ["utterance-start", {}], ["utterance-end", {}]] as const) {
      const result = await reviewer.sendIntent(kind, payload);
      expect(result).toMatchObject({ status: "reject", reason: "replay-read-only" });
    }
    await waitFor(() => seen.last?.replayDone === true, REPLAY_TIMEOUT_MS, "replayDone");
    await reviewer.leave();
    await servers.pop()?.close();
    expect(dirContents(dir)).toEqual(before);
  }, 40000);

  it("selects by station: unknown id refused; concurrent station-1 and station-2 reviewers each get their own", async () => {
    const server = await boot({ replayDir: writeReplayDir(), replayStepMs: STEP_MS });
    await expect(connect(server.url, { roomOptions: { replayStationId: "station-9" } })).rejects.toThrow();
    await expect(connect(server.url, { roomOptions: {} })).rejects.toThrow();
    const r2 = await joinRoom(server, { replayStationId: "station-2" });
    const r1 = await joinRoom(server, { replayStationId: "station-1" });
    const s2 = observe(r2);
    const s1 = observe(r1);
    await waitFor(() => s1.last?.replayDone === true && s2.last?.replayDone === true, REPLAY_TIMEOUT_MS, "both replayDone");
    expect(s1.last?.stationId).toBe("station-1");
    expect(s1.turns.map((t) => [t.actorId, t.cueId])).toEqual([["a2", "cue-fx-p"], ["a2", "cue-fx-q"]]);
    expect(s1.ends).toEqual(["completed", "completed"]);
    expect(s1.emotions).toEqual(["reassured"]);
    expect(s2.turns.map((t) => t.cueId)).toEqual(["cue-fx-a", "cue-fx-b", "cue-fx-c"]);
  }, 40000);

  it("C9 carry-over: a station createRoom throw writes an incomplete index with the stations that ran", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c10-c9-"));
    const server = await boot({
      traceDir,
      timing: { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 },
      stations: ["station-1", "station-2"],
      rotationFaults: { failNextStationCreate: 1 },
    });
    await joinRoom(server, { actors: ["a1", "a2"] });
    const file = join(traceDir, "exam-session.review-index.json");
    await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), 15000, "incomplete index");
    const index = JSON.parse(readFileSync(file, "utf8")) as { complete: boolean; stations: Array<{ stationId: string }> };
    expect(index.complete).toBe(false);
    expect(index.stations.map((s) => s.stationId)).toEqual(["station-1"]);
  }, 40000);

  it("C9 carry-over without traceDir: a station createRoom throw is contained (no unhandled rejection, server keeps serving)", async () => {
    // Root, after review of 361b2f911: driveRoomRotation now rethrows; the no-traceDir branch must catch it.
    const server = await boot({
      timing: { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 },
      stations: ["station-1", "station-2"],
      rotationFaults: { failNextStationCreate: 1 },
    });
    const learner = await joinRoom(server, { actors: ["a1", "a2"] });
    let closed = false;
    learner.onState((s) => { if (s.phase === "closed") closed = true; });
    await waitFor(() => closed, 15000, "station-1 closed");
    await new Promise((resolve) => setTimeout(resolve, 500)); // rotation runs right after closed (C7 dwell 15-55 ms)
    const late = await joinRoom(server, { actors: ["a1"] });
    expect(late.sessionId).not.toBe("");
  }, 40000);
});
