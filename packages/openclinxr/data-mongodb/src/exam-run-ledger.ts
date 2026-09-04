import type { Collection, Db } from "mongodb";
import {
  ASSEMBLED_EXAM_PHASE_BY_TYPE,
  ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES,
  type AssembledExamPhaseTransitionType,
} from "@openclinxr/review-workflow";
import type { PatientNote, ReviewPacket, TraceEvent } from "@openclinxr/shared-schemas";
import { validatePatientNote, validateReviewPacket, validateTraceEvent } from "@openclinxr/shared-schemas";
import { MongoReviewPacketRepository, MongoTraceRepository } from "./scenario-repositories.js";

export const examRunLedgerNotEvidenceFor = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
  "production_atlas_scale",
] as const;
export const examRunLedgerClaimBoundary = "exam_run_ledger_resume_not_exam_equivalence" as const;

export type ExamRunLedgerBackend = "memory" | "mongodb";
export type ExamRunFormIdentity = { examRunId: string; examFormId: string; blueprintId: string };
export type ExamRunStationBinding = {
  stationOrder: number; slotId: string; stationRunId: string; scenarioId: string | null; scenarioVersion: number | null;
};
export type OpenExamRunInput = ExamRunFormIdentity & { stations: readonly ExamRunStationBinding[] };
export type CanonicalPhaseEventType = AssembledExamPhaseTransitionType;
export type CanonicalPhaseEventAdmission = {
  examRunId: string; stationRunId: string; sequence: number; eventType: string; atSecond: number; source: string;
  scenarioId: string; stationOrder: number; formAtSecond: number; durableEventRef?: string; advanceReason?: string;
};
export type AdmittedCanonicalPhaseEvent = Omit<CanonicalPhaseEventAdmission, "eventType" | "durableEventRef" | "advanceReason"> & {
  eventType: CanonicalPhaseEventType; phase: (typeof ASSEMBLED_EXAM_PHASE_BY_TYPE)[CanonicalPhaseEventType];
  durableEventRef: string; occurredAt: string; advanceReason?: string;
};
export type PatientNoteAdmission = PatientNote & { examRunId: string };
export type ActorPlanExecutionProvenanceAdmission = {
  examRunId: string; stationRunId: string; turnId: string; actorId: string; planId: string; sequence: number;
  hasPlan: boolean; hasExecution: boolean;
};
export type AdmittedActorPlanExecutionProvenance = ActorPlanExecutionProvenanceAdmission & { durableEventRef: string };
export type ReviewPacketReference = { examRunId: string; stationRunId: string };
export type ExamRunOmissionKind =
  | "missing_phase_events"
  | "missing_patient_note"
  | "missing_actor_provenance"
  | "missing_review_packet_ref"
  | "review_packet_record_missing";
export type ExamRunOmission = { kind: ExamRunOmissionKind; stationRunId: string; stationOrder: number; reason: string };
export type ExamRunResumeProjection = {
  examRunId: string; backend: ExamRunLedgerBackend; formIdentity: ExamRunFormIdentity;
  orderedStations: ExamRunStationBinding[]; admittedPhaseEvents: AdmittedCanonicalPhaseEvent[];
  patientNotes: PatientNoteAdmission[]; actorProvenance: AdmittedActorPlanExecutionProvenance[];
  reviewPacketRefs: ReviewPacketReference[]; omissions: ExamRunOmission[];
  claimBoundary: typeof examRunLedgerClaimBoundary; notEvidenceFor: typeof examRunLedgerNotEvidenceFor;
  examEquivalenceGate: false;
};
export type ExamRunLedger = {
  readonly backend: ExamRunLedgerBackend;
  ensureIndexes(): Promise<void>;
  openExamRun(input: OpenExamRunInput): Promise<ExamRunFormIdentity>;
  admitCanonicalPhaseEvent(input: CanonicalPhaseEventAdmission): Promise<AdmittedCanonicalPhaseEvent>;
  submitPatientNote(input: PatientNoteAdmission): Promise<PatientNoteAdmission>;
  recordActorPlanExecutionProvenance(input: ActorPlanExecutionProvenanceAdmission): Promise<AdmittedActorPlanExecutionProvenance>;
  attachReviewPacketReference(examRunId: string, packet: ReviewPacket): Promise<ReviewPacketReference>;
  resume(examRunId: string): Promise<ExamRunResumeProjection>;
};
type LedgerDoc = ExamRunFormIdentity & {
  stations: ExamRunStationBinding[]; phaseEvents: AdmittedCanonicalPhaseEvent[];
  patientNotes: PatientNoteAdmission[]; actorProvenance: AdmittedActorPlanExecutionProvenance[];
  reviewPacketRefs: ReviewPacketReference[];
};
type LedgerStore = { load(examRunId: string): Promise<LedgerDoc | null>; save(doc: LedgerDoc): Promise<void> };

