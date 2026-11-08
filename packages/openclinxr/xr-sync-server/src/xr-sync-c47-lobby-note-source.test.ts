import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type EncounterSnapshot, type IntentKind, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C47 RED (lane manager, 2026-11-08): the review index and the lobby row carry how each station's note arrived.
// Discriminator for noteSource (A1, super-ceo 2026-11-08):
//   null                 = no note in this station (notePresent false)
//   ''                   = note present, source unrecorded (index written before C45)
//   'explicit' | 'draft' = from the C45 note-submitted source enum
// '' never occurs with notePresent false (A2): a pre-C45 entry without a note loads as null, not ''.
// Fixtures are real runs on main 92fe4a2bc (provenance in each file): the draft fixture is the C45 harness (typed, never submitted), the
// explicit fixture is the same harness plus a Submit click. Both index entries were persisted WITHOUT a source, which is the defect.
// Every assertion is an exact field value per fixture.
const here = dirname(fileURLToPath(import.meta.url));
interface Fixture { provenance: { mainSha: string; command: string }; index: { stations: Array<Record<string, unknown>> }; trace: { stationId: string; scenarioId: string; events: Array<Record<string, unknown>> } }
const read = (name: string): Fixture => JSON.parse(readFileSync(join(here, name), "utf8")) as Fixture;
const DRAFT = read("xr-sync-c47-draft-note.fixture.json");
const EXPLICIT = read("xr-sync-c47-explicit-note.fixture.json");
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const noteEvents = (trace: Fixture["trace"]) => trace.events.filter((e) => e["kind"] === "note-submitted");

function writeDir(stations: Array<{ id: string; trace: Fixture["trace"]; entry: Record<string, unknown> }>): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sync-c47-"));
  for (const s of stations) writeFileSync(join(dir, `c47-${s.id}.conversation-trace.json`), JSON.stringify({ ...s.trace, stationId: s.id }));
  writeFileSync(join(dir, "exam-session.review-index.json"), JSON.stringify({ schema: "openclinxr.xr-sync.exam-session-review-index.v1", complete: true, stationCount: stations.length, stations: stations.map((s) => s.entry) }));
  return dir;
}
const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});
type Row = { stationId: string; notePresent: boolean; noteChars: number; noteSource?: string | undefined };
async function lobbyRows(dir: string, count: number): Promise<Row[]> {
  const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)({ replayDir: dir, scenarios: [{ ...edChestPainScenario, status: "approved" }], dialogueSeeds: scenarioDialogueSeedBank });
  servers.push(server);
  const c = await connect(server.url, { roomOptions: { reviewLobby: true } });
  leavers.push(() => c.leave());
  let rows: Row[] = [];
  c.onState((s: EncounterSnapshot) => { rows = ((s as { lobbyStations?: Row[] }).lobbyStations ?? []).map((r) => ({ stationId: r.stationId, notePresent: r.notePresent, noteChars: r.noteChars, noteSource: r.noteSource })); });
  const start = Date.now();
  while (rows.length < count && Date.now() - start < 8000) await new Promise((r) => setTimeout(r, 50));
  return rows;
}

const TIMING = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 3 };
const PHASE_TIMEOUT_MS = 10000;
const SPACING_MS = 70;
const NOTE = "HPI: 2h chest pressure, radiating to left arm.";
const NOTE_B = "Explicit note: chest pressure, ECG ordered.";
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function boot(options: Record<string, unknown>): Promise<EncounterServer> {
  const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)(options);
  servers.push(server);
  return server;
}
/** One live station run to closed: the learner joins, runs `act` in the note phase, and the persisted index entry is returned. */
async function liveIndexEntry(act: (c: SyncConnection) => Promise<void>): Promise<Record<string, unknown>> {
  const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c47-live-"));
  const server = await boot({ timing: TIMING, noteMaxChars: 60, traceDir, stations: ["station-1"] });
  const c = await connect(server.url, { roomOptions: { actors: ["a1"] } });
  leavers.push(() => c.leave());
  let phase = "";
  c.onState((snap: EncounterSnapshot) => { phase = String((snap as { phase?: string }).phase ?? ""); });
  await waitFor(() => phase === "note", PHASE_TIMEOUT_MS, "note");
  await act(c);
  await waitFor(() => readdirSync(traceDir).includes("exam-session.review-index.json"), PHASE_TIMEOUT_MS * 2, "review index");
  const index = JSON.parse(readFileSync(join(traceDir, "exam-session.review-index.json"), "utf8")) as { stations: Array<Record<string, unknown>> };
  return index.stations[0] as Record<string, unknown>;
}
const draft = (c: SyncConnection, text: string) => c.sendIntent("note-draft" as IntentKind, { text } as never);
const submit = (c: SyncConnection, text: string) => c.sendIntent("note-submit" as IntentKind, { text });

