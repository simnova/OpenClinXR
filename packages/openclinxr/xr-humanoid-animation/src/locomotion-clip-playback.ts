import type { GeneratedHumanoidAnimationSlot } from "./types.js";

/**
 * Play this actor's retargeted locomotion take, if it has one, instead of sliding its root.
 *
 * Returns false when there is nothing to play, and the caller then does what it always did.
 *
 * THE CLIP CLAIMS THE LEG CHAIN. `openClinXrOwnedBoneChains` is the existing seam by which a motion
 * executor tells the posture pass to leave bones alone; without it `applyIdlePosture` rewrites the
 * legs every frame and the walk is overwritten by a standing pose.
 *
 * The drive scalar gates PLAYBACK, not speed: the clip's own ground speed is 1.115 m/s, measured
 * from its root track, and rescaling it would reintroduce the sliding this exists to remove.
 */
export function playLocomotionClip(slot: GeneratedHumanoidAnimationSlot, locomotion: number): boolean {
  const clipName = slot.locomotionClipName;
  const mixer = slot.mixer;
  if (!clipName || !mixer) return false;
  const clip = slot.responseClips?.find((candidate: { name: string }) => candidate.name === clipName);
  if (!clip) return false;
  const action = mixer.clipAction(clip);
  const rootUserData = slot.root.userData as Record<string, unknown>;
  if (locomotion <= 0) {
    if (action.isRunning()) action.stop();
    rootUserData["openClinXrOwnedBoneChains"] = [];
    rootUserData["openClinXrLocomotionClipPlayback"] = { clipName, playing: false };
    return true;
  }
  if (!action.isRunning()) action.reset().play();
  rootUserData["openClinXrOwnedBoneChains"] = LOCOMOTION_OWNED_BONE_CHAINS;
  rootUserData["openClinXrLocomotionClipPlayback"] = {
    clipName,
    playing: true,
    timeSeconds: action.time,
    mode: "retargeted_clip_drives_the_leg_chain",
    notEvidenceFor: "gait realism, clinical plausibility, or Quest readiness",
  };
  return true;
}

/** The chains a locomotion take owns while it plays, so the posture pass leaves them alone. */
const LOCOMOTION_OWNED_BONE_CHAINS = ["upperleg", "lowerleg", "foot", "toe", "pelvis", "root"] as const;
