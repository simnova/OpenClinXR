import { describe, expect, it, vi } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

type SpeechRecorder = { start(): Promise<void>; stop(): Promise<{ chunks: Float32Array[]; sampleRate: number }> };

// C33 grade fixes: a press during recognition is ignored, a release racing a failed start records one failure,
// and a hold is released automatically before the server's 15 s bound.
class El {
  id = ""; textContent: string | null = ""; children: El[] = []; handlers = new Map<string, Array<() => void>>();
  appendChild(child: El): El { this.children.push(child); return child; }
  addEventListener(type: string, fn: () => void): void { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
}
const doc = { createElement: () => new El() };
const tone = (n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => 0.4 * Math.sin(i / 7));

async function mount(recorder: SpeechRecorder, sendAudio: () => Promise<{ status: string; reason?: string; transcript?: { text: string; confidence: number } }>) {
  const sent: string[] = [];
  const published: EncounterSyncEvidence[] = [];
  await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: (e: EncounterSyncEvidence) => { published.push(e); },
    nowMs: () => 1,
    utteranceBox: { doc: doc as never, parent: new El() as never },
    speech: { recorder },
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async (kind: string, payload?: unknown) => {
        if (kind === "speech-audio") return { seq: 1, rttMs: 1, serverTs: 0, ...(await sendAudio()) };
        if (kind === "utterance-end") sent.push((payload as { text: string }).text);
        return { status: "ack", seq: 2, serverTs: 0, rttMs: 1 };
      },
      onState: () => () => undefined,
      leave: async () => undefined,
    }) as never,
  } as never);
  return { evidence: published[0]!.speech!, sent };
}
const okRecorder = (starts: { n: number }): SpeechRecorder => ({ start: async () => { starts.n += 1; }, stop: async () => ({ chunks: [tone(16000)], sampleRate: 16000 }) });

describe("speech capture races (C33 grade)", () => {
  it("ignores a press while the previous utterance is being recognized", async () => {
    const starts = { n: 0 };
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const { evidence, sent } = await mount(okRecorder(starts), async () => { await gate; return { status: "ack", transcript: { text: "hello", confidence: 0.9 } }; });
    await evidence.press();
    const releasing = evidence.release();
    await new Promise((r) => setTimeout(r, 10));
    await evidence.press();
    expect(starts.n).toBe(1);
    finish();
    await releasing;
    expect(sent).toEqual(["hello"]);
    expect(evidence.captures.length).toBe(1);
  });
  it("a release racing a failed start records exactly one failure and does not stop the dead recorder", async () => {
    let stops = 0;
    let fail: (e: Error) => void = () => undefined;
    const recorder: SpeechRecorder = { start: () => new Promise<void>((_r, reject) => { fail = reject; }), stop: async () => { stops += 1; return { chunks: [], sampleRate: 16000 }; } };
    const { evidence } = await mount(recorder, async () => ({ status: "ack" }));
    const pressing = evidence.press();
    const releasing = evidence.release();
    fail(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await pressing;
    await releasing;
    expect(stops).toBe(0);
    expect(evidence.captures.map((c) => c.status)).toEqual(["failed:NotAllowedError"]);
  });
  it("releases automatically at 14 s of holding", async () => {
    vi.useFakeTimers();
    try {
      const starts = { n: 0 };
      const { evidence, sent } = await mount(okRecorder(starts), async () => ({ status: "ack", transcript: { text: "long", confidence: 0.8 } }));
      await evidence.press();
      await vi.advanceTimersByTimeAsync(14500);
      expect(sent).toEqual(["long"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
