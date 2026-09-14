import type { AnimationClip, AnimationMixer } from "three";

/**
 * Resolve a motion-manifest address (clipId) onto a mixer. Only the addressed clip
 * is started; other clips in the set are left stopped.
 */
export function playManifestMotionClip(input: {
  mixer: AnimationMixer;
  manifestAddress: { clipId: string };
  clips: AnimationClip[];
}): string {
  const clip = input.clips.find((candidate) => candidate.name === input.manifestAddress.clipId);
  if (!clip) {
    throw new Error(`playManifestMotionClip: no clip named "${input.manifestAddress.clipId}"`);
  }
  const action = input.mixer.clipAction(clip);
  action.reset();
  action.play();
  return input.manifestAddress.clipId;
}
