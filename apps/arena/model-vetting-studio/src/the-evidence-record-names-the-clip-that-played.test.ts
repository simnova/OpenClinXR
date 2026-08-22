import { AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
import { buildAnimationEvidence } from "./candidate-capture.js";
import { selectBodyMotionProbeClip } from "./body-motion-probe-clip.js";

/**
 * OBSERVABLE: the capture's evidence record names the clip the capture actually played.
 *
 * `candidate-capture.ts:328` drives the AnimationMixer from `selectBodyMotionProbeClip(gltf.animations)`
 * - real clips, real tracks. `buildAnimationEvidence` (:742) writes `bodyMotionProbeClipName` from
 * `selectBodyMotionProbeClipName(animationNames)` - names only. The name view rebuilds each candidate
 * as `new AnimationClip(name, -1, [])`, so every rotation count and duration is zero, the content
 * comparators tie, and selection resolves on the name tier alone.
 *
 * `buildAnimationEvidence` ALREADY RECEIVES the tracks. Its parameter is
 * `Array<{ name?: string; tracks?: unknown[] }>` and it reads `.tracks.length` for
 * `totalChannelCount` two lines below. The content is in scope; the function discards it and asks
 * the name view instead.
 *
 * SCOPE, corrected after measuring on current main. Before #560 this diverged on the two real
 * shipped shapes. #560 reordered the ranking to rotationChannels -> nameTier -> duration, and both
 * of those cases now AGREE, because the name tier decides them on either path. The divergence
 * survives only where content would override the name tier - which is exactly the property #558's
 * clause (5) exists to protect. So this is LATENT on everything that ships today and fires the first
 * time an asset carries an unlisted clip with more rotation channels than a listed one.
 *
 * Measured on main before this plant:
 *   divergent  evidence=openclinxr_retarget_cmu_07_01_walk  mixer=zzz_unlisted_motion_clip_v1
 *   shipped    evidence=openclinxr_role_parent_anxious_fidget_guard  mixer=same
 *   empty      bodyMotionProbePresent=false  bodyMotionProbeClipName=null
 *
 * claimScope: whether the evidence record's bodyMotionProbeClipName equals the clip the mixer selects.
 * notEvidenceFor: whether either clip renders correctly, the ranking policy itself (that is #560,
 *   landed), or anything in apps/ui-xr, which does not import this selector.
 */

const rotTrack = (bone: string, duration: number) =>
  new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, duration], [0, 0, 0, 1, 0, 0, 0.1, 0.99]);

const morphTrack = (index: number, duration: number) =>
  new NumberKeyframeTrack(`mesh${index}.morphTargetInfluences[0]`, [0, duration], [0, 1]);

const clip = (name: string, rotationChannels: number, duration: number) =>
  new AnimationClip(name, duration, Array.from({ length: rotationChannels }, (_, i) => rotTrack(`b${i}`, duration)));

/**
 * The one shape where content and the name tier disagree: an unlisted clip with strictly more
 * rotation channels than a clip in the top name tier. #558 clause (5) requires the mixer to pick the
 * unlisted one; nothing yet requires the evidence record to agree.
 */
const CONTENT_OVERRIDES_NAME = [
  clip("zzz_unlisted_motion_clip_v1", 40, 4.0),
  clip("openclinxr_retarget_cmu_07_01_walk", 12, 12.0),
];

/** apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb - measured shapes. */
const SHIPPED_KNOWN_GOOD = [
  clip("openclinxr_clinical_idle_breathing", 23, 2.0),
  clip("openclinxr_posture_shift_standing", 23, 3.75),
  clip("openclinxr_role_parent_anxious_fidget_guard", 23, 2.25),
];

describe("the evidence record names the clip that played", () => {
  it.fails("(1) RED: the evidence record names the mixer's clip when content overrides the name tier", () => {
    const evidence = buildAnimationEvidence(CONTENT_OVERRIDES_NAME);
    expect(
      evidence.bodyMotionProbeClipName,
      "the mixer plays the 40-rotation-channel clip; an evidence record naming the 12-channel one "
        + "describes a capture that did not happen",
    ).toBe(selectBodyMotionProbeClip(CONTENT_OVERRIDES_NAME)?.name);
  });

  it("(2) KNOWN-GOOD COLUMN: on shipped shapes the two already agree, and must keep agreeing", () => {
    // Passes today because #560's name tier decides this case on both paths. A fix that makes the
    // evidence view content-aware must not disturb it.
    const evidence = buildAnimationEvidence(SHIPPED_KNOWN_GOOD);
    expect(evidence.bodyMotionProbeClipName).toBe("openclinxr_role_parent_anxious_fidget_guard");
    expect(evidence.bodyMotionProbeClipName).toBe(selectBodyMotionProbeClip(SHIPPED_KNOWN_GOOD)?.name);
  });

  it("(3) COUNTERWEIGHT: an asset with no clips still reports absent, not a fabricated selection", () => {
    // Refuses the cheap fix - returning animations[0], or the mixer's clip without checking there is
    // one. `bodyMotionProbePresent` gates whether a body-motion capture is claimed at all.
    const evidence = buildAnimationEvidence([]);
    expect(evidence.bodyMotionProbeClipName, "no clips means no selection").toBeNull();
    expect(evidence.bodyMotionProbePresent, "absence must stay reportable").toBe(false);
  });

  it("(4) COUNTERWEIGHT: a clip carrying no rotation channels is never named as the body-motion clip", () => {
    // Refuses the other cheap fix - ranking by track count rather than ROTATION track count, which
    // would let a morph-only expression clip win on an asset that ships many of them.
    // The morph clip carries MORE tracks than the role clip (30 vs 23) and none of them rotate, so
    // a ranker keyed on tracks.length puts it first while one keyed on rotation channels puts it
    // last. A fixture with zero tracks either way cannot tell those apart - the first draft of this
    // clause had exactly that hole and a track-count substitution walked straight through it.
    const morphOnly = [
      new AnimationClip("openclinxr_conversation_expression_morphs", 9.0,
        Array.from({ length: 30 }, (_, i) => morphTrack(i, 9.0))),
      clip("openclinxr_role_nurse_clinical_check_reassure", 23, 2.0),
    ];
    const evidence = buildAnimationEvidence(morphOnly);
    expect(
      evidence.bodyMotionProbeClipName,
      "a 9-second morph-only clip has no bones rotating; it is not body motion at any duration",
    ).toBe("openclinxr_role_nurse_clinical_check_reassure");
  });
});
