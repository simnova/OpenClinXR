import { describe, expect, it } from "vitest";
import {
  createDurableExamFormEncounterBundlePins,
  MemoryExamFormEncounterBundlePinStore,
} from "./durable-pins.js";
import type { DurablePromotedEncounterBundleLookupEntry } from "./types.js";

const ED_SCENARIO = "ed_chest_pain_priority_v1";
const PEDS_SCENARIO = "peds_asthma_parent_anxiety_v1";
const ED_SLOT = "station_001_ed_chest_pain_priority_v1";
const PEDS_SLOT = "station_002_peds_asthma_parent_anxiety_v1";
const ED_BUNDLE = "bdl_ed_chest_pain_opaque_v1";
const PEDS_BUNDLE = "bdl_peds_asthma_opaque_v1";

describe("durable exam-form encounter-bundle pins", () => {
  it("persists one opaque pin per station and relaunches the same assets after process restart", () => {
    const live = new MemoryExamFormEncounterBundlePinStore();
    const persisted = live.persist({
      examFormId: "form_two_archetype_pilot",
      pins: [edPin(), pedsPin()],
    });
    expect(persisted.pins.map((pin) => pin.bundleId)).toEqual([ED_BUNDLE, PEDS_BUNDLE]);
    expect(persisted.durableStore).toBe("database_source_of_truth");

    const restarted = MemoryExamFormEncounterBundlePinStore.restore(JSON.parse(JSON.stringify(live.dump())));
    const catalog = [edCatalog(), pedsCatalog()];
    const edLaunch = restarted.launchPinnedStationAssets({
      examFormId: "form_two_archetype_pilot",
      slotId: ED_SLOT,
      catalog,
    });
    const pedsLaunch = restarted.launchPinnedStationAssets({
      examFormId: "form_two_archetype_pilot",
      slotId: PEDS_SLOT,
      catalog,
    });

    expect(edLaunch.launched).toBe(true);
    expect(pedsLaunch.launched).toBe(true);
    if (edLaunch.launched && pedsLaunch.launched) {
      expect(edLaunch.bundleId).toBe(ED_BUNDLE);
      expect(edLaunch.contentIdentity).toBe("cid_ed_chest_pain_v1");
      expect(edLaunch.scenarioId).toBe(ED_SCENARIO);
      expect(pedsLaunch.bundleId).toBe(PEDS_BUNDLE);
      expect(pedsLaunch.scenarioId).toBe(PEDS_SCENARIO);
      expect(edLaunch.bundleId).not.toBe(pedsLaunch.bundleId);
    }
  });

  it("fails closed on stale, blocked, missing, and identity-mismatched catalog rows after reload", () => {
    const live = new MemoryExamFormEncounterBundlePinStore();
    live.persist({
      examFormId: "form_two_archetype_pilot",
      pins: [edPin(), pedsPin()],
    });
    const restarted = MemoryExamFormEncounterBundlePinStore.restore(live.dump());

    const stale = restarted.launchPinnedStationAssets({
      examFormId: "form_two_archetype_pilot",
      slotId: ED_SLOT,
      catalog: [{ ...edCatalog(), contentIdentity: "cid_other" }],
    });
    expect(stale.launched).toBe(false);
    if (!stale.launched) {
      expect(stale.blockers).toContain(`station:${ED_SLOT}:stale`);
    }

    const blocked = restarted.launchPinnedStationAssets({
      examFormId: "form_two_archetype_pilot",
      slotId: ED_SLOT,
      catalog: [{ ...edCatalog(), runtimeEligibility: "blocked" }],
    });
    expect(blocked.launched).toBe(false);
    if (!blocked.launched) {
      expect(blocked.blockers).toContain(`station:${ED_SLOT}:blocked`);
    }

    const missing = restarted.launchPinnedStationAssets({
      examFormId: "form_two_archetype_pilot",
      slotId: ED_SLOT,
      catalog: [pedsCatalog()],
    });
    expect(missing.launched).toBe(false);
    if (!missing.launched) {
      expect(missing.blockers).toContain(`station:${ED_SLOT}:missing`);
    }

    const mismatch = restarted.launchPinnedStationAssets({
      examFormId: "form_two_archetype_pilot",
      slotId: ED_SLOT,
      catalog: [{ ...edCatalog(), scenarioId: PEDS_SCENARIO }],
    });
    expect(mismatch.launched).toBe(false);
    if (!mismatch.launched) {
      expect(mismatch.blockers).toContain(`station:${ED_SLOT}:identity_mismatch:${ED_BUNDLE}`);
    }
  });

  it("freezes persisted pins so later mutation cannot change the relaunch identity", () => {
    const record = createDurableExamFormEncounterBundlePins({
      examFormId: "form_immutable",
      pins: [edPin()],
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.pins)).toBe(true);
    expect(Object.isFrozen(record.pins[0])).toBe(true);
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
