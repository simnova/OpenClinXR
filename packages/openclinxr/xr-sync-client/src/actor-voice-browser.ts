import type { VoiceEngine, VoiceSink } from "./actor-voice.js";

interface WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  terminate(): void;
}

interface MessagePortLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
}

interface AudioNodeLike {
  connect(destination: unknown): unknown;
}

interface AudioContextLike {
  currentTime: number;
  sampleRate: number;
  state: string;
  destination: unknown;
  audioWorklet: { addModule(url: string): Promise<void> };
  createAnalyser(): AudioNodeLike;
  resume(): Promise<void>;
}

interface AudioWorkletNodeLike extends AudioNodeLike { port: MessagePortLike }

interface RuntimeLike {
  Worker?: new (url: string, options: { type: "module" }) => WorkerLike;
  AudioContext?: new (options: { sampleRate: number }) => AudioContextLike;
  AudioWorkletNode?: new (context: AudioContextLike, name: string) => AudioWorkletNodeLike;
  location?: { href: string };
  document?: { addEventListener(type: string, listener: () => void): void };
}

const runtime = globalThis as unknown as RuntimeLike;
const LOAD_TIMEOUT_MS = 60000;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

export function createBrowserVoiceParts(opts: { assetBase: string }): { engine: VoiceEngine; sink: VoiceSink; unlock(): Promise<void>; audioState(): string } {
  let worker: WorkerLike | undefined;
  let loaded: Promise<void> | undefined;
  let loadResolve: (() => void) | undefined;
  let loadReject: ((error: Error) => void) | undefined;
  let nextId = 0;
  let active: { id: number; onChunk(samples: Float32Array): void; resolve(value: { audioSeconds: number; computeMs: number }): void; reject(error: Error): void } | undefined;

  const ensureWorker = (): Promise<void> => {
    if (loaded !== undefined) return loaded;
    const WorkerCtor = runtime.Worker;
    if (WorkerCtor === undefined) return Promise.reject(new Error("Worker is unavailable"));
    // A constructor that throws (CSP, bad URL) fails this turn only; nothing is cached, so the next turn tries again.
    let created: WorkerLike;
    try {
      created = new WorkerCtor(`${opts.assetBase}paradee-worker.mjs`, { type: "module" });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    loaded = new Promise<void>((resolve, reject) => { loadResolve = resolve; loadReject = reject; });
    worker = created;
    // A worker that fails to import or load (CSP, 404, WebAssembly refused) must fail the load and every waiting turn, and
    // the next turn starts a fresh worker.
    const failLoad = (reason: string): void => {
      clearTimeout(loadTimer);
      const failure = new Error(reason);
      loadReject?.(failure);
      active?.reject(failure);
      active = undefined;
      created.terminate();
      if (worker === created) { worker = undefined; loaded = undefined; }
    };
    const loadTimer = setTimeout(() => failLoad("voice worker load timed out"), LOAD_TIMEOUT_MS);
    created.onerror = (event) => failLoad(`voice worker error: ${event.message ?? "unknown"}`);
    worker.onmessage = (event) => {
      const message = record(event.data);
      if (message === undefined) return;
      if (message["op"] === "loaded") {
        clearTimeout(loadTimer);
        loadResolve?.();
        return;
      }
      if (message["op"] === "error" && (message["id"] === undefined || active?.id !== message["id"])) {
        failLoad(String(message["message"] ?? "voice worker load failed"));
        return;
      }
      if (active === undefined || message["id"] !== active.id) return;
      if (message["op"] === "chunk") {
        const samples = message["samples"];
        if (samples instanceof Float32Array) active.onChunk(samples);
        else if (samples instanceof ArrayBuffer) active.onChunk(new Float32Array(samples));
      } else if (message["op"] === "done") {
        const current = active;
        active = undefined;
        current.resolve({ audioSeconds: Number(message["audio_s"] ?? 0), computeMs: Number(message["compute_ms"] ?? 0) });
      } else if (message["op"] === "error") {
        const current = active;
        active = undefined;
        current.reject(new Error(String(message["message"] ?? "voice synthesis failed")));
      }
    };
    const espeakUrl = new URL(`${opts.assetBase}espeak-refused.mjs`, runtime.location?.href ?? "http://localhost/").href;
    worker.postMessage({ op: "load", model: "v2f_lite", lexicon: "full", espeakUrl });
    return loaded;
  };

  const engine: VoiceEngine = {
    async synthesize(text, voice, onChunk) {
      await ensureWorker();
      if (active !== undefined) {
        worker?.postMessage({ op: "stop" });
        active.resolve({ audioSeconds: 0, computeMs: 0 });
        active = undefined;
      }
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        active = { id, onChunk, resolve, reject };
        worker?.postMessage({ op: "speak", id, text, voice, first: 16, chunk: 40, speed: 1 });
      });
    },
  };

  let context: AudioContextLike | undefined;
  let node: AudioWorkletNodeLike | undefined;
  let setup: Promise<void> | undefined;
  let startedAt: number | null = null;
  let peak = 0;
  let startCallback = (): void => undefined;
  let finishCallback = (_info: { played: number; underruns: number }): void => undefined;
  let listenersRegistered = false;

  const unlock = async (): Promise<void> => {
    if (setup === undefined) {
      setup = (async () => {
        const ContextCtor = runtime.AudioContext;
        const WorkletCtor = runtime.AudioWorkletNode;
        if (ContextCtor === undefined || WorkletCtor === undefined) throw new Error("Web Audio is unavailable");
        context = new ContextCtor({ sampleRate: 24000 });
        await context.audioWorklet.addModule(`${opts.assetBase}player-worklet.js`);
        node = new WorkletCtor(context, "stream-player");
        node.port.onmessage = (event) => {
          const message = record(event.data);
          if (message?.["started"] === true) {
            startedAt = context?.currentTime ?? null;
            startCallback();
          }
          if (message?.["finished"] === true) {
            startedAt = null;
            finishCallback({ played: Number(message["played"] ?? 0), underruns: Number(message["underruns"] ?? 0) });
          }
        };
        const analyser = context.createAnalyser();
        node.connect(analyser);
        analyser.connect(context.destination);
      })();
    }
    await setup;
    if (context?.state === "suspended") await context.resume();
  };

  if (runtime.document !== undefined && !listenersRegistered) {
    listenersRegistered = true;
    const resume = (): void => { void unlock().catch(() => undefined); };
    for (const type of ["pointerdown", "keydown", "click"]) runtime.document.addEventListener(type, resume);
  }

  const sink: VoiceSink = {
    reset() { startedAt = null; peak = 0; node?.port.postMessage({ reset: true }); },
    push(samples) {
      for (const value of samples) peak = Math.max(peak, Math.abs(value));
      if (node === undefined) return;
      node.port.postMessage({ samples }, [samples.buffer as ArrayBuffer]);
    },
    end() { node?.port.postMessage({ end: true }); },
    onStart(callback) { startCallback = callback; },
    onFinish(callback) { finishCallback = callback; },
    positionSeconds() { return startedAt === null || context === undefined ? null : Math.max(0, context.currentTime - startedAt); },
    peakAmplitude() { return peak; },
  };

  return { engine, sink, unlock, audioState: () => context === undefined ? "none" : `${context.state}@${context.sampleRate}` };
}
