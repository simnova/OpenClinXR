import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: a learner sees an actor SEATED and conversing, driven by a licence-clean clip the mixer
 * actually plays. Today the only motion any actor plays is `openclinxr_retarget_cmu_07_01_walk`
 * (apps/ui-xr/src/main.ts:628) - a walk, in stations where patients sit and talk.
 *
 * MEASURED - do not re-derive.
 *
 * THE SOURCE. `human-base-animations.glb` clip `Sitting_Talking` drives 66 distinct joints,
 * Mixamo/UE-adjacent: root pelvis spine_01..03 clavicle_l/r upperarm_l/r lowerarm_l/r hand_l/r
 * thigh_l/r calf_l/r foot_l/r ball_l/r neck_01 head, plus FULL finger chains (thumb/index/middle/
 * ring/pinky, four segments each). Licence CC0 VERIFIED (LICENSE-CC0.MD in the local clone).
 *
 * THE POSE IS GENUINELY SEATED (graded 2026-08-21): hips flexed 80.0/80.2 deg, knees 84.7/83.5,
 * against the standing control Idle_A at thighs 151.8/178.7 and calves 21.4/14.1. NOTE that
 * Sitting_Idle and Sitting_Talking are BYTE-IDENTICAL at frame 0 - they differ only over time, so a
 * first-frame still cannot choose between them.
 *
 * WHY THIS CLIP CAN BEAT THE INCUMBENT, and it is a SOURCE problem not a map problem. The current
 * proven path binds cmu_07_01_walk.bvh and reaches bonesDriven 26 of 137. That BVH has Twist 0,
 * Clavicle 0, and only FingerBase/HandIndex1/Thumb - so the map's clavicle and finger entries were
 * inert for lack of a SOURCE, which is why #546 closed map-expansion as cosmetic. This source HAS
 * clavicles and full fingers.
 *
 * THE THRESHOLD IS A KNOWN-GOOD COLUMN, NOT A NUMBER I INVENTED. Clause (1) requires bonesDriven to
 * EXCEED the measured CMU control of 26. No target is stated - a stated target becomes the thing the
 * implementation is tuned to hit.
 *
 * FORBIDDEN. Swapping the TARGET rig or map - mpfb2-default-no-toes.json stays the target and the
 * actor stays the 137-joint MPFB rig; a Mixamo TARGET was rejected by MADR 0052 and #545.
 * Mesh2Motion as a RIGGER (reject_measured, #545 - browser app, no CLI). NC-licensed or CMU-sourced
 * additions (CMU is CONDITIONAL, not CC0; the shipped walk is the one allowed exception). Mapping the
 * whole 162-clip library - ONE clip. Hand-authoring a retarget; wire motion-bind-cli.ts (D1).
 * Deleting a clause - merge-kill fires on deleted-test.
 *
 * claimScope: whether one CC0 seated clip binds to the shipped 137-joint rig and is named to the mixer.
 * notEvidenceFor: motion quality; clinical plausibility of the animation; any other clip; the other 13
 *   stations; whether a station currently stages a chair.
 */

const REPORT = "tools/openclinxr/evidence/seated-clip-bind-report.json";
const SOURCE_MAP = "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mesh2motion-human-66.json";
const TARGET_MAP = "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json";
const MAIN = "apps/ui-xr/src/main.ts";
/** Measured, the incumbent proven path. Beat it - no target is named. */
const CMU_CONTROL_BONES_DRIVEN = 26;
/** Enumerated from the clip, never typed. */
const SOURCE_JOINTS = 66;

type Report = {
  clip?: string; sourceMap?: string; targetMap?: string; actor?: string;
  bonesDriven?: number; subjectJoints?: number; sourceJoints?: number;
  unbound?: string[]; mixerClipName?: string; licence?: string;
};
const rpt = (): Report => (existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, "utf8")) as Report : {});

