import { describe, expect, it } from "vitest";
import { COMPILE_NODE_FAMILIES, emitCompileNodes } from "./encounter-materialization-evidence.js";

/**
 * OBSERVABLE: emitCompileNodes invents no Room, Placement, Lighting, or
 * Dialogue nodes. Faculty cannot lock or override a room or a plant.
 *
 * MEASURED 2026-08-29. COMPILE_NODE_FAMILIES = ActorVariant, EquipVariant
 * (encounter-materialization-evidence.ts:6). emitCompileNodes:82-130 maps
 * actorEvidence + equipmentEvidence only. Comment: Invents no room/garment/physics nodes.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

describe("the compile graph emits room, placement, lighting, dialogue nodes", () => {
  it.fails("(1) COMPILE_NODE_FAMILIES includes Room, Placement, Lighting, DialoguePolicy", () => {
    expect(COMPILE_NODE_FAMILIES).toEqual(
      expect.arrayContaining(["ActorVariant", "EquipVariant", "Room", "Placement", "Lighting", "DialoguePolicy"]),
    );
  });

  it("(2) COUNTERWEIGHT: ActorVariant and EquipVariant stay", () => {
    expect(COMPILE_NODE_FAMILIES).toEqual(expect.arrayContaining(["ActorVariant", "EquipVariant"]));
  });
});

void emitCompileNodes;

// NOT TESTED: faculty drawing edges; live bake; #167.
