/**
 * Scenario governance review gates (clinical / psychometric / legal / simulationQa).
 *
 * Distinct from FacultyReviewDecisionPanel (station-run debrief hold/promote — no dimensions).
 * #176: four dimensions with caller-supplied rationale; unmade gates render as pending.
 */

import { Alert, Button, Input, Space, Tag, Typography } from "antd";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import type {
  AdminScenario,
  AdminScenarioReviewDecision,
  AdminScenarioReviewResult,
  SubmitScenarioReviewInput,
} from "./api-client.js";
import {
  SCENARIO_REVIEW_RECORDABLE_DIMENSIONS,
  SCENARIO_REVIEW_RATIONALE_IS_CALLER_SUPPLIED,
  SCENARIO_REVIEW_UNMADE_DECISION_DISPLAY,
  type ScenarioReviewDimension,
} from "./scenario-review-gate-constants.js";
export {
  SCENARIO_REVIEW_RECORDABLE_DIMENSIONS,
  SCENARIO_REVIEW_RATIONALE_IS_CALLER_SUPPLIED,
  SCENARIO_REVIEW_UNMADE_DECISION_DISPLAY,
  type ScenarioReviewDimension,
} from "./scenario-review-gate-constants.js";

const DIMENSION_LABELS: Record<ScenarioReviewDimension, string> = {
  clinical: "Clinical",
  psychometric: "Psychometric",
  legal: "Legal",
  simulationQa: "Simulation QA",
};

const DEFAULT_REVIEWER_IDS: Record<ScenarioReviewDimension, string> = {
  clinical: "admin_clinical_reviewer",
  psychometric: "admin_psychometric_reviewer",
  legal: "admin_legal_reviewer",
  simulationQa: "admin_simulation_qa_reviewer",
};

export type ScenarioReviewGatePanelProps = {
  scenario: AdminScenario;
  submitScenarioReview: (input: SubmitScenarioReviewInput) => Promise<AdminScenarioReviewResult>;
  listScenarioReviewDecisions: (input: {
    scenarioId: string;
    version: number;
  }) => Promise<AdminScenarioReviewDecision[]>;
  onScenarioUpdated?: (scenario: AdminScenarioReviewResult) => void;
};

type FormState = Record<ScenarioReviewDimension, { rationale: string; decision: "APPROVED" | "CHANGES_REQUESTED" }>;

type SaveState =
  | { status: "idle" }
  | { status: "saving"; dimension: ScenarioReviewDimension }
  | { status: "saved"; dimension: ScenarioReviewDimension }
  | { status: "error"; message: string };

function gateDisplayState(stateName: string): string {
  if (stateName === "approved" || stateName === "in_review" || stateName === "changes_requested" || stateName === "rejected") {
    return stateName;
  }
  // draft / unknown → pending so untouched scenarios show remaining work.
  return SCENARIO_REVIEW_UNMADE_DECISION_DISPLAY;
}

function gateColor(display: string): string {
  if (display === "approved") return "green";
  if (display === "in_review") return "blue";
  if (display === "changes_requested" || display === "rejected") return "red";
  return "gold";
}

function emptyForm(): FormState {
  return {
    clinical: { rationale: "", decision: "APPROVED" },
    psychometric: { rationale: "", decision: "APPROVED" },
    legal: { rationale: "", decision: "APPROVED" },
    simulationQa: { rationale: "", decision: "APPROVED" },
  };
}

