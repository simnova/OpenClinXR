import { existsSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";
import { spawnBlenderProcess } from "../spawn-blender.js";

export const BODY_PARAM_STAGE_REL =
  "packages/openclinxr/factory-stations/src/body_param/body_param_stage.py";

export function planBodyParam(input: unknown): StationPlanResult {
  return planFromCatalog("body_param", input, (value) => ({
    actorId: value["actorId"],
    ageYears: value["ageYears"],
    sex: value["sex"],
    heightCm: value["heightCm"],
    garmentLayers: value["garmentLayers"],
    bakerId: "body_param_stage",
    stageId: "body_param_stage",
    stageScript: path.join(repoRoot(), BODY_PARAM_STAGE_REL),
    stageScriptRel: BODY_PARAM_STAGE_REL,
    processIsolation: "fresh_subprocess",
  }));
}

export type BodyParamRunOptions = {
  blender: string;
  extraArgs: string[];
  cwd?: string;
  timeoutMs?: number;
};

/** Unique spawn of body_param_stage.py. Tests must call plan(), not run(). */
export async function runBodyParam(input: unknown, options: BodyParamRunOptions): Promise<Record<string, unknown>> {
  const planned = planBodyParam(input);
  if ("issues" in planned) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const stageScript = String(planned.plan["stageScript"]);
  if (!existsSync(stageScript)) {
    throw new Error(`body_param stage script missing: ${stageScript}`);
  }
  const result = await spawnBlenderProcess(
    options.blender,
    ["--background", "--python", stageScript, "--", ...options.extraArgs],
    { cwd: options.cwd ?? repoRoot(), timeoutMs: options.timeoutMs ?? 900_000 },
  );
  return { stationId: "body_param", stageScript, blenderExit: result.code, stdout: result.stdout, stderr: result.stderr };
}

export const bodyParamRunner: StationRunner = {
  stationId: "body_param",
  validate: (value) => factoryStationSchemas.body_param["~standard"].validate(value),
  plan: planBodyParam,
  run: (value) => runBodyParam(value, { blender: "blender", extraArgs: [] }),
};
