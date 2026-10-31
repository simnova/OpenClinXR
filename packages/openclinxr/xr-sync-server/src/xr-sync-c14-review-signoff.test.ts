import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type EncounterSnapshot, type IntentKind, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C14 RED (planted by root, 2026-10-30): faculty review sign-off produces one review packet and locks the scores.
// Contract (names are the spec):
//   lobby intent "finalize-review" {} (replay server with scoreDir + reviewRubric):
//     no scoreDir/rubric -> reject "scoring-disabled"; any index station without a valid score file -> reject
//     "review-incomplete" and no packet; already finalized -> reject "review-finalized";
//     ok -> ack; writes <scoreDir>/exam-session.review-packet.json =
//       { schema: "openclinxr.xr-sync.faculty-review-packet.v1", sessionComplete, stationCount,
//         stations: [ per index station in index order: { stationId, stationIndex, turnCount, turnEnds, notePresent,
//           noteText (the note file text, or null), score: { items: [{ id, checked }], checkedCount, rubricSize } } ],
//         totalChecked, totalPossible }   (no session id, no rubric labels, no timestamps)
//   lobby state reviewFinalized: true when the packet exists in scoreDir (read from disk when the lobby opens)
//   after sign-off, score-station in any replay room rejects "review-finalized" and score files stay unchanged
//   in a replay room finalize-review rejects "replay-read-only"
//   C13 grade carry-overs:
//     createEncounterServer refuses (rejects) a scoreDir equal to or inside replayDir
//     a score file whose checkedCount disagrees with its items, whose stationId is not its station, or whose items do not
//       match the rubric ids is ignored: no lobby badge, and it does not count toward finalize
//     return-to-lobby is launched at most once per replay room (a second while one is in flight rejects "launch-pending")
// Fixture ids, rubric ids and the 200 ms step are illustrative test values.

const STEP_MS = 200;
const REPLAY_TIMEOUT_MS = 20000;
const RUBRIC = [{ id: "r-hpi", label: "History" }, { id: "r-exam", label: "Exam" }];
const NOTE_TEXT = "HPI: 2 days fever. Plan: CBC.";
const PACKET = "exam-session.review-packet.json";

const ev = (kind: string, extra: Record<string, unknown> = {}) => ({ seq: null, kind, actorId: "", turnId: null, ...extra });
const ack = (turnIndex: number, from: string, to: string) => ({ from, to, trigger: "learner_acknowledgement", changed: from !== to, turnIndex });
function trace(stationId: string, actorId: string, replyId: string, note: boolean) {
  const closing = note
    ? [ev("phase-changed", { phase: "note" }), ev("note-submitted", { seq: 4, chars: NOTE_TEXT.length }), ev("phase-changed", { phase: "closed" })]
    : [ev("phase-changed", { phase: "note" }), ev("phase-changed", { phase: "closed" })];
  return {
    schema: "openclinxr.xr-sync.conversation-trace.v1",
    stationId,
    events: [
      ev("phase-changed", { phase: "doorway" }), ev("phase-changed", { phase: "encounter" }),
      ev("select-actor", { seq: 1, actorId }), ev("utterance-start", { seq: 2 }),
      ev("utterance-end", { seq: 3, actorId, turnId: 1 }), ev("turn-completed", { actorId, turnId: 1 }),
      ...closing,
    ],
    turns: [{ turnId: 1, actorId, replyId, cueId: `cue-${replyId}`, startSeq: 3, end: "completed", endSeq: null }],
    emotions: [ack(1, "neutral", "reassured")],
  };
}

function writeReviewDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-c14-replay-"));
  const traces = [trace("station-1", "a1", "fx-n1", false), trace("station-2", "a2", "fx-n2", true)];
  traces.forEach((t, i) => writeFileSync(join(dir, `N${i + 1}.conversation-trace.json`), JSON.stringify(t)));
  writeFileSync(join(dir, "N2.patient-note.json"), JSON.stringify({ schema: "openclinxr.xr-sync.patient-note.v1", stationId: "station-2", text: NOTE_TEXT, chars: NOTE_TEXT.length }));
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
    schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: 2,
    stations: traces.map((t, i) => ({
      stationId: t.stationId, stationIndex: i, traceFile: `N${i + 1}.conversation-trace.json`, phases: ["doorway", "encounter", "note", "closed"],
      turnCount: 1, turnEnds: ["completed"], observerPresent: false,
      notePresent: i === 1, noteChars: i === 1 ? NOTE_TEXT.length : 0, noteFile: i === 1 ? "N2.patient-note.json" : null,
    })),
  }));
  return dir;
}

