import { existsSync, readFileSync } from "node:fs";
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

  it("(5) compose.py validates the recipe schema and emits finish geometry", () => {
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

  it("(8) ward preset + room resolve, and floor/kept-leaf photo-textures are wired with bytes on disk", () => {
    const ward = designRoomFinishRecipe(
      validInput({ environmentId: "inpatient_ward_room_v1", preset: "ward_photo" }) as {
        environmentId: string;
        preset: string;
        seed: number;
      },
    );
    expect(ward.environmentId).toBe("inpatient_ward_room_v1");
    expect(ward.preset).toBe("ward_photo");
    expect(ward.palette.wallAlbedo).toEqual([0.72, 0.74, 0.72]);
    expect(ROOM_FINISH_PRESETS).toContain("ward_photo");
    const composeSrc = readFileSync(join(SRC, "compose.py"), "utf8");
    expect(composeSrc).toContain("_photo_object_material");
    expect(composeSrc).toContain("_texture_kept_door_leaf");
    expect(composeSrc).toContain("floor-vinyl.jpg");
    expect(composeSrc).toContain("door-maple.jpg");
    expect(composeSrc).toContain("openclinxr_finish_floor_photo");
    expect(composeSrc).toContain("openclinxr_finish_door_photo");
    expect(existsSync(join(SRC, "textures", "floor-vinyl.jpg"))).toBe(true);
    expect(existsSync(join(SRC, "textures", "door-maple.jpg"))).toBe(true);
    expect(existsSync(join(SRC, "textures", "ceiling-tile-face.png"))).toBe(true);
  });

  it("(8b) ward_photo preserves the shell bake and wires full PBR on tile + leaf", () => {
    const composeSrc = readFileSync(join(SRC, "compose.py"), "utf8");
    // ward_photo scope: flat repaint + vinyl floor field gated off so the
    // shell_bake_* materials pass through; other presets keep legacy paint.
    expect(composeSrc).toContain('recipe.get("preset") == "ward_photo"');
    expect(composeSrc).toContain("preserve_shell");
    expect(composeSrc).toContain("emit_floor");
    // Ceiling tile face: procedural albedo plus derived normal/roughness via
    // the shell-bake Normal-Map pattern (files exist on disk).
    expect(composeSrc).toContain("CEILING_NORMAL_FILE");
    expect(composeSrc).toContain("CEILING_ROUGHNESS_FILE");
    expect(composeSrc).toContain("ShaderNodeNormalMap");
    expect(existsSync(join(SRC, "textures", "ceiling-tile-face-derived-normal.png"))).toBe(true);
    expect(existsSync(join(SRC, "textures", "ceiling-tile-face-derived-roughness.png"))).toBe(true);
    // Door leaf: leaf-aspect crop plus edge-clamped derived maps (files exist).
    expect(composeSrc).toContain("DOOR_LEAF_FILE");
    expect(composeSrc).toContain("door-maple-leaf.jpg");
    expect(composeSrc).toContain("DOOR_NORMAL_FILE");
    expect(composeSrc).toContain("DOOR_ROUGHNESS_FILE");
    expect(existsSync(join(SRC, "textures", "door-maple-leaf.jpg"))).toBe(true);
    expect(existsSync(join(SRC, "textures", "door-maple-normal.png"))).toBe(true);
    expect(existsSync(join(SRC, "textures", "door-maple-roughness.png"))).toBe(true);
  });

  it("(9) S5 finish rework: corridor props deleted, crash rail off by default, no fixed ceiling height", () => {
    const composeSrc = readFileSync(join(SRC, "compose.py"), "utf8");
    // Deleted emissions: exam table, exit sign, hand-built door kit, old
    // ceiling field name. (S6 rebuilds the ceiling properly: the tile field
    // is openclinxr_ceiling_tiles and the T-bar grid is real openclinxr_tbar_*
    // strip geometry -- see the ceiling-grid-and-flat-troffer test.)
    for (const gone of [
      "openclinxr_exam_table",
      "openclinxr_exam_base",
      "openclinxr_exam_cushion",
      "openclinxr_exam_backrest",
      "openclinxr_exit_sign",
      "openclinxr_door_jamb",
      "openclinxr_door_header",
      "openclinxr_door_slab",
      "openclinxr_door_panel_",
      "openclinxr_door_lever",
      "openclinxr_door_kick",
      "openclinxr_ceiling_field",
      "2.744",
    ]) {
      expect(composeSrc).not.toContain(gone);
    }
    // Crash rail gated behind options.crashRail, default off.
    expect(composeSrc).toContain("openclinxr_crash_rail");
    expect(composeSrc).toContain("crash_rail_enabled");
    const defaultRecipe = designRoomFinishRecipe(validInput() as { environmentId: string; preset: string; seed: number });
    expect(defaultRecipe.options).toEqual({ crashRail: false });
    const railed = designRoomFinishRecipe(
      validInput({ crashRail: true }) as { environmentId: string; preset: string; seed: number; crashRail?: boolean },
    );
    expect(railed.options).toEqual({ crashRail: true });
    // Ceiling fragment derives the T-bar height from measured bounds, no fixed constant.
    const ceilingSrc = readFileSync(join(SRC, "ceiling.py"), "utf8");
    expect(ceilingSrc).not.toContain("2.744");
    expect(ceilingSrc).toContain("ceiling_tbar_z");
    // The kept Infinigen leaf/casing/skirting survive the strip into the room prefix.
    const stripSrc = readFileSync(join(SRC, "..", "room_generate", "infinigen_generate", "strip_room_shell_placeholders.py"), "utf8");
    for (const want of ["door_leaf", "door_casing", "skirting_floor", "skirting_ceiling", "DoorCasingFactory", "skirtingboard_"]) {
      expect(stripSrc).toContain(want);
    }
  });
});

// NOT TESTED: live Blender compose.py execution; palette appearance in Model Vetting;
// ui-xr runtime consumption; Quest; clinical validity.
