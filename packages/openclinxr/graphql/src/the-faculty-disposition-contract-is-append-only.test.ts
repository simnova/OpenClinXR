import { readFileSync } from "node:fs";
import { GraphQLObjectType, GraphQLUnionType, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { buildAdminGraphqlSchema, executeAdminGraphql, type AdminGraphqlRootValue } from "./index.js";
import {
  FACULTY_DISPOSITION_CLAIM_BOUNDARY,
  FACULTY_DISPOSITION_NOT_EVIDENCE_FOR,
} from "./schema.js";

const EXAM_RUN_ID = "exam_run_faculty_disposition_graphql_001";
const LEARNER_ID = "learner_phase_001";
const REVIEWER_ID = "faculty_disposition_001";
const PRODUCER_FACULTY_ID = "faculty_001";
const DIGEST = "packet-digest-frozen";
const ATTESTED_AT = "2026-09-04T10:00:00.000Z";
const DOCUMENT_SOURCE = readFileSync(new URL("./documents/faculty-disposition.graphql", import.meta.url), "utf8");

describe("faculty disposition GraphQL contract is append-only", () => {
  it("exposes query and mutation fields beside an immutable evidence object", () => {
    const schema = buildAdminGraphqlSchema();
    expect(schema.getQueryType()?.getFields()).toHaveProperty("assembledExamFacultyDisposition");
    expect(schema.getMutationType()?.getFields()).toHaveProperty("appendAssembledExamFacultyDisposition");
    expect(schema.getType("FacultyDispositionTrail")).toBeInstanceOf(GraphQLObjectType);
    expect(schema.getType("AssembledExamEvidencePacket")).toBeInstanceOf(GraphQLObjectType);
    expect(schema.getType("AppendFacultyDispositionResult")).toBeInstanceOf(GraphQLUnionType);
    const trail = schema.getType("FacultyDispositionTrail") as GraphQLObjectType;
    expect(trail.getFields()).toHaveProperty("evidencePacket");
    expect(trail.getFields()).toHaveProperty("decisions");
    expect(trail.getFields()).toHaveProperty("current");
    expect(validate(schema, parse(DOCUMENT_SOURCE))).toEqual([]);
  });

  it("appends draft then final without mutating the evidence packet", async () => {
    const store = createDispositionStore();
    const draft = await append(store, {
      disposition: "hold",
      status: "draft",
      rationale: "Hold for faculty debrief; no score use.",
    });
    expect(draft.errors).toBeUndefined();
    const draftTrail = trailOf(draft);
    expect(draftTrail.__typename).toBe("FacultyDispositionTrail");
    expect(draftTrail.packetDigest).toBe(DIGEST);
    expect(draftTrail.evidencePacket).toMatchObject({
      examRunId: EXAM_RUN_ID,
      packetDigest: DIGEST,
      learnerId: LEARNER_ID,
      stationRunIds: ["run_ed_001"],
      examEquivalenceGate: false,
    });
    expect(draftTrail.decisions).toHaveLength(1);
    expect(draftTrail.current).toMatchObject({
      reviewerId: REVIEWER_ID,
      disposition: "hold",
      status: "draft",
      sequence: 1,
    });
    expect(draftTrail.scoringValidityClaimed).toBe(false);
    expect(draftTrail.examEquivalenceGate).toBe(false);
    expect(draftTrail.claimBoundary).toBe(FACULTY_DISPOSITION_CLAIM_BOUNDARY);
    expect(draftTrail.notEvidenceFor).toEqual([...FACULTY_DISPOSITION_NOT_EVIDENCE_FOR]);
    expect(draftTrail.decisions).not.toBe(draftTrail.evidencePacket);
    const evidenceSnapshot = structuredClone(draftTrail.evidencePacket);

    const finalized = await append(store, {
      disposition: "local_debrief_ready",
      status: "final",
      rationale: "Final local debrief only.",
      attestedAt: "2026-09-04T11:00:00.000Z",
    });
    expect(finalized.errors).toBeUndefined();
    const finalTrail = trailOf(finalized);
    expect(finalTrail.decisions).toHaveLength(2);
    expect(finalTrail.decisions[0]).toMatchObject({ status: "draft", sequence: 1 });
    expect(finalTrail.decisions[1]).toMatchObject({
      status: "final",
      sequence: 2,
      disposition: "local_debrief_ready",
    });
    expect(finalTrail.evidencePacket).toEqual(evidenceSnapshot);
    expect(finalTrail.scoringValidityClaimed).toBe(false);
    expect(JSON.stringify(finalTrail)).not.toContain("hiddenFacts");

    const queried = await executeAdminGraphql(
      {
        query: DOCUMENT_SOURCE,
        operationName: "AssembledExamFacultyDisposition",
        variables: { examRunId: EXAM_RUN_ID },
      },
      store,
    );
    expect(queried.errors).toBeUndefined();
    const readTrail = queried.data?.["assembledExamFacultyDisposition"] as ReturnType<typeof trailOf>;
    expect(readTrail.decisions).toHaveLength(2);
    expect(readTrail.current).toMatchObject({ status: "final" });
    expect(readTrail.evidencePacket).toEqual(evidenceSnapshot);
  });

  it("returns typed refusals for stale digest, producer self-review, identity mutation, overwrite, and post-finalization", async () => {
    const store = createDispositionStore();

    const producer = await append(store, { reviewerId: LEARNER_ID });
    expect(refusalOf(producer)).toMatchObject({
      __typename: "FacultyDispositionProducerSelfReview",
      code: "producer_self_review",
      scoringValidityClaimed: false,
      examEquivalenceGate: false,
    });

    const producerFaculty = await append(store, { reviewerId: PRODUCER_FACULTY_ID });
    expect(refusalOf(producerFaculty).__typename).toBe("FacultyDispositionProducerSelfReview");

    const stale = await append(store, { packetDigest: "not-the-digest" });
    expect(refusalOf(stale)).toMatchObject({
      __typename: "FacultyDispositionStaleDigest",
      code: "stale_packet_digest",
      notEvidenceFor: [...FACULTY_DISPOSITION_NOT_EVIDENCE_FOR],
    });

    const first = await append(store, {});
    expect(trailOf(first).decisions).toHaveLength(1);
    const firstId = trailOf(first).current?.decisionId as string;

    const mutatedReviewer = await append(store, { reviewerId: "faculty_disposition_002" });
    expect(refusalOf(mutatedReviewer)).toMatchObject({
      __typename: "FacultyDispositionIdentityMutation",
      code: "identity_mutation",
    });

    const overwriteId = await append(store, { decisionId: firstId });
    expect(refusalOf(overwriteId)).toMatchObject({
      __typename: "FacultyDispositionOverwriteRefused",
      code: "overwrite_refused",
    });

    const overwriteEvidence = await append(store, {
      evidencePacket: { examRunId: "mutated" },
    });
    expect(refusalOf(overwriteEvidence).__typename).toBe("FacultyDispositionOverwriteRefused");

    const finalize = await append(store, {
      status: "final",
      disposition: "local_debrief_ready",
      rationale: "Close the trail.",
    });
    expect(trailOf(finalize).current?.status).toBe("final");

    const afterFinal = await append(store, {
      status: "draft",
      rationale: "try again",
    });
    expect(refusalOf(afterFinal)).toMatchObject({
      __typename: "FacultyDispositionPostFinalization",
      code: "finalized",
      scoringValidityClaimed: false,
      examEquivalenceGate: false,
    });

    const reread = await executeAdminGraphql(
      {
        query: DOCUMENT_SOURCE,
        operationName: "AssembledExamFacultyDisposition",
        variables: { examRunId: EXAM_RUN_ID },
      },
      store,
    );
    const remaining = reread.data?.["assembledExamFacultyDisposition"] as { decisions: unknown[]; evidencePacket: { examRunId: string } };
    expect(remaining.decisions).toHaveLength(2);
    expect(remaining.evidencePacket.examRunId).toBe(EXAM_RUN_ID);
  });
});

function createDispositionStore(): AdminGraphqlRootValue {
  const evidencePacket = {
    examRunId: EXAM_RUN_ID,
    learnerId: LEARNER_ID,
    stations: [
      {
        reviewPacket: {
          stationRunId: "run_ed_001",
          facultyScoreDraft: { reviewerId: PRODUCER_FACULTY_ID },
          hiddenFacts: ["HIDDEN_DIAGNOSIS"],
        },
      },
    ],
    claimBoundary: "assembled_exam_review_packet_not_exam_equivalence",
    notEvidenceFor: ["exam_equivalence"],
    examEquivalenceGate: false,
  };
  let decisions: Array<Record<string, unknown>> = [];

  return {
    assembledExamFacultyDisposition: ({ examRunId }) => {
      if (examRunId !== EXAM_RUN_ID) {
        return null;
      }
      return readModel(evidencePacket, decisions);
    },
    appendAssembledExamFacultyDisposition: ({ input }) => {
      const body = input as Record<string, unknown>;
      if (body["evidencePacket"] != null || body["decisions"] != null) {
        return restError("overwrite_refused", "cannot_replace_evidence_or_trail");
      }
      const reviewerId = String(body["reviewerId"] ?? "");
      const packetDigest = String(body["packetDigest"] ?? "");
      if (reviewerId === LEARNER_ID || reviewerId === PRODUCER_FACULTY_ID) {
        return restError("producer_self_review", "reviewer_is_producer");
      }
      if (packetDigest !== DIGEST) {
        return restError("stale_packet_digest", "packet_digest_mismatch");
      }
      const last = decisions[decisions.length - 1];
      if (last?.["status"] === "final") {
        return restError("finalized", "disposition_already_final");
      }
      const lockedReviewer = decisions[0]?.["reviewerId"];
      if (typeof lockedReviewer === "string" && lockedReviewer !== reviewerId) {
        return restError("identity_mutation", "reviewer_mismatch");
      }
      const decisionId = typeof body["decisionId"] === "string" ? body["decisionId"] : "";
      if (decisionId.length > 0 && decisions.some((item) => item["decisionId"] === decisionId)) {
        return restError("overwrite_refused", "decision_id_already_recorded");
      }
      const sequence = decisions.length + 1;
      const next = {
        decisionId: decisionId.length > 0 ? decisionId : `assembled_exam_disposition:${EXAM_RUN_ID}:${sequence}`,
        examRunId: EXAM_RUN_ID,
        reviewerId,
        packetDigest: DIGEST,
        disposition: body["disposition"],
        status: body["status"],
        rationale: body["rationale"],
        attestedAt: body["attestedAt"],
        sequence,
      };
      decisions = [...decisions, next];
      return readModel(evidencePacket, decisions);
    },
  };
}

function readModel(evidencePacket: Record<string, unknown>, decisions: Array<Record<string, unknown>>) {
  return {
    examRunId: EXAM_RUN_ID,
    packetDigest: DIGEST,
    evidencePacket,
    decisions,
    current: decisions[decisions.length - 1] ?? null,
    claimBoundary: FACULTY_DISPOSITION_CLAIM_BOUNDARY,
    notEvidenceFor: FACULTY_DISPOSITION_NOT_EVIDENCE_FOR,
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}

function restError(error: string, reason: string) {
  return { error, reason, notEvidenceFor: [...FACULTY_DISPOSITION_NOT_EVIDENCE_FOR] };
}

async function append(rootValue: AdminGraphqlRootValue, overrides: Record<string, unknown>) {
  return executeAdminGraphql(
    {
      query: DOCUMENT_SOURCE,
      operationName: "AppendAssembledExamFacultyDisposition",
      variables: {
        input: {
          examRunId: EXAM_RUN_ID,
          reviewerId: REVIEWER_ID,
          packetDigest: DIGEST,
          disposition: "hold",
          status: "draft",
          rationale: "Hold for faculty debrief; no score use.",
          attestedAt: ATTESTED_AT,
          ...overrides,
        },
      },
    },
    rootValue,
  );
}

function trailOf(result: { data?: unknown; errors?: unknown }) {
  const data = result.data as { appendAssembledExamFacultyDisposition: Record<string, unknown> };
  return data.appendAssembledExamFacultyDisposition as {
    __typename: string;
    packetDigest: string;
    evidencePacket: Record<string, unknown>;
    decisions: Array<Record<string, unknown>>;
    current?: { decisionId?: string; status?: string; reviewerId?: string; disposition?: string; sequence?: number };
    scoringValidityClaimed: boolean;
    examEquivalenceGate: boolean;
    claimBoundary: string;
    notEvidenceFor: string[];
  };
}

function refusalOf(result: { data?: unknown; errors?: unknown }) {
  return trailOf(result) as unknown as {
    __typename: string;
    code: string;
    reason: string;
    notEvidenceFor: string[];
    scoringValidityClaimed: boolean;
    examEquivalenceGate: boolean;
  };
}
