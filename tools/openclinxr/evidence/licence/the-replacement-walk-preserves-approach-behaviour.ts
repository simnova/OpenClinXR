import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CLINICIAN_WALK_SPEED_MPS,
  FOOT_CONTACT_HEIGHT_METERS,
  // `FootSample` is declared here and is NOT re-exported from the package root. Taking it from the
  // root fails as TS2305, and adding it there would move an exact-equality
  // `rootEntrypointExports` ceiling for a type nothing outside this file needs. The two constants
  // above already come from this module, so this crosses no boundary the file had not crossed.
  type FootSample,
} from "../../../../packages/openclinxr/asset-registry/src/approach-executor-mod.js";
import { footSlideMeters } from "../../../../packages/openclinxr/asset-registry/src/index.js";
import { boundClipJointTrack } from "../foot-plant/bound-clip-foot-track.js";

/**
 * Does the CC0 replacement walk plant its feet as well as the CMU walk it replaces?
 *
 * SC-04 replaces `openclinxr_retarget_cmu_02_01_walk` (CMU, CONDITIONAL terms, not redistributable)
 * with `openclinxr_retarget_walk_formal_cc0` (Mesh2Motion `Walk_Formal`, CC0). The card requires the
 * replacement to preserve WALKING, and the owner's finding on the card says plainly that equivalent
 * approach behaviour "is a claim to measure, not to assume from a clip name". This measures it.
 *
 * WHY THE EXISTING INSTRUMENT CANNOT ANSWER IT, measured 2026-09-09. `bound-clip-foot-plant.ts`
 * grades a foot against the clip's OWN root travel: the CMU BVH carries 3.197 m of root motion over
 * 2.867 s, so a planted foot is one whose world position holds still while the root moves under it.
 * Every Mesh2Motion locomotion clip is IN PLACE — measured across `Walk`, `Walk_Formal`,
 * `Walk_Carry`, `Jog` and `Sprint`, the `root` translation track has two keys and zero net travel,
 * and the pelvis returns exactly to where it started. Fed to that instrument the replacement reports
 * `rootTravelMeters: 0`, `impliedGroundSpeed: 0` and, through the instrument's own divide-by-zero
 * guard, `fractionOfRootTravel: 0` for every joint at every contact height. Zero because nothing was
 * measured, wearing the shape of a perfect score. That is why this file exists and why it is not a
 * loosened threshold.
 *
 * IN PLACE IS THE RIGHT SHAPE, NOT A DEFECT. `approach-executor.ts` advances the root itself at
 * `CLINICIAN_WALK_SPEED_MPS`; a clip carrying its own root motion fights it. So the composed frame
 * is the honest one: world foot = clip foot + executor advance, and a planted foot is one that
 * holds still in THAT frame.
 *
 * THE SPEED IS DERIVED FROM THE CLIP, NOT ASSUMED FROM THE RUNTIME. Composing with
 * `CLINICIAN_WALK_SPEED_MPS` would measure how well the runtime's constant happens to match, and a
 * speed chosen to minimise the slide would be a threshold fitted to its own answer. Instead: while a
 * foot is on the floor its ground-frame velocity is zero by definition, so the body advances at
 * exactly the rate that foot moves BACKWARD in the body frame. `groundSpeedFromStance` reads that
 * rate off the stance windows. It is a property of the clip's own keyframes and moves whether or not
 * the plant is any good — a clip with hopeless feet still yields a stance speed, and then fails the
 * slide test rather than redefining it.
 *
 * THE SAME METRIC GRADES BOTH. `footSlideMeters` is imported from the runtime module, exactly as
 * `bound-clip-foot-plant.ts` imports it, so the CMU numbers and these numbers are comparable.
 *
 * CLAIM SCOPE: world foot tracks of one bound clip on one MPFB physician rig, composed with a
 * constant ground advance derived from the clip's own stance phases. NOT EVIDENCE FOR what the
 * runtime displays, visual walk quality, clinical gait realism, or Quest readiness.
 */

const CONTACT_HEIGHT_SWEEP_METERS = [FOOT_CONTACT_HEIGHT_METERS, 0.1, 0.15] as const;

/** The same leg-chain joints `bound-clip-foot-plant.ts` measures, so the two reports line up. */
export const MPFB_MEASURED_JOINTS = ["toe1-1.L", "toe1-1.R", "foot.L", "foot.R"] as const;

export type StanceWindow = { fromMs: number; toMs: number; displacement: { x: number; z: number } };

export type GroundSpeedFromStance = {
  /** Metres per second the body must advance for these stance phases to be stationary on the floor. */
  groundSpeedMetersPerSecond: number;
  /** Unit horizontal vector the body advances along. */
  forward: { x: number; z: number };
  windows: StanceWindow[];
  contactHeightMeters: number;
};

