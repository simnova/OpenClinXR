import { AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
import { selectBodyMotionProbeClip } from "./body-motion-probe-clip.js";

/**
 * OBSERVABLE: body-motion-probe selection prefers a clip whose bones actually rotate.
 *
 * `rankBodyMotionProbeClips` counts rotation CHANNELS. That is a presence measure. A clip can carry
 * 137 quaternion tracks and rotate nothing, and the ranker cannot tell it from one that rotates
 * everything - the counts tie and the name tier decides.
 *
 * MEASURED from the GLB accessors of the shipped assets, per rotation channel, as maximum angular
 * travel from the first keyframe, aggregated over all 137 channels:
 *
 *   ClinicalIdleConversation                 137ch   max  5.73 deg   mean  0.11 deg
 *   openclinxr_retarget_seated_talking_cc0   137ch   max 87.24 deg   mean 13.92 deg
 *   openclinxr_retarget_cmu_07_01_walk       137ch   max 97.68 deg   mean  7.28 deg
 *
 * The idle clip is effectively frozen and it is what the selector chose between #558 and #560. That
 * is the whole "identical standing stance" symptom, explained without appeal to the renderer.
 *
 * Today the real pair resolves correctly only because #560's name tier happens to favour the
 * retarget. Nothing measures motion, so a frozen clip with a favourable name wins - measured before
 * this plant:
 *
 *   frozen `openclinxr_retarget_frozen_pose_v1` vs moving `zzz_unlisted_real_motion_v1`
 *     -> selector returns the FROZEN clip
 *
 * NOTE ON MAX VS MEAN, and it is why clause (4) exists: the idle clip's MAX travel is 5.73 deg, which
 * is not obviously frozen. Its MEAN is 0.11 deg. A ranker keyed on the single most-travelled bone
 * would call it alive. The discriminator is the aggregate, not the extreme.
 *
 * Every assertion here is COMPARATIVE. No angular threshold appears, deliberately: a number in a
 * contract becomes the design target for the thing being measured, and the clips are the thing being
 * measured.
 *
 * claimScope: which clip `selectBodyMotionProbeClip` returns when candidates differ in how much
 *   their bones rotate.
 * notEvidenceFor: whether any clip renders correctly, skin binding, weights, or the learner runtime.
 */

const CHANNELS = 137; // the real rig's rotation-channel count on every shipped MPFB body clip

/** A quaternion track that never leaves identity: a channel that exists and rotates nothing. */
const frozenTrack = (bone: string, duration: number) =>
  new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, duration], [0, 0, 0, 1, 0, 0, 0, 1]);

/** A quaternion track sweeping ~45 degrees about X. */
const movingTrack = (bone: string, duration: number) =>
  new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, duration], [0, 0, 0, 1, 0.3826, 0, 0, 0.9239]);

const clipOf = (
  name: string,
  duration: number,
  track: (bone: string, duration: number) => QuaternionKeyframeTrack,
  movingChannels = CHANNELS,
) => new AnimationClip(name, duration, Array.from({ length: CHANNELS }, (_, i) =>
  (i < movingChannels ? track : frozenTrack)(`b${i}`, duration)));

