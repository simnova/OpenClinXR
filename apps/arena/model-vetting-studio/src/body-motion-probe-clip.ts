import { AnimationClip } from "three";

/**
 * OBSERVABLE: body_motion_probe captures play the subject's motion clip, whatever it is called.
 *
 * Replaces the #558 name allowlist (see tools/openclinxr/evidence/
 * the-capture-selects-the-subjects-motion-clip.test.ts): selection is by CONTENT - most
 * rotation channels first (body motion = bones rotating), then longest duration, name only
 * as a final tiebreak among otherwise-equal clips. There is no admission allowlist: an
 * unlisted clip still ranks and stays selectable, so a new clip name can never again
 * silently render a static bind pose. The tie ladders exist because some assets ship several
 * near-static clips; they demote known non-body micro-animation (eye probes, expression
 * transitions) rather than gate which clips may play.
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
  const durationOf = (clip: AnimationClip): number => {
    let maxEnd = 0;
    for (const track of clip.tracks) {
      const last = track.times[track.times.length - 1];
      if (last !== undefined && last > maxEnd) maxEnd = last;
    }
    return maxEnd;
  };
  return [...animations].sort((a, b) =>
    rotationChannelCount(b) - rotationChannelCount(a)
    || durationOf(b) - durationOf(a)
    || bodyMotionNameTiebreakWeight(b.name) - bodyMotionNameTiebreakWeight(a.name)
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
