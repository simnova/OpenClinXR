import type { Collection, Db } from "mongodb";
import {
  createDurableExamFormEncounterBundlePins,
  durableExamStationEncounterBundlePinClaimScope,
  durableExamStationEncounterBundlePinNotEvidenceFor,
  launchPinnedStationAssetsFromPort,
  type DurableExamFormEncounterBundlePins,
  type DurableExamStationEncounterBundlePin,
  type ExamFormEncounterBundlePinPersistencePort,
  type LaunchPinnedStationAssetsInput,
  type LaunchPinnedStationAssetsResult,
  type PersistExamFormEncounterBundlePinsInput,
} from "@openclinxr/session-state";
import { assertNonblankMongoField } from "./mongo-helpers.js";

export class MongoExamFormEncounterBundlePinRepository implements ExamFormEncounterBundlePinPersistencePort {
  readonly backend = "mongodb" as const;
  readonly durableStore = "database_source_of_truth" as const;
  private readonly collection: Collection<DurableExamFormEncounterBundlePins>;

  constructor(db: Db) {
    this.collection = db.collection<DurableExamFormEncounterBundlePins>(
      "exam_form_encounter_bundle_pins",
    );
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ examFormId: 1 }, { unique: true });
  }

  async persist(input: PersistExamFormEncounterBundlePinsInput): Promise<DurableExamFormEncounterBundlePins> {
    const record = createDurableExamFormEncounterBundlePins(input, this.durableStore);
    try {
      await this.collection.insertOne(cloneJson(record));
      return record;
    } catch (error) {
      if (!isDuplicateKey(error)) {
        throw error;
      }
      const existing = await this.collection.findOne(
        { examFormId: record.examFormId },
        { projection: { _id: 0 } },
      );
      if (!existing) {
        throw error;
      }
      const restored = restoreDatabaseRecord(existing);
      if (!sameImmutableRecord(restored, record)) {
        throw new Error("repersist cannot mutate immutable exam-form encounter-bundle pins");
      }
      return restored;
    }
  }

  async load(examFormId: string): Promise<DurableExamFormEncounterBundlePins | null> {
    assertNonblankMongoField(examFormId, "examFormId");
    const found = await this.collection.findOne({ examFormId }, { projection: { _id: 0 } });
    return found ? restoreDatabaseRecord(found) : null;
  }

  async launchPinnedStationAssets(input: LaunchPinnedStationAssetsInput): Promise<LaunchPinnedStationAssetsResult> {
    return launchPinnedStationAssetsFromPort(this, input);
  }
}

function restoreDatabaseRecord(
  record: DurableExamFormEncounterBundlePins,
): DurableExamFormEncounterBundlePins {
  if (record.durableStore !== "database_source_of_truth") {
    throw new Error("mongo exam-form pin records must use durableStore database_source_of_truth");
  }
  if (!Array.isArray(record.pins) || record.pins.some(
    (pin) => pin.durableStore !== "database_source_of_truth",
  )) {
    throw new Error("mongo exam-form station pins must use durableStore database_source_of_truth");
  }
  if (record.claimScope !== durableExamStationEncounterBundlePinClaimScope) {
    throw new Error("mongo exam-form pin record has invalid claimScope");
  }
  if (!sameStrings(record.notEvidenceFor, durableExamStationEncounterBundlePinNotEvidenceFor)) {
    throw new Error("mongo exam-form pin record has invalid notEvidenceFor boundary");
  }
  return createDurableExamFormEncounterBundlePins({
    examFormId: record.examFormId,
    pins: record.pins.map((pin) => ({
      stationOrder: pin.stationOrder,
      slotId: pin.slotId,
      scenarioId: pin.scenarioId,
      scenarioVersion: pin.scenarioVersion,
      bundleId: pin.bundleId,
      contentIdentity: pin.contentIdentity,
    })),
  }, "database_source_of_truth");
}

function sameImmutableRecord(
  left: DurableExamFormEncounterBundlePins,
  right: DurableExamFormEncounterBundlePins,
): boolean {
  return left.examFormId === right.examFormId
    && left.durableStore === right.durableStore
    && left.pins.length === right.pins.length
    && left.pins.every((pin, index) => samePin(pin, right.pins[index]));
}

function samePin(
  left: DurableExamStationEncounterBundlePin,
  right: DurableExamStationEncounterBundlePin | undefined,
): boolean {
  return right !== undefined
    && left.examFormId === right.examFormId
    && left.stationOrder === right.stationOrder
    && left.slotId === right.slotId
    && left.scenarioId === right.scenarioId
    && left.scenarioVersion === right.scenarioVersion
    && left.bundleId === right.bundleId
    && left.contentIdentity === right.contentIdentity
    && left.durableStore === right.durableStore;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === 11000;
}
