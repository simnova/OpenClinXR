import {it, expect, vi} from "vitest";
import {readAudioGraphClock, recorderChunkFact, serializeAudioGraphClock, audioGraphContextId} from "./audio-graph-clock.mjs";

function contextFixture(extra = {}) {
  return {
    currentTime: 1.25,
    sampleRate: 22050,
    state: "running",
    resume: vi.fn(),
    suspend: vi.fn(),
    close: vi.fn(),
    ...extra,
  };
}

it("records an available output timestamp without mutating the context or inventing a delay", () => {
  const context = contextFixture({
    baseLatency: 0.005,
    outputLatency: 0.012,
    getOutputTimestamp() { return { contextTime: 1.2, performanceTime: 4400 }; },
  });
  const clock = readAudioGraphClock(context, 5000);
  expect(clock.contextId).toBe(audioGraphContextId(context));
  expect(clock.currentTime).toBe(1.25);
  expect(clock.currentTimeBefore).toBe(1.25);
  expect(clock.currentTimeAfter).toBe(1.25);
  expect(clock.performanceBeforeMs).toBe(5000);
  expect(clock.outputTimestamp).toMatchObject({
    status: "available",
    contextTime: 1.2,
    performanceTime: 4400,
    notAMediaStreamDestinationClock: true,
  });
  expect(clock.baseLatency).toEqual({ status: "available", seconds: 0.005 });
  expect(clock.outputLatency).toEqual({ status: "available", seconds: 0.012 });
  expect(clock).not.toHaveProperty("historyUnmodified");
  expect(clock).not.toHaveProperty("fittedDelaySeconds");
  expect(context.resume).not.toHaveBeenCalled();
  expect(context.suspend).not.toHaveBeenCalled();
  expect(context.close).not.toHaveBeenCalled();
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

it("allows genuine advancing currentTime and spies no resume/suspend/close/rate writes", () => {
  let t = 1;
  let rateWrites = 0;
  const context = {
    get currentTime() { t += 0.128; return t; },
    get sampleRate() { return 22050; },
    set sampleRate(_) { rateWrites += 1; },
    state: "running",
    resume: vi.fn(),
    suspend: vi.fn(),
    close: vi.fn(),
    getOutputTimestamp() { return { contextTime: t - 0.01, performanceTime: 100 }; },
  };
  const clock = readAudioGraphClock(context, 10);
  expect(clock.currentTimeAfter).toBeGreaterThan(clock.currentTimeBefore);
  expect(clock.performanceAfterMs).toBeGreaterThanOrEqual(clock.performanceBeforeMs);
  expect(context.resume).not.toHaveBeenCalled();
  expect(context.suspend).not.toHaveBeenCalled();
  expect(context.close).not.toHaveBeenCalled();
  expect(rateWrites).toBe(0);
});

it("maps the same actual context object to a stable contextId", () => {
  const a = contextFixture();
  const b = contextFixture();
  const first = readAudioGraphClock(a, 1);
  const second = readAudioGraphClock(a, 2);
  const other = readAudioGraphClock(b, 3);
  expect(first.contextId).toBe(second.contextId);
  expect(other.contextId).not.toBe(first.contextId);
  const json = serializeAudioGraphClock(second);
  expect(json.context).toBeUndefined();
  expect(json.contextId).toBe(first.contextId);
  expect(json.state).toBe("running");
  expect(json.sampleRate).toBe(22050);
});

it("records recorder chunk performance/timecode as first-chunk-relative, not wall origin", () => {
  expect(recorderChunkFact({ timecode: 0, data: { size: 2048, type: "audio/webm" } }, 99)).toEqual({
    performanceNowMs: 99,
    timecode: 0,
    timecodeOrigin: "first-chunk-relative",
    size: 2048,
    type: "audio/webm",
  });
  expect(recorderChunkFact({ data: { size: 0 } }, 3).timecode).toBeNull();
  expect(recorderChunkFact({ timecode: 12.5, data: { size: 1 } }, 4).timecodeOrigin).toBe("first-chunk-relative");
});
