import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  findStanceChain,
  findSteppingLegChain,
  solveSteppingLegHinge,
  solveTwoBoneIK,
  worldXyz,
} from "@openclinxr/xr-humanoid-animation/stepping-turn";
import { Vector3 } from "three";
import {
  intentFor,
  runApproach,
  stageWard,
} from "../../scene-closure/proofs/sc-05/runtime-approach-measurement.js";
import {
  ARRIVAL_TURN_RIGS,
  decodeArrivalTurnRig,
  episodeMaxSlide,
} from "../arrival-turn-cagematch.js";
import {
  buildMirrorAtClipTime,
  readMirrorSource,
} from "../stepping-turn/ik-noop-probe.js";
import {
  computeTurnQuality,
  type TurnQualityFrame,
} from "../turn-quality-metrics.js";

/**
 * CCD stance-lock cagematch (2026-10-11): does the hinge four-joint stance leg fix walk slide?
 *
 * Candidate A (CONTROL): flag off — shipped two-bone stance leg; must reproduce the
 * arrival-turn assay's control rows bit-identically.
 * Candidate C (CCD): flag on — `ccdStanceLockEnabled`, the stance leg solves through the
 * reused hinge four-joint solver (`stance-lock-leg-ik-mod.ts`).
 *
 * Two instruments, because the SC-05 assay rigs carry marker toes, not leg bones:
 *  Part A (assay): runApproach off vs on per rig — walk-phase slide, whole-approach slide,
 *    maxToeStepPerFrameM, arrival error. The lock takes its no-chain fallback in both, so
 *    any delta here is real walk-phase movement, not solver math.
 *  Part B (mirror probe): shipped GLB bytes under the walk clip, no-op heel target, both
 *    solvers with the production application — the stance lock's own heel-target miss per
 *    rig (median/max over 5 clip times x 2 sides). Same calls the flag-on production path
 *    makes (hinge, slot-yaw pole, mids at clip pose); two-bone replicates the shipped
 *    application exactly as `ik-noop-probe.ts` does.
 *
 * Bars (per rig, on vs off): walk-phase slide reduced by >= 0.03 m; heel-miss median < 0.01 m;
 * maxToeStepPerFrameM <= off + 0.02; arrival <= off + 0.01. Physician with no slide reduction
 * refutes the hypothesis.
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/ccd-stance-lock/ccd-stance-lock-cagematch.ts \
 *   [--rig physician|nurse|child] [--out .openclinxr/evidence/ccd-lock/report.json]
 */

