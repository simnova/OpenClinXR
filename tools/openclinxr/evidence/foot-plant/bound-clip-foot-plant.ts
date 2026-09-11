import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { planBedsideApproach } from "../../../../packages/openclinxr/asset-registry/src/bedside-approach-path.js";
import {
  ED_STRETCHER_DECK_BOUNDS,
  bedsideTargetForClinician,
} from "../../../../packages/openclinxr/asset-registry/src/index.js";
import {
  CLINICIAN_WALK_SPEED_MPS,
  FOOT_CONTACT_HEIGHT_METERS,
  footSlideMeters,
  stepBedsideApproach,
} from "../../../../packages/openclinxr/asset-registry/src/approach-executor.js";
import { boundClipJointTrack } from "./bound-clip-foot-track.js";

/**
 * Does the bound walk clip plant its feet on the rig that would ship?
 *
 * Brief §7 step 4: "Measure continuous-path collisions, foot sliding, final pose and equipment
 * clearance." The foot-sliding half had two numbers and neither was about the shipped rig — the
 * root-driven executor's ~100%, and the CMU BVH's own toes in the source skeleton. Retargeting is
 * where a plant is normally lost, so the measurement that matters is on the retargeted armature.
 *
 * THE SAME METRIC GRADES BOTH. `footSlideMeters` is imported, not reimplemented, which is what
 * `approach-executor.ts` claimed would happen when a clip existed. Its baseline is recomputed here
 * so the two numbers sit in one artifact rather than in two files a reader has to join.
 *
 * A SWEEP, NOT ONE THRESHOLD. Contact height decides the answer, so picking the single height that
 * flatters the clip would be fitting a number to a conclusion. The runtime's own
 * FOOT_CONTACT_HEIGHT_METERS is included and named as such.
 *
 * THE GLB IS GITIGNORED, so the artifact this writes is the deliverable that lands. It carries the
 * GLB's sha256 and byte length: a report that does not name the bytes it measured is green about
 * nothing the moment the asset is rebaked.
 */

const DEFAULT_GLB = ".openclinxr/evidence/walk-bind/physician-walk.glb";
const DEFAULT_CLIP = "openclinxr_retarget_cmu_02_01_walk";
const DEFAULT_REPORT = "docs/openclinxr/evidence/bound-clip-foot-plant.json";

/** Heights in metres at which a foot is treated as in contact. */
const CONTACT_HEIGHT_SWEEP_METERS = [FOOT_CONTACT_HEIGHT_METERS, 0.1, 0.15] as const;

/** The leg-chain joints the retarget drove, ankle and toe on both sides. */
export const MPFB_MEASURED_JOINTS = ["toe1-1.L", "toe1-1.R", "foot.L", "foot.R"] as const;

export type BoundClipFootPlantReport = {
  schemaVersion: "openclinxr.bound-clip-foot-plant.v1";
  generatedAt: string;
  asset: { glbPath: string; sha256: string; bytes: number; clipName: string };
  clip: {
    frameCount: number;
    durationSeconds: number;
    framesPerSecond: number;
    rootJoint: string;
    rootTravelMeters: number;
    impliedGroundSpeedMetersPerSecond: number;
  };
  /**
   * The executor advances a root at a constant speed. If the clip's own ground speed differs, the
   * feet slide by the difference however well the clip plants, so the ratio is reported rather than
   * left for a reader to compute.
   */
  executorSpeedMatch: {
    executorSpeedMetersPerSecond: number;
    clipSpeedMetersPerSecond: number;
    ratio: number;
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
      fractionOfRootTravel: number;
    }>;
  }>;
  /** The number this has to beat, recomputed here from the same metric. */
  rootDrivenExecutorBaseline: {
    slideMeters: number;
    pathLengthMeters: number;
    fractionOfPath: number;
  };
  claimScope: string;
  notEvidenceFor: string[];
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** The executor with no leg animation, measured with the same metric for side-by-side reading. */
function rootDrivenBaseline(): BoundClipFootPlantReport["rootDrivenExecutorBaseline"] {
  const patient = { x: -0.9, y: 0, z: -0.1 };
  const doorway = { x: 2.6, y: 0, z: 2.2 };
  const target = bedsideTargetForClinician({
    patientPosition: patient,
    supportBounds: ED_STRETCHER_DECK_BOUNDS,
  }).position;
  const plan = planBedsideApproach({ from: doorway, target, facing: patient, obstacles: [] });
  const samples = [];
  for (let elapsedMs = 0; elapsedMs <= 4000; elapsedMs += 100) {
    const pose = stepBedsideApproach({ plan, elapsedMs });
    samples.push({ atMs: elapsedMs, position: { x: pose.position.x, y: 0.02, z: pose.position.z } });
  }
  const report = footSlideMeters(samples);
  const pathLengthMeters = Math.hypot(target.x - doorway.x, target.z - doorway.z);
  return {
    slideMeters: report.slideMeters,
    pathLengthMeters,
    fractionOfPath: report.slideMeters / pathLengthMeters,
  };
}

