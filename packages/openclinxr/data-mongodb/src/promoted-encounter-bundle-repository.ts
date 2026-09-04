import type { Db } from "mongodb";
import {
  immutableEncounterBundleClaimScope,
  immutableEncounterBundleNotEvidenceFor,
  promoteReviewedFactoryOutputsToImmutableEncounterBundle,
  type EncounterBundleMemberContentIdentity,
  type PromoteReviewedFactoryOutputsInput,
} from "@openclinxr/asset-registry/runtime-asset-review";
import type { LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import { assertLearnerSafeRuntimeAssetBundle, assertNonblankMongoField } from "./mongo-helpers.js";

export type PromotedEncounterBundleRepositoryBackend = "memory" | "mongodb";

export type PromotedEncounterBundleRecord = {
  bundleId: string;
  contentIdentity: string;
  learnerBundle: LearnerRuntimeAssetBundle;
  memberContentIdentities: EncounterBundleMemberContentIdentity[];
  durableStore: "database_source_of_truth";
  runtimeEligibility: "promoted";
  promotedAt: string;
  claimScope: typeof immutableEncounterBundleClaimScope;
  notEvidenceFor: typeof immutableEncounterBundleNotEvidenceFor;
};

type PromotedStore = {
  ensureIndexes(): Promise<void>;
  load(bundleId: string): Promise<PromotedEncounterBundleRecord | null>;
  insertFirst(record: PromotedEncounterBundleRecord): Promise<PromotedEncounterBundleRecord>;
};

class PromotedEncounterBundleRepositoryCore {
  readonly backend: PromotedEncounterBundleRepositoryBackend;

  constructor(
    backend: PromotedEncounterBundleRepositoryBackend,
    private readonly store: PromotedStore,
  ) {
    this.backend = backend;
  }

  async ensureIndexes(): Promise<void> {
    await this.store.ensureIndexes();
  }

  async promote(
    input: PromoteReviewedFactoryOutputsInput,
    nowIso = "2026-09-04T16:00:00.000Z",
  ): Promise<PromotedEncounterBundleRecord> {
    const promotion = promoteReviewedFactoryOutputsToImmutableEncounterBundle(input);
    if (!promotion.promoted) {
      throw new Error(
        `encounter bundle promotion refused: ${promotion.blockers.join(", ")}`,
      );
    }
    assertLearnerSafeRuntimeAssetBundle(promotion.learnerBundle);
    if (promotion.learnerBundle.bundleId !== promotion.bundleId) {
      throw new Error("promoted learner bundle id must match opaque bundle id");
    }
    const record: PromotedEncounterBundleRecord = {
      bundleId: promotion.bundleId,
      contentIdentity: promotion.contentIdentity,
      learnerBundle: cloneJson(promotion.learnerBundle),
      memberContentIdentities: cloneJson(promotion.memberContentIdentities),
      durableStore: "database_source_of_truth",
      runtimeEligibility: "promoted",
      promotedAt: nowIso,
      claimScope: immutableEncounterBundleClaimScope,
      notEvidenceFor: immutableEncounterBundleNotEvidenceFor,
    };
    const stored = await this.store.insertFirst(record);
    if (stored.contentIdentity !== record.contentIdentity) {
      throw new Error("repromotion cannot mutate immutable encounter bundle");
    }
    return cloneJson(stored);
  }

  async findByOpaqueId(bundleId: string): Promise<PromotedEncounterBundleRecord | null> {
    assertNonblankMongoField(bundleId, "bundleId");
    const found = await this.store.load(bundleId);
    return found ? cloneJson(found) : null;
  }
}

export class MemoryPromotedEncounterBundleRepository extends PromotedEncounterBundleRepositoryCore {
  constructor() {
    const documents = new Map<string, PromotedEncounterBundleRecord>();
    super("memory", {
      async ensureIndexes() {
        return;
      },
      async load(bundleId) {
        return documents.get(bundleId) ?? null;
      },
      async insertFirst(record) {
        const existing = documents.get(record.bundleId);
        if (existing) {
          return cloneJson(existing);
        }
        const stored = cloneJson(record);
        documents.set(record.bundleId, stored);
        return cloneJson(stored);
      },
    });
  }
}

export class MongoPromotedEncounterBundleRepository extends PromotedEncounterBundleRepositoryCore {
  constructor(db: Db) {
    const collection = db.collection<PromotedEncounterBundleRecord>("promoted_encounter_bundles");
    super("mongodb", {
      async ensureIndexes() {
        await collection.createIndex({ bundleId: 1 }, { unique: true });
        await collection.createIndex({ contentIdentity: 1 }, { unique: true });
      },
      async load(bundleId) {
        return collection.findOne({ bundleId }, { projection: { _id: 0 } });
      },
      async insertFirst(record) {
        try {
          await collection.insertOne(cloneJson(record));
          return cloneJson(record);
        } catch (error) {
          if (!isDuplicateKey(error)) {
            throw error;
          }
          const existing = await collection.findOne(
            { bundleId: record.bundleId },
            { projection: { _id: 0 } },
          );
          if (!existing) {
            throw error;
          }
          return existing;
        }
      },
    });
  }
}

export function createPromotedEncounterBundleRepository(
  db?: Db,
): PromotedEncounterBundleRepositoryCore {
  return db
    ? new MongoPromotedEncounterBundleRepository(db)
    : new MemoryPromotedEncounterBundleRepository();
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
