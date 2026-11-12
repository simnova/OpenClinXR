/**
 * RR1 learner-camera framing census (MEASURE ONLY, no product fix).
 *
 * Question: which input selects the learner camera framing seen in ch1 of
 * rr1-min.webm, where store run-7 + scratch run-19 are narrow (no door) and
 * scratch run-11 + run-20 are wide (wood door at right)?
 *
 * Answer encoded here: the framing is selected by the `capture` URL query
 * param read by selectedCaptureMode() (apps/ui-xr/src/main.ts:1039, pure
 * helper packages/openclinxr/xr-capture-evidence/src/capture-mode.ts:8),
 * branched in apps/ui-xr/src/main.ts:2799-2868. RR1 captures pass no
 * `capture` param (tools/openclinxr/evidence/xr-sync/rr1-run.mjs:1170 builds
 * the learner URL with only `encounterSync`), so every RR1 run takes the
 * default wide branch (fov 55, position 0,1.48,5.35, target 0,1.04,-0.18,
 * main.ts:2862-2866). The pre-tap run dirs record neither the page URL nor
 * numeric camera pose nor the room bytes loaded, so per-run pose/room inputs
 * are "unrecorded" while seed/blueprint/viewport/preset/buildSha are recorded
 * and identical across the four runs. Newer --run dirs record
 * camera.learnerPose, environmentGlbs, and distBuild in capture.json, which
 * the census below compares.
 *
 * Pixel separation: mean luma of the right 20% of the 3D viewport. The
 * learner page is a 960x600 side-by-side shell whose 3D canvas occupies
 * x 0-540 (the runtime panel occupies x 540-960, see the learnerTrim metric
 * "x=540,y=0,w=420,h=600" in every capture.json); the right 20% of the
 * canvas is therefore x 432-540, y 0-600. Narrow renders measure ~207,
 * wide renders (dark wood door at right) measure ~202.
 */

export const FRAMING_LUMA_CROP = {
  x: 432,
  y: 0,
  width: 108,
  height: 600,
} as const;

/** Narrow (~207) vs wide (~202) groups differ by ~5; within-group spread is <0.5. */
export const FRAMING_LUMA_THRESHOLD = 2.0;

export type CensusVerdict =
  | "inputs_differ"
  | "inputs_identical_frames_differ"
  | "unrecorded"
  | "other";

export type FieldRecord =
  | { readonly status: "recorded"; readonly value: string; readonly source: string }
  | { readonly status: "unrecorded"; readonly lookedIn: string };

export interface RunFramingEvidence {
  readonly run: string;
  readonly cameraPosition: FieldRecord;
  readonly cameraTarget: FieldRecord;
  readonly cameraFov: FieldRecord;
  readonly roomAssetPath: FieldRecord;
  readonly roomAssetSha256: FieldRecord;
  readonly seed: FieldRecord;
  readonly blueprint: FieldRecord;
  readonly viewport: FieldRecord;
  readonly buildSha: FieldRecord;
  readonly cameraPreset: FieldRecord;
  /** ch1 offsetSeconds from the run's chapters.json (0.00 for all four runs). */
  readonly ch1OffsetSeconds: number;
  /** Mean luma of FRAMING_LUMA_CROP in the ffmpeg-decoded ch1 frame. */
  readonly ch1RightStripMeanLuma: number;
  /**
   * Learner camera pose snapshots recorded by rr1-run.mjs --run
   * (capture.json camera.learnerPose). Absent in run dirs recorded before
   * the pose tap landed (narrow.json/wide.json).
   */
  readonly cameraLearnerPose?: {
    readonly sceneReady: LearnerPoseSnapshot;
    readonly ch1: LearnerPoseSnapshot;
  };
  /** Environment GLB responses (capture.json environmentGlbs). */
  readonly environmentGlbs?: readonly EnvironmentGlbEvidence[];
  /** Served dist build identity (capture.json distBuild). */
  readonly distBuild?: DistBuildEvidence;
}

export interface LearnerPoseSnapshot {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
  readonly fov: number;
  readonly aspect: number;
  readonly near: number;
  readonly far: number;
  readonly wallMs: number;
}

export interface EnvironmentGlbEvidence {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly wallMs: number;
  readonly loadedBeforeSceneReady: boolean;
  readonly loadedBeforeCh1: boolean;
}

export interface DistBuildEvidence {
  readonly indexSha256: string;
  readonly mainChunk: string;
}

/** Absolute tolerance for learner-pose numbers: float round-trip only, not a framing tolerance. */
export const LEARNER_POSE_TOLERANCE = 1e-6;

export interface FramingCensusResult {
  readonly verdict: CensusVerdict;
  readonly reason: string;
  readonly differingFields: readonly string[];
  readonly lumaSpread: number;
}

const INPUT_FIELD_NAMES = [
  "cameraPosition",
  "cameraTarget",
  "cameraFov",
  "roomAssetPath",
  "roomAssetSha256",
  "seed",
  "blueprint",
  "viewport",
  "buildSha",
  "cameraPreset",
] as const;

type InputFieldName = (typeof INPUT_FIELD_NAMES)[number];

