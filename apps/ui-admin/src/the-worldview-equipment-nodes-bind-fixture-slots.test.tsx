import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: EquipmentPanel is a tags-mode string list (scenario.equipment).
 * Fixture slots live on ENVIRONMENT_SHELL_DESCRIPTORS. Faculty cannot bind a
 * cart to a slot from the worldview.
 *
 * MEASURED 2026-08-29. EquipmentPanel.tsx:1-24 "Not a library picker — not 3D
 * placement." EncounterEnvironmentPanel lists fixtureSlots read-only.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W7 tsk_d15db5b7a4b765cc)
 * EnvironmentGenerationQueuePanel binds equipmentId to fixtureSlot.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the worldview equipment nodes bind fixture slots", () => {
  it("(1) EnvironmentGenerationQueuePanel binds equipment to fixtureSlots", () => {
    const panel = readFileSync(join(SRC, "EnvironmentGenerationQueuePanel.tsx"), "utf8");
    expect(panel).toMatch(/fixtureSlot/);
  });

  it("(2) COUNTERWEIGHT: EquipmentPanel still authors scenario.equipment strings", () => {
    const equip = readFileSync(join(SRC, "EquipmentPanel.tsx"), "utf8");
    expect(equip).toMatch(/name="equipment"/);
  });
});

// NOT TESTED: TRELLIS bake; Quest triangle budget; #167.
