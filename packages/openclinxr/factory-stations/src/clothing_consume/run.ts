import { existsSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";
import { spawnBlenderProcess } from "../spawn-blender.js";

export const CLOTHING_CONSUME_STAGE_REL =
  "packages/openclinxr/factory-stations/src/clothing_consume/fit_stage.py";

export function planClothingConsume(input: unknown): StationPlanResult {
  return planFromCatalog("clothing_consume", input, (value) => ({
    actorId: value["actorId"],
    mhcloPath: value["mhcloPath"],
    bakerId: "makeclothes_fit_stage",
    stageId: "makeclothes_fit_stage",
    stageScript: path.join(repoRoot(), CLOTHING_CONSUME_STAGE_REL),
    stageScriptRel: CLOTHING_CONSUME_STAGE_REL,
    processIsolation: "fresh_subprocess",
  }));
}

export type ClothingConsumeRunOptions = {
  blender: string;
  garmentObj: string;
  mhBaseObj: string;
  outGlb: string;
  outGradePng: string;
  report: string;
  garmentMeshName: string;
  annyObj?: string;
  extraStageFlags?: string[];
  cwd?: string;
  timeoutMs?: number;
};

/**
 * Unique spawn of fit_stage.py. Tests must call plan(), not run().
 */
export async function runClothingConsume(
  input: unknown,
  options: ClothingConsumeRunOptions,
): Promise<Record<string, unknown>> {
  const planned = planClothingConsume(input);
  if ("issues" in planned) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const stageScript = String(planned.plan["stageScript"]);
  if (!existsSync(stageScript)) {
    throw new Error(`fit stage script missing: ${stageScript}`);
  }
  const mhcloPath = String(planned.plan["mhcloPath"]);
  const blenderArgs = [
    "--background",
    "--python",
    stageScript,
    "--",
    "--mhclo",
    mhcloPath,
    "--garment-obj",
    options.garmentObj,
    "--mh-base-obj",
    options.mhBaseObj,
    "--out-glb",
    options.outGlb,
    "--out-grade-png",
    options.outGradePng,
    "--report",
    options.report,
    ...(options.extraStageFlags ?? []),
    "--garment-mesh-name",
    options.garmentMeshName,
  ];
  if (options.annyObj) blenderArgs.push("--anny-obj", options.annyObj);

  const result = await spawnBlenderProcess(options.blender, blenderArgs, {
    cwd: options.cwd ?? repoRoot(),
    timeoutMs: options.timeoutMs ?? 600_000,
  });
  return {
    stationId: "clothing_consume",
    stageScript,
    blenderExit: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export const clothingConsumeRunner: StationRunner = {
  stationId: "clothing_consume",
  validate: (value) => factoryStationSchemas.clothing_consume["~standard"].validate(value),
  plan: planClothingConsume,
  run: (value) => runClothingConsume(value, {
    blender: "blender",
    garmentObj: "",
    mhBaseObj: "",
    outGlb: "",
    outGradePng: "",
    report: "",
    garmentMeshName: "",
  }),
};
