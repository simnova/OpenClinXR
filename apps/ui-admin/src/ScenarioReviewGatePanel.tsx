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

export const SCENARIO_REVIEW_STALE_DECISION_DISPLAY = "stale" as const;
export const AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX = "authoredContentIdentity:";

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Authored content identity: scenario fields excluding review labels so unchanged labels cannot keep a decision current. */
export function authoredScenarioContentIdentity(scenario: AdminScenario): string {
  const authored = {
    scenarioId: scenario.scenarioId,
    version: scenario.version,
    title: scenario.title,
    clinicalObjectives: scenario.clinicalObjectives,
    requiredTraceTags: scenario.requiredTraceTags,
    actors: scenario.actors.map((actor) => ({
      actorId: actor.actorId,
      role: actor.role,
      displayName: actor.displayName,
    })),
    assetNeeds: scenario.assetNeeds.map((need) => ({
      assetId: need.assetId,
      assetType: need.assetType,
    })),
  };
  return fnv1aHex(JSON.stringify(authored));
}

export function authoredContentIdentityFromEvidenceRefs(evidenceRefs: readonly string[]): string | undefined {
  const found = evidenceRefs.find((ref) => ref.startsWith(AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX));
  return found === undefined ? undefined : found.slice(AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX.length);
}

export function resolveScenarioReviewGateDisplay(input: {
  dimension: ScenarioReviewDimension;
  reviewLabel: string;
  scenarioId: string;
  version: number;
  currentAuthoredContentIdentity: string;
  history: AdminScenarioReviewDecision[] | null;
  boundAuthoredContentIdentity?: string;
}): string {
  const rawDisplay = gateDisplayState(typeof input.reviewLabel === "string" ? input.reviewLabel : "draft");
  if (input.history === null) {
    return rawDisplay;
  }
  const matching = input.history.filter(
    (record) =>
      record.scenarioId === input.scenarioId &&
      record.version === input.version &&
      record.reviewerRole === input.dimension,
  );
  if (matching.length === 0) {
    return rawDisplay === SCENARIO_REVIEW_UNMADE_DECISION_DISPLAY
      ? rawDisplay
      : SCENARIO_REVIEW_STALE_DECISION_DISPLAY;
  }
  const latest = matching[matching.length - 1];
  const bound =
    input.boundAuthoredContentIdentity ??
    (latest === undefined ? undefined : authoredContentIdentityFromEvidenceRefs(latest.evidenceRefs)) ??
    input.currentAuthoredContentIdentity;
  if (bound !== input.currentAuthoredContentIdentity) {
    return SCENARIO_REVIEW_STALE_DECISION_DISPLAY;
  }
  return rawDisplay;
}

export function scenarioReviewGatesAllowLearnerUse(
  displays: Record<ScenarioReviewDimension, string>,
): boolean {
  return SCENARIO_REVIEW_RECORDABLE_DIMENSIONS.every((dimension) => displays[dimension] === "approved");
}