const EPOCH_MS = Date.parse("2026-05-03T15:38:58.000Z");
const PHASE_RANK = new Map<string, number>(ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES.map((eventType, index) => [eventType, index]));
const durableRef = (stationRunId: string, sequence: number) =>
  `durable://station-runs/${stationRunId}/events/${sequence}`;
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fp = (...parts: Array<string | number | boolean>) => parts.join("\0");

function requireField(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`exam-run ledger requires nonblank ${fieldName}`);
  }
}

function requireInt(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`exam-run ledger requires nonnegative integer ${fieldName}`);
  }
}

function requirePositiveInt(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`exam-run ledger requires positive integer ${fieldName}`);
  }
}

function isCanonicalType(value: string): value is CanonicalPhaseEventType {
  return (ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES as readonly string[]).includes(value);
}

function crossRun(stationRunId: string, examRunId: string): Error {
  return new Error(`cross-run contamination: stationRunId ${stationRunId} is not bound to examRunId ${examRunId}`);
}

function stale(detail: string): Error {
  return new Error(`stale-sequence contamination: ${detail}`);
}

function requireStation(doc: LedgerDoc, examRunId: string, stationRunId: string): ExamRunStationBinding {
  const station = doc.stations.find((entry) => entry.stationRunId === stationRunId);
  if (doc.examRunId !== examRunId || !station) {
    throw crossRun(stationRunId, examRunId);
  }
  return station;
}

function normalizeStations(stations: readonly ExamRunStationBinding[]): ExamRunStationBinding[] {
  if (stations.length === 0) {
    throw new Error("exam-run ledger requires an ordered station queue");
  }
  const seenOrders = new Set<number>();
  const seenRuns = new Set<string>();
  return stations
    .map((station) => {
      requirePositiveInt(station.stationOrder, "stationOrder");
      requireField(station.slotId, "slotId");
      requireField(station.stationRunId, "stationRunId");
      requireField(station.scenarioId ?? "", "scenarioId");
      if (seenOrders.has(station.stationOrder)) {
        throw new Error(`exam-run ledger stationOrder ${station.stationOrder} is duplicated`);
      }
      if (seenRuns.has(station.stationRunId)) {
        throw new Error(`exam-run ledger stationRunId ${station.stationRunId} is duplicated`);
      }
      seenOrders.add(station.stationOrder);
      seenRuns.add(station.stationRunId);
      return { ...station };
    })
    .sort((left, right) => left.stationOrder - right.stationOrder);
}

function stationKey(stations: readonly ExamRunStationBinding[]): string {
  return stations
    .map((station) =>
      [station.stationOrder, station.slotId, station.stationRunId, station.scenarioId ?? "", station.scenarioVersion ?? ""].join(":"),
    )
    .join("|");
}

function toTraceEvent(event: AdmittedCanonicalPhaseEvent): TraceEvent {
  return {
    stationRunId: event.stationRunId,
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    atSecond: event.atSecond,
    source: event.source,
    payload: {
      durableEventRef: event.durableEventRef,
      examRunId: event.examRunId,
      scenarioId: event.scenarioId,
      stationOrder: event.stationOrder,
      phase: event.phase,
      formAtSecond: event.formAtSecond,
      ...(event.advanceReason ? { advanceReason: event.advanceReason } : {}),
    },
  };
}

