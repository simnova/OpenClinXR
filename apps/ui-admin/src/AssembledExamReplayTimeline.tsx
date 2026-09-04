import { Tag, Typography } from "antd";
import type { ReactElement } from "react";

export const ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES = [
  "encounter.started",
  "encounter.ended",
  "note.started",
  "note.submitted",
  "station.advanced",
] as const;

export const ASSEMBLED_EXAM_PHASE_BY_TYPE = {
  "encounter.started": "encounter",
  "encounter.ended": "encounter",
  "note.started": "note",
  "note.submitted": "note",
  "station.advanced": "complete",
} as const;

export type AdminAssembledExamPhaseTransitionType =
  (typeof ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES)[number];

export type AdminAssembledExamPhaseTransition = {
  eventType: AdminAssembledExamPhaseTransitionType;
  sequence: number;
  atSecond: number;
  formAtSecond: number;
  phase: "encounter" | "note" | "complete";
  advanceReason: string | null;
  durableEventRef: string;
};

export type AdminAssembledExamStationReplaySlice = {
  examRunId: string;
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  advanceReason: string | null;
  blockers: readonly string[];
  omissions: readonly string[];
  patientNoteSubmitted: boolean;
  phaseTransitions: readonly AdminAssembledExamPhaseTransition[];
};

export type AdminAssembledExamReplayProjection = {
  schemaVersion: "openclinxr.assembled-exam-replay-projection.v1";
  examRunId: string;
  stations: readonly AdminAssembledExamStationReplaySlice[];
  claimBoundary: "summary_only_assembled_exam_phase_timeline_not_score_use_or_clinical_validity";
  examEquivalenceGate: false;
  scoringValidityClaimed: false;
  clinicalValidityClaimed: false;
  rawPayloadDisplayed: false;
  notEvidenceFor: readonly string[];
};

export type AssembledExamStationReplayPosture =
  | "complete_encounter_to_note_timeline"
  | "summary_only_station_started";

export type AssembledExamReplayTimelineProps = {
  projection: AdminAssembledExamReplayProjection;
};

export function assembledExamDerivedBlockers(
  station: AdminAssembledExamStationReplaySlice,
): string[] {
  const blockers: string[] = [];
  const events = station.phaseTransitions;
  const seen = new Set<string>();
  for (const event of events) {
    if (!isPhaseTransitionType(event.eventType)) {
      blockers.push(`derived_unknown_phase_transition:${String(event.eventType)}`);
      continue;
    }
    if (seen.has(event.eventType)) {
      blockers.push(`derived_duplicate_phase_transition:${event.eventType}`);
    }
    seen.add(event.eventType);
  }
  for (const eventType of ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES) {
    if (!seen.has(eventType)) {
      blockers.push(`derived_missing_phase_transition:${eventType}`);
    }
  }
  const observedTypes = events
    .map((event) => event.eventType)
    .filter(isPhaseTransitionType);
  const uniqueObserved = uniquePreserve(observedTypes);
  const canonicalPresent = ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES.filter((eventType) => seen.has(eventType));
  if (uniqueObserved.length > 0 && !sameStringArray(uniqueObserved, canonicalPresent)) {
    blockers.push("derived_reordered_phase_transitions");
  }
  if (
    seen.size === ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES.length
    && !sameStringArray(observedTypes, [...ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES])
  ) {
    blockers.push("derived_reordered_phase_transitions");
  }

  for (const [index, event] of events.entries()) {
    if (
      !isNonNegativeInteger(event.sequence)
      || !isNonNegativeInteger(event.atSecond)
      || !isNonNegativeInteger(event.formAtSecond)
    ) {
      blockers.push("derived_malformed_phase_transition_numeric");
    }
    const expectedRef = `durable://station-runs/${station.stationRunId}/events/${event.sequence}`;
    if (event.durableEventRef !== expectedRef) {
      blockers.push("derived_forged_durable_event_ref");
    }
    if (isPhaseTransitionType(event.eventType) && event.phase !== ASSEMBLED_EXAM_PHASE_BY_TYPE[event.eventType]) {
      blockers.push("derived_phase_event_mismatch");
    }
    if (event.eventType === "station.advanced") {
      if (!event.advanceReason) {
        blockers.push("derived_missing_advance_reason");
      } else if (event.advanceReason !== station.advanceReason) {
        blockers.push("derived_advance_reason_mismatch");
      }
    } else if (event.advanceReason) {
      blockers.push("derived_misplaced_advance_reason");
    }
    if (index > 0) {
      const previous = events[index - 1];
      if (previous && !(event.sequence > previous.sequence)) {
        blockers.push("derived_non_increasing_sequence");
      }
      if (previous && (event.atSecond < previous.atSecond || event.formAtSecond < previous.formAtSecond)) {
        blockers.push("derived_decreasing_timestamps");
      }
    }
  }
  if (!station.advanceReason) {
    blockers.push("derived_missing_advance_reason");
  }
  return uniquePreserve(blockers);
}

export function assembledExamStationReplayPosture(
  station: AdminAssembledExamStationReplaySlice,
): AssembledExamStationReplayPosture {
  return assembledExamDerivedBlockers(station).length === 0
    ? "complete_encounter_to_note_timeline"
    : "summary_only_station_started";
}

