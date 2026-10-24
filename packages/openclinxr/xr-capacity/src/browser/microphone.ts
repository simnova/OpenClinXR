import { makeMetric } from "../index.js";
import type { AxisValue, CapacityMetric } from "../types.js";
const source = { tool: "getUserMedia-and-WebAudio", version: "1", processId: "browser-page" };
function unavailable(reason: string): CapacityMetric { return makeMetric({ id: "microphone.capture", semantic: "audio-software", unit: "ms", kind: "unavailable", samples: [], source, clockDomain: "browser-monotonic", unavailableReason: reason }); }
function abortError(): DOMException { return new DOMException("Microphone probe stopped", "AbortError"); }
function delay(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 20);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Explicit-click collector. No sample audio, device ID, or recording survives the probe. */
export async function probeMicrophone(signal: AbortSignal): Promise<{ metrics: CapacityMetric[]; axes: Record<string, AxisValue>; status: "completed" | "unsupported" | "aborted" }> {
  if (signal.aborted) return { metrics: [unavailable("Probe stopped before permission request")], axes: {}, status: "aborted" };
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext) return { metrics: [unavailable("Secure-origin capture/Web Audio API unavailable")], axes: {}, status: "unsupported" };
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return { metrics: [unavailable("Page hidden before capture")], axes: {}, status: "aborted" };
  let context: AudioContext;
  try { context = new AudioContext(); }
  catch { return { metrics: [unavailable("AudioContext construction failed")], axes: {}, status: "unsupported" }; }
  const local = new AbortController();
  const externalAbort = () => local.abort(abortError());
  const hidden = () => { if (document.visibilityState === "hidden") local.abort(abortError()); };
  signal.addEventListener("abort", externalAbort, { once: true });
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", hidden);
  const activeSignal = local.signal;
  let finished = false;
  const deadline = setTimeout(() => local.abort(new DOMException("Microphone setup deadline exceeded", "TimeoutError")), 3000);
  let stream: MediaStream | undefined; let audioSource: MediaStreamAudioSourceNode | undefined; let analyser: AnalyserNode | undefined;
  let abortListener: (() => void) | undefined;
  try {
    const resume = context.resume();
    void resume.catch(() => {});
    const started = performance.now();
    const capture = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    // Standard getUserMedia has no AbortSignal. A grant arriving after cancellation is immediately released.
    void capture.then((late) => { if (finished || activeSignal.aborted) for (const track of late.getTracks()) track.stop(); }, () => {});
    const cancelled = new Promise<never>((_resolve, reject) => { abortListener = () => reject(activeSignal.reason); activeSignal.addEventListener("abort", abortListener, { once: true }); if (activeSignal.aborted) abortListener(); });
    stream = await Promise.race([capture, cancelled]);
    if (activeSignal.aborted) throw activeSignal.reason;
    await Promise.race([resume, cancelled]);
    clearTimeout(deadline);
    if (context.state !== "running") return { metrics: [unavailable("Capture granted but AudioContext did not run")], axes: {}, status: "unsupported" };
    const tracks = stream.getAudioTracks();
    if (!stream.active || !tracks.length || tracks.some((track) => track.readyState !== "live")) return { metrics: [unavailable("Capture returned no live audio track")], axes: {}, status: "unsupported" };
    const settings = tracks[0]?.getSettings() ?? {};
    const label = tracks[0]?.label || "browser-default";
    const axes: Record<string, AxisValue> = { captureRoute: label, captureInputClass: /fake|synthetic/i.test(label) ? "synthetic-device" : "unverified-physical-input", contextSampleRateHz: context.sampleRate };
    for (const key of ["sampleRate", "sampleSize", "channelCount", "echoCancellation", "noiseSuppression", "autoGainControl", "latency"] as const) {
      const value = (settings as unknown as Record<string, unknown>)[key];
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") axes[`track.${key}`] = value;
      else axes[`track.${key}`] = null;
    }
    const grantedAt = performance.now();
    audioSource = context.createMediaStreamSource(stream); analyser = context.createAnalyser(); audioSource.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize); let nonzero = 0; let windows = 0;
    const began = performance.now();
    while (performance.now() - began < 250) { await delay(activeSignal); analyser.getFloatTimeDomainData(buffer); for (const value of buffer) if (Math.abs(value) > .0001) nonzero++; windows++; }
    buffer.fill(0);
    const at = performance.now();
    const measured = (id: string, value: number) => makeMetric({ id, semantic: "counter", unit: "count", source, clockDomain: "browser-monotonic", samples: [{ at, value, valid: true }] });
    return { status: "completed", axes, metrics: [
      makeMetric({ id: "microphone.permission-and-start", semantic: "audio-software", unit: "ms", source, clockDomain: "browser-monotonic", samples: [{ at: grantedAt, value: grantedAt - started, valid: true }] }),
      measured("microphone.live-tracks", tracks.length), measured("microphone.analyser-windows", windows), measured("microphone.nonzero-software-samples", nonzero),
      makeMetric({ id: "microphone.acoustic-round-trip", semantic: "audio-acoustic", unit: "ms", kind: "unavailable", source, clockDomain: "external-acoustic", samples: [], unavailableReason: "No external acoustic timing rig; track settings and software samples cannot establish headset latency." }),
    ] };
  } catch (error) {
    const aborted = signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    return { status: aborted ? "aborted" : "unsupported", axes: {}, metrics: [unavailable(aborted ? "Microphone probe stopped" : `Capture unavailable: ${error instanceof Error ? error.name : "unknown error"}`)] };
  } finally {
    finished = true; clearTimeout(deadline);
    signal.removeEventListener("abort", externalAbort);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", hidden);
    if (abortListener) activeSignal.removeEventListener("abort", abortListener);
    for (const track of stream?.getTracks() ?? []) track.stop(); audioSource?.disconnect(); analyser?.disconnect();
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([context.close().catch(() => {}), new Promise<void>((resolve) => { closeTimer = setTimeout(resolve, 250); })]); }
    catch { /* Context may already have been released. */ }
    finally { clearTimeout(closeTimer); }
  }
}
