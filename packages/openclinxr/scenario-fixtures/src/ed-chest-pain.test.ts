import { validateScenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { edChestPainDialogueSeeds, edChestPainScenario, responseClipForBodyRegion } from "./index.js";

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

  it("drives multi-region animation-driven clinical-touch responses from case bodyMechanics", () => {
    const patient = edChestPainScenario.actors.find((actor) => actor.actorId === "patient_robert_hayes_v1");
    const responses = patient?.bodyMechanics?.touchResponses ?? [];
    expect(responses.length).toBe(6);
    const byRegion = Object.fromEntries(responses.map((r) => [r.region, r]));
    // Required multi-region set (abdomen quadrants + bilateral chest).
    for (const region of [
      "abdomen_rlq",
      "abdomen_ruq",
      "abdomen_luq",
      "abdomen_llq",
      "chest_R",
      "chest_L",
    ] as const) {
      expect(byRegion[region], region).toBeTruthy();
      expect(byRegion[region]?.responseKind).toBe("guarding");
      // The clip is a function of the region (touch-response routing), not a shared RLQ pin.
      expect(byRegion[region]?.responseClip).toBe(responseClipForBodyRegion(region));
      expect(byRegion[region]?.dialogueLine).toBeTruthy();
      expect(byRegion[region]?.traceTag).toMatch(/^clinical_touch_guard_/);
      expect(byRegion[region]?.emotionEventId).toBeTruthy();
    }
    // Counterweight: six anatomically distinct regions still resolve to six distinct clips;
    // a single clip across regions is the collapse this assertion replaced.
    expect(new Set(responses.map((response) => response.responseClip)).size).toBe(responses.length);
    // RLQ maximal (lowest force threshold = most sensitive / rebound-style guarding).
    const rlq = byRegion["abdomen_rlq"]!;
    expect(rlq.forceThreshold).toBeLessThan(byRegion["abdomen_ruq"]!.forceThreshold);
    expect(rlq.forceThreshold).toBeLessThan(byRegion["abdomen_luq"]!.forceThreshold);
    expect(rlq.forceThreshold).toBeLessThan(byRegion["abdomen_llq"]!.forceThreshold);
    expect(rlq.emotion).toBe("pain");
    expect(rlq.traceTag).toBe("clinical_touch_guard_rlq");
    // Additive + optional: actors without bodyMechanics remain valid.
    const nurse = edChestPainScenario.actors.find((actor) => actor.role === "nurse");
    expect(nurse?.bodyMechanics).toBeUndefined();
    expect(validateScenario(edChestPainScenario).ok).toBe(true);
  });
});
