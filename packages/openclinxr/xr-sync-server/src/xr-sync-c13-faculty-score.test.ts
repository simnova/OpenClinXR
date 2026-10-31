import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type EncounterSnapshot, type IntentKind, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C13 RED (planted by root, 2026-10-30): a faculty reviewer scores a replayed station and returns to the lobby.
// Contract (names are the spec):
//   createEncounterServer({ replayDir, scoreDir?, reviewRubric?: [{ id, label }] }) (server config only, never roomOptions)
//   in a REPLAY room (C10/C12), two intents are allowed; every other intent still rejects "replay-read-only":
//     "return-to-lobby" {} -> ack, then the server opens a fresh lobby for THIS client only and the client consumes it inside
//       the same SyncConnection (C7/C12 rotate mechanism): mode "lobby", lobbyStations as C12; select-station works again
//     "score-station" { items: { [rubricId]: boolean } } -> scores the station being replayed:
//       no scoreDir or no reviewRubric -> reject "scoring-disabled"
//       items not a record of booleans, or its key set != the rubric id set -> reject "invalid-score" (unknown ids included)
//       ok -> ack; writes <scoreDir>/<stationId>.faculty-score.json =
//         { schema: "openclinxr.xr-sync.faculty-score.v1", stationId, items: [{ id, checked }] in rubric order,
//           checkedCount, rubricSize } with no session id, no timestamp, no label text; last write wins
//       replayDir stays byte-identical (C10 invariant); state.scoreChecked = checkedCount after ack
//   in the LOBBY, score-station and return-to-lobby reject "lobby-read-only" (C12 rule unchanged)
//   lobby state gains lobbyScores: [{ stationId, checkedCount }] for each index station with a score file in scoreDir,
//     in index order, READ FROM DISK when the lobby opens (a new server on the same scoreDir shows earlier scores)
//   C12 lobbyStations rows are unchanged (no score fields added to them)
//   C12 grade carry-overs: a lobby launches at most once (a select while a launch is pending rejects "launch-pending");
//     the launch reaches only the selecting client; a live server refuses reviewLobby in onAuth of an existing room too
// Fixture ids, rubric ids and the 200 ms step are illustrative test values.

const STEP_MS = 200;
const REPLAY_TIMEOUT_MS = 20000;
const RUBRIC = [
  { id: "hpi-onset", label: "Asked onset" },
  { id: "pe-lungs", label: "Examined lungs" },
  { id: "plan-shared", label: "Shared the plan" },
];

const ev = (kind: string, extra: Record<string, unknown> = {}) => ({ seq: null, kind, actorId: "", turnId: null, ...extra });
const phases = (inner: unknown[]) => [
  ev("phase-changed", { phase: "doorway" }), ev("phase-changed", { phase: "encounter" }), ...inner,
  ev("phase-changed", { phase: "note" }), ev("phase-changed", { phase: "closed" }),
];
const ack = (turnIndex: number, from: string, to: string) => ({ from, to, trigger: "learner_acknowledgement", changed: from !== to, turnIndex });
const trace = (stationId: string, actorId: string, replyId: string) => ({
  schema: "openclinxr.xr-sync.conversation-trace.v1",
  stationId,
  events: phases([
    ev("select-actor", { seq: 1, actorId }), ev("utterance-start", { seq: 2 }),
    ev("utterance-end", { seq: 3, actorId, turnId: 1 }), ev("turn-completed", { actorId, turnId: 1 }),
  ]),
  turns: [{ turnId: 1, actorId, replyId, cueId: `cue-${replyId}`, startSeq: 3, end: "completed", endSeq: null }],
  emotions: [ack(1, "neutral", "reassured")],
});

function writeReviewDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-c13-replay-"));
  const traces = [trace("station-1", "a1", "fx-m1"), trace("station-2", "a2", "fx-m2")];
  traces.forEach((t, i) => writeFileSync(join(dir, `M${i + 1}.conversation-trace.json`), JSON.stringify(t)));
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
    schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: 2,
    stations: traces.map((t, i) => ({
      stationId: t.stationId, stationIndex: i, traceFile: `M${i + 1}.conversation-trace.json`, phases: ["doorway", "encounter", "note", "closed"],
      turnCount: 1, turnEnds: ["completed"], observerPresent: false, notePresent: false, noteChars: 0, noteFile: null,
    })),
  }));
  return dir;
}

function hashDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) out[name] = createHash("sha256").update(readFileSync(join(dir, name))).digest("hex");
  return out;
}