describe("a frozen clip does not outrank a moving one", () => {
  it("(1) RED: a clip whose bones never rotate loses to one whose bones do", () => {
    // Equal channel counts and equal duration, so the name tier is the only thing separating them
    // today - and it points at the frozen clip.
    const candidates = [
      clipOf("openclinxr_retarget_frozen_pose_v1", 3.75, frozenTrack),
      clipOf("zzz_unlisted_real_motion_v1", 3.75, movingTrack),
    ];
    expect(
      selectBodyMotionProbeClip(candidates)?.name,
      "137 quaternion tracks that never leave identity are not body motion, whatever the clip is "
        + "called; this is the ClinicalIdleConversation shape that produced every static capture",
    ).toBe("zzz_unlisted_real_motion_v1");
  });

  /**
   * ## FIXED (#566)
   *
   * Ranking now leads with aggregate rotation travel (sum over rotation channels of the max
   * geodesic angle from the channel's first key), ahead of channel count. Chosen because the
   * measured table is an aggregate story - idle mean 0.11 deg vs seated 13.92 deg - and an
   * extreme keyed on the single most-travelled bone would call the idle alive at 5.73 deg max.
   * Frozen channels contribute exactly zero regardless of key count; morph-only clips still
   * contribute nothing. All three planted REDs flipped on the first fixed run; clauses (2)
   * and (5) passed unchanged.
   */

  it("(2) KNOWN-GOOD COLUMN: the real shipped pair still selects the retargeted clip", () => {
    // Passes today via the name tier. It must keep passing when motion becomes the discriminator -
    // and it should, because the seated clip measures 13.92 deg mean against the idle's 0.11.
    const real = [
      clipOf("ClinicalIdleConversation", 3.75, frozenTrack),
      clipOf("openclinxr_retarget_seated_talking_cc0", 3.71, movingTrack),
    ];
    expect(selectBodyMotionProbeClip(real)?.name).toBe("openclinxr_retarget_seated_talking_cc0");
  });

  it("(3) RED: 10 moving channels lose to 137, whatever the names say", () => {
    // Same cause as (1) from another angle, and mislabelled in the first draft of this file: both
    // clips carry 137 CHANNELS, so the ranker ties and the name tier hands it to the listed clip.
    // Channel count is presence; moving-channel count is not measured at all.
    const candidates = [
      clipOf("openclinxr_retarget_cmu_07_01_walk", 12.0, movingTrack, 10),
      clipOf("zzz_unlisted_whole_body_v1", 3.0, movingTrack),
    ];
    expect(
      selectBodyMotionProbeClip(candidates)?.name,
      "10 moving channels against 137; the listed name must not carry a clip that moves less",
    ).toBe("zzz_unlisted_whole_body_v1");
  });

  it("(5) COUNTERWEIGHT: a morph-only clip never wins, at any duration", () => {
    // Passes today and must survive. Refuses the over-correction of ranking on \"any track that
    // changes\": a 20-second expression clip changes plenty and rotates no bone. The shipped assets
    // all carry one (openclinxr_conversation_expression_morphs, 0 rotation channels).
    const morphOnly = new AnimationClip("openclinxr_conversation_expression_morphs", 20.0,
      Array.from({ length: 200 }, (_, i) => new NumberKeyframeTrack(`m${i}.morphTargetInfluences[0]`, [0, 20], [0, 1])));
    const candidates = [morphOnly, clipOf("zzz_unlisted_whole_body_v1", 2.0, movingTrack)];
    expect(
      selectBodyMotionProbeClip(candidates)?.name,
      "200 morph tracks over 20 seconds rotate no bone, and outnumber the rig's 137 rotation "
        + "channels; a ranker keyed on any changing track picks the face clip",
    ).toBe("zzz_unlisted_whole_body_v1");
  });

  it("(4) RED + COUNTERWEIGHT: one wildly-moving bone does not beat a whole body moving less", () => {
    // Refuses ranking on the EXTREME. The shipped idle clip's max travel is 5.73 deg while its mean
    // is 0.11 - a max-keyed ranker calls it alive. The aggregate is the discriminator, and a clip
    // with a single flailing bone is not a body-motion clip.
    const candidates = [
      clipOf("openclinxr_retarget_one_bone_flail_v1", 3.75, movingTrack, 1),
      clipOf("zzz_unlisted_whole_body_v1", 3.75, movingTrack),
    ];
    expect(
      selectBodyMotionProbeClip(candidates)?.name,
      "1 moving channel against 137: the extreme is equal, the aggregate is not",
    ).toBe("zzz_unlisted_whole_body_v1");
  });

  /**
   * ## FIXED (#566)
   *
   * Clauses (3) and (4) flipped on the same fixed run as clause (1): aggregate travel leads
   * the ranking, ahead of channel count, so 137 moving channels outrank 10 and 137 outrank
   * 1. Clause (4)'s two clips carry identical per-channel extremes (the same ~45 deg sweep);
   * only the summed aggregate separates them, which is exactly why an extreme-keyed ranker
   * could never pass this clause. The relabelled-from-counterweight history of (3), recorded
   * in the immutable header above, stands as planted.
   */
});
