import { describe, expect, it } from "vitest";
import { selectBodyMotionProbeClipName } from "../../../apps/arena/model-vetting-studio/src/candidate-capture.js";

/**
 * OBSERVABLE: body_motion_probe captures play the subject's motion clip, whatever it is called.
 *
 * MEASURED 2026-08-22, do not re-derive. #557 bound a CC0 seated clip to the peds parent and every
 * capture frame at t=2s/5s/8s showed an identical standing stance. The mixer is NOT missing -
 * candidate-capture.ts:324-329 constructs an AnimationMixer, calls clipAction and play(), guarded on
 * a clip selector. The selector returned null.
 *
 * candidate-capture.ts:757 selectBodyMotionProbeClipName matches a hardcoded NAME allowlist:
 *   /mpfb_body_motion_probe|role_patient_asthma_breathing_effort|role_parent_anxious_fidget_guard|
 *    role_nurse_clinical_check_reassure|retarget_cmu|cmu_07_01_walk/u
 * with fallback /posture|standing|clinical|conversation|idle/u and NO i flag.
 *
 * Executed against the real clip lists:
 *   seated GLB -> null            (allowlist has retarget_cmu, not retarget_seated;
 *                                  fallback is case-sensitive and these names are CamelCase)
 *   walk   GLB -> openclinxr_retarget_cmu_07_01_walk
 *
 * Two independent defects both had to fire for the render to be static.
 *
 * FAILED TREATMENT, rejected 2026-08-22 by the product owner: widening the allowlist with the seated
 * name. Name matching over a set the pipeline itself generates is the marker-check pattern this repo
 * has withdrawn repeatedly; widening re-authors the defect with more entries. Selection must be by
 * CONTENT - most rotation channels, tiebreak longest duration, name only as a tiebreak.
 *
 * KNOWN-GOOD COLUMN: the walk GLB. It selects and plays today. Clause (2) pins it, so the cheapest
 * cheat - hardcoding the seated name - cannot pass, because both lists must resolve through the same
 * path.
 *
 * claimScope: which animation the capture harness selects for body_motion_probe.
 * notEvidenceFor: whether the selected clip renders correctly; the seated pose; any past artifact.
 */

/** The three clips shipped on mpfb-peds-parent-aisha.motion-bind.glb after #557. */
const SEATED_GLB_CLIPS = [
  "ClinicalIdleConversation",
  "openclinxr_retarget_seated_talking_cc0",
  "ClinicalExpressionMicroTransition",
] as const;

/** The same asset before #557. Known-good: this resolved and played. */
const WALK_GLB_CLIPS = [
  "ClinicalIdleConversation",
  "openclinxr_retarget_cmu_07_01_walk",
  "ClinicalExpressionMicroTransition",
] as const;

describe("the capture harness selects the subject's motion clip", () => {
  it("(1) a retargeted seated clip is selected for body_motion_probe", () => {
    expect(
      selectBodyMotionProbeClipName([...SEATED_GLB_CLIPS]),
      "the seated clip must be selected; null means the mixer is never constructed and the capture "
        + "renders a static bind pose under camera orbit",
    ).toBe("openclinxr_retarget_seated_talking_cc0");
  });

  it("(2) KNOWN-GOOD COLUMN: the walk clip still selects", () => {
    // Pins the reference behaviour. A fix that hardcodes the seated name and drops the walk fails
    // here, so clause (1) cannot be satisfied by naming one more special case.
    expect(
      selectBodyMotionProbeClipName([...WALK_GLB_CLIPS]),
      "the walk clip selected and played before this slice; that must survive",
    ).toBe("openclinxr_retarget_cmu_07_01_walk");
  });

  it("(3) COUNTERWEIGHT: selection does not depend on a name allowlist", () => {
    // Refuses the rejected treatment. A clip whose name matches nothing in the current allowlist,
    // carrying obvious motion content, must still be selectable. Content decides, names tiebreak.
    const unnamedMotion = ["ClinicalExpressionMicroTransition", "zzz_unlisted_motion_clip_v1"];
    const picked = selectBodyMotionProbeClipName(unnamedMotion);
    expect(
      picked,
      "a motion clip whose name is in no allowlist must still be selectable - otherwise every new "
        + "clip name is a silent static render",
    ).not.toBeNull();
  });
});
