import type {
  FacultyDispositionRefusalCode,
  FacultyDispositionStatus,
  FacultyDispositionValue,
} from "@openclinxr/graphql/client";

export const ADMIN_GRAPHQL_EXECUTE_PATH = "/admin/graphql";

export const ASSEMBLED_EXAM_FACULTY_DISPOSITION_OPERATION = "AssembledExamFacultyDisposition";
export const APPEND_ASSEMBLED_EXAM_FACULTY_DISPOSITION_OPERATION = "AppendAssembledExamFacultyDisposition";

/** Generated operations from packages/openclinxr/graphql/src/documents/faculty-disposition.graphql */
export const FACULTY_DISPOSITION_DOCUMENT_SOURCE = `fragment FacultyDispositionTrailFields on FacultyDispositionTrail {
  examRunId
  packetDigest
  evidencePacket {
    examRunId
    packetDigest
    learnerId
    stationRunIds
    claimBoundary
    notEvidenceFor
    examEquivalenceGate
  }
  decisions {
    decisionId
    examRunId
    reviewerId
    packetDigest
    disposition
    status
    rationale
    attestedAt
    sequence
  }
  current {
    decisionId
    examRunId
    reviewerId
    packetDigest
    disposition
    status
    rationale
    attestedAt
    sequence
  }
  claimBoundary
  notEvidenceFor
  scoringValidityClaimed
  examEquivalenceGate
}

fragment FacultyDispositionRefusalFields on FacultyDispositionRefusal {
  code
  reason
  notEvidenceFor
  scoringValidityClaimed
  examEquivalenceGate
}

query AssembledExamFacultyDisposition($examRunId: ID!) {
  assembledExamFacultyDisposition(examRunId: $examRunId) {
    ...FacultyDispositionTrailFields
  }
}

mutation AppendAssembledExamFacultyDisposition($input: AppendFacultyDispositionInput!) {
  appendAssembledExamFacultyDisposition(input: $input) {
    __typename
    ...FacultyDispositionTrailFields
    ...FacultyDispositionRefusalFields
  }
}
`;

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

export type FacultyGraphqlRequest = {
  query: string;
  operationName: string;
  variables: Record<string, unknown>;
};

export type FacultyGraphqlResult = {
  data?: unknown;
  errors?: readonly { message: string }[] | undefined;
};

export type FacultyGraphqlExecute = (request: FacultyGraphqlRequest) => Promise<FacultyGraphqlResult>;

