import { existsSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";
import { spawnBlenderProcess } from "../spawn-blender.js";
import { gateWalkClip, MPFB_WALK_JOINTS } from "./walk_symmetry_gate.js";
import type { WalkGateJoints, WalkGateReport } from "./walk_symmetry_gate.js";

export const MOTION_RETARGET_STAGE_REL =
  "packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_stage.py";

export function planMotionRetarget(input: unknown): StationPlanResult {
  return planFromCatalog("motion_retarget", input, (value) => ({
    actorId: value["actorId"],
    clipId: value["clipId"],
    bakerId: "motion_bind_stage",
    stageId: "motion_bind_stage",
    stageScript: path.join(repoRoot(), MOTION_RETARGET_STAGE_REL),
    stageScriptRel: MOTION_RETARGET_STAGE_REL,
    adapter: "@openclinxr/motion-compiler",
    processIsolation: "fresh_subprocess",
  }));
}

export type MotionRetargetRunOptions = {
  blender: string;
  extraArgs: string[];
  cwd?: string;
  timeoutMs?: number;
  /**
   * Optional post-bind symmetry gate (walk clips only). When set and the bind exits 0,
   * the station samples the bound output GLB and attaches the gate report. Absent by
   * default: existing callers see byte-identical behavior. A gate sampling failure is
   * recorded, never thrown.
   */
  symmetryGate?: MotionRetargetSymmetryGate;
};

export type MotionRetargetSymmetryGate = {
  outputGlb: string;
  clipName: string;
  joints?: WalkGateJoints;
};

/** Unique spawn of motion_bind_stage.py. Tests must call plan(), not run(). */
export async function runMotionRetarget(input: unknown, options: MotionRetargetRunOptions): Promise<Record<string, unknown>> {
  const planned = planMotionRetarget(input);
  if (planned.issues !== undefined) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const stageScript = String(planned.plan["stageScript"]);
  if (!existsSync(stageScript)) {
    throw new Error(`motion bind stage script missing: ${stageScript}`);
  }
  const result = await spawnBlenderProcess(
    options.blender,
    ["--background", "--python", stageScript, "--", ...options.extraArgs],
    { cwd: options.cwd ?? repoRoot(), timeoutMs: options.timeoutMs ?? 300_000 },
  );
  const out: Record<string, unknown> = { stationId: "motion_retarget", stageScript, blenderExit: result.code, stdout: result.stdout, stderr: result.stderr };
  if (options.symmetryGate && result.code === 0) {
    try {
      const report: WalkGateReport = await gateWalkClip({
        glbPath: options.symmetryGate.outputGlb,
        clipName: options.symmetryGate.clipName,
        joints: options.symmetryGate.joints ?? MPFB_WALK_JOINTS,
      });
      out["symmetryGate"] = report;
    } catch (err) {
      out["symmetryGateError"] = err instanceof Error ? err.message : String(err);
    }
  }
  return out;
}

export const motionRetargetRunner: StationRunner = {
  stationId: "motion_retarget",
  validate: (value) => factoryStationSchemas.motion_retarget["~standard"].validate(value),
  plan: planMotionRetarget,
  run: (value) => runMotionRetarget(value, { blender: "blender", extraArgs: [] }),
};
