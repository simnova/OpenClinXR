import {
  humanoidBlinkIntervalMs,
  humanoidGazeBoutDurationMs,
  sampleHumanoidBlinkSchedule,
  sampleHumanoidGazeBout,
} from "@openclinxr/xr-humanoid-animation";
import { describe, expect, it } from "vitest";

type HumanoidConversationEyeState = "talking" | "listening" | "rest";
type HumanoidGazeBoutKind = "mutual" | "away";

function sampleStats(values: readonly number[]): { mean: number; sd: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  return { mean, sd };
}

describe("literature-derived conversational eye schedules", () => {
  const gazeRows = [
    { state: "talking" as const, kind: "mutual" as const, meanMs: 3130, sdMs: 3160, parity: 0 },
    { state: "talking" as const, kind: "away" as const, meanMs: 927, sdMs: 800, parity: 1 },
    { state: "listening" as const, kind: "mutual" as const, meanMs: 7920, sdMs: 1570, parity: 0 },
    { state: "listening" as const, kind: "away" as const, meanMs: 433, sdMs: 237, parity: 1 },
  ];

  it.each(gazeRows)("G1: $state $kind duration matches Lee/Badler mean and spread", (row) => {
    const n = 1024;
    const values = Array.from({ length: n }, (_, index) =>
      humanoidGazeBoutDurationMs(row.state, row.kind, index * 2 + row.parity));
    const { mean, sd } = sampleStats(values);
    const twoStandardErrors = 2 * row.sdMs / Math.sqrt(n);
    expect(Math.abs(mean - row.meanMs)).toBeLessThanOrEqual(twoStandardErrors);
    // COUNTERWEIGHT: substituting a constant at the source mean fails this assertion.
    expect(sd).toBeGreaterThanOrEqual(0.5 * row.sdMs);
  });

  it("G1: listening mutual bouts exceed talking mutual bouts", () => {
    const n = 1024;
    const mean = (state: HumanoidConversationEyeState, kind: HumanoidGazeBoutKind) =>
      sampleStats(Array.from({ length: n }, (_, index) => humanoidGazeBoutDurationMs(state, kind, index * 2))).mean;
    expect(mean("listening", "mutual")).toBeGreaterThan(mean("talking", "mutual"));
  });

  it("G1: the gaze sequence alternates mutual and away deterministically", () => {
    const sequence = (state: HumanoidConversationEyeState) => {
      const samples: string[] = [];
      let elapsedMs = 0;
      for (let index = 0; index < 8; index += 1) {
        const sample = sampleHumanoidGazeBout(elapsedMs, state);
        samples.push(`${sample.boutIndex}:${sample.kind}:${sample.yaw}:${sample.pitch}`);
        elapsedMs += sample.durationMs + 0.001;
      }
      return samples;
    };
    expect(sequence("talking")).toEqual(sequence("talking"));
    expect(sequence("talking").map((entry) => entry.split(":")[1])).toEqual([
      "mutual", "away", "mutual", "away", "mutual", "away", "mutual", "away",
    ]);
  });

  it.each(["talking", "listening", "rest"] as const)("G2: $state blink rate is within 10%", (state) => {
    const durationMs = 120_000;
    let cursorMs = 0;
    let count = 0;
    while (true) {
      cursorMs += humanoidBlinkIntervalMs(state, count);
      if (cursorMs > durationMs) break;
      count += 1;
    }
    const measuredPerMinute = count / (durationMs / 60_000);
    const target = state === "talking" ? 26 : 17.6;
    expect(measuredPerMinute).toBeGreaterThanOrEqual(target * 0.9);
    expect(measuredPerMinute).toBeLessThanOrEqual(target * 1.1);
  });

  it("G2: every blink closes faster than it opens, totals 300 ms, and seals", () => {
    for (const state of ["talking", "listening", "rest"] as const) {
      let cursorMs = 0;
      for (let index = 0; index < 64; index += 1) {
        const intervalMs = humanoidBlinkIntervalMs(state, index);
        const timing = sampleHumanoidBlinkSchedule(cursorMs + intervalMs - 300, state);
        expect(timing.closeDurationMs).toBeLessThan(timing.openDurationMs);
        expect(timing.closeDurationMs + timing.openDurationMs).toBe(300);
        const peak = sampleHumanoidBlinkSchedule(cursorMs + intervalMs - timing.openDurationMs, state);
        expect(peak.closeDurationMs).toBeLessThan(peak.openDurationMs);
        expect(peak.intensity).toBe(1);
        cursorMs += intervalMs;
      }
    }
  });
});
