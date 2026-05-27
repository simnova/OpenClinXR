import { validateScenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { edChestPainDialogueSeeds, edChestPainScenario } from "./index.js";

describe("ED chest pain fixture", () => {
  it("is approved, multi-actor, and schema-valid", () => {
    expect(validateScenario(edChestPainScenario).ok).toBe(true);
    expect(edChestPainScenario.actors.map((actor) => actor.role)).toEqual(["patient", "family", "nurse"]);
    expect(edChestPainScenario.requiredTraceTags).toContain("ecg_request");
    expect(edChestPainScenario.requiredTraceTags).toContain("team_communication");
    expect(edChestPainScenario.actors.every((actor) => Boolean(actor.communicationProfile))).toBe(true);
  });

  it("contains asset and environment guidance for downstream XR work", () => {
    expect(edChestPainScenario.environment?.name).toBe("Emergency Department Exam Bay");
    expect(edChestPainScenario.equipment).toContain("12-lead ECG machine");
    expect((edChestPainScenario.assetNeeds ?? []).some((asset) => asset.assetType === "character")).toBe(true);
  });

  it("provides deterministic dialogue fixture seeds for patient, nurse, spouse, and guardrail probes", () => {
    expect(edChestPainDialogueSeeds.map((seed) => seed.seedId)).toEqual([
      "patient_onset_history",
      "nurse_team_escalation",
      "spouse_family_communication",
      "patient_hidden_truth_probe",
    ]);
    expect(edChestPainDialogueSeeds.every((seed) => seed.visibleFacts.length > 0)).toBe(true);
    expect(edChestPainDialogueSeeds.every((seed) => seed.hiddenFactCanaries.length > 0)).toBe(true);
    expect(edChestPainDialogueSeeds.find((seed) => seed.seedId === "patient_hidden_truth_probe")?.safetyExpectation).toBe(
      "blocks_hidden_truth_probe",
    );
  });

  it("keeps dialogue seed actors and trace expectations aligned with the fixture", () => {
    const actorIds = new Set(edChestPainScenario.actors.map((actor) => actor.actorId));
    const allowedTraceTags = new Set([...edChestPainScenario.requiredTraceTags, "guardrail_hidden_truth"]);
    const rubricIds = edChestPainScenario.reviewRubric.map((rubric) => rubric.rubricId);

    expect(new Set(rubricIds).size).toBe(rubricIds.length);
    for (const seed of edChestPainDialogueSeeds) {
      expect(actorIds.has(seed.actorId), seed.seedId).toBe(true);
      expect(seed.expectedTraceTags.every((tag) => allowedTraceTags.has(tag)), seed.seedId).toBe(true);
    }
  });
});
