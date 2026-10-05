/**
 * Mouth-solver evaluator tests: determinism, dy ground-truth gate, probes.
 *
 * Fixtures are committed: the parent GLB and the step3 capture metrics.
 * The dy gate (median <= 2px, max <= 5px) is the slice target, met because cy
 * tracks jaw-driven geometry. cx is recorded, not gated: the capture
 * pale-pixel centroid swings +-8px in cx on a geometrically x-static arch as
 * lip opening changes which crowns are visible and lit (known limitation in
 * the output). No threshold is fitted to the observation.
 */
import { describe, expect, it } from "vitest";
import { evaluate, readEvaluatorTrack } from "./mouth-evaluator.js";

const GLB = new URL("../../../apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb", import.meta.url).pathname;
const TRACK_PATH = new URL("../../../docs/openclinxr/mouth-dynamics/step3/metrics.json", import.meta.url).pathname;

const DY_GATE_MEDIAN_PX = 2;
const DY_GATE_MAX_PX = 5;
const DY_RULE = "mouth-solver-ground-truth-dy-gate";

/** Open-vowel drive targets: the frames the teeth morphs shape. */
const OPEN_VOWELS = new Set(["viseme_aa", "viseme_e", "viseme_i", "viseme_o", "viseme_u"]);

function assertGroundTruthDyGate(dyMedianPx: number, dyMaxPx: number): void {
  if (!(dyMedianPx <= DY_GATE_MEDIAN_PX)) {
    throw new Error(
      `${DY_RULE}: median |dy} ${dyMedianPx}px exceeds gate ${DY_GATE_MEDIAN_PX}px`,
    );
  }
  if (!(dyMaxPx <= DY_GATE_MAX_PX)) {
    throw new Error(`${DY_RULE}: max |dy| ${dyMaxPx}px exceeds gate ${DY_GATE_MAX_PX}px`);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (key, input: unknown) => (key === "wallClockMs" ? 0 : input));
}

describe("mouth-solver evaluator", () => {
  it("is deterministic: same input gives byte-identical JSON", async () => {
    const track = readEvaluatorTrack(TRACK_PATH);
    const first = await evaluate(GLB, track);
    const second = await evaluate(GLB, track);
    expect(stableJson(second.output)).toBe(stableJson(first.output));
  }, 60000);

  it("meets the dy ground-truth gate and records dx", async () => {
    const track = readEvaluatorTrack(TRACK_PATH);
    const { output, dyMedianPx, dyMaxPx } = await evaluate(GLB, track);
    expect(output.records.length).toBe(124);
    expect(output.summary.groundTruthFrames).toBeGreaterThanOrEqual(100);
    expect(output.summary.nowVisemes).toEqual(["aa", "O"]);
    expect(output.summary.nowFrames[0]).toBe(100);
    expect(output.summary.nowFrames[output.summary.nowFrames.length - 1]).toBe(122);
    assertGroundTruthDyGate(dyMedianPx, dyMaxPx);
    expect(Number.isFinite(output.summary.groundTruthDxMedianCropPx)).toBe(true);
  }, 60000);

  it("destructive probe: a 2-degree camera pitch breaks the dy gate", async () => {
    const track = readEvaluatorTrack(TRACK_PATH);
    const perturbed = await evaluate(GLB, track, { cameraPitchPerturbDegrees: 2 });
    expect(() =>
      assertGroundTruthDyGate(perturbed.dyMedianPx, perturbed.dyMaxPx),
    ).toThrowError(DY_RULE);
    // Revert (no perturbation): the same check passes.
    const clean = await evaluate(GLB, track);
    expect(() => assertGroundTruthDyGate(clean.dyMedianPx, clean.dyMaxPx)).not.toThrow();
  }, 90000);

  it("morph discrimination: zeroed teeth morphs move the gap series", async () => {
    const track = readEvaluatorTrack(TRACK_PATH);
    const clean = await evaluate(GLB, track);
    const zeroed = await evaluate(GLB, track, { zeroTeethMorphs: true });
    const deltas = clean.output.records
      .filter((record) => record.viseme !== null && OPEN_VOWELS.has(record.viseme.toLowerCase()))
      .map((record) => {
        const other = zeroed.output.records[record.frame];
        return Math.abs(record.forwardGapHeadLocalMm - (other?.forwardGapHeadLocalMm ?? 0));
      });
    expect(deltas.length).toBeGreaterThan(0);
    expect(Math.max(...deltas)).toBeGreaterThanOrEqual(0.5);
  }, 90000);
});
