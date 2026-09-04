const PRIVATE_KEYS = new Set([
  "hiddenFacts",
  "privateFacts",
  "hiddenFactRefs",
  "serverOnlyNotes",
  "hiddenFact",
  "confidentialNote",
]);

export const FACULTY_DISPOSITION_CLAIM_BOUNDARY =
  "assembled_exam_faculty_disposition_not_score_use" as const;

export const FACULTY_DISPOSITION_NOT_EVIDENCE_FOR = [
  "exam_equivalence",
  "clinical_validity",
  "scoring_validity",
  "automated_scoring",
  "credentialing",
  "production_deployment",
] as const;

const FACULTY_DISPOSITION_REFUSAL_TYPENAME = {
  stale_packet_digest: "FacultyDispositionStaleDigest",
  producer_self_review: "FacultyDispositionProducerSelfReview",
  identity_mutation: "FacultyDispositionIdentityMutation",
  overwrite_refused: "FacultyDispositionOverwriteRefused",
  finalized: "FacultyDispositionPostFinalization",
} as const;

export type FacultyDispositionRefusalCode = keyof typeof FACULTY_DISPOSITION_REFUSAL_TYPENAME;

export type FacultyDispositionGraphqlRefusal = {
  __typename: (typeof FACULTY_DISPOSITION_REFUSAL_TYPENAME)[FacultyDispositionRefusalCode];
  code: FacultyDispositionRefusalCode;
  reason: string;
  notEvidenceFor: readonly string[];
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
};

export type FacultyDispositionGraphqlDecision = {
  decisionId: string;
  examRunId: string;
  reviewerId: string;
  packetDigest: string;
  disposition: string;
  status: string;
  rationale: string;
  attestedAt: string;
  sequence: number;
};

export type AssembledExamEvidencePacketGraphql = {
  examRunId: string;
  packetDigest: string;
  learnerId?: string | null;
  stationRunIds: string[];
  claimBoundary: string;
  notEvidenceFor: readonly string[];
  examEquivalenceGate: false;
};

export type FacultyDispositionGraphqlTrail = {
  __typename: "FacultyDispositionTrail";
  examRunId: string;
  packetDigest: string;
  evidencePacket: AssembledExamEvidencePacketGraphql;
  decisions: FacultyDispositionGraphqlDecision[];
  current: FacultyDispositionGraphqlDecision | null;
  claimBoundary: typeof FACULTY_DISPOSITION_CLAIM_BOUNDARY;
  notEvidenceFor: typeof FACULTY_DISPOSITION_NOT_EVIDENCE_FOR;
  scoringValidityClaimed: false;
  examEquivalenceGate: false;
};

