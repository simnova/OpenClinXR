import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { factoryStationSchemas } from "../catalog.js";
import { designLightingRig, LIGHTING_RIG_STAGE_REL, planLightingDesign } from "./run.js";

/**
 * OBSERVABLE: lighting_design emits a deterministic rig (room + cast + mood ->
 * same JSON) that the room albedo bake consumes as probe lights.
 *
 * Seeded PRNG over canonical input JSON. No LLM. Indoor energies only.
 * ui-xr runtime key/fill consumption is follow-up work, not wired here.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

const BBOX = JSON.stringify({ minX: -2, minY: -2.5, minZ: 0, maxX: 2, maxY: 2.5, maxZ: 2.8 });
const CAST = JSON.stringify([
  { actorId: "patient_maya", position: [0.5, 0.0, 0.0] },
  { actorId: "parent_john", position: [-0.8, 1.2, 0.0] },
]);

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { environmentId: "ed_exam_bay_v1", bboxJson: BBOX, castJson: CAST, mood: "ed_exam_bright", seed: 7, ...overrides };
}

describe("the lighting_design station emits a deterministic rig", () => {
  it("(1) plan() passes room, cast, mood through and cites the rig baker", () => {
    const planned = planLightingDesign(validInput());
    expect("issues" in planned).toBe(false);
    if ("issues" in planned) return;
    expect(planned.plan["mode"]).toBe("dry-run");
    expect(planned.plan["stationId"]).toBe("lighting_design");
    expect(planned.plan["mood"]).toBe("ed_exam_bright");
    expect(planned.plan["lightCount"]).toBe(7);
    expect(planned.plan["exposure"]).toBe(1.0);
    expect(planned.plan["bakerId"]).toBe("lighting_rig");
    expect(String(planned.plan["stageScriptRel"])).toBe(LIGHTING_RIG_STAGE_REL);
    const rig = planned.plan["rig"] as Record<string, unknown>;
    expect(rig["bakePathLlm"]).toBe(false);
    expect(Array.isArray(rig["lights"])).toBe(true);
  });

  it("(2) same input twice -> identical rig (seeded, no LLM)", () => {
    const rigA = designLightingRig(validInput());
    const rigB = designLightingRig(validInput());
    expect(rigB).toEqual(rigA);
  });

  it("(3) mood variants differ in exposure and energy", () => {
    const bright = designLightingRig(validInput({ mood: "ed_exam_bright" }));
    const calm = designLightingRig(validInput({ mood: "evening_calm" }));
    expect(calm.exposure).toBeLessThan(bright.exposure);
    const energy = (rig: typeof bright): number => rig.lights.reduce((acc, light) => acc + light.energy, 0);
    expect(energy(calm)).toBeLessThan(energy(bright));
    const clinic = designLightingRig(validInput({ mood: "clinic_day" }));
    expect(clinic.exposure).toBeGreaterThan(calm.exposure);
    expect(clinic.exposure).toBeLessThan(bright.exposure);
  });

  it("(4) plan() refuses unknown room and unknown mood", () => {
    const badRoom = planLightingDesign(validInput({ environmentId: "icu_penthouse_v9" }));
    expect("issues" in badRoom).toBe(true);
    if (!("issues" in badRoom)) return;
    expect(badRoom.issues.map((issue) => issue.message).join("; ")).toMatch(/unknown environmentId/);
    const badMood = planLightingDesign(validInput({ mood: "midnight_horror" }));
    expect("issues" in badMood).toBe(true);
    if (!("issues" in badMood)) return;
    expect(badMood.issues.map((issue) => issue.message).join("; ")).toMatch(/unknown mood/);
  });

  it("(5) plan() refuses missing room identity and bad bbox/cast JSON", () => {
    const { environmentId: _drop, ...noRoom } = validInput();
    const missing = planLightingDesign({ ...noRoom });
    expect("issues" in missing).toBe(true);
    const badBbox = planLightingDesign(validInput({ bboxJson: "not-json" }));
    expect("issues" in badBbox).toBe(true);
    const badCast = planLightingDesign(validInput({ castJson: JSON.stringify([]) }));
    expect("issues" in badCast).toBe(true);
  });

  it("(6) catalog schema reports lighting_design fields and validates", () => {
    const json = factoryStationSchemas.lighting_design.jsonSchema.input({ target: "draft-2020-12" });
    for (const key of ["bboxJson", "castJson", "mood", "seed"]) {
      expect(json.properties, key).toHaveProperty(key);
    }
    const checked = factoryStationSchemas.lighting_design["~standard"].validate(validInput());
    expect("issues" in checked).toBe(false);
  });

  it("(7) rig values stay in indoor ranges and the albedo bake consumes --rig-json", () => {
    const rig = designLightingRig(validInput());
    for (const light of rig.lights) {
      expect(light.energy).toBeGreaterThan(0);
      expect(light.energy).toBeLessThanOrEqual(500);
      expect(["point", "area", "directional"] as string[]).toContain(light.type);
    }
    const bakeSrc = readFileSync(join(SRC, "..", "room_generate", "room-albedo-ao-bake.py"), "utf8");
    expect(bakeSrc).toContain("--rig-json");
    expect(bakeSrc).toContain("openclinxr_room_bake_rig_");
    expect(bakeSrc).toContain("remove_probe_lights");
    const rigSrc = readFileSync(join(SRC, "lighting-rig.py"), "utf8");
    expect(rigSrc).toContain("RIG_SCHEMA_VERSION");
    expect(rigSrc).toContain("--rig-json");
    const runSrc = readFileSync(join(SRC, "run.ts"), "utf8");
    expect(runSrc).toContain("packages/openclinxr/factory-stations/src/lighting_design/lighting-rig.py");
    expect(runSrc).toContain("spawnBlenderProcess");
    // ui-xr runtime consumes the rig via lighting-rig-runtime.ts.
    expect(runSrc).toContain("lighting-rig-runtime.ts");
    const runtimeSrc = readFileSync(join(SRC, "..", "..", "..", "..", "..", "apps", "ui-xr", "src", "lighting-rig-runtime.ts"), "utf8");
    expect(runtimeSrc).toContain("applyStationInteriorLightingForEnvironment");
    expect(runtimeSrc).toContain("raised_hemisphere_ground");
  });
});

// NOT TESTED: live Blender rig placement; albedo bake output under the rig;
// ui-xr runtime key/fill consumption; Quest; clinical validity.
