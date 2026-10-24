import type { AxisValue, CapacityMetric } from "../types.js";
import { AUDIO_STRESS_PROCESSOR, AUDIO_STRESS_WORKLET_SOURCE, parseAudioWorkletWindow } from "./audio-worklet.js";
import { AudioStressMetrics, type AudioStressEvent } from "./audio-stress-metrics.js";

export interface AudioStressOptions {
  level: number;
  durationMs: number;
  signal: AbortSignal;
  voices?: number;
  workletLoad?: number;
  capture?: false | "explicit";
  syntheticOutputStream?: boolean;
  speakerGain?: number;
  setupTimeoutMs?: number;
  /** Explicitly scheduled phases may reuse a prior click; capture always requires transient activation. */
  allowPreviouslyActivated?: boolean;
}
export interface AudioStressState {
  status: "starting" | "running" | "completed" | "aborted" | "unsupported";
  worked: boolean;
  reason: string | null;
}
export interface AudioStressHandle {
  axes: Record<string, AxisValue>;
  state: AudioStressState;
  events: AudioStressEvent[];
  outputStream?: MediaStream;
  snapshotMetrics(): CapacityMetric[];
  stop(): Promise<void>;
}
function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be an integer in ${minimum}..${maximum}`);
  return value;
}
function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    pending.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
async function boundedClose(context: AudioContext): Promise<void> {
  // A broken or mocked close promise must not make cancellation wait forever.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([context.close().catch(() => {}), new Promise<void>((resolve) => { timer = setTimeout(resolve, 250); })]); }
  catch { /* Closing an already closed context is harmless. */ }
  finally { clearTimeout(timer); }
}
/** Called from an explicit click. Generated PCM exercises real Web Audio, never physical acoustic timing. */
export async function startAudioStress(options: AudioStressOptions): Promise<AudioStressHandle> {
  const signal = options.signal;
  const level = boundedInteger(options.level, 1, 8, "level");
  const durationMs = boundedInteger(options.durationMs, 100, 30_000, "durationMs");
  const voices = boundedInteger(options.voices ?? level * 4, 1, 32, "voices");
  const load = boundedInteger(options.workletLoad ?? level * 16, 0, 256, "workletLoad");
  const timeoutMs = boundedInteger(options.setupTimeoutMs ?? 2500, 100, 5000, "setupTimeoutMs");
  const speakerGain = options.speakerGain ?? 0;
  if (!Number.isFinite(speakerGain) || speakerGain < 0 || speakerGain > 0.01) throw new RangeError("speakerGain must be in 0..0.01");
  const captureRequested = options.capture === "explicit";
  const streamRequested = options.syntheticOutputStream === true;
  const allowPreviouslyActivated = options.allowPreviouslyActivated === true;
  if (captureRequested && streamRequested) throw new RangeError("Synthetic RTC output cannot include microphone capture");
  const axes: Record<string, AxisValue> = {
    audioStressVersion: "2", level, durationMs, audioVoices: voices, audioWorkletLoad: load,
    audioFilters: voices, audioSpatialPanners: voices, audioPanningModel: "equalpower",
    audioMediaSource: captureRequested ? "synthetic-oscillators-plus-explicit-capture" : "synthetic-oscillators",
    audioSpeakerGain: speakerGain, audioCaptureRequested: captureRequested, audioSyntheticOutputStreamRequested: streamRequested,
    audioReportWindowBlocks: 32, audioProcessorHardDurationMs: durationMs + timeoutMs, audioRenderClock: "AudioWorklet currentFrame/sampleRate",
    audioSampleTimestamp: "browser-monotonic at main-thread receipt", audioDiscontinuityMeaning: "observed render-frame steps only; not physical underruns",
    audioRuntimeEvidence: "actual-browser-WebAudio", audioGestureMode: "transient-required", audioOutputRoute: "unverified", audioCaptureInputClass: captureRequested ? "pending" : "none",
  };
  const state: AudioStressState = { status: "starting", worked: false, reason: null };
  let context: AudioContext | undefined; let metrics: AudioStressMetrics | undefined;
  const events: AudioStressEvent[] = [];
  const local = new AbortController(); const nodes: AudioNode[] = []; const oscillators: OscillatorNode[] = [];
  let capture: MediaStream | undefined; let destination: MediaStreamAudioDestinationNode | undefined;
  let processor: AudioWorkletNode | undefined; let moduleUrl: string | undefined;
  let durationTimer: ReturnType<typeof setTimeout> | undefined; let setupTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined; let cleanup: Promise<void> | undefined;
  const handle: AudioStressHandle = { axes, state, get events() { return (metrics?.events ?? events).map((event) => ({ ...event })); }, snapshotMetrics: () => metrics?.snapshot() ?? [], stop: () => finish(state.worked ? "completed" : "aborted", "Stopped by caller") };
  const externalAbort = () => { void finish("aborted", "Audio stress cancelled"); };
  const hidden = () => { if (document.visibilityState === "hidden") void finish("aborted", "Page hidden; audio stress stopped"); };
  function finish(status: AudioStressState["status"], reason: string): Promise<void> {
    if (cleanup) return cleanup;
    state.status = status; state.reason = reason;
    local.abort(new DOMException(reason, status === "unsupported" ? "TimeoutError" : "AbortError"));
    clearTimeout(durationTimer); clearTimeout(setupTimer); clearInterval(heartbeat);
    signal.removeEventListener("abort", externalAbort);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", hidden);
    metrics?.outputStamp("after"); metrics?.event("stopped", reason);
    if (!metrics) events.push({ at: performance.now(), type: status, detail: reason });
    try { processor?.port.postMessage({ type: "stop" }); } catch { /* The processor port may already be closed. */ }
    if (processor) { processor.onprocessorerror = null; processor.port.onmessage = null; processor.port.close(); }
    for (const oscillator of oscillators) { try { oscillator.stop(); } catch { /* May already be stopped. */ } }
    for (const track of capture?.getTracks() ?? []) track.stop();
    for (const track of destination?.stream.getTracks() ?? []) track.stop();
    for (const node of nodes) { try { node.disconnect(); } catch { /* Disconnected during failed setup. */ } }
    if (moduleUrl) { URL.revokeObjectURL(moduleUrl); moduleUrl = undefined; }
    if (context) context.onstatechange = null;
    cleanup = context ? boundedClose(context) : Promise.resolve();
    return cleanup;
  }
  if (signal.aborted) { await finish("aborted", "Stopped before audio setup"); return handle; }
  if (!globalThis.AudioContext || !globalThis.AudioWorkletNode || !globalThis.isSecureContext) { await finish("unsupported", "Secure-origin Web Audio/AudioWorklet unavailable"); return handle; }
  const activation = navigator.userActivation;
  const previouslyAuthorized = allowPreviouslyActivated && !captureRequested && activation?.hasBeenActive === true;
  if (activation?.isActive === false && !previouslyAuthorized) { await finish("unsupported", "Audio stress requires an explicit user gesture"); return handle; }
  axes['audioGestureMode'] = activation?.isActive ? "transient-activation" : previouslyAuthorized ? "previously-activated-campaign" : "activation-api-unavailable";
  if (typeof document !== "undefined" && document.visibilityState === "hidden") { await finish("aborted", "Page hidden before audio setup"); return handle; }
  signal.addEventListener("abort", externalAbort, { once: true });
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", hidden);
  setupTimer = setTimeout(() => { void finish("unsupported", "Audio setup deadline exceeded"); }, timeoutMs);
  try {
    context = new AudioContext({ latencyHint: "interactive" });
    metrics = new AudioStressMetrics(context);
    axes['audioSampleRateHz'] = context.sampleRate;
    context.onstatechange = () => metrics?.contextState(state.worked);
    metrics.contextState(false); metrics.outputStamp("before");
    // Resume is called before the first await so it retains the click's activation.
    const resume = context.resume();
    void resume.catch(() => {});
    if (captureRequested) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture unavailable");
      const pending = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      void pending.then((late) => { if (local.signal.aborted) for (const track of late.getTracks()) track.stop(); }, () => {});
      capture = await waitFor(pending, local.signal);
      if (local.signal.aborted) { for (const track of capture.getTracks()) track.stop(); throw local.signal.reason; }
      const tracks = capture.getAudioTracks();
      if (!capture.active || !tracks.length || tracks.some((track) => track.readyState !== "live")) throw new Error("Capture returned no live audio track");
      axes['audioCaptureInputClass'] = tracks.some((track) => /fake|synthetic/i.test(track.label)) ? "synthetic-device" : "unverified-physical-input";
      axes['audioCaptureTracks'] = tracks.length;
    }
    await waitFor(resume, local.signal);
    if (context.state !== "running") throw new Error("AudioContext did not run after resume");
    if (!context.audioWorklet?.addModule) throw new Error("AudioWorklet module loading unavailable");
    moduleUrl = URL.createObjectURL(new Blob([AUDIO_STRESS_WORKLET_SOURCE], { type: "text/javascript" }));
    await waitFor(context.audioWorklet.addModule(moduleUrl), local.signal);
    if (local.signal.aborted) throw local.signal.reason;
    URL.revokeObjectURL(moduleUrl); moduleUrl = undefined;
    processor = new AudioWorkletNode(context, AUDIO_STRESS_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, processorOptions: { load, maxFrames: Math.ceil(context.sampleRate * (durationMs + timeoutMs) / 1000) } });
    nodes.push(processor);
    let resolveFirst: (() => void) | undefined; let rejectFirst: ((error: Error) => void) | undefined;
    const first = new Promise<void>((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
    processor.onprocessorerror = () => { metrics?.processorError(); rejectFirst?.(new Error("AudioWorklet processor failed")); void finish("unsupported", "AudioWorklet processor failed"); };
    processor.port.onmessage = (event: MessageEvent<unknown>) => {
      if (local.signal.aborted) return;
      if (event.data && typeof event.data === "object" && (event.data as { type?: string }).type === "budget-exhausted") { metrics?.event("processor-budget", "Independent audio-thread frame budget exhausted"); void finish(state.worked ? "completed" : "unsupported", "Audio-thread frame budget exhausted"); return; }
      if (event.data && typeof event.data === "object" && (event.data as { type?: string }).type === "ready") { metrics?.event("processor-ready", "Processor constructed; waiting for actual processing"); return; }
      const report = parseAudioWorkletWindow(event.data, metrics?.previous);
      if (!report) { metrics?.rejected(); return; }
      metrics?.received(report);
      axes['audioRenderQuantumMinFrames'] = report.minQuantum; axes['audioRenderQuantumMaxFrames'] = report.maxQuantum;
      if (!state.worked) {
        state.worked = true; state.status = "running";
        metrics?.event("first-work", `Processed ${report.blocks} blocks / ${report.frames} frames at ${report.sampleRate} Hz`);
        resolveFirst?.(); resolveFirst = undefined; rejectFirst = undefined;
      }
    };
    const mix = context.createGain(); mix.gain.value = 0.2 / voices; mix.connect(processor); nodes.push(mix);
    for (let voice = 0; voice < voices; voice++) {
      const oscillator = context.createOscillator(); oscillator.type = voice % 2 ? "sine" : "triangle"; oscillator.frequency.value = 110 + voice * 17;
      const filter = context.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 1200 + voice * 40; filter.Q.value = 0.7;
      const panner = context.createPanner(); panner.panningModel = "equalpower"; panner.distanceModel = "inverse";
      panner.positionX.value = (voice % 5 - 2) * 0.5; panner.positionY.value = (voice % 3 - 1) * 0.2; panner.positionZ.value = -1 - voice * 0.05;
      oscillator.connect(filter); filter.connect(panner); panner.connect(mix); nodes.push(oscillator, filter, panner); oscillators.push(oscillator); oscillator.start();
    }
    if (capture) { const captureNode = context.createMediaStreamSource(capture); captureNode.connect(mix); nodes.push(captureNode); }
    const output = context.createGain(); output.gain.value = speakerGain; processor.connect(output); output.connect(context.destination); nodes.push(output);
    if (streamRequested) { destination = context.createMediaStreamDestination(); processor.connect(destination); nodes.push(destination); handle.outputStream = destination.stream; }
    let lastHeartbeat = performance.now();
    heartbeat = setInterval(() => { const at = performance.now(); metrics?.sample("audio.main-thread-heartbeat-gap", at - lastHeartbeat, at); lastHeartbeat = at; }, 100);
    await waitFor(first, local.signal);
    clearTimeout(setupTimer);
    durationTimer = setTimeout(() => { void finish("completed", "Bounded duration completed"); }, durationMs);
    return handle;
  } catch (error) {
    if (!cleanup) await finish(signal.aborted ? "aborted" : "unsupported", error instanceof Error ? error.message : "Audio setup failed");
    else await cleanup;
    return handle;
  }
}
