import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C41 RED: in the note phase the room panel offers "Submit note", which sends one note-submit {text} with the shell's note text.
//   #room-note-submit is hidden and disabled outside the note phase, and a click there sends nothing.
//   #room-note-status reads "Note accepted, N characters" with N taken from the snapshot's noteChars (never from the local text),
//   and only while the snapshot says noteStatus "submitted". A reject shows "Not accepted: <reason>" in #room-refusal.
//   Without a noteText dep the panel mounts no note control.
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

async function joined(options: { noteText?: () => string; rejectWhen?: (text: string) => string | undefined } = {}) {
  const parent = new FakeElement("div");
  const sent: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  let stateListener: ((s: unknown) => void) | undefined;
  const handle = await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: (_e: EncounterSyncEvidence) => undefined,
    nowMs: () => Date.now(),
    utteranceBox: { doc: fakeDoc, parent },
    ...(options.noteText === undefined ? {} : { noteText: options.noteText }),
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async (kind: string, payload: Record<string, unknown>) => {
        sent.push({ kind, payload });
        const reason = options.rejectWhen?.(String(payload["text"] ?? ""));
        return reason === undefined ? { status: "ack", seq: 1, serverTs: 0, rttMs: 1 } : { status: "reject", reason, seq: 1 };
      },
      onState: (fn: (s: unknown) => void) => { stateListener = fn; return () => undefined; },
      leave: async () => undefined,
    }) as never,
  } as never);
  const el = (id: string): FakeElement => parent.find(id) as FakeElement;
  const noteSends = (): typeof sent => sent.filter((s) => s.kind === "note-submit");
  return { handle, el, noteSends, snapshot: (s: unknown) => stateListener?.(s) };
}

describe("the synced shell submits the patient note (C41)", () => {
  it("in the note phase the control is visible and one click sends one note-submit with the shell's text", async () => {
    const { el, noteSends, snapshot } = await joined({ noteText: () => NOTE });
    snapshot({ ...SNAP, phase: "note", phaseRemainingS: 60 });
    expect(el("room-note-submit").hidden).toBe(false);
    expect(el("room-note-submit").disabled).toBe(false);
    expect(el("room-note-submit").textContent).toBe("Submit note");
    el("room-note-submit").click();
    await flush();
    expect(noteSends()).toEqual([{ kind: "note-submit", payload: { text: NOTE } }]);
  });

  it("outside the note phase the control is hidden and disabled, and a click sends nothing", async () => {
    const { el, noteSends, snapshot } = await joined({ noteText: () => NOTE });
    for (const phase of ["doorway", "encounter", "closed"]) {
      snapshot({ ...SNAP, phase });
      expect(el("room-note-submit").hidden).toBe(true);
      expect(el("room-note-submit").disabled).toBe(true);
      el("room-note-submit").click();
    }
    await flush();
    expect(noteSends()).toEqual([]);
    expect(el("room-refusal").textContent).toBe("");
  });

  it("the accepted line reads N from the snapshot noteChars, not from the local text, and only while submitted", async () => {
    const { el, snapshot } = await joined({ noteText: () => NOTE });
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    expect(el("room-note-status").textContent).toBe("");
    snapshot({ ...SNAP, phase: "note", noteStatus: "submitted", noteChars: 7 });
    expect(el("room-note-status").textContent).toBe("Note accepted, 7 characters");
    snapshot({ ...SNAP, phase: "closed", noteStatus: "submitted", noteChars: 9 });
    expect(el("room-note-status").textContent).toBe("Note accepted, 9 characters");
  });

  it("a rejected submit shows the server reason in #room-refusal and no accepted line", async () => {
    const { el, snapshot } = await joined({ noteText: () => "", rejectWhen: () => "invalid-note" });
    snapshot({ ...SNAP, phase: "note" });
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).toBe("Not accepted: invalid-note");
    expect(el("room-note-status").textContent).toBe("");
  });

  it("a reject stays on screen across later snapshots until a note submit is accepted (C42)", async () => {
    let reject: string | undefined = "invalid-note";
    const { el, snapshot } = await joined({ noteText: () => "", rejectWhen: () => reject });
    snapshot({ ...SNAP, phase: "note", noteStatus: "submitted", noteChars: 5 });
    el("room-note-submit").click();
    await flush();
    snapshot({ ...SNAP, phase: "note", noteStatus: "submitted", noteChars: 8 });
    expect(el("room-refusal").textContent).toBe("Not accepted: invalid-note");
    reject = undefined;
    el("room-note-submit").click();
    await flush();
    expect(el("room-refusal").textContent).toBe("");
  });

  it("without a noteText dep the panel mounts no note control", async () => {
    const { el, snapshot } = await joined();
    snapshot({ ...SNAP, phase: "note" });
    expect(el("room-note-submit")).toBeUndefined();
  });
});
