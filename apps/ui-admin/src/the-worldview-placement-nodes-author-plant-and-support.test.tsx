import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: no faculty control for actor plant XYZ or support surface
 * (stretcher|chair|none|equipment). Staging is still an implementer guess.
 *
 * MEASURED 2026-08-29. EnvironmentGenerationQueuePanel + EncounterEnvironmentPanel
 * have no plant, supportSurface, or Placement node editor. CompileGraphCanvas
 * is read-only (onNodesChange no-op).
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the worldview placement nodes author plant and support", () => {
  it.fails("(1) EnvironmentGenerationQueuePanel authors plant or supportSurface", () => {
    const panel = readFileSync(join(SRC, "EnvironmentGenerationQueuePanel.tsx"), "utf8");
    expect(panel).toMatch(/supportSurface|plantXyz|plantOffset/);
  });

  it("(2) COUNTERWEIGHT: compile graph canvas remains (read-only today)", () => {
    const canvas = readFileSync(join(SRC, "CompileGraphCanvas.tsx"), "utf8");
    expect(canvas).toContain("CompileGraphCanvas");
  });
});

// NOT TESTED: clinical staging consult; live room capture; #167.
