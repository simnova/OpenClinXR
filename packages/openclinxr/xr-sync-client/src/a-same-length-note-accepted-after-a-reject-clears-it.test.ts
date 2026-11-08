import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C42 RED: in the note phase the room panel offers "Submit note", which sends one note-submit {text} with the shell's note text.
//   An accepted note submit (the ack of that note-submit intent) clears an earlier note reject, including a resubmit of the same length.
//   A reject after an accept stays on screen across identical snapshots; an encounter-phase topic refusal is not cleared by note handling.
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

async function joined(options: { noteText?: () => string; rejectWhen?: (text: string) => string | undefined; rejectKind?: { kind: string; reason: string } } = {}) {
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
        const reason = options.rejectKind !== undefined && kind === options.rejectKind.kind ? options.rejectKind.reason : kind === "note-submit" ? options.rejectWhen?.(String(payload["text"] ?? "")) : undefined;
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


const ACCEPTED = (n: number) => `Note accepted, ${n} characters`;

describe("an accepted note clears the earlier note reject on every submit (C42)", () => {
  it("empty reject -> NOTE accept -> empty reject -> same NOTE accept leaves #room-refusal empty", async () => {
    let text = "";
    const { el, snapshot } = await joined({ noteText: () => text, rejectWhen: (t) => (t === "" ? "invalid-note" : undefined) });
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    const submit = async (): Promise<void> => { el("room-note-submit").click(); await flush(); };
    await submit();
    expect(el("room-refusal").textContent).toBe("Not accepted: invalid-note");
    text = NOTE;
    await submit();
    snapshot({ ...SNAP, phase: "note", noteStatus: "submitted", noteChars: NOTE.length });
    expect(el("room-refusal").textContent).toBe("");
    expect(el("room-note-status").textContent).toBe(ACCEPTED(NOTE.length));
    text = "";
    await submit();
    expect(el("room-refusal").textContent).toBe("Not accepted: invalid-note");
    snapshot({ ...SNAP, phase: "note", noteStatus: "submitted", noteChars: NOTE.length });
    expect(el("room-refusal").textContent).toBe("Not accepted: invalid-note");
    text = NOTE;
    await submit();
    snapshot({ ...SNAP, phase: "note", noteStatus: "submitted", noteChars: NOTE.length });
    expect(el("room-refusal").textContent).toBe("");
    expect(el("room-note-status").textContent).toBe(ACCEPTED(NOTE.length));
  });

  it("a snapshot whose note length changes does not clear a reject without an accepted submit", async () => {
    const { el, snapshot } = await joined({ noteText: () => "", rejectWhen: () => "invalid-note" });
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    el("room-note-submit").click();
    await flush();
    snapshot({ ...SNAP, phase: "note", noteStatus: "submitted", noteChars: 8 });
    expect(el("room-refusal").textContent).toBe("Not accepted: invalid-note");
  });

  it("N in the accepted line comes from the snapshot noteChars, not the local text", async () => {
    const { el, snapshot } = await joined({ noteText: () => NOTE });
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    el("room-note-submit").click();
    await flush();
    snapshot({ ...SNAP, phase: "note", noteStatus: "submitted", noteChars: 11 });
    expect(el("room-note-status").textContent).toBe(ACCEPTED(11));
  });

  it("a topic refusal from another intent is not cleared by an accepted note", async () => {
    const { el, snapshot, handle } = await joined({ noteText: () => NOTE, rejectKind: { kind: "utterance-end", reason: "bad-topic" } });
    snapshot({ ...SNAP, phase: "note", noteStatus: "none", noteChars: 0 });
    await handle?.sendIntent("utterance-end", { topicTag: "x" });
    expect(el("room-refusal").textContent).toBe("Not accepted: bad-topic");
    el("room-note-submit").click();
    await flush();
    snapshot({ ...SNAP, phase: "note", noteStatus: "submitted", noteChars: NOTE.length });
    expect(el("room-refusal").textContent).toBe("Not accepted: bad-topic");
  });
});
