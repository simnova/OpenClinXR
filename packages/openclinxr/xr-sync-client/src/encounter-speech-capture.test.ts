import { describe, expect, it } from "vitest";
import { downsampleToPcm16, pcmRms, type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C33 RED: the learner speaks into the headset. Contract (names are the spec):
//   headset.ts exports downsampleToPcm16(chunks: Float32Array[], sourceRate: number): Int16Array  (16 kHz mono, linear resample by
//     averaging, clamp to [-1,1], round to int16) and pcmRms(pcm: Int16Array): number (0..1, root mean square of pcm/32768).
//   StartEncounterSyncDeps.speech?: { recorder?: SpeechRecorder; xrSession?: () => XrSessionLike | null | undefined; inject?: boolean }
//     SpeechRecorder = { start(): Promise<void>; stop(): Promise<{ chunks: Float32Array[]; sampleRate: number }> }.
//   With deps.utteranceBox and deps.speech: #speak-button ("Hold to speak") and #speech-status are mounted. pointerdown on the button
//   = press (recorder.start, status "Listening..."), pointerup / pointercancel = release (recorder.stop, status "Recognizing...").
//   XR input: when xrSession() returns a session, squeezestart / squeezeend on it are press / release (sessions are polled; a new
//   session object is attached once).
//   Release -> pcm via downsampleToPcm16 -> sendIntent("speech-audio", { pcm: Uint8Array, sampleRate: 16000 }) -> ack.transcript ->
//   the C29 path (evidence.sendSpeech: select-actor, utterance-start, utterance-end{text, modality:"speech", confidence}) -> caption
//   "You said (0.xx): text". Under 0.1 s of audio nothing is sent (status "too-short"). A reject sends nothing further.
//   evidence.speech = { captures: Array<{ source: "microphone"|"injected"; status: string; samples: number; rms: number;
//     releaseToCaptionMs: number; chars: number; confidence: number }> } — never text, never audio. releaseToCaptionMs = nowMs at caption - nowMs at release.
//   Statuses: "ok", "too-short", "empty" (blank transcript: nothing sent), "failed:<reject reason or mic error message>".
type Sent = [string, unknown];
type Handler = (event: { preventDefault?: () => void }) => void;
class FakeElement {
  id = ""; value = ""; textContent: string | null = ""; type = ""; placeholder = ""; disabled = false; hidden = false;
  children: FakeElement[] = [];
  handlers = new Map<string, Handler[]>();
  constructor(readonly tag: string) {}
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  addEventListener(type: string, fn: Handler): void { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  fire(type: string): void { for (const fn of this.handlers.get(type) ?? []) fn({ preventDefault: () => undefined }); }
  find(id: string): FakeElement | undefined { return this.id === id ? this : this.children.map((child) => child.find(id)).find((found) => found !== undefined); }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };
const tone = (n: number, rate: number, amp = 0.5): Float32Array => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / rate));

async function joined(opts: { transcript?: { text: string; confidence: number } | "reject"; seconds?: number; mic?: "ok" | Error } = {}) {
  const sent: Sent[] = [];
  const published: EncounterSyncEvidence[] = [];
  const parent = new FakeElement("div");
  let now = 1000;
  const starts: number[] = [];
  const recorder = {
    start: async () => { if (opts.mic instanceof Error) throw opts.mic; starts.push(now); },
    stop: async () => ({ chunks: [tone(Math.round(48000 * (opts.seconds ?? 1)), 48000)], sampleRate: 48000 }),
  };
  const listeners = new Map<string, Array<() => void>>();
  const session = { addEventListener: (type: string, fn: () => void) => { listeners.set(type, [...(listeners.get(type) ?? []), fn]); } };
  const handle = await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["p", "q"],
    register: () => undefined,
    play: () => undefined,
    publish: (evidence: EncounterSyncEvidence) => { published.push(evidence); },
    nowMs: () => now,
    utteranceBox: { doc: fakeDoc, parent },
    speech: { recorder, xrSession: () => session },
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async (kind: string, payload?: unknown) => {
        sent.push([kind, payload]);
        if (kind === "speech-audio") {
          now += 420;
          return opts.transcript === "reject" ? { status: "reject", seq: 1, reason: "speech-recognizer-unavailable", rttMs: 1 } : { status: "ack", seq: 1, serverTs: 0, rttMs: 1, transcript: opts.transcript ?? { text: "when did the pain start", confidence: 0.8 } };
        }
        return { status: "ack", seq: sent.length, serverTs: 0, rttMs: 1 };
      },
      onState: () => () => undefined,
      leave: async () => undefined,
    }) as never,
  } as never);
  const button = parent.find("speak-button");
  const press = async () => { button?.fire("pointerdown"); await Promise.resolve(); };
  const release = async () => { button?.fire("pointerup"); await new Promise((r) => setTimeout(r, 20)); };
  return { sent, evidence: published[0] as EncounterSyncEvidence, handle, parent, press, release, starts, listeners, tick: (ms: number) => { now += ms; } };
}