function applyOpen(existing: LedgerDoc | null, input: OpenExamRunInput): LedgerDoc {
  requireField(input.examRunId, "examRunId");
  requireField(input.examFormId, "examFormId");
  requireField(input.blueprintId, "blueprintId");
  const stations = normalizeStations(input.stations);
  if (!existing) {
    return {
      examRunId: input.examRunId,
      examFormId: input.examFormId,
      blueprintId: input.blueprintId,
      stations,
      phaseEvents: [],
      patientNotes: [],
      actorProvenance: [],
      reviewPacketRefs: [],
    };
  }
  if (existing.examFormId !== input.examFormId || existing.blueprintId !== input.blueprintId) {
    throw new Error(`exam run identity is immutable for ${input.examRunId}`);
  }
  if (stationKey(existing.stations) !== stationKey(stations)) throw new Error(`station queue is immutable for ${input.examRunId}`);
  return existing;
}

function applyPhaseEvent(doc: LedgerDoc, input: CanonicalPhaseEventAdmission) {
  if (input.examRunId !== doc.examRunId) throw crossRun(input.stationRunId, input.examRunId);
  const station = requireStation(doc, input.examRunId, input.stationRunId);
  requireInt(input.sequence, "sequence");
  requireInt(input.atSecond, "atSecond");
  requireInt(input.formAtSecond, "formAtSecond");
  requireField(input.eventType, "eventType");
  requireField(input.source, "source");
  requireField(input.scenarioId, "scenarioId");
  requirePositiveInt(input.stationOrder, "stationOrder");
  if (!isCanonicalType(input.eventType)) throw new Error(`exam-run ledger rejects noncanonical event type ${input.eventType}`);
  if (input.scenarioId !== station.scenarioId) {
    throw new Error(`cross-run contamination: scenarioId ${input.scenarioId} does not match bound ${station.scenarioId}`);
  }
  if (input.stationOrder !== station.stationOrder) {
    throw new Error(`cross-run contamination: stationOrder ${input.stationOrder} does not match bound ${station.stationOrder}`);
  }
  const expectedRef = durableRef(input.stationRunId, input.sequence);
  if (input.durableEventRef !== undefined && input.durableEventRef !== expectedRef) {
    throw new Error(`malformed durableEventRef: expected ${expectedRef}`);
  }
  if (input.eventType === "station.advanced" && !input.advanceReason?.trim()) throw new Error("station.advanced requires advanceReason");
  if (input.eventType !== "station.advanced" && input.advanceReason !== undefined) {
    throw new Error(`illegal advanceReason on ${input.eventType}`);
  }
  const event: AdmittedCanonicalPhaseEvent = {
    examRunId: input.examRunId, stationRunId: input.stationRunId, sequence: input.sequence,
    eventType: input.eventType, atSecond: input.atSecond, source: input.source, scenarioId: input.scenarioId,
    stationOrder: input.stationOrder, formAtSecond: input.formAtSecond,
    phase: ASSEMBLED_EXAM_PHASE_BY_TYPE[input.eventType], durableEventRef: expectedRef,
    occurredAt: new Date(EPOCH_MS + input.atSecond * 1000).toISOString(),
    ...(input.advanceReason ? { advanceReason: input.advanceReason } : {}),
  };
  const validation = validateTraceEvent(toTraceEvent(event));
  if (!validation.ok) throw new Error(`Invalid trace event: ${validation.errors.join("; ")}`);
  const eventFp = (row: AdmittedCanonicalPhaseEvent) => fp(
    row.examRunId, row.stationRunId, row.sequence, row.eventType, row.phase, row.scenarioId,
    row.stationOrder, row.atSecond, row.formAtSecond, row.source, row.durableEventRef, row.advanceReason ?? "",
  );
  const existing = doc.phaseEvents.find((row) => row.stationRunId === event.stationRunId && row.sequence === event.sequence);
  if (existing) {
    if (eventFp(existing) !== eventFp(event)) throw stale(`sequence ${event.sequence} already admitted for stationRunId ${event.stationRunId}`);
    return { doc, event: existing, unchanged: true };
  }
  const prior = doc.phaseEvents.filter((row) => row.stationRunId === event.stationRunId)
    .sort((left, right) => (PHASE_RANK.get(left.eventType) ?? -1) - (PHASE_RANK.get(right.eventType) ?? -1));
  const last = prior[prior.length - 1];
  const newRank = PHASE_RANK.get(event.eventType) ?? -1;
  if (prior.some((row) => row.eventType === event.eventType)) throw new Error(`out-of-order transition: ${event.eventType} already admitted`);
  if (last) {
    const lastRank = PHASE_RANK.get(last.eventType) ?? -1;
    if (newRank !== lastRank + 1 || event.atSecond < last.atSecond || event.formAtSecond < last.formAtSecond) {
      throw new Error(`out-of-order transition: ${event.eventType} after ${last.eventType}`);
    }
  } else if (newRank !== 0) {
    throw new Error(`out-of-order transition: ${event.eventType} cannot start a station`);
  }
  return { doc: { ...doc, phaseEvents: [...doc.phaseEvents, event] }, event, unchanged: false };
}

