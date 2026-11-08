import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C46 RED client: a replay shell (?encounterReplayStation=) shows the replayed station's topic chips read-only.
//   #room-topics holds one button per snapshot topicMenu entry, data-asked from the latest snapshot, every button disabled, and a click sends nothing.
//   A live shell is unchanged (chips enabled). No chips are drawn for an empty menu.
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

let SEARCH = "?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a";
async function joined() {
  const parent = new FakeElement("div");
  const published: EncounterSyncEvidence[] = [];
  const sent: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  let stateListener: ((s: unknown) => void) | undefined;
  const handle = await startEncounterSyncFromUrl({
    search: SEARCH,
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


describe("replay shell topic chips (C46)", () => {
  it("a replay shell mounts the panel and renders the replayed menu with asked flags", async () => {
    SEARCH = "?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a";
    const { parent, topics, snapshot } = await joined();
    snapshot({ ...SNAP, topicMenu: MENU.map((e) => ({ ...e, asked: e.tag !== "ecg_request" })) });
    await flush();
    expect(parent.find("room-panel")).toBeDefined();
    const got = topics().map((b) => [b.id, b.attributes.get("data-asked")]);
    console.log(`C46 client replay chips ${JSON.stringify(got)}`);
    expect(got).toEqual([["topic-history_opqrst", "true"], ["topic-ecg_request", "false"], ["topic-empathy_statement", "true"]]);
  });

  it("replay chips are disabled and a click sends nothing", async () => {
    SEARCH = "?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a";
    const { topics, sent, snapshot } = await joined();
    snapshot(SNAP);
    await flush();
    expect(topics().length).toBe(3);
    expect(topics().every((b) => b.disabled)).toBe(true);
    topics()[0]?.click();
    await flush();
    expect(sent).toEqual([]);
  });

  it("a live shell keeps enabled chips (unchanged)", async () => {
    SEARCH = "?encounterSync=ws://127.0.0.1:9";
    const { topics, snapshot } = await joined();
    snapshot(SNAP);
    await flush();
    expect(topics().length).toBe(3);
    expect(topics().every((b) => !b.disabled)).toBe(true);
  });

  it("an empty replay menu draws no chips", async () => {
    SEARCH = "?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a";
    const { parent, topics, snapshot } = await joined();
    snapshot({ ...SNAP, topicMenu: [] });
    await flush();
    expect(parent.find("room-panel")).toBeDefined();
    expect(topics().length).toBe(0);
  });
});
