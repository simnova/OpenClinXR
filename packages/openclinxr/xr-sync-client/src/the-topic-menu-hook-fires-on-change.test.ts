import { describe, expect, it } from "vitest";
import { startEncounterSyncFromUrl } from "./headset.js";

// B'' RED A: the shell is told the station's topic menu through onTopicMenu(menu), taken
// from the snapshot's topicMenu. It fires on the first snapshot carrying a topicMenu and
// on every snapshot whose asked set differs from the last one fired, never twice for an
// unchanged menu. Never fired: snapshots without a menu (old server), replay rooms,
// review lobby.
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const LIVE = "?encounterSync=ws://127.0.0.1:9";
const REPLAY = "?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a";
const LOBBY = "?encounterSync=ws://127.0.0.1:9&encounterReviewLobby=1";

type Menu = Array<{ tag: string; label: string; labelSource: string; note: string; asked: boolean }>;
const menu = (asked: readonly boolean[]): Menu =>
  asked.map((a, i) => ({ tag: `topic_${i}`, label: `Topic ${i}`, labelSource: "server", note: "", asked: a }));

function snap(extra: Record<string, unknown>): Record<string, unknown> {
  return { serverTick: 1, phase: "encounter", phaseRemainingS: 10, turnId: 0, turnOwner: "none", actors: {}, learners: {}, ...extra };
}

async function run(search: string, snapshots: Array<Record<string, unknown>>): Promise<Array<readonly boolean[]>> {
  const calls: Array<readonly boolean[]> = [];
  let listener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onTopicMenu: (m: Menu) => { calls.push(m.map((e: Menu[number]) => e.asked)); },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (fn: (s: unknown) => void) => { listener = fn; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  for (const s of snapshots) { listener?.(s); await flush(); }
  return calls;
}

describe("the topic menu hook fires on change (B'')", () => {
  it("3 snapshots with 1 menu change give exactly 1 extra call", async () => {
    const calls = await run(LIVE, [
      snap({ stationIndex: 0, stationCount: 2, topicMenu: menu([true, false, false]) }),
      snap({ stationIndex: 0, stationCount: 2, topicMenu: menu([true, false, false]) }),
      snap({ stationIndex: 0, stationCount: 2, topicMenu: menu([true, true, false]) }),
    ]);
    expect(calls).toEqual([[true, false, false], [true, true, false]]);
  });

  it("an unchanged menu never fires twice", async () => {
    const calls = await run(LIVE, [
      snap({ stationIndex: 0, stationCount: 2, topicMenu: menu([false, false]) }),
      snap({ stationIndex: 0, stationCount: 2, topicMenu: menu([false, false]) }),
      snap({ stationIndex: 0, stationCount: 2, topicMenu: menu([false, false]) }),
    ]);
    expect(calls).toEqual([[false, false]]);
  });

  it("a snapshot without a topicMenu (old server) fires nothing", async () => {
    expect(await run(LIVE, [snap({ stationIndex: 0, stationCount: 2 })])).toEqual([]);
  });

  it("a replay room fires nothing even when its snapshot carries a menu", async () => {
    expect(await run(REPLAY, [snap({ stationIndex: 0, stationCount: 2, topicMenu: menu([true, false]) })])).toEqual([]);
  });

  it("the review lobby fires nothing even when its snapshot carries a menu", async () => {
    expect(await run(LOBBY, [snap({ stationIndex: 0, stationCount: 2, topicMenu: menu([true, false]) })])).toEqual([]);
  });
});