describe("xr-sync-server C47 note source in the review index and lobby", () => {
  it("known-good: both fixtures are real runs whose trace holds the C45 source, and their persisted index entries carry none (the defect)", () => {
    expect(noteEvents(DRAFT.trace).map((e) => [e["source"], e["chars"]])).toEqual([["draft", 63]]);
    expect(noteEvents(EXPLICIT.trace).map((e) => [e["source"], e["chars"]])).toEqual([["explicit", 63]]);
    expect(DRAFT.provenance.mainSha).toBe("92fe4a2bc");
    expect(EXPLICIT.provenance.mainSha).toBe("92fe4a2bc");
    expect("noteSource" in (DRAFT.index.stations[0] as object)).toBe(false);
    expect("noteSource" in (EXPLICIT.index.stations[0] as object)).toBe(false);
  });

  it("the persisted index entry of a live station whose note was auto-collected carries noteSource draft", async () => {
    const entry = await liveIndexEntry(async (c) => { expect(await draft(c, NOTE)).toMatchObject({ status: "ack" }); });
    expect(entry).toMatchObject({ notePresent: true, noteChars: NOTE.length, noteSource: "draft" });
  }, 60000);

  it("the persisted index entry of a live station whose note was submitted carries noteSource explicit", async () => {
    const entry = await liveIndexEntry(async (c) => { expect(await submit(c, NOTE)).toMatchObject({ status: "ack" }); });
    expect(entry).toMatchObject({ notePresent: true, noteChars: NOTE.length, noteSource: "explicit" });
  }, 60000);

  it("(a) a live station with no note has noteSource null in the index, never ''", async () => {
    const entry = await liveIndexEntry(async () => undefined);
    expect(entry["notePresent"]).toBe(false);
    expect(entry["noteSource"]).toBe(null);
    expect(entry["noteSource"]).not.toBe("");
  }, 60000);

  it("(b) an explicit submit after a draft in one live station gives explicit and the explicit length (the last event decides, as noteChars does)", async () => {
    const entry = await liveIndexEntry(async (c) => {
      await draft(c, NOTE);
      await sleep(SPACING_MS);
      expect(await submit(c, NOTE_B)).toMatchObject({ status: "ack" });
    });
    expect(entry).toMatchObject({ notePresent: true, noteChars: NOTE_B.length, noteSource: "explicit" });
  }, 60000);

  it("the lobby rows over a draft station and an explicit station carry draft and explicit", async () => {
    const draftEntry = { ...(DRAFT.index.stations[0] as object), stationId: "slot-a-draft", stationIndex: 0, traceFile: "c47-slot-a-draft.conversation-trace.json", noteSource: "draft" };
    const explicitEntry = { ...(EXPLICIT.index.stations[0] as object), stationId: "slot-b-explicit", stationIndex: 1, traceFile: "c47-slot-b-explicit.conversation-trace.json", noteSource: "explicit" };
    const dir = writeDir([{ id: "slot-a-draft", trace: DRAFT.trace, entry: draftEntry as Record<string, unknown> }, { id: "slot-b-explicit", trace: EXPLICIT.trace, entry: explicitEntry as Record<string, unknown> }]);
    expect(await lobbyRows(dir, 2)).toEqual([
      { stationId: "slot-a-draft", notePresent: true, noteChars: 63, noteSource: "draft" },
      { stationId: "slot-b-explicit", notePresent: true, noteChars: 63, noteSource: "explicit" },
    ]);
  }, 30000);

  it("(c) the index entries exactly as the C45 runs persisted them (no noteSource field) load, with noteSource ''", async () => {
    const draftEntry = { ...(DRAFT.index.stations[0] as object), stationId: "slot-a-draft", stationIndex: 0, traceFile: "c47-slot-a-draft.conversation-trace.json" };
    const explicitEntry = { ...(EXPLICIT.index.stations[0] as object), stationId: "slot-b-explicit", stationIndex: 1, traceFile: "c47-slot-b-explicit.conversation-trace.json" };
    const dir = writeDir([{ id: "slot-a-draft", trace: DRAFT.trace, entry: draftEntry as Record<string, unknown> }, { id: "slot-b-explicit", trace: EXPLICIT.trace, entry: explicitEntry as Record<string, unknown> }]);
    expect(await lobbyRows(dir, 2)).toEqual([
      { stationId: "slot-a-draft", notePresent: true, noteChars: 63, noteSource: "" },
      { stationId: "slot-b-explicit", notePresent: true, noteChars: 63, noteSource: "" },
    ]);
  }, 30000);

  it.each([["submitted"], ["Draft"]])("(d) a source %j outside {explicit, draft} in the index refuses the lobby join with replay-bad-index", async (bad) => {
    const entry = { ...(DRAFT.index.stations[0] as object), traceFile: "c47-slot-a.conversation-trace.json", noteSource: bad } as Record<string, unknown>;
    await expect(lobbyRows(writeDir([{ id: "slot-a", trace: DRAFT.trace, entry }]), 1)).rejects.toThrow(/replay-bad-index: .*note source/u);
  }, 30000);

  it.each([[""], ["draft"], ["explicit"]])("(d2) noteSource %j on an entry with notePresent false is refused (A2: '' never accompanies no note)", async (source) => {
    const entry = { ...(DRAFT.index.stations[0] as object), traceFile: "c47-slot-a.conversation-trace.json", notePresent: false, noteChars: 0, noteFile: null, noteSource: source } as Record<string, unknown>;
    await expect(lobbyRows(writeDir([{ id: "slot-a", trace: DRAFT.trace, entry }]), 1)).rejects.toThrow(/replay-bad-index: .*note source/u);
  }, 30000);
});
