import {
  type StopClipFoot,
  type StopClipTrigger,
  travelYawForClipForward,
} from "@openclinxr/xr-runtime-state/bedside-approach-execution";
import { AnimationClip } from "three";
import {
  type LocomotionStanceLabels,
  resolveOneShotStanceLabels,
  stanceAtTime,
} from "./locomotion-stance-labels.js";

/**
 * Walk-to-stop handoff wiring, resolved lazily from the actor's own bound clips.
 *
 * The runtime never names a stop clip per actor. It finds one by prefix among the clips the
 * actor already carries, measures everything off it (entry stance from one-shot labels at time
 * 0 against the actor's own walk band, travel and forward from its root-bone keys), and hands
 * the result to the phase machine as a `StopClipTrigger`. No clip found, or any measurement missing, resolves
 * null and the walk ends exactly as before — that null is the whole feature gate.
 */

/** Clip-name prefix marking a baked walk-to-stop take grafted onto a shipped actor. */
export const STOP_CLIP_NAME_PREFIX = "openclinxr_retarget_kimodo_stop";

/**
 * Walk-to-stop crossfade window in seconds. The walk action fades 1 to 0 while the stop action
 * fades 0 to 1 across this window from the stopping entry frame; afterwards the walk action is
 * stopped. Short enough to keep the handoff inside one step, long enough that the pose change
 * between two different takes never lands in one frame.
 */
export const STOP_CROSSFADE_SECONDS = 0.25;

type WiringSlot = {
  root: { userData: Record<string, unknown> };
  mixer?: unknown;
  locomotionClipName?: string | null | undefined;
  responseClips?: ReadonlyArray<{ name: string }> | null | undefined;
  actorSlot: unknown;
};

export type StopClipWiring = {
  clipName: string;
  entryStance: StopClipFoot;
  /** The stop take's own stance labels, sampled once at wiring time. */
  labels: LocomotionStanceLabels;
  rootTrackXz: StopClipTrigger["rootTrackXz"];
  displacementMeters: number;
  durationSeconds: number;
  routeYawRadians: number;
  /**
   * The stop take with its root-bone horizontal travel removed (every root XZ key reset to the
   * first key). The mixer plays this while the slot carries the travel, so the travel counts
   * once. Toe and vertical keys are untouched.
   */
  noRootClip: AnimationClip;
};

/** First clip in `clips` carrying the stop prefix, or null. Pure name match, no mixer reads. */
export function findStopClipName(clips: ReadonlyArray<{ name: string }> | null | undefined): string | null {
  if (!clips) return null;
  return clips.find((clip) => clip.name.startsWith(STOP_CLIP_NAME_PREFIX))?.name ?? null;
}

/**
 * The root-bone horizontal track of a bound three.js clip, read straight off its position keys.
 * Prefers the bone literally named "root" (where the bind stage keeps root motion); anything
 * else resolves null rather than guessing a toe track into a travel prescription.
 */
export function readStopRootTrackXz(clip: {
  tracks: Array<{ name: string; times: ArrayLike<number>; values: ArrayLike<number> }>;
}): StopClipWiring["rootTrackXz"] | null {
  const track = clip.tracks.find((candidate) => candidate.name === "root.position");
  if (!track || track.times.length < 2) return null;
  const points: StopClipWiring["rootTrackXz"] = [];
  const frames = Math.min(track.times.length, Math.floor(track.values.length / 3));
  for (let index = 0; index < frames; index += 1) {
    points.push({
      t: track.times[index] ?? 0,
      x: track.values[index * 3] ?? 0,
      z: track.values[(index * 3) + 2] ?? 0,
    });
  }
  return points.length >= 2 ? points : null;
}

/** Net horizontal root travel of a track, first to last key, in metres. */
export function stopTrackDisplacementMeters(track: StopClipWiring["rootTrackXz"]): number {
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) return 0;
  return Math.hypot(last.x - first.x, last.z - first.z);
}

/**
 * Build the handoff wiring for an actor's slot, or null when there is no stop take to hand to.
 * Pure against the clips; the caller caches the result per approach and rebuilds when the clip
 * name changes. Every number comes off the bound clip: entry stance from its own labels at time
 * 0, displacement and forward from its root keys.
 */
export function resolveStopWiring(input: {
  labelSlot: WiringSlot | null;
  travelHeadingRadians: number;
}): StopClipWiring | null {
  const slot = input.labelSlot;
  if (slot === null) return null;
  const clips = slot.responseClips;
  if (!clips) return null;
  const clipName = findStopClipName(clips);
  if (clipName === null) return null;
  const clip = clips.find((candidate) => candidate.name === clipName) as AnimationClip | undefined;
  if (!clip || !(clip instanceof AnimationClip) || clip.duration <= 0) return null;
  const stopSlot = {
    root: slot.root,
    mixer: slot.mixer,
    locomotionClipName: clipName,
    responseClips: clips,
    actorSlot: slot.actorSlot,
  };
  const rootTrackXz = readStopRootTrackXz(clip);
  if (rootTrackXz === null) return null;
  const displacementMeters = stopTrackDisplacementMeters(rootTrackXz);
  if (!(displacementMeters > 0)) return null;
  // Forward is the net travel direction, NOT the stance-window advance the walk uses. A one-shot
  // stop spends its longest contact run standing in the hold (both feet down, millimetres of
  // drift — a noise direction), while its body travels metres; the net root vector is the travel,
  // and it is the same vector the trigger distance is measured from, so distance and direction
  // cannot disagree.
  const first = rootTrackXz[0];
  const last = rootTrackXz[rootTrackXz.length - 1];
  if (first === undefined || last === undefined) return null;
  const forward = { x: last.x - first.x, z: last.z - first.z };
  // One-shot labels against the net travel direction (the loop's longest-contact run would be
  // the hold, a noise direction). The band comes from the resolver: a stopping foot steps or
  // stands, so low plus non-forward is stance. No walk take is needed here; the trigger still
  // needs the walk's own stance reading, so a stop without a walk take never fires.
  const labels = resolveOneShotStanceLabels(
    stopSlot as Parameters<typeof resolveOneShotStanceLabels>[0],
    { netForward: forward },
  );
  if (labels === null) return null;
  const entry = stanceAtTime(labels, 0);
  const entryStance: StopClipFoot = { left: entry.left, right: entry.right };
  const noRootClip = clip.clone();
  const rootTrack = noRootClip.tracks.find((candidate) => candidate.name === "root.position");
  if (rootTrack) {
    const values = rootTrack.values as ArrayLike<number> & { [index: number]: number };
    const firstX = values[0] ?? 0;
    const firstZ = values[2] ?? 0;
    const frames = Math.floor(values.length / 3);
    for (let index = 0; index < frames; index += 1) {
      values[index * 3] = firstX;
      values[(index * 3) + 2] = firstZ;
    }
  }
  return {
    clipName,
    entryStance,
    labels,
    rootTrackXz,
    displacementMeters,
    durationSeconds: clip.duration,
    routeYawRadians: travelYawForClipForward(input.travelHeadingRadians, forward),
    noRootClip,
  };
}
