import type { Object3D } from "three";
import { sampleLocomotionStanceTrack } from "./case-owned-approach-frame-mod.js";
import { resolveToeBones } from "./resolve-toe-bones.js";
import type { GeneratedHumanoidAnimationSlot } from "./types.js";

/**
 * Per-clip stance labels from the clip's own motion, sampled once per slot.
 *
 * CONTACT IS A CLIP property, not a height threshold. The old rule called a foot
 * planted when its toe sat within 0.06 m of the floor; a natural Mesh2Motion walk
 * swings its toe at 1.5-2 cm clearance, so swing frames counted as contact, the
 * lock pinned swinging feet, and the body lurched backward every step. A foot in
 * real stance travels backward along the clip's forward axis at the clip's stance
 * speed while riding near its minimum height; a swinging foot travels forward or
 * fast, high or low. This module labels each sample that way and everything else
 * (lock, SC-05, time-scale measurement) reads the labels.
 *
 * STANCE SPEED is the median backward along-axis speed over the samples that move
 * backward at all. The band is asymmetric: the top edge is tight (median + 2 MAD,
 * floored at +10%) because stance at full speed is the steady state; the bottom edge reaches
 * the slowest backward sample because transfer samples decelerate toward liftoff, and the
 * height gate bounds the cost of that generosity. On the shipped physician
 * (`openclinxr_retarget_walk_source`) the median backward speed is ~0.77 m/s with MAD ~0.04 m/s,
 * stated in the measurement beside each number.
 *
 * HEIGHT is the clip's mid-range plus one measured 5 mm step: the minimum and maximum are
 * single samples while stance rides a band the 41-sample cycle quantises in ~5 mm steps, and
 * mid-range alone dropped the highest stance row. This is height RELATIVE to the clip's own
 * envelope, never an absolute floor datum, so a clip whose whole envelope sits low still
 * separates — and every sample the extra step admits still moves backward at stance speed, so
 * no forward swing sample enters through this gate.
 */

export type LocomotionStanceLabels = {
  clipName: string;
  cycleSeconds: number;
  /** Clip's forward axis in the sampled body frame, unit length. */
  forward: { x: number; z: number };
  stanceSpeedMetersPerSecond: number;
  speedToleranceMetersPerSecond: number;
  heightCutMeters: number;
  atMs: number[];
  left: boolean[];
  right: boolean[];
};

export function stanceAtTime(labels: LocomotionStanceLabels, actionTimeSeconds: number): {
  left: boolean;
  right: boolean;
} {
  const count = labels.atMs.length;
  if (count === 0 || labels.cycleSeconds <= 0) return { left: false, right: false };
  const wrapped = ((actionTimeSeconds % labels.cycleSeconds) + labels.cycleSeconds) % labels.cycleSeconds;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const sampleTime = (labels.atMs[index] ?? 0) / 1000;
    const direct = Math.abs(sampleTime - wrapped);
    const distance = Math.min(direct, labels.cycleSeconds - direct);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return { left: labels.left[best] ?? false, right: labels.right[best] ?? false };
}

/**
 * Label pre-sampled per-foot body-frame tracks. Pure: the same function the slot
 * resolver and the SC-05 assay use, so lock and test read one definition.
 */
