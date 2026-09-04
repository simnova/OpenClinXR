import type {
  ExamStationBundlePinTarget,
  ExamStationEncounterBundlePin,
  PinExamStationEncounterBundlesInput,
  PinExamStationEncounterBundlesResult,
  PromotedEncounterBundleCatalogEntry,
} from "./types.js";
import {
  examStationEncounterBundlePinClaimScope,
  examStationEncounterBundlePinNotEvidenceFor,
} from "./types.js";

export function pinExamStationEncounterBundles(
  input: PinExamStationEncounterBundlesInput,
): PinExamStationEncounterBundlesResult {
  const examFormId = requireNonblank(input.examFormId, "examFormId");
  if (input.stations.length === 0) {
    return refuse(examFormId, ["stations:missing"]);
  }

  const blockers: string[] = [];
  const pins: ExamStationEncounterBundlePin[] = [];
  const usedBundleIds = new Set<string>();

  for (const station of input.stations) {
    const stationBlockers = inspectStation(station, input.catalog, usedBundleIds);
    if (stationBlockers.blockers.length > 0) {
      blockers.push(...stationBlockers.blockers);
      continue;
    }
    const pin = stationBlockers.pin;
    if (!pin) {
      blockers.push(`${stationPrefix(station)}:missing`);
      continue;
    }
    usedBundleIds.add(pin.bundleId);
    pins.push(pin);
  }

  if (blockers.length > 0) {
    return refuse(examFormId, blockers);
  }

  return {
    pinned: true,
    examFormId,
    pins,
    claimScope: examStationEncounterBundlePinClaimScope,
    notEvidenceFor: examStationEncounterBundlePinNotEvidenceFor,
  };
}

function inspectStation(
  station: ExamStationBundlePinTarget,
  catalog: readonly PromotedEncounterBundleCatalogEntry[],
  usedBundleIds: ReadonlySet<string>,
): { pin: ExamStationEncounterBundlePin | null; blockers: string[] } {
  const prefix = stationPrefix(station);
  const fieldBlockers = inspectStationFields(station);
  if (fieldBlockers.length > 0) {
    return { pin: null, blockers: fieldBlockers };
  }

  const identityMismatches = catalog.filter((entry) =>
    isIdentityMismatchForStation(station, entry),
  );
  if (identityMismatches.length > 0) {
    return {
      pin: null,
      blockers: identityMismatches.map((entry) =>
        `${prefix}:identity_mismatch:${entry.bundleId}`,
      ),
    };
  }

  const matching = catalog.filter((entry) =>
    entry.scenarioId === station.scenarioId && entry.stationId === station.slotId,
  );
  if (matching.length === 0) {
    return { pin: null, blockers: [`${prefix}:missing`] };
  }

  const ineligible = matching.flatMap((entry) => inspectCatalogEligibility(prefix, entry, station));
  if (ineligible.length > 0) {
    return { pin: null, blockers: ineligible };
  }

  const eligible = matching
    .filter((entry) => isEligibleForPin(entry, station) && !usedBundleIds.has(entry.bundleId))
    .slice()
    .sort((left, right) => left.bundleId.localeCompare(right.bundleId));
  const chosen = eligible[0];
  if (!chosen) {
    return { pin: null, blockers: [`${prefix}:missing`] };
  }

  return {
    pin: {
      stationOrder: station.stationOrder,
      slotId: station.slotId,
      scenarioId: station.scenarioId,
      scenarioVersion: station.scenarioVersion,
      bundleId: chosen.bundleId,
      contentIdentity: chosen.contentIdentity,
    },
    blockers: [],
  };
}

function inspectStationFields(station: ExamStationBundlePinTarget): string[] {
  const prefix = stationPrefix(station);
  const blockers: string[] = [];
  if (!Number.isInteger(station.stationOrder) || station.stationOrder < 1) {
    blockers.push(`${prefix}:invalid_station_order`);
  }
  if (station.slotId.trim().length === 0) {
    blockers.push(`${prefix}:blank_slot_id`);
  }
  if (station.scenarioId.trim().length === 0) {
    blockers.push(`${prefix}:blank_scenario_id`);
  }
  if (!Number.isInteger(station.scenarioVersion) || station.scenarioVersion < 1) {
    blockers.push(`${prefix}:invalid_scenario_version`);
  }
  return blockers;
}

function inspectCatalogEligibility(
  prefix: string,
  entry: PromotedEncounterBundleCatalogEntry,
  station: ExamStationBundlePinTarget,
): string[] {
  const blockers: string[] = [];
  if (entry.bundleId.trim().length === 0) {
    blockers.push(`${prefix}:blank_bundle_id`);
  }
  if (entry.contentIdentity.trim().length === 0) {
    blockers.push(`${prefix}:stale`);
  }
  if (entry.identityScope !== "learner_runtime_opaque_bundle") {
    blockers.push(`${prefix}:identity_mismatch:${entry.bundleId}`);
  }
  if (entry.frozenForEncounter !== true) {
    blockers.push(`${prefix}:stale`);
  }
  if (entry.runtimeEligibility === "blocked") {
    blockers.push(`${prefix}:blocked`);
  }
  if (entry.runtimeEligibility === "stale" || entry.runtimeEligibility === "retired") {
    blockers.push(`${prefix}:stale`);
  }
  if (entry.runtimeEligibility !== "promoted" && entry.runtimeEligibility !== "blocked") {
    blockers.push(`${prefix}:stale`);
  }
  if (
    station.authoredContentIdentity
    && entry.authoredContentIdentity
    && entry.authoredContentIdentity !== station.authoredContentIdentity
  ) {
    blockers.push(`${prefix}:identity_mismatch:${entry.bundleId}`);
  }
  if (
    station.scenarioRevisionId
    && entry.scenarioRevisionId
    && entry.scenarioRevisionId !== station.scenarioRevisionId
  ) {
    blockers.push(`${prefix}:identity_mismatch:${entry.bundleId}`);
  }
  return blockers;
}

function isEligibleForPin(
  entry: PromotedEncounterBundleCatalogEntry,
  station: ExamStationBundlePinTarget,
): boolean {
  return inspectCatalogEligibility(stationPrefix(station), entry, station).length === 0
    && entry.runtimeEligibility === "promoted"
    && entry.frozenForEncounter === true
    && entry.identityScope === "learner_runtime_opaque_bundle"
    && entry.scenarioId === station.scenarioId
    && entry.stationId === station.slotId;
}

function isIdentityMismatchForStation(
  station: ExamStationBundlePinTarget,
  entry: PromotedEncounterBundleCatalogEntry,
): boolean {
  return entry.stationId === station.slotId && entry.scenarioId !== station.scenarioId;
}

function stationPrefix(station: ExamStationBundlePinTarget): string {
  const slot = station.slotId.trim().length > 0 ? station.slotId : `order_${station.stationOrder}`;
  return `station:${slot}`;
}

function refuse(
  examFormId: string,
  blockers: string[],
): PinExamStationEncounterBundlesResult {
  return {
    pinned: false,
    examFormId,
    pins: [],
    blockers: [...new Set(blockers)],
    claimScope: examStationEncounterBundlePinClaimScope,
    notEvidenceFor: examStationEncounterBundlePinNotEvidenceFor,
  };
}

function requireNonblank(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}
