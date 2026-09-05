import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  appendAssembledExamFacultyDisposition,
  FacultyDispositionPanel,
  getAssembledExamFacultyDisposition,
  type AdminFacultyDispositionRefusal,
  type AdminFacultyDispositionTrail,
  type AppendFacultyDispositionCommand,
} from "@openclinxr/ui-shared/faculty-disposition-panel";

const EXAM_RUN_ID = "exam_run_faculty_disposition_001";
const DIGEST = "a".repeat(64);
const ATTESTED_AT = "2026-09-04T12:00:00.000Z";

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
});

afterEach(() => {
  cleanup();
});

describe("FacultyDispositionPanel", () => {
  it("renders the immutable packet digest, empty audit trail, and non-scoring claim boundary", async () => {
    const loadTrail = vi.fn(async () => emptyTrail());
    render(<FacultyDispositionPanel examRunId={EXAM_RUN_ID} loadTrail={loadTrail} now={() => ATTESTED_AT} />);

    const panel = await screen.findByLabelText("Faculty disposition panel");
    expect(loadTrail).toHaveBeenCalledWith(EXAM_RUN_ID);
    expect(within(panel).getByLabelText("Visible packet digest")).toHaveTextContent(DIGEST);
    expect(within(panel).getByLabelText("Faculty disposition audit trail")).toHaveTextContent("No attested dispositions yet.");
    expect(within(panel).getByLabelText("Faculty disposition claim boundary")).toHaveTextContent("assembled_exam_faculty_disposition_not_score_use");
    expect(within(panel).getByLabelText("Faculty disposition claim boundary")).toHaveTextContent("scoringValidityClaimed false");
    expect(within(panel).getByLabelText("Faculty disposition claim boundary")).toHaveTextContent("examEquivalenceGate false");
    expect(panel).toHaveTextContent("Not score use");
    expect(panel).not.toHaveTextContent("credentialing");
    expect(panel).toHaveTextContent("not validated scoring");
  });

  it("appends a draft then refreshes the trail from the server", async () => {
    const loadTrail = vi.fn(async () => emptyTrail());
    loadTrail.mockResolvedValueOnce(emptyTrail());
    const appendTrail = vi.fn(async (input: AppendFacultyDispositionCommand) => draftedTrail(input));
    loadTrail.mockResolvedValueOnce(draftedTrail({
      examRunId: EXAM_RUN_ID,
      reviewerId: "faculty_reviewer_001",
      packetDigest: DIGEST,
      disposition: "hold",
      status: "draft",
      rationale: "Hold for debrief; no score use.",
      attestedAt: ATTESTED_AT,
    }));

    render(
      <FacultyDispositionPanel
        examRunId={EXAM_RUN_ID}
        loadTrail={loadTrail}
        appendTrail={appendTrail}
        now={() => ATTESTED_AT}
      />,
    );

    await screen.findByLabelText("Visible packet digest");
    fireEvent.change(screen.getByLabelText("Faculty reviewer identity"), { target: { value: "faculty_reviewer_001" } });
    fireEvent.change(screen.getByLabelText("Faculty disposition rationale"), { target: { value: "Hold for debrief; no score use." } });
    fireEvent.click(screen.getByLabelText("Save disposition draft"));

    await waitFor(() => {
      expect(appendTrail).toHaveBeenCalledWith({
        examRunId: EXAM_RUN_ID,
        reviewerId: "faculty_reviewer_001",
        packetDigest: DIGEST,
        disposition: "hold",
        status: "draft",
        rationale: "Hold for debrief; no score use.",
        attestedAt: ATTESTED_AT,
      });
    });
    await waitFor(() => expect(loadTrail).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText("Disposition decision 1")).toHaveTextContent("draft hold");
    expect(screen.getByLabelText("Faculty reviewer identity")).toBeDisabled();
  });

  it("finalizes against the visible digest and then refuses further drafts", async () => {
    const loadTrail = vi.fn(async () => draftedTrail({
      examRunId: EXAM_RUN_ID,
      reviewerId: "faculty_reviewer_001",
      packetDigest: DIGEST,
      disposition: "hold",
      status: "draft",
      rationale: "Hold for debrief; no score use.",
      attestedAt: ATTESTED_AT,
    }));
    const appendTrail = vi.fn(async () => finalizedTrail());
    loadTrail
      .mockResolvedValueOnce(draftedTrail({
        examRunId: EXAM_RUN_ID,
        reviewerId: "faculty_reviewer_001",
        packetDigest: DIGEST,
        disposition: "hold",
        status: "draft",
        rationale: "Hold for debrief; no score use.",
        attestedAt: ATTESTED_AT,
      }))
      .mockResolvedValueOnce(finalizedTrail());

    render(
      <FacultyDispositionPanel
        examRunId={EXAM_RUN_ID}
        loadTrail={loadTrail}
        appendTrail={appendTrail}
        now={() => ATTESTED_AT}
      />,
    );

    await screen.findByLabelText("Disposition decision 1");
    fireEvent.change(screen.getByLabelText("Faculty disposition rationale"), { target: { value: "Finalize after debrief prep." } });
    fireEvent.click(screen.getByLabelText("Choose disposition local_debrief_ready"));
    fireEvent.click(screen.getByLabelText("Finalize disposition"));

    await waitFor(() => {
      expect(appendTrail).toHaveBeenCalledWith(expect.objectContaining({ status: "final", disposition: "local_debrief_ready" }));
    });
    expect(await screen.findByLabelText("Faculty disposition finalized")).toBeInTheDocument();
    expect(screen.getByLabelText("Save disposition draft")).toBeDisabled();
    expect(screen.getByLabelText("Finalize disposition")).toBeDisabled();
  });

  it("renders typed refusals for stale digest, self-review, identity mutation, and finalized records", async () => {
    const codes: AdminFacultyDispositionRefusal["code"][] = [
      "stale_packet_digest",
      "producer_self_review",
      "identity_mutation",
      "finalized",
    ];
    for (const code of codes) {
      cleanup();
      const appendTrail = vi.fn(async () => refusal(code));
      render(
        <FacultyDispositionPanel
          examRunId={EXAM_RUN_ID}
          loadTrail={async () => emptyTrail()}
          appendTrail={appendTrail}
          now={() => ATTESTED_AT}
        />,
      );
      await screen.findByLabelText("Visible packet digest");
      fireEvent.change(screen.getByLabelText("Faculty reviewer identity"), { target: { value: "faculty_reviewer_001" } });
      fireEvent.change(screen.getByLabelText("Faculty disposition rationale"), { target: { value: "Attempt." } });
      fireEvent.click(screen.getByLabelText("Save disposition draft"));
      expect(await screen.findByLabelText(`Faculty disposition refusal ${code}`)).toHaveTextContent(code);
      expect(screen.getByLabelText(`Faculty disposition refusal ${code}`)).toHaveTextContent("scoringValidityClaimed false");
    }
  });
});