export type ReplacementWalkApproachReport = {
  schemaVersion: "openclinxr.replacement-walk-approach.v1";
  generatedAt: string;
  asset: { glbPath: string; sha256: string; bytes: number; clipName: string };
  clip: {
    frameCount: number;
    durationSeconds: number;
    framesPerSecond: number;
    rootJoint: string;
    /** Zero for an in-place cycle. Recorded rather than assumed, because it decides the metric. */
    rootTravelMeters: number;
    inPlace: boolean;
  };
  groundSpeed: GroundSpeedFromStance;
  /** What the composed advance covers over the clip, and how it compares with the runtime constant. */
  executorSpeedMatch: {
    executorSpeedMetersPerSecond: number;
    clipSpeedMetersPerSecond: number;
    ratio: number;
    advanceOverClipMeters: number;
  };
  joints: Array<{
    joint: string;
    minHeightMeters: number;
    medianHeightMeters: number;
    maxHeightMeters: number;
    contactSweep: Array<{
      contactHeightMeters: number;
      isRuntimeThreshold: boolean;
      slideMeters: number;
      contactFrames: number;
      worstFrameSlideMeters: number;
      /** Slide as a share of the ground the body covers in the same clip. */
      fractionOfAdvance: number;
    }>;
  }>;
  claimScope: string;
  notEvidenceFor: string[];
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Read the body's ground speed off the frames where a foot is on the floor.
 *
 * A stance window is a maximal run of consecutive in-contact frames of length two or more. Across
 * each, the foot's horizontal displacement in the body frame is the ground it gave back; divided by
 * the window's duration that is a speed, and its direction reversed is the body's forward.
 *
 * It REFUSES rather than returning zero when there is no stance to read: a clip whose feet never
 * reach the floor has no ground speed, and a zero would be indistinguishable from a body standing
 * still — the exact confusion this whole file exists to remove.
 */
export function groundSpeedFromStance(
  samples: readonly FootSample[],
  contactHeightMeters: number = FOOT_CONTACT_HEIGHT_METERS,
): GroundSpeedFromStance {
  const windows: StanceWindow[] = [];
  let runStart: number | null = null;
  for (let index = 0; index <= samples.length; index += 1) {
    const sample = samples[index];
    const inContact = sample !== undefined && sample.position.y <= contactHeightMeters;
    if (inContact && runStart === null) runStart = index;
    if (!inContact && runStart !== null) {
      const first = samples[runStart];
      const last = samples[index - 1];
      // runStart was set from a real in-contact index and index - 1 >= runStart, so both are
      // present. Guarded rather than asserted: a silent undefined here would report a zero-length
      // stance window, which reads as a clean plant.
      if (first === undefined || last === undefined) {
        throw new Error(`stance window [${runStart}, ${index - 1}] is not backed by samples`);
      }
      if (index - 1 > runStart) {
        windows.push({
          fromMs: first.atMs,
          toMs: last.atMs,
          displacement: { x: last.position.x - first.position.x, z: last.position.z - first.position.z },
        });
      }
      runStart = null;
    }
  }
  if (windows.length === 0) {
    throw new Error(
      `groundSpeedFromStance: no stance window of two or more consecutive frames below ${contactHeightMeters} m. A clip whose feet never reach the floor has no ground speed to read, and returning zero would be indistinguishable from a body standing still.`,
    );
  }
  const speeds: number[] = [];
  let sumX = 0;
  let sumZ = 0;
  for (const window of windows) {
    const seconds = (window.toMs - window.fromMs) / 1000;
    if (seconds <= 0) continue;
    const distance = Math.hypot(window.displacement.x, window.displacement.z);
    speeds.push(distance / seconds);
    sumX += window.displacement.x;
    sumZ += window.displacement.z;
  }
  if (speeds.length === 0) {
    throw new Error("groundSpeedFromStance: every stance window has zero duration; the clip's times are not monotonic.");
  }
  // The foot goes BACKWARD under a body going forward, so forward is the reversed sum.
  const magnitude = Math.hypot(sumX, sumZ);
  const forward = magnitude === 0 ? { x: 0, z: 0 } : { x: -sumX / magnitude, z: -sumZ / magnitude };
  return {
    groundSpeedMetersPerSecond: median(speeds),
    forward,
    windows,
    contactHeightMeters,
  };
}

/** Add a constant ground advance to a body-frame track, giving the world track a viewer would see. */
export function composeWithGroundAdvance(
  samples: readonly FootSample[],
  groundSpeed: GroundSpeedFromStance,
): FootSample[] {
  const first = samples[0];
  if (!first) return [];
  return samples.map((sample) => {
    const seconds = (sample.atMs - first.atMs) / 1000;
    const advance = groundSpeed.groundSpeedMetersPerSecond * seconds;
    return {
      atMs: sample.atMs,
      position: {
        x: sample.position.x + groundSpeed.forward.x * advance,
        y: sample.position.y,
        z: sample.position.z + groundSpeed.forward.z * advance,
      },
    };
  });
}

export async function measureReplacementWalkApproach(input: {
  glbPath: string;
  clipName: string;
  joints?: readonly string[];
  rootJoint?: string;
  /** The joint whose stance phases set the ground speed. Defaults to the left toe. */
  speedReferenceJoint?: string;
}): Promise<ReplacementWalkApproachReport> {
  const rootJoint = input.rootJoint ?? "root";
  const measuredJoints = input.joints ?? MPFB_MEASURED_JOINTS;
  const bytes = await readFile(input.glbPath);
  const rootTrack = await boundClipJointTrack({ ...input, boneName: rootJoint });
  const frames = rootTrack.samples;
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!first || !last || frames.length < 2) {
    throw new Error(
      `measureReplacementWalkApproach: ${input.clipName} has ${frames.length} frame(s); a track cannot be measured from fewer than two.`,
    );
  }
  const durationSeconds = (last.atMs - first.atMs) / 1000;
  const rootTravelMeters = Math.hypot(last.position.x - first.position.x, last.position.z - first.position.z);

  // BODY FRAME, so a clip that bakes its own root motion and a clip that does not are graded by
  // the identical procedure. For an in-place clip the root's horizontal track is constant and this
  // subtracts nothing; for the CMU walk it removes the 3.197 m the BVH carries, which is what makes
  // the two numbers comparable at all. Height is left alone — the floor does not move with the hips.
  const toBodyFrame = (samples: readonly FootSample[]): FootSample[] =>
    samples.map((sample, index) => {
      const rootSample = frames[Math.min(index, frames.length - 1)];
      if (rootSample === undefined) {
        throw new Error("toBodyFrame: the root track is empty, so there is no frame to subtract.");
      }
      return {
        atMs: sample.atMs,
        position: {
          x: sample.position.x - (rootSample.position.x - first.position.x),
          y: sample.position.y,
          z: sample.position.z - (rootSample.position.z - first.position.z),
        },
      };
    });

  const speedReference = await boundClipJointTrack({
    ...input,
    boneName: input.speedReferenceJoint ?? "toe1-1.L",
  });
  const groundSpeed = groundSpeedFromStance(toBodyFrame(speedReference.samples));

  const joints: ReplacementWalkApproachReport["joints"] = [];
  for (const joint of measuredJoints) {
    const track = await boundClipJointTrack({ ...input, boneName: joint });
    const bodyFrame = toBodyFrame(track.samples);
    const composed = composeWithGroundAdvance(bodyFrame, groundSpeed);
    const heights = bodyFrame.map((sample) => sample.position.y);
    const advanceMeters = groundSpeed.groundSpeedMetersPerSecond * durationSeconds;
    joints.push({
      joint,
      minHeightMeters: Math.min(...heights),
      medianHeightMeters: median(heights),
      maxHeightMeters: Math.max(...heights),
      contactSweep: CONTACT_HEIGHT_SWEEP_METERS.map((contactHeightMeters) => {
        const slide = footSlideMeters(composed, contactHeightMeters);
        return {
          contactHeightMeters,
          isRuntimeThreshold: contactHeightMeters === FOOT_CONTACT_HEIGHT_METERS,
          slideMeters: slide.slideMeters,
          contactFrames: slide.contactFrames,
          worstFrameSlideMeters: slide.worstFrameSlideMeters,
          fractionOfAdvance: advanceMeters === 0 ? Number.POSITIVE_INFINITY : slide.slideMeters / advanceMeters,
        };
      }),
    });
  }

  return {
    schemaVersion: "openclinxr.replacement-walk-approach.v1",
    generatedAt: new Date().toISOString(),
    asset: {
      glbPath: input.glbPath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
      clipName: input.clipName,
    },
    clip: {
      frameCount: frames.length,
      durationSeconds,
      framesPerSecond: (frames.length - 1) / durationSeconds,
      rootJoint,
      rootTravelMeters,
      inPlace: rootTravelMeters < 0.01,
    },
    groundSpeed,
    executorSpeedMatch: {
      executorSpeedMetersPerSecond: CLINICIAN_WALK_SPEED_MPS,
      clipSpeedMetersPerSecond: groundSpeed.groundSpeedMetersPerSecond,
      ratio: groundSpeed.groundSpeedMetersPerSecond / CLINICIAN_WALK_SPEED_MPS,
      advanceOverClipMeters: groundSpeed.groundSpeedMetersPerSecond * durationSeconds,
    },
    joints,
    claimScope:
      "world_foot_tracks_of_one_in_place_bound_clip_on_one_mpfb_physician_rig_composed_with_a_ground_advance_derived_from_its_own_stance_phases",
    notEvidenceFor: [
      "what_the_runtime_displays",
      "visual_walk_quality",
      "clinical_gait_realism",
      "quest_readiness",
      "any_other_clip_or_rig",
    ],
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const glbPath = flagValue("--glb");
  const clipName = flagValue("--clip");
  const reportPath = flagValue("--report");
  if (!glbPath || !clipName || !reportPath) {
    throw new Error("the-replacement-walk-preserves-approach-behaviour: --glb, --clip and --report are all required.");
  }
  const report = await measureReplacementWalkApproach({ glbPath, clipName });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${reportPath}\n`);
}

if (process.argv[1]?.endsWith("the-replacement-walk-preserves-approach-behaviour.ts")) await main();
