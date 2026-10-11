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
import {
  computeTurnQuality,
  type TurnQualityFrame,
} from "./turn-quality-metrics.js";

/**
 * Lane C cagematch: "arrival turn: arrive already facing the patient" (2026-10-11).
 *
 * Candidate A (CONTROL): current main — straight route + clip-driven settling turn.
 * Candidate B/C rows are appended by later stages of the same slice into the same
 * report shape (see .openclinxr/evidence/arrival-turn/report.json).
 *
 * Drives the PRODUCTION case-owned bedside approach (`runApproach`, the SC-05 headless
 * instrument — no browser) with each rig's shipped walk clip, then grades with the
 * EXISTING `computeTurnQuality` plus a whole-run episode-slide port (plantEpisodeMaxSlide
 * in turn-quality-metrics.ts is settling-scoped; the port below applies the identical
 * anchor/reset discipline per phase and whole-run).
 *
 * D1: reuses runApproach / computeTurnQuality / decoders, no new instruments.
 * D9: fixed SIM_SECONDS, fixed seeds (none — deterministic clip playback), no randomness.
 * D3/D4: headless assay, one rig first (--rig physician gates; nurse/child run once).
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/arrival-turn-cagematch.ts \
 *   [--rig physician|nurse|child] [--out .openclinxr/evidence/arrival-turn/control.json]
 */

const WALK_CLIP = "openclinxr_retarget_walk_source";
const CONTACT_JOINTS = ["toe1-1.L", "toe1-1.R"] as const;
const SIM_SECONDS = 12;

