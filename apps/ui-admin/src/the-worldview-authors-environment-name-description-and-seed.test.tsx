import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: picking environmentId derives name+description from
 * ENVIRONMENT_SHELL_DESCRIPTORS. Infinigen seed lives in PROVENANCE.md, not
 * the case. Faculty cannot rename the room or record the bake seed on the
 * worldview (W6 owns the prompt text).
 *
 * MEASURED 2026-08-29. authoredEnvironment (case-authoring-model.ts:331-336)
 * copies displayName into both name and description. infinigen-environment-assets.ts
 * "Seed/predicate facts live in PROVENANCE.md, not here."
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W19 tsk_4f28fcd8d4afdca9)
 * ScenarioFormValues carries environmentName, environmentDescription, infinigenSeed.
 * EncounterEnvironmentPanel authors those fields; merge writes name/description/seed
 * onto scenario.environment instead of copying displayName twice.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(SRC, "case-authoring-model.ts"), "utf8");
const ENV = readFileSync(join(SRC, "EncounterEnvironmentPanel.tsx"), "utf8");

describe("the worldview authors environment name, description, and seed", () => {
  it("(1) ScenarioFormValues includes environment name or infinigenSeed", () => {
    const slice = MODEL.slice(
      MODEL.indexOf("export type ScenarioFormValues"),
      MODEL.indexOf("export type ScenarioActorFormValue"),
    );
    expect(slice).toMatch(/infinigenSeed|environmentName/);
  });

  it("(2) COUNTERWEIGHT: environmentId Select remains", () => {
    expect(ENV).toMatch(/name="environmentId"/);
  });
});

// NOT TESTED: live Infinigen bake; geometry budget; #167.
