import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type EncounterSnapshot, type IntentKind, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// Card tsk_3b2b5bb28eb3a5de: the lobby score badge carries its rubric items.
// Contract (names are the spec):
//   LobbyScoreState gains items: [{ id, checked }] in rubric order, filled from
//   the same validated score file as the badge (faculty-score buildFacultyScore
//   shape { id, checked }); the xr-sync-client lobbyScores snapshot mirrors it.
//   Run-7 values: station-1 hpi-onset:true, pe-lungs:false, plan-shared:true;
//   station-2 true/true/false; station-3 true/false/true; checkedCount 2 each.
//   Tests write these into a tmp scoreDir (never /Volumes/files/openclinxr-assets).
//   E1: for one scoreDir, the lobby badge items deep-equal the packet's station
//   score.items (one source, two readers). CW1: checkedCount equals the count of
//   checked items for every badge. CW3: a forged/invalid score file yields no
//   badge and no items (same validator).

const STEP_MS = 200;
const RUBRIC = [
  { id: "hpi-onset", label: "Asked onset" },
  { id: "pe-lungs", label: "Examined lungs" },
  { id: "plan-shared", label: "Shared the plan" },
];
const RUN7: Record<string, boolean[]> = {
  "station-1": [true, false, true],
  "station-2": [true, true, false],
  "station-3": [true, false, true],
};

const ev = (kind: string, extra: Record<string, unknown> = {}) => ({ seq: null, kind, actorId: "", turnId: null, ...extra });
const ack = (turnIndex: number, from: string, to: string) => ({ from, to, trigger: "learner_acknowledgement", changed: from !== to, turnIndex });
const trace = (stationId: string, actorId: string, replyId: string) => ({
  schema: "openclinxr.xr-sync.conversation-trace.v1",
  stationId,
  events: [
    ev("phase-changed", { phase: "doorway" }), ev("phase-changed", { phase: "encounter" }),
    ev("select-actor", { seq: 1, actorId }), ev("utterance-start", { seq: 2 }),
    ev("utterance-end", { seq: 3, actorId, turnId: 1 }), ev("turn-completed", { actorId, turnId: 1 }),
    ev("phase-changed", { phase: "note" }), ev("phase-changed", { phase: "closed" }),
  ],
  turns: [{ turnId: 1, actorId, replyId, cueId: `cue-${replyId}`, startSeq: 3, end: "completed", endSeq: null }],
  emotions: [ack(1, "neutral", "reassured")],
});

function writeReviewDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-items-replay-"));
  const traces = [trace("station-1", "a1", "fx-i1"), trace("station-2", "a2", "fx-i2"), trace("station-3", "a3", "fx-i3")];
  for (let i = 0; i < traces.length; i += 1) writeFileSync(join(dir, `M${i + 1}.conversation-trace.json`), JSON.stringify(traces[i]));
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
    schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: 3,
    stations: traces.map((t, i) => ({
      stationId: t.stationId, stationIndex: i, traceFile: `M${i + 1}.conversation-trace.json`, phases: ["doorway", "encounter", "note", "closed"],
      turnCount: 1, turnEnds: ["completed"], observerPresent: false, notePresent: false, noteChars: 0, noteFile: null,
    })),
  }));
  return dir;
}

function scoreFile(stationId: string, checked: boolean[]) {
  return {
    schema: "openclinxr.xr-sync.faculty-score.v1", stationId,
    items: RUBRIC.map((x, i) => ({ id: x.id, checked: checked[i] })), checkedCount: checked.filter(Boolean).length, rubricSize: RUBRIC.length,
  };
}

function writeRun7Scores(scoreDir: string): void {
  for (const [stationId, checked] of Object.entries(RUN7)) {
    writeFileSync(join(scoreDir, `${stationId}.faculty-score.json`), JSON.stringify(scoreFile(stationId, checked)));
  }
}

type Badge = { stationId: string; checkedCount: number; items?: { id: string; checked: boolean }[] };
type Snap = EncounterSnapshot & { mode?: string; lobbyStations?: unknown[]; lobbyScores?: Badge[]; reviewFinalized?: boolean };

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

async function openLobby(server: EncounterServer) {
  const r = await joinRoom(server, { reviewLobby: true });
  await waitFor(() => r.last()?.mode === "lobby" && (r.last()?.lobbyScores?.length ?? 0) > 0, 5000, "lobby scores");
  return r;
}

const intent = (c: SyncConnection, kind: string, payload: Record<string, unknown>) => c.sendIntent(kind as IntentKind, payload);

