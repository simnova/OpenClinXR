import { describe, expect, it } from "vitest";
import {
  factoryStationSchemas,
  productionStationIds,
  type ProductionStationId,
} from "./factory-stations.js";

/**
 * OBSERVABLE: factory stations have no Standard Schema V1 interface, so admin
 * cards cannot be derived from a station spec. instrument is a gate, not a card.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (worldview factory station schemas)
 * Each production station exposes ~standard.validate + jsonSchema.input/output.
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
});

// NOT TESTED: live TRELLIS bake; Quest; clinical validity.
