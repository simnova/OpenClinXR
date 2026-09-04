import type { Collection, Db } from "mongodb";
import {
  assertDatabaseSourceOfTruth,
  assertNonblankMongoField,
  assertNonblankMongoStringArray,
  assertNonnegativeFiniteMongoSecond,
  isRecord,
} from "./mongo-helpers.js";
import {
  actorTurnExecutionClaimScope,
  type ActorTurnEmotionalTimelineStep,
  type ActorTurnExecutionRecord,
  type ActorTurnReplayRestore,
} from "./records.js";

const RAW_AUDIO_FIELDS = [
  "rawAudio",
  "rawAudioBytes",
  "audioBytes",
  "audioBuffer",
  "audioPayload",
  "learnerAudio",
] as const;

export type ActorTurnExecutionRepositoryBackend = "memory" | "mongodb";

type ExecutionStore = {
  insertFirst(record: ActorTurnExecutionRecord): Promise<void>;
  list(stationRunId: string): Promise<ActorTurnExecutionRecord[]>;
};

class ActorTurnExecutionRepositoryCore {
  readonly backend: ActorTurnExecutionRepositoryBackend;

  constructor(
    backend: ActorTurnExecutionRepositoryBackend,
    private readonly store: StoreWithIndexes,
  ) {
    this.backend = backend;
  }

  async ensureIndexes(): Promise<void> {
    await this.store.ensureIndexes();
  }

  async save(record: ActorTurnExecutionRecord): Promise<void> {
    assertValidActorTurnExecutionRecord(record);
    await this.store.insertFirst(cloneActorTurnExecutionRecord(record));
  }

  async listByStationRunId(stationRunId: string): Promise<ActorTurnExecutionRecord[]> {
    assertNonblankMongoField(stationRunId, "stationRunId");
    const rows = await this.store.list(stationRunId);
    return rows
      .slice()
      .sort(compareExecutionOrder)
      .map(cloneActorTurnExecutionRecord);
  }

  async restoreReplay(stationRunId: string): Promise<ActorTurnReplayRestore> {
    const turns = await this.listByStationRunId(stationRunId);
    return {
      turns,
      emotionalTimeline: turns.map(timelineStepFromStoredTurn),
    };
  }
}

type StoreWithIndexes = ExecutionStore & { ensureIndexes(): Promise<void> };

export class MemoryActorTurnExecutionRepository extends ActorTurnExecutionRepositoryCore {
  constructor() {
    const documents = new Map<string, ActorTurnExecutionRecord>();
    super("memory", {
      async ensureIndexes() {
        return;
      },
      async insertFirst(record) {
        const key = identityKey(record);
        if (!documents.has(key)) {
          documents.set(key, cloneActorTurnExecutionRecord(record));
        }
      },
      async list(stationRunId) {
        return [...documents.values()]
          .filter((row) => row.stationRunId === stationRunId)
          .map(cloneActorTurnExecutionRecord);
      },
    });
  }
}

export class MongoActorTurnExecutionRepository extends ActorTurnExecutionRepositoryCore {
  constructor(db: Db) {
    const collection = db.collection<ActorTurnExecutionRecord>("actor_turn_executions");
    super("mongodb", createMongoStore(collection));
  }
}

export function createActorTurnExecutionRepository(db?: Db): ActorTurnExecutionRepositoryCore {
  return db ? new MongoActorTurnExecutionRepository(db) : new MemoryActorTurnExecutionRepository();
}

export function createMongoActorTurnExecutionRepository(db: Db): MongoActorTurnExecutionRepository {
  return new MongoActorTurnExecutionRepository(db);
}

function createMongoStore(collection: Collection<ActorTurnExecutionRecord>): StoreWithIndexes {
  return {
    async ensureIndexes() {
      await collection.createIndex({ stationRunId: 1, planId: 1 }, { unique: true });
      await collection.createIndex({ stationRunId: 1, atSecond: 1, turnId: 1 });
    },
    async insertFirst(record) {
      await collection.updateOne(
        { stationRunId: record.stationRunId, planId: record.planId },
        { $setOnInsert: cloneActorTurnExecutionRecord(record) },
        { upsert: true },
      );
    },
    async list(stationRunId) {
      return collection
        .find({ stationRunId }, { projection: { _id: 0 } })
        .sort({ atSecond: 1, turnId: 1 })
        .toArray();
    },
  };
}

