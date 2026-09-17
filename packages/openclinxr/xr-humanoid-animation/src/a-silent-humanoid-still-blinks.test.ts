/**
 * REGRESSION GATE: a humanoid that is not speaking must still blink.
 *
 * DIAGNOSIS (measured 2026-09-16, 1,321-frame capture of mpfb-gown-adult-patient.glb):
 * `updateHumanoidSpeechCue` returns at animation-loop.ts:239 whenever `slot.activeSpeech` is
 * undefined, and that return precedes `applyHumanoidFaceRigControls` — the only caller of the
 * lid-closure applier. Across 883 silent frames (~8.7 s) blink intensity was 0 on every frame,
 * where the 3.4 s mean interval predicts two or three blinks. After the fix the same capture
 * recorded blinks at 8,016 ms and 10,274 ms, peak applier influence 0.999, vertex-measured lid
 * closure 0.9993.
 *
 * claimScope: that the lid-closure channel is driven while silent, and that the schedule is
 * irregular and deterministic. notEvidenceFor blink realism, anatomy, or clinical affect.
 */
import { describe, expect, it } from "vitest";
import { Group, Object3D } from "three";
import { applyHumanoidRestBlink, computeHumanoidEyeMotionMetrics } from "./face-rig.js";

/** Minimal slot carrying the two lid-closure targets a shipped MPFB body has. */
function makeSlot() {
  const root = new Group();
  const head = new Object3D() as Object3D & {
    morphTargetDictionary?: Record<string, number>;
    morphTargetInfluences?: number[];
  };
  head.morphTargetDictionary = { "eye-left-closure": 0, "eye-right-closure": 1, "mouth-open": 2 };
  head.morphTargetInfluences = [0, 0, 0];
  root.add(head);
  return { slot: { root } as never, head };
}

/** Sample the closure channel across `ms`, returning the peak and the blink onset times. */
function sweepRestBlink(durationMs: number, stepMs = 4) {
  const { slot, head } = makeSlot();
  let peak = 0;
  const onsets: number[] = [];
  let rising = false;
  for (let t = 0; t <= durationMs; t += stepMs) {
    applyHumanoidRestBlink(slot, t);
    const v = head.morphTargetInfluences![0];
    peak = Math.max(peak, v);
    if (v > 0.9 && !rising) { onsets.push(t); rising = true; }
    if (v < 0.1) rising = false;
  }
  return { peak, onsets };
}

describe("a silent humanoid still blinks", () => {
  it("drives the lid-closure channel to a full blink while nothing is speaking", () => {
    const { peak, onsets } = sweepRestBlink(30000);
    // pre-fix this channel was 0 on every one of 883 silent frames
    expect(peak).toBeGreaterThan(0.9);
    expect(onsets.length).toBeGreaterThanOrEqual(5);
  });

  it("blinks on an IRREGULAR schedule, not a metronome", () => {
    const { onsets } = sweepRestBlink(60000);
    const intervals = onsets.slice(1).map((t, i) => t - onsets[i]);
    expect(intervals.length).toBeGreaterThanOrEqual(8);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length);
    // the pre-fix clock was `elapsedMs % 4300`: sd exactly 0
    expect(sd).toBeGreaterThan(200);
    expect(new Set(intervals).size).toBeGreaterThan(intervals.length * 0.6);
  });

  it("keeps the long-run rate inside the 15-20/min resting range", () => {
    const { onsets } = sweepRestBlink(120000);
    const perMinute = onsets.length / 2;
    expect(perMinute).toBeGreaterThanOrEqual(15);
    expect(perMinute).toBeLessThanOrEqual(20);
  });

  it("COUNTERWEIGHT: the schedule is DETERMINISTIC — two sweeps agree exactly", () => {
    // rejects the cheap fix of Math.random(), which would pass every assertion above
    expect(sweepRestBlink(30000).onsets).toEqual(sweepRestBlink(30000).onsets);
  });

  it("COUNTERWEIGHT: the channel returns to fully open between blinks", () => {
    // rejects "hold the lids shut", which would also make peak > 0.9
    const { slot, head } = makeSlot();
    let sawOpen = false;
    for (let t = 0; t <= 30000; t += 4) {
      applyHumanoidRestBlink(slot, t);
      if (head.morphTargetInfluences![0] < 0.001) sawOpen = true;
    }
    expect(sawOpen).toBe(true);
  });

  it("COUNTERWEIGHT: the speaking clock is unchanged and still blinks", () => {
    let peak = 0;
    for (let t = 0; t <= 30000; t += 4) {
      peak = Math.max(peak, computeHumanoidEyeMotionMetrics({ startedAtMs: 0 } as never, t).blinkIntensity);
    }
    expect(peak).toBeGreaterThan(0.9);
  });
});
