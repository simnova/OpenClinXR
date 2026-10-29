import { describe, expect, it } from "vitest";
import { selectOwnedFrameEpochDurationMs } from "./parent-epoch-frame-duration.js";

const P = "parent_tara_johnson_v1";
const epoch = (actorId: unknown, speechActorId: unknown, startedAtMs: unknown, durationMs: unknown, nowMs: unknown) => ({
  actorId, speechActorId, startedAtMs, durationMs, nowMs,
});

describe("selectOwnedFrameEpochDurationMs", () => {
  it("accepts the owned parent epoch even when a child timeline is longer/earlier", () => {
    expect(selectOwnedFrameEpochDurationMs(epoch(P, P, 1000, 3150, 1100), P)).toBe(3150);
  });
  it("rejects wrong owner", () => {
    expect(selectOwnedFrameEpochDurationMs(epoch("child_x", "child_x", 1000, 2940, 1100), P)).toBeNull();
  });
  it("rejects missing epoch", () => {
    expect(selectOwnedFrameEpochDurationMs(epoch(null, null, null, null, null), P)).toBeNull();
  });
  it("rejects stale speechActor", () => {
    expect(selectOwnedFrameEpochDurationMs(epoch(P, "child_x", 1000, 3150, 1100), P)).toBeNull();
  });
  it("rejects expired epoch", () => {
    expect(selectOwnedFrameEpochDurationMs(epoch(P, P, 1000, 3150, 1000 + 3150), P)).toBeNull();
  });
  it.each([NaN, 0, -5, Infinity, "3150", null, undefined])("rejects bad duration %p", (d) => {
    expect(selectOwnedFrameEpochDurationMs(epoch(P, P, 1000, d, 1100), P)).toBeNull();
  });
  it("rejects missing clock", () => {
    expect(selectOwnedFrameEpochDurationMs(epoch(P, P, 1000, 3150, null), P)).toBeNull();
  });
});
