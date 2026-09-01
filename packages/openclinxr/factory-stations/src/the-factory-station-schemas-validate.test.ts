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
    expect(consumeSrc).not.toMatch(/execFile|spawn\(/);
  });

  it("(7) each station has a real composer/CLI importing plan*()", () => {
    const root = join(import.meta.dirname, "../../../..");
    const consumers: Array<[string, string]> = [
      ["planClothingConsume", "tools/openclinxr/asset-pipeline/makeclothes/fit-cli.ts"],
      ["planBodyParam", "tools/openclinxr/asset-pipeline/makeclothes/body-param-cli.ts"],
      ["planRoomGenerate", "tools/openclinxr/asset-pipeline/environment/rooms-bake-cli.ts"],
      ["planMotionRetarget", "tools/openclinxr/asset-pipeline/makeclothes/motion-bind-cli.ts"],
      ["planStaging", "tools/openclinxr/dark-factory/multi-case-runner.ts"],
      ["planLipSync", "tools/openclinxr/dark-factory/multi-case-runner.ts"],
      ["planClothingGenerate", "tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.ts"],
      ["planDialogueRuntime", "tools/openclinxr/factory/encounter-materialization-compile.ts"],
    ];
    for (const [symbol, rel] of consumers) {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src, rel).toContain('from "@openclinxr/factory-stations"');
      expect(src, rel).toContain(symbol);
    }
  });
});

// NOT TESTED: live TRELLIS GPU; Quest; clinical validity.
