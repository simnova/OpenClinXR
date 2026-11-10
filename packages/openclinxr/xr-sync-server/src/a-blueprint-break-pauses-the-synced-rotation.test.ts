import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type EncounterSnapshot, type IntentKind, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C53 RED A: the exam blueprint's break pauses a synced rotation, on the room clock.
// Contract (the names are the spec):
//   examBlueprint.timing.breakSeconds (optional integer >= 0) is the break length; absent = 0 = no break.
//   examBlueprint.timing.breakAfterStationOrders says where. After the station whose slot order is listed reaches "closed", and
//   breakSeconds > 0, the room enters phase "break" for breakSeconds (phaseRemainingS counts breakSeconds..1), then rotates.
//   Never a break after the last station. The break length is read from the blueprint only (client roomOptions and a server
//   option of that name are ignored). A break order that is not a slot refuses boot naming "examBlueprint".
//   Conversation intents during "break" reject outside-encounter-phase (pose is exempt); note intents reject outside-note-phase.
//   The trace records a phase-changed event for "break". Replay and review-lobby rooms never enter "break".
//   breakAfterStationOrders non-empty with breakSeconds absent or 0: exactly one boot trace line naming both fields.
// Fixture ids and the 1 s phase seconds are illustrative test values.

const PHASES = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 };
const SESSION_MS = 40000;
const INDEX_FILE = "exam-session.review-index.json";
const NOTE_TEXT = "Chest pressure 2h, ECG ordered.";

function blueprint(timing: Record<string, unknown>): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c53",
    title: "Fixture two-station form",
    stationSlots: [
      { slotId: "slot-a", order: 1, label: "Fixture A", requiredEnvironmentIds: [], requiredTraceTags: [] },
      { slotId: "slot-b", order: 2, label: "Fixture B", requiredEnvironmentIds: [], requiredTraceTags: [] },
    ],
    timing: { ...PHASES, breakAfterStationOrders: [1], ...timing },
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

const boot = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
const traceDirs = new Map<EncounterServer, string>();
async function start(options: Record<string, unknown>): Promise<EncounterServer> {
  const traceDir = typeof options["traceDir"] === "string" ? options["traceDir"] : mkdtempSync(join(tmpdir(), "xr-sync-c53-"));
  const server = await boot({ ...options, traceDir: options["replayDir"] === undefined ? traceDir : undefined });
  traceDirs.set(server, traceDir);
  servers.push(server);
  return server;
}
/** Every station's phase-changed phases, read from the review index the finished session writes (the `closed` phase lasts under a poll tick). */
async function sessionPhases(server: EncounterServer): Promise<string[][]> {
  const dir = traceDirs.get(server) as string;
  await waitFor(() => readdirSync(dir).includes(INDEX_FILE), SESSION_MS, "review index");
  const index = JSON.parse(readFileSync(join(dir, INDEX_FILE), "utf8")) as { stations: Array<{ phases: string[] }> };
  return index.stations.map((entry) => entry.phases);
}
const bootLines = (server: EncounterServer): string[] => (server as unknown as { getBootTrace?(): string[] }).getBootTrace?.() ?? [];
async function joinLearner(server: EncounterServer, roomOptions: Record<string, unknown> = { actors: ["a1"] }): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions });
  leavers.push(() => connection.leave());
  return connection;
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

type Live = { stationIndex: number; phase: string; phaseRemainingS: number; noteStatus?: string; noteChars?: number; noteSource?: string };
interface TraceShape { events: Array<{ kind: string; phase?: string; source?: string }> }
const live = (server: EncounterServer): Live => JSON.parse(server.getStateJSON()) as Live;
const traceOf = (server: EncounterServer): TraceShape => server.getConversationTrace() as unknown as TraceShape;

interface StationOne {
  /** phaseRemainingS values seen per phase, consecutive duplicates dropped. */
  remaining: Record<string, number[]>;
  /** note-submitted trace sources of station 1. */
  noteSources: string[];
  /** the first state read from station 2. */
  next: Live | null;
}

