import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C30 RED (part A): the shell shows a "please repeat" prompt when the server's turn carries intake "speech_low_confidence".
// Snapshot actors gain intake (string) and retries (number). With the utterance box mounted, #repeat-prompt exists from the start
// with empty text; on a low-confidence turn its text is "Please repeat that." (retries 1) or "Please repeat that. (attempt N)" (N > 1);
// any later actor turn with another intake clears it. evidence.repeatPrompts records { actorId, turnId, retries } per prompt (no text).

type Handler = (event: { preventDefault?: () => void }) => void;
class FakeElement {
  id = ""; value = ""; textContent: string | null = ""; type = ""; placeholder = "";
  children: FakeElement[] = [];
  handlers = new Map<string, Handler[]>();
  constructor(readonly tag: string) {}
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  addEventListener(type: string, fn: Handler): void { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  find(id: string): FakeElement | undefined { return this.id === id ? this : this.children.map((child) => child.find(id)).find((found) => found !== undefined); }
}
const actor = (over: Record<string, unknown> = {}) => ({ id: "a", speaking: true, emotion: "neutral", replyId: "c3-ack-onset", cueId: "", caption: "A: Sorry?", intake: "", retries: 0, ...over });
const snap = (turnId: number, a: ReturnType<typeof actor>) => ({ serverTick: turnId, phase: "encounter", turnId, turnOwner: "actor", actors: { a }, learners: {}, observerCount: 0, stationId: "slot-a", stationIndex: 0, stationCount: 1 });

async function rig() {
  let listener: (s: unknown) => void = () => undefined;
  const published: EncounterSyncEvidence[] = [];
  const parent = new FakeElement("div");
  await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["a"],
    register: (payload: Record<string, unknown>) => { const plan = payload["actorTurnPlan"] as { spokenText: string; dialogueEmotionTo: string }; return { caption: plan.spokenText, faceEmotion: plan.dialogueEmotionTo }; },
    play: () => undefined,
    publish: (e: EncounterSyncEvidence) => { published.push(e); },
    nowMs: () => 1,
    utteranceBox: { doc: { createElement: (tag: string) => new FakeElement(tag) }, parent },
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (cb: (s: unknown) => void) => { listener = cb; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  return { emit: (s: unknown) => listener(s), prompt: () => parent.find("repeat-prompt"), evidence: () => published[0] as unknown as { repeatPrompts: Array<Record<string, unknown>> } };
}

describe("please-repeat prompt (C30 part A)", () => {
  it("exists empty from the start, shows on low confidence with the attempt count, clears on the next ordinary turn", async () => {
    const r = await rig();
    expect(r.prompt()).toBeDefined();
    expect(r.prompt()?.textContent).toBe("");
    r.emit(snap(1, actor({ intake: "speech_low_confidence", retries: 1 })));
    expect(r.prompt()?.textContent).toBe("Please repeat that.");
    r.emit(snap(2, actor({ intake: "speech_low_confidence", retries: 2 })));
    expect(r.prompt()?.textContent).toBe("Please repeat that. (attempt 2)");
    r.emit(snap(3, actor({ intake: "history_opqrst", retries: 0 })));
    expect(r.prompt()?.textContent).toBe("");
    expect(r.evidence().repeatPrompts).toEqual([{ actorId: "a", turnId: 1, retries: 1 }, { actorId: "a", turnId: 2, retries: 2 }]);
  });
  it("counterweight: an unmatched typed answer or an old server without the fields never prompts", async () => {
    const r = await rig();
    r.emit(snap(1, actor({ intake: "utterance_unmatched", retries: 0 })));
    const old = actor();
    delete (old as Record<string, unknown>)["intake"];
    delete (old as Record<string, unknown>)["retries"];
    r.emit(snap(2, old));
    expect(r.prompt()?.textContent).toBe("");
    expect(r.evidence().repeatPrompts).toEqual([]);
  });
});
