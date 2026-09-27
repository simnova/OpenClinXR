import { existsSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";
import { spawnBlenderProcess } from "../spawn-blender.js";
import { runInfinigenGenerate, type InfinigenGenerateReport } from "./generate.js";
import { simplifyRoomAfterBake, type RoomSimplifyReport } from "./simplify.js";

export const ROOM_ALBEDO_REL =
  "packages/openclinxr/factory-stations/src/room_generate/room-albedo-ao-bake.py";
export const ROOM_OCCLUSION_REL =
  "packages/openclinxr/factory-stations/src/room_generate/room-occlusion-bake.py";

export function planRoomGenerate(input: unknown): StationPlanResult {
  const root = repoRoot();
  const planned = planFromCatalog("room_generate", input, (value) => ({
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
  if (planned.issues !== undefined) return planned;
  // Nested validation for the opt-in GENERATE payload. The catalog "object"
  // type only checks "is an object"; the internal shape is enforced here so
  // a bad doorWall fails at plan time, not deep in generation.
  const nested = validateRoomGenerateOptions(planned.value);
  if (nested.length > 0) return { issues: nested };
  const plan: Record<string, unknown> = { ...planned.plan };
  if ("footprintMeters" in planned.value) plan["footprintMeters"] = planned.value["footprintMeters"];
  if ("door" in planned.value) plan["door"] = planned.value["door"];
  return { value: planned.value, plan: { mode: "dry-run", stationId: "room_generate", ...plan } };
}

/** Closed door-wall enum for the fixed-footprint generate step. */
export const ROOM_GENERATE_DOOR_WALLS = ["+x", "-x", "+y", "-y"] as const;

export type RoomGenerateDoorWall = (typeof ROOM_GENERATE_DOOR_WALLS)[number];

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Internal-shape validation for footprintMeters + door. Returns issues;
 * empty means the legacy shape (both absent) or a valid opt-in payload.
 */
export function validateRoomGenerateOptions(value: Record<string, unknown>): { message: string; path?: readonly (string | number)[] }[] {
  const issues: { message: string; path?: readonly (string | number)[] }[] = [];
  if ("footprintMeters" in value && value["footprintMeters"] !== undefined) {
    const fp = value["footprintMeters"] as Record<string, unknown>;
    for (const dim of ["width", "depth", "ceilingHeight"] as const) {
      if (!isPositiveNumber(fp[dim])) {
        issues.push({ message: `footprintMeters.${dim} expected positive number`, path: ["footprintMeters", dim] });
      }
    }
  }
  if ("door" in value && value["door"] !== undefined) {
    const door = value["door"] as Record<string, unknown>;
    const wall = door["doorWall"];
    if (typeof wall !== "string" || !(ROOM_GENERATE_DOOR_WALLS as readonly string[]).includes(wall)) {
      issues.push({
        message: `door.doorWall must be one of "+x", "-x", "+y", "-y" (got ${JSON.stringify(wall) ?? "missing"})`,
        path: ["door", "doorWall"],
      });
    }
    if ("wallOffsetM" in door && door["wallOffsetM"] !== undefined) {
      if (typeof door["wallOffsetM"] !== "number" || !Number.isFinite(door["wallOffsetM"])) {
        issues.push({ message: "door.wallOffsetM expected number", path: ["door", "wallOffsetM"] });
      }
    }
    if ("hingeSide" in door && door["hingeSide"] !== undefined) {
      if (typeof door["hingeSide"] !== "string" || !(ROOM_GENERATE_DOOR_WALLS as readonly string[]).includes(door["hingeSide"])) {
        issues.push({ message: `door.hingeSide must be one of "+x", "-x", "+y", "-y"`, path: ["door", "hingeSide"] });
      }
    }
    for (const dim of ["widthM", "heightM"] as const) {
      if (dim in door && door[dim] !== undefined && !isPositiveNumber(door[dim])) {
        issues.push({ message: `door.${dim} expected positive number`, path: ["door", dim] });
      }
    }
  }
  return issues;
}

export type RoomGenerateRunOptions = {
  blender: string;
  workGlb: string;
  bakeAlbedo: boolean;
  bakeOcclusion?: boolean;
  albedoExtraArgs?: string[];
  occlusionExtraArgs?: string[];
  /** Post-bake trim-locked simplify; defaults on. UV bake needs the full mesh first. */
  simplifyAfterBake?: boolean;
  cwd?: string;
  timeoutMs?: number;
  /** Per-spawn budget for the opt-in Infinigen GENERATE step. */
  generateTimeoutMs?: number;
  infinigenSource?: string;
  venvPython?: string;
};

/** Unique spawn of room albedo/occlusion bake scripts. Tests must call plan(), not run(). */
export async function runRoomGenerate(input: unknown, options: RoomGenerateRunOptions): Promise<Record<string, unknown>> {
  const planned = planRoomGenerate(input);
  if (planned.issues !== undefined) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const seed = Number(planned.value["seed"]);
  const environmentId = String(planned.value["environmentId"]);
  // Opt-in GENERATE step: only when footprintMeters is present. Legacy call
  // shape (absent) keeps existing behavior -- workGlb already exists.
  let generate: InfinigenGenerateReport | null = null;
  if ("footprintMeters" in planned.value && planned.value["footprintMeters"] !== undefined) {
    const footprint = planned.value["footprintMeters"] as {
      width: number;
      depth: number;
      ceilingHeight: number;
    };
    const door = ("door" in planned.value && planned.value["door"] !== undefined
      ? (planned.value["door"] as Record<string, unknown>)
      : undefined) as
      | { doorWall?: string; wallOffsetM?: number; hingeSide?: string; widthM?: number; heightM?: number }
      | undefined;
    generate = await runInfinigenGenerate(
      {
        environmentId,
        footprintMeters: { ...footprint },
        ...(door === undefined ? {} : { door }),
        seed,
      },
      {
        blender: options.blender,
        workGlb: options.workGlb,
        cwd: options.cwd,
        timeoutMs: options.generateTimeoutMs,
        infinigenSource: options.infinigenSource,
        venvPython: options.venvPython,
      },
    );
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
  let simplify: RoomSimplifyReport | null = null;
  if (options.simplifyAfterBake !== false && options.workGlb !== "") {
    simplify = await simplifyRoomAfterBake(options.workGlb);
  }
  return {
    stationId: "room_generate",
    seed,
    environmentId,
    albedoExit,
    blenderExit: occlusionExit ?? albedoExit,
    stdout,
    stderr,
    simplify,
    generate,
  };
}

export const roomGenerateRunner: StationRunner = {
  stationId: "room_generate",
  validate: (value) => factoryStationSchemas.room_generate["~standard"].validate(value),
  plan: planRoomGenerate,
  run: (value) => runRoomGenerate(value, { blender: "blender", workGlb: "", bakeAlbedo: false }),
};
