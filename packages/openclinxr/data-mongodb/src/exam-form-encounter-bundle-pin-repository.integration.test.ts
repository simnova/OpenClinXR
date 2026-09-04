import { assembleExamFormWithPinnedEncounterBundles, type ExamBlueprint } from "@openclinxr/exam-assembly";
import type { Scenario } from "@openclinxr/shared-schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMongoMemoryTestContext, type MongoMemoryTestContext } from "@cellix/server-mongodb-memory-mock";
import { MongoExamFormEncounterBundlePinRepository } from "./exam-form-encounter-bundle-pin-repository.js";

const ED_SCENARIO = "ed_chest_pain_priority_v1";
const PEDS_SCENARIO = "peds_asthma_parent_anxiety_v1";
const ED_SLOT = "station_001_ed_chest_pain_priority_v1";
const PEDS_SLOT = "station_002_peds_asthma_parent_anxiety_v1";
const ED_BUNDLE = "bdl_ed_chest_pain_opaque_v1";
const PEDS_BUNDLE = "bdl_peds_asthma_opaque_v1";
const FORM_ID = "form_two_archetype_pilot";

describe("MongoExamFormEncounterBundlePinRepository integration", () => {
  let context: MongoMemoryTestContext;

  beforeAll(async () => {
    context = await createMongoMemoryTestContext();
  });

  afterAll(async () => {
    await context.close();
  });

  it("recreates against the same Mongo database and launches the same opaque station bundle ids", async () => {
    const assembled = assembleExamFormWithPinnedEncounterBundles({
      examFormId: FORM_ID,
      blueprint: twoStationBlueprint(),
      scenarios: [
        approvedScenario(ED_SCENARIO, "ED chest pain"),
        approvedScenario(PEDS_SCENARIO, "Peds asthma"),
      ],
      catalog: [edCatalog(), pedsCatalog()],
    });
    expect(assembled.assembled).toBe(true);
    if (!assembled.assembled) {
      throw new Error(assembled.blockers.join(", "));
    }

    const first = new MongoExamFormEncounterBundlePinRepository(context.db);
    await first.ensureIndexes();
    expect(first.durableStore).toBe("database_source_of_truth");
    const persisted = await first.persist({
      examFormId: assembled.form.examFormId,
      pins: assembled.pins,
    });
    expect(persisted.durableStore).toBe("database_source_of_truth");
    expect(persisted.pins.every((pin) => pin.durableStore === "database_source_of_truth")).toBe(true);
    expect(persisted.pins.map((pin) => pin.bundleId)).toEqual([ED_BUNDLE, PEDS_BUNDLE]);

    const restarted = new MongoExamFormEncounterBundlePinRepository(context.db);
    const loaded = await restarted.load(FORM_ID);
    expect(loaded?.pins.map((pin) => pin.bundleId)).toEqual([ED_BUNDLE, PEDS_BUNDLE]);
    expect(loaded?.pins.map((pin) => pin.contentIdentity)).toEqual([
      "cid_ed_chest_pain_v1",
      "cid_peds_asthma_v1",
    ]);

    const catalog = [edCatalog(), pedsCatalog()];
    const edLaunch = await restarted.launchPinnedStationAssets({
      examFormId: FORM_ID,
      slotId: ED_SLOT,
      catalog,
    });
    const pedsLaunch = await restarted.launchPinnedStationAssets({
      examFormId: FORM_ID,
      slotId: PEDS_SLOT,
      catalog,
    });
    expect(edLaunch.launched).toBe(true);
    expect(pedsLaunch.launched).toBe(true);
    if (edLaunch.launched && pedsLaunch.launched) {
      expect(edLaunch.bundleId).toBe(ED_BUNDLE);
      expect(pedsLaunch.bundleId).toBe(PEDS_BUNDLE);
      expect(edLaunch.bundleId).not.toBe(pedsLaunch.bundleId);
    }

    const stale = await restarted.launchPinnedStationAssets({
      examFormId: FORM_ID,
      slotId: ED_SLOT,
      catalog: [{ ...edCatalog(), contentIdentity: "cid_rebuilt_after_pin" }],
    });
    expect(stale.launched).toBe(false);
    if (!stale.launched) {
      expect(stale.blockers).toContain(`station:${ED_SLOT}:stale`);
    }

    const blocked = await restarted.launchPinnedStationAssets({
      examFormId: FORM_ID,
      slotId: ED_SLOT,
      catalog: [{ ...edCatalog(), runtimeEligibility: "blocked" }],
    });
    expect(blocked.launched).toBe(false);
    if (!blocked.launched) {
      expect(blocked.blockers).toContain(`station:${ED_SLOT}:blocked`);
    }

    const mismatch = await restarted.launchPinnedStationAssets({
      examFormId: FORM_ID,
      slotId: ED_SLOT,
      catalog: [{ ...edCatalog(), scenarioId: PEDS_SCENARIO }],
    });
    expect(mismatch.launched).toBe(false);
    if (!mismatch.launched) {
      expect(mismatch.blockers).toContain(`station:${ED_SLOT}:identity_mismatch:${ED_BUNDLE}`);
    }

    await expect(restarted.persist({
      examFormId: FORM_ID,
      pins: assembled.pins.map((pin, index) => index === 0
        ? { ...pin, contentIdentity: "cid_mutated" }
        : pin),
    })).rejects.toThrow("repersist cannot mutate immutable exam-form encounter-bundle pins");

    await expect(restarted.persist({
      examFormId: FORM_ID,
      pins: assembled.pins.map((pin, index) => index === 0
        ? { ...pin, scenarioVersion: 2 }
        : pin),
    })).rejects.toThrow("repersist cannot mutate immutable exam-form encounter-bundle pins");
  });
});

