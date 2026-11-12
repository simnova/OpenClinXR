import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatSyncedTopicsLabel, startEncounterSyncFromUrl } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";

// B': in a synced room #trace-summary reads "Topics N/M" from the current station
// snapshot's topicMenu (M = entries, N = entries with asked=true). Unsynced/local pages
// keep "Trace N/M" from local requiredTraceTags. A station change re-reads the new
// snapshot's menu. main.ts cannot be imported (it boots the page): wiring is pinned
// by source, the label math by the real module, the live path by the real sync client.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const MAIN = readFileSync(`${SRC}main.ts`, "utf8");
const MAIN_LINES_AT_BASE = 4719;
const SYNC = "?encounterSync=ws://127.0.0.1:9";
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

type Menu = Parameters<typeof formatSyncedTopicsLabel>[1];
const entry = (tag: string, asked: boolean): Menu extends Array<infer E> ? E : never =>
  ({ tag, label: tag, labelSource: "server", note: "", asked }) as never;
const menu9 = (askedCount: number): Menu =>
  Array.from({ length: 9 }, (_, i) => entry(`topic_${i}`, i < askedCount)) as Menu;
const menu4 = (): Menu =>
  Array.from({ length: 4 }, (_, i) => entry(`station_b_${i}`, false)) as Menu;

async function drive(search: string, snapshots: Array<Record<string, unknown>>): Promise<{ stations: Array<[number, number]>; handle: unknown }> {
  const stations: Array<[number, number]> = [];
  let listener: ((s: unknown) => void) | undefined;
  const handle = await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onStation: (index: number, count: number) => { stations.push([index, count]); },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (fn: (s: unknown) => void) => { listener = fn; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  for (const snapshot of snapshots) { listener?.({ serverTick: 1, phase: "encounter", turnId: 0, turnOwner: "none", actors: {}, learners: {}, ...snapshot }); await flush(); }
  return { stations, handle };
}

describe("the trace counter counts synced turns (B')", () => {
  it("known-good: 9 entries, 2 asked -> Topics 2/9; next snapshot 3 asked -> Topics 3/9", () => {
    const el = { textContent: "Trace 0/10" };
    expect(formatSyncedTopicsLabel(el, menu9(2))).toBe("Topics 2/9");
    expect(el.textContent).toBe("Topics 2/9");
    expect(formatSyncedTopicsLabel(el, menu9(3))).toBe("Topics 3/9");
    expect(el.textContent).toBe("Topics 3/9");
  });

  it("station change re-reads the new snapshot menu: 4-entry, 0 asked -> Topics 0/4, no carry-over", async () => {
    const { stations } = await drive(SYNC, [
      { stationIndex: 0, stationCount: 2, topicMenu: menu9(3) },
      { stationIndex: 1, stationCount: 2, topicMenu: menu4() },
    ]);
    expect(stations).toEqual([[0, 2], [1, 2]]);
    const el = { textContent: "Topics 3/9" };
    expect(formatSyncedTopicsLabel(el, menu4())).toBe("Topics 0/4");
    expect(el.textContent).toBe("Topics 0/4");
    expect(el.textContent).not.toBe("Topics 3/9");
  });

  it("negative: a snapshot with no topicMenu (old server) leaves the local Trace label unchanged", () => {
    const el = { textContent: "Trace 4/10" };
    expect(formatSyncedTopicsLabel(el, undefined)).toBe("");
    expect(el.textContent).toBe("Trace 4/10");
  });

  it("counterweight: an unsynced page keeps Trace N/M and gets zero Topics writes", async () => {
    const { stations, handle } = await drive("", [{ stationIndex: 0, stationCount: 2, topicMenu: menu9(2) }]);
    expect(handle).toBeNull();
    expect(stations).toEqual([]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts the literal template text in main.ts source
    expect(MAIN).toContain("Trace 0/${state.requiredTraceTags.length}");
    expect(MAIN).not.toContain("\"Topics ");
    expect(MAIN).not.toContain("'Topics ");
    expect(MAIN).not.toContain("`Topics ");
  });

  it("wiring: the lazy headset destructure names formatSyncedTopicsLabel; onTopicMenu writes the trace summary; no connect", () => {
    expect(MAIN).toMatch(/then\(\(\{ startEncounterSyncFromUrl, writeSyncedDoorwayEyebrow, formatSyncedTopicsLabel \}\)/u);
    expect(MAIN).toMatch(/onTopicMenu: \(m\) => formatSyncedTopicsLabel\(traceSummary, m\),/u);
    expect(MAIN).not.toMatch(/^import .*formatSyncedTopicsLabel/mu);
    expect(MAIN).not.toContain("connectFn");
  });

  it("the onTopicMenu dep sits on a line of its own (C49)", () => {
    const own = MAIN.split("\n").filter((l) => /^\s*onTopicMenu: \(m\) => formatSyncedTopicsLabel\(traceSummary, m\),?\s*$/u.test(l));
    expect(own).toHaveLength(1);
  });

  it("main.ts is 4719 lines (4724 base, W0-CAM-P: latch +9, staged-actor hold +7, 21 dead lines deleted, fences moved to live calls)", () => {
    expect(MAIN.split("\n").length - (MAIN.endsWith("\n") ? 1 : 0)).toBe(MAIN_LINES_AT_BASE);
  });
});
