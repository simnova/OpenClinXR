import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { FacultyDispositionRefusalCode } from "@openclinxr/graphql/client";
import { type AdminGraphqlRootValue, buildAdminGraphqlSchema, executeAdminGraphql } from "@openclinxr/graphql";
import { assembledExamReviewNotEvidenceFor, buildAssembledExamReviewPacket } from "@openclinxr/review-workflow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REFUSAL_TITLE } from "./faculty-adjudication-graphql.js";
import { FacultyAdjudicationWorkspace } from "./faculty-adjudication-workspace.js";

vi.stubGlobal("ResizeObserver", class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
});

type FacultyGraphqlExecute = NonNullable<
  Parameters<typeof FacultyAdjudicationWorkspace>[0]["executeGraphql"]
>;
type FacultyGraphqlRequest = Parameters<FacultyGraphqlExecute>[0];

const EXAM_RUN_ID = "exam_run_faculty_disposition_graphql_001";
const LEARNER_ID = "learner_phase_001";
const REVIEWER_ID = "faculty_disposition_001";
const PRODUCER_FACULTY_ID = "faculty_001";
const DIGEST = "packet-digest-frozen";
const ATTESTED_AT = "2026-09-04T10:00:00.000Z";

describe("the adjudication workspace persists dispositions through graphql", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads immutable evidence and the ordered trail, appends draft then final, and reproduces digest and trail on reload", async () => {
    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      learnerId: LEARNER_ID,
      stations: [{
        stationRunId: "run_ed_001",
        scenarioId: "ed_chest_pain_priority_v1",
        stationOrder: 1,
        requiredTraceTags: [],
        traceEvents: [{ stationRunId: "run_ed_001", sequence: 0, eventType: "station.started", source: "system", atSecond: 0 }],
        phaseTransitions: [],
        facultyScoreDraft: { reviewerId: PRODUCER_FACULTY_ID, status: "draft", comments: "" },
      }],
    });
    const store = createDispositionStore();
    const operations: string[] = [];
    const executeGraphql = trackedExecute(store, operations);

    const view = render(
      <FacultyAdjudicationWorkspace
        examRunId={EXAM_RUN_ID}
        loadPacket={async () => packet}
        executeGraphql={executeGraphql}
        now={() => ATTESTED_AT}
      />,
    );

    const workspace = await screen.findByLabelText("Faculty adjudication workspace");
    expect(workspace).toHaveTextContent(EXAM_RUN_ID);
    expect(workspace).toHaveTextContent("assembled_exam_review_packet_not_exam_equivalence");
    expect(await screen.findByLabelText("Visible packet digest")).toHaveTextContent(DIGEST);
    expect(within(workspace).getByLabelText("Faculty disposition audit trail")).toHaveTextContent("No attested dispositions yet.");
    expect(operations).toContain("AssembledExamFacultyDisposition");

    fireEvent.change(within(workspace).getByLabelText("Faculty reviewer identity"), { target: { value: REVIEWER_ID } });
    fireEvent.change(within(workspace).getByLabelText("Faculty disposition rationale"), {
      target: { value: "Hold for faculty debrief; no score use." },
    });
    fireEvent.click(within(workspace).getByLabelText("Save disposition draft"));

    expect(await within(workspace).findByLabelText("Disposition decision 1")).toHaveTextContent("draft hold");
    expect(within(workspace).getByLabelText("Recorded faculty disposition")).toHaveTextContent("hold");
    expect(within(workspace).getByLabelText("Recorded faculty disposition")).toHaveTextContent("draft");
    expect(within(workspace).getByLabelText("Visible packet digest")).toHaveTextContent(DIGEST);
    expect(operations).toContain("AppendAssembledExamFacultyDisposition");

    fireEvent.click(within(workspace).getByLabelText("Choose disposition local_debrief_ready"));
    fireEvent.change(within(workspace).getByLabelText("Faculty disposition rationale"), {
      target: { value: "Final local debrief only." },
    });
    fireEvent.click(within(workspace).getByLabelText("Finalize disposition"));

    expect(await within(workspace).findByLabelText("Disposition decision 2")).toHaveTextContent("final local_debrief_ready");
    const trail = within(workspace).getByLabelText("Faculty disposition audit trail");
    expect(within(trail).getByLabelText("Disposition decision 1")).toHaveTextContent("draft hold");
    expect(within(trail).getByLabelText("Disposition decision 2")).toHaveTextContent(`digest ${DIGEST}`);
    expect(within(workspace).getByLabelText("Recorded faculty disposition")).toHaveTextContent("local_debrief_ready");
    expect(within(workspace).getByLabelText("Recorded faculty disposition")).toHaveTextContent("final");
    expect(within(workspace).getByLabelText("Faculty disposition claim boundary")).toHaveTextContent("assembled_exam_faculty_disposition_not_score_use");
    expect(workspace).toHaveTextContent("scoringValidityClaimed false");
    expect(workspace).toHaveTextContent("examEquivalenceGate false");

    view.unmount();
    render(
      <FacultyAdjudicationWorkspace
        examRunId={EXAM_RUN_ID}
        loadPacket={async () => packet}
        executeGraphql={executeGraphql}
        now={() => ATTESTED_AT}
      />,
    );
    const reloaded = await screen.findByLabelText("Faculty adjudication workspace");
    expect(await within(reloaded).findByLabelText("Visible packet digest")).toHaveTextContent(DIGEST);
    expect(within(reloaded).getByLabelText("Disposition decision 1")).toHaveTextContent("draft hold");
    expect(within(reloaded).getByLabelText("Disposition decision 2")).toHaveTextContent("final local_debrief_ready");
    expect(within(reloaded).getByLabelText("Disposition decision 2")).toHaveTextContent(`digest ${DIGEST}`);
    expect(within(reloaded).getByLabelText("Assembled exam packet claim boundary")).toHaveTextContent(EXAM_RUN_ID);
  });

  it("renders each typed GraphQL refusal reason without mutating the evidence digest", async () => {
    const schemaCodes = facultyDispositionRefusalCodesFromSchema();
    expect(schemaCodes).toEqual(Object.keys(REFUSAL_TITLE).sort());
    expect(schemaCodes).toEqual(Object.keys(REFUSAL_CASES).sort());

    const packet = buildAssembledExamReviewPacket({
      examRunId: EXAM_RUN_ID,
      learnerId: LEARNER_ID,
      stations: [{
        stationRunId: "run_ed_001",
        scenarioId: "ed_chest_pain_priority_v1",
        stationOrder: 1,
        requiredTraceTags: [],
        traceEvents: [{ stationRunId: "run_ed_001", sequence: 0, eventType: "station.started", source: "system", atSecond: 0 }],
        phaseTransitions: [],
        facultyScoreDraft: { reviewerId: PRODUCER_FACULTY_ID, status: "draft", comments: "" },
      }],
    });

    for (const code of schemaCodes) {
      cleanup();
      const driver = REFUSAL_CASES[code];
      expect(REFUSAL_TITLE[code].trim().length, `untitled refusal ${code}`).toBeGreaterThan(0);
      const store = createDispositionStore(driver.seed);
      render(
        <FacultyAdjudicationWorkspace
          examRunId={EXAM_RUN_ID}
          loadPacket={async () => packet}
          executeGraphql={trackedExecute(store, [])}
          now={() => ATTESTED_AT}
        />,
      );
      const workspace = await screen.findByLabelText("Faculty adjudication workspace");
      expect(await screen.findByLabelText("Visible packet digest")).toHaveTextContent(DIGEST);

      await refuse(workspace, driver.fields, driver.action);
      const alert = await screen.findByLabelText(`Faculty disposition refusal ${code}`);
      expect(alert).toHaveTextContent(REFUSAL_TITLE[code]);
      expect(alert).toHaveTextContent(code);
      expect(alert).toHaveTextContent(driver.typename);
      expect(within(workspace).getByLabelText("Visible packet digest")).toHaveTextContent(DIGEST);
      if (driver.seed.length === 0) {
        expect(within(workspace).queryByLabelText("Disposition decision 1")).not.toBeInTheDocument();
      } else {
        expect(within(workspace).getByLabelText("Disposition decision 1")).toBeInTheDocument();
        expect(within(workspace).queryByLabelText("Disposition decision 2")).not.toBeInTheDocument();
      }
    }
  });
});