function applyPatientNote(doc: LedgerDoc, input: PatientNoteAdmission) {
  if (input.examRunId !== doc.examRunId) {
    throw crossRun(input.stationRunId, input.examRunId);
  }
  requireStation(doc, input.examRunId, input.stationRunId);
  const note: PatientNoteAdmission = {
    examRunId: input.examRunId,
    stationRunId: input.stationRunId,
    submittedAtSecond: input.submittedAtSecond,
    text: input.text,
  };
  const validation = validatePatientNote({
    stationRunId: note.stationRunId,
    submittedAtSecond: note.submittedAtSecond,
    text: note.text,
  });
  if (!validation.ok) throw new Error(`Invalid patient note: ${validation.errors.join("; ")}`);
  const existing = doc.patientNotes.find((row) => row.stationRunId === note.stationRunId);
  if (existing) {
    if (fp(existing.examRunId, existing.stationRunId, existing.submittedAtSecond, existing.text)
      !== fp(note.examRunId, note.stationRunId, note.submittedAtSecond, note.text)) {
      throw stale(`patient note already admitted for stationRunId ${note.stationRunId}`);
    }
    return { doc, note: existing, unchanged: true };
  }
  return { doc: { ...doc, patientNotes: [...doc.patientNotes, note] }, note, unchanged: false };
}

function applyActorProvenance(doc: LedgerDoc, input: ActorPlanExecutionProvenanceAdmission) {
  if (input.examRunId !== doc.examRunId) {
    throw crossRun(input.stationRunId, input.examRunId);
  }
  requireStation(doc, input.examRunId, input.stationRunId);
  requireField(input.turnId, "turnId");
  requireField(input.actorId, "actorId");
  requireField(input.planId, "planId");
  requireInt(input.sequence, "sequence");
  if (!input.hasPlan && !input.hasExecution) {
    throw new Error("actor plan/execution provenance requires hasPlan or hasExecution");
  }
  const record: AdmittedActorPlanExecutionProvenance = {
    ...input,
    durableEventRef: durableRef(input.stationRunId, input.sequence),
  };
  const provenanceFp = (row: AdmittedActorPlanExecutionProvenance) => fp(
    row.examRunId, row.stationRunId, row.turnId, row.actorId, row.planId,
    row.sequence, row.durableEventRef, row.hasPlan, row.hasExecution,
  );
  const existing = doc.actorProvenance.find((row) => row.stationRunId === record.stationRunId && row.turnId === record.turnId);
  if (existing) {
    if (provenanceFp(existing) !== provenanceFp(record)) {
      throw stale(`actor provenance already admitted for turnId ${record.turnId}`);
    }
    return { doc, record: existing, unchanged: true };
  }
  return { doc: { ...doc, actorProvenance: [...doc.actorProvenance, record] }, record, unchanged: false };
}

