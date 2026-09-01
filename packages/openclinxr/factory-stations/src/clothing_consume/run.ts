import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

export const CLOTHING_CONSUME_STAGE_REL = "tools/openclinxr/asset-pipeline/makeclothes/fit_stage.py";

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

function spawnBlenderFitStage(
  blender: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(blender, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer =
      opts.timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
          }, opts.timeoutMs)
        : null;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}\n${String(err)}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

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

  const result = await spawnBlenderFitStage(options.blender, blenderArgs, {
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