type LobbyScore = { stationId: string; checkedCount: number };
type Snap = EncounterSnapshot & { mode?: string; replayDone?: boolean; lobbyStations?: Array<{ stationId: string }>; lobbyScores?: LobbyScore[]; scoreChecked?: number };

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

async function joinRoom(server: EncounterServer, roomOptions: Record<string, unknown>): Promise<{ c: SyncConnection; last: () => Snap | null; modes: string[] }> {
  const c = await connect(server.url, { roomOptions });
  leavers.push(() => c.leave());
  let last: Snap | null = null;
  const modes: string[] = [];
  c.onState((s) => {
    last = s as Snap;
    const mode = (s as Snap).mode ?? "";
    if (mode !== "" && modes.at(-1) !== mode) modes.push(mode);
  });
  return { c, last: () => last, modes };
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const intent = (c: SyncConnection, kind: string, payload: Record<string, unknown>) => c.sendIntent(kind as IntentKind, payload);
const ITEMS = { "hpi-onset": true, "pe-lungs": false, "plan-shared": true };

async function lobbyToReplay(server: EncounterServer, stationId: string) {
  const r = await joinRoom(server, { reviewLobby: true });
  await waitFor(() => r.last()?.mode === "lobby", 5000, "lobby");
  expect(await intent(r.c, "select-station", { stationId })).toMatchObject({ status: "ack" });
  await waitFor(() => r.last()?.mode === "replay" && r.last()?.stationId === stationId, REPLAY_TIMEOUT_MS, `${stationId} replay`);
  return r;
}

describe("xr-sync-server C13 faculty score + return to lobby", () => {
  it("known-good: C12 lobby select still launches the replay", async () => {
    const server = await boot({ replayDir: writeReviewDir(), replayStepMs: STEP_MS });
    const r = await lobbyToReplay(server, "station-1");
    await waitFor(() => r.last()?.replayDone === true, REPLAY_TIMEOUT_MS, "replayDone");
  }, 40000);

  it("return-to-lobby brings the reviewer back to the lobby on the same connection, and select works again", async () => {
    const server = await boot({ replayDir: writeReviewDir(), replayStepMs: STEP_MS });
    const r = await lobbyToReplay(server, "station-1");
    expect(await intent(r.c, "return-to-lobby", {})).toMatchObject({ status: "ack" });
    await waitFor(() => r.last()?.mode === "lobby" && (r.last()?.lobbyStations?.length ?? 0) === 2, 5000, "back in lobby");
    expect(await intent(r.c, "select-station", { stationId: "station-2" })).toMatchObject({ status: "ack" });
    await waitFor(() => r.last()?.mode === "replay" && r.last()?.stationId === "station-2" && r.last()?.replayDone === true, REPLAY_TIMEOUT_MS, "station-2 replayDone");
    expect(r.modes).toEqual(["lobby", "replay", "lobby", "replay"]);
  }, 60000);

  it("score-station writes a review-safe score file in scoreDir and leaves replayDir untouched", async () => {
    const replayDir = writeReviewDir();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c13-score-"));
    const before = hashDir(replayDir);
    const server = await boot({ replayDir, scoreDir, reviewRubric: RUBRIC, replayStepMs: STEP_MS });
    const r = await lobbyToReplay(server, "station-2");
    expect(await intent(r.c, "score-station", { items: { "hpi-onset": false, "pe-lungs": false, "plan-shared": false } })).toMatchObject({ status: "ack" });
    expect(await intent(r.c, "score-station", { items: ITEMS })).toMatchObject({ status: "ack" });
    await waitFor(() => r.last()?.scoreChecked === 2, 5000, "scoreChecked 2");
    const file = join(scoreDir, "station-2.faculty-score.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      schema: "openclinxr.xr-sync.faculty-score.v1",
      stationId: "station-2",
      items: [{ id: "hpi-onset", checked: true }, { id: "pe-lungs", checked: false }, { id: "plan-shared", checked: true }],
      checkedCount: 2,
      rubricSize: 3,
    });
    expect(readdirSync(scoreDir)).toEqual(["station-2.faculty-score.json"]);
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain(r.c.sessionId);
    expect(raw).not.toContain("Asked onset");
    expect(hashDir(replayDir)).toEqual(before);
  }, 40000);

  it("gates scoring: scoring-disabled, invalid-score, lobby-read-only, replay-read-only", async () => {
    const plain = await boot({ replayDir: writeReviewDir(), replayStepMs: STEP_MS });
    const p = await lobbyToReplay(plain, "station-1");
    expect(await intent(p.c, "score-station", { items: ITEMS })).toMatchObject({ status: "reject", reason: "scoring-disabled" });

    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c13-score-"));
    const server = await boot({ replayDir: writeReviewDir(), scoreDir, reviewRubric: RUBRIC, replayStepMs: STEP_MS });
    const lobby = await joinRoom(server, { reviewLobby: true });
    await waitFor(() => lobby.last()?.mode === "lobby", 5000, "lobby");
    expect(await intent(lobby.c, "score-station", { items: ITEMS })).toMatchObject({ status: "reject", reason: "lobby-read-only" });
    expect(await intent(lobby.c, "return-to-lobby", {})).toMatchObject({ status: "reject", reason: "lobby-read-only" });

    const r = await lobbyToReplay(server, "station-1");
    for (const bad of [
      { items: { "hpi-onset": true, "pe-lungs": false } },
      { items: { ...ITEMS, "made-up": true } },
      { items: { ...ITEMS, "pe-lungs": "yes" } },
      { items: [true, false, true] },
      {},
    ]) {
      expect(await intent(r.c, "score-station", bad)).toMatchObject({ status: "reject", reason: "invalid-score" });
    }
    expect(await intent(r.c, "select-actor", { actorId: "a1" })).toMatchObject({ status: "reject", reason: "replay-read-only" });
    expect(existsSync(join(scoreDir, "station-1.faculty-score.json"))).toBe(false);
  }, 60000);

  it("the lobby lists scored stations from disk, including on a new server over the same scoreDir", async () => {
    const replayDir = writeReviewDir();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-c13-score-"));
    const config = { replayDir, scoreDir, reviewRubric: RUBRIC, replayStepMs: STEP_MS };
    const first = await boot(config);
    const r = await lobbyToReplay(first, "station-2");
    expect(await intent(r.c, "score-station", { items: ITEMS })).toMatchObject({ status: "ack" });
    expect(await intent(r.c, "return-to-lobby", {})).toMatchObject({ status: "ack" });
    await waitFor(() => r.last()?.mode === "lobby", 5000, "back in lobby");
    expect(r.last()?.lobbyScores).toEqual([{ stationId: "station-2", checkedCount: 2 }]);
    expect(r.last()?.lobbyStations?.map((s) => Object.keys(s).sort())).toEqual([
      ["noteChars", "notePresent", "stationId", "stationIndex", "turnCount"],
      ["noteChars", "notePresent", "stationId", "stationIndex", "turnCount"],
    ]);
    await r.c.leave();
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await boot(config);
    const fresh = await joinRoom(second, { reviewLobby: true });
    await waitFor(() => fresh.last()?.mode === "lobby" && (fresh.last()?.lobbyStations?.length ?? 0) === 2, 5000, "fresh lobby");
    expect(fresh.last()?.lobbyScores).toEqual([{ stationId: "station-2", checkedCount: 2 }]);
  }, 60000);

  it("C12 carry-overs: launch reaches only the selector, one launch per lobby, live onAuth refuses reviewLobby", async () => {
    const server = await boot({ replayDir: writeReviewDir(), replayStepMs: STEP_MS });
    const idle = await joinRoom(server, { reviewLobby: true });
    await waitFor(() => idle.last()?.mode === "lobby", 5000, "idle lobby");
    const picker = await joinRoom(server, { reviewLobby: true });
    await waitFor(() => picker.last()?.mode === "lobby", 5000, "picker lobby");
    // Two selects sent together: exactly one launch; the other rejects launch-pending.
    const results = await Promise.all([
      intent(picker.c, "select-station", { stationId: "station-1" }),
      intent(picker.c, "select-station", { stationId: "station-2" }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual(["ack", "reject"]);
    expect(results.find((x) => x.status === "reject")).toMatchObject({ reason: "launch-pending" });
    await waitFor(() => picker.last()?.replayDone === true, REPLAY_TIMEOUT_MS, "picker replayDone");
    await new Promise((resolve) => setTimeout(resolve, 500));
    // A launch delivered to the idle reviewer either moves it out of the lobby or fails its consume: both fail here.
    expect(idle.modes).toEqual(["lobby"]);
    expect(idle.c.rotationFailed).toBeNull();
    expect(picker.c.rotationFailed).toBeNull();

    // Live server with its station room already open: a reviewLobby join reaches onAuth of that room and is refused.
    const live = await boot({});
    const learner = await connect(live.url, {});
    leavers.push(() => learner.leave());
    await expect(connect(live.url, { roomOptions: { reviewLobby: true } })).rejects.toThrow();
  }, 60000);
});
