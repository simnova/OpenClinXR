import {
  sampleStopRootTrackXZ,
  type StopClipFoot,
  type StopClipTrigger,
  travelYawForClipForward,
} from "@openclinxr/xr-runtime-state/bedside-approach-execution";
import { AnimationClip } from "three";
import {
  footRunStarts,
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
  /** Clip time playback starts at: the last entry-foot stance window before deceleration. */
  entryTimeS: number;
  /** First root-speed drop below 95% of steady walk, confirmed over the next second. */
  decelOnsetS: number;
  /** First near-stopped root time at or after onset (below 2% of steady walk). */
  holdOnsetS: number;
  /**
   * Every entry-foot stance-window start before decel onset, earliest first, each with its own
   * trigger distance. The distance matcher picks among these when the default (last) would
   * clamp the speed factor; earlier windows trade playing more of the take for a closer rate.
   */
  entryCandidates: Array<{ t0S: number; entryStance: StopClipFoot; displacementMeters: number }>;
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
 * Per-interval root speeds of a root XZ track, in m/s, stamped at the interval start.
 */
export function stopRootSpeeds(
  track: StopClipWiring["rootTrackXz"],
): Array<{ t: number; v: number }> {
  const speeds: Array<{ t: number; v: number }> = [];
  for (let index = 0; index + 1 < track.length; index += 1) {
    const from = track[index];
    const to = track[index + 1];
    if (from === undefined || to === undefined) continue;
    const dt = to.t - from.t;
    if (!(dt > 0)) continue;
    speeds.push({ t: from.t, v: Math.hypot(to.x - from.x, to.z - from.z) / dt });
  }
  return speeds;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Deceleration onset: the first key time at or after one second whose speed drops below 95% of
 * the steady-walk speed with the next second's median confirming it. The confirmation skips
 * stride wobble and ease-in dips that cross 95% mid-walk (measured dips to ~92% on the child);
 * the one-second floor skips the opening stride. Null when the clip never decelerates.
 */
export function stopDecelOnsetS(
  track: StopClipWiring["rootTrackXz"],
  durationSeconds: number,
): number | null {
  const speeds = stopRootSpeeds(track);
  const steady = median(speeds.filter((s) => s.t < durationSeconds / 2).map((s) => s.v));
  if (!(steady > 0)) return null;
  const threshold = 0.95 * steady;
  for (const s of speeds) {
    if (s.t < 1.0 || !(s.v < threshold)) continue;
    const ahead = speeds.filter((o) => o.t >= s.t && o.t <= s.t + 1.0).map((o) => o.v);
    if (median(ahead) < threshold) return s.t;
  }
  return null;
}

/**
 * Start of the last stance window of the given foot that begins before onsetS, from one-shot
 * labels. Windows are run-length filtered (calibration speckle reads as isolated flips). The
 * handoff plays the clip from here instead of frame 0, so the runtime never replays the take's
 * opening steady walk. Null when no window qualifies.
 */
export function stopEntryTimeS(
  labels: LocomotionStanceLabels,
  foot: "left" | "right",
  onsetS: number,
): number | null {
  const starts = footRunStarts(labels, foot, 3).filter((start) => start < onsetS);
  return starts.length > 0 ? (starts[starts.length - 1] ?? null) : null;
}

/** Net horizontal travel direction over the whole track (label axis; rotation uses the span). */
function fullNetForward(track: StopClipWiring["rootTrackXz"]): { x: number; z: number } {
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) return { x: 0, z: 1 };
  return { x: last.x - first.x, z: last.z - first.z };
}

/**
 * Max perpendicular distance of the span path (t >= t0) from its chord, in metres. The span
 * yaw maps the chord onto the route; a deviating span maps laterally instead, and the stance
 * pin then eats the advance fighting it. Candidates above the matcher's allowance are unusable.
 */
export function spanStraightDeviationM(
  track: StopClipWiring["rootTrackXz"],
  t0S: number,
): number {
  const start = sampleStopRootTrackXZ(track, t0S);
  const last = track[track.length - 1];
  if (last === undefined) return Number.POSITIVE_INFINITY;
  const end = { x: last.x, z: last.z };
  const chordX = end.x - start.x;
  const chordZ = end.z - start.z;
  const chordLen = Math.hypot(chordX, chordZ);
  if (!(chordLen > 0)) return Number.POSITIVE_INFINITY;
  let worst = 0;
  for (const key of track) {
    if (key.t < t0S) continue;
    const px = key.x - start.x;
    const pz = key.z - start.z;
    const across = Math.abs(px * chordZ - pz * chordX) / chordLen;
    if (across > worst) worst = across;
  }
  return worst;
}

/**
 * Build the handoff wiring for an actor's slot, or null when there is no stop take to hand to.
 * Pure against the clips; the caller caches the result per approach and rebuilds when the clip
 * name changes. Travel, forward, and playback start are measured from the entry time: the last
 * entry-foot stance window before deceleration, so the trigger distance covers the stop rather
 * than the take's opening walk.
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
  const onsets = stopDecelOnsetS(rootTrackXz, clip.duration);
  if (onsets === null) return null;
  const decelOnsetS = onsets;
  const speeds = stopRootSpeeds(rootTrackXz);
  const steady = median(speeds.filter((s) => s.t < clip.duration / 2).map((s) => s.v));
  const holdFound = speeds.find((s) => s.t >= decelOnsetS && s.v < 0.02 * steady);
  const holdOnsetS = holdFound?.t ?? clip.duration;
  // Forward is the net travel direction of the played span, NOT the stance-window advance the
  // walk uses. A one-shot stop spends its longest contact run standing in the hold (both feet
  // down, millimetres of drift — a noise direction), while its body travels metres; the span
  // vector is the travel, and it is the same vector the trigger distance is measured from, so
  // distance and direction cannot disagree.
  const labels = resolveOneShotStanceLabels(
    stopSlot as Parameters<typeof resolveOneShotStanceLabels>[0],
    { netForward: fullNetForward(rootTrackXz) },
  );
  if (labels === null) return null;
  // The entry foot is left on all three takes by motion (frame-0 label); the window search
  // below takes the foot as a parameter so a take starting on the right resolves the same way.
  const entryFoot = ((): "left" | "right" => {
    const atZero = stanceAtTime(labels, 0);
    if (atZero.left) return "left";
    return "right";
  })();
  const entryTimeS = stopEntryTimeS(labels, entryFoot, decelOnsetS);
  if (entryTimeS === null) return null;
  const entry = stanceAtTime(labels, entryTimeS);
  const entryStance: StopClipFoot = { left: entry.left, right: entry.right };
  if (!entryStance.left && !entryStance.right) return null;
  // Every entry-foot window start before onset, earliest first: the matcher falls back to
  // earlier (longer-distance) entries when the default would force the rate out of bounds.
  const entryCandidates: StopClipWiring["entryCandidates"] = [];
  const startXz = sampleStopRootTrackXZ(rootTrackXz, entryTimeS);
  const endXz = sampleStopRootTrackXZ(rootTrackXz, clip.duration);
  const displacementMeters = Math.hypot(endXz.x - startXz.x, endXz.z - startXz.z);
  if (!(displacementMeters > 0)) return null;
  const forward = { x: endXz.x - startXz.x, z: endXz.z - startXz.z };
  {
    for (const startS of footRunStarts(labels, entryFoot, 3)) {
      if (startS >= decelOnsetS) continue;
      const pair = stanceAtTime(labels, startS);
      const fromXz = sampleStopRootTrackXZ(rootTrackXz, startS);
      const candidateD = Math.hypot(endXz.x - fromXz.x, endXz.z - fromXz.z);
      if (candidateD > 0) {
        entryCandidates.push({
          t0S: startS,
          entryStance: { left: pair.left, right: pair.right },
          displacementMeters: candidateD,
        });
      }
    }
  }
  if (entryCandidates.length === 0) return null;
  if ((globalThis as Record<string, unknown>)["__S1_DEBUG_WIRE"] === true) {
    console.error(
      `[s1wire] ${clipName} onset=${decelOnsetS.toFixed(3)} hold=${holdOnsetS.toFixed(3)} default t0=${entryTimeS.toFixed(3)} D=${displacementMeters.toFixed(3)}`,
    );
    for (const c of entryCandidates) {
      console.error(
        `[s1wire] cand t0=${c.t0S.toFixed(3)} D=${c.displacementMeters.toFixed(3)} foot=${c.entryStance.left ? "L" : "-"}${c.entryStance.right ? "R" : "-"} dev=${spanStraightDeviationM(rootTrackXz, c.t0S).toFixed(3)}`,
      );
    }
  }
  const noRootClip = clip.clone();
  const rootTrack = noRootClip.tracks.find((candidate) => candidate.name === "root.position");
  if (rootTrack) {
    // Freeze at the entry key, not the first key: the slot prescription is measured from t0,
    // so the skeleton must sit at the t0 offset or the whole body inherits a two-metre error.
    let entryIndex = 0;
    let entryDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < rootTrack.times.length; index += 1) {
      const distance = Math.abs((rootTrack.times[index] ?? 0) - entryTimeS);
      if (distance < entryDistance) {
        entryDistance = distance;
        entryIndex = index;
      }
    }
    const values = rootTrack.values as ArrayLike<number> & { [index: number]: number };
    const frozenX = values[entryIndex * 3] ?? 0;
    const frozenZ = values[(entryIndex * 3) + 2] ?? 0;
    const frames = Math.floor(values.length / 3);
    for (let index = 0; index < frames; index += 1) {
      values[index * 3] = frozenX;
      values[(index * 3) + 2] = frozenZ;
    }
  }
  return {
    clipName,
    entryStance,
    entryTimeS,
    decelOnsetS,
    holdOnsetS,
    entryCandidates,
    labels,
    rootTrackXz,
    displacementMeters,
    durationSeconds: clip.duration,
    routeYawRadians: travelYawForClipForward(input.travelHeadingRadians, forward),
    noRootClip,
  };
}