async function refuse(
  workspace: HTMLElement,
  fields: { reviewerId: string; rationale: string; packetDigest?: string; decisionId?: string },
  action: "Save disposition draft" | "Finalize disposition",
): Promise<void> {
  fireEvent.change(within(workspace).getByLabelText("Faculty reviewer identity"), { target: { value: fields.reviewerId } });
  fireEvent.change(within(workspace).getByLabelText("Faculty disposition rationale"), { target: { value: fields.rationale } });
  fireEvent.change(within(workspace).getByLabelText("Faculty disposition packet digest"), {
    target: { value: fields.packetDigest ?? DIGEST },
  });
  fireEvent.change(within(workspace).getByLabelText("Faculty disposition decision id"), {
    target: { value: fields.decisionId ?? "" },
  });
  fireEvent.click(within(workspace).getByLabelText(action));
}

function trackedExecute(store: AdminGraphqlRootValue, operations: string[]): FacultyGraphqlExecute {
  return async (request: FacultyGraphqlRequest) => {
    operations.push(request.operationName);
    expect(request.query).toContain("query AssembledExamFacultyDisposition");
    expect(request.query).toContain("mutation AppendAssembledExamFacultyDisposition");
    const result = await executeAdminGraphql({
      query: request.query,
      operationName: request.operationName,
      variables: request.variables,
    }, store);
    return result.errors ? { data: result.data, errors: result.errors } : { data: result.data };
  };
}

