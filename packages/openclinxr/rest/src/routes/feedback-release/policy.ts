import type { AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import type { ApiAssembledExamDispositionRecord } from "../../runtime-durable-store.js";

export function feedbackReleaseCompleteness(packet: AssembledExamReviewPacket): {
  complete: boolean;
  omissions: readonly string[];
} {
  const omissions = unique([
    ...packet.omissions,
    ...packet.stations.flatMap((station) => [
      ...station.omissions,
      ...station.blockers.map((blocker) => `station_blocker:${station.identity.stationRunId}:${blocker}`),
    ]),
  ]);
  return { complete: omissions.length === 0, omissions };
}

export function feedbackReleasePolicyBlockers(record: ApiAssembledExamDispositionRecord): readonly string[] {
  const blockers: string[] = [];
  const current = record.decisions[record.decisions.length - 1];
  if (!current) {
    blockers.push("disposition_missing");
    return blockers;
  }
  if (current.status !== "final") {
    blockers.push("disposition_not_final");
  }
  if (current.disposition !== "local_debrief_ready") {
    blockers.push("disposition_not_releasable");
  }
  if (record.scoringValidityClaimed) {
    blockers.push("scoring_validity_claimed");
  }
  if (record.examEquivalenceGate) {
    blockers.push("exam_equivalence_gate");
  }
  return blockers;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
