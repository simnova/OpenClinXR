import type { FacultyDispositionRefusalCode, FacultyDispositionStatus, FacultyDispositionValue } from "@openclinxr/graphql/client";

export const FACULTY_DISPOSITION_VALUES = ["hold", "local_debrief_ready", "needs_revision"] as const satisfies readonly FacultyDispositionValue[];

export const FACULTY_DISPOSITION_CLAIM_BOUNDARY = "assembled_exam_faculty_disposition_not_score_use" as const;

export const DISPOSITION_LABEL: Record<FacultyDispositionValue, string> = {
  hold: "Hold",
  local_debrief_ready: "Local debrief ready",
  needs_revision: "Needs revision",
};

export const REFUSAL_TITLE: Record<FacultyDispositionRefusalCode, string> = {
  stale_packet_digest: "Stale packet digest",
  producer_self_review: "Producer self-review refused",
  identity_mutation: "Reviewer identity mutation refused",
  overwrite_refused: "Overwrite refused",
  finalized: "Disposition already finalized",
};

export type AdminFacultyDispositionDecision = {
  decisionId: string;
  examRunId: string;
  reviewerId: string;
  packetDigest: string;
  disposition: FacultyDispositionValue;
  status: FacultyDispositionStatus;
  rationale: string;
  attestedAt: string;
  sequence: number;
};

export type AdminFacultyDispositionTrail = {
  examRunId: string;
  packetDigest: string;
  evidencePacket: {
    examRunId: string;
    packetDigest: string;
    learnerId: string | null;
    stationRunIds: readonly string[];
    claimBoundary: string;
    notEvidenceFor: readonly string[];
    examEquivalenceGate: false;
  };
  decisions: readonly AdminFacultyDispositionDecision[];
  current: AdminFacultyDispositionDecision | null;
  claimBoundary: string;
  notEvidenceFor: readonly string[];
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
};

export type AdminFacultyDispositionRefusal = {
  code: FacultyDispositionRefusalCode;
  reason: string;
  notEvidenceFor: readonly string[];
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
};

export type AppendFacultyDispositionCommand = {
  examRunId: string;
  reviewerId: string;
  packetDigest: string;
  disposition: FacultyDispositionValue;
  status: FacultyDispositionStatus;
  rationale: string;
  attestedAt: string;
  decisionId?: string;
};

export type FacultyDispositionTransport = {
  fetch?: typeof fetch;
  baseUrl?: string;
};

export function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function isRefusal(value: AdminFacultyDispositionTrail | AdminFacultyDispositionRefusal): value is AdminFacultyDispositionRefusal {
  return "code" in value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
