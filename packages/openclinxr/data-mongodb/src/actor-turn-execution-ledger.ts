import type { Collection, Db } from "mongodb";
import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  assembleActorTurnReplay,
  stripPrivateHiddenFactPayload,
  type ActorTurnExecutionIdentity,
  type ActorTurnExecutionLedgerRecord,
  type ActorTurnModalityProvenance,
  type AssembledActorTurnReplay,
} from "@openclinxr/review-workflow";

export const actorTurnExecutionLedgerNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "production_atlas_scale",
  "hidden_fact_disclosure",
] as const;

export const actorTurnExecutionLedgerClaimBoundary =
  "actor_turn_execution_ledger_not_exam_equivalence" as const;

export type ActorTurnExecutionLedgerBackend = "memory" | "mongodb";

export type AdmitActorTurnExecutionInput = {
  stationRunId: string;
  plan: ActorTurnPlan;
  execution: ActorTurnExecution;
  atSecond: number;
  privatePayload?: Record<string, unknown>;
};

export type ActorTurnExecutionLedger = {
  readonly backend: ActorTurnExecutionLedgerBackend;
  ensureIndexes(): Promise<void>;
  admit(input: AdmitActorTurnExecutionInput): Promise<ActorTurnExecutionLedgerRecord>;
  listByStationRun(stationRunId: string): Promise<ActorTurnExecutionLedgerRecord[]>;
  projectFaculty(stationRunId: string): Promise<AssembledActorTurnReplay>;
};

type StoredDoc = ActorTurnExecutionLedgerRecord & {
  fingerprint: string;
  privatePayload?: Record<string, unknown>;
};

type LedgerStore = {
  load(identity: ActorTurnExecutionIdentity): Promise<StoredDoc | null>;
  save(doc: StoredDoc): Promise<void>;
  list(stationRunId: string): Promise<StoredDoc[]>;
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function requireField(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`actor-turn execution ledger requires nonblank ${fieldName}`);
  }
}

function requireInt(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`actor-turn execution ledger requires nonnegative integer ${fieldName}`);
  }
}

function identityKey(identity: ActorTurnExecutionIdentity): string {
  return `${identity.stationRunId}::${identity.planId}::${identity.turnId}`;
}

function durableRef(identity: ActorTurnExecutionIdentity): string {
  return `durable://station-runs/${identity.stationRunId}/actor-turns/${identity.planId}/${identity.turnId}`;
}

function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    freezeDeep(nested);
  }
  return Object.freeze(value);
}

function modalityFrom(
  plan: ActorTurnPlan,
  execution: ActorTurnExecution,
): ActorTurnModalityProvenance {
  return {
    voiceId: plan.voiceId,
    languageFallback: plan.languageProvenance.fallbackUsed || execution.fallback.language,
    ttsFallback: execution.fallback.tts,
    ...(plan.languageProvenance.providerId
      ? { providerId: plan.languageProvenance.providerId }
      : {}),
  };
}

function publicRecord(doc: StoredDoc): ActorTurnExecutionLedgerRecord {
  const record: ActorTurnExecutionLedgerRecord = {
    identity: cloneJson(doc.identity),
    plan: freezeDeep(cloneJson(doc.plan)),
    execution: freezeDeep(cloneJson(doc.execution)),
    actorId: doc.actorId,
    respondingActorId: doc.respondingActorId,
    turnIndex: doc.turnIndex,
    atSecond: doc.atSecond,
    modalityProvenance: cloneJson(doc.modalityProvenance),
    durableEventRef: doc.durableEventRef,
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: [...doc.notEvidenceFor],
  };
  return freezeDeep(record);
}

function fingerprintOf(record: Omit<ActorTurnExecutionLedgerRecord, "durableEventRef" | "claimScope" | "notEvidenceFor">): string {
  return canonical({
    identity: record.identity,
    plan: record.plan,
    execution: record.execution,
    actorId: record.actorId,
    respondingActorId: record.respondingActorId,
    turnIndex: record.turnIndex,
    atSecond: record.atSecond,
    modalityProvenance: record.modalityProvenance,
  });
}

function classifyMutation(existing: StoredDoc, next: StoredDoc): string {
  if (existing.plan.spokenText !== next.plan.spokenText
    || existing.plan.spokenTextForTts !== next.plan.spokenTextForTts) {
    return "mutated text";
  }
  if (existing.actorId !== next.actorId || existing.respondingActorId !== next.respondingActorId) {
    return "mutated actor";
  }
  if (canonical(existing.modalityProvenance) !== canonical(next.modalityProvenance)
    || canonical(existing.execution.renderedProsodyTags) !== canonical(next.execution.renderedProsodyTags)
    || canonical(existing.execution.droppedProsodyTags) !== canonical(next.execution.droppedProsodyTags)
    || canonical(existing.execution.fallback) !== canonical(next.execution.fallback)
    || canonical(existing.plan.languageProvenance) !== canonical(next.plan.languageProvenance)
    || existing.plan.voiceId !== next.plan.voiceId) {
    return "mutated modality provenance";
  }
  if (existing.atSecond !== next.atSecond || existing.turnIndex !== next.turnIndex) {
    return "mutated timing";
  }
  if (existing.plan.planVersion !== next.plan.planVersion
    || existing.identity.planId !== next.identity.planId
    || existing.identity.turnId !== next.identity.turnId
    || existing.identity.stationRunId !== next.identity.stationRunId
    || existing.execution.planId !== next.execution.planId
    || existing.execution.turnId !== next.execution.turnId) {
    return "mutated plan binding";
  }
  return "mutated actor-turn execution identity payload";
}