type Snap = EncounterSnapshot & { mode?: string; replayDone?: boolean; lobbyStations?: unknown[]; lobbyScores?: Array<{ stationId: string; checkedCount: number }>; reviewFinalized?: boolean };

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

async function joinRoom(server: EncounterServer, roomOptions: Record<string, unknown>): Promise<{ c: SyncConnection; last: () => Snap | null }> {
  const c = await connect(server.url, { roomOptions });
  leavers.push(() => c.leave());
  let last: Snap | null = null;
  c.onState((s) => {
    last = s as Snap;
  });
  return { c, last: () => last };
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const intent = (c: SyncConnection, kind: string, payload: Record<string, unknown>) => c.sendIntent(kind as IntentKind, payload);

async function openLobby(server: EncounterServer) {
  const r = await joinRoom(server, { reviewLobby: true });
  await waitFor(() => r.last()?.mode === "lobby" && (r.last()?.lobbyStations?.length ?? 0) === 2, 5000, "lobby");
  return r;
}

async function scoreStation(server: EncounterServer, stationId: string, items: Record<string, boolean>) {
  const r = await joinRoom(server, { replayStationId: stationId });
  await waitFor(() => r.last()?.mode === "replay", 5000, `${stationId} replay`);
  const result = await intent(r.c, "score-station", { items });
  await r.c.leave();
  return result;
}

function scoreFile(stationId: string, checked: boolean[]) {
  return {
    schema: "openclinxr.xr-sync.faculty-score.v1", stationId,
    items: RUBRIC.map((x, i) => ({ id: x.id, checked: checked[i] })), checkedCount: checked.filter(Boolean).length, rubricSize: RUBRIC.length,
  };
}

function dirs() {
  const replayDir = writeReviewDir();
  const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c14-score-"));
  return { replayDir, scoreDir, config: { replayDir, scoreDir, reviewRubric: RUBRIC, replayStepMs: STEP_MS } };
}

describe("xr-sync-server C14 faculty review sign-off", () => {
  it("known-good: C13 score-station still writes the score file", async () => {
    const { scoreDir, config } = dirs();
    const server = await boot(config);
    expect(await scoreStation(server, "station-1", { "r-hpi": true, "r-exam": false })).toMatchObject({ status: "ack" });
    expect(JSON.parse(readFileSync(join(scoreDir, "station-1.faculty-score.json"), "utf8"))).toEqual(scoreFile("station-1", [true, false]));
  }, 40000);

  it("finalize-review with every station scored writes the review packet and marks the lobby finalized", async () => {
    const { scoreDir, config } = dirs();
    const server = await boot(config);
    expect(await scoreStation(server, "station-1", { "r-hpi": true, "r-exam": false })).toMatchObject({ status: "ack" });
    expect(await scoreStation(server, "station-2", { "r-hpi": true, "r-exam": true })).toMatchObject({ status: "ack" });
    const lobby = await openLobby(server);
    expect(lobby.last()?.reviewFinalized).toBe(false);
    expect(await intent(lobby.c, "finalize-review", {})).toMatchObject({ status: "ack" });
    await waitFor(() => lobby.last()?.reviewFinalized === true, 5000, "reviewFinalized");
    expect(JSON.parse(readFileSync(join(scoreDir, PACKET), "utf8"))).toEqual({
      schema: "openclinxr.xr-sync.faculty-review-packet.v1",
      sessionComplete: true,
      stationCount: 2,
      stations: [
        { stationId: "station-1", stationIndex: 0, turnCount: 1, turnEnds: ["completed"], notePresent: false, noteText: null,
          score: { items: [{ id: "r-hpi", checked: true }, { id: "r-exam", checked: false }], checkedCount: 1, rubricSize: 2 } },
        { stationId: "station-2", stationIndex: 1, turnCount: 1, turnEnds: ["completed"], notePresent: true, noteText: NOTE_TEXT,
          score: { items: [{ id: "r-hpi", checked: true }, { id: "r-exam", checked: true }], checkedCount: 2, rubricSize: 2 } },
      ],
      totalChecked: 3,
      totalPossible: 4,
    });
    const raw = readFileSync(join(scoreDir, PACKET), "utf8");
    expect(raw).not.toContain(lobby.c.sessionId);
    expect(raw).not.toContain("History");
  }, 60000);

  it("gates finalize: scoring-disabled, review-incomplete, review-finalized, replay-read-only", async () => {
    const plain = await boot({ replayDir: writeReviewDir(), replayStepMs: STEP_MS });
    const p = await openLobby(plain);
    expect(await intent(p.c, "finalize-review", {})).toMatchObject({ status: "reject", reason: "scoring-disabled" });

    const { scoreDir, config } = dirs();
    const server = await boot(config);
    expect(await scoreStation(server, "station-1", { "r-hpi": true, "r-exam": true })).toMatchObject({ status: "ack" });
    const lobby = await openLobby(server);
    expect(await intent(lobby.c, "finalize-review", {})).toMatchObject({ status: "reject", reason: "review-incomplete" });
    expect(existsSync(join(scoreDir, PACKET))).toBe(false);

    const replay = await joinRoom(server, { replayStationId: "station-2" });
    await waitFor(() => replay.last()?.mode === "replay", 5000, "replay");
    expect(await intent(replay.c, "finalize-review", {})).toMatchObject({ status: "reject", reason: "replay-read-only" });

    expect(await scoreStation(server, "station-2", { "r-hpi": false, "r-exam": false })).toMatchObject({ status: "ack" });
    expect(await intent(lobby.c, "finalize-review", {})).toMatchObject({ status: "ack" });
    expect(await intent(lobby.c, "finalize-review", {})).toMatchObject({ status: "reject", reason: "review-finalized" });
  }, 60000);

  it("sign-off locks scores, and a new server over the same scoreDir shows the review finalized", async () => {
    const { scoreDir, config } = dirs();
    const first = await boot(config);
    expect(await scoreStation(first, "station-1", { "r-hpi": true, "r-exam": true })).toMatchObject({ status: "ack" });
    expect(await scoreStation(first, "station-2", { "r-hpi": true, "r-exam": false })).toMatchObject({ status: "ack" });
    const lobby = await openLobby(first);
    expect(await intent(lobby.c, "finalize-review", {})).toMatchObject({ status: "ack" });
    const before = readFileSync(join(scoreDir, "station-2.faculty-score.json"), "utf8");
    expect(await scoreStation(first, "station-2", { "r-hpi": false, "r-exam": false })).toMatchObject({ status: "reject", reason: "review-finalized" });
    expect(readFileSync(join(scoreDir, "station-2.faculty-score.json"), "utf8")).toBe(before);
    await lobby.c.leave();
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await boot(config);
    const fresh = await openLobby(second);
    expect(fresh.last()?.reviewFinalized).toBe(true);
    expect(await scoreStation(second, "station-1", { "r-hpi": false, "r-exam": false })).toMatchObject({ status: "reject", reason: "review-finalized" });
  }, 60000);

  it("C13 carry-overs: overlapping dirs refused, forged score files ignored, one return-to-lobby per replay room", async () => {
    const replayDir = writeReviewDir();
    await expect(boot({ replayDir, scoreDir: replayDir, reviewRubric: RUBRIC })).rejects.toThrow();
    const nested = join(replayDir, "scores");
    mkdirSync(nested);
    await expect(boot({ replayDir, scoreDir: nested, reviewRubric: RUBRIC })).rejects.toThrow();

    const { scoreDir, config } = dirs();
    // station-1: checkedCount disagrees with items; station-2: file names another station.
    writeFileSync(join(scoreDir, "station-1.faculty-score.json"), JSON.stringify({ ...scoreFile("station-1", [true, false]), checkedCount: 999 }));
    writeFileSync(join(scoreDir, "station-2.faculty-score.json"), JSON.stringify(scoreFile("station-1", [true, true])));
    const server = await boot(config);
    const lobby = await openLobby(server);
    expect(lobby.last()?.lobbyScores ?? []).toEqual([]);
    expect(await intent(lobby.c, "finalize-review", {})).toMatchObject({ status: "reject", reason: "review-incomplete" });

    const replay = await joinRoom(server, { replayStationId: "station-1" });
    await waitFor(() => replay.last()?.mode === "replay", 5000, "replay");
    const results = await Promise.all([intent(replay.c, "return-to-lobby", {}), intent(replay.c, "return-to-lobby", {})]);
    expect(results.map((x) => x.status).sort()).toEqual(["ack", "reject"]);
    expect(results.find((x) => x.status === "reject")).toMatchObject({ reason: "launch-pending" });
    await waitFor(() => replay.last()?.mode === "lobby", 5000, "returned to lobby");
  }, 60000);
});