export function computeLocomotionStanceLabels(input: {
  clipName: string;
  cycleSeconds: number;
  forward: { x: number; z: number };
  left: ReadonlyArray<{ atMs: number; position: { x: number; y: number; z: number } }>;
  right: ReadonlyArray<{ atMs: number; position: { x: number; y: number; z: number } }>;
}): LocomotionStanceLabels {
  const length = Math.hypot(input.forward.x, input.forward.z);
  const forward = length > 0 ? { x: input.forward.x / length, z: input.forward.z / length } : { x: 0, z: 1 };
  const count = input.left.length;
  type Sample = { x: number; y: number; z: number };
  const alongOf = (
    track: ReadonlyArray<{ atMs: number; position: Sample }>,
    index: number,
  ): number => {
    const previous = track[(index - 1 + track.length) % track.length];
    const next = track[(index + 1) % track.length];
    if (previous === undefined || next === undefined) return 0;
    const dtSeconds = (next.atMs - previous.atMs) / 1000;
    if (!(dtSeconds > 0)) return 0;
    return (
      ((next.position.x - previous.position.x) * forward.x
        + (next.position.z - previous.position.z) * forward.z)
      / dtSeconds
    );
  };
  const backwardSpeeds: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const alongLeft = input.left.length > 0 ? alongOf(input.left, index) : 0;
    const alongRight = input.right.length > 0 ? alongOf(input.right, index) : 0;
    if (alongLeft < 0) backwardSpeeds.push(-alongLeft);
    if (alongRight < 0) backwardSpeeds.push(-alongRight);
  }
  const sorted = [...backwardSpeeds].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] ?? 0 : 0;
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations.length > 0 ? deviations[Math.floor(deviations.length / 2)] ?? 0 : 0;
  const stanceSpeedMetersPerSecond = median;
  // The band is asymmetric on purpose: stance at full speed is the steady state, so the top edge
  // is tight (median + 2 MAD, floored at +10%); the bottom edge reaches down to the slowest
  // backward sample (transfer samples decelerate toward liftoff, and cutting them is what shrank
  // the shipped duty factor to ~46%). The cost of the generous bottom is bounded by the height
  // gate: anything above the clip's mid-range envelope is swing however slowly it moves. On the
  // shipped physician (median ~0.77, MAD ~0.04) the top floor dominates: the band is roughly
  // [slowest-backward, 1.1x] median, stated beside each number.
  const speedToleranceMetersPerSecond = Math.max(2 * mad, 0.1 * median);
  const backwardSpeedsSorted = [...backwardSpeeds].sort((a, b) => a - b);
  const lowerSpeedMetersPerSecond = backwardSpeedsSorted.length > 0 ? backwardSpeedsSorted[0] ?? 0 : 0;
  const allHeights: number[] = [];
  for (const sample of input.left) allHeights.push(sample.position.y);
  for (const sample of input.right) allHeights.push(sample.position.y);
  const minHeight = allHeights.length > 0 ? Math.min(...allHeights) : 0;
  const maxHeight = allHeights.length > 0 ? Math.max(...allHeights) : 0;
  // Mid-range plus one measured step: the minimum and maximum are single samples, while stance
  // rides a band whose top the samples quantise in ~5 mm steps at 41 samples/cycle. Mid-range
  // alone cut the shipped duty factor to ~49% by dropping the highest stance row; one step
  // restores it to ~51-54% while every sample it admits still moves backward at stance speed,
  // so no forward swing sample can enter through this gate.
  const heightCutMeters = minHeight + 0.5 * (maxHeight - minHeight) + 0.005;
  const labelOne = (
    track: ReadonlyArray<{ atMs: number; position: Sample }>,
  ): boolean[] =>
    track.map((sample, index) => {
      const backward = -alongOf(track, index);
      const speedOk =
        backward >= lowerSpeedMetersPerSecond
        && backward <= stanceSpeedMetersPerSecond + speedToleranceMetersPerSecond;
      return speedOk && sample.position.y <= heightCutMeters;
    });
  return {
    clipName: input.clipName,
    cycleSeconds: input.cycleSeconds,
    forward,
    stanceSpeedMetersPerSecond,
    speedToleranceMetersPerSecond,
    heightCutMeters,
    atMs: input.left.map((sample) => sample.atMs),
    left: labelOne(input.left),
    right: labelOne(input.right),
  };
}

type SlotLike = Pick<
  GeneratedHumanoidAnimationSlot,
  "root" | "mixer" | "locomotionClipName" | "responseClips" | "actorSlot"
>;

/**
 * FIXED (2026-09-24): now finds the longest CONTIGUOUS near-floor run and reads the direction
 * across that single run's own first and last sample — the same construction
 * `measureStanceGroundAdvance` (case-owned-approach-runtime-mod.ts) already uses for its
 * contact-window forward, which is what this function's sign is meant to agree with.
 *
 * Two things were wrong with the prior version, not one. (1) It searched every (start, end) pair
 * in the WHOLE track with no height restriction at all, contradicting its own comment ("between...
 * local minima of height"). (2) A same-day fix that restricted the search to near-floor SAMPLES
 * (not a contiguous RUN of them) still failed: on the shipped physician clip the near-floor samples
 * span two separate arcs — the genuine ~61%-duty stance descent AND the tail end of the swing
 * return, which also dips low before rising into the walk's next stance — so an all-PAIRS search
 * over that mixed set could still pick a pair spanning both arcs, i.e. crossing the cycle wrap,
 * which is not one coherent excursion. A CONTIGUOUS run cannot cross the wrap or splice two arcs
 * together, so it isolates the one true stance excursion.
 *
 * MEASURED on `openclinxr_retarget_walk_source`: prior negated-all-pairs-search {x:-0.007, z:-0.999};
 * `measureStanceGroundAdvance`'s contact-window forward {x:-0.017, z:+0.9999}; this function
 * post-fix {x:-0.010, z:+0.99995} — same z sign as `measureStanceGroundAdvance`, both near-unit
 * +Z, on the same real clip. Duty factor (via `resolveLocomotionStanceLabels`, through the public
 * `playLocomotionClip` entry): left/right both 0.531 (was 0.143/0.122), double-support overlap
 * 6/49 samples (was 0/49) — see the tools-level evidence test's own header for the full before/after.
 */
