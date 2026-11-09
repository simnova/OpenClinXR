import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C44 RED: a note-submit whose promise rejects (timeout or transport error: the room never replied) shows "Note not sent: no reply from the room"
//   in #room-refusal, leaves #room-note-status as the snapshot says, is cleared by a later accepted submit, and is ordered by click id like any note outcome.
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
  click(): void { for (const fn of this.handlers.get("click") ?? []) fn({}); }
  find(id: string): FakeElement | undefined { return this.id === id ? this : this.children.map((child) => child.find(id)).find((found) => found !== undefined); }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const SNAP = {
  serverTick: 1, phase: "encounter", phaseRemainingS: 100, turnId: 0, turnOwner: "none", learners: {},
  actors: { p: { id: "p", displayName: "Robert Hayes", role: "patient" } },
  topicMenu: [],
};
const NOTE = "Chest pressure for two hours, radiating to the left arm.";

type Outcome = "ack" | "invalid" | "timeout" | "late-timeout";

async function joined(outcomeFor: (text: string) => Outcome) {
  const parent = new FakeElement("div");
  const lateFailures: Array<() => void> = [];
  let stateListener: ((s: unknown) => void) | undefined;
  const handle = await startEncounterSyncFromUrl({
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
        if (kind !== "note-submit") return { status: "reject", reason: "bad-topic", seq: 1 };
        const outcome = outcomeFor(String(payload["text"] ?? ""));
        if (outcome === "timeout") throw new Error("intent 1 timed out after 5000ms");
        if (outcome === "late-timeout") return new Promise((_resolve, reject) => { lateFailures.push(() => reject(new Error("intent 2 timed out after 5000ms"))); });
        return outcome === "invalid" ? { status: "reject", reason: "invalid-note", seq: 1 } : { status: "ack", seq: 1, serverTs: 0, rttMs: 1 };
      },
      onState: (fn: (s: unknown) => void) => { stateListener = fn; return () => undefined; },
      leave: async () => undefined,
    }) as never,
  } as never);
  const el = (id: string): FakeElement => parent.find(id) as FakeElement;
  return { handle, el, lateFailures, snapshot: (s: unknown) => stateListener?.(s) };
}
let text = "";
const NOT_SENT = "Note not sent: no reply from the room";

describe("a note submit that gets no reply tells the learner it was not sent (C44)", () => {
  it("a rejected submit promise shows the not-sent line and leaves the note status unchanged", async () => {
    text = "LOST";
    const { el, snapshot } = await joined((t) => (t === "LOST" ? "timeout" : "ack"));
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).toBe(NOT_SENT);
    expect(el("room-note-status").textContent).toBe("");
    snapshot({ ...SNAP, phase: "note", noteStatus: "submitted", noteChars: 5 });
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).toBe(NOT_SENT);
    expect(el("room-note-status").textContent).toBe("Note accepted, 5 characters");
  });

  it("a later accepted submit clears the not-sent line", async () => {
    text = "LOST";
    const { el, snapshot } = await joined((t) => (t === "LOST" ? "timeout" : "ack"));
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).toBe(NOT_SENT);
    text = NOTE;
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).toBe("");
  });

  it("click A failing late after click B was acknowledged does not overwrite B's outcome", async () => {
    text = "";
    const { el, lateFailures, snapshot } = await joined((t) => (t === "" ? "invalid" : t === "SLOW" ? "late-timeout" : "ack"));
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).toBe("Not accepted: invalid-note");
    text = "SLOW";
    el("room-note-submit").click();
    text = NOTE;
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).toBe("");
    lateFailures[0]?.();
    await flush();
    expect(el("room-refusal").textContent).toBe("");
  });

  it("the not-sent line does not claim the server refused the note", async () => {
    text = "LOST";
    const { el, snapshot } = await joined(() => "timeout");
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).not.toMatch(/^Not accepted/u);
  });

  it("a failed note submit does not replace a topic refusal already on screen", async () => {
    text = "LOST";
    const { el, handle, snapshot } = await joined(() => "timeout");
    snapshot({ ...SNAP, phase: "encounter" });
    await handle?.sendIntent("utterance-end", { topicTag: "x" });
    expect(el("room-refusal").textContent).toBe("Not accepted: bad-topic");
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).toBe("Not accepted: bad-topic");
  });

  it("click A failing late after click B was rejected does not replace B's reject with the not-sent line", async () => {
    text = "SLOW";
    const { el, lateFailures, snapshot } = await joined((t) => (t === "SLOW" ? "late-timeout" : "invalid"));
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    el("room-note-submit").click();
    text = "";
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).toBe("Not accepted: invalid-note");
    lateFailures[0]?.();
    await flush();
    expect(el("room-refusal").textContent).toBe("Not accepted: invalid-note");
  });
});
