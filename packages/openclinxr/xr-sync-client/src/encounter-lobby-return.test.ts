import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C33 Part A RED: a lobby-launched replay that ends returns the reviewer to the lobby on the same connection.
// In a lobby session (?encounterReviewLobby=1) a snapshot with mode "replay" and replayDone true shows #return-to-lobby
// (hidden=false) in the utteranceBox mount; before the end (replayDone false) and in lobby mode it is hidden. Clicking it sends
// return-to-lobby once on the same sendIntent (a second click while pending sends nothing). evidence.lobby.returns records
// [{ status, reason }] per click. A later lobby snapshot renders the station list again.
class FakeElement {
  id = ""; value = ""; type = ""; placeholder = ""; disabled = false; hidden = false;
  children: FakeElement[] = [];
  handlers: Record<string, Array<(event: unknown) => void>> = {};
  private text: string | null = "";
  constructor(readonly tag: string) {}
  get textContent(): string | null { return this.text; }
  set textContent(value: string | null) { this.text = value; this.children = []; }
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  addEventListener(type: string, listener: (event: unknown) => void): void { (this.handlers[type] ??= []).push(listener); }
  click(): void { for (const handler of this.handlers["click"] ?? []) handler({}); }
  find(id: string): FakeElement | undefined {
    if (this.id === id) return this;
    for (const child of this.children) { const hit = child.find(id); if (hit) return hit; }
    return undefined;
  }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };

async function join() {
  const listeners: Array<(snapshot: unknown) => void> = [];
  const sent: Array<[string, unknown]> = [];
  const published: EncounterSyncEvidence[] = [];
  const parent = new FakeElement("div");
  await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9&encounterReviewLobby=1",
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: (e: EncounterSyncEvidence) => { published.push(e); },
    nowMs: () => 1,
    utteranceBox: { doc: fakeDoc, parent },
    connectFn: async () => ({ sessionId: "s", sendIntent: async (kind: string, payload: unknown) => { sent.push([kind, payload]); return { status: "ack" }; }, onState: (cb: (snapshot: unknown) => void) => { listeners.push(cb); return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  const push = (snapshot: Record<string, unknown>) => { for (const listener of listeners) listener({ serverTick: 1, phase: "encounter", turnId: 0, turnOwner: "none", actors: {}, learners: {}, ...snapshot }); };
  return { sent, evidence: published[0] as EncounterSyncEvidence, parent, push };
}

describe("return to the lobby after a replay (C33 Part A)", () => {
  it("is hidden in the lobby and mid-replay, shown when the replay is done", async () => {
    const { parent, push } = await join();
    push({ mode: "lobby", lobbyStations: [{ stationId: "s1", stationIndex: 0, turnCount: 2, notePresent: false, noteChars: 0 }] });
    expect(parent.find("return-to-lobby")?.hidden).toBe(true);
    push({ mode: "replay", replayDone: false });
    expect(parent.find("return-to-lobby")?.hidden).toBe(true);
    push({ mode: "replay", replayDone: true });
    expect(parent.find("return-to-lobby")?.hidden).toBe(false);
  });
  it("sends return-to-lobby once on the same connection and records the outcome", async () => {
    const { parent, sent, push, evidence } = await join();
    push({ mode: "replay", replayDone: true });
    const button = parent.find("return-to-lobby");
    button?.click();
    button?.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toEqual([["return-to-lobby", {}]]);
    expect(evidence.lobby?.returns).toEqual([{ status: "ack", reason: "" }]);
  });
  it("renders the station list again on the next lobby snapshot and hides the button", async () => {
    const { parent, push } = await join();
    push({ mode: "replay", replayDone: true });
    push({ mode: "lobby", lobbyStations: [{ stationId: "s1", stationIndex: 0, turnCount: 2, notePresent: false, noteChars: 0 }] });
    expect(parent.find("lobby-station-s1")).toBeDefined();
    expect(parent.find("return-to-lobby")?.hidden).toBe(true);
  });
});
