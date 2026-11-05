import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C27 RED: a learner's typed text goes through the room connection as select-actor, utterance-start,
// utterance-end{text}; the evidence records lengths and statuses, never the text.
type Sent = [string, unknown];
type Handler = (event: { preventDefault?: () => void }) => void;
class FakeElement {
  id = "";
  value = "";
  textContent: string | null = "";
  type = "";
  placeholder = "";
  children: FakeElement[] = [];
  handlers = new Map<string, Handler[]>();
  constructor(readonly tag: string) {}
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  append(...children: FakeElement[]): void { this.children.push(...children); }
  addEventListener(type: string, fn: Handler): void { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  fire(type: string): void { for (const fn of this.handlers.get(type) ?? []) fn({ preventDefault: () => undefined }); }
  find(id: string): FakeElement | undefined { return this.id === id ? this : this.children.map((child) => child.find(id)).find((found) => found !== undefined); }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };

async function joined(withBox = false) {
  const sent: Sent[] = [];
  const published: EncounterSyncEvidence[] = [];
  const parent = new FakeElement("div");
  const handle = await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["p", "q"],
    register: () => undefined,
    play: () => undefined,
    publish: (evidence: EncounterSyncEvidence) => { published.push(evidence); },
    nowMs: () => 1,
    ...(withBox ? { utteranceBox: { doc: fakeDoc, parent } } : {}),
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async (kind: string, payload?: unknown) => { sent.push([kind, payload]); return { status: "ack", seq: sent.length, serverTs: 0, rttMs: 1 }; },
      onState: () => () => undefined,
      leave: async () => undefined,
    }) as never,
  } as never);
  return { sent, evidence: published[0] as EncounterSyncEvidence, handle, parent };
}

describe("learner free text over the room (C27)", () => {
  it("sends select-actor, utterance-start, utterance-end{text} in order", async () => {
    const { sent, evidence } = await joined();
    await evidence.sendUtterance?.("p", "how far can you bend it");
    expect(sent).toEqual([["select-actor", { actorId: "p" }], ["utterance-start", {}], ["utterance-end", { text: "how far can you bend it" }]]);
  });
  it("records statuses and the text length on the evidence, never the text", async () => {
    const { evidence } = await joined();
    await evidence.sendUtterance?.("p", "how far can you bend it");
    expect(evidence.utterances).toEqual([{ actorId: "p", chars: 23, statuses: ["ack", "ack", "ack"] }]);
    expect(JSON.stringify(evidence.utterances)).not.toContain("bend");
  });
  it("sends nothing for blank text or no actor", async () => {
    const { sent, evidence } = await joined();
    await evidence.sendUtterance?.("p", "   ");
    await evidence.sendUtterance?.(undefined, "hello");
    expect(sent).toEqual([]);
    expect(evidence.utterances).toEqual([]);
  });
  it("serializes with trace actions: text waits for the open action's three intents", async () => {
    const { sent, handle } = await joined();
    await Promise.all([handle?.sendTraceAction("p", "t1"), handle?.sendUtterance("q", "hello")]);
    expect(sent.map(([kind]) => kind)).toEqual(["select-actor", "utterance-start", "utterance-end", "select-actor", "utterance-start", "utterance-end"]);
    expect(sent[2]?.[1]).toEqual({ topicTag: "t1" });
    expect(sent[5]?.[1]).toEqual({ text: "hello" });
  });
  it("mounts an input and a send button that send the typed text to the first cast actor, then clear the input", async () => {
    const { sent, evidence, parent } = await joined(true);
    const input = parent.find("utterance-input");
    const button = parent.find("utterance-send");
    expect(input).toBeDefined();
    expect(button).toBeDefined();
    if (input === undefined || button === undefined) return;
    input.value = "  how far can you bend it  ";
    button.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.at(-1)).toEqual(["utterance-end", { text: "how far can you bend it" }]);
    expect(sent[0]).toEqual(["select-actor", { actorId: "p" }]);
    expect(input.value).toBe("");
    expect(evidence.utterances).toHaveLength(1);
    button.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(3);
  });
  it("mounts nothing without the box option", async () => {
    const { parent } = await joined(false);
    expect(parent.children).toEqual([]);
  });
});

describe("learner free text length cap (C27 grade defect)", () => {
  it("sends nothing for text over 500 characters, so no utterance is left open on the room", async () => {
    const { sent, evidence } = await joined();
    await evidence.sendUtterance?.("p", "x".repeat(501));
    expect(sent).toEqual([]);
    await evidence.sendUtterance?.("p", "x".repeat(500));
    expect(sent.map(([kind]) => kind)).toEqual(["select-actor", "utterance-start", "utterance-end"]);
  });
});
