/**
 * Solver tests: scale-table bounds, determinism, committed-artifact reproduce.
 *
 * The full coordinate-descent search runs in the solve CLI, not here; these
 * tests pin the mechanism (bounds, identity reset, determinism) and prove the
 * committed solved-teeth-gap.json reproduces from its own scales.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createActorAudioRuntime } from "@openclinxr/xr-dialogue/actor-audio-runtime";
import { evaluate, readEvaluatorTrack } from "./mouth-evaluator.js";
import {
  SCALE_MAX,
  SCALE_MIN,
  TARGET_GAP_MM,
  baselineOf,
  evaluateWithTeethScales,
  scoreOutput,
  searchTeethScales,
} from "./solve-teeth-gap.js";

const GLB = new URL("../../../apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb", import.meta.url).pathname;
const TRACK_PATH = new URL("../../../docs/openclinxr/mouth-dynamics/step3/metrics.json", import.meta.url).pathname;
const SOLVED_PATH = new URL("./solved-teeth-gap.json", import.meta.url).pathname;

function stableJson(value: unknown): string {
  return JSON.stringify(value, (key, input: unknown) => (key === "wallClockMs" ? 0 : input));
}

function fixtureRuntime() {
  return createActorAudioRuntime({
    developmentFixture: true,
    fixtureSearch: "?openclinxrSpeakFixture=1",
  });
}

describe("mouth-solver teeth scales", () => {
  it("refuses out-of-range scales and resets to identity", () => {
    const runtime = fixtureRuntime();
    expect(() => runtime.diagnostics.setTeethVisemeScales({ viseme_E: SCALE_MAX + 0.1 })).toThrowError(
      "invalid-teeth-viseme-scale",
    );
    expect(() => runtime.diagnostics.setTeethVisemeScales({ viseme_E: SCALE_MIN - 0.1 })).toThrowError(
      "invalid-teeth-viseme-scale",
    );
    expect(() => runtime.diagnostics.setTeethVisemeScales({ viseme_E: 1.5 })).not.toThrow();
    runtime.diagnostics.resetTeethVisemeScales();
  });

  it("is deterministic under fixed scales", async () => {
    const track = readEvaluatorTrack(TRACK_PATH);
    const scales = { viseme_E: 1.5, viseme_O: 1.5 };
    const first = await evaluateWithTeethScales(GLB, track, scales);
    const second = await evaluateWithTeethScales(GLB, track, scales);
    expect(stableJson(second.output)).toBe(stableJson(first.output));
  }, 120000);

  it("reproduces the committed solved artifact from its own scales", async () => {
    const solved = JSON.parse(readFileSync(SOLVED_PATH, "utf8")) as {
      targetGapMm: number;
      scales: Record<string, number>;
      objectiveAfter: { rms: number; max: number; feasible: boolean; ppGapDeltaMm: number };
    };
    expect(solved.targetGapMm).toBe(TARGET_GAP_MM);
    expect(Object.keys(solved.scales).length).toBeGreaterThan(0);
    expect("viseme_PP" in solved.scales).toBe(false);
    for (const value of Object.values(solved.scales)) {
      expect(value).toBeGreaterThanOrEqual(SCALE_MIN);
      expect(value).toBeLessThanOrEqual(SCALE_MAX);
    }
    const track = readEvaluatorTrack(TRACK_PATH);
    const { output } = await evaluateWithTeethScales(GLB, track, solved.scales);
    const clean = await evaluate(GLB, track);
    const objective = scoreOutput(output, baselineOf(clean.output));
    expect(objective.rms).toBeCloseTo(solved.objectiveAfter.rms, 6);
    expect(objective.max).toBeCloseTo(solved.objectiveAfter.max, 6);
    expect(objective.feasible).toBe(true);
    expect(objective.ppGapDeltaMm).toBe(0);
    expect(objective.rms).toBeLessThan(scoreOutput(clean.output, baselineOf(clean.output)).rms);
  }, 120000);

  it("search is deterministic on a narrow schedule", async () => {
    const track = readEvaluatorTrack(TRACK_PATH);
    const clean = await evaluate(GLB, track);
    const baseline = baselineOf(clean.output);
    const schedule = { order: ["viseme_E"], coarseStep: 0.5, fineRadius: 0, fineStep: 1 };
    const first = await searchTeethScales(GLB, track, baseline, schedule);
    const second = await searchTeethScales(GLB, track, baseline, schedule);
    expect(second.scales).toEqual(first.scales);
    expect(second.objective.rms).toBe(first.objective.rms);
  }, 180000);
});
