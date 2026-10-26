import type { AnimationClip, AnimationMixer, Object3D } from "three";
import type { OwnedChain } from "@openclinxr/xr-pose";

/**
 * Owner id for one-shot response overlays. The release matches this exact id on finish.
 */
export const RESPONSE_OVERLAY_OWNER_ID = "one_shot_response_clip";

const OWNED_CHAINS_KEY = "openClinXrOwnedBoneChains";

/** Bones the stored pillow/head support owns; response overlays must not claim these. */
const HEAD_SUPPORT_BONES = new Set(["head", "neck", "neck01", "neck1", "spine", "spine01", "spine03", "spine1", "pelvis", "hips"]);
/** Bone names a clip drives (quaternion tracks), resolved to the root's sanitised names. Internal to the overlay seam. */
function clipDrivenBoneNames(clip: AnimationClip, root: Object3D): string[] {
  const names = new Set<string>();
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf(".");
    const node = dot > 0 ? track.name.slice(0, dot) : track.name;
    const found = root.getObjectByName(node);
    names.add(found ? found.name : node);
  }
  return [...names];
}

/** Clip-local reference quaternion per driven bone: first quaternion keyframe value. Internal to the overlay seam. */
function clipReferenceQuaternions(
  clip: AnimationClip,
  root: Object3D,
): Record<string, readonly [number, number, number, number]> {
  const reference: Record<string, readonly [number, number, number, number]> = {};
  for (const track of clip.tracks) {
    if (!track.name.endsWith(".quaternion")) continue;
    const dot = track.name.lastIndexOf(".");
    const node = track.name.slice(0, dot);
    const found = root.getObjectByName(node);
    const name = found ? found.name : node;
    if (name in reference) continue;
    const values = (track as unknown as { values?: ArrayLike<number> }).values;
    if (!values || values.length < 4) continue;
    reference[name] = [values[0] as number, values[1] as number, values[2] as number, values[3] as number] as unknown as readonly [number, number, number, number];
  }
  return reference as Record<string, readonly [number, number, number, number]>;
}

function declareOverlayChains(
  host: { userData?: Record<string, unknown> },
  ownerId: string,
  boneNames: readonly string[],
  action?: { isScheduled(): boolean },
  reference?: Record<string, readonly [number, number, number, number]>,
): void {
  if (!host.userData) return;
  const raw = host.userData[OWNED_CHAINS_KEY];
  const existing = (Array.isArray(raw) ? raw : []) as OwnedChain[];
  const next = existing.filter((chain) => chain.ownerId !== ownerId);
  if (boneNames.length > 0) next.push({ ownerId, boneNames: [...boneNames], ...(action ? { action } : {}), ...(reference ? { reference } : {}) });
  host.userData[OWNED_CHAINS_KEY] = next;
}

function releaseOverlayChains(host: { userData?: Record<string, unknown> }, ownerId: string): void {
  if (!host.userData) return;
  const raw = host.userData[OWNED_CHAINS_KEY];
  const existing = (Array.isArray(raw) ? raw : []) as OwnedChain[];
  const next = existing.filter((chain) => chain.ownerId !== ownerId);
  if (next.length === 0) delete host.userData[OWNED_CHAINS_KEY];
  else host.userData[OWNED_CHAINS_KEY] = next;
}

/**
 * Resolve a motion-manifest address (clipId) onto a mixer. Only the addressed clip
 * is started; other clips in the set are left stopped.
 * Opt-in overlay: when overlayRoot is given, declares driven bones as owned and
 * releases them on mixer `finished`, so support holds settle instead of sticking.
 */
export function playManifestMotionClip(input: {
  mixer: AnimationMixer;
  manifestAddress: { clipId: string };
  clips: AnimationClip[];
  /** Driven root that owns the overlay claim; support hold skips these bones. */
  overlayRoot?: Object3D;
}): string {
  const clip = input.clips.find((candidate) => candidate.name === input.manifestAddress.clipId);
  if (!clip) {
    throw new Error(`playManifestMotionClip: no clip named "${input.manifestAddress.clipId}"`);
  }
  const action = input.mixer.clipAction(clip);
  action.reset();
  action.play();
  if (input.overlayRoot) {
    const root = input.overlayRoot;
    const actionHandle = input.mixer.existingAction(clip);
    const driven = clipDrivenBoneNames(clip, root).filter((name) => !HEAD_SUPPORT_BONES.has(name.toLowerCase()));
    declareOverlayChains(root, RESPONSE_OVERLAY_OWNER_ID, driven, actionHandle ?? action, clipReferenceQuaternions(clip, root));
    let released = false;
    const releaseOnce = (): void => {
      if (released) return;
      released = true;
      releaseOverlayChains(root, RESPONSE_OVERLAY_OWNER_ID);
    };
    const onFinished = (event: { action?: ReturnType<AnimationMixer["clipAction"]> }): void => {
      if (event.action !== actionHandle && event.action !== action) return;
      input.mixer.removeEventListener("finished", onFinished as (event: unknown) => void);
      releaseOnce();
    };
    input.mixer.addEventListener("finished", onFinished as (event: unknown) => void);
  }
  return input.manifestAddress.clipId;
}