export type FacultyDispositionDecisionView = {
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

export type FacultyDispositionTrailView = {
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
  decisions: readonly FacultyDispositionDecisionView[];
  current: FacultyDispositionDecisionView | null;
  claimBoundary: string;
  notEvidenceFor: readonly string[];
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
};

export type FacultyDispositionRefusalView = {
  __typename: string;
  code: FacultyDispositionRefusalCode;
  reason: string;
  notEvidenceFor: readonly string[];
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
};

export type AppendFacultyDispositionInputView = {
  examRunId: string;
  reviewerId: string;
  packetDigest: string;
  disposition: FacultyDispositionValue;
  status: FacultyDispositionStatus;
  rationale: string;
  attestedAt: string;
  decisionId?: string;
};

export async function postAdminGraphql(request: FacultyGraphqlRequest): Promise<FacultyGraphqlResult> {
  const response = await fetch(ADMIN_GRAPHQL_EXECUTE_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return (await response.json()) as FacultyGraphqlResult;
}

export async function queryAssembledExamFacultyDisposition(
  examRunId: string,
  execute: FacultyGraphqlExecute = postAdminGraphql,
): Promise<FacultyDispositionTrailView | null> {
  const result = await execute({
    query: FACULTY_DISPOSITION_DOCUMENT_SOURCE,
    operationName: ASSEMBLED_EXAM_FACULTY_DISPOSITION_OPERATION,
    variables: { examRunId },
  });
  throwIfGraphqlErrors(result, "assembled_exam_faculty_disposition_query_failed");
  const data = isRecord(result.data) ? result.data["assembledExamFacultyDisposition"] : null;
  return parseTrail(data);
}

export async function appendAssembledExamFacultyDispositionGraphql(
  input: AppendFacultyDispositionInputView,
  execute: FacultyGraphqlExecute = postAdminGraphql,
): Promise<FacultyDispositionTrailView | FacultyDispositionRefusalView> {
  const result = await execute({
    query: FACULTY_DISPOSITION_DOCUMENT_SOURCE,
    operationName: APPEND_ASSEMBLED_EXAM_FACULTY_DISPOSITION_OPERATION,
    variables: { input },
  });
  throwIfGraphqlErrors(result, "append_assembled_exam_faculty_disposition_failed");
  const data = isRecord(result.data) ? result.data["appendAssembledExamFacultyDisposition"] : null;
  const refusal = parseRefusal(data);
  if (refusal) {
    return refusal;
  }
  const trail = parseTrail(data);
  if (!trail) {
    throw new Error("append_assembled_exam_faculty_disposition_failed:missing_trail");
  }
  return trail;
}

export function isFacultyDispositionRefusal(
  value: FacultyDispositionTrailView | FacultyDispositionRefusalView,
): value is FacultyDispositionRefusalView {
  return "code" in value;
}

export function parseTrail(value: unknown): FacultyDispositionTrailView | null {
  if (!isRecord(value) || typeof value["code"] === "string") {
    return null;
  }
  const examRunId = readString(value, "examRunId");
  const packetDigest = readString(value, "packetDigest");
  if (!examRunId || !packetDigest) {
    return null;
  }
  const evidence = isRecord(value["evidencePacket"]) ? value["evidencePacket"] : {};
  const rawDecisions = value["decisions"];
  const decisions = Array.isArray(rawDecisions)
    ? rawDecisions.flatMap((item, index) => parseDecision(item, examRunId, packetDigest, index))
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

export function parseRefusal(value: unknown): FacultyDispositionRefusalView | null {
  if (!isRecord(value)) {
    return null;
  }
  const codeValue = value["code"] ?? value["error"];
  if (typeof codeValue !== "string" || !(codeValue in REFUSAL_TITLE)) {
    return null;
  }
  const code = codeValue as FacultyDispositionRefusalCode;
  const typename = value["__typename"];
  return {
    __typename: typeof typename === "string" ? typename : `FacultyDisposition${code}`,
    code,
    reason: readString(value, "reason") ?? code,
    notEvidenceFor: readStringArray(value, "notEvidenceFor"),
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}

function parseDecision(
  item: unknown,
  examRunId: string,
  packetDigest: string,
  index: number,
): FacultyDispositionDecisionView[] {
  if (!isRecord(item)) {
    return [];
  }
  const decisionId = readString(item, "decisionId");
  const reviewerId = readString(item, "reviewerId");
  const disposition = item["disposition"];
  const status = item["status"];
  const rationale = readString(item, "rationale");
  const attestedAt = readString(item, "attestedAt");
  const sequenceValue = item["sequence"];
  if (!decisionId || !reviewerId || !isDisposition(disposition) || !isStatus(status) || !rationale || !attestedAt) {
    return [];
  }
  return [{
    decisionId,
    examRunId: readString(item, "examRunId") ?? examRunId,
    reviewerId,
    packetDigest: readString(item, "packetDigest") ?? packetDigest,
    disposition,
    status,
    rationale,
    attestedAt,
    sequence: typeof sequenceValue === "number" && Number.isInteger(sequenceValue) ? sequenceValue : index + 1,
  }];
}

function throwIfGraphqlErrors(result: FacultyGraphqlResult, fallback: string): void {
  const message = result.errors?.[0]?.message;
  if (message) {
    throw new Error(message);
  }
  if (result.errors && result.errors.length > 0) {
    throw new Error(fallback);
  }
}

function isDisposition(value: unknown): value is FacultyDispositionValue {
  return value === "hold" || value === "local_debrief_ready" || value === "needs_revision";
}

function isStatus(value: unknown): value is FacultyDispositionStatus {
  return value === "draft" || value === "final";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
