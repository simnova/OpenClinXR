import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isEncounterSyncSearch, startEncounterSyncFromUrl, writeSyncedDoorwayEyebrow as writeEyebrowThrough } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";

// tsk_5cd3e3c63ac9239a round 2: the round-1 literal "Doorway" default regressed
// unsynced local mode (its single writer is the synced onPhase). ONE predicate
// decides "this page joins a synced room" at both sites: the line-1546 default
// and the :4636 join test. Harness copied from
// the-synced-flow-panel-follows-the-server-phase.test.ts. R1/R3' evaluate the
// line-1546 expression from MAIN with the REAL imported predicate passed in
// (new Function param named isEncounterSyncSearch), never a retyped condition.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const MAIN = readFileSync(`${SRC}main.ts`, "utf8");
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const ONPHASE = /onPhase: \(phase, remaining\) => \{\n([\s\S]*?)\n  \},\n/u;
const SYNC = "?encounterSync=ws://127.0.0.1:9";
const LOCAL = "";
const at = (phase: string, phaseRemainingS: number, stationIndex = 0, stationCount = 3): Record<string, unknown> => ({ phase, phaseRemainingS, stationIndex, stationCount });

type SyncPredicate = (search: string) => boolean;

interface Panel { label: string[]; timer: string[]; advance: string[]; phases: Array<[string, number]>; synced: boolean[]; eyebrowPhases: string[]; eyebrowLabels: string[]; selectors: string[] }

/** Drive the real client with snapshots and run the shell's onPhase body, taken verbatim from main.ts, against stand-in elements. */
async function drive(search: string, snapshots: Array<Record<string, unknown>>): Promise<Panel> {
  const panel: Panel = { label: [], timer: [], advance: [], phases: [], synced: [], eyebrowPhases: [], eyebrowLabels: [], selectors: [] };
  const sink = (into: string[]) => ({ set textContent(value: string) { into.push(value); } });
  const formatStationClock = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const eyebrowSink = { textContent: "Doorway" };
  const requireElement = (selector: string): { textContent: string | null } => { panel.selectors.push(selector); return eyebrowSink; };
  const writeSyncedDoorwayEyebrow = (el: { textContent: string | null }, phase: string | undefined): string => {
    panel.eyebrowPhases.push(phase ?? "");
    const name = writeEyebrowThrough(el, phase);
    panel.eyebrowLabels.push(el.textContent ?? "");
    return name;
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

/** Evaluate the line-1546 clock-label expression from MAIN for a search string (literal markup returns as-is). */
function renderPreSyncClockLabel(search: string, isSyncSearch: SyncPredicate): string {
  const inner = /id="station-clock-label">([^<]*)</u.exec(MAIN)?.[1] ?? "";
  const expression = /^\$\{([\s\S]*)\}$/u.exec(inner.trim())?.[1];
  if (expression === undefined) return inner;
  const render = new Function("isEncounterSyncSearch", "window", `return (${expression});`) as (isEncounterSyncSearch: SyncPredicate, window: { location: { search: string } }) => string;
  return render(isSyncSearch, { location: { search } });
}

/** The pre-sync doorway eyebrow main.ts renders, before any snapshot. */
function preSyncEyebrow(): string {
  return /id="doorway-eyebrow">([^<]*)</u.exec(MAIN)?.[1] ?? "";
}

describe("the pre-sync header names one phase (c1hdr)", () => {
  it("R1: for a synced search the pre-sync clock label equals the eyebrow Doorway", async () => {
    const panel = await drive(SYNC, []);
    expect(panel.phases).toEqual([]);
    const label = renderPreSyncClockLabel(SYNC, isEncounterSyncSearch);
    const eyebrow = preSyncEyebrow();
    expect(eyebrow.trim().length).toBeGreaterThan(0);
    expect(label.trim().length).toBeGreaterThan(0);
    expect(label).toBe(eyebrow);
  });

  it("R2 counterweight: after a synced Encounter snapshot both read Encounter", async () => {
    const panel = await drive(SYNC, [at("encounter", 300)]);
    expect(panel.phases).toEqual([["encounter", 300]]);
    expect(panel.label).toEqual(["Encounter"]);
    expect(panel.eyebrowLabels).toEqual(["Encounter"]);
  });

  it("R3': the unsynced label is Encounter and the synced label is Doorway", async () => {
    expect(renderPreSyncClockLabel(LOCAL, isEncounterSyncSearch)).toBe("Encounter");
    expect(renderPreSyncClockLabel(SYNC, isEncounterSyncSearch)).toBe("Doorway");
  });

  it("R7: one predicate decides the join, no literal test remains", () => {
    const code = MAIN.split("\n").filter((line) => !line.trimStart().startsWith("//"));
    expect(code.filter((line) => line.includes("encounterSync="))).toEqual([]);
    expect(MAIN.split("isEncounterSyncSearch(").length - 1).toBeGreaterThanOrEqual(2);
  });
});
