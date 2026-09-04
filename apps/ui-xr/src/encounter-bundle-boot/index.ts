import {
  evaluateEncounterRuntimeLearnerUseGate,
  type EncounterRuntimeAsset,
  type LearnerRuntimeAssetBundle,
} from "@openclinxr/asset-registry/runtime-bundles";
import {
  materializeLearnerStationFromBundle,
  type LearnerStationMaterialization,
} from "../learner-station-materialization/index.js";

export const encounterBundleBootNotEvidenceFor = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
] as const;

export const encounterBundleBootClaimBoundary =
  "pinned_encounter_bundle_boot_not_runtime_readiness" as const;

export type AssembledExamStationSelection = {
  stationId: string;
  scenarioId: string;
  /** Opaque bundle id pinned by the assembled exam. Required to boot a station. */
  pinnedBundleId: string | null;
  /**
   * Local scenario-name hint. Ignored whenever `pinnedBundleId` is present so a
   * same-named fixture cannot displace the pin.
   */
  localScenarioName?: string | null | undefined;
};

export type EncounterBundleBootClient = {
  getLearnerRuntimeAssetBundle(bundleId: string): Promise<LearnerRuntimeAssetBundle>;
  findLearnerRuntimeAssetBundleByScenarioStation?: (input: {
    scenarioId: string;
    stationId?: string | null | undefined;
  }) => Promise<unknown>;
};

export type EncounterBundleBootOutcome = "selected" | "refused" | "offline_fixture_fallback";

export type EncounterBundleBootEvidence = {
  schemaVersion: "openclinxr.encounter-bundle-boot.v1";
  stationId: string;
  scenarioId: string;
  pinnedBundleId: string | null;
  selectedBundleId: string | null;
  outcome: EncounterBundleBootOutcome;
  fallbackActive: boolean;
  fallbackReason: string | null;
  inferredFromLocalScenarioName: false;
  lookupPath: "pinned_bundle_id" | "offline_fixture" | "none";
  identityVerified: boolean;
  eligibilityVerified: boolean;
  blockers: string[];
  materialization: LearnerStationMaterialization | null;
  claimBoundary: typeof encounterBundleBootClaimBoundary;
  notEvidenceFor: typeof encounterBundleBootNotEvidenceFor;
};

export type BootPinnedEncounterStationsInput = {
  stations: readonly AssembledExamStationSelection[];
  client?: EncounterBundleBootClient | undefined;
  offlineFixtures?: Readonly<Record<string, LearnerRuntimeAssetBundle>> | undefined;
};

/**
 * Boot each assembled-exam station from its pinned opaque bundle id.
 * Never infers a bundle from a local scenario name when a pin exists.
 */
export async function bootPinnedEncounterStations(
  input: BootPinnedEncounterStationsInput,
): Promise<EncounterBundleBootEvidence[]> {
  const evidence: EncounterBundleBootEvidence[] = [];
  for (const station of input.stations) {
    evidence.push((await bootOneStation(station, input.client, input.offlineFixtures)).evidence);
  }
  return evidence;
}

const DEFAULT_LOCAL_BUNDLE_SENTINEL = "ed_chest_pain_local_encounter";

/**
 * Assembled-exam pin from launch URL / stored opaque id / station field.
 * The local default sentinel is not a pin and must not block fail-closed refusal.
 */
export function resolveAssembledExamPinnedBundleId(input: {
  queryRuntimeAssetBundleId?: string | null | undefined;
  storedRuntimeAssetBundleId?: string | null | undefined;
  stationPinnedBundleId?: string | null | undefined;
}): string | null {
  const station = input.stationPinnedBundleId?.trim() ?? "";
  if (station.length > 0) return station;
  const query = input.queryRuntimeAssetBundleId?.trim() ?? "";
  if (query.length > 0) return query;
  const stored = input.storedRuntimeAssetBundleId?.trim() ?? "";
  if (stored.length > 0 && stored !== DEFAULT_LOCAL_BUNDLE_SENTINEL) return stored;
  return null;
}

export type PinnedEncounterBundleRuntimeTrace = {
  source: "assembled_exam_pinned_bundle_boot";
  outcome: EncounterBundleBootOutcome;
  pinnedBundleId: string | null;
  selectedBundleId: string | null;
  inferredFromLocalScenarioName: false;
  identityVerified: boolean;
  eligibilityVerified: boolean;
  fallbackActive: boolean;
  fallbackReason: string | null;
  blockers: string[];
  mounted: boolean;
  claimBoundary: typeof encounterBundleBootClaimBoundary;
  notEvidenceFor: typeof encounterBundleBootNotEvidenceFor;
};