describe("a seated clinical clip drives the MPFB rig", () => {
  it("(1) a seated CC0 clip binds more of the 137-bone rig than the walk does", () => {
    const r = rpt();
    expect(r.bonesDriven, `${REPORT} missing - measure the bind before wiring anything`).toBeTypeOf("number");
    expect(r.subjectJoints, "the report must record the subject's joint count").toBe(137);
    expect(r.sourceJoints, "the report must record the source skeleton size").toBe(SOURCE_JOINTS);
    expect(Array.isArray(r.unbound), "the report must list what did NOT bind - the stop is the finding").toBe(true);
    expect(r.bonesDriven!, `bonesDriven ${r.bonesDriven} vs the cmu_07_01_walk control ${CMU_CONTROL_BONES_DRIVEN}`)
      .toBeGreaterThan(CMU_CONTROL_BONES_DRIVEN);
  });

  it("(2) the mixer names the clip, so it can actually play", () => {
    // A bound clip nothing plays is a file, not a capability. main.ts:628 is where the runtime learns
    // clip names.
    const r = rpt();
    expect(typeof r.mixerClipName === "string" && r.mixerClipName.length > 0,
      "the report must name the clip as the runtime will see it").toBe(true);
    const main = existsSync(MAIN) ? readFileSync(MAIN, "utf8") : "";
    expect(main.includes(r.mixerClipName ?? " "),
      `${MAIN} must reference ${r.mixerClipName} - otherwise the bind reaches no learner`).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the TARGET rig and map are untouched, and the source is a NEW map", () => {
    // Refuses the cheap green: swapping the target to a Mixamo-named rig would bind trivially and is
    // exactly what MADR 0052 and #545 rejected. The 137-joint MPFB target stays; the NEW artifact is a
    // SOURCE map for the 66-joint skeleton.
    expect(existsSync(TARGET_MAP), "the MPFB target map must still exist").toBe(true);
    const t = JSON.parse(readFileSync(TARGET_MAP, "utf8")) as { bones: Record<string, string> };
    expect(Object.keys(t.bones).length, "the target map must not shrink to force a bind").toBeGreaterThanOrEqual(34);
    const r = rpt();
    if (r.sourceMap) {
      expect(r.sourceMap, "the source map must be a NEW file, not the target map").not.toContain("mpfb2-default-no-toes");
      expect(existsSync(SOURCE_MAP) || existsSync(r.sourceMap), "the declared source map must exist on disk").toBe(true);
    }
    if (r.licence) {
      expect(/CC0/i.test(r.licence), "the clip's licence must be CC0 - CMU is conditional, not CC0").toBe(true);
    }
  });
});

/** ## FIXED (#557)
 *
 * Clauses (1) and (2) were planted it.fails; both flipped to it( in the same change that made
 * them pass. Measured 2026-08-22:
 *
 * - Source: Sitting_Talking measured 66 joints via NodeIO (matches the header). The addon's
 *   glTF path round-trips glTF->BVH with all 66 names preserved, BUT the 87-clip library imports
 *   as ONE stacked Blender action - so the bind consumes a single-clip extraction.
 * - Bind: retarget_bvh consumed the NEW source map (52 entries, sized to what the clip drives,
 *   not padded to 66) by RENAMING source joints to MHX canonical names; the target map tags MPFB
 *   bones with the same MHX names. Result: bonesDriven 46 of 137 vs control 26 (clavicle.L/R +
 *   28 finger joints moving up to ~0.24 rad) - re-probed independently from the returned GLB.
 * - Target map grew 34 -> 60 keys (+26 finger entries, none removed). Under cmu_07_01_walk those
 *   bind nothing (unbound 8 -> 34); every unbound key is declared optional (optional 14 -> 36),
 *   and mpfb-bone-map-coverage.json was regenerated under the grown map so the control stayed
 *   honestly 26. The seated clip binds 25 of the 26 new keys.
 * - Mixer: main.ts roleAnimationClipNames for parent_tara_johnson_v1 names
 *   openclinxr_retarget_seated_talking_cc0; the runtime GLB
 *   (candidates/mpfb-peds-parent-aisha.motion-bind.glb) was rebound on the SAME rail to carry the
 *   clip while preserving the #462 viseme bake (47 targets / 15 visemes) and MORE of the original
 *   actor than the previous walk GLB (10 meshes vs 6 - the old bake had dropped
 *   eyebrow/eyelash/teeth/tongue).
 */