/** Core framing inputs whose absence forces an "unrecorded" (not identical) reading. */
const CORE_FRAMING_FIELDS: readonly InputFieldName[] = [
  "cameraPosition",
  "cameraTarget",
  "cameraFov",
  "roomAssetPath",
  "roomAssetSha256",
];

function recordedValues(runs: readonly RunFramingEvidence[], field: InputFieldName): string[] {
  const values: string[] = [];
  for (const run of runs) {
    const record: FieldRecord = run[field];
    if (record.status === "recorded") values.push(record.value);
  }
  return values;
}

/** Recorded input fields with >= 2 distinct recorded values across runs. */
export function differingInputFields(runs: readonly RunFramingEvidence[]): string[] {
  const differing: string[] = [];
  for (const field of INPUT_FIELD_NAMES) {
    if (new Set(recordedValues(runs, field)).size > 1) differing.push(field);
  }
  differing.push(...learnerPoseDifferingPaths(runs));
  differing.push(...environmentGlbsDifferingPaths(runs));
  differing.push(...distBuildDifferingPaths(runs));
  return differing;
}

function poseNumbersDiffer(values: readonly number[]): boolean {
  if (values.length < 2) return false;
  return Math.max(...values) - Math.min(...values) > LEARNER_POSE_TOLERANCE;
}

/** camera.learnerPose.<moment>.<field> paths; wallMs is recorded but never compared. */
export function learnerPoseDifferingPaths(runs: readonly RunFramingEvidence[]): string[] {
  const poses: Array<{ sceneReady: LearnerPoseSnapshot; ch1: LearnerPoseSnapshot }> = [];
  for (const run of runs) {
    const pose = run.cameraLearnerPose;
    if (pose === undefined || pose === null) continue;
    const sceneReady = pose.sceneReady as LearnerPoseSnapshot | null | undefined;
    const ch1 = pose.ch1 as LearnerPoseSnapshot | null | undefined;
    if (sceneReady == null || ch1 == null) continue;
    poses.push({ sceneReady, ch1 });
  }
  if (poses.length < 2) return [];
  const moments = ["sceneReady", "ch1"] as const;
  const paths: string[] = [];
  for (const moment of moments) {
    const snapshots = poses.map((pose) => pose[moment]);
    const numericGroups: Array<[string, readonly number[]]> = [
      [`camera.learnerPose.${moment}.position.x`, snapshots.map((snapshot) => snapshot.position.x)],
      [`camera.learnerPose.${moment}.position.y`, snapshots.map((snapshot) => snapshot.position.y)],
      [`camera.learnerPose.${moment}.position.z`, snapshots.map((snapshot) => snapshot.position.z)],
      [`camera.learnerPose.${moment}.direction.x`, snapshots.map((snapshot) => snapshot.direction.x)],
      [`camera.learnerPose.${moment}.direction.y`, snapshots.map((snapshot) => snapshot.direction.y)],
      [`camera.learnerPose.${moment}.direction.z`, snapshots.map((snapshot) => snapshot.direction.z)],
      [`camera.learnerPose.${moment}.fov`, snapshots.map((snapshot) => snapshot.fov)],
      [`camera.learnerPose.${moment}.aspect`, snapshots.map((snapshot) => snapshot.aspect)],
      [`camera.learnerPose.${moment}.near`, snapshots.map((snapshot) => snapshot.near)],
      [`camera.learnerPose.${moment}.far`, snapshots.map((snapshot) => snapshot.far)],
    ];
    for (const [path, values] of numericGroups) {
      if (poseNumbersDiffer(values)) paths.push(path);
    }
  }
  return paths;
}

/** environmentGlbs[i].<field> paths; wallMs is recorded but never compared. */
export function environmentGlbsDifferingPaths(runs: readonly RunFramingEvidence[]): string[] {
  const withGlbs: Array<readonly EnvironmentGlbEvidence[]> = [];
  for (const run of runs) {
    const glbs = run.environmentGlbs;
    if (glbs === undefined || glbs === null) continue;
    withGlbs.push(glbs);
  }
  if (withGlbs.length < 2) return [];
  const lengths = new Set(withGlbs.map((glbs) => glbs.length));
  if (lengths.size > 1) return ["environmentGlbs.length"];
  const first = withGlbs.at(0);
  if (first === undefined) return [];
  const count = first.length;
  const paths: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const urls = new Set(withGlbs.map((glbs) => glbs.at(index)?.url));
    if (urls.size > 1) paths.push(`environmentGlbs[${index}].url`);
    const byteCounts = new Set(withGlbs.map((glbs) => glbs.at(index)?.bytes));
    if (byteCounts.size > 1) paths.push(`environmentGlbs[${index}].bytes`);
    const hashes = new Set(withGlbs.map((glbs) => glbs.at(index)?.sha256));
    if (hashes.size > 1) paths.push(`environmentGlbs[${index}].sha256`);
    const beforeScene = new Set(withGlbs.map((glbs) => glbs.at(index)?.loadedBeforeSceneReady));
    if (beforeScene.size > 1) paths.push(`environmentGlbs[${index}].loadedBeforeSceneReady`);
    const beforeCh1 = new Set(withGlbs.map((glbs) => glbs.at(index)?.loadedBeforeCh1));
    if (beforeCh1.size > 1) paths.push(`environmentGlbs[${index}].loadedBeforeCh1`);
  }
  return paths;
}

