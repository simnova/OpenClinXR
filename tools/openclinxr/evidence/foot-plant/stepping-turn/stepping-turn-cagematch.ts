import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ARRIVAL_TURN_RIGS,
  decodeArrivalTurnRig,
  episodeMaxSlide,
} from "../arrival-turn-cagematch.js";
import {
  intentFor,
  runApproach,
  stageWard,
} from "../../scene-closure/proofs/sc-05/runtime-approach-measurement.js";
import {
  computeTurnQuality,
  type TurnQualityFrame,
} from "../turn-quality-metrics.js";

/**
 * Lane C cagematch, second bout: procedural stepping turn at arrival (2026-10-11).
 *
 * Candidate A (CONTROL): flag off — must reproduce the arrival-turn assay's control rows
 * bit-identically (same runApproach config, same metrics).
 * Candidate S (STEPPING): flag on — the settling phase runs the lift-and-place plan
 * (stepping-turn-plan/execution-mod.ts) instead of the clip-driven turn.
 *
 * Bars (per rig, stepping vs control):
 *  turn-phase stance slide (plantedSlideM) <= 0.02 (HOLD_SLIDE_MAX_METERS);
 *  whole-approach slide <= control - 0.03;
 *  final residual yaw (settledYawErrorDegrees) <= 2 deg;
 *  max toe step per frame <= control + 0.02;
 *  turn duration (settleSeconds) in 1.0-2.0 s;
 *  every swing episode lifts >= 0.02 m above the settling stance baseline.
 *
 * D9: fixed SIM_SECONDS, deterministic clip playback, no randomness.
 * D1: reuses runApproach / computeTurnQuality / arrival-harness decoders and slide ports.
 * D3/D4: headless assay, one rig first (--rig physician gates; nurse/child run once).
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/stepping-turn/stepping-turn-cagematch.ts \
 *   [--rig physician|nurse|child] [--out .openclinxr/evidence/stepping-turn/cagematch.json]
 */

const SIM_SECONDS = 12;

function wrapPi(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    const value = args[index + 1];
    return index >= 0 ? (value ?? fallback) : fallback;
  };
  const rigFilter = flagValue("--rig", "");
  const outPath = flagValue("--out", ".openclinxr/evidence/stepping-turn/cagematch.json");
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    commit = "unknown";
  }

  const SETTLING = new Set(["settling"]);
  const ALL = new Set(["walking", "settling", "arrived", "stopping"]);

  const rows: Array<Record<string, unknown>> = [];
  for (const { rig, glb } of ARRIVAL_TURN_RIGS) {
    if (rigFilter && rig !== rigFilter) continue;
    const decoded = await decodeArrivalTurnRig(glb);
    for (const candidate of ["A", "S"] as const) {
      const stepping = candidate === "S";
      const ward = stageWard();
      const intent = intentFor(ward);
      if (intent.refused) throw new Error(`approach refused: ${intent.reason}`);
      const run = runApproach({ ward, intent, seconds: SIM_SECONDS, decoded, steppingTurnEnabled: stepping });
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
      // Relative swing lift: per-episode max swing-toe Y above the settling stance baseline
      // (min stance-toe Y over settling), so a foot that merely rides high never passes.
      const settlingFrames = frames.filter((f) => f.phase === "settling");
      let stanceFloorY = Number.POSITIVE_INFINITY;
      for (const f of settlingFrames) {
        if (f.stanceFoot !== "left" && f.stanceFoot !== "right") continue;
        const toe = f.stanceFoot === "left" ? f.left : f.right;
        if (toe) stanceFloorY = Math.min(stanceFloorY, toe.y);
      }
      if (!Number.isFinite(stanceFloorY)) stanceFloorY = 0;
      const episodeLifts: number[] = (quality.stepLiftsM ?? []).map((s) => s.maxLiftMeters - stanceFloorY);
      const minEpisodeLiftM = episodeLifts.length > 0 ? Math.min(...episodeLifts) : null;
      const row = {
        candidate,
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
        settlingSlideByPhase: episodeMaxSlide(frames, SETTLING),
        maxToeStepPerFrameM: quality.maxToeStepPerFrameM,
        stanceToeStepPerFrameM: quality.stanceToeStepPerFrameM,
        settleSeconds: quality.settleSeconds,
        minEpisodeLiftM,
        episodeCount: episodeLifts.length,
        sc05ArrivalErrM: run.arrivalErrorMeters,
        settledYawErrDeg: run.settledYawErrorDegrees,
        phases: run.phases,
        walkFrames: run.walkFrameCount,
        settleFrames: run.settleFrameCount,
      };
      rows.push(row);
      process.stdout.write(
        `${candidate}/${rig}: residual=${typeof row.residualTurnDeg === "number" ? row.residualTurnDeg.toFixed(2) : "?"}deg `
          + `settlingSlide=${typeof row.settlingSlideM === "number" ? row.settlingSlideM.toFixed(4) : "?"}m `
          + `whole=${typeof row.wholeApproachSlideM === "number" ? row.wholeApproachSlideM.toFixed(4) : "?"}m `
          + `maxStep=${typeof row.maxToeStepPerFrameM === "number" ? row.maxToeStepPerFrameM.toFixed(4) : "?"}m `
          + `settle=${typeof row.settleSeconds === "number" ? row.settleSeconds.toFixed(2) : "?"}s `
          + `lift=${typeof row.minEpisodeLiftM === "number" ? row.minEpisodeLiftM.toFixed(4) : "?"}m(${row.episodeCount}ep) `
          + `arrival=${row.sc05ArrivalErrM.toFixed(4)}m yawErr=${row.settledYawErrDeg.toFixed(2)}deg `
          + `phases=${row.phases.join(",")}\n`,
      );
    }
  }
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify({ candidate: "A+S", commit, measuredAt: new Date().toISOString(), rows }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${outPath}\n`);
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("stepping-turn-cagematch.ts");

if (invokedAsScript) {
  await main();
}