function applyReviewPacketRef(doc: LedgerDoc, packet: ReviewPacket) {
  const validation = validateReviewPacket(packet);
  if (!validation.ok) throw new Error(`Invalid review packet: ${validation.errors.join("; ")}`);
  requireStation(doc, doc.examRunId, packet.stationRunId);
  const ref: ReviewPacketReference = { examRunId: doc.examRunId, stationRunId: packet.stationRunId };
  const existing = doc.reviewPacketRefs.find((row) => row.stationRunId === ref.stationRunId);
  if (existing) {
    return { doc, ref: existing, unchanged: true };
  }
  return { doc: { ...doc, reviewPacketRefs: [...doc.reviewPacketRefs, ref] }, ref, unchanged: false };
}

function omit(kind: ExamRunOmissionKind, station: ExamRunStationBinding, reason: string): ExamRunOmission {
  return { kind, stationRunId: station.stationRunId, stationOrder: station.stationOrder, reason };
}

function projectResume(
  doc: LedgerDoc,
  backend: ExamRunLedgerBackend,
  missingPacketStationRunIds: ReadonlySet<string> = new Set(),
): ExamRunResumeProjection {
  const orderedStations = [...doc.stations].sort((left, right) => left.stationOrder - right.stationOrder);
  const orderOf = (stationRunId: string) =>
    orderedStations.find((station) => station.stationRunId === stationRunId)?.stationOrder ?? 0;
  const admittedPhaseEvents = [...doc.phaseEvents].sort((left, right) =>
    left.stationRunId === right.stationRunId ? left.sequence - right.sequence : orderOf(left.stationRunId) - orderOf(right.stationRunId),
  );
  const byStation = (left: { stationRunId: string }, right: { stationRunId: string }) =>
    left.stationRunId.localeCompare(right.stationRunId);
  const patientNotes = [...doc.patientNotes].sort(byStation);
  const actorProvenance = [...doc.actorProvenance].sort((left, right) =>
    left.stationRunId === right.stationRunId ? left.turnId.localeCompare(right.turnId) : byStation(left, right),
  );
  const reviewPacketRefs = [...doc.reviewPacketRefs].sort(byStation);
  const omissions: ExamRunOmission[] = [];
  for (const station of orderedStations) {
    const events = admittedPhaseEvents.filter((event) => event.stationRunId === station.stationRunId);
    if (events.length === 0) {
      omissions.push(omit("missing_phase_events", station, "no canonical phase events admitted"));
    }
    if (!patientNotes.some((note) => note.stationRunId === station.stationRunId)) {
      omissions.push(omit("missing_patient_note", station, "no patient-note submission admitted"));
    }
    if (!actorProvenance.some((record) => record.stationRunId === station.stationRunId)) {
      omissions.push(omit("missing_actor_provenance", station, "no actor plan/execution provenance admitted"));
    }
    if (!reviewPacketRefs.some((ref) => ref.stationRunId === station.stationRunId)) {
      omissions.push(omit("missing_review_packet_ref", station, "no assembled review packet reference attached"));
    } else if (missingPacketStationRunIds.has(station.stationRunId)) {
      omissions.push(omit("review_packet_record_missing", station, "review packet reference exists but station repository has no packet"));
    }
  }
  return {
    examRunId: doc.examRunId,
    backend,
    formIdentity: { examRunId: doc.examRunId, examFormId: doc.examFormId, blueprintId: doc.blueprintId },
    orderedStations: cloneJson(orderedStations),
    admittedPhaseEvents: cloneJson(admittedPhaseEvents),
    patientNotes: cloneJson(patientNotes),
    actorProvenance: cloneJson(actorProvenance),
    reviewPacketRefs: cloneJson(reviewPacketRefs),
    omissions,
    claimBoundary: examRunLedgerClaimBoundary,
    notEvidenceFor: examRunLedgerNotEvidenceFor,
    examEquivalenceGate: false,
  };
}

class ExamRunLedgerCore implements ExamRunLedger {
  constructor(
    readonly backend: ExamRunLedgerBackend,
    private readonly store: LedgerStore,
    private readonly writeThrough?: { traces?: MongoTraceRepository; reviewPackets?: MongoReviewPacketRepository },
    private readonly collection?: Collection<LedgerDoc>,
  ) {}

