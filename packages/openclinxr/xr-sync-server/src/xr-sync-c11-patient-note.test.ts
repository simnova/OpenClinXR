import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type EncounterSnapshot, type IntentKind, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C11 RED (planted by root, 2026-10-30): the learner writes a Step 2 CS-style patient note in the note phase.
// Contract (names are the spec):
//   intent "note-submit" { text: string } from a learner:
//     accepted only while phase === "note"; otherwise reject "outside-note-phase" (brief mode included)
//     text must be a non-empty string -> else reject "invalid-note"
//     text.length > noteMaxChars (server config createEncounterServer({ noteMaxChars }), never roomOptions) -> reject "note-too-long"
//     observers keep rejecting "observer-read-only" first
//     resubmission in the note phase replaces the note (last wins)
//   state: noteStatus ("none" | "submitted") and noteChars (length of the held note, 0 when none)
//   trace: one "note-submitted" event per accepted note with chars; the note TEXT never enters the trace
//   persistence (traceDir set): when the station reaches "closed" the server writes
//     <traceDir>/<roomId>.patient-note.json { schema "openclinxr.xr-sync.patient-note.v1", stationId, text, chars }
//     (no session id, no timestamps); no accepted note -> no note file
//   review index (C9): each station entry gains notePresent, noteChars, noteFile (basename or null)
//   replay (C10): a recorded note-submitted event sets noteStatus "submitted" + noteChars in replay state; text is never replayed
//   C10 grade carry-over: a trace whose emotions array is shorter than the transitions its events need refuses the replay join
//     for THAT station only; other stations in the same replayDir still replay (validation is per station, not per dir)
// Timings, the 40-char limit and note texts are illustrative test values, not product values.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 3 };
const NOTE_MAX = 40;
const NOTE_A = "HPI: 2h chest pain, no radiation.";
const NOTE_B = "HPI: 2h chest pain. PE: clear lungs.";
const PHASE_TIMEOUT_MS = 10000;

type Snap = EncounterSnapshot & { noteStatus?: string; noteChars?: number; replayDone?: boolean };

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

