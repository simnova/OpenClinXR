import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startEncounterSyncFromUrl } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";

// C50 RED B: in a synced rotation #exam-flow-station reads "Station N of M" from the server's position (onStation), and the
// local exam-flow writer no longer overwrites it. Without encounterSync (and in replay or lobby rooms, which get no onStation)
// the local writer's "N/M: scenarioId" is unchanged. main.ts cannot be imported (it boots the page), so its wiring is pinned by
// source and its live DOM by the evidence/c50 stills.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const MAIN = readFileSync(SRC + "main.ts", "utf8");
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

async function labelAfter(search: string, positions: Array<[number, number]>): Promise<string> {
  // The shell's onStation body, taken verbatim from main.ts, run against a stand-in element.
  const label = { textContent: "pending" };
  const match = /onStation: \(index, count\) => \{ (.*?) \},?\s*$/mu.exec(MAIN);
  const body = new Function("examFlowStation", "index", "count", "let syncedStation = false;" + (match?.[1] ?? ""));
  let listener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onStation: (index: number, count: number) => { body(label, index, count); },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (fn: (s: unknown) => void) => { listener = fn; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  for (const [stationIndex, stationCount] of positions) { listener?.({ serverTick: 1, phase: "encounter", turnId: 0, turnOwner: "none", actors: {}, learners: {}, stationIndex, stationCount }); await flush(); }
  return label.textContent;
}

describe("the station label follows the synced rotation (C50)", () => {
  it("main.ts hands the client an onStation dep that writes Station N of M with N = index + 1", () => {
    expect(MAIN).toMatch(/onStation: \(index, count\) => \{ [^}]*Station \$\{index \+ 1\} of \$\{count\}/u);
  });

  it("station 1 then station 2 of 3 read exactly 'Station 1 of 3' then 'Station 2 of 3'", async () => {
    expect(await labelAfter("?encounterSync=ws://127.0.0.1:9", [[0, 3]])).toBe("Station 1 of 3");
    expect(await labelAfter("?encounterSync=ws://127.0.0.1:9", [[0, 3], [1, 3]])).toBe("Station 2 of 3");
  });

  it("the local exam-flow writer is conditional on not being synced, and is the only other writer", () => {
    const writers = MAIN.split("\n").filter((line) => /\bexamFlowStation\.textContent =/u.test(line));
    expect(writers.map((line) => line.trim())).toEqual([
      "examFlowStation.textContent = `${evidence.scenarioIndex + 1}/${evidence.totalScenarios}: ${evidence.scenarioId}`;",
      expect.stringContaining("Station ${index + 1} of ${count}"),
    ]);
    expect(MAIN).toMatch(/if \(!syncedStation\) \{\n\s*examFlowStation\.textContent = `\$\{evidence\.scenarioIndex \+ 1\}\/\$\{evidence\.totalScenarios\}: \$\{evidence\.scenarioId\}`;\n\s*\}/u);
  });

  it("the non-synced shell keeps the local 'N/M: scenarioId' (replay and lobby rooms get no onStation)", async () => {
    expect(await labelAfter("?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a", [[0, 3]])).toBe("pending");
    expect(await labelAfter("?encounterSync=ws://127.0.0.1:9&encounterReviewLobby=1", [[0, 3]])).toBe("pending");
    expect(MAIN).toContain("`${evidence.scenarioIndex + 1}/${evidence.totalScenarios}: ${evidence.scenarioId}`");
  });

  it("apps/ui-xr parses no rotation state from the URL itself", () => {
    const sources = readdirSync(SRC).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    const parsing = (name: string) => readFileSync(SRC + name, "utf8").split("\n").filter((line) => /(stationIndex|stationCount)/u.test(line) && /(searchParams|URLSearchParams|location\.search)/u.test(line));
    expect(sources.flatMap(parsing)).toEqual([]);
  });
});