export function projectFacultyDispositionTrail(source: unknown): FacultyDispositionGraphqlTrail | null {
  if (!isRecord(source)) {
    return null;
  }
  const examRunId = nonEmptyString(read(source, "examRunId"));
  const packetDigest = nonEmptyString(read(source, "packetDigest"));
  const evidencePacket = projectEvidencePacket(
    read(source, "evidencePacket"),
    examRunId,
    packetDigest,
  );
  if (!examRunId || !packetDigest || !evidencePacket) {
    return null;
  }
  const decisions = projectDecisions(read(source, "decisions"), examRunId, packetDigest);
  return {
    __typename: "FacultyDispositionTrail",
    examRunId,
    packetDigest,
    evidencePacket,
    decisions,
    current: decisions[decisions.length - 1] ?? null,
    claimBoundary: FACULTY_DISPOSITION_CLAIM_BOUNDARY,
    notEvidenceFor: FACULTY_DISPOSITION_NOT_EVIDENCE_FOR,
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}

export function projectAppendFacultyDispositionResult(
  source: unknown,
): FacultyDispositionGraphqlTrail | FacultyDispositionGraphqlRefusal | null {
  const refusal = projectFacultyDispositionRefusal(source);
  if (refusal) {
    return refusal;
  }
  return projectFacultyDispositionTrail(source);
}

function projectFacultyDispositionRefusal(source: unknown): FacultyDispositionGraphqlRefusal | undefined {
  if (!isRecord(source)) {
    return undefined;
  }
  const codeValue = read(source, "error") ?? read(source, "code");
  if (typeof codeValue !== "string" || !(codeValue in FACULTY_DISPOSITION_REFUSAL_TYPENAME)) {
    return undefined;
  }
  const code = codeValue as FacultyDispositionRefusalCode;
  const reasonValue = read(source, "reason");
  return {
    __typename: FACULTY_DISPOSITION_REFUSAL_TYPENAME[code],
    code,
    reason: typeof reasonValue === "string" && reasonValue.length > 0 ? reasonValue : code,
    notEvidenceFor: [...FACULTY_DISPOSITION_NOT_EVIDENCE_FOR],
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}

function projectEvidencePacket(
  value: unknown,
  examRunId: string | undefined,
  packetDigest: string | undefined,
): AssembledExamEvidencePacketGraphql | undefined {
  const packet = isRecord(value) ? stripPrivate(value) : {};
  const packetExamRunId = nonEmptyString(read(packet, "examRunId")) ?? examRunId;
  const digest = packetDigest ?? nonEmptyString(read(packet, "packetDigest"));
  if (!packetExamRunId || !digest) {
    return undefined;
  }
  const learnerId = nonEmptyString(read(packet, "learnerId")) ?? null;
  const stations = read(packet, "stations");
  const stationRunIds = Array.isArray(stations)
    ? stations.flatMap((station) => {
      if (!isRecord(station)) {
        return [];
      }
      const reviewPacket = read(station, "reviewPacket");
      const fromReview = isRecord(reviewPacket) ? nonEmptyString(read(reviewPacket, "stationRunId")) : undefined;
      const identity = read(station, "identity");
      const fromIdentity = isRecord(identity) ? nonEmptyString(read(identity, "stationRunId")) : undefined;
      const id = fromReview ?? fromIdentity ?? nonEmptyString(read(station, "stationRunId"));
      return id ? [id] : [];
    })
    : stringArray(read(packet, "stationRunIds"));
  return {
    examRunId: packetExamRunId,
    packetDigest: digest,
    learnerId,
    stationRunIds,
    claimBoundary: nonEmptyString(read(packet, "claimBoundary"))
      ?? "assembled_exam_review_packet_not_exam_equivalence",
    notEvidenceFor: stringArray(read(packet, "notEvidenceFor")),
    examEquivalenceGate: false,
  };
}

function projectDecisions(
  value: unknown,
  examRunId: string,
  packetDigest: string,
): FacultyDispositionGraphqlDecision[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) => {
    if (!isRecord(item)) {
      return [];
    }
    const decisionId = nonEmptyString(read(item, "decisionId"));
    const reviewerId = nonEmptyString(read(item, "reviewerId"));
    const disposition = nonEmptyString(read(item, "disposition"));
    const status = nonEmptyString(read(item, "status"));
    const rationale = nonEmptyString(read(item, "rationale"));
    const attestedAt = nonEmptyString(read(item, "attestedAt"));
    const sequenceValue = read(item, "sequence");
    const sequence = typeof sequenceValue === "number" && Number.isInteger(sequenceValue) ? sequenceValue : index + 1;
    if (!decisionId || !reviewerId || !disposition || !status || !rationale || !attestedAt) {
      return [];
    }
    return [{
      decisionId,
      examRunId: nonEmptyString(read(item, "examRunId")) ?? examRunId,
      reviewerId,
      packetDigest: nonEmptyString(read(item, "packetDigest")) ?? packetDigest,
      disposition,
      status,
      rationale,
      attestedAt,
      sequence,
    }];
  });
}

function stripPrivate(value: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key)) {
      continue;
    }
    next[key] = isRecord(entry) ? stripPrivate(entry) : entry;
  }
  return next;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function read(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}
