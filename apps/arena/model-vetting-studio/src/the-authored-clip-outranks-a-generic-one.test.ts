import { AnimationClip, QuaternionKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
import {
  selectBodyMotionProbeClip,
  selectBodyMotionProbeClipName,
} from "./body-motion-probe-clip.js";

/**
 * OBSERVABLE: a body_motion_probe capture plays the clip the CASE authored for that actor, not
 * whichever generic clip happens to be longest.
 *
 * #558 removed a name allowlist and replaced it with a content ranking: rotation-channel count,
 * then duration, then a name tier. That removed a real admission gate - an unlisted clip used to
 * resolve to null and render a static bind pose - and it is not to be reverted. But on every
 * shipped humanoid the body clips TIE on rotation-channel count, so duration decides alone, and
 * duration does not carry authored intent.
 *
 * ALL SHAPES BELOW ARE MEASURED, not chosen. Read from each GLB's JSON chunk (channels whose
 * target.path === "rotation"; duration = max accessor.max[0] over the animation's samplers).
 * No number in this file is a design target: change the ranking, not the assets.
 *
 * KNOWN-GOOD COLUMN is the SAME ASSET before #557 rebound it. `mpfb-peds-parent-aisha.motion-bind`
 * carried a 13.21 s walk clip and selected correctly; after #557 it carries a 3.71 s seated clip and
 * loses to a 3.75 s idle by 40 ms. The control and the defect differ by one rebake, not by fixture
 * construction.
 *
 * claimScope: which AnimationClip the body-motion-probe selector returns for a given clip set.
 * notEvidenceFor: whether the selected clip renders a correct pose, the quality of any retarget,
 *   the learner runtime (apps/ui-xr does not import this selector), or any past capture artifact.
 */

/**
 * ## FIXED (#560)
 *
 * Ranking reordered to rotationChannels → nameTier → duration (was rotationChannels → duration
 * → nameTier). On shipped GLBs all body clips tie at 23 rotation channels, so duration alone
 * decided; duration carries no authored intent (40 ms margins decide between authored and
 * generic clips). The #558 name tiers are provenance weights, not an admission gate: promoting
 * them above duration orders authored clips first while every clip still ranks - clause (5)
 * still refuses any membership test. Policy chosen by this slice per the brief ("the ranking
 * policy is yours to choose"); rejected alternatives recorded in the issue:
 * rotation-magnitude ranking (no measured reason it separates real-authored pairs) and
 * allowlist restoration (clause 5 refuses; re-authors the static-bind defect).
 */

const rotTrack = (bone: string, duration: number) =>
  new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, duration], [0, 0, 0, 1, 0, 0, 0.1, 0.99]);

/** Build a clip with a measured rotation-channel count and a measured duration. */
const clip = (name: string, rotationChannels: number, duration: number) =>
  new AnimationClip(name, duration, Array.from({ length: rotationChannels }, (_, i) => rotTrack(`b${i}`, duration)));

/** apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb - representative of all 7 role-clip assets. */
const SHIPPED_ANNY_RAIL = [
  clip("openclinxr_clinical_idle_breathing", 23, 2.0),
  clip("openclinxr_conversation_listen_nod", 23, 2.25),
  clip("openclinxr_posture_shift_standing", 23, 3.75),
  clip("openclinxr_role_parent_anxious_fidget_guard", 23, 2.25),
  clip("openclinxr_conversation_expression_morphs", 0, 1.33),
];

/** apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb, after #557. */
const SEATED_REBIND = [
  clip("ClinicalIdleConversation", 137, 3.75),
  clip("openclinxr_retarget_seated_talking_cc0", 137, 3.71),
  clip("ClinicalExpressionMicroTransition", 0, 3.75),
];

/** The same asset at glb-grade-staging/2026-08-18T11-49-34Z - before #557 rebound it. */
const WALK_REBIND_KNOWN_GOOD = [
  clip("ClinicalIdleConversation", 137, 3.75),
  clip("openclinxr_retarget_cmu_07_01_walk", 137, 13.21),
  clip("ClinicalExpressionMicroTransition", 0, 3.75),
];

describe("the authored clip outranks a generic one", () => {
  it("(1) RED: a shipped Anny-rail humanoid selects its own role clip, not the longest generic one", () => {
    expect(
      selectBodyMotionProbeClip(SHIPPED_ANNY_RAIL)?.name,
      "all four body clips tie at 23 rotation channels, so duration alone decides and "
        + "openclinxr_posture_shift_standing wins at 3.75 s; the case authored the role clip",
    ).toBe("openclinxr_role_parent_anxious_fidget_guard");
  });

  it("(2) RED: the retargeted seated clip outranks an idle 40 ms longer than it", () => {
    expect(
      selectBodyMotionProbeClip(SEATED_REBIND)?.name,
      "137 rotation channels each; the idle wins on 3.75 s vs 3.71 s, so the capture renders a "
        + "standing idle for an actor whose case bound a seated clip",
    ).toBe("openclinxr_retarget_seated_talking_cc0");
  });

  it("(3) KNOWN-GOOD COLUMN: the same asset before #557 still selects its walk clip", () => {
    // Pins the behaviour that works today. A fix that special-cases the seated or role names and
    // drops this cannot pass, and this column is a real earlier bake of the SAME asset.
    expect(
      selectBodyMotionProbeClip(WALK_REBIND_KNOWN_GOOD)?.name,
      "the 13.21 s walk clip selected and played before this slice; that must survive",
    ).toBe("openclinxr_retarget_cmu_07_01_walk");
  });

  it("(4) RED + COUNTERWEIGHT: the mixer view and the evidence view agree on every measured asset", () => {
    // candidate-capture.ts:328 drives the AnimationMixer from selectBodyMotionProbeClip, while :744
    // writes the evidence record from selectBodyMotionProbeClipName. Fixing only one leaves the
    // capture's own evidence naming a clip it did not render. Both must resolve identically.
    for (const [label, clips] of [
      ["shipped_anny_rail", SHIPPED_ANNY_RAIL],
      ["seated_rebind", SEATED_REBIND],
      ["walk_known_good", WALK_REBIND_KNOWN_GOOD],
    ] as const) {
      expect(
        selectBodyMotionProbeClipName(clips.map((c) => c.name)),
        `${label}: the name view and the content view must name the same clip`,
      ).toBe(selectBodyMotionProbeClip(clips)?.name ?? null);
    }
  });

  it("(5) COUNTERWEIGHT: there is still no admission allowlist", () => {
    // Refuses the rejected treatment - restoring #558's name gate. A clip matching no known pattern,
    // carrying strictly the most rotation channels, must still win outright. This passes today and
    // must keep passing: the fix is to the ranking, never a return to a membership test.
    const unlisted = [
      clip("zzz_unlisted_motion_clip_v1", 40, 4.0),
      clip("openclinxr_retarget_cmu_07_01_walk", 12, 12.0),
    ];
    expect(
      selectBodyMotionProbeClip(unlisted)?.name,
      "40 rotation channels beats 12 regardless of name; reintroducing a membership gate fails here",
    ).toBe("zzz_unlisted_motion_clip_v1");
  });
});
