import { describe, expect, it } from "vitest";
import { startEncounterSyncFromUrl } from "./headset.js";

// C48 RED client: a replayed station (?encounterReplayStation=)
//   (1) tells the shell it is a replay once, through onReplay (the shell has no second URL parse);
//   (2) labels its "Replay" countdown with the existing .label class;
//   (3) mounts its read-only panel at the top: first child of the box parent, or directly before the shell's replayAnchor.
// A live room fires no onReplay, keeps an unclassed countdown and appends its panel after the existing children (unchanged).
class FakeElement {
  id = ""; value = ""; type = ""; placeholder = ""; disabled = false; hidden = false;
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  private text: string | null = "";
  constructor(readonly tag: string, id = "") { this.id = id; }
  get textContent(): string | null { return this.text; }
  set textContent(value: string | null) { this.text = value; this.children = []; }
  appendChild(child: FakeElement): FakeElement { child.parentNode = this; this.children.push(child); return child; }
  prepend(child: FakeElement): void { child.parentNode = this; this.children.unshift(child); }
  insertBefore(child: FakeElement, ref: FakeElement): FakeElement { child.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, child); return child; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(): void {}
  find(id: string): FakeElement | undefined { return this.id === id ? this : this.children.map((child) => child.find(id)).find((found) => found !== undefined); }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const SNAP = {
  serverTick: 1, phase: "encounter", phaseRemainingS: 100, turnId: 0, turnOwner: "none", learners: {},
  actors: { p: { id: "p", displayName: "Robert Hayes", role: "patient" } },
  topicMenu: [{ tag: "history_opqrst", label: "when did the chest pressure start", labelSource: "seed-phrase", note: "", asked: false }],
};
const REPLAY = "?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a";
const LIVE = "?encounterSync=ws://127.0.0.1:9";

async function joined(search: string, withAnchor: boolean) {
  const parent = new FakeElement("section");
  parent.appendChild(new FakeElement("h2", "dialogue-title"));
  parent.appendChild(new FakeElement("p", "dialogue-line"));
  const shellColumn = new FakeElement("aside");
  const header = shellColumn.appendChild(new FakeElement("header", "doorway-header"));
  const timer = shellColumn.appendChild(new FakeElement("div", "timer-row"));
  const anchor = shellColumn.appendChild(new FakeElement("section", "ehr-panel"));
  let replaySignals = 0;
  let stateListener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => Date.now(),
    onReplay: () => { replaySignals += 1; },
    utteranceBox: { doc: fakeDoc, parent, ...(withAnchor ? { replayAnchor: anchor } : {}) },
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async () => ({ status: "ack", seq: 1, serverTs: 0, rttMs: 1 }),
      onState: (fn: (s: unknown) => void) => { stateListener = fn; return () => undefined; },
      leave: async () => undefined,
    }) as never,
  } as never);
  const snapshot = async (s: unknown) => { stateListener?.(s); await flush(); };
  return { parent, shellColumn, header, timer, anchor, snapshot, signals: () => replaySignals };
}

describe("a replayed station labels and places its panel (C48)", () => {
  it("fires onReplay exactly once across several snapshots", async () => {
    const shell = await joined(REPLAY, false);
    await shell.snapshot(SNAP);
    await shell.snapshot({ ...SNAP, serverTick: 2, phaseRemainingS: 90 });
    await shell.snapshot({ ...SNAP, serverTick: 3, phaseRemainingS: 80 });
    expect(shell.signals()).toBe(1);
  });

  it("the Replay countdown carries the label class", async () => {
    const shell = await joined(REPLAY, false);
    await shell.snapshot(SNAP);
    const countdown = shell.parent.find("room-countdown");
    expect(countdown?.textContent).toBe("Replay");
    expect(countdown?.attributes.get("class")).toBe("label");
  });

  it("without an anchor the replay panel is the first child of the box parent", async () => {
    const shell = await joined(REPLAY, false);
    await shell.snapshot(SNAP);
    expect(shell.parent.children.map((c) => c.id)).toEqual(["room-panel", "dialogue-title", "dialogue-line"]);
  });

  it("with an anchor the replay panel sits directly before it, not in the box parent", async () => {
    const shell = await joined(REPLAY, true);
    await shell.snapshot(SNAP);
    expect(shell.shellColumn.children.map((c) => c.id)).toEqual(["doorway-header", "timer-row", "room-panel", "ehr-panel"]);
    expect(shell.parent.find("room-panel")).toBeUndefined();
  });

  it("a live room signals no replay, keeps its countdown unclassed and its panel appended after the existing children, even with an anchor", async () => {
    const shell = await joined(LIVE, true);
    await shell.snapshot(SNAP);
    const countdown = shell.parent.find("room-countdown");
    expect(shell.signals()).toBe(0);
    expect(countdown?.textContent).toBe("Encounter: 100 s left");
    expect(countdown?.attributes.get("class")).toBeUndefined();
    expect(shell.parent.children.slice(0, 3).map((c) => c.id)).toEqual(["dialogue-title", "dialogue-line", "room-panel"]);
    expect(shell.shellColumn.find("room-panel")).toBeUndefined();
  });
});
