import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C32 RED: ?encounterSync=ws://..&encounterReviewLobby=1 joins the review lobby (roomOptions { reviewLobby: true }, no actors).
// Lobby snapshots (mode "lobby") render a station list in the utteranceBox mount (#review-lobby): one button per station
// (#lobby-station-<id>); an unavailable station's button is disabled and its reason is shown (#lobby-reason-<id>); clicking
// an available one sends select-station {stationId} once; clicking an unavailable one sends nothing. Rows without an
// `available` field (old servers) are available. A non-lobby snapshot empties the list (replay speaks through the C31 path).
// Evidence: lobby = { stations: [{ stationId, available, reason }], selections: [{ stationId, status, reason }] }.
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
const LOBBY = "?encounterSync=ws://127.0.0.1:9&encounterReviewLobby=1";

async function join(search = LOBBY, status: "ack" | "reject" = "ack") {
  const connected: unknown[] = [];
  const listeners: Array<(snapshot: unknown) => void> = [];
  const sent: Array<[string, unknown]> = [];
  const published: EncounterSyncEvidence[] = [];
  const parent = new FakeElement("div");
  const handle = await startEncounterSyncFromUrl({
    search,
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: (e: EncounterSyncEvidence) => { published.push(e); },
    nowMs: () => 1,
    utteranceBox: { doc: fakeDoc, parent },
    connectFn: async (url: string, options: unknown) => {
      connected.push({ url, options });
      return { sessionId: "s", sendIntent: async (kind: string, payload: unknown) => { sent.push([kind, payload]); return status === "ack" ? { status: "ack" } : { status: "reject", reason: "station-unavailable" }; }, onState: (cb: (snapshot: unknown) => void) => { listeners.push(cb); return () => undefined; }, leave: async () => undefined } as never;
    },
  } as never);
  const push = (snapshot: Record<string, unknown>) => { for (const listener of listeners) listener(snapshot); };
  return { handle, connected, sent, published, parent, push };
}
const rows = [
  { stationId: "s1", stationIndex: 0, turnCount: 3, notePresent: false, noteChars: 0, available: true, unavailableReason: "" },
  { stationId: "s2", stationIndex: 1, turnCount: 2, notePresent: false, noteChars: 0, available: false, unavailableReason: "replay-unresolved-reply: x:seed:forged" },
];
const lobbySnap = (lobbyStations: unknown[]) => ({ serverTick: 1, phase: "", turnId: 0, turnOwner: "none", actors: {}, learners: {}, stationId: "", mode: "lobby", lobbyStations });

describe("?encounterReviewLobby (C32)", () => {
  it("joins the lobby with reviewLobby room options and no actor list", async () => {
    const { connected } = await join();
    expect(connected).toEqual([{ url: "ws://127.0.0.1:9", options: { roomOptions: { reviewLobby: true } } }]);
  });
  it("does not join when combined with a replay station", async () => {
    const { handle, connected } = await join(`${LOBBY}&encounterReplayStation=slot-a`);
    expect(handle).toBeNull();
    expect(connected).toEqual([]);
  });
  it("lists each station; an unavailable one is disabled with its reason and cannot be selected", async () => {
    const { parent, push, sent, published } = await join();
    push(lobbySnap(rows));
    const available = parent.find("lobby-station-s1")!;
    const unavailable = parent.find("lobby-station-s2")!;
    expect([available.disabled, unavailable.disabled]).toEqual([false, true]);
    expect(parent.find("lobby-reason-s2")?.textContent).toContain("replay-unresolved-reply: x:seed:forged");
    expect(parent.find("lobby-reason-s1")?.textContent ?? "").toBe("");
    unavailable.click();
    expect(sent).toEqual([]);
    available.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([["select-station", { stationId: "s1" }]]);
    const lobby = (published[0] as unknown as { lobby: { stations: unknown[]; selections: unknown[] } }).lobby;
    expect(lobby.stations).toEqual([{ stationId: "s1", available: true, reason: "" }, { stationId: "s2", available: false, reason: "replay-unresolved-reply: x:seed:forged" }]);
    expect(lobby.selections).toEqual([{ stationId: "s1", status: "ack", reason: "" }]);
  });
  it("treats rows without availability fields as available", async () => {
    const { parent, push } = await join();
    push(lobbySnap([{ stationId: "s1", stationIndex: 0, turnCount: 1, notePresent: false, noteChars: 0 }]));
    expect(parent.find("lobby-station-s1")?.disabled).toBe(false);
  });
  it("records a server reject and re-renders without duplicating rows", async () => {
    const { parent, push, published, sent } = await join(LOBBY, "reject");
    push(lobbySnap(rows));
    push(lobbySnap(rows));
    expect(parent.find("review-lobby")?.children.filter((c) => c.tag === "div" || c.tag === "button").length).toBeLessThanOrEqual(4);
    parent.find("lobby-station-s1")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.length).toBe(1);
    expect((published[0] as unknown as { lobby: { selections: unknown[] } }).lobby.selections).toEqual([{ stationId: "s1", status: "reject", reason: "station-unavailable" }]);
  });
  it("empties the list once the room is no longer a lobby", async () => {
    const { parent, push } = await join();
    push(lobbySnap(rows));
    push({ ...lobbySnap(rows), mode: "replay", stationId: "s1", lobbyStations: [] });
    expect(parent.find("lobby-station-s1")).toBeUndefined();
  });
});
