import type { FacultyDispositionRefusalCode, FacultyDispositionStatus, FacultyDispositionValue } from "@openclinxr/graphql/client";
import {
  FACULTY_DISPOSITION_CLAIM_BOUNDARY,
  REFUSAL_TITLE,
  isRecord,
  readString,
  readStringArray,
} from "./faculty-disposition-record.js";
import type {
  AdminFacultyDispositionDecision,
  AdminFacultyDispositionRefusal,
  AdminFacultyDispositionTrail,
} from "./faculty-disposition-record.js";

export function asTrail(value: unknown): AdminFacultyDispositionTrail | null {
  if (!isRecord(value)) {
    return null;
  }
  const examRunId = readString(value, "examRunId");
  const packetDigest = readString(value, "packetDigest");
  if (!examRunId || !packetDigest || typeof value["code"] === "string") {
    return null;
  }
  const evidence = isRecord(value["evidencePacket"]) ? value["evidencePacket"] : {};
  const rawDecisions = value["decisions"];
  const decisions = Array.isArray(rawDecisions)
    ? rawDecisions.flatMap((item, index) => {
      if (!isRecord(item)) {
        return [];
      }
      const decisionId = readString(item, "decisionId");
      const reviewerId = readString(item, "reviewerId");
      const sequenceValue = item["sequence"];
      if (!decisionId || !reviewerId) {
        return [];
      }
      const decision: AdminFacultyDispositionDecision = {
        decisionId,
        examRunId: readString(item, "examRunId") ?? examRunId,
        reviewerId,
        packetDigest: readString(item, "packetDigest") ?? packetDigest,
        disposition: item["disposition"] as FacultyDispositionValue,
        status: item["status"] as FacultyDispositionStatus,
        rationale: readString(item, "rationale") ?? "",
        attestedAt: readString(item, "attestedAt") ?? "",
        sequence: typeof sequenceValue === "number" ? sequenceValue : index + 1,
      };
      return [decision];
    })
    : [];
  return {
    examRunId,
    packetDigest,
    evidencePacket: {
      examRunId: readString(evidence, "examRunId") ?? examRunId,
      packetDigest: readString(evidence, "packetDigest") ?? packetDigest,
      learnerId: readString(evidence, "learnerId"),
      stationRunIds: readStringArray(evidence, "stationRunIds"),
      claimBoundary: readString(evidence, "claimBoundary") ?? FACULTY_DISPOSITION_CLAIM_BOUNDARY,
      notEvidenceFor: readStringArray(evidence, "notEvidenceFor"),
      examEquivalenceGate: false,
    },
    decisions,
    current: decisions[decisions.length - 1] ?? null,
    claimBoundary: readString(value, "claimBoundary") ?? FACULTY_DISPOSITION_CLAIM_BOUNDARY,
    notEvidenceFor: readStringArray(value, "notEvidenceFor"),
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}

export function asRefusal(value: unknown): AdminFacultyDispositionRefusal | null {
  if (!isRecord(value)) {
    return null;
  }
  const code = value["code"];
  if (typeof code !== "string" || !(code in REFUSAL_TITLE)) {
    return null;
  }
  return {
    code: code as FacultyDispositionRefusalCode,
    reason: readString(value, "reason") ?? code,
    notEvidenceFor: readStringArray(value, "notEvidenceFor"),
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}