function forwardFromTracks(input: {
  left: ReadonlyArray<{ atMs: number; position: { x: number; y: number; z: number } }>;
  right: ReadonlyArray<{ atMs: number; position: { x: number; y: number; z: number } }>;
}): { x: number; z: number } {
  const candidates = [input.left, input.right];
  let best = { x: 0, z: 1, travel: 0 };
  for (const track of candidates) {
    if (track.length < 2) continue;
    const heights = track.map((sample) => sample.position.y);
    const minHeight = Math.min(...heights);
    const maxHeight = Math.max(...heights);
    const lowHeightCut = minHeight + 0.5 * (maxHeight - minHeight);
    // Longest contiguous run of near-floor samples: the same "longest in-contact window" search
    // `measureStanceGroundAdvance` runs, over height instead of the runtime contact band (this
    // function has no floor datum to measure an absolute contact height against, only the track's
    // own envelope).
    let runStart = -1;
    let bestRun = { start: -1, end: -1, length: 0 };
    for (let index = 0; index <= track.length; index += 1) {
      const low = index < track.length && (heights[index] ?? Number.POSITIVE_INFINITY) <= lowHeightCut;
      if (low) {
        if (runStart === -1) runStart = index;
      } else if (runStart !== -1) {
        const length = index - runStart;
        if (length > bestRun.length) bestRun = { start: runStart, end: index - 1, length };
        runStart = -1;
      }
    }
    if (bestRun.length < 2) continue;
    const first = track[bestRun.start];
    const last = track[bestRun.end];
    if (first === undefined || last === undefined) continue;
    // Forward is first-minus-last, matching measureStanceGroundAdvance's sign exactly: the window
    // is traversed from first (early) to last (late) as the foot travels BACKWARD, so first-last
    // points the other way, forward.
    const dx = first.position.x - last.position.x;
    const dz = first.position.z - last.position.z;
    const travel = Math.hypot(dx, dz);
    if (travel > best.travel) best = { x: dx, z: dz, travel };
  }
  const length = Math.hypot(best.x, best.z);
  return length > 0 ? { x: best.x / length, z: best.z / length } : { x: 0, z: 1 };
}

function sampleTrack(
  slot: SlotLike,
  toe: Object3D,
): { samples: Array<{ atMs: number; position: { x: number; y: number; z: number } }>; cycleSeconds: number } | null {
  return sampleLocomotionStanceTrack(slot, {
    toe,
    sampleCount: 48,
    referenceFrame: slot.actorSlot ?? slot.root,
  });
}

/**
 * The slot's cached stance labels, sampling both toe tracks once per bound clip.
 *
 * Samples each toe independently off a private calibration mixer (the same
 * observation `sampleLocomotionStanceTrack` makes), so left and right keep their
 * own phase. Cached on the root userData beside the time-scale measurement;
 * recomputed when the clip name or duration changes. Returns null when there is
 * nothing to label.
 */
export function resolveLocomotionStanceLabels(slot: SlotLike): LocomotionStanceLabels | null {
  const clipName = slot.locomotionClipName;
  if (!clipName) return null;
  const clip = slot.responseClips?.find((candidate: { name: string }) => candidate.name === clipName);
  if (!clip || clip.duration <= 0) return null;
  const rootUserData = slot.root.userData as Record<string, unknown>;
  const cached = rootUserData["openClinXrLocomotionStanceLabels"] as LocomotionStanceLabels | undefined;
  if (cached && cached.clipName === clipName && cached.cycleSeconds === clip.duration) return cached;
  const toes = resolveToeBones(slot.root);
  if (toes.left === null || toes.right === null) return null;
  const left = sampleTrack(slot, toes.left);
  const right = sampleTrack(slot, toes.right);
  if (left === null || right === null) return null;
  const forward = forwardFromTracks({ left: left.samples, right: right.samples });
  const labels = computeLocomotionStanceLabels({
    clipName,
    cycleSeconds: clip.duration,
    forward,
    left: left.samples,
    right: right.samples,
  });
  rootUserData["openClinXrLocomotionStanceLabels"] = labels;
  return labels;
}

/**
 * Which feet the bound clip's mixer action currently holds in stance. Null when
 * there are no labels: the lock then keeps its legacy height-band decision.
 */
export function stanceAtActionTime(
  slot: Pick<SlotLike, "mixer" | "locomotionClipName" | "responseClips">,
  labels: LocomotionStanceLabels | null,
): { left: boolean; right: boolean } | null {
  if (labels === null) return null;
  const clipName = slot.locomotionClipName;
  if (!clipName) return null;
  const clip = slot.responseClips?.find((candidate: { name: string }) => candidate.name === clipName);
  if (!clip || slot.mixer === undefined) return null;
  const action = slot.mixer.existingAction(clip);
  if (!action) return null;
  return stanceAtTime(labels, action.time);
}

export function clearLocomotionStanceLabelsForTest(slot: SlotLike): void {
  delete (slot.root.userData as Record<string, unknown>)["openClinXrLocomotionStanceLabels"];
}

export type { SlotLike as LocomotionStanceLabelSlot };
