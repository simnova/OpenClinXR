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
  it("(1) EnvironmentGenerationQueuePanel authors a SIGNED plant VECTOR, not a non-negative scalar", () => {
    // REPLACED, not supplemented. The previous assertion was
    //     expect(panel).toMatch(/supportSurface|plantXyz|plantOffset/)
    // which "plantOffsetMeters" already satisfied, so it was green before this card and would
    // have stayed green whatever the card did. It advertised a guard it did not provide.
    //
    // This file reads the panel's SOURCE; it cannot render the control. So it asserts the two
    // things a source read can decide and that were both FALSE before the slice: the authored
    // type is a three-component vector, and the numeric input no longer clamps at zero — the
    // clamp is what made the authored clinic value x: -0.55 (clinic-knee-pain.ts:76)
    // unrepresentable. Behavioural refusal of a bare scalar is asserted in
    // factory-stations/src/the-staging-station-takes-a-signed-plant-vector.test.ts.
    const panel = readFileSync(join(SRC, "environment-generation-queue-panel.tsx"), "utf8");
    expect(panel).toMatch(/plantOffsetMeters\?:\s*\{\s*x:\s*number;\s*y:\s*number;\s*z:\s*number\s*\}/u);
    expect(panel).not.toMatch(/min=\{0\}/u);
  });

  it("(2) COUNTERWEIGHT: compile graph canvas remains (read-only today)", () => {
    const canvas = readFileSync(join(SRC, "../../ui-shared/src/admin-compile-graph-canvas.tsx"), "utf8");
    expect(canvas).toContain("CompileGraphCanvas");
  });
});

// NOT TESTED: clinical staging consult; live room capture; #167.
