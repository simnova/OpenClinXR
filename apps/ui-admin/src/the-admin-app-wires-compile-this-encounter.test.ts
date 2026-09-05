import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: EnvironmentGenerationQueuePanel has Compile this encounter, but
 * App.tsx does not pass featuredScenarioId or onCompileEncounter, so the button
 * is not rendered in the admin app. Faculty cannot BUILD from the workbench.
 *
 * MEASURED 2026-08-29 on origin 37a87f13. App.tsx:1369-1383 mounts the panel
 * with lock/override handlers and onInitiateSceneGeneration, and does not
 * mention onCompileEncounter or featuredScenarioId. compile-encounter-world.ts
 * and POST /internal/world-compile exist.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * claimScope: AdminApp workbench actually renders and fires the compile button.
 * notEvidenceFor: live Blender; #167; Quest.
 *
 * ## FIXED (#0)
 * 2026-08-29. App.tsx imports compileEncounterWorld from ./api-client.js and
 * passes featuredScenarioId (from sceneGenerationPipelineQueue.
 * featuredFactoryPlanningScenarioId) plus onCompileEncounter into
 * EnvironmentGenerationQueuePanel, so the faculty button renders and POSTs
 * /internal/world-compile for the featured scenario. Live POST not exercised.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(SRC, "app.tsx"), "utf8");

describe("the admin app wires Compile this encounter", () => {
  it("(1) App.tsx passes featuredScenarioId into EnvironmentGenerationQueuePanel", () => {
    expect(APP).toMatch(/featuredScenarioId=/);
  });

  it("(2) App.tsx passes onCompileEncounter into EnvironmentGenerationQueuePanel", () => {
    expect(APP).toMatch(/onCompileEncounter=/);
  });

  it("(3) App.tsx imports compileEncounterWorld", () => {
    expect(APP).toMatch(/compileEncounterWorld/);
  });

  it("(4) COUNTERWEIGHT: the panel still hides the button when onCompileEncounter is omitted", () => {
    const panel = readFileSync(join(SRC, "environment-generation-queue-panel.tsx"), "utf8");
    expect(panel).toContain("{onCompileEncounter ? (");
  });
});

// NOT TESTED: live POST; Blender; featured scenario selection UI.
