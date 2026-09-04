import type {
  DurableExamFormEncounterBundlePins,
  DurableExamStationEncounterBundlePin,
  DurablePromotedEncounterBundleLookupEntry,
  LaunchPinnedStationAssetsInput,
  LaunchPinnedStationAssetsResult,
  PersistExamFormEncounterBundlePinsInput,
} from "./types.js";
import {
  durableExamStationEncounterBundlePinClaimScope,
  durableExamStationEncounterBundlePinNotEvidenceFor,
} from "./types.js";

export function createDurableExamFormEncounterBundlePins(
  input: PersistExamFormEncounterBundlePinsInput,
): DurableExamFormEncounterBundlePins {
  const examFormId = requireNonblank(input.examFormId, "examFormId");
  if (input.pins.length === 0) {
    throw new Error("durable exam-form encounter-bundle pins require at least one station pin");
  }
  const pins = input.pins.map((pin) => freezePin({
    examFormId,
    stationOrder: pin.stationOrder,
    slotId: requireNonblank(pin.slotId, "slotId"),
    scenarioId: requireNonblank(pin.scenarioId, "scenarioId"),
    scenarioVersion: pin.scenarioVersion,
    bundleId: requireNonblank(pin.bundleId, "bundleId"),
    contentIdentity: requireNonblank(pin.contentIdentity, "contentIdentity"),
    durableStore: "database_source_of_truth",
  }));
  assertUniquePins(pins);
  return freezeForm({
    examFormId,
    pins,
    durableStore: "database_source_of_truth",
    claimScope: durableExamStationEncounterBundlePinClaimScope,
    notEvidenceFor: durableExamStationEncounterBundlePinNotEvidenceFor,
  });
}

export class MemoryExamFormEncounterBundlePinStore {
  private readonly documents = new Map<string, DurableExamFormEncounterBundlePins>();

  persist(input: PersistExamFormEncounterBundlePinsInput): DurableExamFormEncounterBundlePins {
    const record = createDurableExamFormEncounterBundlePins(input);
    this.documents.set(record.examFormId, cloneJson(record));
    return cloneJson(record);
  }

  load(examFormId: string): DurableExamFormEncounterBundlePins | null {
    const found = this.documents.get(requireNonblank(examFormId, "examFormId"));
    return found ? cloneJson(found) : null;
  }

  dump(): Record<string, DurableExamFormEncounterBundlePins> {
    return cloneJson(Object.fromEntries(this.documents.entries()));
  }

  static restore(
    serialized: Record<string, DurableExamFormEncounterBundlePins>,
  ): MemoryExamFormEncounterBundlePinStore {
    const store = new MemoryExamFormEncounterBundlePinStore();
    for (const record of Object.values(serialized)) {
      store.documents.set(record.examFormId, cloneJson(record));
    }
    return store;
  }

  launchPinnedStationAssets(input: LaunchPinnedStationAssetsInput): LaunchPinnedStationAssetsResult {
    const examFormId = requireNonblank(input.examFormId, "examFormId");
    const slotId = requireNonblank(input.slotId, "slotId");
    const form = this.load(examFormId);
    if (!form) {
      return refuseLaunch(examFormId, slotId, [`form:${examFormId}:missing`]);
    }
    const pin = form.pins.find((entry) => entry.slotId === slotId);
    if (!pin) {
      return refuseLaunch(examFormId, slotId, [`station:${slotId}:missing`]);
    }
    const catalogEntry = input.catalog.find((entry) => entry.bundleId === pin.bundleId);
    if (!catalogEntry) {
      return refuseLaunch(examFormId, slotId, [`station:${slotId}:missing`]);
    }
    const blockers = inspectLaunchCatalog(pin, catalogEntry);
    if (blockers.length > 0) {
      return refuseLaunch(examFormId, slotId, blockers);
    }
    return {
      launched: true,
      examFormId,
      slotId,
      scenarioId: pin.scenarioId,
      bundleId: pin.bundleId,
      contentIdentity: pin.contentIdentity,
      claimScope: durableExamStationEncounterBundlePinClaimScope,
      notEvidenceFor: durableExamStationEncounterBundlePinNotEvidenceFor,
    };
  }
}

function inspectLaunchCatalog(
  pin: DurableExamStationEncounterBundlePin,
  entry: DurablePromotedEncounterBundleLookupEntry,
): string[] {
  const prefix = `station:${pin.slotId}`;
  const blockers: string[] = [];
  if (entry.identityScope !== "learner_runtime_opaque_bundle") {
    blockers.push(`${prefix}:identity_mismatch:${entry.bundleId}`);
  }
  if (entry.scenarioId !== pin.scenarioId || entry.stationId !== pin.slotId) {
    blockers.push(`${prefix}:identity_mismatch:${entry.bundleId}`);
  }
  if (entry.contentIdentity !== pin.contentIdentity || entry.frozenForEncounter !== true) {
    blockers.push(`${prefix}:stale`);
  }
  if (entry.runtimeEligibility === "blocked") {
    blockers.push(`${prefix}:blocked`);
  } else if (entry.runtimeEligibility !== "promoted") {
    blockers.push(`${prefix}:stale`);
  }
  return blockers;
}

function refuseLaunch(
  examFormId: string,
  slotId: string,
  blockers: string[],
): LaunchPinnedStationAssetsResult {
  return {
    launched: false,
    examFormId,
    slotId,
    blockers: [...new Set(blockers)],
    claimScope: durableExamStationEncounterBundlePinClaimScope,
    notEvidenceFor: durableExamStationEncounterBundlePinNotEvidenceFor,
  };
}

function assertUniquePins(pins: readonly DurableExamStationEncounterBundlePin[]): void {
  const slots = new Set<string>();
  const bundles = new Set<string>();
  for (const pin of pins) {
    if (slots.has(pin.slotId)) {
      throw new Error(`duplicate station pin: ${pin.slotId}`);
    }
    if (bundles.has(pin.bundleId)) {
      throw new Error(`duplicate bundle pin: ${pin.bundleId}`);
    }
    if (!Number.isInteger(pin.stationOrder) || pin.stationOrder < 1) {
      throw new Error("stationOrder must be a positive integer");
    }
    if (!Number.isInteger(pin.scenarioVersion) || pin.scenarioVersion < 1) {
      throw new Error("scenarioVersion must be a positive integer");
    }
    slots.add(pin.slotId);
    bundles.add(pin.bundleId);
  }
}

function freezePin(pin: DurableExamStationEncounterBundlePin): DurableExamStationEncounterBundlePin {
  return Object.freeze({ ...pin });
}

function freezeForm(form: DurableExamFormEncounterBundlePins): DurableExamFormEncounterBundlePins {
  return Object.freeze({
    ...form,
    pins: Object.freeze([...form.pins]),
    notEvidenceFor: durableExamStationEncounterBundlePinNotEvidenceFor,
  });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requireNonblank(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}
