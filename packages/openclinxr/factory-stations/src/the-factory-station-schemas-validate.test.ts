import { describe, expect, it } from "vitest";
import {
  factoryStationSchemas,
  productionStationIds,
  type ProductionStationId,
} from "./catalog.js";
import { planEquipmentGenerate } from "./equipment_generate/run.js";
import { planClothingConsume } from "./clothing_consume/run.js";
import { planBodyParam } from "./body_param/run.js";
import { planRoomGenerate } from "./room_generate/run.js";
import { planMotionRetarget } from "./motion_retarget/run.js";
import { planStaging } from "./staging/run.js";
import { planLipSync } from "./lip_sync/run.js";
import { planClothingGenerate } from "./clothing_generate/run.js";
import { planDialogueRuntime } from "./dialogue_runtime/run.js";
import { applyStationPayloadToCompileSpec } from "./apply-station-payload.js";
import { runDialogueRuntime } from "./dialogue_runtime/run.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: factory stations have no Standard Schema V1 interface, so admin
 * cards cannot be derived from a station spec. instrument is a gate, not a card.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (worldview factory station schemas)
 * Each production station exposes ~standard.validate + jsonSchema.input/output.
 *
 * ## FIXED (equipment_generate plan)
 * Catalog payload for ecg-cart-imagine-box plans viewCount 4 from the tracked pack.
 *
 * ## FIXED (remaining station plan() verticals)
 * clothing_consume through dialogue_runtime dry-run StationRunners over proven bakers.
 *
 * ## FIXED (C-F run uniqueness + baker colocation)
 * Live baker spawn is shipped run(); stage scripts live under
 * packages/openclinxr/factory-stations/src/<station>/. Old tools/ paths are fail-closed stubs.
 */