export type LearnerRuntimeAssembledExamBootResult = {
  evidence: EncounterBundleBootEvidence;
  bundle: LearnerRuntimeAssetBundle | null;
  runtimeTrace: PinnedEncounterBundleRuntimeTrace;
};

/**
 * Learner-runtime composition: boot the assembled-exam station from its pin.
 * Callers must not follow this with scenario-name inference when a pin exists.
 */
export async function bootLearnerRuntimeFromAssembledExam(input: {
  station: AssembledExamStationSelection;
  client?: EncounterBundleBootClient | undefined;
  offlineFixtures?: Readonly<Record<string, LearnerRuntimeAssetBundle>> | undefined;
}): Promise<LearnerRuntimeAssembledExamBootResult> {
  const { evidence, bundle } = await bootOneStation(
    input.station,
    input.client,
    input.offlineFixtures,
  );
  const mounted = bundle !== null && evidence.materialization !== null;
  const runtimeTrace: PinnedEncounterBundleRuntimeTrace = {
    source: "assembled_exam_pinned_bundle_boot",
    outcome: evidence.outcome,
    pinnedBundleId: evidence.pinnedBundleId,
    selectedBundleId: evidence.selectedBundleId,
    inferredFromLocalScenarioName: false,
    identityVerified: evidence.identityVerified,
    eligibilityVerified: evidence.eligibilityVerified,
    fallbackActive: evidence.fallbackActive,
    fallbackReason: evidence.fallbackReason,
    blockers: [...evidence.blockers],
    mounted,
    claimBoundary: evidence.claimBoundary,
    notEvidenceFor: evidence.notEvidenceFor,
  };
  return { evidence, bundle: mounted ? bundle : null, runtimeTrace };
}

async function bootOneStation(
  station: AssembledExamStationSelection,
  client: EncounterBundleBootClient | undefined,
  offlineFixtures: Readonly<Record<string, LearnerRuntimeAssetBundle>> | undefined,
): Promise<{ evidence: EncounterBundleBootEvidence; bundle: LearnerRuntimeAssetBundle | null }> {
  const pin = station.pinnedBundleId?.trim() || null;
  if (!pin) {
    return {
      evidence: evidenceFor(station, {
        outcome: "refused",
        lookupPath: "none",
        blockers: ["pinned_bundle_identity_missing"],
        fallbackReason: "assembled exam station has no pinned encounter bundle id",
      }),
      bundle: null,
    };
  }

  let bundle: LearnerRuntimeAssetBundle | null = null;
  let lookupPath: EncounterBundleBootEvidence["lookupPath"] = "pinned_bundle_id";
  let fetchFailure: string | null = null;

  if (client) {
    try {
      bundle = await client.getLearnerRuntimeAssetBundle(pin);
    } catch (error) {
      fetchFailure = error instanceof Error && error.message.length > 0
        ? error.message
        : "pinned_bundle_fetch_failed";
    }
  } else {
    fetchFailure = "api_client_absent";
  }

  if (!bundle) {
    const fixture = offlineFixtures?.[pin];
    if (fixture) {
      bundle = fixture;
      lookupPath = "offline_fixture";
    }
  }

  if (!bundle) {
    return {
      evidence: evidenceFor(station, {
        outcome: "refused",
        lookupPath: client ? "pinned_bundle_id" : "none",
        blockers: [fetchFailure ?? "pinned_bundle_unavailable"],
        fallbackReason: fetchFailure ?? "pinned_bundle_unavailable",
      }),
      bundle: null,
    };
  }

  const identityBlockers = inspectPinnedBundleIdentity(bundle, station, pin);
  if (identityBlockers.length > 0) {
    return {
      evidence: evidenceFor(station, {
        outcome: "refused",
        lookupPath,
        selectedBundleId: bundle.bundleId,
        blockers: identityBlockers,
        fallbackReason: identityBlockers[0] ?? "identity_mismatch",
      }),
      bundle: null,
    };
  }

  const eligibilityBlockers = inspectBundleEligibility(bundle);
  if (eligibilityBlockers.length > 0) {
    return {
      evidence: evidenceFor(station, {
        outcome: "refused",
        lookupPath,
        selectedBundleId: bundle.bundleId,
        identityVerified: true,
        blockers: eligibilityBlockers,
        fallbackReason: eligibilityBlockers[0] ?? "eligibility_blocked",
      }),
      bundle: null,
    };
  }

  const outcome: EncounterBundleBootOutcome = lookupPath === "offline_fixture"
    ? "offline_fixture_fallback"
    : "selected";
  return {
    evidence: evidenceFor(station, {
      outcome,
      lookupPath,
      selectedBundleId: bundle.bundleId,
      identityVerified: true,
      eligibilityVerified: true,
      fallbackActive: outcome === "offline_fixture_fallback",
      fallbackReason: lookupPath === "offline_fixture"
        ? (fetchFailure ?? "offline_fixture_fallback")
        : null,
      materialization: materializeLearnerStationFromBundle(bundle),
    }),
    bundle,
  };
}

