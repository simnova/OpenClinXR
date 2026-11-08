import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C47 RED (lane manager, 2026-11-08): each lobby row shows one note line saying how the note arrived. Exact strings from the card:
//   noteSource 'explicit'                     -> 'Note N characters, submitted'
//   noteSource 'draft'                        -> 'Note N characters, auto-collected at time end'
//   noteSource '' and notePresent true        -> 'Note N characters'   ('' = note present, source unrecorded: index written before C45)
//   notePresent false                         -> no note line
// The wording reference is the live room panel (encounter-room-panel.ts:150); the lobby says "submitted" where the panel says "accepted".
// Counterweights (each its own it): (a) no note shows no line whatever the source field says; (b) a later snapshot with the last event's source
// replaces the line; (c) a pre-C45 row without noteSource reads 'Note N characters'; (d) a source outside {explicit, draft} never renders as 'submitted'.
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
const row = (id: string, extra: Record<string, unknown>) => ({ stationId: id, stationIndex: 0, turnCount: 3, available: true, unavailableReason: "", ...extra });
const noteLine = (parent: FakeElement, id: string): string | undefined => parent.find(`lobby-note-${id}`)?.textContent ?? undefined;

describe("the review lobby shows how each note arrived (C47)", () => {
  it("an explicit note reads 'Note 63 characters, submitted' and a draft note reads 'Note 63 characters, auto-collected at time end'", async () => {
    const { parent, push } = await join();
    push(lobbySnap([row("s1", { notePresent: true, noteChars: 63, noteSource: "explicit" }), row("s2", { notePresent: true, noteChars: 63, noteSource: "draft" })]));
    expect(noteLine(parent, "s1")).toBe("Note 63 characters, submitted");
    expect(noteLine(parent, "s2")).toBe("Note 63 characters, auto-collected at time end");
    expect(parent.find("lobby-row-s1")?.find("lobby-note-s1")?.textContent).toBe("Note 63 characters, submitted");
  });
  it("a note with an unrecorded source reads 'Note 41 characters'", async () => {
    const { parent, push } = await join();
    push(lobbySnap([row("s1", { notePresent: true, noteChars: 41, noteSource: "" })]));
    expect(noteLine(parent, "s1")).toBe("Note 41 characters");
  });
  it("(a) a station with no note shows no note line, whatever the source field holds", async () => {
    const { parent, push } = await join();
    push(lobbySnap([row("s1", { notePresent: false, noteChars: 0, noteSource: "" }), row("s2", { notePresent: false, noteChars: 0, noteSource: "explicit" }), row("s3", { notePresent: false, noteChars: 0 })]));
    expect([noteLine(parent, "s1"), noteLine(parent, "s2"), noteLine(parent, "s3")]).toEqual([undefined, undefined, undefined]);
  });
  it("(b) the line follows the latest snapshot: draft then explicit reads submitted, and rows are not duplicated", async () => {
    const { parent, push } = await join();
    push(lobbySnap([row("s1", { notePresent: true, noteChars: 63, noteSource: "draft" })]));
    expect(noteLine(parent, "s1")).toBe("Note 63 characters, auto-collected at time end");
    push(lobbySnap([row("s1", { notePresent: true, noteChars: 40, noteSource: "explicit" })]));
    expect(noteLine(parent, "s1")).toBe("Note 40 characters, submitted");
    expect(parent.find("review-lobby")!.children.map((r) => r.id)).toEqual(["lobby-row-s1"]);
  });
  it("(c) a row from an index written before C45 (no noteSource field) reads 'Note 29 characters'", async () => {
    const { parent, push } = await join();
    push(lobbySnap([row("s1", { notePresent: true, noteChars: 29 })]));
    expect(noteLine(parent, "s1")).toBe("Note 29 characters");
  });
  it("(d) a source outside {explicit, draft} never renders as submitted or auto-collected", async () => {
    const { parent, push } = await join();
    push(lobbySnap([row("s1", { notePresent: true, noteChars: 7, noteSource: "forged" }), row("s2", { notePresent: true, noteChars: 7, noteSource: "Explicit" })]));
    expect([noteLine(parent, "s1"), noteLine(parent, "s2")]).toEqual(["Note 7 characters", "Note 7 characters"]);
  });
});
