import { describe, expect, it } from "vitest";
import {
  createDurableExamFormEncounterBundlePins,
  LocalTestExamFormEncounterBundlePinStore,
} from "./durable-pins.js";
import type { DurablePromotedEncounterBundleLookupEntry } from "./types.js";

const ED_SCENARIO = "ed_chest_pain_priority_v1";
const PEDS_SCENARIO = "peds_asthma_parent_anxiety_v1";
const ED_SLOT = "station_001_ed_chest_pain_priority_v1";
const PEDS_SLOT = "station_002_peds_asthma_parent_anxiety_v1";
const ED_BUNDLE = "bdl_ed_chest_pain_opaque_v1";
const PEDS_BUNDLE = "bdl_peds_asthma_opaque_v1";

describe("local test exam-form encounter-bundle pin store", () => {
  it("persists pins as test_local_memory and never as database_source_of_truth", async () => {
    const store = new LocalTestExamFormEncounterBundlePinStore();
    const persisted = await store.persist({
      examFormId: "form_two_archetype_pilot",
      pins: [edPin(), pedsPin()],
    });
    expect(store.backend).toBe("test_local_memory");
    expect(store.durableStore).toBe("test_local_memory");
    expect(persisted.durableStore).toBe("test_local_memory");
    expect(persisted.pins.every((pin) => pin.durableStore === "test_local_memory")).toBe(true);
    expect(persisted.pins.map((pin) => pin.bundleId)).toEqual([ED_BUNDLE, PEDS_BUNDLE]);
  });

  it("fails closed on stale, blocked, missing, and identity-mismatched catalog rows", async () => {
    const store = new LocalTestExamFormEncounterBundlePinStore();
    await store.persist({
      examFormId: "form_two_archetype_pilot",
      pins: [edPin(), pedsPin()],
    });

    const stale = await store.launchPinnedStationAssets({
      examFormId: "form_two_archetype_pilot",
      slotId: ED_SLOT,
      catalog: [{ ...edCatalog(), contentIdentity: "cid_other" }],
    });
    expect(stale.launched).toBe(false);
    if (!stale.launched) {
      expect(stale.blockers).toContain(`station:${ED_SLOT}:stale`);
    }

    const blocked = await store.launchPinnedStationAssets({
      examFormId: "form_two_archetype_pilot",
      slotId: ED_SLOT,
      catalog: [{ ...edCatalog(), runtimeEligibility: "blocked" }],
    });
    expect(blocked.launched).toBe(false);
    if (!blocked.launched) {
      expect(blocked.blockers).toContain(`station:${ED_SLOT}:blocked`);
    }

    const missing = await store.launchPinnedStationAssets({
      examFormId: "form_two_archetype_pilot",
      slotId: ED_SLOT,
      catalog: [pedsCatalog()],
    });
    expect(missing.launched).toBe(false);
    if (!missing.launched) {
      expect(missing.blockers).toContain(`station:${ED_SLOT}:missing`);
    }

    const mismatch = await store.launchPinnedStationAssets({
      examFormId: "form_two_archetype_pilot",
      slotId: ED_SLOT,
      catalog: [{ ...edCatalog(), scenarioId: PEDS_SCENARIO }],
    });
    expect(mismatch.launched).toBe(false);
    if (!mismatch.launched) {
      expect(mismatch.blockers).toContain(`station:${ED_SLOT}:identity_mismatch:${ED_BUNDLE}`);
    }
  });

  it("freezes created pins so later mutation cannot change identity", () => {
    const record = createDurableExamFormEncounterBundlePins({
      examFormId: "form_immutable",
      pins: [edPin()],
    }, "test_local_memory");
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.pins)).toBe(true);
    expect(Object.isFrozen(record.pins[0])).toBe(true);
    expect(record.durableStore).toBe("test_local_memory");
  });
});

function edPin() {
  return {
    stationOrder: 1,
    slotId: ED_SLOT,
    scenarioId: ED_SCENARIO,
    scenarioVersion: 1,
    bundleId: ED_BUNDLE,
    contentIdentity: "cid_ed_chest_pain_v1",
  };
}

function pedsPin() {
  return {
    stationOrder: 2,
    slotId: PEDS_SLOT,
    scenarioId: PEDS_SCENARIO,
    scenarioVersion: 1,
    bundleId: PEDS_BUNDLE,
    contentIdentity: "cid_peds_asthma_v1",
  };
}

function edCatalog(): DurablePromotedEncounterBundleLookupEntry {
  return {
    bundleId: ED_BUNDLE,
    scenarioId: ED_SCENARIO,
    stationId: ED_SLOT,
    contentIdentity: "cid_ed_chest_pain_v1",
    runtimeEligibility: "promoted",
    frozenForEncounter: true,
    identityScope: "learner_runtime_opaque_bundle",
  };
}

function pedsCatalog(): DurablePromotedEncounterBundleLookupEntry {
  return {
    bundleId: PEDS_BUNDLE,
    scenarioId: PEDS_SCENARIO,
    stationId: PEDS_SLOT,
    contentIdentity: "cid_peds_asthma_v1",
    runtimeEligibility: "promoted",
    frozenForEncounter: true,
    identityScope: "learner_runtime_opaque_bundle",
  };
}
