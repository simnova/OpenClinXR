import { existsSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";
import { spawnBlenderProcess } from "../spawn-blender.js";

export const ROOM_ALBEDO_REL =
  "packages/openclinxr/factory-stations/src/room_generate/room-albedo-ao-bake.py";
export const ROOM_OCCLUSION_REL =
  "packages/openclinxr/factory-stations/src/room_generate/room-occlusion-bake.py";

export function planRoomGenerate(input: unknown): StationPlanResult {
  const root = repoRoot();
  return planFromCatalog("room_generate", input, (value) => ({
    environmentId: value["environmentId"],
    infinigenPrompt: value["infinigenPrompt"],
    seed: value["seed"],
    layoutVariant: value["layoutVariant"],
    bakerId: "room_environment",
    albedoScriptRel: ROOM_ALBEDO_REL,
    occlusionScriptRel: ROOM_OCCLUSION_REL,
    albedoScript: path.join(root, ROOM_ALBEDO_REL),
    occlusionScript: path.join(root, ROOM_OCCLUSION_REL),
    processIsolation: "fresh_subprocess",
  }));
}

export type RoomGenerateRunOptions = {
  blender: string;
  workGlb: string;
  bakeAlbedo: boolean;
  bakeOcclusion?: boolean;
  albedoExtraArgs?: string[];
  occlusionExtraArgs?: string[];
  cwd?: string;
  timeoutMs?: number;
};

/** Unique spawn of room albedo/occlusion bake scripts. Tests must call plan(), not run(). */
export async function runRoomGenerate(input: unknown, options: RoomGenerateRunOptions): Promise<Record<string, unknown>> {
  const planned = planRoomGenerate(input);
  if ("issues" in planned) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const albedoScript = String(planned.plan["albedoScript"]);
  const occlusionScript = String(planned.plan["occlusionScript"]);
  const cwd = options.cwd ?? repoRoot();
  const timeoutMs = options.timeoutMs ?? 600_000;
  const bakeOcclusion = options.bakeOcclusion !== false;
  let albedoExit: number | null = null;
  let occlusionExit: number | null = null;
  let stdout = "";
  let stderr = "";
  if (options.bakeAlbedo) {
    if (!existsSync(albedoScript)) throw new Error(`room albedo script missing: ${albedoScript}`);
    const albedoArgs = options.albedoExtraArgs ?? [
      "--input",
      options.workGlb,
      "--output",
      options.workGlb,
      "--resolution",
      "1024",
    ];
    const albedo = await spawnBlenderProcess(
      options.blender,
      ["--background", "--python", albedoScript, "--", ...albedoArgs],
      { cwd, timeoutMs },
    );
    albedoExit = albedo.code;
    stdout = albedo.stdout;
    stderr = albedo.stderr;
  }
  if (bakeOcclusion) {
    if (!existsSync(occlusionScript)) {
      throw new Error(`room occlusion script missing: ${occlusionScript}`);
    }
    const occlusionArgs = options.occlusionExtraArgs ?? [
      "--input",
      options.workGlb,
      "--output",
      options.workGlb,
      "--resolution",
      "512",
    ];
    const occlusion = await spawnBlenderProcess(
      options.blender,
      ["--background", "--python", occlusionScript, "--", ...occlusionArgs],
      { cwd, timeoutMs },
    );
    occlusionExit = occlusion.code;
    stdout = occlusion.stdout;
    stderr = occlusion.stderr;
  }
  return {
    stationId: "room_generate",
    albedoExit,
    blenderExit: occlusionExit ?? albedoExit,
    stdout,
    stderr,
  };
}

export const roomGenerateRunner: StationRunner = {
  stationId: "room_generate",
  validate: (value) => factoryStationSchemas.room_generate["~standard"].validate(value),
  plan: planRoomGenerate,
  run: (value) => runRoomGenerate(value, { blender: "blender", workGlb: "", bakeAlbedo: false }),
};
