import type {
  AssembledExamStationEvidenceInput,
  AssembledExamStationReviewSlice,
  BuildAssembledExamReviewPacketInput,
} from "../assembled-exam-review-packet.js";

export type EncounterBundlePin = {
  bundleId: string;
  contentIdentity: string;
  scenarioId: string;
};

export function indexEncounterBundlePins(
  input: BuildAssembledExamReviewPacketInput,
): ReadonlyMap<number, EncounterBundlePin> {
  const pins = input.encounterBundlePins ?? [];
  const byStationOrder = new Map<number, EncounterBundlePin>();
  for (const pin of pins) {
    if (!isPositiveInteger(pin.stationOrder) || byStationOrder.has(pin.stationOrder)) {
      fail("requires positive unique integer stationOrder");
    }
    if (pin.bundleId.trim().length === 0 || pin.contentIdentity.trim().length === 0) {
      fail("rejects substituted or missing encounter bundle");
    }
    byStationOrder.set(pin.stationOrder, {
      bundleId: pin.bundleId,
      contentIdentity: pin.contentIdentity,
      scenarioId: pin.scenarioId,
    });
  }
  return byStationOrder;
}

export function bindStationEncounterBundle(
  station: AssembledExamStationEvidenceInput,
  bundlePins: ReadonlyMap<number, EncounterBundlePin>,
): AssembledExamStationReviewSlice["encounterBundle"] {
  const pinned = bundlePins.get(station.stationOrder);
  const runtimeBundleId = station.encounterBundle?.bundleId ?? null;
  const runtimeContentIdentity = station.encounterBundle?.contentIdentity ?? null;
  if (bundlePins.size === 0) {
    return {
      pinnedBundleId: null,
      pinnedContentIdentity: null,
      runtimeBundleId,
      runtimeContentIdentity,
      bound: runtimeBundleId !== null && runtimeContentIdentity !== null,
      mismatch: null,
      omissions: [],
    };
  }
  const pinnedBundleId = pinned?.bundleId ?? null;
  const pinnedContentIdentity = pinned?.contentIdentity ?? null;
  if (!pinned) {
    return {
      pinnedBundleId,
      pinnedContentIdentity,
      runtimeBundleId,
      runtimeContentIdentity,
      bound: false,
      mismatch: "missing_runtime_bundle",
      omissions: ["missing_encounter_bundle_pin"],
    };
  }
  if (!runtimeBundleId || !runtimeContentIdentity) {
    return {
      pinnedBundleId,
      pinnedContentIdentity,
      runtimeBundleId,
      runtimeContentIdentity,
      bound: false,
      mismatch: "missing_runtime_bundle",
      omissions: ["missing_encounter_bundle_evidence"],
    };
  }
  if (pinned.scenarioId !== station.scenarioId) {
    return {
      pinnedBundleId,
      pinnedContentIdentity,
      runtimeBundleId,
      runtimeContentIdentity,
      bound: false,
      mismatch: "cross_station_bundle",
      omissions: ["cross_station_encounter_bundle"],
    };
  }
  const otherPinBundleIds = new Set<string>();
  for (const [order, pin] of bundlePins) {
    if (order !== station.stationOrder) {
      otherPinBundleIds.add(pin.bundleId);
    }
  }
  if (otherPinBundleIds.has(runtimeBundleId) && runtimeBundleId !== pinnedBundleId) {
    return {
      pinnedBundleId,
      pinnedContentIdentity,
      runtimeBundleId,
      runtimeContentIdentity,
      bound: false,
      mismatch: "cross_station_bundle",
      omissions: ["cross_station_encounter_bundle"],
    };
  }
  if (runtimeBundleId !== pinnedBundleId || runtimeContentIdentity !== pinnedContentIdentity) {
    return {
      pinnedBundleId,
      pinnedContentIdentity,
      runtimeBundleId,
      runtimeContentIdentity,
      bound: false,
      mismatch: "substituted_bundle",
      omissions: ["substituted_encounter_bundle"],
    };
  }
  return {
    pinnedBundleId,
    pinnedContentIdentity,
    runtimeBundleId,
    runtimeContentIdentity,
    bound: true,
    mismatch: null,
    omissions: [],
  };
}

export function rejectSubstitutedOrMissingEncounterBundles(
  input: BuildAssembledExamReviewPacketInput,
): void {
  const bundlePins = indexEncounterBundlePins(input);
  if (bundlePins.size === 0) {
    return;
  }
  if (bundlePins.size !== input.stations.length) {
    fail("rejects substituted or missing encounter bundle");
  }
  for (const station of input.stations) {
    if (!bundlePins.has(station.stationOrder)) {
      fail("rejects substituted or missing encounter bundle");
    }
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function fail(suffix: string): never {
  throw new Error(`Assembled exam review packet ${suffix}`);
}
