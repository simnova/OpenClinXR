import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startEncounterSyncFromUrl } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";
import { writeSyncedDoorwayEyebrow as writeEyebrowThrough } from "./synced-shell-writers.js";

// C55' RED B: while the shell is joined to a synced rotation the Encounter Flow panel follows the server phase. The client dep
// onPhase(phase, remainingS) fires on the first snapshot and whenever (phase, remainingS) changes, never for replay or review-lobby
// rooms. The shell's onPhase body writes, from those two arguments only: the .timer-row label (#station-clock-label) = the phase
// name capitalised (Doorway, Encounter, Note, Break, Closed), #exam-flow-timer = "<Label> MM:SS left", #exam-flow-advance =
// "server rotation". The local updateExamFlowEvidence writes of timer and advance are skipped once syncedServerPhase holds. main.ts cannot
// be imported (it boots the page): its wiring is pinned by source and its on-screen position by the evidence/c55 stills.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const MAIN = readFileSync(SRC + "main.ts", "utf8");
const MAIN_LINES_AT_BASE = 4724; // origin/main d962cc74 card tsk_bf84681b185c6766: +1 import of the synced shell writer module
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const ONPHASE = /onPhase: \(phase, remaining\) => \{\n([\s\S]*?)\n  \},\n/u;
const SYNC = "?encounterSync=ws://127.0.0.1:9";
const at = (phase: string, phaseRemainingS: number, stationIndex = 0, stationCount = 3): Record<string, unknown> => ({ phase, phaseRemainingS, stationIndex, stationCount });

interface Panel { label: string[]; timer: string[]; advance: string[]; phases: Array<[string, number]>; synced: boolean[]; eyebrowPhases: string[]; selectors: string[] }

