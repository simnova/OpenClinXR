import {
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  type EncounterRuntimeAsset,
  type LearnerRuntimeAssetBundle,
} from "@openclinxr/asset-registry/runtime-bundles";
import { describe, expect, it } from "vitest";
import {
  bootPinnedEncounterStations,
  type EncounterBundleBootClient,
} from "./encounter-bundle-boot/index.js";

/**
 * PLANTED CONTRACT — learner station boot uses the assembled-exam pinned bundle id.
 *
 * Today `initializeLearnerRuntimeAssetBundle` (`main.ts`) can recover by
 * `findLearnerRuntimeAssetBundleByScenarioStation`, which infers from local scenario/station
 * names. When an assembled exam pins an opaque bundle, that inference is forbidden: a
 * same-named decoy must not be selected, identity and eligibility must be checked before
 * any member is mounted, and offline fixture use must carry an explicit fallback reason.
 *
 * Two station archetypes (ED chest pain, peds asthma) must both materialize actor, room,
 * equipment, motion, voice, and interaction entries from their own pins.
 */

const ED_PIN = "local_exam_run:ed_chest_pain_local_encounter:runtime-assets";
const PEDS_PIN = "local_exam_run:peds_asthma_local_encounter:runtime-assets";
const DECOY_PIN = "local_exam_run:decoy_same_scenario_name:runtime-assets";

