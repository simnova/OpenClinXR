import { afterEach, describe, expect, it, vi } from "vitest";
import { type EncounterSnapshot, type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C34 RED (planted by lane manager, 2026-11-06): mic-permission preflight, server-speech gating, typed-box fallback, C33 Part A.
// Contract (names are the spec):
//   SpeechRecorder.permission?(): Promise<"granted" | "denied" | "prompt" | "unavailable">. mountSpeechCapture calls it once at mount.
//   A recorder without permission() counts as "prompt". The default browser recorder (no deps.speech.recorder) implements it from
//   globalThis.navigator: no mediaDevices.getUserMedia -> "unavailable"; navigator.permissions.query({name:"microphone"}).state
//   "granted"|"denied"|"prompt" is returned as is; no permissions API, or query throws/rejects -> "prompt".
//   Elements: #mic-status text per state -- granted "Microphone ready", prompt "Microphone permission needed",
//   denied "Microphone blocked: type your question", unavailable "Microphone unavailable: type your question";
//   server without speech (snapshot.speechAvailable === false) -> "Speech recognition off: type your question" (wins over mic state).
//   evidence.speech.micState: "checking" until permission() settles, then the state. evidence.speech.serverSpeech: "unknown" until a snapshot
//   with a boolean speechAvailable arrives, then "available" | "unavailable" (snapshot without the field = "unknown").
//   #speak-button.hidden = true when micState is "denied"|"unavailable" or serverSpeech is "unavailable"; false otherwise. A press (pointer or
//   XR squeeze) while hidden does nothing (recorder.start not called). The typed box (#utterance-input, #utterance-send) is always mounted
//   and never hidden/disabled. A press whose start() fails with name or message NotAllowedError/SecurityError/PermissionDeniedError sets
//   micState "denied" (button hidden); NotFoundError/NotSupportedError/NotReadableError... -> "unavailable"; other errors leave micState.
//   Part A: (1) a release during a pending start() must not leave a 14 s timer that ends a LATER press; (2) evidence.sendSpeech rejecting
//   records a capture {status:"failed:<message>"}, clears #speech-status, and the next press works (processing reset).
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
const tone = (n: number, rate: number): Float32Array => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));
type Perm = "granted" | "denied" | "prompt" | "unavailable";
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

async function joined(opts: { permission?: Perm | "none"; start?: () => Promise<void>; useDefaultRecorder?: boolean } = {}) {
  const sent: Array<[string, unknown]> = [];
  const published: EncounterSyncEvidence[] = [];
  const parent = new FakeElement("div");
  let stateListener: ((s: EncounterSnapshot) => void) | undefined;
  const starts: number[] = [];
  const recorder = {
    start: async () => { starts.push(1); if (opts.start !== undefined) await opts.start(); },
    stop: async () => ({ chunks: [tone(48000, 48000)], sampleRate: 48000 }),
    ...(opts.permission === undefined || opts.permission === "none" ? {} : { permission: async () => opts.permission as Perm }),
  };
  const listeners = new Map<string, Array<() => void>>();
  const session = { addEventListener: (type: string, fn: () => void) => { listeners.set(type, [...(listeners.get(type) ?? []), fn]); } };
  await startEncounterSyncFromUrl({
    search: "?encounterSync=ws://127.0.0.1:9",
    actorIds: () => ["p", "q"],
    register: () => undefined,
    play: () => undefined,
    publish: (e: EncounterSyncEvidence) => { published.push(e); },
    nowMs: () => Date.now(),
    utteranceBox: { doc: fakeDoc, parent },
    speech: opts.useDefaultRecorder === true ? { xrSession: () => session } : { recorder, xrSession: () => session },
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async (kind: string, payload?: unknown) => {
        sent.push([kind, payload]);
        if (kind === "speech-audio") return { status: "ack", seq: 1, serverTs: 0, rttMs: 1, transcript: { text: "when did it start", confidence: 0.8 } };
        return { status: "ack", seq: sent.length, serverTs: 0, rttMs: 1 };
      },
      onState: (fn: (s: EncounterSnapshot) => void) => { stateListener = fn; return () => undefined; },
      leave: async () => undefined,
    }) as never,
  } as never);
  const evidence = published[0] as EncounterSyncEvidence;
  const snapshot = (extra: Record<string, unknown>): void => stateListener?.({ serverTick: 1, phase: "encounter", turnId: 0, turnOwner: "none", actors: {}, learners: {}, ...extra } as never);
  return { parent, evidence, sent, starts, listeners, snapshot, button: parent.find("speak-button") as FakeElement, status: () => parent.find("mic-status")?.textContent };
}

afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(globalThis, "navigator"); });