function facultyDispositionRefusalCodesFromSchema(): FacultyDispositionRefusalCode[] {
  const named = buildAdminGraphqlSchema().getType("FacultyDispositionRefusalCode") as unknown as {
    getValues?: () => ReadonlyArray<{ name: string }>;
  } | undefined;
  return [...(named?.getValues?.().map((value) => value.name) ?? [])].sort() as FacultyDispositionRefusalCode[];
}

const SEEDED_DECISION_ID = `assembled_exam_disposition:${EXAM_RUN_ID}:1`;

function seededDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decisionId: SEEDED_DECISION_ID,
    examRunId: EXAM_RUN_ID,
    reviewerId: REVIEWER_ID,
    packetDigest: DIGEST,
    disposition: "hold",
    status: "draft",
    rationale: "seeded disposition",
    attestedAt: ATTESTED_AT,
    sequence: 1,
    ...overrides,
  };
}

type RefusalDriver = {
  seed: Array<Record<string, unknown>>;
  fields: { reviewerId: string; rationale: string; packetDigest?: string; decisionId?: string };
  action: "Save disposition draft" | "Finalize disposition";
  typename: string;
};

const REFUSAL_CASES: Record<FacultyDispositionRefusalCode, RefusalDriver> = {
  stale_packet_digest: {
    seed: [],
    fields: { reviewerId: REVIEWER_ID, packetDigest: "not-the-digest", rationale: "stale" },
    action: "Save disposition draft",
    typename: "FacultyDispositionStaleDigest",
  },
  producer_self_review: {
    seed: [],
    fields: { reviewerId: LEARNER_ID, rationale: "producer" },
    action: "Save disposition draft",
    typename: "FacultyDispositionProducerSelfReview",
  },
  identity_mutation: {
    seed: [seededDecision()],
    fields: { reviewerId: "faculty_disposition_002", rationale: "identity" },
    action: "Save disposition draft",
    typename: "FacultyDispositionIdentityMutation",
  },
  overwrite_refused: {
    seed: [seededDecision()],
    fields: { reviewerId: REVIEWER_ID, decisionId: SEEDED_DECISION_ID, rationale: "overwrite" },
    action: "Save disposition draft",
    typename: "FacultyDispositionOverwriteRefused",
  },
  finalized: {
    seed: [seededDecision({ status: "final", rationale: "Close the trail." })],
    fields: { reviewerId: REVIEWER_ID, rationale: "try again" },
    action: "Save disposition draft",
    typename: "FacultyDispositionPostFinalization",
  },
};

function createDispositionStore(seed: Array<Record<string, unknown>> = []): AdminGraphqlRootValue {
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
    notEvidenceFor: [...assembledExamReviewNotEvidenceFor],
    examEquivalenceGate: false,
  };
  let decisions: Array<Record<string, unknown>> = [...seed];

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
    claimBoundary: "assembled_exam_faculty_disposition_not_score_use",
    notEvidenceFor: [
      "exam_equivalence",
      "clinical_validity",
      "scoring_validity",
      "automated_scoring",
      "credentialing",
      "production_deployment",
    ],
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}

function restError(error: string, reason: string) {
  return {
    error,
    reason,
    notEvidenceFor: [
      "exam_equivalence",
      "clinical_validity",
      "scoring_validity",
      "automated_scoring",
      "credentialing",
      "production_deployment",
    ],
  };
}