export function distBuildDifferingPaths(runs: readonly RunFramingEvidence[]): string[] {
  const withBuild: Array<NonNullable<RunFramingEvidence["distBuild"]>> = [];
  for (const run of runs) {
    const build = run.distBuild;
    if (build === undefined || build === null) continue;
    withBuild.push(build);
  }
  if (withBuild.length < 2) return [];
  const paths: string[] = [];
  if (new Set(withBuild.map((build) => build.indexSha256)).size > 1) {
    paths.push("distBuild.indexSha256");
  }
  if (new Set(withBuild.map((build) => build.mainChunk)).size > 1) {
    paths.push("distBuild.mainChunk");
  }
  return paths;
}

/**
 * Runs missing the new capture.json keys while at least one run records
 * them. When no run records the new keys (pre-tap dirs like the existing
 * synthetic "other" pair) this returns [] so legacy verdicts are unchanged.
 */
export function unrecordedNewFramingFields(runs: readonly RunFramingEvidence[]): string[] {
  const anyPose = runs.some((run) => run.cameraLearnerPose != null);
  const anyGlbs = runs.some((run) => run.environmentGlbs != null);
  const anyBuild = runs.some((run) => run.distBuild != null);
  if (!anyPose && !anyGlbs && !anyBuild) return [];
  const missing: string[] = [];
  if (anyPose && runs.some((run) => run.cameraLearnerPose == null)) missing.push("camera.learnerPose");
  if (anyGlbs && runs.some((run) => run.environmentGlbs == null)) missing.push("environmentGlbs");
  if (anyBuild && runs.some((run) => run.distBuild == null)) missing.push("distBuild");
  return missing;
}

/** Max minus min of ch1RightStripMeanLuma. */
export function lumaSpread(runs: readonly RunFramingEvidence[]): number {
  const lumas = runs.map((run) => run.ch1RightStripMeanLuma);
  return Math.max(...lumas) - Math.min(...lumas);
}

export function framesDiffer(
  runs: readonly RunFramingEvidence[],
  threshold: number = FRAMING_LUMA_THRESHOLD,
): boolean {
  return lumaSpread(runs) >= threshold;
}

function unrecordedCoreFields(runs: readonly RunFramingEvidence[]): string[] {
  const missing: string[] = [];
  for (const field of CORE_FRAMING_FIELDS) {
    if (runs.some((run) => run[field].status === "unrecorded") && !missing.includes(field)) {
      missing.push(field);
    }
  }
  return missing;
}

export function verdictFramingCensus(
  runs: readonly RunFramingEvidence[],
  threshold: number = FRAMING_LUMA_THRESHOLD,
): FramingCensusResult {
  if (runs.length === 0) {
    return { verdict: "other", reason: "no runs supplied to the census", differingFields: [], lumaSpread: 0 };
  }
  const differingFields = differingInputFields(runs);
  const spread = lumaSpread(runs);
  const poseNote = runs.length > 0 && runs.every((run) => run.cameraLearnerPose != null)
    ? " Learner-pose numbers compared with absolute tolerance 1e-6 (float round-trip only, not a framing tolerance)."
    : "";
  if (differingFields.length > 0) {
    return {
      verdict: "inputs_differ",
      reason: `recorded framing input(s) differ across runs: ${differingFields.join(", ")}.${poseNote}`,
      differingFields,
      lumaSpread: spread,
    };
  }
  if (spread >= threshold) {
    const missing = [...unrecordedCoreFields(runs), ...unrecordedNewFramingFields(runs)];
    const caveat =
      missing.length > 0
        ? ` Camera pose (${missing.includes("cameraPosition") ? "position/target/fov" : "pose"}) and room asset bytes are unrecorded in the run dirs, so an unrecorded difference (stale dist build, async room-GLB load) cannot be ruled out; no recorded input explains the split.`
        : "";
    return {
      verdict: "inputs_identical_frames_differ",
      reason: `all recorded framing inputs (seed, blueprint, viewport, camera preset, buildSha) are identical across runs, but ch1 right-strip luma spreads ${spread.toFixed(2)} (>= ${threshold}).${caveat}${poseNote}`,
      differingFields,
      lumaSpread: spread,
    };
  }
  const missing = [...unrecordedCoreFields(runs), ...unrecordedNewFramingFields(runs)];
  if (missing.length > 0) {
    return {
      verdict: "unrecorded",
      reason: `recorded inputs agree and frames agree within threshold (spread ${spread.toFixed(2)} < ${threshold}), but core framing input(s) ${missing.join(", ")} are unrecorded in the run dirs${poseNote}`,
      differingFields,
      lumaSpread: spread,
    };
  }
  return {
    verdict: "other",
    reason: `recorded inputs agree and ch1 frames agree within threshold (spread ${spread.toFixed(2)} < ${threshold}); no framing difference to explain${poseNote}`,
    differingFields,
    lumaSpread: spread,
  };
}
