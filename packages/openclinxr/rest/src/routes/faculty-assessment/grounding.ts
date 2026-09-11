import type { AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import { scenarioBank } from "@openclinxr/scenario-fixtures";
import type {
  ApiFacultyAssessmentEvidenceCite,
  ApiFacultyCriterionObservation,
} from "../../runtime-durable-store.js";

export type FacultyObservationInput = {
  observationId?: string;
  rubricItemId: string;
  stationRunId: string;
  comment: string;
  evidenceCites: readonly ApiFacultyAssessmentEvidenceCite[];
};

export type GroundingFailure = {
  error: "rubric_ungrounded" | "observation_missing_evidence" | "evidence_not_in_packet" | "invalid_body";
  reason: string;
};

type RubricItem = {
  rubricId: string;
  requiredTraceTags: readonly string[];
};

type StationSlice = AssembledExamReviewPacket["stations"][number];

export function groundObservations(
  packet: AssembledExamReviewPacket,
  inputs: readonly FacultyObservationInput[],
): readonly ApiFacultyCriterionObservation[] | GroundingFailure {
  if (inputs.length === 0) {
    return { error: "invalid_body", reason: "observations_required" };
  }
  const grounded: ApiFacultyCriterionObservation[] = [];
  for (const [index, input] of inputs.entries()) {
    const observation = groundOne(packet, input, index);
    if ("error" in observation) {
      return observation;
    }
    grounded.push(observation);
  }
  return grounded;
}

function groundOne(
  packet: AssembledExamReviewPacket,
  input: FacultyObservationInput,
  index: number,
): ApiFacultyCriterionObservation | GroundingFailure {
  const rubricItemId = input.rubricItemId.trim();
  const stationRunId = input.stationRunId.trim();
  const comment = input.comment.trim();
  if (rubricItemId.length === 0) {
    return { error: "invalid_body", reason: "rubricItemId_required" };
  }
  if (stationRunId.length === 0) {
    return { error: "invalid_body", reason: "stationRunId_required" };
  }
  if (comment.length === 0) {
    return { error: "invalid_body", reason: "observation_comment_required" };
  }
  const stationIndex = packet.stations.findIndex((slice) => slice.identity.stationRunId === stationRunId);
  if (stationIndex < 0) {
    return { error: "evidence_not_in_packet", reason: "station_not_in_packet" };
  }
  const station = packet.stations[stationIndex];
  if (!station) {
    return { error: "evidence_not_in_packet", reason: "station_not_in_packet" };
  }
  const rubric = rubricItemFor(station.identity.scenarioId, rubricItemId);
  if (!rubric) {
    return { error: "rubric_ungrounded", reason: "unknown_rubric_item" };
  }
  if (input.evidenceCites.length === 0) {
    return { error: "observation_missing_evidence", reason: "evidence_cite_required" };
  }
  const cites: ApiFacultyAssessmentEvidenceCite[] = [];
  let rubricLinked = false;
  for (const cite of input.evidenceCites) {
    const resolved = resolveCite(packet, station, stationIndex, cite);
    if ("error" in resolved) {
      return resolved;
    }
    cites.push(resolved);
    if (citeLinksRubric(packet, station, resolved, rubric)) {
      rubricLinked = true;
    }
  }
  if (!rubricLinked) {
    return { error: "rubric_ungrounded", reason: "evidence_does_not_cite_rubric_item" };
  }
  const observationId = typeof input.observationId === "string" ? input.observationId.trim() : "";
  return {
    observationId: observationId.length > 0
      ? observationId
      : `faculty_observation:${packet.examRunId}:${index + 1}`,
    rubricItemId: rubric.rubricId,
    stationRunId,
    comment,
    evidenceCites: cites,
  };
}

function rubricItemFor(scenarioId: string, rubricItemId: string): RubricItem | undefined {
  const scenario = scenarioBank.find((entry) => entry.scenarioId === scenarioId);
  const item = scenario?.reviewRubric.find((rubric) => rubric.rubricId === rubricItemId);
  if (!item) {
    return undefined;
  }
  return { rubricId: item.rubricId, requiredTraceTags: item.requiredTraceTags };
}

function resolveCite(
  packet: AssembledExamReviewPacket,
  station: StationSlice,
  stationIndex: number,
  cite: ApiFacultyAssessmentEvidenceCite,
): ApiFacultyAssessmentEvidenceCite | GroundingFailure {
  const stationRunId = cite.stationRunId.trim();
  const packetField = cite.packetField.trim();
  if (stationRunId.length === 0 || stationRunId !== station.identity.stationRunId) {
    return { error: "evidence_not_in_packet", reason: "cite_station_mismatch" };
  }
  if (packetField.length === 0 || !packetField.includes(`stations[${stationIndex}]`)) {
    return { error: "evidence_not_in_packet", reason: "packet_field_not_in_packet" };
  }
  if (cite.sequence !== undefined) {
    const timelineHit = station.reviewPacket.timeline.some((entry) => entry.sequence === cite.sequence);
    const examHit = packet.examTimeline.some(
      (entry) => entry.stationRunId === stationRunId && entry.sequence === cite.sequence,
    );
    if (!timelineHit && !examHit) {
      return { error: "evidence_not_in_packet", reason: "sequence_not_in_packet" };
    }
  }
  if (cite.durableEventRef) {
    const hit = station.phaseTransitions.some((phase) => phase.durableEventRef === cite.durableEventRef);
    if (!hit) {
      return { error: "evidence_not_in_packet", reason: "durable_event_not_in_packet" };
    }
  }
  if (cite.tag) {
    const observed = station.reviewPacket.observedTraceTags.includes(cite.tag)
      || station.reviewPacket.timeline.some((entry) => entry.tag === cite.tag)
      || station.omissions.some((omission) => omission.includes(cite.tag ?? ""));
    if (!observed) {
      return { error: "evidence_not_in_packet", reason: "tag_not_in_packet" };
    }
  }
  if (cite.eventType) {
    const hit = station.reviewPacket.timeline.some((entry) => entry.eventType === cite.eventType)
      || station.phaseTransitions.some((phase) => phase.eventType === cite.eventType)
      || packet.examTimeline.some(
        (entry) => entry.stationRunId === stationRunId && entry.eventType === cite.eventType,
      );
    if (!hit) {
      return { error: "evidence_not_in_packet", reason: "event_type_not_in_packet" };
    }
  }
  return {
    packetField,
    stationRunId,
    ...(cite.sequence !== undefined ? { sequence: cite.sequence } : {}),
    ...(cite.durableEventRef ? { durableEventRef: cite.durableEventRef } : {}),
    ...(cite.eventType ? { eventType: cite.eventType } : {}),
    ...(cite.tag ? { tag: cite.tag } : {}),
  };
}

function citeLinksRubric(
  packet: AssembledExamReviewPacket,
  station: StationSlice,
  cite: ApiFacultyAssessmentEvidenceCite,
  rubric: RubricItem,
): boolean {
  const tags = new Set(rubric.requiredTraceTags);
  if (cite.tag && tags.has(cite.tag)) {
    return true;
  }
  if (cite.sequence !== undefined) {
    const entry = station.reviewPacket.timeline.find((item) => item.sequence === cite.sequence);
    if (entry?.tag && tags.has(entry.tag)) {
      return true;
    }
  }
  if (tags.has("patient_note_submitted") && cite.packetField.includes("patientNoteSubmitted")) {
    return true;
  }
  if (cite.packetField.includes(".omissions")) {
    return station.omissions.some((omission) =>
      rubric.requiredTraceTags.some((tag) => omission.includes(tag)),
    ) || packet.omissions.some((omission) =>
      rubric.requiredTraceTags.some((tag) => omission.includes(tag)),
    );
  }
  return false;
}
