/**
 * Reassured AU12 plant, 2026-09-18.
 * cheekTension-driven mouth-corner is invisible: reassured 0.18 vs neutral 0.08
 * (delta 0.10) and would make pain (0.72) smile hardest. Per-emotion AU12 row
 * must drive mouth-corner-puller at ≥0.4 for reassured and 0 for pain/anxious.
 * Diagnosis and measured tables in the planted header are IMMUTABLE. Flip the assertion and append a
 * ## FIXED (#N) block below. Do not rewrite the original paths or numbers.
 *
 * ## FIXED (R1 tsk_d44a670c41f10d7e)
 * face-rig.ts drives FACS "mouth-corner-puller" at 0.5 gated on the reassured
 * weights row (tolerance 0.01); pain/anxious/neutral/concerned leave it at 0.
 */
import { BoxGeometry, Group, Line, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { expressionWeightsForEmotion } from "@openclinxr/xr-dialogue";
import {
  applyHumanoidMorphTargetCue,
  createHumanoidEmotionExpressionState,
  type GeneratedHumanoidAnimationSlot,
} from "./index.js";

const PROMOTED_LIB_NAMES = [
  "eye-left-closure",
  "eye-left-opened-up",
  "eye-left-slit",
  "eye-right-closure",
  "eye-right-opened-up",
  "eye-right-slit",
  "eyebrows-left-down",
  "eyebrows-left-extern-up",
  "eyebrows-left-inner-up",
  "eyebrows-left-up",
  "eyebrows-right-down",
  "eyebrows-right-extern-up",
  "eyebrows-right-inner-up",
  "eyebrows-right-up",
  "mouth-compression",
  "mouth-corner-puller",
  "mouth-depression-retraction",
  "mouth-depression",
  "mouth-elevation",
  "mouth-eversion",
  "mouth-open",
  "mouth-parling",
  "mouth-part-later",
  "mouth-protusion",
  "mouth-pursing",
  "mouth-retraction",
  "mouth-upward-retraction",
  "neck-platysma",
  "nose-compression",
  "nose-depression",
  "nose-left-dilatation",
  "nose-left-elevation",
] as const;

function fakeSlot(dict: Record<string, number>, influences: number[]): GeneratedHumanoidAnimationSlot {
  const root = new Group();
  const face = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  face.morphTargetDictionary = dict;
  face.morphTargetInfluences = influences;
  root.add(face);
  const actorSlot = new Group();
  actorSlot.add(root);
  return {
    actorId: "library-lean-female",
    assetId: "body-param-adult_lean_female-library",
    root,
    actorSlot,
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    phaseOffsetMs: 0,
    mouthCue: new Mesh(),
    gazeCue: new Line(),
    eyeFocusCue: new Group(),
    expressionCue: new Group(),
    emotionExpression: createHumanoidEmotionExpressionState({ deterministicClock: true }),
    sourceComparatorFreezeEnabled: false,
  };
}

describe("reassured drives mouth-corner-puller", () => {
  it("reassured drives mouth-corner-puller at grade-visible weight", () => {
    const dict = Object.fromEntries(PROMOTED_LIB_NAMES.map((name, index) => [name, index]));
    const influences = new Array(PROMOTED_LIB_NAMES.length).fill(0);
    const slot = fakeSlot(dict, influences);
    applyHumanoidMorphTargetCue(
      slot,
      0,
      "rest",
      expressionWeightsForEmotion("reassured"),
      () => ({ activeTargetName: null }),
    );
    const cue = slot.root.userData["openClinXrMorphTargetRuntimeCue"] as { drivenTargetNames?: string[] };
    expect(cue.drivenTargetNames).toContain("mouth-corner-puller");
    expect(influences[dict["mouth-corner-puller"]!]).toBeGreaterThanOrEqual(0.4);
  });

  for (const emotion of ["pain", "anxious", "neutral", "concerned"] as const) {
    it(`${emotion} leaves mouth-corner-puller at zero`, () => {
      const dict = Object.fromEntries(PROMOTED_LIB_NAMES.map((name, index) => [name, index]));
      const influences = new Array(PROMOTED_LIB_NAMES.length).fill(0);
      const slot = fakeSlot(dict, influences);
      applyHumanoidMorphTargetCue(
        slot,
        0,
        "rest",
        expressionWeightsForEmotion(emotion),
        () => ({ activeTargetName: null }),
      );
      expect(influences[dict["mouth-corner-puller"]!]).toBe(0);
    });
  }
});
