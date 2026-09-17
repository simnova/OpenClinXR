import {it, expect} from "vitest";
import {readAudioGraphClock, recorderChunkFact, serializeAudioGraphClock} from "./audio-graph-clock.mjs";

function contextFixture(extra = {}) {
  return {
    currentTime: 1.25,
    sampleRate: 22050,
    state: "running",
    resume() { throw new Error("resume-must-not-run"); },
    suspend() { throw new Error("suspend-must-not-run"); },
    close() { throw new Error("close-must-not-run"); },
    ...extra,
  };
}

it("records an available output timestamp without mutating the context or inventing a delay", () => {
  const context = contextFixture({
    baseLatency: 0.005,
    outputLatency: 0.012,
    getOutputTimestamp() { return { contextTime: 1.2, performanceTime: 4400 }; },
  });
  const before = { currentTime: context.currentTime, sampleRate: context.sampleRate, state: context.state };
  const clock = readAudioGraphClock(context, 5000);
  expect(clock.context).toBe(context);
  expect(clock.currentTime).toBe(1.25);
  expect(clock.outputTimestamp).toMatchObject({
    status: "available",
    contextTime: 1.2,
    performanceTime: 4400,
    notAMediaStreamDestinationClock: true,
  });
  expect(clock.baseLatency).toEqual({ status: "available", seconds: 0.005 });
  expect(clock.outputLatency).toEqual({ status: "available", seconds: 0.012 });
  expect(clock.historyUnmodified).toBe(true);
  expect(context.currentTime).toBe(before.currentTime);
  expect(context.sampleRate).toBe(before.sampleRate);
  expect(context.state).toBe(before.state);
  expect(clock).not.toHaveProperty("fittedDelaySeconds");
  expect(JSON.stringify(clock)).not.toMatch(/0\.050637/);
});

it("names getOutputTimestamp unavailable when the method is absent", () => {
  const clock = readAudioGraphClock(contextFixture(), 1);
  expect(clock.outputTimestamp).toEqual({ status: "unavailable" });
  expect(clock.baseLatency.status).toBe("unavailable");
  expect(clock.outputLatency.status).toBe("unavailable");
});

it("names getOutputTimestamp failure when the method throws or returns non-finite values", () => {
  const throwing = readAudioGraphClock(contextFixture({
    getOutputTimestamp() { throw new TypeError("no-timestamp"); },
  }), 1);
  expect(throwing.outputTimestamp).toEqual({ status: "failure", reason: "TypeError" });
  const bad = readAudioGraphClock(contextFixture({
    getOutputTimestamp() { return { contextTime: NaN, performanceTime: 1 }; },
  }), 1);
  expect(bad.outputTimestamp).toEqual({ status: "failure", reason: "non-finite" });
});

it("refuses a missing context instead of synthesizing a clock row", () => {
  expect(() => readAudioGraphClock(undefined)).toThrow(/audio-graph-clock-context-missing/);
});

it("serializes clock facts without the live context object", () => {
  const context = contextFixture({ getOutputTimestamp() { return { contextTime: 1, performanceTime: 2 }; } });
  const json = serializeAudioGraphClock(readAudioGraphClock(context, 9));
  expect(json.context).toBeUndefined();
  expect(json.currentTime).toBe(1.25);
  expect(json.outputTimestamp.status).toBe("available");
});

it("records recorder chunk performance/timecode facts without substituting audio", () => {
  expect(recorderChunkFact({ timecode: 12.5, data: { size: 2048, type: "audio/webm" } }, 99)).toEqual({
    performanceNowMs: 99,
    timecode: 12.5,
    size: 2048,
    type: "audio/webm",
  });
  expect(recorderChunkFact({ data: { size: 0 } }, 3).timecode).toBeNull();
});
