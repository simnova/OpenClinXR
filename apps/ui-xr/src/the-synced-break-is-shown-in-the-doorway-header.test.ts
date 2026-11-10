import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startEncounterSyncFromUrl } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";

// C53 RED B: while the synced room is in phase "break" the doorway header #doorway-station reads "Break" and the doorway clock
// #station-clock reads "Break mm:ss" from the server's phaseRemainingS (client dep onBreak). When the break ends (the next station's
// room reports another phase) the shell's own clock resumes. Rooms without a break never call onBreak; replay and review-lobby rooms
// get none. main.ts cannot be imported (it boots the page): its wiring is pinned by source and its on-screen position by the
// evidence/c53 stills.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const MAIN = readFileSync(SRC + "main.ts", "utf8");
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const ONBREAK = /onBreak: \(remaining\) => \{\n([\s\S]*?)\n  \},\n/u;

interface Calls { breaks: Array<number | null>; clock: string[]; doorway: string[]; breakClock: boolean[] }

/** Drive the real client with snapshots and run the shell's onBreak body, taken verbatim from main.ts, against stand-in elements. */
async function drive(search: string, snapshots: Array<Record<string, unknown>>): Promise<Calls> {
  const calls: Calls = { breaks: [], clock: [], doorway: [], breakClock: [] };
  const clock = { set textContent(value: string) { calls.clock.push(value); } };
  const doorwayStation = { set textContent(value: string) { calls.doorway.push(value); } };
  const formatStationClock = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const body = ONBREAK.exec(MAIN)?.[1];
  const make = new Function("clock", "doorwayStation", "formatStationClock", "record", `let breakClock = false;\nreturn (remaining) => {\n(() => {${body ?? ""}\n})();\nrecord(breakClock);\n};`);
  const run = make(clock, doorwayStation, formatStationClock, (value: boolean) => calls.breakClock.push(value)) as (remaining: number | null) => void;
  let listener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onStation: () => undefined,
    onBreak: (remaining: number | null) => {
      calls.breaks.push(remaining);
      if (body !== undefined) run(remaining);
    },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (fn: (s: unknown) => void) => { listener = fn; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  for (const snapshot of snapshots) { listener?.({ serverTick: 1, turnId: 0, turnOwner: "none", actors: {}, learners: {}, stationCount: 3, ...snapshot }); await flush(); }
  return calls;
}

const SYNC = "?encounterSync=ws://127.0.0.1:9";
const at = (phase: string, phaseRemainingS: number, stationIndex = 0): Record<string, unknown> => ({ phase, phaseRemainingS, stationIndex });

describe("the synced break is shown in the doorway header (C53)", () => {
  it("a break phase writes the exact header and countdown, second by second", async () => {
    const calls = await drive(SYNC, [at("closed", 0), at("break", 5), at("break", 4), at("break", 3)]);
    expect(calls.breaks).toEqual([5, 4, 3]);
    expect(calls.doorway).toEqual(["Break", "Break", "Break"]);
    expect(calls.clock).toEqual(["Break 00:05", "Break 00:04", "Break 00:03"]);
    expect(calls.breakClock).toEqual([true, true, true]);
  });

  it("the break ends with one null when the next room reports another phase, and the shell's own clock resumes", async () => {
    const calls = await drive(SYNC, [at("break", 2), at("break", 1), at("doorway", 12, 1), at("doorway", 11, 1)]);
    expect(calls.breaks).toEqual([2, 1, null]);
    expect(calls.breakClock).toEqual([true, true, false]);
    expect(calls.clock).toEqual(["Break 00:02", "Break 00:01"]);
    expect(calls.doorway).toEqual(["Break", "Break"]);
  });

  it("a room that never breaks never calls onBreak", async () => {
    const calls = await drive(SYNC, [at("doorway", 12), at("encounter", 300), at("note", 60), at("closed", 0), at("doorway", 12, 1)]);
    expect(calls.breaks).toEqual([]);
    expect(calls.clock).toEqual([]);
    expect(calls.doorway).toEqual([]);
  });

  it("replay and review-lobby rooms get no onBreak", async () => {
    expect((await drive(`${SYNC}&encounterReplayStation=slot-a`, [at("break", 5)])).breaks).toEqual([]);
    expect((await drive(`${SYNC}&encounterReviewLobby=1`, [at("break", 5)])).breaks).toEqual([]);
  });

  it("main.ts hands the client an onBreak dep, and the tick leaves the clock to it during a break", () => {
    expect(ONBREAK.test(MAIN)).toBe(true);
    expect(MAIN).toContain("if (!replayClock && !breakClock) clock.textContent = formatStationClock(state.elapsedSecond);");
  });

  it("the word Break is written to #doorway-station in exactly one place, inside onBreak", () => {
    const writers = MAIN.split("\n").filter((line) => /doorwayStation\.textContent = "Break"/u.test(line));
    expect(writers.map((line) => line.trim())).toEqual(['doorwayStation.textContent = "Break";']);
    expect(ONBREAK.exec(MAIN)?.[1] ?? "").toContain('doorwayStation.textContent = "Break";');
  });

  it("the static doorway header, the clock element and the replay clock are unchanged", () => {
    expect(MAIN).toContain('<p class="label">Doorway</p>');
    expect(MAIN).toContain('<p class="label" id="doorway-station"></p>');
    expect(MAIN).toContain('<strong id="station-clock">00:00</strong>');
    expect(MAIN).toContain('onReplay: () => { replayClock = true; clock.textContent = "Replay"; },');
  });
});
