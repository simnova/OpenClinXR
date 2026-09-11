/**
 * Persistence shape for one immutable learner encounter event.
 *
 * Internal to telemetry. Not on the package entrypoint. The record is a local
 * structural type — this module does not import review-workflow.
 *
 * Faculty debrief reads the same fields as plain data. Learner-safe attributes
 * carry ids and kind only so a high-cardinality statement cannot leak into labels.
 */

export const DURABLE_LEARNER_EVENT_SPAN_NAME = "openclinxr.learner.durable_event" as const;

export const DURABLE_LEARNER_EVENT_CLAIM_SCOPE = "durable_learner_event_not_score_use" as const;

export const DURABLE_LEARNER_EVENT_NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "autonomous_score",
  "diagnosis_correctness",
] as const;

export type DurableLearnerEventKind =
  | "learner.hypothesis"
  | "learner.hypothesis.changed"
  | "learner.observation"
  | "note.submitted"
  | "actor.response.generated";

export type DurableLearnerEventRelation = "supports" | "contradicts";

export type DurableLearnerEventRecord = {
  eventId: string;
  stationRunId: string;
  scenarioId: string;
  atSecond: number;
  sequence: number;
  kind: DurableLearnerEventKind;
  relation: DurableLearnerEventRelation | null;
  statement: string;
  relatedEventIds: readonly string[];
};

export type LearnerSafeDurableEventAttributes = {
  "openclinxr.scenario_id": string;
  "openclinxr.station_run_id": string;
  "openclinxr.learner.event_id": string;
  "openclinxr.learner.event_kind": DurableLearnerEventKind;
  "openclinxr.learner.related_event_ids": string;
};

export type PersistedDurableLearnerEvent = {
  spanName: typeof DURABLE_LEARNER_EVENT_SPAN_NAME;
  record: DurableLearnerEventRecord;
  learnerSafeAttributes: LearnerSafeDurableEventAttributes;
  claimScope: typeof DURABLE_LEARNER_EVENT_CLAIM_SCOPE;
  notEvidenceFor: typeof DURABLE_LEARNER_EVENT_NOT_EVIDENCE_FOR;
};

export function persistDurableLearnerEvent(record: DurableLearnerEventRecord): PersistedDurableLearnerEvent {
  const eventId = record.eventId.trim();
  if (eventId.length === 0) {
    throw new Error("durable learner event requires source event id");
  }

  const relatedEventIds = record.relatedEventIds.map((relatedId) => relatedId.trim());
  if (relatedEventIds.some((relatedId) => relatedId.length === 0)) {
    throw new Error("durable learner event relatedEventIds cannot contain empty ids");
  }

  return {
    spanName: DURABLE_LEARNER_EVENT_SPAN_NAME,
    record: Object.freeze({
      eventId,
      stationRunId: record.stationRunId,
      scenarioId: record.scenarioId,
      atSecond: record.atSecond,
      sequence: record.sequence,
      kind: record.kind,
      relation: record.relation,
      statement: record.statement,
      relatedEventIds: Object.freeze([...relatedEventIds]),
    }),
    learnerSafeAttributes: {
      "openclinxr.scenario_id": record.scenarioId,
      "openclinxr.station_run_id": record.stationRunId,
      "openclinxr.learner.event_id": eventId,
      "openclinxr.learner.event_kind": record.kind,
      "openclinxr.learner.related_event_ids": relatedEventIds.join(","),
    },
    claimScope: DURABLE_LEARNER_EVENT_CLAIM_SCOPE,
    notEvidenceFor: DURABLE_LEARNER_EVENT_NOT_EVIDENCE_FOR,
  };
}
