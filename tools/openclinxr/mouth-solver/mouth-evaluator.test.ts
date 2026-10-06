/**
 * Mouth-solver evaluator tests: determinism, dy ground-truth gate, rim gates, probes.
 *
 * Fixtures are committed: the rim-seated parent GLB and its fixed-capture
 * metrics (same line audio as step3, so cue frames are unchanged). The dy
 * gate (median <= 2px, max <= 5px) is the slice target. cx is recorded, not
 * gated (known limitation in the output). The rim target 3.743mm is the
 * directed rest target: the rim now-minimum on the pre-image GLB.
 */
import { describe, expect, it } from "vitest";
import { evaluate, probePremise, readEvaluatorTrack } from "./mouth-evaluator.js";

const GLB = new URL("../../../apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb", import.meta.url).pathname;
const TRACK_PATH = new URL(
  "../../../docs/openclinxr/mouth-dynamics/teeth-gap/fixed-capture/metrics.json",
  import.meta.url,
).pathname;

const DY_GATE_MEDIAN_PX = 2;
const DY_GATE_MAX_PX = 5;
const DY_RULE = "mouth-solver-ground-truth-dy-gate";
const RIM_TARGET_MM = 3.743;
const RIM_BAND_MM = 0.5;

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

  it("holds the rim gap band on every frame with a static upper arch", async () => {
    const track = readEvaluatorTrack(TRACK_PATH);
    const { output } = await evaluate(GLB, track);
    expect(output.summary.rimVertCount).toBe(76);
    for (const record of output.records) {
      expect(Math.abs(record.rimGapHeadLocalMm - RIM_TARGET_MM)).toBeLessThanOrEqual(RIM_BAND_MM);
      expect(record.upperTeethDisplacementHeadLocalMm).toBeLessThan(0.5);
    }
    expect(output.summary.penetrationFrames).toBe(0);
  }, 60000);

  it("records jaw travel at the rim-tracking baseline, not the exaggerated one", async () => {
    // Coordinator ruling: 7.79 mm is the real jaw-coupled travel. The old
    // 12.52 mm baseline included morph-Y exaggeration (crowns yanked past
    // the lip); rim transfer removed it while jaw bones and drive are
    // byte-identical. This pins the new baseline ±10%, not the old one.
    const track = readEvaluatorTrack(TRACK_PATH);
    const { output } = await evaluate(GLB, track);
    expect(output.summary.lowerTeethTravelHeadLocalMm).toBeGreaterThanOrEqual(7.0);
    expect(output.summary.lowerTeethTravelHeadLocalMm).toBeLessThanOrEqual(8.6);
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

  it("premise probe reports all 15 OVR visemes with upper teeth at zero", async () => {
    const { rows, visemes } = await probePremise(GLB);
    expect(visemes).toEqual([
      "viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_PP", "viseme_FF",
      "viseme_nn", "viseme_DD", "viseme_SS", "viseme_TH", "viseme_RR", "viseme_kk", "viseme_CH",
      "viseme_sil",
    ]);
    expect(rows).toHaveLength(15);
    for (const row of rows) {
      for (const value of [row.jawDegrees, row.lipOuterZMm, row.rimZMm, row.teethLowerZMm, row.teethUpperZMm]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      // Upper arch carries no morph deltas on the seated asset.
      expect(row.teethUpperZMm).toBe(0);
    }
    // Visemes without teeth targets have no teeth lever (DD lesson).
    for (const name of ["viseme_nn", "viseme_DD", "viseme_SS", "viseme_TH", "viseme_RR", "viseme_kk", "viseme_CH"]) {
      expect(rows.find((row) => row.viseme === name)?.teethLowerZMm).toBe(0);
    }
  }, 90000);
});
