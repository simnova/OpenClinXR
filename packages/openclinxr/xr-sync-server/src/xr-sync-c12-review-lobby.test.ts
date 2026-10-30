import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type EncounterSnapshot, type IntentKind, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C12 RED (planted by root, 2026-10-30): a faculty reviewer picks a recorded station from a lobby on the headset.
// Contract (names are the spec):
//   on a replay server (createEncounterServer({ replayDir })), roomOptions.reviewLobby === true joins a LOBBY room:
//     state.mode "lobby"; state.sessionComplete = index.complete;
//     state.lobbyStations = one entry per index station, in index order:
//       { stationId, stationIndex, turnCount, notePresent, noteChars } copied from the review index
//   intent "select-station" { stationId }: an index stationId -> ack, then the server launches that station's replay for
//     THIS client only; the client consumes the launch inside the same SyncConnection (as C7 rotation does), so the same
//     onState stream continues with the C10 replay state (mode "replay", that stationId, recorded turns, replayDone)
//   select-station with an unknown/missing stationId -> reject "unknown-station"; every other intent in the lobby ->
//     reject "lobby-read-only"; a station whose trace fails validation (C11 per-station rule) -> reject "station-unavailable"
//   reviewLobby on a LIVE server (no replayDir) refuses the join (a reviewer pointed at the wrong server must not get a
//     live learner seat; C10 grade defect 4)
//   C10 replayStationId joins keep working unchanged
// Fixture ids and the 200 ms step are illustrative test values.

const STEP_MS = 200;
const REPLAY_TIMEOUT_MS = 20000;

const ev = (kind: string, extra: Record<string, unknown> = {}) => ({ seq: null, kind, actorId: "", turnId: null, ...extra });
const phases = (inner: unknown[]) => [
  ev("phase-changed", { phase: "doorway" }), ev("phase-changed", { phase: "encounter" }), ...inner,
  ev("phase-changed", { phase: "note" }), ev("phase-changed", { phase: "closed" }),
];
const ack = (turnIndex: number, from: string, to: string) => ({ from, to, trigger: "learner_acknowledgement", changed: from !== to, turnIndex });

const TRACE_S1 = {
  schema: "openclinxr.xr-sync.conversation-trace.v1",
  stationId: "station-1",
  events: phases([
    ev("select-actor", { seq: 1, actorId: "a1" }), ev("utterance-start", { seq: 2 }),
    ev("utterance-end", { seq: 3, actorId: "a1", turnId: 1 }), ev("turn-completed", { actorId: "a1", turnId: 1 }),
  ]),
  turns: [{ turnId: 1, actorId: "a1", replyId: "fx-l1", cueId: "cue-fx-l1", startSeq: 3, end: "completed", endSeq: null }],
  emotions: [ack(1, "neutral", "reassured")],
};
const TRACE_S2 = {
  schema: "openclinxr.xr-sync.conversation-trace.v1",
  stationId: "station-2",
  events: [
    ...phases([
      ev("select-actor", { seq: 1, actorId: "a2" }), ev("utterance-start", { seq: 2 }),
      ev("utterance-end", { seq: 3, actorId: "a2", turnId: 1 }), ev("turn-completed", { actorId: "a2", turnId: 1 }),
      ev("utterance-start", { seq: 4 }), ev("utterance-end", { seq: 5, actorId: "a2", turnId: 2 }),
      ev("turn-completed", { actorId: "a2", turnId: 2 }),
    ]).slice(0, -1),
    ev("note-submitted", { seq: 6, chars: 29 }),
    ev("phase-changed", { phase: "closed" }),
  ],
  turns: [
    { turnId: 1, actorId: "a2", replyId: "fx-l2a", cueId: "cue-fx-l2a", startSeq: 3, end: "completed", endSeq: null },
    { turnId: 2, actorId: "a2", replyId: "fx-l2b", cueId: "cue-fx-l2b", startSeq: 5, end: "completed", endSeq: null },
  ],
  emotions: [ack(1, "neutral", "reassured"), ack(2, "reassured", "reassured")],
};
// station-3: one utterance-end and no recorded emotions -> fails C11 per-station validation.
const TRACE_S3 = { ...TRACE_S1, stationId: "station-3", emotions: [] };

function writeReviewDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-c12-"));
  const traces = [TRACE_S1, TRACE_S2, TRACE_S3];
  const notes = [{ notePresent: false, noteChars: 0, noteFile: null }, { notePresent: true, noteChars: 29, noteFile: "L2.patient-note.json" }, { notePresent: false, noteChars: 0, noteFile: null }];
  traces.forEach((t, i) => writeFileSync(join(dir, `L${i + 1}.conversation-trace.json`), JSON.stringify(t)));
  writeFileSync(join(dir, "L2.patient-note.json"), JSON.stringify({ schema: "openclinxr.xr-sync.patient-note.v1", stationId: "station-2", text: "HPI: cough 3 days. PE: clear.", chars: 29 }));
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
    schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: false, stationCount: 3,
    stations: traces.map((t, i) => ({
      stationId: t.stationId, stationIndex: i, traceFile: `L${i + 1}.conversation-trace.json`, phases: ["doorway", "encounter", "note", "closed"],
      turnCount: t.turns.length, turnEnds: t.turns.map((x) => x.end), observerPresent: false, ...notes[i],
    })),
  }));
  return dir;
}