function twoStationBlueprint(): ExamBlueprint {
  return {
    blueprintId: "blueprint_two_archetype_v1",
    title: "Two archetype form",
    stationSlots: [
      {
        slotId: ED_SLOT,
        order: 1,
        label: "ED chest pain",
        requiredEnvironmentIds: [],
        requiredTraceTags: [],
      },
      {
        slotId: PEDS_SLOT,
        order: 2,
        label: "Peds asthma",
        requiredEnvironmentIds: [],
        requiredTraceTags: [],
      },
    ],
    timing: {
      doorwaySeconds: 60,
      encounterSeconds: 900,
      noteSeconds: 600,
      breakAfterStationOrders: [],
    },
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
}

function approvedScenario(scenarioId: string, title: string): Scenario {
  return {
    scenarioId,
    version: 1,
    title,
    status: "approved",
    review: {
      clinical: "approved",
      psychometric: "approved",
      legal: "approved",
      simulationQa: "approved",
    },
    clinicalObjectives: ["Recognize possible ACS"],
    actors: [],
    requiredTraceTags: [],
    eventSchedule: [],
    reviewRubric: [],
    governance: {
      scoreUseLabel: "formative_local_only",
      syntheticCaseDisclosure: "Synthetic repository-contract fixture.",
      validationStage: "stage_1_expert_reviewed",
      validationLimitations: ["Repository fixture only; no validity evidence."],
      requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
      sourceIds: ["src-test-fixture"],
      safetyCriticalTraceTags: [],
      hiddenFactPolicy: {
        learnerView: "redact_hidden_facts",
        disclosureRequiresTrigger: true,
      },
    },
  };
}

function edCatalog() {
  return {
    bundleId: ED_BUNDLE,
    scenarioId: ED_SCENARIO,
    stationId: ED_SLOT,
    contentIdentity: "cid_ed_chest_pain_v1",
    runtimeEligibility: "promoted" as const,
    frozenForEncounter: true,
    identityScope: "learner_runtime_opaque_bundle" as const,
  };
}

function pedsCatalog() {
  return {
    bundleId: PEDS_BUNDLE,
    scenarioId: PEDS_SCENARIO,
    stationId: PEDS_SLOT,
    contentIdentity: "cid_peds_asthma_v1",
    runtimeEligibility: "promoted" as const,
    frozenForEncounter: true,
    identityScope: "learner_runtime_opaque_bundle" as const,
  };
}