const VALID: Record<ProductionStationId, Record<string, unknown>> = {
  body_param: { actorId: "actor_a", ageYears: 8, sex: "female", heightCm: 120, garmentLayers: "tshirt" },
  clothing_generate: { actorId: "actor_a", garmentToken: "short_sleeve_exam_tshirt" },
  clothing_consume: { actorId: "actor_a", mhcloPath: "library/scrub.mhclo" },
  motion_retarget: { actorId: "actor_a", clipId: "idle_v1" },
  lip_sync: { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
  room_generate: { environmentId: "ed_bay_v1", infinigenPrompt: "exam bay", seed: 1, layoutVariant: "default" },
  equipment_generate: {
    subjectId: "ecg-cart-imagine-box",
    packId: "ecg-cart-imagine-box",
    seed: 1,
    remesh: false,
    viewCount: 4,
    decimationTarget: 1_000_000,
  },
  staging: { actorId: "actor_a", supportSurface: "stretcher", plantOffsetMeters: 0.1 },
  dialogue_runtime: { actorId: "actor_a", openingUtterance: "hello", policyId: "peds_v1" },
};

describe("the factory station schemas validate", () => {
  it("(1) production stations expose Standard Schema V1 and JSON Schema field inventory", () => {
    const ids = productionStationIds();
    expect(ids).not.toContain("instrument");
    expect(ids).toEqual(expect.arrayContaining(["equipment_generate", "room_generate"]));
    for (const id of ids) {
      const schema = factoryStationSchemas[id];
      expect(schema["~standard"].version).toBe(1);
      const ok = schema["~standard"].validate(VALID[id]);
      expect(ok, id).toEqual({ value: VALID[id] });
      expect("issues" in ok, id).toBe(false);
      const json = schema.jsonSchema.input({ target: "draft-2020-12" });
      expect(json.type).toBe("object");
      expect(Object.keys(json.properties).length).toBeGreaterThan(0);
      for (const key of Object.keys(VALID[id])) {
        expect(json.properties, id).toHaveProperty(key);
      }
      const output = schema.jsonSchema.output({ target: "draft-2020-12" });
      expect(output.type, id).toBe("object");
      expect(Object.keys(output.properties).length, id).toBeGreaterThan(0);
    }
  });

  it("(2) invalid input yields issues with message; schema-only fields stay on JSON Schema", () => {
    const equip = factoryStationSchemas.equipment_generate;
    const bad = equip["~standard"].validate({ subjectId: 12 });
    expect("issues" in bad).toBe(true);
    if ("issues" in bad) {
      expect(bad.issues[0]?.message.length).toBeGreaterThan(0);
    }
    const room = factoryStationSchemas.room_generate.jsonSchema.input({ target: "draft-2020-12" });
    expect(room.properties).toHaveProperty("layoutVariant");
    const equipJson = equip.jsonSchema.input({ target: "draft-2020-12" });
    expect(equipJson.properties).toHaveProperty("decimationTarget");
  });

  it("(3) equipment_generate.plan reports 4 views for the Imagine-box pack without GPU", () => {
    const result = planEquipmentGenerate(VALID.equipment_generate);
    expect("issues" in result).toBe(false);
    if ("issues" in result) return;
    expect(result.plan["mode"]).toBe("dry-run");
    expect(result.plan["stationId"]).toBe("equipment_generate");
    expect(result.plan["viewCount"]).toBe(4);
    expect(result.plan["conditioning"]).toBe("multi-view");
    expect(Array.isArray(result.plan["inputImagePaths"])).toBe(true);
    expect((result.plan["inputImagePaths"] as string[]).length).toBe(4);
  });

  it("(4) equipment_generate.plan rejects an invalid payload", () => {
    const result = planEquipmentGenerate({ subjectId: "ecg-cart-imagine-box" });
    expect("issues" in result).toBe(true);
  });

  it("(5) factory:trellis:bake CLI imports @openclinxr/factory-stations", () => {
    const cli = readFileSync(
      join(import.meta.dirname, "../../../../tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts"),
      "utf8",
    );
    expect(cli).toContain('from "@openclinxr/factory-stations"');
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../../../../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["factory:trellis:bake"]).toContain("trellis-bake-cli.ts");
  });

  it("(6) remaining stations plan() dry-run VALID catalog payloads and reject invalid", () => {
    const planners = [
      { id: "clothing_consume" as const, plan: planClothingConsume, baker: "fit_stage" },
      { id: "body_param" as const, plan: planBodyParam, baker: "body_param_stage" },
      { id: "room_generate" as const, plan: planRoomGenerate, baker: "room-albedo-ao-bake.py" },
      { id: "motion_retarget" as const, plan: planMotionRetarget, baker: "motion_bind_stage" },
      { id: "staging" as const, plan: planStaging, baker: "generatedActorPlacement" },
      { id: "lip_sync" as const, plan: planLipSync, baker: "rhubarb" },
      { id: "clothing_generate" as const, plan: planClothingGenerate, baker: "garment_selection_by_role" },
      { id: "dialogue_runtime" as const, plan: planDialogueRuntime, baker: "dialogue_policy" },
    ];
    for (const row of planners) {
      const ok = row.plan(VALID[row.id]);
      expect("issues" in ok, row.id).toBe(false);
      if ("issues" in ok) continue;
      expect(ok.plan.mode, row.id).toBe("dry-run");
      expect(ok.plan.stationId, row.id).toBe(row.id);
      expect(JSON.stringify(ok.plan), row.id).toContain(row.baker);
      const bad = row.plan({ actorId: 12 });
      expect("issues" in bad, `${row.id} invalid`).toBe(true);
      if ("issues" in bad) {
        expect(bad.issues[0]?.message.length, row.id).toBeGreaterThan(0);
      }
    }
    const consumeSrc = readFileSync(join(import.meta.dirname, "clothing_consume/run.ts"), "utf8");
    expect(consumeSrc).toContain("packages/openclinxr/factory-stations/src/clothing_consume/fit_stage.py");
    expect(consumeSrc).toContain("spawnBlenderProcess");
    expect(consumeSrc).not.toContain("tools/openclinxr/asset-pipeline/makeclothes/fit_stage.py");
    const fitCli = readFileSync(
      join(import.meta.dirname, "../../../../tools/openclinxr/asset-pipeline/makeclothes/fit-cli.ts"),
      "utf8",
    );
    expect(fitCli).toContain("runClothingConsume");
    expect(fitCli).not.toMatch(/--python[\s\S]{0,80}fit_stage\.py/);
  });

  it("(8) collapsed CLIs call station run* and do not --python the stage script", () => {
    const root = join(import.meta.dirname, "../../../..");
    const rows: Array<[string, string, string]> = [
      ["runBodyParam", "tools/openclinxr/asset-pipeline/makeclothes/body-param-cli.ts", "body_param_stage.py"],
      ["runMotionRetarget", "tools/openclinxr/asset-pipeline/makeclothes/motion-bind-cli.ts", "motion_bind_stage.py"],
      ["runRoomGenerate", "tools/openclinxr/asset-pipeline/environment/rooms-bake-cli.ts", "room-occlusion-bake.py"],
    ];
    for (const [symbol, rel, script] of rows) {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src, rel).toContain(symbol);
      expect(src, rel).not.toMatch(new RegExp(`--python[\\s\\S]{0,80}${script.replace(".", "\\.")}`));
    }
    const composer = readFileSync(join(root, "tools/openclinxr/dark-factory/multi-case-runner.ts"), "utf8");
    expect(composer).toContain("runStaging");
    expect(composer).toContain("runLipSync");
    const dialogue = readFileSync(join(root, "tools/openclinxr/factory/encounter-materialization-compile.ts"), "utf8");
    expect(dialogue).toContain("runDialogueRuntime");
    const clothing = readFileSync(join(root, "tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.ts"), "utf8");
    expect(clothing).toContain("runClothingGenerate");
    const dialogueRun = readFileSync(join(import.meta.dirname, "dialogue_runtime/run.ts"), "utf8");
    expect(dialogueRun).toContain("bakePathLlm: false");
    const roomCli = readFileSync(join(root, "tools/openclinxr/asset-pipeline/environment/room-bake-cli.ts"), "utf8");
    expect(roomCli).toContain("runRoomGenerate");
    expect(roomCli).not.toMatch(/--python[\s\S]{0,80}room-albedo-ao-bake\.py/);
    const envArtifacts = readFileSync(join(root, "tools/openclinxr/evidence/environment-artifacts.ts"), "utf8");
    expect(envArtifacts).toContain("runRoomGenerate");
    expect(envArtifacts).not.toMatch(/--python[\s\S]{0,80}room-(albedo-ao|occlusion)-bake\.py/);
  });

  it("(9) unique baker scripts live in the station package; tools copies are fail-closed stubs", () => {
    const root = join(import.meta.dirname, "../../../..");
    const moved: Array<[string, string, string]> = [
      [
        "body_param/run.ts",
        "packages/openclinxr/factory-stations/src/body_param/body_param_stage.py",
        "tools/openclinxr/asset-pipeline/makeclothes/body_param_stage.py",
      ],
      [
        "motion_retarget/run.ts",
        "packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_stage.py",
        "tools/openclinxr/asset-pipeline/makeclothes/motion_bind_stage.py",
      ],
      [
        "room_generate/run.ts",
        "packages/openclinxr/factory-stations/src/room_generate/room-occlusion-bake.py",
        "tools/openclinxr/asset-pipeline/environment/room-occlusion-bake.py",
      ],
      [
        "clothing_consume/run.ts",
        "packages/openclinxr/factory-stations/src/clothing_consume/fit_stage.py",
        "tools/openclinxr/asset-pipeline/makeclothes/fit_stage.py",
      ],
    ];
    for (const [runRel, packageRel, toolsRel] of moved) {
      const runSrc = readFileSync(join(import.meta.dirname, runRel), "utf8");
      expect(runSrc, runRel).toContain(packageRel);
      expect(runSrc, runRel).not.toContain(toolsRel);
      const stub = readFileSync(join(root, toolsRel), "utf8");
      expect(stub, toolsRel).toMatch(/moved:|unique spawn/);
      expect(stub, toolsRel).toContain("__main__");
    }
    const applied = applyStationPayloadToCompileSpec(
      { family: "EquipVariant" },
      "equipment_generate",
      { subjectId: "ecg-cart-imagine-box", packId: "ecg-cart-imagine-box", seed: 1, remesh: false, viewCount: 4, decimationTarget: 1_000_000 },
    );
    expect(applied["equipmentGenerate"]).toEqual(
      expect.objectContaining({ subjectId: "ecg-cart-imagine-box" }),
    );
    const dialogue = runDialogueRuntime(VALID.dialogue_runtime);
    expect(dialogue["bakePathLlm"]).toBe(false);
    expect(dialogue["status"]).toBe("adapted");
  });

  it("(7) each station has a real composer/CLI importing plan*()", () => {
    const root = join(import.meta.dirname, "../../../..");
    const consumers: Array<[string, string]> = [
      ["planClothingConsume", "tools/openclinxr/asset-pipeline/makeclothes/fit-cli.ts"],
      ["planBodyParam", "tools/openclinxr/asset-pipeline/makeclothes/body-param-cli.ts"],
      ["planRoomGenerate", "tools/openclinxr/asset-pipeline/environment/rooms-bake-cli.ts"],
      ["planMotionRetarget", "tools/openclinxr/asset-pipeline/makeclothes/motion-bind-cli.ts"],
      ["runStaging", "tools/openclinxr/dark-factory/multi-case-runner.ts"],
      ["runLipSync", "tools/openclinxr/dark-factory/multi-case-runner.ts"],
      ["runClothingGenerate", "tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.ts"],
      ["runDialogueRuntime", "tools/openclinxr/factory/encounter-materialization-compile.ts"],
    ];
    for (const [symbol, rel] of consumers) {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src, rel).toContain('from "@openclinxr/factory-stations"');
      expect(src, rel).toContain(symbol);
    }
  });
});

// NOT TESTED: live TRELLIS GPU; Quest; clinical validity.
