import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C37 RED client clause 5: the panel renders the server's topic menu as buttons.
//   #room-topics holds one <button> per snapshot topicMenu entry {tag, label, labelSource, note, asked}, in snapshot order.
//   Button textContent === entry.label. Button attribute data-asked === String(entry.asked), taken only from the latest snapshot
//   (a snapshot saying asked:true for a tag the client never sent renders "true"; a later snapshot saying false renders "false").
//   A click calls sendTraceAction(actorId, entry.tag) once (one entry in handle.intents, one utterance-end{topicTag}); a click
//   never changes data-asked. An empty or absent menu renders no buttons. The actor is picked as the typed box picks it.
type Handler = (event: { preventDefault?: () => void }) => void;
class FakeElement {
  id = ""; value = ""; type = ""; placeholder = ""; disabled = false; hidden = false;
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  handlers = new Map<string, Handler[]>();
  private text: string | null = "";
  constructor(readonly tag: string) {}
  get textContent(): string | null { return this.text; }
  // DOM semantics: assigning textContent replaces all children.
  set textContent(value: string | null) { this.text = value; this.children = []; }
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(type: string, fn: Handler): void { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  click(): void { for (const fn of this.handlers.get("click") ?? []) fn({}); }
  find(id: string): FakeElement | undefined { return this.id === id ? this : this.children.map((child) => child.find(id)).find((found) => found !== undefined); }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
type MenuEntry = { tag: string; label: string; labelSource: string; note: string; asked: boolean };
const entry = (tag: string, label: string, labelSource: string, asked = false): MenuEntry => ({ tag, label, labelSource, note: "", asked });
const MENU = [
  entry("history_opqrst", "when did the chest pressure start", "seed-phrase"),
  entry("ecg_request", "ecg_request", "tag"),
  entry("empathy_statement", "i can see you are worried", "seed-phrase"),
];
const SNAP = {
  serverTick: 1, phase: "encounter", phaseRemainingS: 100, turnId: 0, turnOwner: "none", learners: {},
  actors: { p: { id: "p", displayName: "Robert Hayes", role: "patient" } },
  topicMenu: MENU,
};

async function joined() {
  const parent = new FakeElement("div");
  const published: EncounterSyncEvidence[] = [];
  const sent: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  let stateListener: ((s: unknown) => void) | undefined;
  const handle = await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: (e: EncounterSyncEvidence) => { published.push(e); },
    nowMs: () => Date.now(),
    utteranceBox: { doc: fakeDoc, parent },
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async (kind: string, payload: Record<string, unknown>) => { sent.push({ kind, payload }); return { status: "ack", seq: 1, serverTs: 0, rttMs: 1 }; },
      onState: (fn: (s: unknown) => void) => { stateListener = fn; return () => undefined; },
      leave: async () => undefined,
    }) as never,
  } as never);
  const topics = (): FakeElement[] => (parent.find("room-topics") as FakeElement).children;
  return { parent, handle, sent, topics, snapshot: (s: unknown) => stateListener?.(s) };
}

describe("room panel topic buttons (C37)", () => {
  it("renders one button per menu entry with the server label and the snapshot's asked flag", async () => {
    const { topics, snapshot } = await joined();
    snapshot(SNAP);
    expect(topics().map((button) => button.tag)).toEqual(["button", "button", "button"]);
    expect(topics().map((button) => button.textContent)).toEqual(MENU.map((item) => item.label));
    expect(topics().map((button) => button.attributes.get("data-asked"))).toEqual(["false", "false", "false"]);
  });

  it("data-asked follows the snapshot only: asked:true for a tag never sent renders true, and a later false renders false", async () => {
    const { topics, snapshot, handle } = await joined();
    snapshot({ ...SNAP, topicMenu: [MENU[0], { ...MENU[1], asked: true }, MENU[2]] });
    expect(topics().map((button) => button.attributes.get("data-asked"))).toEqual(["false", "true", "false"]);
    expect(handle?.intents.length).toBe(0);
    await (async () => { topics()[0]?.click(); await flush(); })();
    expect(topics().map((button) => button.attributes.get("data-asked"))).toEqual(["false", "true", "false"]);
    snapshot({ ...SNAP, topicMenu: [MENU[0], MENU[1], MENU[2]] });
    expect(topics().map((button) => button.attributes.get("data-asked"))).toEqual(["false", "false", "false"]);
  });

  it("a click sends the trace action for that entry's tag exactly once", async () => {
    const { topics, snapshot, handle, sent } = await joined();
    snapshot(SNAP);
    topics()[1]?.click();
    await flush();
    expect(handle?.intents).toEqual([expect.objectContaining({ actorId: "p", topicTag: "ecg_request" })]);
    expect(sent.filter((item) => item.kind === "utterance-end")).toEqual([{ kind: "utterance-end", payload: { topicTag: "ecg_request" } }]);
    snapshot(SNAP);
    topics()[1]?.click();
    await flush();
    expect(handle?.intents.length).toBe(2);
  });

  it("a menu change rebuilds the buttons; an unchanged menu keeps the same button elements", async () => {
    const { topics, snapshot } = await joined();
    snapshot(SNAP);
    const first = topics();
    snapshot({ ...SNAP, serverTick: 2, topicMenu: [MENU[0], MENU[1], { ...MENU[2], asked: true }] });
    expect(topics()).toEqual(first);
    expect(topics()[2]?.attributes.get("data-asked")).toBe("true");
    snapshot({ ...SNAP, serverTick: 3, topicMenu: [MENU[1]] });
    expect(topics().map((button) => button.textContent)).toEqual(["ecg_request"]);
  });

  it("known-good: an empty or absent menu renders no buttons", async () => {
    const { topics, snapshot } = await joined();
    snapshot({ ...SNAP, topicMenu: [] });
    expect(topics()).toEqual([]);
    snapshot({ serverTick: 2, phase: "", turnId: 0, turnOwner: "none", learners: {}, actors: {} });
    expect(topics()).toEqual([]);
  });
});
