import path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";
import { playLocomotionClip } from "@openclinxr/xr-humanoid-animation/locomotion-clip-playback";
import { boundClipJointTrack, type BoundClipTrack } from "./bound-clip-foot-track.js";

/**
 * The shipped physician walk labels its own stance from its own motion.
 *
 * `computeLocomotionStanceLabels` / `resolveLocomotionStanceLabels` have no outside binder and
 * are not on `@openclinxr/xr-humanoid-animation`'s reviewed public surface (`public-api.json`,
 * closed by `psr-01e`). This reaches the labels the production way: it decodes the shipped
 * clip's real per-toe track off the GLB (`boundClipJointTrack`, unchanged), builds a
 * `GeneratedHumanoidAnimationSlot`-shaped fixture around it (the same pattern the package's own
 * `probeSlot()`/`timescaleSlot()` public-API tests use, populated with the real decoded track
 * instead of synthetic keyframes), calls the one public entry that resolves and caches labels
 * (`playLocomotionClip`, which now also calls `resolveLocomotionStanceLabels` — see
 * `locomotion-clip-playback-mod.ts`), and reads the result back off
 * `slot.root.userData["openClinXrLocomotionStanceLabels"]`, the same publish-on-userData pattern
 * `resolveLocomotionClipTimeScale` already uses for its own measurement.
 *
 * MEASURED 2026-09-24, NOT ASSUMED, going through this real entrypoint for the first time (the
 * PRIOR version of this test called `computeLocomotionStanceLabels` directly with a forward axis
 * from `measureStanceGroundAdvance` — a DIFFERENT direction heuristic than the one
 * `resolveLocomotionStanceLabels` actually uses internally, `forwardFromTracks`). On
 * `openclinxr_retarget_walk_source`: `measureStanceGroundAdvance` reports forward
 * `{x:-0.017, z:+1.00}`; `forwardFromTracks` (production) reports `{x:-0.007, z:-1.00}` — the
 * OPPOSITE z sign. Recomputing labels with the production forward gives duty factor ~0.14 (both
 * feet), zero double-support samples, and a swing-below-band sample still present. The PRIOR
 * assertions (duty 0.45-0.75, overlap present) were never checking what production actually
 * computes internally; this file now asserts the measured values from the real entrypoint.
 *
 * ## FIXED (2026-09-24)
 *
 * `forwardFromTracks` (`locomotion-stance-labels.ts`) had two compounding defects, both now
 * fixed: it searched every (start, end) sample pair in the WHOLE track with no height
 * restriction (contradicting its own comment, which claimed "between... local minima of
 * height"), and a same-day attempt to restrict candidate SAMPLES by height still failed because
 * this clip's near-floor samples span two separate arcs (the true stance descent, and the tail of
 * the swing return dipping low before the next touchdown) — an all-pairs search over that mixed
 * set could still bridge across the cycle wrap. The fix finds the longest CONTIGUOUS near-floor
 * run instead (mirroring `measureStanceGroundAdvance`'s own longest-contact-window search) and
 * reads first-minus-last across that one run, which cannot splice two arcs together.
 *
 * MEASURED before/after, both via `resolveLocomotionStanceLabels` through this test's real
 * `playLocomotionClip` entry:
 *
 *   metric                    | before (buggy forward)     | after (fixed forward)
 *   ---------------------------|----------------------------|----------------------------
 *   forward                    | {x:-0.007, z:-0.9999}       | {x:-0.010, z:+0.99995}
 *   duty factor (left / right) | 0.143 / 0.122               | 0.531 / 0.531
 *   double-support overlap     | 0 / 49                      | 6 / 49 (0.122)
 *
 * `measureStanceGroundAdvance`'s own forward on the same clip is {x:-0.017, z:+0.9999} — the
 * fixed `forwardFromTracks` now agrees in z sign and magnitude (both near-unit +Z); duty factor
 * and overlap both land inside general-gait-literature ranges (duty ~60%, brief double support)
 * instead of the physically implausible near-zero figures the sign bug produced.
 *
 * claimScope: what `resolveLocomotionStanceLabels`, reached through the public
 * `playLocomotionClip` entry, actually computes for `openclinxr_retarget_walk_source` on
 * mpfb-clinical-physician-adult.glb, as measured on this date.
 * notEvidenceFor: foot plant, gait realism beyond duty factor/overlap, Quest, browser SC-05,
 * factory IK bake.
 */

const PHYSICIAN_GLB = path.resolve(
  process.cwd(),
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
);
const CLIP = "openclinxr_retarget_walk_source";

type CachedLocomotionStanceLabels = {
  clipName: string;
  cycleSeconds: number;
  forward: { x: number; z: number };
  stanceSpeedMetersPerSecond: number;
  speedToleranceMetersPerSecond: number;
  heightCutMeters: number;
  atMs: number[];
  left: boolean[];
  right: boolean[];
};

function keyframeTrackFrom(track: BoundClipTrack, boneName: string): THREE.VectorKeyframeTrack {
  const times = track.samples.map((sample) => sample.atMs / 1000);
  const values: number[] = [];
  for (const sample of track.samples) values.push(sample.position.x, sample.position.y, sample.position.z);
  return new THREE.VectorKeyframeTrack(`${boneName}.position`, times, values);
}

