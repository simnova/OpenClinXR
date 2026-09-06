import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { findUnsafeClaimLanguage } from "@openclinxr/domain/claim-language";
import { validateScenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  caseAuthoringClaimBoundary,
  collectTouchResponseTraceTags,
  createActorDraft,
  createEmptyScenarioDraft,
  createTouchResponseDraft,
  exportScenarioJson,
  mergeFormValuesIntoScenario,
  parseScenarioJson,
  scenarioToFormValues,
  validateScenarioDraft,
} from "./case-authoring-model.js";

describe("case authoring model", () => {
  it("keeps the claim boundary aligned with the protected notEvidenceFor contract", () => {
    expect([...caseAuthoringClaimBoundary]).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });

  it("creates an empty draft that already validates against ScenarioSchema", () => {
    const draft = createEmptyScenarioDraft();
    expect(validateScenarioDraft(draft)).toEqual({ ok: true });
    expect(draft.actors).toHaveLength(1);
  });

  it("round-trips an existing fixture through form projection and merge without loss", () => {
    const formValues = scenarioToFormValues(edChestPainScenario);
    const merged = mergeFormValuesIntoScenario(edChestPainScenario, formValues);

    // Full-shape validation still passes after the editor round-trip.
    expect(validateScenario(merged)).toEqual({ ok: true });

    // Structural equality on the authored surfaces we edit.
    expect(merged.scenarioId).toBe(edChestPainScenario.scenarioId);
    expect(merged.actors).toHaveLength(edChestPainScenario.actors.length);

    const mergedPatient = merged.actors.find((actor) => actor.actorId === "patient_robert_hayes_v1");
    const basePatient = edChestPainScenario.actors.find((actor) => actor.actorId === "patient_robert_hayes_v1");
    expect(mergedPatient?.bodyMechanics?.touchResponses).toEqual(basePatient?.bodyMechanics?.touchResponses);
    expect(mergedPatient?.bodyMechanics?.habitus).toBe("average");

    // Authored phenotype (factory bake inputs) survives the editor round-trip.
    expect(mergedPatient?.phenotype).toEqual(basePatient?.phenotype);

    // Preserved (non-form) fields survive the round-trip.
    expect(mergedPatient?.communicationProfile).toEqual(basePatient?.communicationProfile);
    expect(merged.governance).toEqual(edChestPainScenario.governance);
    expect(merged.review).toEqual(edChestPainScenario.review);
    expect(merged.reviewRubric).toEqual(edChestPainScenario.reviewRubric);
    expect(merged.environment).toEqual(edChestPainScenario.environment);
  });

  it("writes faculty environment name, description, and infinigenSeed onto the case", () => {
    const formValues = scenarioToFormValues(edChestPainScenario);
    formValues.environmentName = "Faculty ED bay";
    formValues.environmentDescription = "Renamed for this station";
    formValues.infinigenSeed = "seed-42";
    const merged = mergeFormValuesIntoScenario(edChestPainScenario, formValues);
    expect(validateScenario(merged)).toEqual({ ok: true });
    expect(merged.environment).toMatchObject({
      environmentId: edChestPainScenario.environment?.environmentId,
      name: "Faculty ED bay",
      description: "Renamed for this station",
      infinigenSeed: "seed-42",
    });
  });

  it("exports scenario-bank-shaped JSON that re-imports and re-validates", () => {
    const formValues = scenarioToFormValues(edChestPainScenario);
    const merged = mergeFormValuesIntoScenario(edChestPainScenario, formValues);
    const json = exportScenarioJson(merged);

    const reparsed = parseScenarioJson(json);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) {
      expect(reparsed.scenario).toEqual(merged);
    }
  });

  it("merges authored phenotype edits (garmentLayers, eye_color, clothing_style) back onto the scenario", () => {
    const formValues = scenarioToFormValues(edChestPainScenario);
    const patient = formValues.actors.find((actor) => actor.actorId === "patient_robert_hayes_v1");
    expect(patient?.phenotype?.garmentLayers).toEqual(["hospital_gown"]);
    if (patient?.phenotype) {
      patient.phenotype.eye_color = "green";
      patient.phenotype.clothing_style = "teal_clinical_scrubs_with_name_badge";
      patient.phenotype.garmentLayers = ["hospital_gown", "scrub_shirt"];
    }

    const merged = mergeFormValuesIntoScenario(edChestPainScenario, formValues);
    const mergedPatient = merged.actors.find((actor) => actor.actorId === "patient_robert_hayes_v1");
    expect(mergedPatient?.phenotype?.eye_color).toBe("green");
    expect(mergedPatient?.phenotype?.clothing_style).toBe("teal_clinical_scrubs_with_name_badge");
    expect(mergedPatient?.phenotype?.garmentLayers).toEqual(["hospital_gown", "scrub_shirt"]);
    // Phenotype keys the form does not expose survive the round-trip.
    expect(mergedPatient?.phenotype?.height_cm).toBe(178);
    expect(validateScenario(merged)).toEqual({ ok: true });
  });

  it("supports an author editing meta and adding a new touch-response region", () => {
    const formValues = scenarioToFormValues(edChestPainScenario);
    formValues.title = "Edited Encounter Title";
    const patient = formValues.actors.find((actor) => actor.actorId === "patient_robert_hayes_v1");
    const beforeCount = patient?.touchResponses?.length ?? 0;
    patient?.touchResponses?.push(createTouchResponseDraft("neck_anterior"));

    const merged = mergeFormValuesIntoScenario(edChestPainScenario, formValues);
    expect(merged.title).toBe("Edited Encounter Title");
    expect(validateScenario(merged)).toEqual({ ok: true });

    const mergedPatient = merged.actors.find((actor) => actor.actorId === "patient_robert_hayes_v1");
    expect(mergedPatient?.bodyMechanics?.touchResponses).toHaveLength(beforeCount + 1);
    expect(mergedPatient?.bodyMechanics?.touchResponses?.at(-1)?.region).toBe("neck_anterior");
  });

  it("supports adding a brand-new actor with its own touch response", () => {
    const formValues = scenarioToFormValues(createEmptyScenarioDraft());
    formValues.requiredTraceTags = ["encounter_opening", "clinical_touch_chest_l"];
    const nurse = createActorDraft(2, "nurse");
    formValues.actors.push({
      actorId: nurse.actorId,
      role: nurse.role,
      displayName: "Nurse Lee",
      touchResponses: [createTouchResponseDraft("chest_L")],
      habitus: "average",
    });

    const merged = mergeFormValuesIntoScenario(createEmptyScenarioDraft(), formValues);
    expect(validateScenario(merged)).toEqual({ ok: true });
    expect(merged.actors).toHaveLength(2);
    expect(merged.actors.at(-1)?.bodyMechanics?.touchResponses?.[0]?.region).toBe("chest_L");
  });

  it("rejects malformed and schema-invalid imports with actionable errors", () => {
    const badJson = parseScenarioJson("{ not json");
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) {
      expect(badJson.errors[0]).toMatch(/Invalid JSON/);
    }

    const schemaInvalid = parseScenarioJson(JSON.stringify({ scenarioId: "x", title: "y" }));
    expect(schemaInvalid.ok).toBe(false);
    if (!schemaInvalid.ok) {
      expect(schemaInvalid.errors.length).toBeGreaterThan(0);
    }
  });

  it("collects distinct touch-response trace tags for author feedback", () => {
    const tags = collectTouchResponseTraceTags(edChestPainScenario);
    expect(tags).toContain("clinical_touch_guard_rlq");
    expect(tags).toContain("clinical_touch_guard_chest_r");
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("keeps generated draft copy free of unsafe claim language", () => {
    const draft = createEmptyScenarioDraft();
    expect(findUnsafeClaimLanguage(draft.governance.syntheticCaseDisclosure)).toEqual([]);
    expect(findUnsafeClaimLanguage(draft.title)).toEqual([]);
  });
});
