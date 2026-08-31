import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeedWorldviewQueue } from "./seed-worldview-queue.js";
import { installWorldviewQueueTestDom } from "./worldview-queue-test-dom.js";

installWorldviewQueueTestDom();

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
 *
 * ## FIXED (skeptic: SeedWorldviewQueue persists fixtureSlot onto lock+graph)
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the worldview equipment nodes bind fixture slots", () => {
  afterEach(() => {
    cleanup();
  });

  it("(1) SeedWorldviewQueue bind writes fixtureSlot onto facultyAccepted", async () => {
    render(
      <SeedWorldviewQueue
        environmentGenerationQueue={{
          packetCount: 0,
          packets: [],
          blockedScenarioIds: [],
          readyForGenerationReviewScenarioIds: [],
          nextReviewGateCounts: {},
        } as never}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Equipment fixtureSlot" }));
    fireEvent.click(await screen.findByRole("option", { name: "stretcher" }));
    expect(within(screen.getByLabelText("proposedVsAccepted")).getByText(/llmProposed stretcher vs facultyAccepted stretcher/)).toBeInTheDocument();
    expect(readFileSync(join(SRC, "App.tsx"), "utf8")).toContain("SeedWorldviewQueue");
  });

  it("(2) COUNTERWEIGHT: EquipmentPanel still authors scenario.equipment strings", () => {
    const equip = readFileSync(join(SRC, "EquipmentPanel.tsx"), "utf8");
    expect(equip).toMatch(/name="equipment"/);
  });
});

// NOT TESTED: TRELLIS bake; Quest triangle budget; #167.
