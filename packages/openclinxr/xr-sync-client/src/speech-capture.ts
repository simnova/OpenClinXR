// C33 learner speech capture: hold-to-speak button + XR squeeze write PCM to the
// room and route the transcript through the C29 speech path. Records hold only
// counts and statuses, never text or audio.
import type { UtteranceBoxDeps } from "./encounter-turns.js";
import { downsampleToPcm16, pcmRms } from "./speech-pcm.js";

export interface SpeechRecorder {
  start(): Promise<void>;
  stop(): Promise<{ chunks: Float32Array[]; sampleRate: number }>;
  inject?(pcm: Int16Array): void;
  source?(): "microphone" | "injected";
  permission?(): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'>;
}

export interface XrSessionLike {
  addEventListener(type: string, listener: () => void): void;
}

export interface SpeechCaptureRecord {
  source: "microphone" | "injected";
  status: string;
  samples: number;
  rms: number;
  releaseToCaptionMs: number;
  chars: number;
  confidence: number;
  /** Mic-open failure message (first 120 chars); absent otherwise. */
  detail?: string;
}

export interface SpeechEvidence {
  captures: SpeechCaptureRecord[];
  press(): Promise<void>;
  release(): Promise<void>;
  inject?(pcm: Int16Array): void;
  micState: "checking" | "granted" | "prompt" | "denied" | "unavailable";
  serverSpeech: "unknown" | "available" | "unavailable";
  setServerSpeech(available: boolean | undefined): void;
}

