import type { Collection, Db } from "mongodb";
import type { ExamForm } from "@openclinxr/exam-assembly";
import { promoteEncounterRuntimeAssetBundleForLocalUse } from "@openclinxr/asset-registry/runtime-asset-review";
import type { EncounterRuntimeAssetBundle, LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import {
  assertLearnerSafeRuntimeAssetBundle,
  cloneLearnerRuntimeAssetBundleForMongo,
  isRecord,
} from "./mongo-helpers.js";
import type { ExamStationRunQueueSnapshot } from "./records.js";
import { MongoExamRunLedger } from "./exam-run-ledger.js";

export function createMongoExamPersistence(db: Db) {
  const forms = new MongoExamFormRepository(db);
  const stationRunQueues = new MongoStationRunQueueRepository(db);
  const runtimeAssetBundles = new MongoRuntimeAssetBundleRepository(db);
  const examRunLedger = new MongoExamRunLedger(db);
  return {
    forms,
    stationRunQueues,
    runtimeAssetBundles,
    examRunLedger,
    async ensureIndexes(): Promise<void> {
      await Promise.all([
        forms.ensureIndexes(),
        stationRunQueues.ensureIndexes(),
        runtimeAssetBundles.ensureIndexes(),
        examRunLedger.ensureIndexes(),
      ]);
    },
  };
}

export class MongoExamFormRepository {
  private readonly collection: Collection<ExamForm>;

  constructor(db: Db) {
    this.collection = db.collection<ExamForm>("exam_forms");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ examFormId: 1 }, { unique: true });
    await this.collection.createIndex({ blueprintId: 1, status: 1 });
  }

  async save(form: ExamForm): Promise<void> {
    await this.collection.updateOne(
      { examFormId: form.examFormId },
      { $set: form },
      { upsert: true },
    );
  }

  async findById(examFormId: string): Promise<ExamForm | null> {
    return this.collection.findOne({ examFormId }, { projection: { _id: 0 } });
  }

  async listByBlueprint(blueprintId: string): Promise<ExamForm[]> {
    return this.collection.find({ blueprintId }, { projection: { _id: 0 } }).sort({ examFormId: 1 }).toArray();
  }
}

export class MongoStationRunQueueRepository {
  private readonly collection: Collection<ExamStationRunQueueSnapshot>;

  constructor(db: Db) {
    this.collection = db.collection<ExamStationRunQueueSnapshot>("station_run_queue_snapshots");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ snapshotId: 1 }, { unique: true });
    await this.collection.createIndex({ "queue.blueprintId": 1, createdAt: -1 });
    // listByBlueprint: equality on blueprintId + sort createdAt desc, snapshotId
    await this.collection.createIndex({ "queue.blueprintId": 1, createdAt: -1, snapshotId: 1 });
    await this.collection.createIndex({ "queue.stationQueue.scenarioId": 1 });
  }

  async save(snapshot: ExamStationRunQueueSnapshot): Promise<void> {
    await this.collection.updateOne(
      { snapshotId: snapshot.snapshotId },
      { $set: snapshot },
      { upsert: true },
    );
  }

  async findById(snapshotId: string): Promise<ExamStationRunQueueSnapshot | null> {
    return this.collection.findOne({ snapshotId }, { projection: { _id: 0 } });
  }

  async listByBlueprint(blueprintId: string): Promise<ExamStationRunQueueSnapshot[]> {
    return this.collection.find({ "queue.blueprintId": blueprintId }, { projection: { _id: 0 } }).sort({ createdAt: -1, snapshotId: 1 }).toArray();
  }
}

export class MongoRuntimeAssetBundleRepository {
  private readonly collection: Collection<LearnerRuntimeAssetBundle>;

  constructor(db: Db) {
    this.collection = db.collection<LearnerRuntimeAssetBundle>("learner_runtime_asset_bundles");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ bundleId: 1 }, { unique: true });
    await this.collection.createIndex({ identityScope: 1, bundleId: 1 });
  }

  async saveLearnerBundle(bundle: LearnerRuntimeAssetBundle): Promise<void> {
    assertLearnerSafeRuntimeAssetBundle(bundle);
    await this.collection.updateOne(
      { bundleId: bundle.bundleId },
      { $set: cloneLearnerRuntimeAssetBundleForMongo(bundle) },
      { upsert: true },
    );
  }

  async findLearnerBundleById(bundleId: string): Promise<LearnerRuntimeAssetBundle | null> {
    return this.collection.findOne({ bundleId }, { projection: { _id: 0 } });
  }

  async listLearnerBundles(): Promise<LearnerRuntimeAssetBundle[]> {
    return this.collection.find({}, { projection: { _id: 0 } }).sort({ bundleId: 1 }).toArray();
  }
}

export async function saveLearnerRuntimeAssetBundleFromGeneratedReport(
  repository: MongoRuntimeAssetBundleRepository,
  reportValue: unknown,
): Promise<LearnerRuntimeAssetBundle> {
  if (!isRecord(reportValue)) {
    throw new Error("generated runtime bundle report must be an object");
  }
  if (reportValue["schemaVersion"] !== "openclinxr.generated-ed-station-runtime-bundle.v1") {
    throw new Error("generated runtime bundle report schemaVersion is unsupported");
  }
  if (reportValue["status"] !== "bundle_ready") {
    throw new Error(`generated runtime bundle report is not bundle_ready: ${String(reportValue["status"])}`);
  }
  if (!isRecord(reportValue["learnerBundle"])) {
    throw new Error("generated runtime bundle report requires learnerBundle");
  }
  if (isRecord(reportValue["bundle"])) {
    const promotion = promoteEncounterRuntimeAssetBundleForLocalUse({
      bundle: reportValue["bundle"] as EncounterRuntimeAssetBundle,
      decisions: Array.isArray(reportValue["runtimeAssetReviewDecisions"]) ? reportValue["runtimeAssetReviewDecisions"] : [],
    });
    if (!promotion.promoted) {
      throw new Error(`generated runtime bundle report did not pass local runtime promotion: ${promotion.blockers.join(", ")}`);
    }
  }
  const learnerBundle = reportValue["learnerBundle"] as LearnerRuntimeAssetBundle;
  await repository.saveLearnerBundle(learnerBundle);
  return learnerBundle;
}