/**
 * Play the shipped clip once on a minimal slot built from its own decoded toe tracks, and read
 * back the labels `playLocomotionClip` cached on `slot.root.userData`.
 */
async function labelShippedWalk(): Promise<{ labels: CachedLocomotionStanceLabels; left: BoundClipTrack; right: BoundClipTrack }> {
  const [left, right] = await Promise.all([
    boundClipJointTrack({ glbPath: PHYSICIAN_GLB, clipName: CLIP, boneName: "toe1-1.L" }),
    boundClipJointTrack({ glbPath: PHYSICIAN_GLB, clipName: CLIP, boneName: "toe1-1.R" }),
  ]);
  const durationSeconds = Math.max(
    left.samples[left.samples.length - 1]?.atMs ?? 0,
    right.samples[right.samples.length - 1]?.atMs ?? 0,
  ) / 1000;

  const actorSlot = new THREE.Group();
  const root = new THREE.Group();
  actorSlot.add(root);
  const toeL = new THREE.Object3D();
  toeL.name = "toe1-1.L";
  const toeR = new THREE.Object3D();
  toeR.name = "toe1-1.R";
  root.add(toeL);
  root.add(toeR);
  const clip = new THREE.AnimationClip(CLIP, durationSeconds, [
    keyframeTrackFrom(left, "toe1-1.L"),
    keyframeTrackFrom(right, "toe1-1.R"),
  ]);
  const slot = {
    assetId: "shipped-walk-labels-probe",
    actorId: "shipped_walk_labels_probe_actor",
    root,
    actorSlot,
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    phaseOffsetMs: 0,
    mouthCue: { visible: false } as unknown as THREE.Mesh,
    gazeCue: { visible: false } as unknown as THREE.Line,
    eyeFocusCue: { visible: false } as unknown as THREE.Group,
    expressionCue: { visible: false } as unknown as THREE.Group,
    sourceComparatorFreezeEnabled: false,
    locomotionClipName: clip.name,
    responseClips: [clip],
    mixer: new THREE.AnimationMixer(root),
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixture, not the tested predicate
  } as any;

  expect(playLocomotionClip(slot, 1, 1 / 60), "the walk action started").toBe(true);
  const labels = root.userData["openClinXrLocomotionStanceLabels"] as CachedLocomotionStanceLabels | undefined;
  expect(labels, "the probe clip has labellable stance").not.toBeUndefined();
  return { labels: labels!, left, right };
}

const dutyFactor = (flags: readonly boolean[]): number =>
  flags.filter((flag) => flag).length / Math.max(1, flags.length);

/** The labelled sample whose `atMs` is nearest a raw decoded sample's own time. */
function nearestLabelIndex(labels: CachedLocomotionStanceLabels, atMs: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < labels.atMs.length; index += 1) {
    const distance = Math.abs((labels.atMs[index] ?? 0) - atMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

describe("the shipped walk labels its own stance", () => {
  it("(1) each foot is in stance for roughly half the cycle or more", async () => {
    const { labels } = await labelShippedWalk();
    // Normal walking duty factor is ~60% (general gait literature): both feet share the cycle
    // with a brief double-support overlap, rather than one foot planted throughout. The clip is
    // sampled at 41 frames/cycle, so one sample is 2.4% and the assertion allows a row of
    // transfer samples either side of 50-70%.
    expect(dutyFactor(labels.left)).toBeGreaterThan(0.45);
    expect(dutyFactor(labels.left)).toBeLessThan(0.75);
    expect(dutyFactor(labels.right)).toBeGreaterThan(0.45);
    expect(dutyFactor(labels.right)).toBeLessThan(0.75);
  });

  it("(2) the two stance intervals overlap briefly (double support)", async () => {
    const { labels } = await labelShippedWalk();
    let overlap = 0;
    for (let index = 0; index < labels.left.length; index += 1) {
      if (labels.left[index] === true && labels.right[index] === true) overlap += 1;
    }
    expect(overlap, "stance intervals share double-support samples").toBeGreaterThan(0);
    expect(overlap / labels.left.length).toBeLessThan(0.4);
  });

  it("(3) a swing sample below the 0.06 m band is labelled swing", async () => {
    // The fixture that exhibits the defect: toe height under FOOT_CONTACT_HEIGHT_METERS while
    // the foot travels forward, which the band calls contact and the labels call swing.
    const { labels, left } = await labelShippedWalk();
    const swingBelowBand = left.samples.findIndex((sample) => {
      if (sample.position.y >= FOOT_CONTACT_HEIGHT_METERS) return false;
      return labels.left[nearestLabelIndex(labels, sample.atMs)] === false;
    });
    expect(
      swingBelowBand,
      "a below-band sample labelled swing exists (band counted it as contact)",
    ).toBeGreaterThanOrEqual(0);
  });

  it("(4) the tolerance is the sample's own spread, stated beside the speed", async () => {
    const { labels } = await labelShippedWalk();
    expect(labels.stanceSpeedMetersPerSecond).toBeGreaterThan(0);
    expect(labels.speedToleranceMetersPerSecond).toBeGreaterThanOrEqual(
      0.1 * labels.stanceSpeedMetersPerSecond - 1e-9,
    );
  });
});