export const ARRIVAL_TURN_RIGS = [
  { rig: "physician", glb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb" },
  { rig: "nurse", glb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb" },
  { rig: "child", glb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb" },
] as const;
const RIGS = ARRIVAL_TURN_RIGS;

const PLANT_EPISODE_FOOTFALL_JUMP_METERS = 0.05;
const PLANT_EPISODE_LIFT_METERS = 0.008;

function dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Port of plantEpisodeMaxSlide (turn-quality-metrics.ts, settling-scoped) parameterised
 * by a phase allow-list. Identical anchor/reset discipline: anchor resets on stance-foot
 * change or on a lifted re-plant jumping > 0.05 m; a jump without a lift counts as slide.
 */
function episodeMaxSlide(
  frames: readonly TurnQualityFrame[],
  phases: ReadonlySet<string>,
): number | null {
  const selected = frames.filter(
    (f) => phases.has(f.phase) && f.left !== null && f.right !== null,
  );
  let currentPlant: string | null = null;
  let anchor: { x: number; z: number } | null = null;
  let maxSlide = Number.NEGATIVE_INFINITY;
  let liftedSinceAnchor = false;
  for (const frame of selected) {
    if (frame.stanceFoot !== "left" && frame.stanceFoot !== "right") continue;
    const plantToe = frame.stanceFoot === "left" ? frame.left : frame.right;
    if (plantToe === null) continue;
    const plantXz = { x: plantToe.x, z: plantToe.z };
    if (plantToe.y - 0 > PLANT_EPISODE_LIFT_METERS) liftedSinceAnchor = true;
    const isNewFootfall =
      frame.stanceFoot !== currentPlant ||
      (anchor !== null &&
        liftedSinceAnchor &&
        plantToe.y - 0 <= PLANT_EPISODE_LIFT_METERS &&
        dist2d(anchor, plantXz) > PLANT_EPISODE_FOOTFALL_JUMP_METERS);
    if (isNewFootfall) {
      currentPlant = frame.stanceFoot;
      anchor = plantXz;
      liftedSinceAnchor = false;
    }
    if (anchor !== null) maxSlide = Math.max(maxSlide, dist2d(anchor, plantXz));
  }
  return Number.isFinite(maxSlide) ? maxSlide : null;
}

/** Max single-frame stance-labelled toe step inside the phase allow-list. */
function stanceStepMax(
  frames: readonly TurnQualityFrame[],
  phases: ReadonlySet<string>,
): number | null {
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (previous === undefined || current === undefined) continue;
    if (!phases.has(previous.phase) || !phases.has(current.phase)) continue;
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
      max = Math.max(max, dist2d(a, b));
    }
  }
  return Number.isFinite(max) ? max : null;
}

function wrapPi(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

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

export async function decodeArrivalTurnRig(glbPath: string): Promise<DecodedPhysician> {
  const [tracks, census, bones, meshMinY] = await Promise.all([
    jointTracks({ glbPath, clipName: WALK_CLIP, joints: CONTACT_JOINTS }),
    censusSkinnedGeometry(glbPath),
    boneLengthSeries({ glbPath, clipName: WALK_CLIP, bones: SHIPPED_PHYSICIAN_LEG_BONES }),
    lowestSkinnedVertexY(glbPath),
  ]);
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
    stop: null,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
  };
  const rigFilter = flagValue("--rig", "");
  const outPath = flagValue("--out", ".openclinxr/evidence/arrival-turn/control.json");
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    commit = "unknown";
  }

  const WALK = new Set(["walking"]);
  const SETTLING = new Set(["settling"]);
  const HOLD = new Set(["arrived"]);
  const ALL = new Set(["walking", "settling", "arrived", "stopping"]);

  const rows: Array<Record<string, unknown>> = [];
  for (const { rig, glb } of RIGS) {
    if (rigFilter && rig !== rigFilter) continue;
    const decoded = await decodeArrivalTurnRig(glb);
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
    const routeLengthM = Math.hypot(
      intent.target.position.x - intent.start.x,
      intent.target.position.z - intent.start.z,
    );
    const requiredTurnDeg =
      (Math.abs(wrapPi(intent.target.headingRadians - run.travelHeadingRadians)) * 180) / Math.PI;
    rows.push({
      candidate: "A",
      rig,
      glb,
      commit,
      routeLengthM,
      travelHeadingDeg: (run.travelHeadingRadians * 180) / Math.PI,
      targetHeadingDeg: (intent.target.headingRadians * 180) / Math.PI,
      requiredTurnDeg,
      residualTurnDeg: quality.residualTurnDeg,
      settlingSlideM: quality.plantedSlideM,
      wholeApproachSlideM: episodeMaxSlide(frames, ALL),
      slideByPhase: {
        walk: episodeMaxSlide(frames, WALK),
        settling: episodeMaxSlide(frames, SETTLING),
        hold: episodeMaxSlide(frames, HOLD),
      },
      stepMaxByPhase: {
        walk: stanceStepMax(frames, WALK),
        settling: stanceStepMax(frames, SETTLING),
        hold: stanceStepMax(frames, HOLD),
      },
      maxToeStepPerFrameM: quality.maxToeStepPerFrameM,
      stanceToeStepPerFrameM: quality.stanceToeStepPerFrameM,
      sc05ArrivalErrM: run.arrivalErrorMeters,
      settledYawErrDeg: run.settledYawErrorDegrees,
      sweptViolations: intent.sweptViolations.length,
      phases: run.phases,
      walkFrames: run.walkFrameCount,
      settleFrames: run.settleFrameCount,
    });
    const row = rows[rows.length - 1]!;
    process.stdout.write(
      `A/${rig}: residual=${(row["residualTurnDeg"] as number | null)?.toFixed(2)}deg `
        + `settlingSlide=${(row["settlingSlideM"] as number | null)?.toFixed(4)}m `
        + `whole=${(row["wholeApproachSlideM"] as number | null)?.toFixed(4)}m `
        + `arrival=${(row["sc05ArrivalErrM"] as number)?.toFixed(4)}m `
        + `yawErr=${(row["settledYawErrDeg"] as number)?.toFixed(2)}deg `
        + `phases=${(row["phases"] as string[]).join(",")}\n`,
    );
  }
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify({ candidate: "A", commit, measuredAt: new Date().toISOString(), rows }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${outPath}\n`);
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("arrival-turn-cagematch.ts");

if (invokedAsScript) {
  await main();
}