describe("the lobby score badge carries its rubric items", () => {
  it("RED1: a lobby over a tmp scoreDir holding run-7 station-1 shows its items", async () => {
    const replayDir = writeReviewDir();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-items-score-"));
    writeRun7Scores(scoreDir);
    const server = await boot({ replayDir, scoreDir, reviewRubric: RUBRIC, replayStepMs: STEP_MS });
    const lobby = await openLobby(server);
    const badge = lobby.last()?.lobbyScores?.find((b) => b.stationId === "station-1");
    expect(badge?.items).toEqual([
      { id: "hpi-onset", checked: true },
      { id: "pe-lungs", checked: false },
      { id: "plan-shared", checked: true },
    ]);
  }, 40000);

  it("E1: for one scoreDir the lobby badge items deep-equal the packet station score items", async () => {
    const replayDir = writeReviewDir();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-items-score-"));
    writeRun7Scores(scoreDir);
    const server = await boot({ replayDir, scoreDir, reviewRubric: RUBRIC, replayStepMs: STEP_MS });
    const lobby = await openLobby(server);
    expect(await intent(lobby.c, "finalize-review", {})).toMatchObject({ status: "ack" });
    await waitFor(() => lobby.last()?.reviewFinalized === true, 5000, "reviewFinalized");
    const packet = JSON.parse(readFileSync(join(scoreDir, "exam-session.review-packet.json"), "utf8")) as {
      stations: { stationId: string; score: { items: { id: string; checked: boolean }[] } }[];
    };
    for (const station of packet.stations) {
      const badge = lobby.last()?.lobbyScores?.find((b) => b.stationId === station.stationId);
      expect(badge?.items).toEqual(station.score.items);
    }
  }, 40000);

  it("CW1: checkedCount equals the count of checked items for every badge", async () => {
    const replayDir = writeReviewDir();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-items-score-"));
    writeRun7Scores(scoreDir);
    const server = await boot({ replayDir, scoreDir, reviewRubric: RUBRIC, replayStepMs: STEP_MS });
    const lobby = await openLobby(server);
    for (const badge of lobby.last()?.lobbyScores ?? []) {
      expect(badge.checkedCount).toBe((badge.items ?? []).filter((item) => item.checked).length);
      expect(badge.checkedCount).toBe(2);
    }
    expect(lobby.last()?.lobbyScores?.length).toBe(3);
  }, 40000);

  it("CW3: a forged score file yields no badge and no items", async () => {
    const replayDir = writeReviewDir();
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-items-score-"));
    writeFileSync(join(scoreDir, "station-1.faculty-score.json"), JSON.stringify(scoreFile("station-1", RUN7["station-1"] ?? [])));
    const forged = scoreFile("station-2", RUN7["station-2"] ?? []);
    (forged as { checkedCount: number }).checkedCount = 0;
    writeFileSync(join(scoreDir, "station-2.faculty-score.json"), JSON.stringify(forged));
    const server = await boot({ replayDir, scoreDir, reviewRubric: RUBRIC, replayStepMs: STEP_MS });
    const r = await joinRoom(server, { reviewLobby: true });
    await waitFor(() => r.last()?.mode === "lobby", 5000, "lobby");
    const badges = r.last()?.lobbyScores ?? [];
    expect(badges.map((b) => b.stationId)).toEqual(["station-1"]);
    expect(badges.find((b) => b.stationId === "station-2")).toBeUndefined();
  }, 40000);

  it("RED3: a bank-mode lobby over a tmp scoreDir holding a valid station score file carries its 3 items", async () => {
    const bankScenarioId = "bank-scenario-1";
    const bankRubric = [
      { rubricId: "bank-hpi", label: "Bank onset", requiredTraceTags: [] as string[] },
      { rubricId: "bank-exam", label: "Bank lungs", requiredTraceTags: [] as string[] },
      { rubricId: "bank-plan", label: "Bank plan", requiredTraceTags: [] as string[] },
    ];
    const bankChecked = [true, false, true];
    const dir = mkdtempSync(join(tmpdir(), "xr-sync-items-bank-replay-"));
    const bankTrace = { ...trace("station-1", "a1", "fx-b1"), scenarioId: bankScenarioId };
    writeFileSync(join(dir, "M1.conversation-trace.json"), JSON.stringify(bankTrace));
    writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
      schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: 1,
      stations: [{
        stationId: "station-1", stationIndex: 0, traceFile: "M1.conversation-trace.json", phases: ["doorway", "encounter", "note", "closed"],
        turnCount: 1, turnEnds: ["completed"], observerPresent: false, notePresent: false, noteChars: 0, noteFile: null,
      }],
    }));
    const scoreDir = mkdtempSync(join(tmpdir(), "xr-sync-items-bank-score-"));
    writeFileSync(join(scoreDir, "station-1.faculty-score.json"), JSON.stringify({
      schema: "openclinxr.xr-sync.faculty-score.v1", stationId: "station-1", scenarioId: bankScenarioId,
      items: bankRubric.map((entry, i) => ({ id: entry.rubricId, checked: bankChecked[i] === true })),
      checkedCount: bankChecked.filter(Boolean).length, rubricSize: bankRubric.length,
    }));
    const server = await boot({
      replayDir: dir, scoreDir, replayStepMs: STEP_MS,
      scenarios: [{ scenarioId: bankScenarioId, reviewRubric: bankRubric }],
    });
    const lobby = await openLobby(server);
    const badge = lobby.last()?.lobbyScores?.find((b) => b.stationId === "station-1");
    expect(badge?.items).toEqual([
      { id: "bank-hpi", checked: true },
      { id: "bank-exam", checked: false },
      { id: "bank-plan", checked: true },
    ]);
    expect(badge?.checkedCount).toBe((badge?.items ?? []).filter((item) => item.checked).length);
  }, 40000);
});
