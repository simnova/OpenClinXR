import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type EncounterSnapshot, type IntentKind, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C45 RED: a learner who types a patient note and never clicks Submit still has it collected when the note phase ends.
// Contract (names are the spec):
//   intent "note-draft" { text }: accepted only in the note phase (else reject "outside-note-phase"), validated like note-submit
//     (empty / over noteMaxChars / non-string -> reject; whitespace-only -> reject "invalid-note"), held server-side only.
//   rate limit: at most 1 accepted draft per learner per 50 ms, excess rejected "draft-rate-limited".
//   the latest draft decides: a rejected (invalid) draft clears the held draft.
//   note -> closed with no accepted explicit submit and a held valid draft: noteText = draft, noteStatus "submitted", noteChars = length,
//     state noteSource "draft", ONE trace event note-submitted { chars, source: "draft" }, once only.
//   an accepted note-submit sets noteSource "explicit", traces source "explicit", and disables promotion for the station.
//   neither the draft nor the note text enters the trace or the synced state.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 3 };
const NOTE_MAX = 60;
const DRAFT = "HPI: 2h chest pressure, radiating to left arm.";
const DRAFT_B = "HPI: 2h chest pressure. PE: lungs clear.";
const EXPLICIT = "Explicit note: chest pressure, ECG ordered.";
const PHASE_TIMEOUT_MS = 10000;
const SPACING_MS = 70;

type Snap = EncounterSnapshot & { noteStatus?: string; noteChars?: number; noteSource?: string };
interface TraceEvent { kind: string; chars?: number; source?: string; phase?: string }

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

async function joinRoom(server: EncounterServer): Promise<{ c: SyncConnection; last: () => Snap | null; seen: Snap[] }> {
  const c = await connect(server.url, { roomOptions: { actors: ["a1"] } });
  leavers.push(() => c.leave());
  let last: Snap | null = null;
  const seen: Snap[] = [];
  c.onState((s) => { last = s as Snap; seen.push(last); });
  return { c, last: () => last, seen };
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const draft = (c: SyncConnection, text: unknown) => c.sendIntent("note-draft" as IntentKind, { text } as never);
const submit = (c: SyncConnection, text: string) => c.sendIntent("note-submit" as IntentKind, { text });

async function bootStation(): Promise<{ traceDir: string; server: EncounterServer }> {
  const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c45-"));
  const server = await boot({ timing: TIMING, noteMaxChars: NOTE_MAX, traceDir, stations: ["station-1"] });
  return { traceDir, server };
}

async function closedArtifacts(traceDir: string): Promise<{ events: TraceEvent[]; raw: string; index: { stations: Array<Record<string, unknown>> }; noteFile: string | undefined }> {
  await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), PHASE_TIMEOUT_MS * 2, "review index");
  const files = readdirSync(traceDir);
  const traceFile = files.find((f) => f.endsWith(".conversation-trace.json"));
  const raw = readFileSync(join(traceDir, String(traceFile)), "utf8");
  const noteName = files.find((f) => f.endsWith(".patient-note.json"));
  return {
    events: (JSON.parse(raw) as { events: TraceEvent[] }).events,
    raw,
    index: JSON.parse(readFileSync(join(traceDir, "exam-session.review-index.json"), "utf8")),
    noteFile: noteName === undefined ? undefined : readFileSync(join(traceDir, noteName), "utf8"),
  };
}

function sharesLongSubstring(haystack: string, text: string, length = 12): boolean {
  for (let i = 0; i + length <= text.length; i += 1) if (haystack.includes(text.slice(i, i + length))) return true;
  return false;
}

