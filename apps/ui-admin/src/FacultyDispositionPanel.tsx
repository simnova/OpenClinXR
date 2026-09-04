import type { FacultyDispositionRefusalCode, FacultyDispositionStatus, FacultyDispositionValue } from "@openclinxr/graphql/client";
import { Alert, Button, Input, Space, Spin, Tag, Typography } from "antd";
import { type ReactElement, useEffect, useState } from "react";

export const ASSEMBLED_EXAM_DISPOSITION_PATH = "/exam-runs/:examRunId/assembled-review-disposition";

export const FACULTY_DISPOSITION_VALUES = ["hold", "local_debrief_ready", "needs_revision"] as const satisfies readonly FacultyDispositionValue[];

export const FACULTY_DISPOSITION_CLAIM_BOUNDARY = "assembled_exam_faculty_disposition_not_score_use" as const;

const DISPOSITION_LABEL: Record<FacultyDispositionValue, string> = {
  hold: "Hold",
  local_debrief_ready: "Local debrief ready",
  needs_revision: "Needs revision",
};

const REFUSAL_TITLE: Record<FacultyDispositionRefusalCode, string> = {
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

export function assembledExamDispositionPath(examRunId: string): string {
  return `/exam-runs/${encodeURIComponent(examRunId)}/assembled-review-disposition`;
}

export async function getAssembledExamFacultyDisposition(
  input: { examRunId: string } & FacultyDispositionTransport,
): Promise<AdminFacultyDispositionTrail | null> {
  const response = await dispositionRequest(input, input.examRunId);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`OpenClinXR admin API request failed: GET ${assembledExamDispositionPath(input.examRunId)} ${response.status}`);
  }
  return asTrail(await response.json());
}

