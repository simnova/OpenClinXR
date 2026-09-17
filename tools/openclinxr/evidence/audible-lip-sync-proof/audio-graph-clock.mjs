/**
 * Diagnostic graph/output clock reader. Does not mutate the context, rate, or
 * temporal history. getOutputTimestamp is the output-device estimate
 * (https://www.w3.org/TR/webaudio/#dom-audiocontext-getoutputtimestamp);
 * it is not MediaStreamAudioDestinationNode timing and is not a delay to apply.
 */
function readNumberField(object, key) {
  if (object == null || !(key in object)) return { status: "unavailable" };
  try {
    const value = object[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return { status: "failure", reason: "non-finite" };
    return { status: "available", seconds: value };
  } catch (error) {
    return { status: "failure", reason: error?.name ?? "error" };
  }
}

export function readAudioGraphClock(context, nowMs = (typeof performance !== "undefined" ? performance.now() : 0)) {
  if (!context) throw new Error("audio-graph-clock-context-missing");
  const currentTime = context.currentTime;
  const sampleRate = context.sampleRate;
  const state = context.state;
  let outputTimestamp = { status: "unavailable" };
  if (typeof context.getOutputTimestamp === "function") {
    try {
      const stamp = context.getOutputTimestamp();
      if (!stamp || !Number.isFinite(stamp.contextTime) || !Number.isFinite(stamp.performanceTime)) {
        outputTimestamp = { status: "failure", reason: "non-finite" };
      } else {
        outputTimestamp = {
          status: "available",
          contextTime: stamp.contextTime,
          performanceTime: stamp.performanceTime,
          notAMediaStreamDestinationClock: true,
        };
      }
    } catch (error) {
      outputTimestamp = { status: "failure", reason: error?.name ?? "error" };
    }
  }
  return {
    context,
    sampleRate,
    state,
    currentTime,
    performanceNowMs: nowMs,
    outputTimestamp,
    baseLatency: readNumberField(context, "baseLatency"),
    outputLatency: readNumberField(context, "outputLatency"),
    historyUnmodified: context.currentTime === currentTime && context.sampleRate === sampleRate && context.state === state,
  };
}

export function serializeAudioGraphClock(clock) {
  if (!clock) return null;
  const { context, ...rest } = clock;
  return rest;
}

export function recorderChunkFact(event, nowMs) {
  return {
    performanceNowMs: nowMs,
    timecode: Number.isFinite(event?.timecode) ? event.timecode : null,
    size: event?.data?.size ?? 0,
    type: event?.data?.type ?? null,
  };
}
