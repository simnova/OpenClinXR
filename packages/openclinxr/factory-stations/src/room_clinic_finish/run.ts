import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../repo-root.js";
import type { StandardFailureResult, StandardResult } from "../catalog-mod.js";

/** Local plan result: station is new, catalog registration is out of scope. */
export type RoomClinicFinishPlanResult =
  | StandardFailureResult
  | { readonly value: Record<string, unknown>; readonly plan: Record<string, unknown> & { mode: "dry-run"; stationId: "room_clinic_finish" }; readonly issues?: undefined };

export type RoomClinicFinishRunner = {
  stationId: "room_clinic_finish";
  validate: (value: unknown) => StandardResult;
  plan: (value: unknown) => RoomClinicFinishPlanResult;
  run: (value: unknown) => Promise<Record<string, unknown>> | Record<string, unknown>;
};
import { spawnBlenderProcess } from "../spawn-blender.js";
import { designRoomFinishRecipe } from "./recipe.js";

/**
 * room_clinic_finish: deterministic finish pass over the baked clinic room.
 *
 * plan() is pure (recipe + script paths, no Blender). run() writes the
 * recipe JSON, then spawns compose.py once against the work GLB. The compose
 * stage paints wall/trim materials from the recipe palette and stamps
 * signage anchors as empties; it never moves geometry.
 *
 * Tests must call plan(), not run().
 */

export const ROOM_CLINIC_FINISH_STAGE_REL =
  "packages/openclinxr/factory-stations/src/room_clinic_finish/compose.py";

export const ROOM_CLINIC_FINISH_BAKER_ID = "room_clinic_finish";

export type RoomClinicFinishPlanInput = {
  environmentId: string;
  preset: string;
  seed: number;
  modules?: string[];
};

const CLINIC_FINISH_MODULE_FILES = ["ceiling", "floor", "door", "corridor_cues"] as const;

export function planRoomClinicFinish(input: unknown): RoomClinicFinishPlanResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { issues: [{ message: "expected object" }] };
  }
  const value = input as Record<string, unknown>;
  const required = ["environmentId", "preset", "seed"] as const;
  const missing = required.filter((key) => !(key in value) || value[key] === undefined);
  if (missing.length > 0) {
    return { issues: missing.map((key) => ({ message: `missing ${key}` })) };
  }
  let recipe: ReturnType<typeof designRoomFinishRecipe>;
  try {
    recipe = designRoomFinishRecipe(value as unknown as RoomClinicFinishPlanInput);
  } catch (error) {
    return { issues: [{ message: error instanceof Error ? error.message : String(error) }] };
  }
  const root = repoRoot();
  const requested = Array.isArray((value as Record<string, unknown>)["modules"])
    ? ((value as Record<string, unknown>)["modules"] as unknown[])
    : [...CLINIC_FINISH_MODULE_FILES];
  const modules = requested.filter(
    (entry): entry is (typeof CLINIC_FINISH_MODULE_FILES)[number] =>
      typeof entry === "string" &&
      (CLINIC_FINISH_MODULE_FILES as readonly string[]).includes(entry),
  );
  if (modules.length === 0) {
    return { issues: [{ message: "modules must name at least one of ceiling, floor, door, corridor_cues" }] };
  }
  return {
    value,
    plan: {
      mode: "dry-run",
      stationId: "room_clinic_finish",
      environmentId: recipe.environmentId,
      preset: recipe.preset,
      seed: recipe.seed,
      wallAlbedo: recipe.palette.wallAlbedo,
      trimAlbedo: recipe.palette.trimAlbedo,
      signageAnchors: recipe.palette.signageAnchors,
      recipe,
      modules,
      moduleScripts: modules.map((entry) =>
        path.join(root, `packages/openclinxr/factory-stations/src/room_clinic_finish/${entry}.py`),
      ),
      bakerId: ROOM_CLINIC_FINISH_BAKER_ID,
      stageId: "clinic_finish_compose",
      stageScript: path.join(root, ROOM_CLINIC_FINISH_STAGE_REL),
      stageScriptRel: ROOM_CLINIC_FINISH_STAGE_REL,
      processIsolation: "fresh_subprocess",
    },
  };
}

export type RoomClinicFinishRunOptions = {
  blender: string;
  workGlb: string;
  recipeJsonOut: string;
  report: string;
  extraStageFlags?: string[];
  cwd?: string;
  timeoutMs?: number;
};

/** Unique spawn of compose.py. Tests must call plan(), not run(). */
export async function runRoomClinicFinish(
  input: unknown,
  options: RoomClinicFinishRunOptions,
): Promise<Record<string, unknown>> {
  const planned = planRoomClinicFinish(input);
  if (planned.issues !== undefined) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const stageScript = String(planned.plan["stageScript"]);
  if (!existsSync(stageScript)) {
    throw new Error(`clinic finish stage script missing: ${stageScript}`);
  }
  const recipe = designRoomFinishRecipe(planned.value as unknown as RoomClinicFinishPlanInput);
  writeFileSync(options.recipeJsonOut, `${JSON.stringify(recipe, null, 2)}\n`, "utf8");
  const blenderArgs = [
    "--background",
    "--python",
    stageScript,
    "--",
    "--input",
    options.workGlb,
    "--output",
    options.workGlb,
    "--recipe-json",
    options.recipeJsonOut,
    "--report",
    options.report,
    ...(options.extraStageFlags ?? []),
  ];
  const result = await spawnBlenderProcess(options.blender, blenderArgs, {
    cwd: options.cwd ?? repoRoot(),
    timeoutMs: options.timeoutMs ?? 600_000,
  });
  return {
    stationId: "room_clinic_finish",
    stageScript,
    recipePath: options.recipeJsonOut,
    report: options.report,
    blenderExit: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function validateRoomClinicFinish(value: unknown): RoomClinicFinishPlanResult {
  return planRoomClinicFinish(value);
}

export const roomClinicFinishRunner: RoomClinicFinishRunner = {
  stationId: "room_clinic_finish",
  validate: (value: unknown) => {
    const planned = planRoomClinicFinish(value);
    if (planned.issues !== undefined) return { issues: planned.issues };
    return { value: planned.value as Record<string, unknown> };
  },
  plan: planRoomClinicFinish,
  run: (value: unknown) => runRoomClinicFinish(value, { blender: "blender", workGlb: "", recipeJsonOut: "", report: "" }),
};