function gateColor(display: string): string {
  if (display === "approved") return "green";
  if (display === "in_review") return "blue";
  if (display === "changes_requested" || display === "rejected") return "red";
  if (display === SCENARIO_REVIEW_STALE_DECISION_DISPLAY) return "orange";
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
  const scenarioIdentityKey = `${scenario.scenarioId}:${scenario.version}`;
  const [boundIdentities, setBoundIdentities] = useState<{
    key: string;
    values: Partial<Record<ScenarioReviewDimension, string>>;
  }>({ key: scenarioIdentityKey, values: {} });
  const currentAuthoredContentIdentity = authoredScenarioContentIdentity(scenario);
  const boundValues = boundIdentities.key === scenarioIdentityKey ? boundIdentities.values : {};

  const gateDisplayFor = (dimension: ScenarioReviewDimension): string => {
    const raw = scenario.review[dimension];
    const bound = boundValues[dimension];
    return resolveScenarioReviewGateDisplay({
      dimension,
      reviewLabel: typeof raw === "string" ? raw : "draft",
      scenarioId: scenario.scenarioId,
      version: scenario.version,
      currentAuthoredContentIdentity,
      history,
      ...(bound === undefined ? {} : { boundAuthoredContentIdentity: bound }),
    });
  };

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

  useEffect(() => {
    if (history === null) {
      return;
    }
    setBoundIdentities((current) => {
      const nextValues = current.key === scenarioIdentityKey ? { ...current.values } : {};
      let changed = current.key !== scenarioIdentityKey;
      for (const dimension of SCENARIO_REVIEW_RECORDABLE_DIMENSIONS) {
        const matching = history.filter(
          (record) =>
            record.scenarioId === scenario.scenarioId &&
            record.version === scenario.version &&
            record.reviewerRole === dimension,
        );
        if (matching.length === 0) {
          if (nextValues[dimension] !== undefined) {
            delete nextValues[dimension];
            changed = true;
          }
          continue;
        }
        if (nextValues[dimension] !== undefined) {
          continue;
        }
        const latest = matching[matching.length - 1];
        nextValues[dimension] =
          (latest === undefined ? undefined : authoredContentIdentityFromEvidenceRefs(latest.evidenceRefs)) ??
          currentAuthoredContentIdentity;
        changed = true;
      }
      if (!changed) {
        return current;
      }
      return { key: scenarioIdentityKey, values: nextValues };
    });
  }, [history, scenario.scenarioId, scenario.version, scenarioIdentityKey, currentAuthoredContentIdentity]);

  const recordDecision = async (dimension: ScenarioReviewDimension) => {
    const rationale = form[dimension].rationale.trim();
    if (rationale.length === 0) {
      setSaveState({ status: "error", message: "Rationale (required) must not be empty." });
      return;
    }

    setSaveState({ status: "saving", dimension });
    try {
      // evidenceRefs required by API; optional for the human — supply a local procedural ref when empty.
      const evidenceRefs = [
        `evidence:local-admin:${scenario.scenarioId}:${dimension}`,
        `${AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX}${currentAuthoredContentIdentity}`,
      ];
      const nextScenario = await submitScenarioReview({
        scenarioId: scenario.scenarioId,
        version: scenario.version,
        reviewerRole: dimension,
        reviewerId: DEFAULT_REVIEWER_IDS[dimension],
        decision: form[dimension].decision,
        comments: rationale,
        evidenceRefs,
      });
      setBoundIdentities((current) => ({
        key: scenarioIdentityKey,
        values: {
          ...(current.key === scenarioIdentityKey ? current.values : {}),
          [dimension]: currentAuthoredContentIdentity,
        },
      }));
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
          const display = gateDisplayFor(dimension);
          return (
            <Tag key={dimension} color={gateColor(display)}>
              {`${dimension}: ${display}`}
            </Tag>
          );
        })}
      </div>

      {SCENARIO_REVIEW_RECORDABLE_DIMENSIONS.some(
        (dimension) => gateDisplayFor(dimension) === SCENARIO_REVIEW_STALE_DECISION_DISPLAY,
      ) ? (
        <Alert
          type="warning"
          title="Prior faculty approvals are stale"
          description="Scenario version or authored content changed. Compile and learner-use readiness are refused until each governance dimension is recorded again. Unchanged labels are not a reapproval."
          showIcon
        />
      ) : null}
      <Typography.Paragraph aria-label="Compile learner-use readiness">
        {scenarioReviewGatesAllowLearnerUse(
          Object.fromEntries(
            SCENARIO_REVIEW_RECORDABLE_DIMENSIONS.map((dimension) => [dimension, gateDisplayFor(dimension)]),
          ) as Record<ScenarioReviewDimension, string>,
        )
          ? "Compile/learner-use readiness: review gates current (not a production or exam-equivalence claim)"
          : "Compile/learner-use readiness: refused until stale or pending gates are recorded again"}
      </Typography.Paragraph>

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
          const display = gateDisplayFor(dimension);
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
                    [dimension]: { ...current[dimension], rationale: event.currentTarget.value },
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