function normalizeAdmission(input: AdmitActorTurnExecutionInput): StoredDoc {
  requireField(input.stationRunId, "stationRunId");
  requireInt(input.atSecond, "atSecond");
  requireField(input.plan.planId, "plan.planId");
  requireField(input.plan.turnId, "plan.turnId");
  requireField(input.plan.actorId, "plan.actorId");
  requireField(input.plan.respondingActorId, "plan.respondingActorId");
  requireField(input.plan.stationRunId, "plan.stationRunId");
  requireField(input.execution.planId, "execution.planId");
  requireField(input.execution.turnId, "execution.turnId");
  requireInt(input.plan.turnIndex, "plan.turnIndex");
  if (input.plan.stationRunId !== input.stationRunId) {
    throw new Error(
      `actor-turn execution ledger fail-closed: mutated plan binding under identity ${input.stationRunId}::${input.plan.planId}::${input.plan.turnId}`,
    );
  }
  if (input.execution.planId !== input.plan.planId || input.execution.turnId !== input.plan.turnId) {
    throw new Error(
      `actor-turn execution ledger fail-closed: mutated plan binding under identity ${input.stationRunId}::${input.plan.planId}::${input.plan.turnId}`,
    );
  }
  const identity: ActorTurnExecutionIdentity = {
    stationRunId: input.stationRunId,
    planId: input.plan.planId,
    turnId: input.plan.turnId,
  };
  const plan = cloneJson(input.plan);
  const execution = cloneJson(input.execution);
  const modalityProvenance = modalityFrom(plan, execution);
  const record = {
    identity,
    plan,
    execution,
    actorId: plan.actorId,
    respondingActorId: plan.respondingActorId,
    turnIndex: plan.turnIndex,
    atSecond: input.atSecond,
    modalityProvenance,
  };
  return {
    ...record,
    durableEventRef: durableRef(identity),
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: [...actorTurnExecutionLedgerNotEvidenceFor],
    fingerprint: fingerprintOf(record),
    ...(input.privatePayload ? { privatePayload: cloneJson(input.privatePayload) } : {}),
  };
}

class ActorTurnExecutionLedgerCore implements ActorTurnExecutionLedger {
  constructor(
    readonly backend: ActorTurnExecutionLedgerBackend,
    private readonly store: LedgerStore,
    private readonly collection?: Collection<StoredDoc>,
  ) {}

  async ensureIndexes(): Promise<void> {
    if (!this.collection) {
      return;
    }
    await this.collection.createIndex(
      { "identity.stationRunId": 1, "identity.planId": 1, "identity.turnId": 1 },
      { unique: true },
    );
  }

  async admit(input: AdmitActorTurnExecutionInput): Promise<ActorTurnExecutionLedgerRecord> {
    const next = normalizeAdmission(input);
    const existing = await this.store.load(next.identity);
    if (existing) {
      if (existing.fingerprint === next.fingerprint) {
        return publicRecord(existing);
      }
      const reason = classifyMutation(existing, next);
      throw new Error(
        `actor-turn execution ledger fail-closed: ${reason} under identity ${identityKey(next.identity)}`,
      );
    }
    await this.store.save(next);
    return publicRecord(next);
  }

  async listByStationRun(stationRunId: string): Promise<ActorTurnExecutionLedgerRecord[]> {
    requireField(stationRunId, "stationRunId");
    const docs = await this.store.list(stationRunId);
    return docs
      .sort((left, right) =>
        left.turnIndex === right.turnIndex ? left.atSecond - right.atSecond : left.turnIndex - right.turnIndex,
      )
      .map(publicRecord);
  }

  async projectFaculty(stationRunId: string): Promise<AssembledActorTurnReplay> {
    const records = (await this.listByStationRun(stationRunId)).map((record) =>
      stripPrivateHiddenFactPayload(record) as ActorTurnExecutionLedgerRecord,
    );
    return assembleActorTurnReplay(stationRunId, records);
  }
}

export class MemoryActorTurnExecutionLedger extends ActorTurnExecutionLedgerCore {
  constructor() {
    const documents = new Map<string, StoredDoc>();
    super("memory", {
      async load(identity) {
        const doc = documents.get(identityKey(identity));
        return doc ? cloneJson(doc) : null;
      },
      async save(doc) {
        documents.set(identityKey(doc.identity), cloneJson(doc));
      },
      async list(stationRunId) {
        return [...documents.values()]
          .filter((doc) => doc.identity.stationRunId === stationRunId)
          .map((doc) => cloneJson(doc));
      },
    });
  }
}

export class MongoActorTurnExecutionLedger extends ActorTurnExecutionLedgerCore {
  constructor(db: Db) {
    const collection = db.collection<StoredDoc>("actor_turn_execution_ledgers");
    super(
      "mongodb",
      {
        async load(identity) {
          return collection.findOne(
            {
              "identity.stationRunId": identity.stationRunId,
              "identity.planId": identity.planId,
              "identity.turnId": identity.turnId,
            },
            { projection: { _id: 0 } },
          );
        },
        async save(doc) {
          await collection.updateOne(
            {
              "identity.stationRunId": doc.identity.stationRunId,
              "identity.planId": doc.identity.planId,
              "identity.turnId": doc.identity.turnId,
            },
            { $set: cloneJson(doc) },
            { upsert: true },
          );
        },
        async list(stationRunId) {
          return collection
            .find({ "identity.stationRunId": stationRunId }, { projection: { _id: 0 } })
            .toArray();
        },
      },
      collection,
    );
  }
}

export function createActorTurnExecutionLedger(db?: Db): ActorTurnExecutionLedger {
  return db ? new MongoActorTurnExecutionLedger(db) : new MemoryActorTurnExecutionLedger();
}