describe("pcm helpers (C33)", () => {
  it("downsamples 48 kHz float chunks to 16 kHz int16", () => {
    const pcm = downsampleToPcm16([tone(24000, 48000), tone(24000, 48000)], 48000);
    expect(pcm.length).toBe(16000);
    expect(Math.max(...pcm)).toBeGreaterThan(10000);
    expect(Math.max(...pcm)).toBeLessThanOrEqual(32767);
  });
  it("clamps out-of-range samples and passes 16 kHz through unchanged in length", () => {
    const pcm = downsampleToPcm16([Float32Array.from([2, -2, 0.5, 0])], 16000);
    expect(Array.from(pcm)).toEqual([32767, -32768, 16384, 0]);
  });
  it("rms is 0 for silence and about 0.35 for a 0.5 amplitude tone", () => {
    expect(pcmRms(new Int16Array(100))).toBe(0);
    expect(pcmRms(downsampleToPcm16([tone(16000, 16000, 0.5)], 16000))).toBeCloseTo(0.354, 2);
  });
});

describe("learner speech capture over the room (C33)", () => {
  it("mounts a hold-to-speak button and status", async () => {
    const { parent } = await joined();
    expect(parent.find("speak-button")?.textContent).toBe("Hold to speak");
    expect(parent.find("speech-status")).toBeDefined();
  });
  it("press, release: audio goes to the room, the transcript goes through the C29 path, the caption shows it", async () => {
    const { sent, parent, press, release, evidence, tick } = await joined();
    await press();
    expect(parent.find("speech-status")?.textContent).toBe("Listening...");
    tick(900);
    await release();
    expect(sent.map((entry) => entry[0])).toEqual(["speech-audio", "select-actor", "utterance-start", "utterance-end"]);
    const audio = sent[0]?.[1] as { pcm: Uint8Array; sampleRate: number };
    expect(audio.sampleRate).toBe(16000);
    expect(audio.pcm).toBeInstanceOf(Uint8Array);
    expect(audio.pcm.byteLength).toBe(32000);
    expect(sent[3]?.[1]).toEqual({ text: "when did the pain start", modality: "speech", confidence: 0.8 });
    expect(parent.find("learner-caption")?.textContent).toBe("You said (0.80): when did the pain start");
    expect(evidence.speech?.captures).toEqual([expect.objectContaining({ source: "microphone", status: "ok", samples: 16000, chars: 23, confidence: 0.8, releaseToCaptionMs: 420 })]);
    expect(evidence.speech?.captures[0]?.rms).toBeCloseTo(0.354, 1);
    expect(JSON.stringify(evidence.speech)).not.toContain("pain start");
  });
  it("under 0.1 s of audio sends nothing", async () => {
    const { sent, press, release, evidence } = await joined({ seconds: 0.05 });
    await press();
    await release();
    expect(sent).toEqual([]);
    expect(evidence.speech?.captures[0]?.status).toBe("too-short");
  });
  it("a blank transcript sends no utterance; a reject records the reason and sends nothing further", async () => {
    const blank = await joined({ transcript: { text: "  ", confidence: 0.2 } });
    await blank.press();
    await blank.release();
    expect(blank.sent.map((entry) => entry[0])).toEqual(["speech-audio"]);
    expect(blank.evidence.speech?.captures[0]?.status).toBe("empty");
    const rejected = await joined({ transcript: "reject" });
    await rejected.press();
    await rejected.release();
    expect(rejected.sent.map((entry) => entry[0])).toEqual(["speech-audio"]);
    expect(rejected.evidence.speech?.captures[0]?.status).toBe("failed:speech-recognizer-unavailable");
  });
  it("a denied microphone records the error and sends nothing", async () => {
    const { sent, press, release, evidence } = await joined({ mic: new Error("NotAllowedError") });
    await press();
    await release();
    expect(sent).toEqual([]);
    expect(evidence.speech?.captures[0]?.status).toBe("failed:NotAllowedError");
  });
  it("XR squeezestart / squeezeend act as press / release", async () => {
    const { sent, listeners, starts } = await joined();
    await new Promise((r) => setTimeout(r, 700));
    for (const fn of listeners.get("squeezestart") ?? []) fn();
    await Promise.resolve();
    expect(starts.length).toBe(1);
    for (const fn of listeners.get("squeezeend") ?? []) fn();
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.map((entry) => entry[0])).toEqual(["speech-audio", "select-actor", "utterance-start", "utterance-end"]);
  });
});