async function joinRoom(server: EncounterServer, roomOptions: Record<string, unknown> = { actors: ["a1"] }): Promise<{ c: SyncConnection; last: () => Snap | null }> {
  const c = await connect(server.url, { roomOptions });
  leavers.push(() => c.leave());
  let last: Snap | null = null;
  c.onState((s) => { last = s as Snap; });
  return { c, last: () => last };
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const submit = (c: SyncConnection, payload: Record<string, unknown>) => c.sendIntent("note-submit" as IntentKind, payload);

describe("xr-sync-server C11 patient note", () => {
  it("known-good: without timing a note-submit is rejected", async () => {
    const server = await boot({});
    const { c } = await joinRoom(server);
    const result = await submit(c, { text: NOTE_A });
    expect(result.status).toBe("reject");
  }, 30000);

  it("accepts a note only in the note phase, last wins, state carries noteStatus/noteChars", async () => {
    const server = await boot({ timing: TIMING, noteMaxChars: NOTE_MAX });
    const { c, last } = await joinRoom(server, { actors: ["a1"], noteMaxChars: 1 });
    expect(await submit(c, { text: NOTE_A })).toMatchObject({ status: "reject", reason: "outside-note-phase" });
    await waitFor(() => last()?.phase === "encounter", PHASE_TIMEOUT_MS, "encounter");
    expect(await submit(c, { text: NOTE_A })).toMatchObject({ status: "reject", reason: "outside-note-phase" });
    await waitFor(() => last()?.phase === "note", PHASE_TIMEOUT_MS, "note");
    expect(last()?.noteStatus).toBe("none");
    expect(last()?.noteChars).toBe(0);
    // roomOptions.noteMaxChars 1 is ignored: the server config (40) governs.
    expect(await submit(c, { text: NOTE_A })).toMatchObject({ status: "ack" });
    await waitFor(() => last()?.noteChars === NOTE_A.length, 2000, "noteChars A");
    expect(last()?.noteStatus).toBe("submitted");
    expect(await submit(c, { text: NOTE_B })).toMatchObject({ status: "ack" });
    await waitFor(() => last()?.noteChars === NOTE_B.length, 2000, "noteChars B");
    await waitFor(() => last()?.phase === "closed", PHASE_TIMEOUT_MS, "closed");
    expect(await submit(c, { text: NOTE_A })).toMatchObject({ status: "reject", reason: "outside-note-phase" });
  }, 40000);

  it("validates the note: invalid-note, note-too-long, observer-read-only", async () => {
    const server = await boot({ timing: TIMING, noteMaxChars: NOTE_MAX });
    const { c, last } = await joinRoom(server);
    const observer = await joinRoom(server, { role: "observer" });
    await waitFor(() => last()?.phase === "note", PHASE_TIMEOUT_MS, "note");
    expect(await submit(c, { text: "" })).toMatchObject({ status: "reject", reason: "invalid-note" });
    expect(await submit(c, { text: 42 })).toMatchObject({ status: "reject", reason: "invalid-note" });
    expect(await submit(c, {})).toMatchObject({ status: "reject", reason: "invalid-note" });
    expect(await submit(c, { text: "x".repeat(NOTE_MAX + 1) })).toMatchObject({ status: "reject", reason: "note-too-long" });
    expect(await submit(c, { text: "x".repeat(NOTE_MAX) })).toMatchObject({ status: "ack" });
    expect(await submit(observer.c, { text: NOTE_A })).toMatchObject({ status: "reject", reason: "observer-read-only" });
  }, 40000);

  it("persists the note file at closed, keeps text out of the trace, and links it from the review index", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c11-"));
    const server = await boot({ timing: TIMING, noteMaxChars: NOTE_MAX, traceDir, stations: ["station-1"] });
    const { c, last } = await joinRoom(server);
    await waitFor(() => last()?.phase === "note", PHASE_TIMEOUT_MS, "note");
    expect(await submit(c, { text: NOTE_A })).toMatchObject({ status: "ack" });
    expect(await submit(c, { text: NOTE_B })).toMatchObject({ status: "ack" });
    await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), PHASE_TIMEOUT_MS, "review index");
    const files = readdirSync(traceDir);
    const noteFile = files.find((f) => f.endsWith(".patient-note.json"));
    const traceFile = files.find((f) => f.endsWith(".conversation-trace.json"));
    expect(noteFile).toBeDefined();
    expect(noteFile?.replace(".patient-note.json", "")).toBe(traceFile?.replace(".conversation-trace.json", ""));
    const noteRaw = readFileSync(join(traceDir, String(noteFile)), "utf8");
    expect(JSON.parse(noteRaw)).toEqual({ schema: "openclinxr.xr-sync.patient-note.v1", stationId: "station-1", text: NOTE_B, chars: NOTE_B.length });
    expect(noteRaw).not.toContain(c.sessionId);
    const traceRaw = readFileSync(join(traceDir, String(traceFile)), "utf8");
    expect(traceRaw).not.toContain("chest pain");
    const noteEvents = (JSON.parse(traceRaw) as { events: Array<{ kind: string; chars?: number }> }).events.filter((e) => e.kind === "note-submitted");
    expect(noteEvents.map((e) => e.chars)).toEqual([NOTE_A.length, NOTE_B.length]);
    const index = JSON.parse(readFileSync(join(traceDir, "exam-session.review-index.json"), "utf8")) as { stations: Array<Record<string, unknown>> };
    expect(index.stations[0]).toMatchObject({ notePresent: true, noteChars: NOTE_B.length, noteFile });
  }, 40000);

  it("known-good-shaped: a station with no accepted note writes no note file and indexes notePresent false", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c11-none-"));
    const server = await boot({ timing: TIMING, noteMaxChars: NOTE_MAX, traceDir, stations: ["station-1"] });
    await joinRoom(server);
    await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), PHASE_TIMEOUT_MS * 2, "review index");
    expect(readdirSync(traceDir).some((f) => f.endsWith(".patient-note.json"))).toBe(false);
    const index = JSON.parse(readFileSync(join(traceDir, "exam-session.review-index.json"), "utf8")) as { stations: Array<Record<string, unknown>> };
    expect(index.stations[0]).toMatchObject({ notePresent: false, noteChars: 0, noteFile: null });
  }, 40000);

  it("replays a recorded note-submitted event as noteChars, and refuses a trace with too few emotions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-sync-c11-replay-"));
    const ev = (kind: string, extra: Record<string, unknown> = {}) => ({ seq: null, kind, actorId: "", turnId: null, ...extra });
    const events = [
      ev("phase-changed", { phase: "doorway" }), ev("phase-changed", { phase: "encounter" }),
      ev("select-actor", { seq: 1, actorId: "a1" }), ev("utterance-start", { seq: 2 }),
      ev("utterance-end", { seq: 3, actorId: "a1", turnId: 1 }), ev("turn-completed", { actorId: "a1", turnId: 1 }),
      ev("phase-changed", { phase: "note" }), ev("note-submitted", { seq: 4, chars: 37 }), ev("phase-changed", { phase: "closed" }),
    ];
    const turns = [{ turnId: 1, actorId: "a1", replyId: "fx-r", cueId: "cue-fx-r", startSeq: 3, end: "completed", endSeq: null }];
    const emotion = { from: "neutral", to: "reassured", trigger: "learner_acknowledgement", changed: true, turnIndex: 1 };
    const trace = (stationId: string, emotions: unknown[]) => ({ schema: "openclinxr.xr-sync.conversation-trace.v1", stationId, events, turns, emotions });
    writeFileSync(join(dir, "N1.conversation-trace.json"), JSON.stringify(trace("station-1", [emotion])));
    writeFileSync(join(dir, "N2.conversation-trace.json"), JSON.stringify(trace("station-2", [])));
    const entry = (stationId: string, stationIndex: number, traceFile: string) => ({
      stationId, stationIndex, traceFile, phases: ["doorway", "encounter", "note", "closed"], turnCount: 1, turnEnds: ["completed"], observerPresent: false,
    });
    writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({
      schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: 2,
      stations: [entry("station-1", 0, "N1.conversation-trace.json"), entry("station-2", 1, "N2.conversation-trace.json")],
    }));
    const server = await boot({ replayDir: dir, replayStepMs: 200 });
    const { last } = await joinRoom(server, { replayStationId: "station-1" });
    await waitFor(() => last()?.replayDone === true, 15000, "replayDone");
    expect(last()).toMatchObject({ noteStatus: "submitted", noteChars: 37 });
    // station-2's trace needs one emotion (one utterance-end) and records none.
    await expect(connect(server.url, { roomOptions: { replayStationId: "station-2" } })).rejects.toThrow();
  }, 40000);
});
