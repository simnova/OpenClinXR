import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  designRoomFinishRecipe,
  ROOM_CLINIC_FINISH_SCHEMA_VERSION,
  ROOM_FINISH_PRESETS,
} from "./recipe.js";
import { planRoomClinicFinish, ROOM_CLINIC_FINISH_STAGE_REL, runRoomClinicFinish } from "./run.js";

/**
 * OBSERVABLE: room_clinic_finish emits a deterministic recipe (room + preset
 * -> same palette) and cites the compose.py Blender stage.
 *
 * Pure recipe layer + dry-run plan. No Blender in this test.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { environmentId: "ed_exam_bay_v1", preset: "peds_calm", seed: 7, ...overrides };
}

describe("the room clinic finish station composes a deterministic finish", () => {
  it("(1) plan() passes room, preset, palette through and cites compose.py", () => {
    const planned = planRoomClinicFinish(validInput());
    expect(planned.issues !== undefined).toBe(false);
    if (planned.issues !== undefined) return;
    expect(planned.plan["mode"]).toBe("dry-run");
    expect(planned.plan["stationId"]).toBe("room_clinic_finish");
    expect(planned.plan["preset"]).toBe("peds_calm");
    expect(planned.plan["environmentId"]).toBe("ed_exam_bay_v1");
    expect(String(planned.plan["stageScriptRel"])).toBe(ROOM_CLINIC_FINISH_STAGE_REL);
    const recipe = planned.plan["recipe"] as Record<string, unknown>;
    expect(recipe["finishPassLlm"]).toBe(false);
    expect(recipe["schemaVersion"]).toBe(ROOM_CLINIC_FINISH_SCHEMA_VERSION);
    expect(Array.isArray(planned.plan["signageAnchors"])).toBe(true);
  });

  it("(2) same input twice -> identical recipe (no LLM)", () => {
    const recipeA = designRoomFinishRecipe(validInput() as { environmentId: string; preset: string; seed: number });
    const recipeB = designRoomFinishRecipe(validInput() as { environmentId: string; preset: string; seed: number });
    expect(recipeB).toEqual(recipeA);
  });

  it("(3) presets differ in palette and anchors", () => {
    const calm = designRoomFinishRecipe(validInput({ preset: "peds_calm" }) as { environmentId: string; preset: string; seed: number });
    const evening = designRoomFinishRecipe(validInput({ preset: "evening_calm" }) as { environmentId: string; preset: string; seed: number });
    expect(evening.palette.wallAlbedo).not.toEqual(calm.palette.wallAlbedo);
    expect(evening.palette.signageAnchors.length).toBeLessThanOrEqual(calm.palette.signageAnchors.length);
    expect(ROOM_FINISH_PRESETS).toContain("peds_calm");
  });

  it("(4) plan() refuses unknown room, unknown preset, and missing fields", () => {
    const badRoom = planRoomClinicFinish(validInput({ environmentId: "icu_penthouse_v9" }));
    expect(badRoom.issues !== undefined).toBe(true);
    const badPreset = planRoomClinicFinish(validInput({ preset: "midnight_horror" }));
    expect(badPreset.issues !== undefined).toBe(true);
    if (!(badPreset.issues !== undefined)) return;
    expect(badPreset.issues.map((issue) => issue.message).join("; ")).toMatch(/unknown preset/);
    const { preset: _drop, ...noPreset } = validInput();
    expect(planRoomClinicFinish(noPreset).issues !== undefined).toBe(true);
  });

  it("(5) compose.py validates the recipe schema and never moves geometry", () => {
    const composeSrc = readFileSync(join(SRC, "compose.py"), "utf8");
    expect(composeSrc).toContain("--recipe-json");
    expect(composeSrc).toContain("--report");
    expect(composeSrc).toContain("RECIPE_SCHEMA_VERSION");
    expect(composeSrc).toContain(ROOM_CLINIC_FINISH_SCHEMA_VERSION);
    expect(composeSrc).toContain("movedGeometry");
    expect(composeSrc).toContain("openclinxr_signage_");
    const runSrc = readFileSync(join(SRC, "run.ts"), "utf8");
    expect(runSrc).toContain("packages/openclinxr/factory-stations/src/room_clinic_finish/compose.py");
    expect(runSrc).toContain("spawnBlenderProcess");
  });

  it("(6) run() refuses invalid input before spawning Blender", async () => {
    await expect(
      runRoomClinicFinish(validInput({ preset: "nope" }), { blender: "blender", workGlb: "", recipeJsonOut: "", report: "" }),
    ).rejects.toThrow(/unknown preset/);
  });

  it("(7) geometry stage wired: recipe, plan, and compose cover geometry", () => {
    const recipe = designRoomFinishRecipe(validInput() as { environmentId: string; preset: string; seed: number });
    expect(recipe.modules.map((entry) => entry.module)).toContain("geometry");
    expect(recipe.modules.find((entry) => entry.module === "geometry")?.version).toBe("clinic-finish-geometry-v1");
    const planned = planRoomClinicFinish(validInput());
    expect(planned.issues !== undefined).toBe(false);
    if (planned.issues !== undefined) return;
    expect((planned.plan["modules"] as string[])).toContain("geometry");
    expect((planned.plan["moduleScripts"] as string[]).some((entry) => entry.endsWith("geometry.py"))).toBe(true);
    const composeSrc = readFileSync(join(SRC, "compose.py"), "utf8");
    expect(composeSrc).toContain("clinic-finish-geometry-v1");
  });
});

// NOT TESTED: live Blender compose.py execution; palette appearance in Model Vetting;
// ui-xr runtime consumption; Quest; clinical validity.
