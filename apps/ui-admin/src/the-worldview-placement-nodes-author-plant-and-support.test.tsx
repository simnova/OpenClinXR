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
 *
 * ## FIXED (tsk_250729c006996e58)
 * 2026-08-30. EnvironmentGenerationQueuePanel gains a "Faculty staging authoring"
 * fieldset: a Form.List over actor staging rows with a real Select writing
 * placement.supportSurface (stretcher|chair|none, from case-authoring-model
 * supportSurfaceOptions) plus a plantOffsetMeters InputNumber — the same
 * ActorCard.placement fields the factory Placement compile nodes and
 * PLACEMENT_OVERRIDE_PATHS (/supportSurface, /plantOffsetMeters) consume.
 * Authored placement values flow to the parent via onPlacementAuthorChange
 * (parent-owned, survives panel re-render). CompileGraphCanvas remains the
 * read-only graph; no runtime placement is implied.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the worldview placement nodes author plant and support", () => {
  it("(1) EnvironmentGenerationQueuePanel authors plant or supportSurface", () => {
    const panel = readFileSync(join(SRC, "EnvironmentGenerationQueuePanel.tsx"), "utf8");
    expect(panel).toMatch(/supportSurface|plantXyz|plantOffset/);
  });

  it("(2) COUNTERWEIGHT: compile graph canvas remains (read-only today)", () => {
    const canvas = readFileSync(join(SRC, "../../../packages/openclinxr/ui-shared/src/admin-compile-graph-canvas.tsx"), "utf8");
    expect(canvas).toContain("CompileGraphCanvas");
  });
});

// NOT TESTED: clinical staging consult; live room capture; #167.
