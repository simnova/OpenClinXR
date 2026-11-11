import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startEncounterSyncFromUrl } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";

// C51 RED A: while synced, the doorway header carries the server's "Station N of M" in its own element #doorway-station, written
// from the same onStation signal as #exam-flow-station (C50). Strings only: this test cannot show the label is on screen. Its
// position at 800x600 comes from the evidence/c51 capture report (rect inside 0..800 x 0..600 at scroll 0).
const SRC = fileURLToPath(new URL(".", import.meta.url));
const MAIN = readFileSync(SRC + "main.ts", "utf8");
const CSS = readFileSync(SRC + "styles.css", "utf8");
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

async function labelsAfter(search: string, positions: Array<[number, number]>): Promise<{ flow: string; doorway: string }> {
  // The shell's onStation body, taken verbatim from main.ts, run against stand-in elements.
  const flow = { textContent: "pending" };
  const doorway = { textContent: "" };
  const match = /onStation: \(index, count\) => \{\n([\s\S]*?)\n  \},\n/u.exec(MAIN);
  const body = new Function("examFlowStation", "doorwayStation", "index", "count", "let syncedStation = false;" + (match?.[1] ?? ""));
  let listener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onStation: (index: number, count: number) => { body(flow, doorway, index, count); },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (fn: (s: unknown) => void) => { listener = fn; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  for (const [stationIndex, stationCount] of positions) { listener?.({ serverTick: 1, phase: "encounter", turnId: 0, turnOwner: "none", actors: {}, learners: {}, stationIndex, stationCount }); await flush(); }
  return { flow: flow.textContent, doorway: doorway.textContent };
}

describe("the synced station position is in the doorway header (C51)", () => {
  it("the doorway header keeps its eyebrow, title and subtitle lines unchanged", () => {
    expect(MAIN).toContain('<p class="label" id="doorway-eyebrow">Doorway</p>');
    expect(MAIN).toContain("<h1>${selectedStationContext.title}</h1>");
    expect(MAIN).toContain('<p class="subtle">${selectedStationContext.subtitle}</p>');
  });

  it("the header holds an empty #doorway-station between the Doorway eyebrow and the title", () => {
    expect(MAIN).toMatch(/<p class="label" id="doorway-eyebrow">Doorway<\/p>\n\s*<p class="label" id="doorway-station"><\/p>\n\s*<h1>\$\{selectedStationContext\.title\}<\/h1>/u);
    expect(MAIN).toContain('requireElement<HTMLElement>("#doorway-station")');
  });

  it("an empty #doorway-station is hidden, so a room that never gets onStation shows nothing", () => {
    expect(CSS).toMatch(/#doorway-station:empty\s*\{\s*display:\s*none;?\s*\}/u);
  });

  it("onStation writes the exact position into #doorway-station and #exam-flow-station", async () => {
    expect(await labelsAfter("?encounterSync=ws://127.0.0.1:9", [[0, 3]])).toEqual({ flow: "Station 1 of 3", doorway: "Station 1 of 3" });
    expect(await labelsAfter("?encounterSync=ws://127.0.0.1:9", [[0, 3], [1, 3]])).toEqual({ flow: "Station 2 of 3", doorway: "Station 2 of 3" });
    expect(await labelsAfter("?encounterSync=ws://127.0.0.1:9", [[0, 3], [1, 3], [2, 3]])).toEqual({ flow: "Station 3 of 3", doorway: "Station 3 of 3" });
  });

  it("#doorway-station has exactly two writers: the station position in onStation (C51) and Break in onBreak (C53)", () => {
    const writers = MAIN.split("\n").filter((line) => /\bdoorwayStation\.textContent\b/u.test(line));
    expect(writers.map((line) => line.trim())).toEqual(["doorwayStation.textContent = `Station ${index + 1} of ${count}`;", 'doorwayStation.textContent = "Break";']);
    const onStation = /onStation: \(index, count\) => \{\n([\s\S]*?)\n  \},\n/u.exec(MAIN)?.[1] ?? "";
    expect(onStation.split("\n").map((line) => line.trim())).toEqual([
      "syncedStation = true;",
      "examFlowStation.textContent = `Station ${index + 1} of ${count}`;",
      "doorwayStation.textContent = `Station ${index + 1} of ${count}`;",
    ]);
  });

  it("replay and review-lobby rooms get no onStation, so #doorway-station stays empty", async () => {
    expect((await labelsAfter("?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a", [[0, 3]])).doorway).toBe("");
    expect((await labelsAfter("?encounterSync=ws://127.0.0.1:9&encounterReviewLobby=1", [[0, 3]])).doorway).toBe("");
  });

  it("the replay doorway clock still reads Replay (C48) and the local exam-flow label is unchanged", () => {
    expect(MAIN).toContain('onReplay: () => { replayClock = true; clock.textContent = "Replay"; }');
    expect(MAIN).toContain("`${evidence.scenarioIndex + 1}/${evidence.totalScenarios}: ${evidence.scenarioId}`");
  });
});
