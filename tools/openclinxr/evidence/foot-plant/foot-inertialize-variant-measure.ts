import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import {
  boneLengthSeries,
  censusSkinnedGeometry,
  jointTracks,
  SHIPPED_PHYSICIAN_LEG_BONES,
} from "../scene-closure/proofs/sc-00/selected-asset-measurement.js";
import {
  type DecodedPhysician,
  intentFor,
  runApproach,
  stageWard,
} from "../scene-closure/proofs/sc-05/runtime-approach-measurement.js";
import { computeTurnQuality,
  type TurnQualityFrame,
} from "./turn-quality-metrics.js";

/**
 * Headless settling-turn assay for the foot-inertialize evaluation (2026-10-09).
 *
 * Drives the PRODUCTION case-owned bedside approach (`runApproach`, the SC-05 headless
 * instrument — no browser) with the REAL decoded walk-clip toe tracks of each rig's shipped
 * GLB, then grades the run with the EXISTING `computeTurnQuality` (turn-quality-metrics.ts).
 * Same-day baseline: every variant measured with this file on this machine.
 *
 * Rigs: physician (mpfb-clinical-physician-adult), nurse (mpfb-clinical-nurse-adult),
 * child (mpfb-peds-patient-child). All three carry the same walk clip.
 */

const WALK_CLIP = "openclinxr_retarget_walk_source";
const CONTACT_JOINTS = ["toe1-1.L", "toe1-1.R"] as const;
const SIM_SECONDS = 12;