export async function measureBoundClipFootPlant(input: {
  glbPath: string;
  clipName: string;
  /** Override for a fixture rig; the MPFB leg chain otherwise. */
  joints?: readonly string[];
  rootJoint?: string;
}): Promise<BoundClipFootPlantReport> {
  const rootJoint = input.rootJoint ?? "root";
  const measuredJoints = input.joints ?? MPFB_MEASURED_JOINTS;
  const bytes = await readFile(input.glbPath);
  const rootTrack = await boundClipJointTrack({ ...input, boneName: rootJoint });
  const frames = rootTrack.samples;
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!first || !last || frames.length < 2) {
    throw new Error(
      `measureBoundClipFootPlant: ${input.clipName} has ${frames.length} frame(s); a track cannot be measured from fewer than two.`,
    );
  }
  // NOT last.atMs: a clip whose first key is not at zero would report an inflated duration and a
  // deflated frame rate, and the frame rate is the number that caught the 24 fps export.
  const durationSeconds = (last.atMs - first.atMs) / 1000;
  const rootTravelMeters = Math.hypot(last.position.x - first.position.x, last.position.z - first.position.z);
  const clipSpeed = durationSeconds === 0 ? 0 : rootTravelMeters / durationSeconds;

  const joints: BoundClipFootPlantReport["joints"] = [];
  for (const joint of measuredJoints) {
    const track = await boundClipJointTrack({ ...input, boneName: joint });
    const heights = track.samples.map((sample) => sample.position.y);
    joints.push({
      joint,
      minHeightMeters: Math.min(...heights),
      medianHeightMeters: median(heights),
      maxHeightMeters: Math.max(...heights),
      contactSweep: CONTACT_HEIGHT_SWEEP_METERS.map((contactHeightMeters) => {
        const slide = footSlideMeters(track.samples, contactHeightMeters);
        return {
          contactHeightMeters,
          isRuntimeThreshold: contactHeightMeters === FOOT_CONTACT_HEIGHT_METERS,
          slideMeters: slide.slideMeters,
          contactFrames: slide.contactFrames,
          worstFrameSlideMeters: slide.worstFrameSlideMeters,
          fractionOfRootTravel: rootTravelMeters === 0 ? 0 : slide.slideMeters / rootTravelMeters,
        };
      }),
    });
  }

  return {
    schemaVersion: "openclinxr.bound-clip-foot-plant.v1",
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
      impliedGroundSpeedMetersPerSecond: clipSpeed,
    },
    executorSpeedMatch: {
      executorSpeedMetersPerSecond: CLINICIAN_WALK_SPEED_MPS,
      clipSpeedMetersPerSecond: clipSpeed,
      ratio: clipSpeed / CLINICIAN_WALK_SPEED_MPS,
    },
    joints,
    rootDrivenExecutorBaseline: rootDrivenBaseline(),
    claimScope:
      "foot_and_toe_world_tracks_of_one_bound_clip_on_one_mpfb_physician_rig_measured_from_the_glTF_node_hierarchy",
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
  const flagValue = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
  };
  const reportPath = flagValue("--report", DEFAULT_REPORT);
  const report = await measureBoundClipFootPlant({
    glbPath: flagValue("--glb", DEFAULT_GLB),
    clipName: flagValue("--clip", DEFAULT_CLIP),
  });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${reportPath}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await main();
}
