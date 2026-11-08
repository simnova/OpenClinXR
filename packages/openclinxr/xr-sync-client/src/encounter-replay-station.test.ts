import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C31 RED: ?encounterReplayStation=<id> joins a replay room (roomOptions.replayStationId); the shell speaks the
// replayed turns through the same path, and mounts no learner input (a replay room rejects every intent).
class FakeElement {
  id = ""; value = ""; textContent: string | null = ""; type = ""; placeholder = ""; disabled = false;
  children: FakeElement[] = [];
  handlers: Array<() => void> = [];
  constructor(readonly tag: string) {}
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  addEventListener(type: string, fn: () => void): void { if (type === "click") this.handlers.push(fn); }
  click(): void { for (const fn of this.handlers) fn(); }
  descendants(): FakeElement[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };

async function joinWith(search: string, withBox = false) {
  const connected: unknown[] = [];
  const listeners: Array<(snapshot: unknown) => void> = [];
  const played: Array<[string, string, string]> = [];
  const published: EncounterSyncEvidence[] = [];
  const sent: string[] = [];
  const parent = new FakeElement("div");
  const handle = await startEncounterSyncFromUrl({
    search,
    actorIds: () => ["p"],
    register: (payload: Record<string, unknown>) => {
      const plan = payload["actorTurnPlan"] as { spokenText: string; dialogueEmotionTo: string };
      return { caption: plan.spokenText, faceEmotion: plan.dialogueEmotionTo };
    },
    play: (actorId: string, caption: string, emotion: string) => { played.push([actorId, caption, emotion]); },
    publish: (e: EncounterSyncEvidence) => { published.push(e); },
    nowMs: () => 1,
    ...(withBox ? { utteranceBox: { doc: fakeDoc, parent } } : {}),
    connectFn: async (url: string, options: unknown) => {
      connected.push({ url, options });
      return { sessionId: "s", sendIntent: async (kind: string) => { sent.push(kind); return { status: "ack" }; }, onState: (cb: (snapshot: unknown) => void) => { listeners.push(cb); return () => undefined; }, leave: async () => undefined } as never;
    },
  } as never);
  return { handle, connected, published, parent, listeners, played, sent };
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
  it("plays a replayed turn through the same registered-plan path as a live turn", async () => {
    const { listeners, played, published } = await joinWith("?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a");
    const actor = { id: "p", speaking: true, emotion: "concerned", replyId: "p:opening", cueId: "cue-opening-01", caption: "Pat: Hello there" };
    for (const listener of listeners) listener({ serverTick: 1, phase: "encounter", turnId: 1, turnOwner: "actor", actors: { p: actor }, learners: {}, stationId: "slot-a" });
    expect(played).toEqual([["p", "Pat: Hello there", "concerned"]]);
    expect(published[0]?.turns.map((turn) => [turn.replyId, turn.spoken])).toEqual([["p:opening", true]]);
  });
  it("mounts no learner input in a replay room: 0 textarea, 0 input, 0 enabled button, and a click on every chip sends nothing", async () => {
    const { parent, listeners, sent } = await joinWith("?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a", true);
    const menu = [{ tag: "history_opqrst", label: "when did the chest pressure start", labelSource: "seed-phrase", note: "", asked: true }, { tag: "ecg_request", label: "ecg_request", labelSource: "tag", note: "", asked: false }];
    for (const listener of listeners) listener({ serverTick: 1, phase: "encounter", phaseRemainingS: 0, turnId: 0, turnOwner: "none", actors: {}, learners: {}, stationId: "slot-a", topicMenu: menu });
    const GUARD = "replay must stay read-only (C31 c886fdae6): remove the input control; do not relax this guard";
    const all = parent.descendants();
    expect(all.filter((el) => el.tag === "button").length, "the replay panel must show the chips").toBe(menu.length);
    expect(all.filter((el) => el.tag === "textarea").length, GUARD).toBe(0);
    expect(all.filter((el) => el.tag === "input").length, GUARD).toBe(0);
    expect(all.filter((el) => el.tag === "button" && !el.disabled).length, GUARD).toBe(0);
    for (const el of all) el.click();
    expect(sent, GUARD).toEqual([]);
  });
});