const RIGS = [
  { rig: "physician", glb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb" },
  { rig: "nurse", glb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb" },
  { rig: "child", glb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb" },
] as const;

async function lowestSkinnedVertexY(glbPath: string): Promise<number> {
  const document = await new NodeIO().read(glbPath);
  let lowest = Number.POSITIVE_INFINITY;
  for (const node of document.getRoot().listNodes()) {
    if (!node.getSkin() || !node.getMesh()) continue;
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const position = primitive.getAttribute("POSITION");
      if (!position) continue;
      const element = [0, 0, 0];
      for (let index = 0; index < position.getCount(); index += 1) {
        position.getElement(index, element);
        if ((element[1] ?? 0) < lowest) lowest = element[1] ?? 0;
      }
    }
  }
  if (!Number.isFinite(lowest)) throw new Error(`no skinned vertices in ${glbPath}`);
  return lowest;
}

async function decodeRig(glbPath: string): Promise<DecodedPhysician> {
  const [tracks, census, bones, meshMinY] = await Promise.all([
    jointTracks({ glbPath, clipName: WALK_CLIP, joints: CONTACT_JOINTS }),
    censusSkinnedGeometry(glbPath),
    boneLengthSeries({ glbPath, clipName: WALK_CLIP, bones: SHIPPED_PHYSICIAN_LEG_BONES }),
    lowestSkinnedVertexY(glbPath),
  ]);
  // Same rest-frame drop as decodePhysician: index 0 is the symmetric rest frame.
  const left = (tracks[0]?.samples ?? []).slice(1);
  const right = (tracks[1]?.samples ?? []).slice(1);
  const first = left[0];
  const last = left[left.length - 1];
  if (first === undefined || last === undefined) throw new Error(`no toe track in ${glbPath}`);
  const restA = tracks[0]?.samples[0]?.position ?? { x: 0, y: 0, z: 0 };
  const restB = tracks[1]?.samples[0]?.position ?? { x: 0, y: 0, z: 0 };
  return {
    left,
    right,
    periodMs: last.atMs - first.atMs,
    firstMs: first.atMs,
    skinnedBodyCount: census.skinnedBodyCount,
    skinnedVertexSampleCount: census.skinnedVertexSampleCount,
    boneLengths: bones,
    meshMinY,
    restLeft: { ...restA },
    restRight: { ...restB },
  };
}

/** Count of single-frame stance-label jumps (>20 mm), mirroring maxStanceToeStepPerFrame scope. */
function countStanceJumps(frames: TurnQualityFrame[], thresholdM: number): number {
  let count = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (previous === undefined || current === undefined) continue;
    if (previous.stanceFoot !== "left" && previous.stanceFoot !== "right") continue;
    if (current.stanceFoot !== "left" && current.stanceFoot !== "right") continue;
    const switched = previous.stanceFoot !== current.stanceFoot;
    const sides: readonly ("left" | "right")[] = switched
      ? (["left", "right"] as const)
      : ([current.stanceFoot] as const);
    for (const side of sides) {
      const a = previous[side];
      const b = current[side];
      if (a === null || b === null) continue;
      if (Math.hypot(b.x - a.x, b.z - a.z) > thresholdM) count += 1;
    }
  }
  return count;
}

/**
 * One-frame mouth-style excursion count on a height series: samples where the middle
 * frame leaves by >5 mm and returns the next frame (both neighbours on the same side
 * within 5 mm of each other). Applied to each toe's settling-phase world-Y series.
 */
function countToeExcursions(series: number[], thresholdM: number): number {
  let count = 0;
  for (let i = 1; i < series.length - 1; i += 1) {
    const a = series[i - 1]!;
    const b = series[i]!;
    const c = series[i + 1]!;
    if (Math.abs(b - a) > thresholdM && Math.abs(b - c) > thresholdM && Math.abs(c - a) <= thresholdM) {
      count += 1;
    }
  }
  return count;
}

/**
 * Duty factor without importing the labels module: tools files cannot add a relative
 * import into packages src (shrink-only freeze on cross-boundary path imports), and
 * locomotion-stance-labels is not on the package public surface. This inlines the exact
 * construction from computeLocomotionStanceLabels in locomotion-stance-labels.ts:
 * median backward along-axis speed band plus clip-envelope height cut, duty as the mean
 * stance fraction of both feet.
 */
function dutyFactor(
  left: ReadonlyArray<{ atMs: number; position: { x: number; y: number; z: number } }>,
  right: ReadonlyArray<{ atMs: number; position: { x: number; y: number; z: number } }>,
  forward: { x: number; z: number },
): number {
  const length = Math.hypot(forward.x, forward.z);
  const fwd = length > 0 ? { x: forward.x / length, z: forward.z / length } : { x: 0, z: 1 };
  const alongOf = (
    track: ReadonlyArray<{ atMs: number; position: { x: number; y: number; z: number } }>,
    index: number,
  ): number => {
    const previous = track[(index - 1 + track.length) % track.length];
    const next = track[(index + 1) % track.length];
    if (previous === undefined || next === undefined) return 0;
    const dtSeconds = (next.atMs - previous.atMs) / 1000;
    if (!(dtSeconds > 0)) return 0;
    return (
      ((next.position.x - previous.position.x) * fwd.x
        + (next.position.z - previous.position.z) * fwd.z)
      / dtSeconds
    );
  };
  const count = left.length;
  const backwardSpeeds: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const alongLeft = left.length > 0 ? alongOf(left, index) : 0;
    const alongRight = right.length > 0 ? alongOf(right, index) : 0;
    if (alongLeft < 0) backwardSpeeds.push(-alongLeft);
    if (alongRight < 0) backwardSpeeds.push(-alongRight);
  }
  const sorted = [...backwardSpeeds].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] ?? 0 : 0;
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations.length > 0 ? deviations[Math.floor(deviations.length / 2)] ?? 0 : 0;
  const tolerance = Math.max(2 * mad, 0.1 * median);
  const lower = sorted.length > 0 ? sorted[0] ?? 0 : 0;
  const heights: number[] = [];
  for (const sample of left) heights.push(sample.position.y);
  for (const sample of right) heights.push(sample.position.y);
  const heightCut = Math.min(...heights) + 0.5 * (Math.max(...heights) - Math.min(...heights)) + 0.005;
  const dutyOf = (
    track: ReadonlyArray<{ atMs: number; position: { x: number; y: number; z: number } }>,
  ): number => {
    if (track.length === 0) return 0;
    let stance = 0;
    track.forEach((sample, index) => {
      const backward = -alongOf(track, index);
      if (backward >= lower && backward <= median + tolerance && sample.position.y <= heightCut) {
        stance += 1;
      }
    });
    return stance / track.length;
  };
  return (dutyOf(left) + dutyOf(right)) / 2;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
  };
  const variant = flagValue("--variant", "A");
  const outPath = flagValue("--out", `docs/openclinxr/locomotion/foot-inertialize-variant-${variant.toLowerCase()}-2026-10-09.json`);
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    commit = "unknown";
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const { rig, glb } of RIGS) {
    const decoded = await decodeRig(glb);
    const ward = stageWard();
    const intent = intentFor(ward);
    if (intent.refused) throw new Error(`approach refused: ${intent.reason}`);
    const run = runApproach({ ward, intent, seconds: SIM_SECONDS, decoded });
    const frames: TurnQualityFrame[] = run.frames.map((frame, index) => {
      const left = run.trackL[index];
      const right = run.trackR[index];
      return {
        sample: index,
        tMs: index * (1000 / 60),
        phase: frame.phase,
        left: left ? { ...left.position } : null,
        right: right ? { ...right.position } : null,
        stanceFoot: frame.stanceFoot,
        slotYawRadians: frame.headingRadians,
        headYawWorldRadians: null,
      };
    });
    const quality = computeTurnQuality({
      frames,
      walkDiagnostics: { targetHeadingRadians: intent.target.headingRadians },
    });
    const settlingIndex = frames
      .map((frame, index) => (frame.phase === "settling" ? index : -1))
      .filter((index) => index >= 0);
    const settlingY = (track: Array<{ atMs: number; position: { x: number; y: number; z: number } }>): number[] =>
      settlingIndex.map((index) => track[index]?.position.y ?? Number.NaN).filter((v) => Number.isFinite(v));
    const toeExcursions =
      countToeExcursions(settlingY(run.trackL), 0.005) + countToeExcursions(settlingY(run.trackR), 0.005);
    rows.push({
      variant,
      rig,
      glb,
      commit,
      plantedSlideM: quality.plantedSlideM,
      maxToeStepPerFrameM: quality.maxToeStepPerFrameM,
      stanceToeStepPerFrameM: quality.stanceToeStepPerFrameM,
      stanceJumpsOver20mm: countStanceJumps(frames, 0.02),
      sc05ArrivalErrM: run.arrivalErrorMeters,
      settledYawErrDeg: run.settledYawErrorDegrees,
      dutyFactor: dutyFactor(decoded.left, decoded.right, run.clipAdvance.forward),
      toeExcursions,
      settleSeconds: quality.settleSeconds,
      floorPenetrationM: quality.floorPenetrationM,
      minStepLiftM: quality.minStepLiftM,
      walkFrames: run.walkFrameCount,
      settleFrames: run.settleFrameCount,
    });
    process.stdout.write(
      `${variant}/${rig}: plantedSlide=${quality.plantedSlideM?.toFixed(5)} maxToeStep=${quality.maxToeStepPerFrameM?.toFixed(5)} stanceStep=${quality.stanceToeStepPerFrameM?.toFixed(5)} arrival=${run.arrivalErrorMeters.toFixed(5)}\n`,
    );
  }
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify({ variant, commit, measuredAt: new Date().toISOString(), rows }, null, 2)}\n`, "utf8");
  process.stdout.write(`${outPath}\n`);
}

await main();