const SIM_SECONDS = 12;
const WALK_CLIP = "openclinxr_retarget_walk_source";
const SLOT_SCALE = 0.86;
const SOFTENING = 0.005;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lo = sorted[mid - 1] ?? sorted[mid] ?? 0;
  const hi = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? hi : (lo + hi) / 2;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    const value = args[index + 1];
    return index >= 0 ? (value ?? fallback) : fallback;
  };
  const rigFilter = flagValue("--rig", "");
  const outPath = flagValue("--out", ".openclinxr/evidence/ccd-lock/report.json");
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    commit = "unknown";
  }

  const WALK = new Set(["walking"]);
  const ALL = new Set(["walking", "settling", "arrived", "stopping"]);

  const rows: Array<Record<string, unknown>> = [];
  const heelMiss: Record<string, { off: unknown; on: unknown }> = {};
  for (const { rig, glb } of ARRIVAL_TURN_RIGS) {
    if (rigFilter && rig !== rigFilter) continue;
    const decoded = await decodeArrivalTurnRig(glb);

    // Part A: SC-05 assay, flag off vs on.
    for (const candidate of ["A", "C"] as const) {
      const ward = stageWard();
      const intent = intentFor(ward);
      if (intent.refused) throw new Error(`approach refused: ${intent.reason}`);
      const run = runApproach({
        ward,
        intent,
        seconds: SIM_SECONDS,
        decoded,
        ccdStanceLockEnabled: candidate === "C",
      });
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
      const row = {
        candidate,
        rig,
        walkSlideM: episodeMaxSlide(frames, WALK),
        wholeApproachSlideM: episodeMaxSlide(frames, ALL),
        maxToeStepPerFrameM: quality.maxToeStepPerFrameM,
        sc05ArrivalErrM: run.arrivalErrorMeters,
        settledYawErrDeg: run.settledYawErrorDegrees,
        walkFrames: run.walkFrameCount,
        settleFrames: run.settleFrameCount,
      };
      rows.push(row);
      process.stdout.write(
        `${candidate}/${rig}: walkSlide=${row.walkSlideM?.toFixed(4) ?? "?"}m `
          + `whole=${row.wholeApproachSlideM?.toFixed(4) ?? "?"}m `
          + `maxStep=${row.maxToeStepPerFrameM?.toFixed(4) ?? "?"}m `
          + `arrival=${row.sc05ArrivalErrM.toFixed(4)}m\n`,
      );
    }

    // Part B: mirror probe — both solvers on shipped bytes, no-op heel target.
    const { source } = await readMirrorSource(glb, WALK_CLIP);
    const offMisses: number[] = [];
    const onMisses: number[] = [];
    for (const f of [0, 0.2, 0.4, 0.6, 0.8]) {
      const t = source.tMin + f * (source.tMax - source.tMin);
      const { slot } = buildMirrorAtClipTime(source, WALK_CLIP, t, SLOT_SCALE);
      for (const side of ["left", "right"] as const) {
        const chain = findStanceChain(slot, side);
        const stepping = findSteppingLegChain(slot, side);
        if (!chain || !stepping) throw new Error(`no chain for ${side} in ${glb}`);
        const saved = [chain.hip, stepping.upperMid, chain.knee, stepping.lowerMid, chain.heel, chain.toe].map(
          (o) => o.quaternion.clone(),
        );
        const restore = (): void => {
          const posed = [chain.hip, stepping.upperMid, chain.knee, stepping.lowerMid, chain.heel, chain.toe];
          for (let i = 0; i < posed.length; i += 1) {
            const bone = posed[i];
            const savedQuat = saved[i];
            if (bone && savedQuat) bone.quaternion.copy(savedQuat);
          }
          slot.updateMatrixWorld(true);
        };
        const heel0 = worldXyz(chain.heel);
        // OFF: shipped two-bone solve + application.
        restore();
        const two = solveTwoBoneIK(chain.hip, chain.knee, chain.heel, heel0, 0, SOFTENING, slot);
        if (two) {
          chain.hip.quaternion.multiplyQuaternions(chain.hip.quaternion, two.hipDelta);
          chain.knee.quaternion.copy(two.kneeQuat);
          slot.updateMatrixWorld(true);
        }
        slot.updateMatrixWorld(true);
        offMisses.push(
          new Vector3()
            .setFromMatrixPosition(chain.heel.matrixWorld)
            .distanceTo(new Vector3(heel0.x, heel0.y, heel0.z)),
        );
        // ON: production flag-on call sequence (hinge, slot-yaw pole, mids at clip pose).
        restore();
        const yaw = slot.rotation.y;
        const hinged = solveSteppingLegHinge({
          chain: stepping,
          heelTargetWorld: heel0,
          poleWorld: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) },
          midRestQuats: null,
        });
        slot.updateMatrixWorld(true);
        onMisses.push(hinged.missM);
      }
    }
    heelMiss[rig] = {
      off: { medianM: median(offMisses), maxM: Math.max(...offMisses), n: offMisses.length },
      on: { medianM: median(onMisses), maxM: Math.max(...onMisses), n: onMisses.length },
    };
    const hm = heelMiss[rig] as { off: { medianM: number | null; maxM: number }; on: { medianM: number | null; maxM: number } };
    process.stdout.write(
      `miss/${rig}: off median=${hm.off.medianM?.toFixed(4) ?? "?"} max=${hm.off.maxM.toFixed(4)} | `
        + `on median=${hm.on.medianM?.toFixed(4) ?? "?"} max=${hm.on.maxM.toFixed(4)}\n`,
    );
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify({ candidate: "A+C", commit, measuredAt: new Date().toISOString(), rows, heelMiss }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${outPath}\n`);
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("ccd-stance-lock-cagematch.ts");

if (invokedAsScript) {
  await main();
}