/** Poll the latest live room every 10 ms until the rotation reaches station 2; `during` runs every tick while station 1 is live. */
async function runStationOne(server: EncounterServer, during?: (s: Live) => Promise<void>): Promise<StationOne> {
  const out: StationOne = { remaining: {}, noteSources: [], next: null };
  const deadline = Date.now() + SESSION_MS;
  for (;;) {
    const s = live(server);
    if (s.stationIndex !== 0) {
      out.next = s;
      return out;
    }
    const events = traceOf(server).events;
    out.noteSources = events.filter((e) => e.kind === "note-submitted").map((e) => e.source ?? "");
    const list = (out.remaining[s.phase] ??= []);
    if (list[list.length - 1] !== s.phaseRemainingS) list.push(s.phaseRemainingS);
    await during?.(s);
    if (Date.now() > deadline) throw new Error("timed out waiting for the rotation to station 2");
    await sleep(10);
  }
}

describe("a blueprint break pauses the synced rotation (C53)", () => {
  it("breakSeconds 3 after station 1: doorway, encounter, note, closed, break (3,2,1), then station 2 doorway", async () => {
    const server = await start({ examBlueprint: blueprint({ breakSeconds: 3 }) });
    await joinLearner(server);
    const one = await runStationOne(server);
    expect((await sessionPhases(server))[0]).toEqual(["doorway", "encounter", "note", "closed", "break"]);
    expect(one.remaining["break"]).toEqual([3, 2, 1]);
    expect(one.next).toMatchObject({ stationIndex: 1, phase: "doorway" });
  }, SESSION_MS);

  it("counterweight 1: breakSeconds 0 with break order [1] is the base rotation, no break phase", async () => {
    const server = await start({ examBlueprint: blueprint({ breakSeconds: 0 }) });
    await joinLearner(server);
    const one = await runStationOne(server);
    expect((await sessionPhases(server))[0]).toEqual(["doorway", "encounter", "note", "closed"]);
    expect(one.remaining["break"]).toBeUndefined();
  }, SESSION_MS);

  it("counterweight 2: breakSeconds 3 with no break orders has no break", async () => {
    const server = await start({ examBlueprint: blueprint({ breakSeconds: 3, breakAfterStationOrders: [] }) });
    await joinLearner(server);
    await runStationOne(server);
    expect((await sessionPhases(server))[0]).toEqual(["doorway", "encounter", "note", "closed"]);
  }, SESSION_MS);

  it("counterweight 3: a break order equal to the last station gives no break after it, and the session still ends as base", async () => {
    const server = await start({ examBlueprint: blueprint({ breakSeconds: 2, breakAfterStationOrders: [2] }) });
    await joinLearner(server);
    await runStationOne(server);
    const closed = ["doorway", "encounter", "note", "closed"];
    expect(await sessionPhases(server)).toEqual([closed, closed]);
  }, SESSION_MS);

  it("boot refuses a break order that is not a station slot, and a malformed breakSeconds, naming examBlueprint", async () => {
    await expect(boot({ examBlueprint: blueprint({ breakSeconds: 3, breakAfterStationOrders: [5] }) })).rejects.toThrow(/examBlueprint/);
    await expect(boot({ examBlueprint: blueprint({ breakSeconds: -1 }) })).rejects.toThrow(/examBlueprint/);
    await expect(boot({ examBlueprint: blueprint({ breakSeconds: 1.5 }) })).rejects.toThrow(/examBlueprint/);
  });

  it("counterweight 4: during the break a conversation intent rejects outside-encounter-phase and a pose intent does not", async () => {
    const server = await start({ examBlueprint: blueprint({ breakSeconds: 3 }) });
    const c = await joinLearner(server);
    const seen: Array<{ select: unknown; pose: unknown }> = [];
    await runStationOne(server, async (s) => {
      if (s.phase === "break" && seen.length === 0) {
        seen.push({
          select: await c.sendIntent("select-actor", { actorId: "a1" }),
          pose: await c.sendIntent("pose", { x: 0, y: 1.6, z: 0 }),
        });
      }
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.select).toMatchObject({ status: "reject", reason: "outside-encounter-phase" });
    expect(seen[0]?.pose).toMatchObject({ status: "ack" });
  }, SESSION_MS);

  it("counterweight 6: an explicit note stays submitted through the break and no note intent reopens it", async () => {
    const server = await start({ examBlueprint: blueprint({ breakSeconds: 3 }) });
    const c = await joinLearner(server);
    let submitted = false;
    const duringBreak: Array<{ status: Live["noteStatus"]; chars: Live["noteChars"]; submit: unknown; draft: unknown }> = [];
    const one = await runStationOne(server, async (s) => {
      if (s.phase === "note" && !submitted) {
        submitted = true;
        expect(await c.sendIntent("note-submit" as IntentKind, { text: NOTE_TEXT })).toMatchObject({ status: "ack" });
      }
      if (s.phase === "break" && duringBreak.length === 0) {
        duringBreak.push({
          status: s.noteStatus,
          chars: s.noteChars,
          submit: await c.sendIntent("note-submit" as IntentKind, { text: "A different note." }),
          draft: await c.sendIntent("note-draft" as IntentKind, { text: "A draft." }),
        });
      }
    });
    expect(duringBreak).toEqual([
      {
        status: "submitted",
        chars: NOTE_TEXT.length,
        submit: expect.objectContaining({ status: "reject", reason: "outside-note-phase" }),
        draft: expect.objectContaining({ status: "reject", reason: "outside-note-phase" }),
      },
    ]);
    expect(one.noteSources).toEqual(["explicit"]);
  }, SESSION_MS);

  it("counterweight 6: a note draft is auto-collected when the note window ends, before the break starts counting", async () => {
    const server = await start({ examBlueprint: blueprint({ breakSeconds: 3 }) });
    const c = await joinLearner(server);
    let drafted = false;
    let atBreakStart: Live | null = null;
    const one = await runStationOne(server, async (s) => {
      if (s.phase === "note" && !drafted) {
        drafted = true;
        expect(await c.sendIntent("note-draft" as IntentKind, { text: NOTE_TEXT })).toMatchObject({ status: "ack" });
      }
      if (s.phase === "break" && atBreakStart === null) atBreakStart = s;
    });
    expect(atBreakStart).toMatchObject({ noteStatus: "submitted", noteChars: NOTE_TEXT.length, noteSource: "draft" });
    expect(one.noteSources).toEqual(["draft"]);
  }, SESSION_MS);

  it("counterweight 9: a client roomOptions break length and a server option of that name are never read", async () => {
    const server = await start({ examBlueprint: blueprint({ breakAfterStationOrders: [1] }), breakSeconds: 4 });
    await joinLearner(server, { actors: ["a1"], breakSeconds: 4, timing: { breakSeconds: 4 } });
    await runStationOne(server);
    expect((await sessionPhases(server))[0]).toEqual(["doorway", "encounter", "note", "closed"]);
  }, SESSION_MS);

  it("counterweight 5: a replay of a station that had a break, and the review lobby, never enter break", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c53-replay-"));
    const live1 = await start({ examBlueprint: blueprint({ breakSeconds: 2 }), traceDir });
    await joinLearner(live1);
    await runStationOne(live1);
    expect((await sessionPhases(live1))[0]).toContain("break");
    const replayServer = await start({ replayDir: traceDir, replayStepMs: 20 });
    const reviewer = await joinLearner(replayServer, { replayStationId: "slot-a" });
    const phases: string[] = [];
    let done = false;
    reviewer.onState((snapshot) => {
      const s = snapshot as EncounterSnapshot & { replayDone?: boolean };
      if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
      if (s.replayDone === true) done = true;
    });
    await waitFor(() => done, SESSION_MS, "replayDone");
    expect(phases.filter((p) => p !== "")).toEqual(["doorway", "encounter", "note", "closed"]);
    const lobby = await joinLearner(replayServer, { reviewLobby: true });
    const lobbyPhases = new Set<string>();
    lobby.onState((snapshot) => { lobbyPhases.add(snapshot.phase); });
    await sleep(300);
    expect([...lobbyPhases]).not.toContain("break");
  }, SESSION_MS);

  it("counterweight 11: break orders with breakSeconds absent or 0 record exactly one boot trace line naming both fields", async () => {
    const absent = await start({ examBlueprint: blueprint({}) });
    const zero = await start({ examBlueprint: blueprint({ breakSeconds: 0 }) });
    const set = await start({ examBlueprint: blueprint({ breakSeconds: 3 }) });
    const none = await start({ examBlueprint: blueprint({ breakAfterStationOrders: [] }) });
    for (const server of [absent, zero]) {
      const lines = bootLines(server);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("breakAfterStationOrders");
      expect(lines[0]).toContain("breakSeconds");
    }
    expect(bootLines(set)).toEqual([]);
    expect(bootLines(none)).toEqual([]);
  });
});