export function ScenarioReviewGatePanel({
  scenario,
  submitScenarioReview,
  listScenarioReviewDecisions,
  onScenarioUpdated,
}: ScenarioReviewGatePanelProps): ReactElement {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [history, setHistory] = useState<AdminScenarioReviewDecision[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Real deps only: fetch keys + the list function. Gate states are effect triggers below —
  // they are not inputs to the request body.
  const loadHistory = useCallback(() => {
    void listScenarioReviewDecisions({ scenarioId: scenario.scenarioId, version: scenario.version })
      .then((records) => {
        setHistory(records);
        setHistoryError(null);
      })
      .catch((error: unknown) => {
        setHistoryError(error instanceof Error ? error.message : "Unable to load decision history");
      });
  }, [listScenarioReviewDecisions, scenario.scenarioId, scenario.version]);

  // Reload when identity/list fn changes (via loadHistory) OR any gate flips after a decision.
  useEffect(() => {
    loadHistory();
  }, [
    loadHistory,
    scenario.review.clinical,
    scenario.review.psychometric,
    scenario.review.legal,
    scenario.review.simulationQa,
  ]);

  const recordDecision = async (dimension: ScenarioReviewDimension) => {
    const rationale = form[dimension].rationale.trim();
    if (rationale.length === 0) {
      setSaveState({ status: "error", message: "Rationale (required) must not be empty." });
      return;
    }

    setSaveState({ status: "saving", dimension });
    try {
      // evidenceRefs required by API; optional for the human — supply a local procedural ref when empty.
      const evidenceRefs = [`evidence:local-admin:${scenario.scenarioId}:${dimension}`];
      const nextScenario = await submitScenarioReview({
        scenarioId: scenario.scenarioId,
        version: scenario.version,
        reviewerRole: dimension,
        reviewerId: DEFAULT_REVIEWER_IDS[dimension],
        decision: form[dimension].decision,
        comments: rationale,
        evidenceRefs,
      });
      onScenarioUpdated?.(nextScenario);
      setForm((current) => ({
        ...current,
        [dimension]: { ...current[dimension], rationale: "" },
      }));
      setSaveState({ status: "saved", dimension });
      loadHistory();
    } catch (error) {
      setSaveState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown review decision error",
      });
    }
  };

  return (
    <section className="workbench-panel" aria-label="Scenario review decision panel">
      <Typography.Title level={4}>Scenario review decisions</Typography.Title>
      <Typography.Paragraph type="secondary">
        Record a decision for each governance dimension. Rationale (required) is free text supplied by the reviewer.
        Unmade gates show as pending. Per-dimension authorization is not enforced here (faculty/admin may submit any dimension).
      </Typography.Paragraph>

      <div className="tag-row" aria-label="Review gate status summary">
        {SCENARIO_REVIEW_RECORDABLE_DIMENSIONS.map((dimension) => {
          const raw = scenario.review[dimension];
          const display = gateDisplayState(typeof raw === "string" ? raw : "draft");
          return (
            <Tag key={dimension} color={gateColor(display)}>
              {`${dimension}: ${display}`}
            </Tag>
          );
        })}
      </div>

      {saveState.status === "saved" ? (
        <Alert
          type="success"
          title="Review decision recorded"
          description={`${saveState.dimension} gate updated`}
          showIcon
        />
      ) : null}
      {saveState.status === "error" ? (
        <Alert type="error" title="Review decision failed" description={saveState.message} showIcon />
      ) : null}

      <div className="scenario-review-gate-forms">
        {SCENARIO_REVIEW_RECORDABLE_DIMENSIONS.map((dimension) => {
          const raw = scenario.review[dimension];
          const display = gateDisplayState(typeof raw === "string" ? raw : "draft");
          const saving = saveState.status === "saving" && saveState.dimension === dimension;
          return (
            <div
              key={dimension}
              className="scenario-review-gate-form"
              aria-label={`${DIMENSION_LABELS[dimension]} review dimension`}
            >
              <Space wrap align="start" style={{ width: "100%", justifyContent: "space-between" }}>
                <div>
                  <Typography.Text strong>{`Record ${DIMENSION_LABELS[dimension].toLowerCase()} decision`}</Typography.Text>
                  <Typography.Text type="secondary" style={{ display: "block" }}>
                    {`Current: ${display}`}
                  </Typography.Text>
                </div>
                <Space>
                  <Button
                    size="small"
                    type={form[dimension].decision === "APPROVED" ? "primary" : "default"}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        [dimension]: { ...current[dimension], decision: "APPROVED" },
                      }))
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="small"
                    danger={form[dimension].decision === "CHANGES_REQUESTED"}
                    type={form[dimension].decision === "CHANGES_REQUESTED" ? "primary" : "default"}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        [dimension]: { ...current[dimension], decision: "CHANGES_REQUESTED" },
                      }))
                    }
                  >
                    Changes requested
                  </Button>
                </Space>
              </Space>
              <Typography.Text type="secondary">Rationale (required)</Typography.Text>
              <Input.TextArea
                aria-label={`${DIMENSION_LABELS[dimension]} rationale`}
                rows={2}
                value={form[dimension].rationale}
                placeholder="Rationale (required)"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    [dimension]: { ...current[dimension], rationale: event.target.value },
                  }))
                }
              />
              <Button
                type="primary"
                loading={saving}
                disabled={form[dimension].rationale.trim().length === 0}
                onClick={() => void recordDecision(dimension)}
                aria-label={`Submit ${DIMENSION_LABELS[dimension].toLowerCase()} decision`}
              >
                {`Submit ${DIMENSION_LABELS[dimension].toLowerCase()} decision`}
              </Button>
            </div>
          );
        })}
      </div>

      <section aria-label="Scenario review decision history" style={{ marginTop: 16 }}>
        <Typography.Title level={5}>Decision history</Typography.Title>
        {historyError ? (
          <Alert type="warning" title="Decision history unavailable" description={historyError} showIcon />
        ) : null}
        {history === null && !historyError ? (
          <Typography.Text type="secondary">Loading decision history…</Typography.Text>
        ) : null}
        {history && history.length === 0 ? (
          <Typography.Paragraph type="secondary">No decisions recorded yet.</Typography.Paragraph>
        ) : null}
        {history && history.length > 0 ? (
          <ol className="compact-list">
            {history.map((record) => (
              <li key={`${record.reviewerRole}-${record.reviewerId}-${record.reviewedAt}`}>
                <Typography.Text>
                  {`${record.reviewerRole}: ${record.decision} — ${record.comments}`}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {`${record.reviewerId} · ${record.reviewedAt}`}
                </Typography.Text>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </section>
  );
}
