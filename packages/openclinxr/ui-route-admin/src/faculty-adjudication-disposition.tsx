import type { FacultyDispositionStatus, FacultyDispositionValue } from "@openclinxr/graphql/client";
import { Alert, Button, Input, Space, Spin, Typography } from "antd";
import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  appendAssembledExamFacultyDispositionGraphql,
  DISPOSITION_LABEL,
  FACULTY_DISPOSITION_VALUES,
  type FacultyDispositionRefusalView,
  type FacultyDispositionTrailView,
  type FacultyGraphqlExecute,
  isFacultyDispositionRefusal,
  postAdminGraphql,
  queryAssembledExamFacultyDisposition,
  REFUSAL_TITLE,
} from "./faculty-adjudication-graphql.js";

export type FacultyAdjudicationDispositionProps = {
  examRunId: string;
  executeGraphql?: FacultyGraphqlExecute | undefined;
  now?: (() => string) | undefined;
  clinicalValidityClaimed?: false;
  workspaceDispositionClaimBoundary?: string;
};

type TrailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; trail: FacultyDispositionTrailView };

export function FacultyAdjudicationDispositionTrail({
  examRunId,
  executeGraphql = postAdminGraphql,
  now = () => new Date().toISOString(),
  clinicalValidityClaimed = false,
  workspaceDispositionClaimBoundary = "faculty_adjudication_disposition_not_score_use_or_clinical_validity",
}: FacultyAdjudicationDispositionProps): ReactElement {
  const executeRef = useRef(executeGraphql);
  executeRef.current = executeGraphql;
  const [state, setState] = useState<TrailState>({ status: "loading" });
  const [reviewerId, setReviewerId] = useState("");
  const [rationale, setRationale] = useState("");
  const [packetDigest, setPacketDigest] = useState("");
  const [decisionId, setDecisionId] = useState("");
  const [disposition, setDisposition] = useState<FacultyDispositionValue>("hold");
  const [saving, setSaving] = useState<FacultyDispositionStatus | null>(null);
  const [refusal, setRefusal] = useState<FacultyDispositionRefusalView | null>(null);

  useEffect(() => {
    let active = true;
    setRefusal(null);
    setState({ status: "loading" });
    queryAssembledExamFacultyDisposition(examRunId, executeRef.current)
      .then((loaded) => {
        if (!active) {
          return;
        }
        if (!loaded) {
          setState({ status: "error", message: "assembled_exam_faculty_disposition_not_found" });
          return;
        }
        setState({ status: "ready", trail: loaded });
        setPacketDigest(loaded.packetDigest);
        setReviewerId(loaded.current?.reviewerId ?? loaded.decisions[0]?.reviewerId ?? "");
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unknown faculty disposition error",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [examRunId]);

  const persist = async (status: FacultyDispositionStatus) => {
    if (state.status !== "ready") {
      return;
    }
    setRefusal(null);
    setSaving(status);
    try {
      const result = await appendAssembledExamFacultyDispositionGraphql(
        {
          examRunId: state.trail.examRunId,
          reviewerId: reviewerId.trim(),
          packetDigest: packetDigest.trim() || state.trail.packetDigest,
          disposition,
          status,
          rationale: rationale.trim(),
          attestedAt: now(),
          ...(decisionId.trim() ? { decisionId: decisionId.trim() } : {}),
        },
        executeRef.current,
      );
      if (isFacultyDispositionRefusal(result)) {
        setRefusal(result);
        return;
      }
      const refreshed = await queryAssembledExamFacultyDisposition(state.trail.examRunId, executeRef.current);
      if (!refreshed) {
        setState({ status: "error", message: "assembled_exam_faculty_disposition_not_found" });
        return;
      }
      setState({ status: "ready", trail: refreshed });
      setPacketDigest(refreshed.packetDigest);
      setReviewerId(refreshed.current?.reviewerId ?? refreshed.decisions[0]?.reviewerId ?? reviewerId);
    } catch (error: unknown) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown faculty disposition error",
      });
    } finally {
      setSaving(null);
    }
  };

  const trail = state.status === "ready" ? state.trail : null;
  const decisions = trail?.decisions ?? [];

  return (
    <section aria-label="Faculty review disposition">
      <Typography.Text strong>Faculty review disposition</Typography.Text>
      <Typography.Paragraph type="secondary">
        Append draft then final through generated GraphQL operations. scoringValidityClaimed remains false.
        examEquivalenceGate remains false. This is not score use, clinical validity, or exam equivalence.
      </Typography.Paragraph>
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
            <ol aria-label="Faculty disposition audit trail">
              {decisions.map((decision) => (
                <li key={decision.decisionId} aria-label={`Disposition decision ${decision.sequence}`}>
                  <Typography.Text strong>{`${decision.status} ${decision.disposition}`}</Typography.Text>
                  <Typography.Paragraph type="secondary">
                    {`seq ${decision.sequence}; reviewer ${decision.reviewerId}; digest ${decision.packetDigest}; ${decision.attestedAt}`}
                  </Typography.Paragraph>
                  <Typography.Paragraph>{decision.rationale}</Typography.Paragraph>
                </li>
              ))}
            </ol>
          )}
          {trail.current ? (
            <Typography.Paragraph aria-label="Recorded faculty disposition">
              {`${trail.current.disposition}; ${trail.current.status}; scoringValidityClaimed ${String(trail.scoringValidityClaimed)}; examEquivalenceGate ${String(trail.examEquivalenceGate)}; clinicalValidityClaimed ${String(clinicalValidityClaimed)}; ${trail.claimBoundary}; ${workspaceDispositionClaimBoundary}`}
            </Typography.Paragraph>
          ) : null}
        </>
      ) : null}
      {refusal ? (
        <Alert
          type="warning"
          showIcon
          aria-label={`Faculty disposition refusal ${refusal.code}`}
          title={REFUSAL_TITLE[refusal.code]}
          description={`${refusal.__typename}; ${refusal.code}: ${refusal.reason}. scoringValidityClaimed ${String(refusal.scoringValidityClaimed)}; examEquivalenceGate ${String(refusal.examEquivalenceGate)}.`}
        />
      ) : null}
      {trail ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input
            aria-label="Faculty reviewer identity"
            id="faculty-adjudication-reviewer-id"
            name="reviewerId"
            value={reviewerId}
            disabled={saving !== null}
            onChange={(event) => setReviewerId(event.currentTarget.value)}
            placeholder="reviewer id"
          />
          <Input
            aria-label="Faculty disposition packet digest"
            id="faculty-adjudication-packet-digest"
            name="packetDigest"
            value={packetDigest}
            disabled={saving !== null}
            onChange={(event) => setPacketDigest(event.currentTarget.value)}
          />
          <Input
            aria-label="Faculty disposition decision id"
            id="faculty-adjudication-decision-id"
            name="decisionId"
            value={decisionId}
            disabled={saving !== null}
            onChange={(event) => setDecisionId(event.currentTarget.value)}
            placeholder="optional decision id"
          />
          <Input
            aria-label="Faculty disposition rationale"
            id="faculty-adjudication-rationale"
            name="rationale"
            value={rationale}
            disabled={saving !== null}
            onChange={(event) => setRationale(event.currentTarget.value)}
            placeholder="Rationale for this attested disposition"
          />
          <Space wrap aria-label="Faculty disposition value">
            {FACULTY_DISPOSITION_VALUES.map((value) => (
              <Button
                key={value}
                aria-label={`Choose disposition ${value}`}
                type={disposition === value ? "primary" : "default"}
                disabled={saving !== null}
                onClick={() => setDisposition(value)}
              >
                {DISPOSITION_LABEL[value]}
              </Button>
            ))}
          </Space>
          <Space wrap>
            <Button
              aria-label="Save disposition draft"
              disabled={saving !== null || reviewerId.trim().length === 0 || rationale.trim().length === 0}
              loading={saving === "draft"}
              onClick={() => void persist("draft")}
            >
              Save draft
            </Button>
            <Button
              aria-label="Finalize disposition"
              type="primary"
              disabled={saving !== null || reviewerId.trim().length === 0 || rationale.trim().length === 0}
              loading={saving === "final"}
              onClick={() => void persist("final")}
            >
              Finalize
            </Button>
          </Space>
        </div>
      ) : null}
    </section>
  );
}