type LobbyStation = { stationId: string; stationIndex: number; turnCount: number; notePresent: boolean; noteChars: number };
type Snap = EncounterSnapshot & { mode?: string; replayDone?: boolean; sessionComplete?: boolean; lobbyStations?: LobbyStation[]; noteChars?: number };

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

async function joinRoom(server: EncounterServer, roomOptions: Record<string, unknown>): Promise<{ c: SyncConnection; last: () => Snap | null; cues: string[] }> {
  const c = await connect(server.url, { roomOptions });
  leavers.push(() => c.leave());
  let last: Snap | null = null;
  const cues: string[] = [];
  c.onState((s) => {
    last = s as Snap;
    for (const actor of Object.values(s.actors ?? {})) if (actor.speaking && actor.cueId && cues.at(-1) !== actor.cueId) cues.push(actor.cueId);
  });
  return { c, last: () => last, cues };
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const select = (c: SyncConnection, payload: Record<string, unknown>) => c.sendIntent("select-station" as IntentKind, payload);

describe("xr-sync-server C12 review lobby", () => {
  it("known-good: a C10 replayStationId join still replays its station", async () => {
    const server = await boot({ replayDir: writeReviewDir(), replayStepMs: STEP_MS });
    const { last } = await joinRoom(server, { replayStationId: "station-1" });
    await waitFor(() => last()?.replayDone === true, REPLAY_TIMEOUT_MS, "replayDone");
    expect(last()?.stationId).toBe("station-1");
  }, 40000);

  it("lists the index stations in the lobby state", async () => {
    const server = await boot({ replayDir: writeReviewDir(), replayStepMs: STEP_MS });
    const { last } = await joinRoom(server, { reviewLobby: true });
    await waitFor(() => (last()?.lobbyStations?.length ?? 0) === 3, 5000, "lobby stations");
    expect(last()?.mode).toBe("lobby");
    expect(last()?.sessionComplete).toBe(false);
    expect(last()?.lobbyStations).toEqual([
      { stationId: "station-1", stationIndex: 0, turnCount: 1, notePresent: false, noteChars: 0 },
      { stationId: "station-2", stationIndex: 1, turnCount: 2, notePresent: true, noteChars: 29 },
      { stationId: "station-3", stationIndex: 2, turnCount: 1, notePresent: false, noteChars: 0 },
    ]);
  }, 40000);

  it("select-station launches that station's replay on the same connection", async () => {
    const server = await boot({ replayDir: writeReviewDir(), replayStepMs: STEP_MS });
    const { c, last, cues } = await joinRoom(server, { reviewLobby: true });
    await waitFor(() => last()?.mode === "lobby", 5000, "lobby");
    expect(await select(c, { stationId: "station-2" })).toMatchObject({ status: "ack" });
    await waitFor(() => last()?.mode === "replay" && last()?.replayDone === true, REPLAY_TIMEOUT_MS, "station-2 replayDone");
    expect(last()?.stationId).toBe("station-2");
    expect(cues).toEqual(["cue-fx-l2a", "cue-fx-l2b"]);
    expect(last()?.noteChars).toBe(29);
  }, 40000);

  it("gates lobby intents: unknown-station, lobby-read-only, station-unavailable", async () => {
    const server = await boot({ replayDir: writeReviewDir(), replayStepMs: STEP_MS });
    const { c, last } = await joinRoom(server, { reviewLobby: true, actors: ["a1"] });
    await waitFor(() => last()?.mode === "lobby", 5000, "lobby");
    expect(await select(c, { stationId: "station-9" })).toMatchObject({ status: "reject", reason: "unknown-station" });
    expect(await select(c, {})).toMatchObject({ status: "reject", reason: "unknown-station" });
    expect(await c.sendIntent("select-actor", { actorId: "a1" })).toMatchObject({ status: "reject", reason: "lobby-read-only" });
    expect(await c.sendIntent("pose", { x: 0, y: 1, z: 0 })).toMatchObject({ status: "reject", reason: "lobby-read-only" });
    expect(await select(c, { stationId: "station-3" })).toMatchObject({ status: "reject", reason: "station-unavailable" });
    expect(last()?.mode).toBe("lobby");
  }, 40000);

  it("two reviewers in lobbies pick different stations and each gets their own replay", async () => {
    const server = await boot({ replayDir: writeReviewDir(), replayStepMs: STEP_MS });
    const r1 = await joinRoom(server, { reviewLobby: true });
    const r2 = await joinRoom(server, { reviewLobby: true });
    await waitFor(() => r1.last()?.mode === "lobby" && r2.last()?.mode === "lobby", 5000, "both lobbies");
    expect(await select(r1.c, { stationId: "station-1" })).toMatchObject({ status: "ack" });
    expect(await select(r2.c, { stationId: "station-2" })).toMatchObject({ status: "ack" });
    await waitFor(() => r1.last()?.replayDone === true && r2.last()?.replayDone === true, REPLAY_TIMEOUT_MS, "both replayDone");
    expect([r1.last()?.stationId, r2.last()?.stationId]).toEqual(["station-1", "station-2"]);
    expect(r1.cues).toEqual(["cue-fx-l1"]);
  }, 40000);

  it("refuses reviewLobby on a live server", async () => {
    const server = await boot({});
    await expect(connect(server.url, { roomOptions: { reviewLobby: true } })).rejects.toThrow();
  }, 30000);
});
