import { describe, expect, it } from "vitest";
import { pinExamStationEncounterBundles } from "./pin-station-bundles.js";
import type {
  ExamStationBundlePinTarget,
  PromotedEncounterBundleCatalogEntry,
} from "./types.js";

const ED_SCENARIO = "ed_chest_pain_priority_v1";
const PEDS_SCENARIO = "peds_asthma_parent_anxiety_v1";
const ED_SLOT = "station_001_ed_chest_pain_priority_v1";
const PEDS_SLOT = "station_002_peds_asthma_parent_anxiety_v1";
const ED_BUNDLE = "bdl_ed_chest_pain_opaque_v1";
const PEDS_BUNDLE = "bdl_peds_asthma_opaque_v1";

describe("pinExamStationEncounterBundles", () => {
  it("pins one opaque promoted bundle per station for two distinct clinical archetypes", () => {
    const result = pinExamStationEncounterBundles({
      examFormId: "form_two_archetype_pilot",
      stations: [edStation(), pedsStation()],
      catalog: [edCatalog(), pedsCatalog()],
    });

    expect(result.pinned).toBe(true);
    if (!result.pinned) {
      throw new Error(result.blockers.join(", "));
    }
    expect(result.pins).toHaveLength(2);
    expect(result.pins[0]).toMatchObject({
      slotId: ED_SLOT,
      scenarioId: ED_SCENARIO,
      bundleId: ED_BUNDLE,
      contentIdentity: "cid_ed_chest_pain_v1",
    });
    expect(result.pins[1]).toMatchObject({
      slotId: PEDS_SLOT,
      scenarioId: PEDS_SCENARIO,
      bundleId: PEDS_BUNDLE,
      contentIdentity: "cid_peds_asthma_v1",
    });
    expect(result.pins[0]?.bundleId).not.toBe(result.pins[1]?.bundleId);
    expect(result.pins.map((pin) => pin.bundleId).join(" ")).not.toMatch(/fixture|local_exam_run/u);
    expect(result.notEvidenceFor).toContain("exam_equivalence");
  });

  it("pins exactly one bundle when multiple eligible rows exist for a station", () => {
    const extra = {
      ...edCatalog(),
      bundleId: "bdl_ed_chest_pain_opaque_v0",
      contentIdentity: "cid_ed_chest_pain_v0",
    };
    const result = pinExamStationEncounterBundles({
      examFormId: "form_one_pin",
      stations: [edStation()],
      catalog: [edCatalog(), extra],
    });
    expect(result.pinned).toBe(true);
    if (result.pinned) {
      expect(result.pins).toHaveLength(1);
      expect(result.pins[0]?.bundleId).toBe("bdl_ed_chest_pain_opaque_v0");
    }
  });

  it("refuses stale, blocked, missing, and scenario/station identity mismatch without fixture inference", () => {
    const stale = pinExamStationEncounterBundles({
      examFormId: "form_stale",
      stations: [edStation()],
      catalog: [{ ...edCatalog(), runtimeEligibility: "stale" }],
    });
    expect(stale.pinned).toBe(false);
    if (!stale.pinned) {
      expect(stale.blockers).toContain(`station:${ED_SLOT}:stale`);
      expect(stale.pins).toEqual([]);
    }

    const blocked = pinExamStationEncounterBundles({
      examFormId: "form_blocked",
      stations: [edStation()],
      catalog: [{ ...edCatalog(), runtimeEligibility: "blocked" }],
    });
    expect(blocked.pinned).toBe(false);
    if (!blocked.pinned) {
      expect(blocked.blockers).toContain(`station:${ED_SLOT}:blocked`);
    }

    const missing = pinExamStationEncounterBundles({
      examFormId: "form_missing",
      stations: [edStation()],
      catalog: [pedsCatalog()],
    });
    expect(missing.pinned).toBe(false);
    if (!missing.pinned) {
      expect(missing.blockers).toContain(`station:${ED_SLOT}:missing`);
    }

    const mismatch = pinExamStationEncounterBundles({
      examFormId: "form_mismatch",
      stations: [edStation()],
      catalog: [{ ...edCatalog(), scenarioId: PEDS_SCENARIO }],
    });
    expect(mismatch.pinned).toBe(false);
    if (!mismatch.pinned) {
      expect(mismatch.blockers).toContain(`station:${ED_SLOT}:identity_mismatch:${ED_BUNDLE}`);
    }
  });
});

function edStation(): ExamStationBundlePinTarget {
  return {
    stationOrder: 1,
    slotId: ED_SLOT,
    scenarioId: ED_SCENARIO,
    scenarioVersion: 1,
  };
}

function pedsStation(): ExamStationBundlePinTarget {
  return {
    stationOrder: 2,
    slotId: PEDS_SLOT,
    scenarioId: PEDS_SCENARIO,
    scenarioVersion: 1,
  };
}

function edCatalog(): PromotedEncounterBundleCatalogEntry {
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

function pedsCatalog(): PromotedEncounterBundleCatalogEntry {
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