/** Drive the real client with snapshots and run the shell's onPhase body, taken verbatim from main.ts, against stand-in elements. */
async function drive(search: string, snapshots: Array<Record<string, unknown>>): Promise<Panel> {
  const panel: Panel = { label: [], timer: [], advance: [], phases: [], synced: [], eyebrowPhases: [], selectors: [] };
  const sink = (into: string[]) => ({ set textContent(value: string) { into.push(value); } });
  const formatStationClock = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const eyebrowSink = { textContent: "Doorway" };
  const requireElement = (selector: string): { textContent: string | null } => { panel.selectors.push(selector); return eyebrowSink; };
  const writeSyncedDoorwayEyebrow = (el: { textContent: string | null }, phase: string | undefined): string => {
    panel.eyebrowPhases.push(phase ?? "");
    return writeEyebrowThrough(el, phase);
  };
  const body = ONPHASE.exec(MAIN)?.[1];
  const make = new Function("examFlowTimer", "examFlowAdvance", "stationClockLabel", "formatStationClock", "record", "updateExamFlowEvidence", "writeSyncedDoorwayEyebrow", "requireElement", `let syncedServerPhase = "";\nreturn (phase, remaining) => {\n(() => {${body ?? ""}\n})();\nrecord(syncedServerPhase !== "");\n};`);
  const run = make(sink(panel.timer), sink(panel.advance), sink(panel.label), formatStationClock, (value: boolean) => panel.synced.push(value), () => undefined, writeSyncedDoorwayEyebrow, requireElement) as (phase: string, remaining: number) => void;
  let listener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onStation: () => undefined,
    onPhase: (phase: string, remaining: number) => {
      panel.phases.push([phase, remaining]);
      if (body !== undefined) run(phase, remaining);
    },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (fn: (s: unknown) => void) => { listener = fn; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  for (const snapshot of snapshots) { listener?.({ serverTick: 1, turnId: 0, turnOwner: "none", actors: {}, learners: {}, ...snapshot }); await flush(); }
  return panel;
}

describe("the synced flow panel follows the server phase (C55')", () => {
  it("each server phase writes its exact label, timer and advance text", async () => {
    const panel = await drive(SYNC, [at("doorway", 12), at("encounter", 300), at("note", 90), at("break", 5), at("closed", 0)]);
    expect(panel.phases).toEqual([["doorway", 12], ["encounter", 300], ["note", 90], ["break", 5], ["closed", 0]]);
    expect(panel.label).toEqual(["Doorway", "Encounter", "Note", "Break", "Closed"]);
    expect(panel.timer).toEqual(["Doorway 00:12 left", "Encounter 05:00 left", "Note 01:30 left", "Break 00:05 left", "Closed 00:00 left"]);
    expect(panel.advance).toEqual(Array(5).fill("server rotation"));
    expect(panel.synced).toEqual(Array(5).fill(true));
  });

  it("the eyebrow recorder sees every server phase in order", async () => {
    const panel = await drive(SYNC, [at("doorway", 12), at("encounter", 300), at("note", 90), at("break", 5), at("closed", 0)]);
    expect(panel.eyebrowPhases).toEqual(panel.phases.map(([phase]) => phase));
    expect(panel.selectors).toEqual(Array(panel.phases.length).fill("#doorway-eyebrow"));
  });

  it("the timer counts down with the server second by second", async () => {
    const panel = await drive(SYNC, [at("encounter", 3), at("encounter", 2), at("encounter", 2), at("encounter", 1)]);
    expect(panel.timer).toEqual(["Encounter 00:03 left", "Encounter 00:02 left", "Encounter 00:01 left"]);
  });

  it("a server remaining of 7 shows 7 whatever the local elapsed clock reads (the body reads no local clock)", async () => {
    const panel = await drive(SYNC, [at("encounter", 7)]);
    expect(panel.timer).toEqual(["Encounter 00:07 left"]);
    expect(panel.timer[0]).not.toContain("01:39");
    const body = ONPHASE.exec(MAIN)?.[1] ?? "";
    expect(body).not.toMatch(/elapsed|state\.|encounterElapsedSeconds|noteElapsedSeconds|evidence\./u);
  });

  it("no Break label is written after the last station: the panel only echoes the phases the server reports", async () => {
    const panel = await drive(SYNC, [at("encounter", 5, 2), at("note", 4, 2), at("closed", 0, 2)]);
    expect(panel.label).toEqual(["Encounter", "Note", "Closed"]);
    expect(panel.label).not.toContain("Break");
  });

  it("a phase outside the station phases (a stationless room's brief) writes nothing", async () => {
    const panel = await drive(SYNC, [at("brief", 0), at("", 0), at("encounter", 9)]);
    expect(panel.phases).toEqual([["encounter", 9]]);
    expect(panel.label).toEqual(["Encounter"]);
  });

  it("replay and review-lobby rooms get no onPhase (replay keeps the C48 'Replay' clock and gains no phase text)", async () => {
    expect((await drive(`${SYNC}&encounterReplayStation=slot-a`, [at("encounter", 5)])).phases).toEqual([]);
    expect((await drive(`${SYNC}&encounterReviewLobby=1`, [at("encounter", 5)])).phases).toEqual([]);
    expect(MAIN).toContain('onReplay: () => { replayClock = true; clock.textContent = "Replay"; },');
  });

  it("the local timer and advance writes are skipped once the room is synced, and are the only other writers", () => {
    const writers = (name: string) => MAIN.split("\n").filter((line) => new RegExp(`\\b${name}\\.textContent =`, "u").test(line)).map((line) => line.trim());
    expect(writers("examFlowTimer")).toHaveLength(2);
    expect(writers("examFlowAdvance")).toHaveLength(2);
    expect(writers("stationClockLabel")).toHaveLength(1);
    expect(MAIN).toMatch(/if \(!syncedServerPhase\) \{\n\s*examFlowTimer\.textContent = evidence\.phase === "note"/u);
    expect(MAIN).toMatch(/examFlowAdvance\.textContent = evidence\.canAdvanceToNextEncounter[\s\S]*?\n\s*\}\n\s*endEncounterButton\.disabled/u);
    expect(ONPHASE.exec(MAIN)?.[1] ?? "").toContain("syncedServerPhase = phase;");
  });

  it("the non-synced shell keeps the base label, timer and advance text byte for byte", () => {
    expect(MAIN).toContain('<span id="station-clock-label">Encounter</span>');
    expect(MAIN).toContain('<strong id="station-clock">00:00</strong>');
    expect(MAIN).toContain("? `note ${formatStationClock(evidence.noteElapsedSeconds)} / ${formatStationClock(evidence.noteDurationSeconds)}`");
    expect(MAIN).toContain('? "exam sequence complete"');
    expect(MAIN).toContain(": `encounter ${formatStationClock(evidence.encounterElapsedSeconds)} / ${formatStationClock(evidence.encounterDurationSeconds)}`;");
    expect(MAIN).toContain("? `ready for ${nextScenarioId ?? \"completion\"}`");
    expect(MAIN).toContain(': [evidence.fallbackLabel, evidence.lastAdvanceReason ?? "complete encounter, then submit a non-empty patient note"].filter(Boolean).join(" — ");');
  });

  it("End encounter and Submit note follow the server phase while synced and keep the local rule otherwise (C57)", () => {
    const why = "C55' CW4 local gating -> C57 server-phase gating (tsk_7f187d0381ff7964): restoring the local-only gating is wrong, it leaves both buttons live during a synced Break";
    expect(MAIN, why).toContain('endEncounterButton.disabled = (syncedServerPhase || evidence.phase) !== "encounter";');
    expect(MAIN, why).toContain('submitNoteButton.disabled = (syncedServerPhase || evidence.phase) !== "note";');
    expect(MAIN, why).not.toContain('endEncounterButton.disabled = evidence.phase !== "encounter";');
    expect(MAIN, why).not.toContain('submitNoteButton.disabled = evidence.phase !== "note";');
  });

  it("main.ts stays line-neutral", () => {
    expect(MAIN.split("\n").length - (MAIN.endsWith("\n") ? 1 : 0)).toBeLessThanOrEqual(MAIN_LINES_AT_BASE);
  });
});