export function mountSpeechCapture(deps: {
  box: UtteranceBoxDeps;
  speech: { recorder: SpeechRecorder; xrSession?: () => XrSessionLike | null | undefined };
  nowMs(): number;
  sendAudio(pcm: Uint8Array): Promise<{ status: string; reason?: string; transcript?: { text: string; confidence: number } }>;
  pickActor(): string | undefined;
  sendSpeech(actorId: string | undefined, text: string, confidence: number): Promise<void>;
  setLearnerCaption?: never;
}): SpeechEvidence {
  const captures: SpeechCaptureRecord[] = [];
  const recorder = deps.speech.recorder;
  const statusEl = deps.box.doc.createElement("div");
  statusEl.id = "speech-status";
  statusEl.textContent = "";
  deps.box.parent.appendChild(statusEl);
  const button = deps.box.doc.createElement("button");
  button.id = "speak-button";
  button.textContent = "Hold to speak";
  deps.box.parent.appendChild(button);
  const micEl = deps.box.doc.createElement("div");
  micEl.id = "mic-status";
  micEl.textContent = "";
  deps.box.parent.appendChild(micEl);
  let mic: SpeechEvidence["micState"] = "checking";
  let server: SpeechEvidence["serverSpeech"] = "unknown";
  const render = (): void => {
    button.hidden = mic === "denied" || mic === "unavailable" || server === "unavailable";
    micEl.textContent = server === "unavailable"
      ? "Speech recognition off: type your question"
      : mic === "checking" ? "" : mic === "granted" ? "Microphone ready" : mic === "prompt" ? "Microphone permission needed" : mic === "denied" ? "Microphone blocked: type your question" : "Microphone unavailable: type your question";
  };
  render();
  const maybeRecorder = recorder as SpeechRecorder & { permission?: () => Promise<"granted" | "denied" | "prompt" | "unavailable"> };
  // Defer the preflight past join's own promise layers so micState still reads
  // "checking" when join resolves, then settles within a few microtask turns.
  const preflightMic = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    try {
      mic = (await maybeRecorder.permission?.()) ?? "prompt";
    } catch {
      mic = "prompt";
    }
    render();
  };
  void preflightMic();
  let recording = false;
  let processing = false;
  let startFailed = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let pressId = 0;
  let source: "microphone" | "injected" = "microphone";
  let starting: Promise<void> = Promise.resolve();
  const press = async (): Promise<void> => {
    if (button.hidden) return;
    if (recording || processing) return;
    const id = ++pressId;
    recording = true;
    startFailed = false;
    statusEl.textContent = "Listening...";
    try {
      starting = recorder.start();
      await starting;
    } catch (error) {
      recording = false;
      startFailed = true;
      const err = error instanceof Error ? error : new Error(String(error));
      captures.push({ source: recorder.source?.() ?? "microphone", status: `failed:${err.name !== "" && err.name !== "Error" ? err.name : err.message}`, samples: 0, rms: 0, releaseToCaptionMs: 0, chars: 0, confidence: 0, detail: err.message.slice(0, 120) });
      statusEl.textContent = "Microphone unavailable";
      const tag = `${err.name} ${err.message}`;
      if (/NotAllowedError|SecurityError|PermissionDeniedError/.test(tag)) mic = "denied";
      else if (/NotFoundError|NotSupportedError|NotReadableError|OverconstrainedError|AbortError/.test(tag)) mic = "unavailable";
      render();
      return;
    }
    source = recorder.source?.() ?? "microphone";
    if (id !== pressId || !recording) return;
    // The server accepts at most 15 s of audio: release automatically before that.
    holdTimer = setTimeout(() => { void release(); }, 14000);
  };
  const release = async (): Promise<void> => {
    if (!recording) return;
    recording = false;
    processing = true;
    clearTimeout(holdTimer);
    holdTimer = undefined;
    const releasedAt = deps.nowMs();
    try {
      await starting.catch(() => undefined);
      if (startFailed) return;
      await finishRelease(releasedAt);
    } finally {
      processing = false;
    }
  };
  const finishRelease = async (releasedAt: number): Promise<void> => {
    const stopped = await recorder.stop();
    const pcm = downsampleToPcm16(stopped.chunks, stopped.sampleRate);
    const samples = pcm.length;
    const rms = Math.round(pcmRms(pcm) * 10000) / 10000;
    if (samples < 1600) {
      captures.push({ source, status: "too-short", samples, rms, releaseToCaptionMs: 0, chars: 0, confidence: 0 });
      statusEl.textContent = "";
      return;
    }
    statusEl.textContent = "Recognizing...";
    let result: { status: string; reason?: string; transcript?: { text: string; confidence: number } };
    try {
      result = await deps.sendAudio(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    } catch (error) {
      captures.push({ source, status: `failed:${error instanceof Error ? error.message : String(error)}`, samples, rms, releaseToCaptionMs: 0, chars: 0, confidence: 0 });
      statusEl.textContent = "";
      return;
    }
    if (result.status !== "ack") {
      captures.push({ source, status: `failed:${result.reason}`, samples, rms, releaseToCaptionMs: 0, chars: 0, confidence: 0 });
      statusEl.textContent = "";
      return;
    }
    const text = result.transcript?.text ?? "";
    const confidence = result.transcript?.confidence ?? 0;
    if (result.transcript === undefined || text.trim() === "") {
      captures.push({ source, status: "empty", samples, rms, releaseToCaptionMs: 0, chars: 0, confidence: 0 });
      statusEl.textContent = "";
      return;
    }
    const sent = deps.sendSpeech(deps.pickActor(), text, confidence);
    const captionAt = deps.nowMs();
    try {
      await sent;
    } catch (error) {
      captures.push({ source, status: `failed:${error instanceof Error ? error.message : String(error)}`, samples, rms, releaseToCaptionMs: 0, chars: 0, confidence: 0 });
      statusEl.textContent = "";
      return;
    }
    captures.push({ source, status: "ok", samples, rms, releaseToCaptionMs: captionAt - releasedAt, chars: text.trim().length, confidence });
    statusEl.textContent = "";
  };
  button.addEventListener("pointerdown", () => { void press(); });
  button.addEventListener("pointerup", () => { void release(); });
  button.addEventListener("pointercancel", () => { void release(); });
  const attached = new WeakSet<object>();
  const attachXr = (): void => {
    const session = deps.speech.xrSession?.();
    if (session === null || session === undefined || attached.has(session)) return;
    attached.add(session);
    session.addEventListener("squeezestart", () => { void press(); });
    session.addEventListener("squeezeend", () => { void release(); });
  };
  attachXr();
  const timer = setInterval(attachXr, 500) as unknown as { unref?: unknown };
  if (typeof timer.unref === "function") (timer.unref as () => void)();
  const evidence: SpeechEvidence = { captures, press, release,
    get micState() { return mic; },
    get serverSpeech() { return server; },
    setServerSpeech: (available) => { server = available === undefined ? "unknown" : available ? "available" : "unavailable"; render(); },
  };
  if (recorder.inject !== undefined) evidence.inject = recorder.inject.bind(recorder);
  return evidence;
}
