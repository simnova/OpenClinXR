import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C45 RED: the panel sends the typed-but-unsubmitted note as a note-draft intent during the note phase (from render, one per changed text),
//   compares the text with the last ACKED draft (never the last sent), sends no second draft while one is in flight, resends the same text after a
//   reject or a transport failure, and shows "Note auto-collected at time end, N characters" when the room's noteSource is "draft".
type Handler = (event: { preventDefault?: () => void }) => void;
class FakeElement {
  id = ""; value = ""; type = ""; placeholder = ""; disabled = false; hidden = false;
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  handlers = new Map<string, Handler[]>();
  private text: string | null = "";
  constructor(readonly tag: string) {}
  get textContent(): string | null { return this.text; }
  set textContent(value: string | null) { this.text = value; this.children = []; }
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(type: string, fn: Handler): void { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  find(id: string): FakeElement | undefined { return this.id === id ? this : this.children.map((child) => child.find(id)).find((found) => found !== undefined); }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const SNAP = {
  serverTick: 1, phase: "note", phaseRemainingS: 100, turnId: 0, turnOwner: "none", learners: {},
  actors: { p: { id: "p", displayName: "Robert Hayes", role: "patient" } },
  topicMenu: [], noteStatus: "none", noteChars: 0,
};
const NOTE = "Chest pressure for two hours, radiating to the left arm.";
type Reply = "ack" | "rate-limited" | "invalid" | "transport" | "pending";

async function joined(replyFor: (call: number, text: string) => Reply) {
  const parent = new FakeElement("div");
  const drafts: string[] = [];
  const otherKinds: string[] = [];
  const pendingResolvers: Array<(r: unknown) => void> = [];
  let stateListener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: (_e: EncounterSyncEvidence) => undefined,
    nowMs: () => Date.now(),
    utteranceBox: { doc: fakeDoc, parent },
    noteText: () => text,
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async (kind: string, payload: Record<string, unknown>) => {
        if (kind !== "note-draft") { otherKinds.push(kind); return { status: "ack", seq: 1, serverTs: 0, rttMs: 1 }; }
        const sent = String(payload["text"] ?? "");
        drafts.push(sent);
        const reply = replyFor(drafts.length, sent);
        if (reply === "transport") throw new Error("intent 1 timed out after 5000ms");
        if (reply === "pending") return new Promise((resolve) => { pendingResolvers.push(resolve); });
        if (reply === "rate-limited") return { status: "reject", reason: "draft-rate-limited", seq: 1 };
        if (reply === "invalid") return { status: "reject", reason: "invalid-note", seq: 1 };
        return { status: "ack", seq: 1, serverTs: 0, rttMs: 1 };
      },
      onState: (fn: (s: unknown) => void) => { stateListener = fn; return () => undefined; },
      leave: async () => undefined,
    }) as never,
  } as never);
  const el = (id: string): FakeElement => parent.find(id) as FakeElement;
  const snapshot = async (s: unknown): Promise<void> => { stateListener?.(s); await flush(); };
  return { el, drafts, otherKinds, pendingResolvers, snapshot };
}
let text = "";

describe("the panel sends the unsubmitted note as a draft and shows the auto-collected line (C45)", () => {
  it("sends one note-draft with the text in the note phase and none while the text is unchanged and acked", async () => {
    text = NOTE;
    const { drafts, snapshot } = await joined(() => "ack");
    await snapshot({ ...SNAP, phase: "encounter" });
    expect(drafts).toEqual([]);
    await snapshot(SNAP);
    expect(drafts).toEqual([NOTE]);
    await snapshot({ ...SNAP, phaseRemainingS: 99 });
    await snapshot({ ...SNAP, phaseRemainingS: 98 });
    expect(drafts).toEqual([NOTE]);
    text = `${NOTE} Denies nausea.`;
    await snapshot({ ...SNAP, phaseRemainingS: 97 });
    expect(drafts).toEqual([NOTE, `${NOTE} Denies nausea.`]);
  });

  it("sends nothing before the learner types and nothing outside the note phase", async () => {
    text = "";
    const { drafts, snapshot } = await joined(() => "ack");
    await snapshot(SNAP);
    expect(drafts).toEqual([]);
    text = NOTE;
    await snapshot({ ...SNAP, phase: "closed" });
    expect(drafts).toEqual([]);
  });

  it("a rejected draft is sent again on the next snapshot with unchanged text; its ack stops further sends", async () => {
    text = NOTE;
    const { drafts, snapshot } = await joined((call) => (call === 1 ? "rate-limited" : "ack"));
    await snapshot(SNAP);
    expect(drafts).toEqual([NOTE]);
    await snapshot({ ...SNAP, phaseRemainingS: 99 });
    expect(drafts).toEqual([NOTE, NOTE]);
    await snapshot({ ...SNAP, phaseRemainingS: 98 });
    expect(drafts).toEqual([NOTE, NOTE]);
  });

  it("a draft that gets no reply is sent again on the next snapshot", async () => {
    text = NOTE;
    const { drafts, snapshot } = await joined((call) => (call === 1 ? "transport" : "ack"));
    await snapshot(SNAP);
    await snapshot({ ...SNAP, phaseRemainingS: 99 });
    expect(drafts).toEqual([NOTE, NOTE]);
    await snapshot({ ...SNAP, phaseRemainingS: 98 });
    expect(drafts).toEqual([NOTE, NOTE]);
  });

  it("sends no second draft while one is in flight, then the settled result decides", async () => {
    text = NOTE;
    const { drafts, pendingResolvers, snapshot } = await joined((call) => (call === 1 ? "pending" : "ack"));
    await snapshot(SNAP);
    text = `${NOTE} More.`;
    await snapshot({ ...SNAP, phaseRemainingS: 99 });
    await snapshot({ ...SNAP, phaseRemainingS: 98 });
    expect(drafts).toEqual([NOTE]);
    pendingResolvers[0]?.({ status: "ack", seq: 1, serverTs: 0, rttMs: 1 });
    await flush();
    await snapshot({ ...SNAP, phaseRemainingS: 97 });
    expect(drafts).toEqual([NOTE, `${NOTE} More.`]);
  });

  it("a rejected or failed draft never shows a refusal line", async () => {
    text = NOTE;
    const { el, snapshot } = await joined((call) => (call === 1 ? "rate-limited" : "transport"));
    await snapshot(SNAP);
    expect(el("room-refusal").textContent).toBe("");
    await snapshot({ ...SNAP, phaseRemainingS: 99 });
    expect(el("room-refusal").textContent).toBe("");
  });

  it("shows 'Note auto-collected at time end, N characters' for source draft and the accepted line for explicit", async () => {
    text = NOTE;
    const { el, snapshot } = await joined(() => "ack");
    await snapshot({ ...SNAP, phase: "closed", noteStatus: "submitted", noteChars: NOTE.length, noteSource: "draft" });
    expect(el("room-note-status").textContent).toBe(`Note auto-collected at time end, ${NOTE.length} characters`);
    await snapshot({ ...SNAP, phase: "closed", noteStatus: "submitted", noteChars: 12, noteSource: "explicit" });
    expect(el("room-note-status").textContent).toBe("Note accepted, 12 characters");
    await snapshot({ ...SNAP, phase: "closed", noteStatus: "submitted", noteChars: 7 });
    expect(el("room-note-status").textContent).toBe("Note accepted, 7 characters");
    await snapshot({ ...SNAP, phase: "closed", noteStatus: "none", noteChars: 0, noteSource: "draft" });
    expect(el("room-note-status").textContent).toBe("");
  });
});