describe("mic permission preflight (C34)", () => {
  it.each([
    ["granted", "Microphone ready", false],
    ["prompt", "Microphone permission needed", false],
    ["denied", "Microphone blocked: type your question", true],
    ["unavailable", "Microphone unavailable: type your question", true],
  ] as Array<[Perm, string, boolean]>)("%s shows %s and hides push-to-talk=%s; the typed box stays", async (permission, text, hidden) => {
    const { evidence, button, status, parent } = await joined({ permission });
    expect(evidence.speech?.micState).toBe("checking");
    await flush();
    expect(evidence.speech?.micState).toBe(permission);
    expect(status()).toBe(text);
    expect(button.hidden).toBe(hidden);
    expect(parent.find("utterance-input")?.hidden).toBe(false);
    expect(parent.find("utterance-input")?.disabled).toBe(false);
    expect(parent.find("utterance-send")?.hidden).toBe(false);
  });

  it("a recorder without permission() counts as prompt", async () => {
    const { evidence, button } = await joined({ permission: "none" });
    await flush();
    expect(evidence.speech?.micState).toBe("prompt");
    expect(button.hidden).toBe(false);
  });

  it("a hidden push-to-talk ignores pointer and XR squeeze presses", async () => {
    const { button, starts, listeners } = await joined({ permission: "denied" });
    await flush();
    await new Promise((r) => setTimeout(r, 700));
    button.fire("pointerdown");
    for (const fn of listeners.get("squeezestart") ?? []) fn();
    await flush();
    expect(starts).toEqual([]);
  });

  it("the server reporting no speech hides push-to-talk, wins over a granted mic, and leaves the typed box", async () => {
    const { evidence, button, status, snapshot, parent } = await joined({ permission: "granted" });
    await flush();
    expect(evidence.speech?.serverSpeech).toBe("unknown");
    snapshot({});
    expect(evidence.speech?.serverSpeech).toBe("unknown");
    expect(button.hidden).toBe(false);
    snapshot({ speechAvailable: false });
    expect(evidence.speech?.serverSpeech).toBe("unavailable");
    expect(button.hidden).toBe(true);
    expect(status()).toBe("Speech recognition off: type your question");
    expect(parent.find("utterance-input")?.hidden).toBe(false);
    snapshot({ speechAvailable: true });
    expect(evidence.speech?.serverSpeech).toBe("available");
    expect(button.hidden).toBe(false);
    expect(status()).toBe("Microphone ready");
  });

  it.each([
    ["NotAllowedError", "denied", true],
    ["SecurityError", "denied", true],
    ["NotFoundError", "unavailable", true],
    ["NotReadableError", "unavailable", true],
    ["SomethingElse", "granted", false],
  ] as Array<[string, string, boolean]>)("a press failing with %s moves micState to %s", async (name, state, hidden) => {
    const failure = Object.assign(new Error(`${name} happened`), { name });
    const { evidence, button } = await joined({ permission: "granted", start: async () => { throw failure; } });
    await flush();
    button.fire("pointerdown");
    await flush();
    button.fire("pointerup");
    await flush();
    expect(evidence.speech?.micState).toBe(state);
    expect(button.hidden).toBe(hidden);
  });

  it("the default browser recorder derives permission from navigator", async () => {
    const stub = (navigator: unknown) => Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true, writable: true });
    stub({ mediaDevices: { getUserMedia: async () => ({}) }, permissions: { query: async () => ({ state: "denied" }) } });
    let run = await joined({ useDefaultRecorder: true });
    await flush();
    expect(run.evidence.speech?.micState).toBe("denied");
    stub({});
    run = await joined({ useDefaultRecorder: true });
    await flush();
    expect(run.evidence.speech?.micState).toBe("unavailable");
    stub({ mediaDevices: { getUserMedia: async () => ({}) } });
    run = await joined({ useDefaultRecorder: true });
    await flush();
    expect(run.evidence.speech?.micState).toBe("prompt");
    stub({ mediaDevices: { getUserMedia: async () => ({}) }, permissions: { query: async () => { throw new TypeError("microphone not supported"); } } });
    run = await joined({ useDefaultRecorder: true });
    await flush();
    expect(run.evidence.speech?.micState).toBe("prompt");
    stub({ mediaDevices: { getUserMedia: async () => ({}) }, permissions: { query: async () => ({ state: "granted" }) } });
    run = await joined({ useDefaultRecorder: true });
    await flush();
    expect(run.evidence.speech?.micState).toBe("granted");
  });
});

describe("C33 Part A fixes (C34)", () => {
  it("a release during a pending start leaves no timer that ends the next press", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let finishStart: () => void = () => undefined;
    let first = true;
    const { button, starts, evidence } = await joined({ permission: "granted", start: () => { if (!first) return Promise.resolve(); first = false; return new Promise<void>((r) => { finishStart = r; }); } });
    await flush();
    button.fire("pointerdown");
    await flush();
    button.fire("pointerup");
    await flush();
    finishStart();
    await vi.advanceTimersByTimeAsync(100);
    const captured = evidence.speech?.captures.length ?? 0;
    button.fire("pointerdown");
    await vi.advanceTimersByTimeAsync(100);
    expect(starts.length).toBe(2);
    await vi.advanceTimersByTimeAsync(13800);
    expect(evidence.speech?.captures.length).toBe(captured);
    await vi.advanceTimersByTimeAsync(500);
    expect(evidence.speech?.captures.length).toBe(captured + 1);
  });

  it("a rejecting sendSpeech records a failed capture, clears the status, and the next press works", async () => {
    const { button, evidence, parent, starts } = await joined({ permission: "granted" });
    await flush();
    let calls = 0;
    (evidence as { sendSpeech?: unknown }).sendSpeech = async () => { calls += 1; if (calls === 1) throw new Error("queue broke"); };
    button.fire("pointerdown");
    await flush();
    button.fire("pointerup");
    await new Promise((r) => setTimeout(r, 30));
    expect(evidence.speech?.captures).toEqual([expect.objectContaining({ status: "failed:queue broke" })]);
    expect(parent.find("speech-status")?.textContent).toBe("");
    button.fire("pointerdown");
    await flush();
    button.fire("pointerup");
    await new Promise((r) => setTimeout(r, 30));
    expect(starts.length).toBe(2);
    expect(evidence.speech?.captures.map((c) => c.status)).toEqual(["failed:queue broke", "ok"]);
  });
});