export function assertValidActorTurnExecutionRecord(record: ActorTurnExecutionRecord): void {
  assertDatabaseSourceOfTruth(record);
  assertNonblankMongoField(record.stationRunId, "stationRunId");
  assertNonblankMongoField(record.planId, "planId");
  assertNonblankMongoField(record.turnId, "turnId");
  assertNonblankMongoField(record.actorId, "actorId");
  assertNonblankMongoField(record.spokenText, "spokenText");
  assertNonblankMongoField(record.dialogueEmotionFrom, "dialogueEmotionFrom");
  assertNonblankMongoField(record.dialogueEmotionTo, "dialogueEmotionTo");
  assertNonblankMongoField(record.performancePlanId, "performancePlanId");
  assertNonblankMongoField(record.ttsProviderId, "ttsProviderId");
  assertNonblankMongoField(record.interruptionKind, "interruptionKind");
  assertNonblankMongoStringArray(record.droppedTags, "droppedTags");
  assertNonnegativeFiniteMongoSecond(record.atSecond, "actor-turn execution records");
  if (!Number.isInteger(record.visemeCueCount) || record.visemeCueCount < 0) {
    throw new Error("durable Mongo actor-turn executions require a nonnegative integer visemeCueCount");
  }
  if (typeof record.truncated !== "boolean") {
    throw new Error("durable Mongo actor-turn executions require boolean truncated");
  }
  if (typeof record.prosodyNeutralized !== "boolean") {
    throw new Error("durable Mongo actor-turn executions require boolean prosodyNeutralized");
  }
  if (record.rawAudioStored !== false) {
    throw new Error("durable Mongo actor-turn executions must not store raw audio");
  }
  if (record.claimScope !== actorTurnExecutionClaimScope) {
    throw new Error("durable Mongo actor-turn executions require claimScope simulated_actor_behavior");
  }
  assertNoRawAudioPayload(record);
}

export function cloneActorTurnExecutionRecord(record: ActorTurnExecutionRecord): ActorTurnExecutionRecord {
  return {
    stationRunId: record.stationRunId,
    planId: record.planId,
    turnId: record.turnId,
    actorId: record.actorId,
    spokenText: record.spokenText,
    dialogueEmotionFrom: record.dialogueEmotionFrom,
    dialogueEmotionTo: record.dialogueEmotionTo,
    performancePlanId: record.performancePlanId,
    visemeCueCount: record.visemeCueCount,
    ttsProviderId: record.ttsProviderId,
    truncated: record.truncated,
    interruptionKind: record.interruptionKind,
    droppedTags: [...record.droppedTags],
    prosodyNeutralized: record.prosodyNeutralized,
    atSecond: record.atSecond,
    durableStore: "database_source_of_truth",
    rawAudioStored: false,
    claimScope: actorTurnExecutionClaimScope,
  };
}

function identityKey(record: Pick<ActorTurnExecutionRecord, "stationRunId" | "planId">): string {
  return `${record.stationRunId}::${record.planId}`;
}

function compareExecutionOrder(left: ActorTurnExecutionRecord, right: ActorTurnExecutionRecord): number {
  if (left.atSecond !== right.atSecond) {
    return left.atSecond - right.atSecond;
  }
  return left.turnId.localeCompare(right.turnId);
}

function timelineStepFromStoredTurn(turn: ActorTurnExecutionRecord): ActorTurnEmotionalTimelineStep {
  return {
    planId: turn.planId,
    actorId: turn.actorId,
    from: turn.dialogueEmotionFrom,
    to: turn.dialogueEmotionTo,
    atSecond: turn.atSecond,
  };
}

function assertNoRawAudioPayload(record: ActorTurnExecutionRecord): void {
  if (!isRecord(record)) {
    throw new Error("durable Mongo actor-turn executions must not store raw audio");
  }
  const bag = record as unknown as Record<string, unknown>;
  const leaked = RAW_AUDIO_FIELDS.filter((field) => field in bag && bag[field] != null);
  if (leaked.length > 0) {
    throw new Error(
      `durable Mongo actor-turn executions must not store raw audio (${leaked.join(", ")})`,
    );
  }
}