  async ensureIndexes(): Promise<void> {
    if (!this.collection) return;
    await this.collection.createIndex({ examRunId: 1 }, { unique: true });
    await this.collection.createIndex({ examFormId: 1, examRunId: 1 });
    await this.collection.createIndex({ "stations.stationRunId": 1, examRunId: 1 });
  }

  async openExamRun(input: OpenExamRunInput): Promise<ExamRunFormIdentity> {
    const existing = await this.store.load(input.examRunId);
    const next = applyOpen(existing, input);
    if (!existing) {
      await this.store.save(next);
    }
    return { examRunId: next.examRunId, examFormId: next.examFormId, blueprintId: next.blueprintId };
  }

  async admitCanonicalPhaseEvent(input: CanonicalPhaseEventAdmission): Promise<AdmittedCanonicalPhaseEvent> {
    const applied = applyPhaseEvent(await this.requireDoc(input.examRunId), input);
    if (!applied.unchanged) {
      await this.writeThrough?.traces?.upsertMany([toTraceEvent(applied.event)]);
      await this.store.save(applied.doc);
    }
    return cloneJson(applied.event);
  }

  async submitPatientNote(input: PatientNoteAdmission): Promise<PatientNoteAdmission> {
    const applied = applyPatientNote(await this.requireDoc(input.examRunId), input);
    if (!applied.unchanged) {
      await this.store.save(applied.doc);
    }
    return cloneJson(applied.note);
  }

  async recordActorPlanExecutionProvenance(
    input: ActorPlanExecutionProvenanceAdmission,
  ): Promise<AdmittedActorPlanExecutionProvenance> {
    const applied = applyActorProvenance(await this.requireDoc(input.examRunId), input);
    if (!applied.unchanged) {
      await this.store.save(applied.doc);
    }
    return cloneJson(applied.record);
  }

  async attachReviewPacketReference(examRunId: string, packet: ReviewPacket): Promise<ReviewPacketReference> {
    const applied = applyReviewPacketRef(await this.requireDoc(examRunId), packet);
    if (!applied.unchanged) {
      await this.writeThrough?.reviewPackets?.save(packet);
      await this.store.save(applied.doc);
    }
    return cloneJson(applied.ref);
  }

  async resume(examRunId: string): Promise<ExamRunResumeProjection> {
    const doc = await this.requireDoc(examRunId);
    const missingPacketStationRunIds = new Set<string>();
    if (this.writeThrough?.reviewPackets) {
      for (const ref of doc.reviewPacketRefs) {
        if (!(await this.writeThrough.reviewPackets.findByStationRunId(ref.stationRunId))) {
          missingPacketStationRunIds.add(ref.stationRunId);
        }
      }
    }
    return projectResume(doc, this.backend, missingPacketStationRunIds);
  }

  private async requireDoc(examRunId: string): Promise<LedgerDoc> {
    requireField(examRunId, "examRunId");
    const doc = await this.store.load(examRunId);
    if (!doc) throw new Error(`exam run not found: ${examRunId}`);
    return doc;
  }
}

export class MemoryExamRunLedger extends ExamRunLedgerCore {
  constructor() {
    const documents = new Map<string, LedgerDoc>();
    super("memory", {
      async load(examRunId) {
        const doc = documents.get(examRunId);
        return doc ? cloneJson(doc) : null;
      },
      async save(doc) { documents.set(doc.examRunId, cloneJson(doc)); },
    });
  }
}

export class MongoExamRunLedger extends ExamRunLedgerCore {
  constructor(db: Db) {
    const collection = db.collection<LedgerDoc>("exam_run_ledgers");
    super(
      "mongodb",
      {
        async load(examRunId) {
          return collection.findOne({ examRunId }, { projection: { _id: 0 } });
        },
        async save(doc) {
          await collection.updateOne({ examRunId: doc.examRunId }, { $set: cloneJson(doc) }, { upsert: true });
        },
      },
      { traces: new MongoTraceRepository(db), reviewPackets: new MongoReviewPacketRepository(db) },
      collection,
    );
  }
}

export function createExamRunLedger(db?: Db): ExamRunLedger {
  return db ? new MongoExamRunLedger(db) : new MemoryExamRunLedger();
}
