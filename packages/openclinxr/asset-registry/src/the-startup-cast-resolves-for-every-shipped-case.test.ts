import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stationIdForSceneClosureScenario } from "./encounter-bundle-admission.js";
import { resolveStartupRuntimeCast } from "./runtime-bundle-lookups.js";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "./runtime-bundles-entry.js";

/**
 * ui-xr binds four humanoid models at module load (main.ts, via resolveStartupRuntimeCast). After
 * 73948bc45 made known cases keep exactly their declared cast, a case with no nurse /
 * medical_assistant or no family member threw "Missing encounter runtime asset clinical_staff"
 * there, the page never loaded, and every capture of the case timed out at 180 s.
 * clinic_abdominal_pain_interpreter_v1 (patient, father, interpreter tablet) is the measured case.
 *
 * The case list is read from the shipped asset directories, so a new case is covered without
 * editing this file.
 */
const GENERATED_DIR = fileURLToPath(new URL("../../../../apps/ui-xr/public/xr-assets/generated/", import.meta.url));

// The role lists main.ts bound before the extract. `medical_assistant` is not in the role union
// today; it stays so a cast that adds one still fills the staff slot.
const STAFF_ROLES = ["nurse", "medical_assistant"];
const FAMILY_ROLES = ["family_member", "family"];

/** Built exactly as main.ts builds its module-load bundle. */
function startupBundle(scenarioId: string) {
  const stationId = stationIdForSceneClosureScenario(scenarioId);
  return createEdChestPainLocalLearnerRuntimeAssetBundle({ scenarioId, ...(stationId === undefined ? {} : { stationId }) });
}

function shippedScenarioIds(): string[] {
  return readdirSync(GENERATED_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("the startup cast resolves for every shipped case", () => {
  it("(1) every shipped case yields a model in all four startup slots without throwing", () => {
    const ids = shippedScenarioIds();
    // The measured failing case must be in the population, or this passes about nothing.
    expect(ids).toContain("clinic_abdominal_pain_interpreter_v1");
    for (const scenarioId of ids) {
      const bundle = startupBundle(scenarioId);
      let cast: ReturnType<typeof resolveStartupRuntimeCast> | undefined;
      expect(() => {
        cast = resolveStartupRuntimeCast(bundle);
      }, scenarioId).not.toThrow();
      for (const slot of ["patient", "clinicalStaff", "familyMember", "additional"] as const) {
        expect(cast?.[slot]?.assetId, `${scenarioId}: ${slot}`).toEqual(expect.any(String));
      }
    }
  });

  it("(2) a cast role fills its own slot; only an uncast slot reuses the patient model", () => {
    // Counterweight: returning the patient model for every slot would pass (1).
    let uncastSlots = 0;
    for (const scenarioId of shippedScenarioIds()) {
      const bundle = startupBundle(scenarioId);
      const cast = resolveStartupRuntimeCast(bundle);
      const patient = bundle.actors.find((a) => a.role === "patient")?.model;
      const staff = bundle.actors.find((a) => STAFF_ROLES.includes(a.role))?.model;
      const family = bundle.actors.find((a) => FAMILY_ROLES.includes(a.role))?.model;
      expect(cast.patient, scenarioId).toBe(patient);
      expect(cast.clinicalStaff, `${scenarioId}: clinicalStaff`).toBe(staff ?? patient);
      expect(cast.familyMember, `${scenarioId}: familyMember`).toBe(family ?? patient);
      expect(cast.additional, `${scenarioId}: additional`).toBe(staff ?? patient);
      if (staff === undefined) uncastSlots += 1;
      if (family === undefined) uncastSlots += 1;
    }
    // The fallback branch must be exercised by a shipped case, or removing it goes unseen.
    expect(uncastSlots).toBeGreaterThan(0);
  });
});
