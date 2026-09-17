/**
 * Diagnostic graph/output clock reader. Does not mutate the context, rate, or
 * temporal history. getOutputTimestamp is the output-device estimate
 * (https://www.w3.org/TR/webaudio/#dom-audiocontext-getoutputtimestamp);
 * it is not MediaStreamAudioDestinationNode timing and is not a delay to apply.
 * BlobEvent.timecode is relative to the first chunk, not recorder.start wall origin.
 */
const contextIds = new WeakMap();
let nextContextId = 1;

export function audioGraphContextId(context) {
  if (!context) throw new Error("audio-graph-clock-context-missing");
  let id = contextIds.get(context);
  if (id == null) {
    id = nextContextId;
    nextContextId += 1;
    contextIds.set(context, id);
  }
  return id;
}

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

function snapshotContext(context) {
  return { currentTime: context.currentTime, sampleRate: context.sampleRate, state: context.state };
}

export function readAudioGraphClock(context, nowMs = (typeof performance !== "undefined" ? performance.now() : 0)) {
  if (!context) throw new Error("audio-graph-clock-context-missing");
  const performanceBeforeMs = nowMs;
  const before = snapshotContext(context);
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
  const baseLatency = readNumberField(context, "baseLatency");
  const outputLatency = readNumberField(context, "outputLatency");
  const after = snapshotContext(context);
  const performanceAfterMs = typeof performance !== "undefined" ? performance.now() : nowMs;
  return {
    contextId: audioGraphContextId(context),
    sampleRate: after.sampleRate,
    state: after.state,
    currentTime: after.currentTime,
    currentTimeBefore: before.currentTime,
    currentTimeAfter: after.currentTime,
    sampleRateBefore: before.sampleRate,
    sampleRateAfter: after.sampleRate,
    stateBefore: before.state,
    stateAfter: after.state,
    performanceBeforeMs,
    performanceAfterMs,
    outputTimestamp,
    baseLatency,
    outputLatency,
  };
}

export function serializeAudioGraphClock(clock) {
  if (!clock) return null;
  const { context: _context, ...rest } = clock;
  return rest;
}

export function recorderChunkFact(event, nowMs) {
  return {
    performanceNowMs: nowMs,
    timecode: Number.isFinite(event?.timecode) ? event.timecode : null,
    timecodeOrigin: "first-chunk-relative",
    size: event?.data?.size ?? 0,
    type: event?.data?.type ?? null,
  };
}