export async function appendAssembledExamFacultyDisposition(
  input: AppendFacultyDispositionCommand & FacultyDispositionTransport,
): Promise<AdminFacultyDispositionTrail | AdminFacultyDispositionRefusal> {
  const response = await dispositionRequest(input, input.examRunId, {
    reviewerId: input.reviewerId,
    packetDigest: input.packetDigest,
    disposition: input.disposition,
    status: input.status,
    rationale: input.rationale,
    attestedAt: input.attestedAt,
    ...(input.decisionId ? { decisionId: input.decisionId } : {}),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (response.status === 409 && isRecord(body)) {
    const refusal = asRefusal({
      code: body["error"],
      reason: body["reason"],
      notEvidenceFor: body["notEvidenceFor"],
    });
    if (refusal) {
      return refusal;
    }
  }
  if (!response.ok) {
    throw new Error(`OpenClinXR admin API request failed: POST ${assembledExamDispositionPath(input.examRunId)} ${response.status}`);
  }
  const trail = asTrail(body);
  if (!trail) {
    throw new Error("OpenClinXR admin API request failed: assembled-review-disposition missing_trail");
  }
  return trail;
}

export type FacultyDispositionPanelProps = {
  examRunId?: string;
  loadTrail?: (examRunId: string) => Promise<AdminFacultyDispositionTrail | null>;
  appendTrail?: (input: AppendFacultyDispositionCommand) => Promise<AdminFacultyDispositionTrail | AdminFacultyDispositionRefusal>;
  now?: () => string;
  onLoadExamRun?: (examRunId: string) => void;
};

type PanelState =
  | { status: "idle" }
  | { status: "loading"; examRunId: string }
  | { status: "error"; examRunId: string; message: string }
  | { status: "ready"; examRunId: string; trail: AdminFacultyDispositionTrail };

const defaultLoadTrail = (examRunId: string) => getAssembledExamFacultyDisposition({ examRunId });
const defaultAppendTrail = (input: AppendFacultyDispositionCommand) => appendAssembledExamFacultyDisposition(input);
const defaultNow = () => new Date().toISOString();

export function FacultyDispositionPanel({
  examRunId = "",
  loadTrail = defaultLoadTrail,
  appendTrail = defaultAppendTrail,
  now = defaultNow,
  onLoadExamRun,
}: FacultyDispositionPanelProps): ReactElement {
  const [examRunIdInput, setExamRunIdInput] = useState(examRunId);
  const [state, setState] = useState<PanelState>(examRunId.trim() ? { status: "loading", examRunId: examRunId.trim() } : { status: "idle" });
  const [reviewerId, setReviewerId] = useState("");
  const [rationale, setRationale] = useState("");
  const [disposition, setDisposition] = useState<FacultyDispositionValue>("hold");
  const [saving, setSaving] = useState<FacultyDispositionStatus | null>(null);
  const [refusal, setRefusal] = useState<AdminFacultyDispositionRefusal | null>(null);

  useEffect(() => {
    const nextExamRunId = examRunId.trim();
    setExamRunIdInput(examRunId);
    setRefusal(null);
    if (!nextExamRunId) {
      setState((current) => (current.status === "idle" ? current : { status: "idle" }));
      return;
    }
    let active = true;
    setState({ status: "loading", examRunId: nextExamRunId });
    loadTrail(nextExamRunId)
      .then((trail) => {
        if (!active) {
          return;
        }
        if (!trail) {
          setState({ status: "error", examRunId: nextExamRunId, message: "assembled_exam_faculty_disposition_not_found" });
          return;
        }
        setState({ status: "ready", examRunId: nextExamRunId, trail });
        setReviewerId(trail.current?.reviewerId ?? trail.decisions[0]?.reviewerId ?? "");
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            examRunId: nextExamRunId,
            message: error instanceof Error ? error.message : "Unknown faculty disposition error",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [examRunId, loadTrail]);

  const trail = state.status === "ready" ? state.trail : null;
  const lockedReviewer = trail?.decisions[0]?.reviewerId;
  const finalized = trail?.current?.status === "final";
  const formLocked = finalized || saving !== null;

  const decisions = trail?.decisions ?? [];

  const submitExamRun = () => {
    const nextExamRunId = examRunIdInput.trim();
    if (nextExamRunId) {
      onLoadExamRun?.(nextExamRunId);
      if (!onLoadExamRun) {
        setState({ status: "loading", examRunId: nextExamRunId });
        void loadTrail(nextExamRunId).then((loaded) => {
          if (!loaded) {
            setState({ status: "error", examRunId: nextExamRunId, message: "assembled_exam_faculty_disposition_not_found" });
            return;
          }
          setState({ status: "ready", examRunId: nextExamRunId, trail: loaded });
          setReviewerId(loaded.current?.reviewerId ?? loaded.decisions[0]?.reviewerId ?? "");
        }).catch((error: unknown) => {
          setState({
            status: "error",
            examRunId: nextExamRunId,
            message: error instanceof Error ? error.message : "Unknown faculty disposition error",
          });
        });
      }
    }
  };

  const persist = async (status: FacultyDispositionStatus) => {
    if (!trail) {
      return;
    }
    setRefusal(null);
    setSaving(status);
    try {
      const result = await appendTrail({
        examRunId: trail.examRunId,
        reviewerId: reviewerId.trim(),
        packetDigest: trail.packetDigest,
        disposition,
        status,
        rationale: rationale.trim(),
        attestedAt: now(),
      });
      if (isRefusal(result)) {
        setRefusal(result);
        return;
      }
      const refreshed = await loadTrail(trail.examRunId);
      if (!refreshed) {
        setState({ status: "error", examRunId: trail.examRunId, message: "assembled_exam_faculty_disposition_not_found" });
        return;
      }
      setState({ status: "ready", examRunId: trail.examRunId, trail: refreshed });
      setReviewerId(refreshed.current?.reviewerId ?? refreshed.decisions[0]?.reviewerId ?? reviewerId);
    } catch (error: unknown) {
      setState({
        status: "error",
        examRunId: trail.examRunId,
        message: error instanceof Error ? error.message : "Unknown faculty disposition error",
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="workbench-panel" aria-label="Faculty disposition panel">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Append-only faculty disposition</Typography.Text>
          <Typography.Title level={4}>Faculty Disposition</Typography.Title>
        </div>
        <Tag color="gold">Not score use</Tag>
      </div>
      <Typography.Paragraph type="secondary">
        Attest a draft, then finalize against the visible assembled packet digest. The trail is append-only.
        This is not validated scoring, clinical validity, or exam equivalence.
      </Typography.Paragraph>
      <Space wrap>
        <Input
          aria-label="Faculty disposition exam run ID"
          id="faculty-disposition-exam-run-id"
          name="examRunId"
          value={examRunIdInput}
          onChange={(event) => setExamRunIdInput(event.currentTarget.value)}
          onPressEnter={submitExamRun}
        />
        <Button type="primary" onClick={submitExamRun} disabled={examRunIdInput.trim().length === 0}>
          Load disposition trail
        </Button>
      </Space>

      {state.status === "idle" ? (
        <Alert type="info" title="Assembled exam run required" description="Enter an exam run ID to load the immutable packet digest and disposition trail." showIcon />
      ) : null}
      {state.status === "loading" ? <Spin /> : null}
      {state.status === "error" ? (
        <Alert type="error" title="Faculty disposition unavailable" description={state.message} showIcon />
      ) : null}

      {trail ? (
        <>
          <fieldset className="readiness-strip review-replay-strip" aria-label="Assembled packet digest">
            <div className="readiness-metric">
              <Typography.Text strong>packetDigest</Typography.Text>
              <Typography.Paragraph code aria-label="Visible packet digest">{trail.packetDigest}</Typography.Paragraph>
            </div>
            <div className="readiness-metric">
              <Typography.Text strong>examRunId</Typography.Text>
              <Typography.Paragraph>{trail.examRunId}</Typography.Paragraph>
            </div>
            <div className="readiness-metric">
              <Typography.Text strong>stations</Typography.Text>
              <Typography.Paragraph>{trail.evidencePacket.stationRunIds.join(", ") || "none"}</Typography.Paragraph>
            </div>
          </fieldset>
          <Typography.Paragraph aria-label="Faculty disposition claim boundary">
            {`${trail.claimBoundary}; scoringValidityClaimed ${String(trail.scoringValidityClaimed)}; examEquivalenceGate ${String(trail.examEquivalenceGate)}; notEvidenceFor ${trail.notEvidenceFor.join(", ")}`}
          </Typography.Paragraph>

          <Typography.Text strong>Prior disposition audit trail</Typography.Text>
          {decisions.length === 0 ? (
            <Typography.Paragraph aria-label="Faculty disposition audit trail">No attested dispositions yet.</Typography.Paragraph>
          ) : (
            <ul aria-label="Faculty disposition audit trail">
              {decisions.map((decision) => (
                <li key={decision.decisionId} aria-label={`Disposition decision ${decision.sequence}`}>
                  <Typography.Text strong>{`${decision.status} ${decision.disposition}`}</Typography.Text>
                  <Typography.Paragraph type="secondary">
                    {`seq ${decision.sequence}; reviewer ${decision.reviewerId}; digest ${decision.packetDigest}; ${decision.attestedAt}`}
                  </Typography.Paragraph>
                  <Typography.Paragraph>{decision.rationale}</Typography.Paragraph>
                </li>
              ))}
            </ul>
          )}

          {refusal ? (
            <Alert
              type="warning"
              showIcon
              aria-label={`Faculty disposition refusal ${refusal.code}`}
              title={REFUSAL_TITLE[refusal.code]}
              description={`${refusal.code}: ${refusal.reason}. scoringValidityClaimed ${String(refusal.scoringValidityClaimed)}; examEquivalenceGate ${String(refusal.examEquivalenceGate)}.`}
            />
          ) : null}

          {finalized ? (
            <Alert
              type="info"
              showIcon
              aria-label="Faculty disposition finalized"
              title="Disposition finalized"
              description="Further drafts or identity changes are refused. This remains a review artifact, not a score."
            />
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Input
              aria-label="Faculty reviewer identity"
              id="faculty-disposition-reviewer-id"
              name="reviewerId"
              value={reviewerId}
              disabled={Boolean(lockedReviewer) || formLocked}
              onChange={(event) => setReviewerId(event.currentTarget.value)}
              placeholder="reviewer id"
            />
            <Input.TextArea
              aria-label="Faculty disposition rationale"
              id="faculty-disposition-rationale"
              name="rationale"
              value={rationale}
              disabled={formLocked}
              onChange={(event) => setRationale(event.currentTarget.value)}
              placeholder="Rationale for this attested disposition"
              rows={3}
            />
            <Space wrap aria-label="Faculty disposition value">
              {FACULTY_DISPOSITION_VALUES.map((value) => (
                <Button
                  key={value}
                  aria-label={`Choose disposition ${value}`}
                  type={disposition === value ? "primary" : "default"}
                  disabled={formLocked}
                  onClick={() => setDisposition(value)}
                >
                  {DISPOSITION_LABEL[value]}
                </Button>
              ))}
            </Space>
            <Space wrap>
              <Button
                aria-label="Save disposition draft"
                disabled={formLocked || reviewerId.trim().length === 0 || rationale.trim().length === 0}
                loading={saving === "draft"}
                onClick={() => void persist("draft")}
              >
                Save draft
              </Button>
              <Button
                aria-label="Finalize disposition"
                type="primary"
                disabled={formLocked || reviewerId.trim().length === 0 || rationale.trim().length === 0}
                loading={saving === "final"}
                onClick={() => void persist("final")}
              >
                Finalize
              </Button>
            </Space>
          </div>
        </>
      ) : null}
    </section>
  );
}

async function dispositionRequest(
  transport: FacultyDispositionTransport,
  examRunId: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const fetcher = transport.fetch ?? fetch;
  const baseUrl = (transport.baseUrl ?? "").replace(/\/$/, "");
  const url = `${baseUrl}${assembledExamDispositionPath(examRunId)}`;
  if (!body) {
    return fetcher(url, { method: "GET", cache: "no-store" });
  }
  return fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function asTrail(value: unknown): AdminFacultyDispositionTrail | null {
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

function asRefusal(value: unknown): AdminFacultyDispositionRefusal | null {
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

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRefusal(value: AdminFacultyDispositionTrail | AdminFacultyDispositionRefusal): value is AdminFacultyDispositionRefusal {
  return "code" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}