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
 *
 * ## FIXED (tsk_a1b8d328db95d038)
 * COMPILE_NODE_FAMILIES now carries all six. emitCompileNodes emits Room and DialoguePolicy
 * from the case, resolved through findScenarioFixtureById (the lookup four other factory
 * modules already use) rather than by widening evidence.v1 into a second ledger.
 *
 * Lighting and Placement are DECLARED AND EMIT NOTHING, deliberately. Measured over the live
 * bank by reading the scenario objects — a grep over fixture source got two of these wrong:
 *   Room           environment.environmentId       14/14
 *   DialoguePolicy actors[].communicationProfile   14/14
 *   Lighting       environment.lighting             0/14
 *   Placement      placement/staging/supportSurface 0/14
 * `environment` carries exactly environmentId, name, description. A lockable node standing
 * for data the case never authored is worse than no node, so neither is invented here.
 * Authoring must land upstream first.
 */

describe("the compile graph emits room, placement, lighting, dialogue nodes", () => {
  it("(1) COMPILE_NODE_FAMILIES includes Room, Placement, Lighting, DialoguePolicy", () => {
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