export function inspectPinnedBundleIdentity(
  bundle: LearnerRuntimeAssetBundle,
  station: AssembledExamStationSelection,
  pinnedBundleId: string,
): string[] {
  const blockers: string[] = [];
  if (bundle.identityScope !== "learner_runtime_opaque_bundle") {
    blockers.push("identity_scope_mismatch");
  }
  if (bundle.bundleId !== pinnedBundleId) {
    blockers.push("pinned_bundle_id_mismatch");
  }
  if (bundle.stationId !== station.stationId) {
    blockers.push("station_id_mismatch");
  }
  if (bundle.scenarioId !== station.scenarioId) {
    blockers.push("scenario_id_mismatch");
  }
  return blockers;
}

export function inspectBundleEligibility(bundle: LearnerRuntimeAssetBundle): string[] {
  if (bundleUsesOnlyApprovedLocalFixtureAssets(bundle)) {
    return [];
  }
  const gate = evaluateEncounterRuntimeLearnerUseGate(bundle);
  if (gate.canUseGeneratedBundleForLearnerRuntime) {
    return [];
  }
  return gate.blockers.length > 0 ? [...gate.blockers] : ["learner_runtime_use_blocked"];
}

function bundleUsesOnlyApprovedLocalFixtureAssets(bundle: LearnerRuntimeAssetBundle): boolean {
  return runtimeBundleAssets(bundle).every((asset) =>
    asset.blob.storeKind === "app_public_fixture"
      && asset.reviewStatus !== "blocked"
      && (asset.reviewStatus === "fixture_approved_for_local_runtime"
        || asset.reviewStatus === "approved_for_local_runtime"),
  );
}

function runtimeBundleAssets(bundle: LearnerRuntimeAssetBundle): EncounterRuntimeAsset[] {
  return [
    bundle.environment,
    ...bundle.actors.map((actor) => actor.model),
    ...bundle.actors.flatMap((actor) => actor.animationClips),
    ...bundle.actors
      .map((actor) => actor.phonemeMap)
      .filter((asset): asset is EncounterRuntimeAsset => Boolean(asset)),
    ...bundle.equipment.map((equipment) => equipment.model),
  ];
}

function evidenceFor(
  station: AssembledExamStationSelection,
  patch: {
    outcome: EncounterBundleBootOutcome;
    lookupPath: EncounterBundleBootEvidence["lookupPath"];
    selectedBundleId?: string | null;
    identityVerified?: boolean;
    eligibilityVerified?: boolean;
    blockers?: string[];
    fallbackActive?: boolean;
    fallbackReason: string | null;
    materialization?: LearnerStationMaterialization | null;
  },
): EncounterBundleBootEvidence {
  const fallbackActive = patch.fallbackActive
    ?? (patch.outcome === "offline_fixture_fallback" || patch.outcome === "refused");
  return {
    schemaVersion: "openclinxr.encounter-bundle-boot.v1",
    stationId: station.stationId,
    scenarioId: station.scenarioId,
    pinnedBundleId: station.pinnedBundleId,
    selectedBundleId: patch.selectedBundleId ?? null,
    outcome: patch.outcome,
    fallbackActive,
    fallbackReason: patch.fallbackReason,
    inferredFromLocalScenarioName: false,
    lookupPath: patch.lookupPath,
    identityVerified: patch.identityVerified === true,
    eligibilityVerified: patch.eligibilityVerified === true,
    blockers: [...(patch.blockers ?? [])],
    materialization: patch.materialization ?? null,
    claimBoundary: encounterBundleBootClaimBoundary,
    notEvidenceFor: encounterBundleBootNotEvidenceFor,
  };
}
