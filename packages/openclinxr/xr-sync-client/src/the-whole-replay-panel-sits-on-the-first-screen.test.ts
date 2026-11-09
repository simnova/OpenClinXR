import { describe, expect, it } from "vitest";
import { startEncounterSyncFromUrl } from "./headset.js";

// C49 RED client: in a replayed station the read-only panel (chips + its Replay label) is the FIRST child of the shell column
// that holds the replay anchor, above the doorway header. At 800x600 the column starts under a 336 px canvas, so any slot lower
// than first pushes the panel across the 600 px fold (C48 measured panel 561.69..654.69). The DOM can pin order and classes only;
// the geometry (panel bottom <= 600, footer links off every chip) is read off the live DOM by jobs/c49-capture.mjs.
// A live room still appends its panel after the existing children; every on-menu chip stays visible and unstyled.
class FakeElement {
  id = ""; value = ""; type = ""; placeholder = ""; disabled = false; hidden = false;
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  private text: string | null = "";
  constructor(readonly tag: string, id = "") { this.id = id; }
  get firstChild(): FakeElement | null { return this.children[0] ?? null; }
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
const TAGS = ["history_opqrst", "risk_factor_question", "vitals_review", "ecg_request", "urgent_escalation"];
const SNAP = {
  serverTick: 1, phase: "encounter", phaseRemainingS: 100, turnId: 0, turnOwner: "none", learners: {},
  actors: { p: { id: "p", displayName: "Robert Hayes", role: "patient" } },
  topicMenu: TAGS.map((tag) => ({ tag, label: `label for ${tag}`, labelSource: "seed-phrase", note: "", asked: tag === "urgent_escalation" })),
};
const REPLAY = "?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a";
const LIVE = "?encounterSync=ws://127.0.0.1:9";

async function joined(search: string, withAnchor: boolean) {
  const parent = new FakeElement("section");
  parent.appendChild(new FakeElement("h2", "dialogue-title"));
  parent.appendChild(new FakeElement("p", "dialogue-line"));
  const shellColumn = new FakeElement("aside");
  shellColumn.appendChild(new FakeElement("header", "doorway-header"));
  shellColumn.appendChild(new FakeElement("div", "timer-row"));
  const anchor = shellColumn.appendChild(new FakeElement("section", "ehr-panel"));
  shellColumn.appendChild(parent);
  let stateListener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => Date.now(),
    utteranceBox: { doc: fakeDoc, parent, ...(withAnchor ? { replayAnchor: anchor } : {}) },
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async () => ({ status: "ack", seq: 1, serverTs: 0, rttMs: 1 }),
      onState: (fn: (s: unknown) => void) => { stateListener = fn; return () => undefined; },
      leave: async () => undefined,
    }) as never,
  } as never);
  const snapshot = async (s: unknown) => { stateListener?.(s); await flush(); };
  return { parent, shellColumn, snapshot };
}

describe("the whole replay panel sits on the first screen (C49)", () => {
  it("with an anchor the replay panel is the first child of the anchor's column, above the doorway header", async () => {
    const shell = await joined(REPLAY, true);
    await shell.snapshot(SNAP);
    expect(shell.shellColumn.children.map((c) => c.id)).toEqual(["room-panel", "doorway-header", "timer-row", "ehr-panel", ""]);
    expect(shell.parent.find("room-panel")).toBeUndefined();
  });

  it("without an anchor the replay panel is still the first child of the box parent", async () => {
    const shell = await joined(REPLAY, false);
    await shell.snapshot(SNAP);
    expect(shell.parent.children.map((c) => c.id)).toEqual(["room-panel", "dialogue-title", "dialogue-line"]);
  });

  it("every on-menu chip is in the panel, visible and unstyled, and the Replay label is inside the panel", async () => {
    const shell = await joined(REPLAY, true);
    await shell.snapshot(SNAP);
    const panel = shell.shellColumn.find("room-panel");
    const chips = TAGS.map((tag) => panel?.find(`topic-${tag}`));
    expect(chips.every((chip) => chip !== undefined)).toBe(true);
    for (const chip of chips) {
      expect(chip?.hidden).toBe(false);
      expect(chip?.style["display"]).toBeUndefined();
      expect(chip?.style["fontSize"]).toBeUndefined();
    }
    expect(panel?.find("room-countdown")?.textContent).toBe("Replay");
    expect(panel?.find("room-countdown")?.attributes.get("class")).toBe("label");
  });

  it("a live room appends its panel after the existing children, even with an anchor", async () => {
    const shell = await joined(LIVE, true);
    await shell.snapshot(SNAP);
    expect(shell.parent.children.slice(0, 3).map((c) => c.id)).toEqual(["dialogue-title", "dialogue-line", "room-panel"]);
    expect(shell.shellColumn.children.map((c) => c.id)).not.toContain("room-panel");
  });
});
