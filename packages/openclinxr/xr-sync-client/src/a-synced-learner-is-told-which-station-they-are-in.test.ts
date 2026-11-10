import { describe, expect, it } from "vitest";
import { startEncounterSyncFromUrl } from "./headset.js";

// C50 RED A: the shell is told the server's station position through onStation(index, count), taken from the snapshot's
// stationIndex (0-based) and stationCount. It fires on the first snapshot and on every snapshot whose (index, count) differs
// from the last one fired. A rotation stays inside ONE startEncounterSyncFromUrl connection (index.ts rotate -> consumeSeatReservation
// keeps onState), so the next station is a new snapshot position on the same handle.
// Never fired: stationCount 0 (single room outside a rotation), fields absent (old server), replay rooms, review lobby.
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const LIVE = "?encounterSync=ws://127.0.0.1:9";
const REPLAY = "?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a";
const LOBBY = "?encounterSync=ws://127.0.0.1:9&encounterReviewLobby=1";

function snap(extra: Record<string, unknown>): Record<string, unknown> {
  return { serverTick: 1, phase: "encounter", phaseRemainingS: 10, turnId: 0, turnOwner: "none", actors: {}, learners: {}, ...extra };
}

async function run(search: string, snapshots: Array<Record<string, unknown>>): Promise<Array<[number, number]>> {
  const calls: Array<[number, number]> = [];
  let listener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onStation: (index: number, count: number) => { calls.push([index, count]); },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (fn: (s: unknown) => void) => { listener = fn; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  for (const s of snapshots) { listener?.(s); await flush(); }
  return calls;
}

describe("a synced learner is told which station they are in (C50)", () => {
  it("one handle across a rotation: snapshots (0,3) (0,3) (1,3) (1,3) give exactly [[0,3],[1,3]]", async () => {
    const station = (stationIndex: number, stationId: string) => snap({ stationIndex, stationCount: 3, stationId });
    expect(await run(LIVE, [station(0, "slot-1"), station(0, "slot-1"), station(1, "slot-2"), station(1, "slot-2")])).toEqual([[0, 3], [1, 3]]);
  });

  it("the first snapshot fires with the server's own numbers, zero-based index first", async () => {
    expect(await run(LIVE, [snap({ stationIndex: 2, stationCount: 5 })])).toEqual([[2, 5]]);
  });

  it("a changed count at the same index fires again", async () => {
    expect(await run(LIVE, [snap({ stationIndex: 1, stationCount: 3 }), snap({ stationIndex: 1, stationCount: 4 })])).toEqual([[1, 3], [1, 4]]);
  });

  it("stationCount 0 (a single room outside a rotation) fires nothing", async () => {
    expect(await run(LIVE, [snap({ stationIndex: 0, stationCount: 0 }), snap({ stationIndex: 0, stationCount: 0 })])).toEqual([]);
  });

  it("a snapshot without the position fields (old server) fires nothing", async () => {
    expect(await run(LIVE, [snap({})])).toEqual([]);
  });

  it("a replay room fires nothing even when its snapshot carries a position", async () => {
    expect(await run(REPLAY, [snap({ stationIndex: 0, stationCount: 3 })])).toEqual([]);
  });

  it("the review lobby fires nothing even when its snapshot carries a position", async () => {
    expect(await run(LOBBY, [snap({ stationIndex: 1, stationCount: 3 })])).toEqual([]);
  });
});