export function AssembledExamReplayTimeline({
  projection,
}: AssembledExamReplayTimelineProps): ReactElement {
  const stations = [...projection.stations].sort((left, right) => left.stationOrder - right.stationOrder);
  return (
    <section className="workbench-panel" aria-label="Assembled exam replay timeline">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Encounter-to-note faculty projection</Typography.Text>
          <Typography.Title level={4}>Assembled Exam Replay Timeline</Typography.Title>
        </div>
        <Tag color="gold">Summary-only phase timeline</Tag>
      </div>
      <Typography.Paragraph type="secondary">
        Faculty projection of encounter start/end, note start/submission, and station advance in assembled order.
        Private trace payloads are not displayed. This does not approve score use, clinical validity, exam equivalence, or Quest readiness.
      </Typography.Paragraph>
      <fieldset className="readiness-strip review-replay-strip" aria-label="Assembled exam replay claim boundary">
        <div className="readiness-metric">
          <Typography.Text strong>{projection.examRunId}</Typography.Text>
          <Typography.Text type="secondary">{projection.claimBoundary}</Typography.Text>
        </div>
        <div className="readiness-metric">
          <Typography.Text strong>
            {projection.rawPayloadDisplayed ? "Private payload visible" : "Private payload not displayed"}
          </Typography.Text>
          <Typography.Text type="secondary">{`examEquivalenceGate ${String(projection.examEquivalenceGate)}; scoring ${String(projection.scoringValidityClaimed)}; clinical ${String(projection.clinicalValidityClaimed)}`}</Typography.Text>
        </div>
        <div className="readiness-metric">
          <Typography.Text strong>{`${stations.length} stations in assembled order`}</Typography.Text>
          <Typography.Text type="secondary">{`not evidence for ${projection.notEvidenceFor.join(", ")}`}</Typography.Text>
        </div>
      </fieldset>
      {stations.map((station) => (
        <AssembledExamStationReplayCard key={station.stationRunId} station={station} />
      ))}
    </section>
  );
}

function AssembledExamStationReplayCard({
  station,
}: {
  station: AdminAssembledExamStationReplaySlice;
}): ReactElement {
  const posture = assembledExamStationReplayPosture(station);
  const complete = posture === "complete_encounter_to_note_timeline";
  const blockers = uniquePreserve([
    ...assembledExamDerivedBlockers(station),
    ...station.blockers,
    ...station.omissions,
  ]);
  return (
    <section aria-label={`Assembled station ${station.stationOrder} ${station.scenarioId}`}>
      <div className="workbench-title-row">
        <Typography.Text strong>{`Station ${station.stationOrder}: ${station.scenarioId}`}</Typography.Text>
        <Tag color={complete ? "green" : "gold"}>
          {complete ? "Complete replayable station" : "Summary-only station.started"}
        </Tag>
      </div>
      <Typography.Paragraph type="secondary">
        {complete
          ? "Complete encounter-to-note timeline with durable event refs and a final advance reason."
          : "Summary-only station.started; this is not a complete replayable encounter-to-note timeline."}
      </Typography.Paragraph>
      <fieldset className="readiness-strip review-replay-strip" aria-label={`Station ${station.stationOrder} identity`}>
        <div className="readiness-metric">
          <Typography.Text strong>{station.stationRunId}</Typography.Text>
          <Typography.Text type="secondary">{`examRunId ${station.examRunId}`}</Typography.Text>
        </div>
        <div className="readiness-metric">
          <Typography.Text strong>Replay posture</Typography.Text>
          <Typography.Text type="secondary">{posture}</Typography.Text>
        </div>
        <div className="readiness-metric">
          <Typography.Text strong>
            {station.patientNoteSubmitted ? "Patient note submitted" : "Patient note missing"}
          </Typography.Text>
          <Typography.Text type="secondary">{`advance reason ${station.advanceReason ?? "missing"}`}</Typography.Text>
        </div>
      </fieldset>
      <Typography.Text strong>Encounter-to-note phase transitions</Typography.Text>
      <ul className="compact-list" aria-label={`Station ${station.stationOrder} phase transitions`}>
        {station.phaseTransitions.length > 0 ? station.phaseTransitions.map((event) => (
          <li key={`${station.stationRunId}:${event.eventType}:${event.sequence}`}>
            <Typography.Text>{`${event.eventType} at ${event.atSecond}s (form ${event.formAtSecond}s)`}</Typography.Text>
            <Typography.Text type="secondary">
              {`phase ${event.phase}; durable ${event.durableEventRef}${event.advanceReason ? `; advanceReason ${event.advanceReason}` : ""}`}
            </Typography.Text>
          </li>
        )) : (
          <li>
            <Typography.Text>no_phase_transitions; station.started summary only</Typography.Text>
          </li>
        )}
      </ul>
      <Typography.Text strong>Final advance reason</Typography.Text>
      <Typography.Paragraph type="secondary" aria-label={`Station ${station.stationOrder} advance reason`}>
        {station.advanceReason ?? "missing_advance_reason"}
      </Typography.Paragraph>
      <Typography.Text strong>Missing and out-of-order blockers</Typography.Text>
      <ul className="compact-list" aria-label={`Station ${station.stationOrder} missing and out-of-order blockers`}>
        {blockers.length > 0 ? blockers.map((blocker) => (
          <li key={blocker}>
            <Typography.Text>{blocker}</Typography.Text>
          </li>
        )) : (
          <li>
            <Typography.Text>no_missing_or_out_of_order_blockers</Typography.Text>
          </li>
        )}
      </ul>
    </section>
  );
}

function uniquePreserve(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isPhaseTransitionType(value: string): value is AdminAssembledExamPhaseTransitionType {
  return (ASSEMBLED_EXAM_PHASE_TRANSITION_TYPES as readonly string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