describe("the pinned encounter bundle boots each station", () => {
  it("boots two station archetypes from pinned ids and never infers from local scenario names", async () => {
    const ed = withStationMembers(createEdChestPainLocalLearnerRuntimeAssetBundle(), {
      clipId: "ed_patient_idle_clip",
      phonemeId: "ed_patient_phoneme_map",
      surfaceId: "ed_vitals_panel",
    });
    const peds = withStationMembers(createEdChestPainLocalLearnerRuntimeAssetBundle({
      encounterId: "peds_asthma_local_encounter",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      stationId: "peds_asthma_parent_anxiety_station_v1",
    }), {
      clipId: "peds_patient_idle_clip",
      phonemeId: "peds_patient_phoneme_map",
      surfaceId: "peds_parent_prompt_panel",
      actorId: "patient_maya_johnson_v1",
    });
    const decoy = createEdChestPainLocalLearnerRuntimeAssetBundle({
      encounterId: "decoy_same_scenario_name",
    });

    const fetchedIds: string[] = [];
    const client: EncounterBundleBootClient = {
      getLearnerRuntimeAssetBundle: async (bundleId) => {
        fetchedIds.push(bundleId);
        if (bundleId === ed.bundleId) return ed;
        if (bundleId === peds.bundleId) return peds;
        if (bundleId === decoy.bundleId) return decoy;
        throw new Error(`unexpected bundle ${bundleId}`);
      },
      findLearnerRuntimeAssetBundleByScenarioStation: async () => {
        throw new Error("scenario-name inference is forbidden when a pinned bundle exists");
      },
    };

    const evidence = await bootPinnedEncounterStations({
      stations: [
        {
          stationId: "ed_chest_pain_station_v1",
          scenarioId: "ed_chest_pain_priority_v1",
          pinnedBundleId: ED_PIN,
          localScenarioName: "peds_asthma_parent_anxiety_v1",
        },
        {
          stationId: "peds_asthma_parent_anxiety_station_v1",
          scenarioId: "peds_asthma_parent_anxiety_v1",
          pinnedBundleId: PEDS_PIN,
          localScenarioName: "ed_chest_pain_priority_v1",
        },
      ],
      client,
    });

    expect(fetchedIds).toEqual([ED_PIN, PEDS_PIN]);
    expect(fetchedIds).not.toContain(DECOY_PIN);
    expect(evidence).toHaveLength(2);
    expect(evidence.every((row) => row.inferredFromLocalScenarioName === false)).toBe(true);
    expect(evidence.every((row) => row.lookupPath === "pinned_bundle_id")).toBe(true);
    expect(evidence.map((row) => row.outcome)).toEqual(["selected", "selected"]);
    expect(evidence.map((row) => row.selectedBundleId)).toEqual([ED_PIN, PEDS_PIN]);
    expect(evidence.every((row) => row.identityVerified && row.eligibilityVerified)).toBe(true);
    expect(evidence.every((row) => row.fallbackActive === false)).toBe(true);
    expect(evidence.every((row) => row.materialization !== null)).toBe(true);

    const [edMat, pedsMat] = [evidence[0]!.materialization!, evidence[1]!.materialization!];
    expect(edMat.actors.length).toBeGreaterThan(0);
    expect(edMat.rooms).toEqual([expect.objectContaining({ kind: "room" })]);
    expect(edMat.equipment.length).toBeGreaterThan(0);
    expect(edMat.motion.map((member) => member.id)).toContain("ed_patient_idle_clip");
    expect(edMat.voice.map((member) => member.id)).toContain("ed_patient_phoneme_map");
    expect(edMat.interactions.map((member) => member.id)).toContain("ed_vitals_panel");

    expect(pedsMat.actors[0]?.id).toBe("patient_maya_johnson_v1");
    expect(pedsMat.rooms.length).toBe(1);
    expect(pedsMat.equipment.length).toBeGreaterThan(0);
    expect(pedsMat.motion.map((member) => member.id)).toContain("peds_patient_idle_clip");
    expect(pedsMat.voice.map((member) => member.id)).toContain("peds_patient_phoneme_map");
    expect(pedsMat.interactions.map((member) => member.id)).toContain("peds_parent_prompt_panel");
    expect(edMat.bundleId).not.toBe(pedsMat.bundleId);
  });

  it("refuses a pinned fetch that fails identity or eligibility before mounting assets", async () => {
    const mismatched = createEdChestPainLocalLearnerRuntimeAssetBundle({
      stationId: "wrong_station",
    });
    const blocked = createEdChestPainLocalLearnerRuntimeAssetBundle({
      encounterId: "ed_chest_pain_blocked_encounter",
    });
    blocked.environment.reviewStatus = "blocked";

    const client: EncounterBundleBootClient = {
      getLearnerRuntimeAssetBundle: async (bundleId) => {
        if (bundleId === mismatched.bundleId) return mismatched;
        if (bundleId === blocked.bundleId) return blocked;
        throw new Error(`unexpected ${bundleId}`);
      },
      findLearnerRuntimeAssetBundleByScenarioStation: async () => {
        throw new Error("scenario-name inference is forbidden when a pinned bundle exists");
      },
    };

    const [identity, eligibility, missingPin] = await bootPinnedEncounterStations({
      stations: [
        {
          stationId: "ed_chest_pain_station_v1",
          scenarioId: "ed_chest_pain_priority_v1",
          pinnedBundleId: ED_PIN,
        },
        {
          stationId: "ed_chest_pain_station_v1",
          scenarioId: "ed_chest_pain_priority_v1",
          pinnedBundleId: blocked.bundleId,
        },
        {
          stationId: "ed_chest_pain_station_v1",
          scenarioId: "ed_chest_pain_priority_v1",
          pinnedBundleId: null,
          localScenarioName: "ed_chest_pain_priority_v1",
        },
      ],
      client,
    });

    expect(identity?.outcome).toBe("refused");
    expect(identity?.blockers).toContain("station_id_mismatch");
    expect(identity?.materialization).toBeNull();
    expect(identity?.inferredFromLocalScenarioName).toBe(false);

    expect(eligibility?.outcome).toBe("refused");
    expect(eligibility?.identityVerified).toBe(true);
    expect(eligibility?.eligibilityVerified).toBe(false);
    expect(eligibility?.materialization).toBeNull();

    expect(missingPin?.outcome).toBe("refused");
    expect(missingPin?.blockers).toContain("pinned_bundle_identity_missing");
    expect(missingPin?.materialization).toBeNull();
  });

  it("records documented offline fixture fallback instead of silently using a local scenario name", async () => {
    const fixture = withStationMembers(createEdChestPainLocalLearnerRuntimeAssetBundle(), {
      clipId: "offline_idle_clip",
      phonemeId: "offline_phoneme_map",
      surfaceId: "offline_chart_panel",
    });

    const evidence = await bootPinnedEncounterStations({
      stations: [
        {
          stationId: "ed_chest_pain_station_v1",
          scenarioId: "ed_chest_pain_priority_v1",
          pinnedBundleId: ED_PIN,
          localScenarioName: "peds_asthma_parent_anxiety_v1",
        },
      ],
      offlineFixtures: { [ED_PIN]: fixture },
    });

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.outcome).toBe("offline_fixture_fallback");
    expect(evidence[0]?.fallbackActive).toBe(true);
    expect(evidence[0]?.fallbackReason).toBe("api_client_absent");
    expect(evidence[0]?.lookupPath).toBe("offline_fixture");
    expect(evidence[0]?.inferredFromLocalScenarioName).toBe(false);
    expect(evidence[0]?.selectedBundleId).toBe(ED_PIN);
    expect(evidence[0]?.materialization?.motion.map((member) => member.id)).toContain("offline_idle_clip");
  });
});

function withStationMembers(
  bundle: LearnerRuntimeAssetBundle,
  extras: { clipId: string; phonemeId: string; surfaceId: string; actorId?: string },
): LearnerRuntimeAssetBundle {
  const [first, ...rest] = bundle.actors;
  if (!first) {
    throw new Error("fixture bundle has no actors");
  }
  const clip = deriveAsset(first.model, extras.clipId, "animation_clip");
  const phoneme = deriveAsset(first.model, extras.phonemeId, "phoneme_map");
  const schema = deriveAsset(first.model, `${extras.surfaceId}_schema`, "ui_schema");
  const actors = [
    {
      ...first,
      actorId: extras.actorId ?? first.actorId,
      animationClips: [clip],
      phonemeMap: phoneme,
    },
    ...rest,
  ];
  return {
    ...bundle,
    actors,
    uiSurfaces: [
      {
        surfaceId: extras.surfaceId,
        renderer: "schema_panel",
        schema,
      },
    ],
  };
}

function deriveAsset(
  source: EncounterRuntimeAsset,
  assetId: string,
  kind: EncounterRuntimeAsset["kind"],
): EncounterRuntimeAsset {
  return {
    ...source,
    assetId,
    kind,
    displayName: assetId,
    scenarioAssetId: assetId,
  };
}