describe("faculty disposition REST transport", () => {
  it("GETs the trail and POSTs an append without replacing evidence or the trail", async () => {
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = String(init?.method ?? "GET");
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      calls.push({ url: String(url), method, body });
      if (method === "GET") {
        return jsonResponse(emptyTrail());
      }
      return jsonResponse(draftedTrail(body as AppendFacultyDispositionCommand), 201);
    };

    const loaded = await getAssembledExamFacultyDisposition({ examRunId: EXAM_RUN_ID, fetch: fetchImpl, baseUrl: "http://127.0.0.1:8787" });
    expect(loaded?.packetDigest).toBe(DIGEST);
    expect(calls[0]?.url).toBe(`http://127.0.0.1:8787/exam-runs/${EXAM_RUN_ID}/assembled-review-disposition`);
    expect(calls[0]?.method).toBe("GET");

    const appended = await appendAssembledExamFacultyDisposition({
      examRunId: EXAM_RUN_ID,
      reviewerId: "faculty_reviewer_001",
      packetDigest: DIGEST,
      disposition: "hold",
      status: "draft",
      rationale: "Hold.",
      attestedAt: ATTESTED_AT,
      fetch: fetchImpl,
      baseUrl: "http://127.0.0.1:8787",
    });
    expect("packetDigest" in appended && appended.packetDigest).toBe(DIGEST);
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.body).not.toHaveProperty("evidencePacket");
    expect(calls[1]?.body).not.toHaveProperty("decisions");
  });
});

function emptyTrail(): AdminFacultyDispositionTrail {
  return {
    examRunId: EXAM_RUN_ID,
    packetDigest: DIGEST,
    evidencePacket: {
      examRunId: EXAM_RUN_ID,
      packetDigest: DIGEST,
      learnerId: "learner_001",
      stationRunIds: ["run_station_001"],
      claimBoundary: "assembled_exam_review_packet_not_exam_equivalence",
      notEvidenceFor: ["exam_equivalence"],
      examEquivalenceGate: false,
    },
    decisions: [],
    current: null,
    claimBoundary: "assembled_exam_faculty_disposition_not_score_use",
    notEvidenceFor: ["exam_equivalence", "clinical_validity", "scoring_validity"],
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}

function draftedTrail(input: AppendFacultyDispositionCommand): AdminFacultyDispositionTrail {
  const decision = {
    decisionId: "assembled_exam_disposition:1",
    examRunId: input.examRunId,
    reviewerId: input.reviewerId,
    packetDigest: input.packetDigest,
    disposition: input.disposition,
    status: input.status,
    rationale: input.rationale,
    attestedAt: input.attestedAt,
    sequence: 1,
  };
  return { ...emptyTrail(), decisions: [decision], current: decision };
}

function finalizedTrail(): AdminFacultyDispositionTrail {
  const draft = draftedTrail({
    examRunId: EXAM_RUN_ID,
    reviewerId: "faculty_reviewer_001",
    packetDigest: DIGEST,
    disposition: "hold",
    status: "draft",
    rationale: "Hold for debrief; no score use.",
    attestedAt: ATTESTED_AT,
  }).decisions[0]!;
  const finalDecision = {
    ...draft,
    decisionId: "assembled_exam_disposition:2",
    disposition: "local_debrief_ready" as const,
    status: "final" as const,
    rationale: "Finalize after debrief prep.",
    sequence: 2,
  };
  return { ...emptyTrail(), decisions: [draft, finalDecision], current: finalDecision };
}

function refusal(code: AdminFacultyDispositionRefusal["code"]): AdminFacultyDispositionRefusal {
  return {
    code,
    reason: code,
    notEvidenceFor: ["scoring_validity"],
    scoringValidityClaimed: false,
    examEquivalenceGate: false,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}