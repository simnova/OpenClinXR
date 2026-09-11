import { scenarioBank } from "@openclinxr/scenario-fixtures";
import type { AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import type { ApiFacultyAssessmentRecord } from "../../runtime-durable-store.js";

export type CriterionComparison = {
  rubricItemId: string;
  stationRunId: string;
  leftRating: string | null;
  rightRating: string | null;
  ratingsAgree: boolean;
};

export type CriterionAnchor = {
  rubricItemId: string;
  stationRunId: string;
  label: string;
};

function observationKey(stationRunId: string, rubricItemId: string): string {
  return `${stationRunId}::${rubricItemId}`;
}

function ratingsByKey(assessment: ApiFacultyAssessmentRecord): Map<string, string> {
  const ratings = new Map<string, string>();
  for (const observation of assessment.observations) {
    ratings.set(observationKey(observation.stationRunId, observation.rubricItemId), observation.rating);
  }
  return ratings;
}

export type SealedFacultyAssessment = ApiFacultyAssessmentRecord & {
  sealedAssessmentId: string;
  sealedAt: string;
};

function isSealed(entry: ApiFacultyAssessmentRecord): entry is SealedFacultyAssessment {
  return typeof entry.sealedAssessmentId === "string"
    && entry.sealedAssessmentId.length === 64
    && typeof entry.sealedAt === "string"
    && entry.sealedAt.length > 0;
}

export function sealedPair(
  assessments: readonly ApiFacultyAssessmentRecord[],
): readonly [SealedFacultyAssessment, SealedFacultyAssessment] | undefined {
  const uniqueRaters = new Map<string, SealedFacultyAssessment>();
  for (const entry of assessments) {
    if (isSealed(entry) && !uniqueRaters.has(entry.raterId)) {
      uniqueRaters.set(entry.raterId, entry);
    }
  }
  const pair = [...uniqueRaters.values()];
  const left = pair[0];
  const right = pair[1];
  if (!left || !right) {
    return undefined;
  }
  return [left, right];
}

export function compareCriteria(
  left: ApiFacultyAssessmentRecord,
  right: ApiFacultyAssessmentRecord,
): readonly CriterionComparison[] {
  const leftRatings = ratingsByKey(left);
  const rightRatings = ratingsByKey(right);
  const keys = new Set([...leftRatings.keys(), ...rightRatings.keys()]);
  return [...keys].sort().map((key) => {
    const separator = key.indexOf("::");
    const stationRunId = key.slice(0, separator);
    const rubricItemId = key.slice(separator + 2);
    const leftRating = leftRatings.get(key) ?? null;
    const rightRating = rightRatings.get(key) ?? null;
    return {
      rubricItemId,
      stationRunId,
      leftRating,
      rightRating,
      ratingsAgree: leftRating !== null && leftRating === rightRating,
    };
  });
}

export function anchorsFor(
  packet: AssembledExamReviewPacket,
  comparisons: readonly CriterionComparison[],
): readonly CriterionAnchor[] {
  return comparisons.map((criterion) => ({
    rubricItemId: criterion.rubricItemId,
    stationRunId: criterion.stationRunId,
    label: rubricLabel(packet, criterion.stationRunId, criterion.rubricItemId),
  }));
}

function rubricLabel(
  packet: AssembledExamReviewPacket,
  stationRunId: string,
  rubricItemId: string,
): string {
  const station = packet.stations.find((slice) => slice.identity.stationRunId === stationRunId);
  const scenario = scenarioBank.find((entry) => entry.scenarioId === station?.identity.scenarioId);
  const item = scenario?.reviewRubric.find((rubric) => rubric.rubricId === rubricItemId);
  return item?.label ?? rubricItemId;
}
