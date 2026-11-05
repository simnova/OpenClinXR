import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C28 RED: the typed-utterance box addresses the actor the learner is looking at (else the one who spoke last,
// else the one addressed last, else the first cast actor); Enter submits like the button.
type Handler = (event: { key?: string; isComposing?: boolean; shiftKey?: boolean; preventDefault?: () => void; stopPropagation?: () => void }) => void;
class FakeElement {
  id = ""; value = ""; textContent: string | null = ""; type = ""; placeholder = "";
  children: FakeElement[] = [];
  handlers = new Map<string, Handler[]>();
  constructor(readonly tag: string) {}
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  addEventListener(type: string, fn: Handler): void { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  fire(type: string, event: Parameters<Handler>[0] = {}): void { for (const fn of this.handlers.get(type) ?? []) fn({ preventDefault: () => undefined, stopPropagation: () => undefined, ...event }); }
  find(id: string): FakeElement | undefined { return this.id === id ? this : this.children.map((child) => child.find(id)).find((found) => found !== undefined); }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const actorState = (over: Record<string, unknown> = {}) => ({ id: "a", speaking: false, emotion: "anxious", replyId: "r", cueId: "", caption: "hi", ...over });

type View = { eye: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number }; actors: Array<{ actorId: string; x: number; y: number; z: number }> };
async function joined(gaze?: () => View | undefined) {
  const sent: Array<[string, unknown]> = [];
  const listeners: Array<(snapshot: unknown) => void> = [];
  const published: EncounterSyncEvidence[] = [];
  const parent = new FakeElement("div");
  await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["p", "q", "r"],
    register: () => undefined,
    play: () => undefined,
    publish: (evidence: EncounterSyncEvidence) => { published.push(evidence); },
    nowMs: () => 1,
    ...(gaze === undefined ? {} : { gazeView: gaze }),
    utteranceBox: { doc: { createElement: (tag: string) => new FakeElement(tag) }, parent },
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async (kind: string, payload?: unknown) => { sent.push([kind, payload]); return { status: "ack", seq: sent.length, serverTs: 0, rttMs: 1 }; },
      onState: (cb: (snapshot: unknown) => void) => { listeners.push(cb); return () => undefined; },
      leave: async () => undefined,
    }) as never,
  } as never);
  return { sent, listeners, parent, evidence: published[0] as EncounterSyncEvidence, input: parent.find("utterance-input")!, button: parent.find("utterance-send")! };
}

const ACTORS = [{ actorId: "p", x: 0, y: 1.5, z: -2 }, { actorId: "q", x: 2, y: 1.5, z: -2 }, { actorId: "r", x: -3, y: 1.5, z: 3 }];
const view = (forward: { x: number; y: number; z: number }): View => ({ eye: { x: 0, y: 1.6, z: 0 }, forward, actors: ACTORS });

describe("addressed actor and Enter (C28)", () => {
  it("Enter in the input sends the typed text and clears it; other keys, Shift+Enter and IME composition do not", async () => {
    const { sent, input } = await joined();
    input.value = "how far can you bend it";
    input.fire("keydown", { key: "a" });
    input.fire("keydown", { key: "Enter", shiftKey: true });
    input.fire("keydown", { key: "Enter", isComposing: true });
    await tick();
    expect(sent).toEqual([]);
    input.fire("keydown", { key: "Enter" });
    await tick();
    expect(sent.at(-1)).toEqual(["utterance-end", { text: "how far can you bend it" }]);
    expect(input.value).toBe("");
  });

  it("keydown in the box does not reach the shell's own key handlers", async () => {
    const { input } = await joined();
    let stopped = 0;
    input.fire("keydown", { key: "e", stopPropagation: () => { stopped += 1; } });
    expect(stopped).toBe(1);
  });

  it("the box addresses the gazed actor", async () => {
    const { sent, input, button } = await joined(() => view({ x: 2, y: 0, z: -1 }));
    input.value = "hello";
    button.fire("click");
    await tick();
    expect(sent[0]).toEqual(["select-actor", { actorId: "q" }]);
  });

  it("with no gaze, the box addresses the actor who spoke last; before any speech, the first cast actor", async () => {
    const { sent, listeners, input, button } = await joined();
    input.value = "one";
    button.fire("click");
    await tick();
    expect(sent[0]).toEqual(["select-actor", { actorId: "p" }]);
    for (const listener of listeners) listener({ serverTick: 1, phase: "encounter", turnId: 1, turnOwner: "actor", actors: { r: actorState({ speaking: true }) }, learners: {}, stationId: "slot-a" });
    input.value = "two";
    button.fire("click");
    await tick();
    expect(sent.filter(([kind]) => kind === "select-actor").map(([, payload]) => payload)).toEqual([{ actorId: "p" }, { actorId: "r" }]);
  });
});

describe("gaze rule through the box", () => {
  const send = async (gaze: () => View | undefined, speakerFirst?: string) => {
    const { sent, listeners, input, button, evidence } = await joined(gaze);
    if (speakerFirst !== undefined) for (const listener of listeners) listener({ serverTick: 1, phase: "encounter", turnId: 1, turnOwner: "actor", actors: { [speakerFirst]: actorState({ speaking: true }) }, learners: {}, stationId: "slot-a" });
    input.value = "hello";
    button.fire("click");
    await tick();
    return { addressed: (sent.find(([kind]) => kind === "select-actor")?.[1] as { actorId: string } | undefined)?.actorId, gazed: evidence.gazedActorId?.() };
  };
  it("names the actor nearest the view axis inside the 30 degree cone", async () => {
    expect((await send(() => view({ x: 0, y: 0, z: -1 }))).addressed).toBe("p");
    expect((await send(() => view({ x: 0.707, y: 0, z: -0.707 }))).addressed).toBe("q");
  });
  it("falls through to the last speaker when nobody is in the cone, or the view axis has no length", async () => {
    expect(await send(() => view({ x: 1, y: 0, z: 0 }), "r")).toEqual({ addressed: "r", gazed: undefined });
    expect(await send(() => view({ x: 0, y: 0, z: 0 }), "r")).toEqual({ addressed: "r", gazed: undefined });
  });
  it("a gazed actor outside the cast is ignored", async () => {
    const result = await send(() => ({ ...view({ x: 0, y: 0, z: -1 }), actors: [{ actorId: "ghost", x: 0, y: 1.5, z: -2 }] }));
    expect(result.addressed).toBe("p");
  });
});
