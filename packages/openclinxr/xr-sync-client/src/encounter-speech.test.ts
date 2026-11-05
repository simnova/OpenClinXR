import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C29 RED: recognized speech goes through the room connection as select-actor, utterance-start,
// utterance-end{text, modality:'speech', confidence}; evidence.speechUtterances records length, confidence and statuses, never the text.
// With the utterance box mounted, an element #learner-caption shows what the learner said (typed: 'You said: <text>',
// speech: 'You said (<confidence to 2 dp>): <text>').
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


describe("learner speech over the room (C29)", () => {
  it("sends select-actor, utterance-start, utterance-end{text, modality, confidence} in order", async () => {
    const { sent, evidence } = await joined();
    await evidence.sendSpeech?.("p", "how far can you bend it", 0.71);
    expect(sent).toEqual([["select-actor", { actorId: "p" }], ["utterance-start", {}], ["utterance-end", { text: "how far can you bend it", modality: "speech", confidence: 0.71 }]]);
  });
  it("records length, confidence and statuses on the evidence, never the text, and leaves typed utterances alone", async () => {
    const { evidence } = await joined();
    await evidence.sendSpeech?.("p", "how far can you bend it", 0.71);
    expect(evidence.speechUtterances).toEqual([{ actorId: "p", chars: 23, confidence: 0.71, statuses: ["ack", "ack", "ack"] }]);
    expect(JSON.stringify(evidence.speechUtterances)).not.toContain("bend");
    expect(evidence.utterances).toEqual([]);
  });
  it("sends nothing for blank text, no actor, or a confidence outside [0,1] / not finite", async () => {
    const { sent, evidence } = await joined();
    await evidence.sendSpeech?.("p", "   ", 0.5);
    await evidence.sendSpeech?.(undefined, "hello", 0.5);
    for (const confidence of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) await evidence.sendSpeech?.("p", "hello", confidence);
    expect(sent).toEqual([]);
    expect(evidence.speechUtterances).toEqual([]);
  });
  it("serializes with trace actions and typed text", async () => {
    const { sent, handle } = await joined();
    await Promise.all([handle?.sendTraceAction("p", "t1"), handle?.sendSpeech("q", "hello", 0.9), handle?.sendUtterance("p", "again")]);
    expect(sent.map(([kind]) => kind)).toEqual(["select-actor", "utterance-start", "utterance-end", "select-actor", "utterance-start", "utterance-end", "select-actor", "utterance-start", "utterance-end"]);
  });
  it("the learner caption shows the recognized text with its confidence, and typed text without one", async () => {
    const { evidence, parent } = await joined(true);
    const caption = parent.find("learner-caption");
    expect(caption).toBeDefined();
    await evidence.sendSpeech?.("p", "how far can you bend it", 0.714);
    expect(caption?.textContent).toBe("You said (0.71): how far can you bend it");
    const input = parent.find("utterance-input");
    if (input) input.value = "hello doctor";
    parent.find("utterance-send")?.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(caption?.textContent).toBe("You said: hello doctor");
  });
});
