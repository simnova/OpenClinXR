import { AnimationClip } from "three";

/**
 * OBSERVABLE: body_motion_probe captures play the subject's motion clip, whatever it is called.
 *
 * Replaces the #558 name allowlist (see tools/openclinxr/evidence/
 * the-capture-selects-the-subjects-motion-clip.test.ts): selection is by CONTENT - most
 * aggregate rotation TRAVEL first, then most rotation channels, then authored-provenance
 * name tier, then longest duration. There is no admission allowlist: an unlisted clip still
 * ranks and stays selectable, so a new clip name can never again silently render a static
 * bind pose.
 *
 * #560 reordered tier above duration. Measured on shipped GLBs, every body clip ties at 23
 * rotation channels, so duration alone decided - and duration carries no authored intent:
 * openclinxr_posture_shift_standing (3.75 s) beat the 2.25 s role clip, and
 * ClinicalIdleConversation (3.75 s) beat a 3.71 s bound seated clip by 40 ms. The tiers are
 * weights, not a gate: they ORDER clips by authored provenance (role/retarget clips up,
 * eye/expression micro-animation down) without excluding anything - a clip matching no
 * pattern with strictly more rotation channels still wins outright.
 *
 * ## FIXED (#566)
 *
 * Channel COUNT alone is a presence measure: ClinicalIdleConversation carries 137 quaternion
 * tracks and rotates nothing (measured per channel as max angular travel from the first
 * keyframe, aggregated over all 137: idle max 5.73 deg / mean 0.11 deg vs seated retarget
 * mean 13.92 deg), yet outranked moving clips whenever the name tier agreed. Ranking now
 * leads with aggregate rotation travel: sum over rotation channels of the geodesic angle
 * between each quaternion and its channel's first keyframe. Aggregate, not extreme - a
 * single flailing bone must not out-rank a whole-body clip whose every bone moves less
 * (idle max 5.73 deg against mean 0.11 deg defeats a max-keyed ranker). Travel is
 * scale-free (no duration term) and morph tracks contribute nothing, so expression-only
 * clips stay below any rotating clip. A frozen clip now ranks last among candidates with
 * equal name/duration weight instead of tying on presence alone.
 */
const BODY_MOTION_NAME_TIEBREAK_TIERS: Array<{ weight: number; pattern: RegExp }> = [
  { weight: -1, pattern: /mpfb2_eye_look_probe|expression_micro_transition|viseme/iu },
  { weight: 1, pattern: /role_(patient|parent|nurse)_/u },
  { weight: 2, pattern: /mpfb_body_motion_probe|openclinxr_retarget_|retarget_cmu|cmu_07_01_walk/u },
];

function bodyMotionNameTiebreakWeight(name: string | undefined): number {
  let weight = 0;
  for (const tier of BODY_MOTION_NAME_TIEBREAK_TIERS) {
    if (name && tier.pattern.test(name)) weight += tier.weight;
  }
  return weight;
}

export function rankBodyMotionProbeClips(animations: AnimationClip[]): AnimationClip[] {
  const rotationChannelCount = (clip: AnimationClip): number =>
    clip.tracks.filter((track) => track.name.endsWith(".quaternion")).length;
  // Aggregate rotation travel in radians: for each quaternion channel, the largest geodesic
  // angle between any key and the channel's first key, summed across channels. A frozen
  // channel contributes 0 however many keys it carries; morph tracks contribute nothing.
  const rotationTravel = (clip: AnimationClip): number => {
    let travel = 0;
    for (const track of clip.tracks) {
      if (!track.name.endsWith(".quaternion")) continue;
      const values = Array.from(track.values);
      if (values.length < 8) continue;
      const [firstX = 0, firstY = 0, firstZ = 0, firstW = 0] = values;
      let maxAngle = 0;
      for (let offset = 4; offset + 3 < values.length; offset += 4) {
        const [x = 0, y = 0, z = 0, w = 0] = values.slice(offset, offset + 4);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(
          x * firstX + y * firstY + z * firstZ + w * firstW,
        )));
        if (angle > maxAngle) maxAngle = angle;
      }
      travel += maxAngle;
    }
    return travel;
  };
  const durationOf = (clip: AnimationClip): number => {
    let maxEnd = 0;
    for (const track of clip.tracks) {
      const last = track.times[track.times.length - 1];
      if (last !== undefined && last > maxEnd) maxEnd = last;
    }
    return maxEnd;
  };
  return [...animations].sort((a, b) =>
    rotationTravel(b) - rotationTravel(a)
    || rotationChannelCount(b) - rotationChannelCount(a)
    || bodyMotionNameTiebreakWeight(b.name) - bodyMotionNameTiebreakWeight(a.name)
    || durationOf(b) - durationOf(a)
    || animations.indexOf(a) - animations.indexOf(b));
}

export function selectBodyMotionProbeClip(animations: AnimationClip[]): AnimationClip | undefined {
  return rankBodyMotionProbeClips(animations)[0];
}

/** Name-only view used by evidence surfaces; derives from the same content ranking as the mixer path. */
export function selectBodyMotionProbeClipName(animationNames: string[]): string | null {
  const placeholders = animationNames.map((name) => new AnimationClip(name, -1, []));
  return selectBodyMotionProbeClip(placeholders)?.name ?? null;
}