describe("xr-sync-server C45 note draft promotion", () => {
  it("promotes the latest draft once at note -> closed: one note-submitted source draft, review index sees the note, no text in trace or state", async () => {
    const { traceDir, server } = await bootStation();
    const { c, last, seen } = await joinRoom(server);
    await waitFor(() => last()?.phase === "note", PHASE_TIMEOUT_MS, "note");
    expect(await draft(c, DRAFT)).toMatchObject({ status: "ack" });
    await sleep(SPACING_MS);
    expect(await draft(c, DRAFT_B)).toMatchObject({ status: "ack" });
    expect(last()?.noteStatus).toBe("none");
    const { events, raw, index, noteFile } = await closedArtifacts(traceDir);
    const notes = events.filter((e) => e.kind === "note-submitted");
    expect(notes).toEqual([expect.objectContaining({ kind: "note-submitted", chars: DRAFT_B.length, source: "draft" })]);
    expect(index.stations[0]).toMatchObject({ notePresent: true, noteChars: DRAFT_B.length });
    expect(JSON.parse(String(noteFile))).toMatchObject({ text: DRAFT_B, chars: DRAFT_B.length });
    expect(sharesLongSubstring(raw, DRAFT_B)).toBe(false);
    expect(sharesLongSubstring(raw, DRAFT)).toBe(false);
    const states = JSON.stringify(seen);
    expect(sharesLongSubstring(states, DRAFT_B)).toBe(false);
    expect(sharesLongSubstring(states, DRAFT)).toBe(false);
  }, 60000);

  it("state carries noteSource draft with noteStatus submitted and noteChars after the promotion", async () => {
    const { server } = await bootStation();
    const { c, last } = await joinRoom(server);
    await waitFor(() => last()?.phase === "note", PHASE_TIMEOUT_MS, "note");
    expect(last()?.noteSource ?? "").toBe("");
    await draft(c, DRAFT);
    await waitFor(() => last()?.noteSource === "draft", PHASE_TIMEOUT_MS, "noteSource draft");
    expect(last()).toMatchObject({ noteStatus: "submitted", noteChars: DRAFT.length, noteSource: "draft" });
  }, 60000);

  it("an explicit submit after a draft traces source explicit, disables promotion, and a later draft is not promoted", async () => {
    const { traceDir, server } = await bootStation();
    const { c, last } = await joinRoom(server);
    await waitFor(() => last()?.phase === "note", PHASE_TIMEOUT_MS, "note");
    await draft(c, DRAFT);
    await sleep(SPACING_MS);
    expect(await submit(c, EXPLICIT)).toMatchObject({ status: "ack" });
    await waitFor(() => last()?.noteSource === "explicit", 2000, "noteSource explicit");
    await sleep(SPACING_MS);
    await draft(c, DRAFT_B);
    const { events, noteFile } = await closedArtifacts(traceDir);
    expect(events.filter((e) => e.kind === "note-submitted")).toEqual([expect.objectContaining({ chars: EXPLICIT.length, source: "explicit" })]);
    expect(JSON.parse(String(noteFile))).toMatchObject({ text: EXPLICIT });
    expect(last()?.noteSource).toBe("explicit");
  }, 60000);

  it("the latest draft decides: an empty, whitespace-only or over-cap last draft is not promoted and an earlier valid draft does not resurrect", async () => {
    for (const bad of [{ text: "", reason: "invalid-note" }, { text: "  \n ", reason: "invalid-note" }, { text: "x".repeat(NOTE_MAX + 1), reason: "note-too-long" }]) {
      const { traceDir, server } = await bootStation();
      const { c, last } = await joinRoom(server);
      await waitFor(() => last()?.phase === "note", PHASE_TIMEOUT_MS, "note");
      expect(await draft(c, DRAFT)).toMatchObject({ status: "ack" });
      await sleep(SPACING_MS);
      expect(await draft(c, bad.text)).toMatchObject({ status: "reject", reason: bad.reason });
      const { events, index } = await closedArtifacts(traceDir);
      expect(events.filter((e) => e.kind === "note-submitted")).toEqual([]);
      expect(index.stations[0]).toMatchObject({ notePresent: false });
      await server.close();
      servers.splice(servers.indexOf(server), 1);
    }
  }, 90000);

  it("rejects a draft outside the note phase and does not promote a draft that arrives after closed", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c45-late-"));
    const server = await boot({ timing: TIMING, noteMaxChars: NOTE_MAX, traceDir });
    const { c, last } = await joinRoom(server);
    expect(await draft(c, DRAFT)).toMatchObject({ status: "reject", reason: "outside-note-phase" });
    await waitFor(() => last()?.phase === "encounter", PHASE_TIMEOUT_MS, "encounter");
    expect(await draft(c, DRAFT)).toMatchObject({ status: "reject", reason: "outside-note-phase" });
    await waitFor(() => last()?.phase === "closed", PHASE_TIMEOUT_MS, "closed");
    await sleep(SPACING_MS);
    expect(await draft(c, DRAFT)).toMatchObject({ status: "reject", reason: "outside-note-phase" });
    expect(last()?.noteStatus).toBe("none");
    await c.leave();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const traceFile = readdirSync(traceDir).find((f) => f.endsWith(".conversation-trace.json"));
    const events = (JSON.parse(readFileSync(join(traceDir, String(traceFile)), "utf8")) as { events: TraceEvent[] }).events;
    expect(events.filter((e) => e.kind === "note-submitted")).toEqual([]);
  }, 60000);

  it("rate limit: a burst of 100 raw drafts yields one accepted per 50 ms window, the rest draft-rate-limited; a later draft is accepted", async () => {
    const { server } = await bootStation();
    const { c, last } = await joinRoom(server);
    await waitFor(() => last()?.phase === "note", PHASE_TIMEOUT_MS, "note");
    const startedAt = Date.now();
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => draft(c, `${DRAFT} ${i}`)));
    const elapsedMs = Date.now() - startedAt;
    const accepted = results.filter((r) => r.status === "ack").length;
    const limited = results.filter((r) => r.status === "reject" && r.reason === "draft-rate-limited").length;
    expect(accepted + limited).toBe(100);
    expect(accepted).toBeGreaterThanOrEqual(1);
    expect(accepted).toBeLessThanOrEqual(Math.floor(elapsedMs / 50) + 1);
    if (elapsedMs < 50) expect(accepted).toBe(1);
    await sleep(SPACING_MS);
    expect(await draft(c, DRAFT_B)).toMatchObject({ status: "ack" });
  }, 60000);

  it("a reconnect during the note phase does not trace a second note-submitted", async () => {
    const { traceDir, server } = await bootStation();
    const { c, last } = await joinRoom(server);
    await waitFor(() => last()?.phase === "note", PHASE_TIMEOUT_MS, "note");
    await draft(c, DRAFT);
    await c.reconnect();
    const { events } = await closedArtifacts(traceDir);
    expect(events.filter((e) => e.kind === "note-submitted")).toHaveLength(1);
  }, 60000);

  it("a rotation to a second station promotes that station's own draft once: each station trace holds exactly one note-submitted with its own chars", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c45-rot-"));
    const server = await boot({ timing: { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 3 }, noteMaxChars: NOTE_MAX, traceDir, stations: ["station-1", "station-2"] });
    const { c, last } = await joinRoom(server);
    await waitFor(() => last()?.stationId === "station-1" && last()?.phase === "note", PHASE_TIMEOUT_MS, "station-1 note");
    expect(await draft(c, DRAFT)).toMatchObject({ status: "ack" });
    await waitFor(() => last()?.stationId === "station-2" && last()?.phase === "note", PHASE_TIMEOUT_MS * 2, "station-2 note");
    expect(last()?.noteSource ?? "").toBe("");
    expect(await draft(c, DRAFT_B)).toMatchObject({ status: "ack" });
    await waitFor(() => last()?.phase === "closed" && last()?.noteSource === "draft", PHASE_TIMEOUT_MS * 2, "station-2 closed with its draft");
    await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), PHASE_TIMEOUT_MS * 2, "review index");
    const byStation = new Map<string, TraceEvent[]>();
    for (const name of readdirSync(traceDir).filter((f) => f.endsWith(".conversation-trace.json"))) {
      const parsed = JSON.parse(readFileSync(join(traceDir, name), "utf8")) as { stationId: string; events: TraceEvent[] };
      byStation.set(parsed.stationId, parsed.events.filter((e) => e.kind === "note-submitted"));
    }
    expect(byStation.get("station-1")).toEqual([expect.objectContaining({ chars: DRAFT.length, source: "draft" })]);
    expect(byStation.get("station-2")).toEqual([expect.objectContaining({ chars: DRAFT_B.length, source: "draft" })]);
  }, 90000);
});
