import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C31 RED: ?encounterReplayStation=<id> joins a replay room (roomOptions.replayStationId); the shell speaks the
// replayed turns through the same path, and mounts no learner input (a replay room rejects every intent).
class FakeElement {
  id = ""; value = ""; textContent: string | null = ""; type = ""; placeholder = "";
  children: FakeElement[] = [];
  constructor(readonly tag: string) {}
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  addEventListener(): void {}
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };

async function joinWith(search: string, withBox = false) {
  const connected: unknown[] = [];
  const published: EncounterSyncEvidence[] = [];
  const parent = new FakeElement("div");
  const handle = await startEncounterSyncFromUrl({
    search,
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: (e: EncounterSyncEvidence) => { published.push(e); },
    nowMs: () => 1,
    ...(withBox ? { utteranceBox: { doc: fakeDoc, parent } } : {}),
    connectFn: async (url: string, options: unknown) => {
      connected.push({ url, options });
      return { sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: () => () => undefined, leave: async () => undefined } as never;
    },
  } as never);
  return { handle, connected, published, parent };
}

describe("?encounterReplayStation (C31)", () => {
  it("passes replayStationId in the room options and names it in the evidence", async () => {
    const { connected, published } = await joinWith("?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a");
    expect(connected).toEqual([{ url: "ws://127.0.0.1:9", options: { roomOptions: { actors: ["p"], replayStationId: "slot-a" } } }]);
    expect((published[0] as unknown as { replayStation?: string }).replayStation).toBe("slot-a");
  });
  it("without the flag the room options are unchanged", async () => {
    const { connected } = await joinWith("?encounterSync=ws://127.0.0.1:9");
    expect(connected).toEqual([{ url: "ws://127.0.0.1:9", options: { roomOptions: { actors: ["p"] } } }]);
  });
  it.each(["", "a b", "x".repeat(65), "../etc"])("does not join for the replay station %j", async (station) => {
    const { handle, connected } = await joinWith(`?encounterSync=ws://127.0.0.1:9&encounterReplayStation=${encodeURIComponent(station)}`);
    expect(handle).toBeNull();
    expect(connected).toEqual([]);
  });
  it("mounts no learner input in a replay room", async () => {
    const { parent } = await joinWith("?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a", true);
    expect(parent.children).toEqual([]);
  });
});
