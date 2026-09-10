import type { GeneratedHumanoidAnimationSlot } from "./types.js";

/**
 * Play this actor's retargeted locomotion take, if it has one, instead of sliding its root.
 *
 * Returns false when there is nothing to play, and the caller then does what it always did.
 *
 * THE CLIP CLAIMS THE LEG CHAIN. `openClinXrOwnedBoneChains` is the existing seam by which a motion
 * executor tells the posture pass to leave bones alone.
 *
 * THE CLAIM WAS THE WRONG SHAPE AND THEREFORE INERT, measured on the unchanged tree at 86dc0300.
 * This file wrote a `string[]` of chain CATEGORIES (`["upperleg", "lowerleg", …]`) while the reader,
 * `clinical-idle-posture.ts:263-265`, filters for `{ownerId, boneNames}` objects and drops anything
 * whose `boneNames` is not an array. The owned set was therefore always empty and `boneIsOwned`
 * never returned true. It is repaired here because a seam that silently claims nothing is worse
 * than no seam: the next executor to rely on it inherits a guarantee that does not hold.
 *
 * WHAT THE REPAIR DOES NOT FIX, stated so nobody reads more into it. The posture pass this claim
 * addresses resolves its rotation map through `ARM_JOINT_ALIASES` — fourteen entries, none of them
 * leg, foot, toe, pelvis, hip, knee or ankle — so it writes ARM bones only. The claim protected
 * nothing because nothing needed protecting: a displayed-walk run measured a driven left-toe span
 * of 1.089 m against a drive-off control of 0.0385 m, which could not happen if the legs were being
 * rewritten. This is a correct-and-inert defect repaired, not the cause of any failure.
 *
 * The drive scalar gates PLAYBACK, not speed: rescaling the clip's own timing would reintroduce the
 * sliding the stance lock exists to remove.
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
    if (action.isRunning()) {
      // SETTLE ON THE CLIP'S OWN REST FRAME, not wherever the stride happened to stop.
      //
      // `AnimationAction.stop()` deactivates the action, and the bones then hold whatever the last
      // update wrote — which is a mid-stride pose. Measured on the shipped take: the physician
      // stopped with `toe1-1.L` 0.252 m above the floor and `toe1-1.R` planted, so he stood on one
      // leg for the whole two-second observation and `signed-floor-contact` recorded zero frames on
      // the left foot. Frame 0 of this same clip is the rest frame — both toes at (+/-0.096, 0.016,
      // 0.035), symmetric, which no frame of a walk is — so one update at time zero settles the
      // actor onto a standing pose the ASSET already contains rather than one this file invents.
      // PAUSED AT TIME ZERO, not stopped. `AnimationAction.stop()` deactivates the action and the
      // mixer then RESTORES each bound property to the value it held before the clip ever ran —
      // measured, the settle probe's bone went to 0 rather than to the rest frame's 0.4. A paused
      // action stays active with weight 1, so the rest pose it wrote at time zero is what holds,
      // and `isRunning()` is false because a paused action is not running.
      action.reset();
      action.play();
      action.paused = true;
      mixer.update(0);
    }
    rootUserData["openClinXrOwnedBoneChains"] = [];
    rootUserData["openClinXrLocomotionClipPlayback"] = {
      clipName,
      playing: false,
      settledOn: "clip_rest_frame",
    };
    return true;
  }
  if (!action.isRunning()) action.reset().play();
  rootUserData["openClinXrOwnedBoneChains"] = locomotionOwnedBoneChains(slot);
  rootUserData["openClinXrLocomotionClipPlayback"] = {
    clipName,
    playing: true,
    timeSeconds: action.time,
    mode: "retargeted_clip_drives_the_leg_chain",
    notEvidenceFor: "gait realism, clinical plausibility, or Quest readiness",
  };
  return true;
}

/**
 * The chain categories a locomotion take drives. Categories, not bone names: the rig supplies the
 * names and they differ between rails (`upperleg01.L` on MPFB2, `mixamorig:LeftUpLeg` on mixamo).
 */
export const LOCOMOTION_OWNED_BONE_CHAIN_CATEGORIES = [
  "upperleg",
  "lowerleg",
  "foot",
  "toe",
  "pelvis",
  "root",
] as const;

/** Who claims the chain. `chain-ownership.ts`: two executors must not claim the same bone. */
export const LOCOMOTION_CHAIN_OWNER_ID = "openclinxr.locomotion-clip-playback";

/**
 * The claim, as `OwnedChain[]` carrying the bone names THIS actor's skeleton actually has.
 *
 * "OWNERSHIP IS DECLARED, NEVER INFERRED" (`chain-ownership.ts`). The categories above are resolved
 * against the rig's real bone names once, here, and what is stored is the resolved list — so a
 * renamed chain drops out of the claim rather than being captured by a pattern at read time.
 */
export function locomotionOwnedBoneChains(
  slot: GeneratedHumanoidAnimationSlot,
): Array<{ ownerId: string; boneNames: string[] }> {
  const boneNames: string[] = [];
  slot.root.traverse((node) => {
    const name = node.name;
    if (typeof name !== "string" || name.length === 0) return;
    const lower = name.toLowerCase();
    if (LOCOMOTION_OWNED_BONE_CHAIN_CATEGORIES.some((category) => lower.includes(category))) {
      boneNames.push(name);
    }
  });
  return [{ ownerId: LOCOMOTION_CHAIN_OWNER_ID, boneNames }];
}
