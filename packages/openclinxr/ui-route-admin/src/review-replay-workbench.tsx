import { createContext, useContext, type ReactElement, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Alert, Button, Input, Space, Spin, Tag, Typography } from "antd";
import type { AdminControlPlaneClient, AdminReviewPacketReplay } from "./admin-review-types.js";
import { buildFacultyReviewPath } from "@openclinxr/review-workflow";
import {
  ActorTurnReplayPanel,
  EmissionReplayBindPanel,
  FacultyDispositionPanel,
} from "@openclinxr/ui-shared";
import {
  FacultyAdjudicationWorkspace,
  FacultyReviewDecisionPanel,
  fetchAssembledExamReviewPacket,
  ReviewReplayReadinessSummaryPanel,
  ReviewReplaySafetyPanel,
} from "./index.js";
import { clampedScoreFromInput } from "./validators.js";
import { pluralize, uniqueValues } from "./formatters.js";
import { ReadinessMetric } from "./status-view-model.js";

export type ReviewReplayWorkbenchState =
  | { status: "idle" }
  | { status: "loading"; stationRunId: string }
  | { status: "error"; stationRunId: string; message: string }
  | { status: "ready"; stationRunId: string; replay: AdminReviewPacketReplay };

export interface ReviewReplayWorkbenchContextState {
  state: ReviewReplayWorkbenchState;
  reviewerId: string;
  comments: string;
  urgentRecognitionScore: string;
  teamCommunicationScore: string;
  saveState:
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved" }
    | { status: "error"; message: string };
  seedState:
    | { status: "idle" }
    | { status: "creating" }
    | { status: "error"; message: string };
  stationRunIdInput: string;
  stationRunIdParam: string;
  examRunIdParam: string;
}

export interface ReviewReplayWorkbenchContextActions {
  setStationRunIdInput: (value: string) => void;
  setReviewerId: (value: string) => void;
  setComments: (value: string) => void;
  setUrgentRecognitionScore: (value: string) => void;
  setTeamCommunicationScore: (value: string) => void;
  loadReplay: () => void;
  createSeedReplay: () => Promise<void>;
  saveDraft: () => Promise<void>;
}

export interface ReviewReplayWorkbenchContextMeta {
  controlPlaneClient: AdminControlPlaneClient;
  searchParams: ReturnType<typeof useSearchParams>[0];
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}

export type ReviewReplayWorkbenchContextValue = {
  state: ReviewReplayWorkbenchContextState;
  actions: ReviewReplayWorkbenchContextActions;
  meta: ReviewReplayWorkbenchContextMeta;
};

function createInitialState(stationRunIdParam: string): ReviewReplayWorkbenchState {
  return stationRunIdParam
    ? { status: "loading", stationRunId: stationRunIdParam }
    : { status: "idle" };
}

export function ReviewReplayWorkbenchProvider({
  children,
  controlPlaneClient,
}: {
  children: React.ReactNode;
  controlPlaneClient: AdminControlPlaneClient;
}): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const stationRunIdParam = searchParams.get("stationRunId") ?? "";
  const examRunIdParam = searchParams.get("examRunId") ?? "";
  const [state, setState] = useState<ReviewReplayWorkbenchState>(() => createInitialState(stationRunIdParam));
  const [reviewerId, setReviewerId] = useState("faculty_001");
  const [comments, setComments] = useState("");
  const [urgentRecognitionScore, setUrgentRecognitionScore] = useState("2");
  const [teamCommunicationScore, setTeamCommunicationScore] = useState("1");
  const [saveState, setSaveState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved" }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [seedState, setSeedState] = useState<
    | { status: "idle" }
    | { status: "creating" }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [stationRunIdInput, setStationRunIdInput] = useState(stationRunIdParam);

  useEffect(() => {
    const stationRunId = stationRunIdParam.trim();
    setStationRunIdInput(stationRunIdParam);
    setSaveState({ status: "idle" });
    if (!stationRunId) {
      setState({ status: "idle" });
      return;
    }

    let active = true;
    setState({ status: "loading", stationRunId });
    Promise.all([
      controlPlaneClient.getReviewPacketReplay({ stationRunId }),
      controlPlaneClient.getReviewReplayReadinessSummary({ stationRunId }),
    ])
      .then(([replay, reviewReplayReadinessSummary]) => {
        if (!active) {
          return;
        }
        setState({
          status: "ready",
          stationRunId,
          replay: {
            ...replay,
            reviewReplayReadinessSummary,
          },
        });
        setReviewerId(replay.reviewPacket?.facultyScoreDraft.reviewerId ?? "faculty_001");
        setComments(replay.reviewPacket?.facultyScoreDraft.comments ?? "");
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", stationRunId, message: error instanceof Error ? error.message : "Unknown review replay error" });
        }
      });

    return () => {
      active = false;
    };
  }, [controlPlaneClient, stationRunIdParam]);

  const loadReplay = () => {
    const stationRunId = stationRunIdInput.trim();
    if (stationRunId) {
      setSearchParams({ stationRunId });
    }
  };

  const createSeedReplay = async () => {
    setSeedState({ status: "creating" });
    try {
      const seed = await controlPlaneClient.createLocalReviewReplaySeed();
      setSeedState({ status: "idle" });
      setSearchParams({ stationRunId: seed.stationRunId });
    } catch (error) {
      setSeedState({ status: "error", message: error instanceof Error ? error.message : "Unknown seed replay error" });
    }
  };

  const saveDraft = async () => {
    if (state.status !== "ready" || !state.replay.reviewPacket) {
      return;
    }

    setSaveState({ status: "saving" });
    try {
      const savedPacket = await controlPlaneClient.saveFacultyScoreDraft({
        stationRunId: state.stationRunId,
        reviewerId,
        comments,
        rubricScores: {
          urgent_recognition: clampedScoreFromInput(urgentRecognitionScore),
          communication_team_family: clampedScoreFromInput(teamCommunicationScore),
        },
      });
      setState((currentState) => {
        if (currentState.status !== "ready" || !currentState.replay.reviewPacket) {
          return currentState;
        }
        return {
          ...currentState,
          replay: {
            ...currentState.replay,
            reviewPacket: {
              ...currentState.replay.reviewPacket,
              ...savedPacket,
              timeline: currentState.replay.reviewPacket.timeline,
              patientNote: currentState.replay.reviewPacket.patientNote,
            },
          },
        };
      });
      setSaveState({ status: "saved" });
    } catch (error) {
      setSaveState({ status: "error", message: error instanceof Error ? error.message : "Unknown faculty score draft error" });
    }
  };

  const contextValue: ReviewReplayWorkbenchContextValue = {
    state: {
      state,
      reviewerId,
      comments,
      urgentRecognitionScore,
      teamCommunicationScore,
      saveState,
      seedState,
      stationRunIdInput,
      stationRunIdParam,
      examRunIdParam,
    },
    actions: {
      setStationRunIdInput,
      setReviewerId,
      setComments,
      setUrgentRecognitionScore,
      setTeamCommunicationScore,
      loadReplay,
      createSeedReplay,
      saveDraft,
    },
    meta: {
      controlPlaneClient,
      searchParams,
      setSearchParams,
    },
  };

  return <ReviewReplayWorkbenchContext.Provider value={contextValue}>{children}</ReviewReplayWorkbenchContext.Provider>;
}

const ReviewReplayWorkbenchContext = createContext<ReviewReplayWorkbenchContextValue | null>(null);

export function useReviewReplayWorkbenchContext(): ReviewReplayWorkbenchContextValue {
  const context = useContext(ReviewReplayWorkbenchContext);
  if (!context) {
    throw new Error("useReviewReplayWorkbenchContext must be used within a ReviewReplayWorkbenchProvider");
  }
  return context;
}

export function ReviewReplayWorkbenchUI(): ReactElement {
  const {
    state: { state, reviewerId, comments, urgentRecognitionScore, teamCommunicationScore, saveState, seedState, stationRunIdInput, examRunIdParam },
    actions: { setStationRunIdInput, setReviewerId, setComments, setUrgentRecognitionScore, setTeamCommunicationScore, loadReplay, createSeedReplay, saveDraft },
    meta: { controlPlaneClient, searchParams, setSearchParams },
  } = useReviewReplayWorkbenchContext();

  const packet = state.status === "ready" ? state.replay.reviewPacket : null;
  const clinicalEventReviewSummary = state.status === "ready" ? state.replay.clinicalEventReviewSummary : null;
  const reviewReplayReadinessSummary = state.status === "ready" ? state.replay.reviewReplayReadinessSummary : null;
  const traceEventCount = state.status === "ready" ? state.replay.traceEvents.length : 0;
  const unsafeTraceEventLabels = state.status === "ready"
    ? state.replay.traceEvents.flatMap((event) => {
        const tag = event.tag ?? "";
        if (tag.startsWith("unsafe_") || event.eventType.includes("unsafe") || event.eventType.includes("safety")) {
          return [tag || event.eventType];
        }
        return [];
      })
    : [];
  const safetyFlagLabels = uniqueValues([...(packet?.unsafeEvents ?? []), ...unsafeTraceEventLabels]);
  const facultyReviewPath = packet ? buildFacultyReviewPath({
    packet,
    hasDurableSummary: Boolean(clinicalEventReviewSummary),
    durableSummaryIsSafe: clinicalEventReviewSummary?.safeForFacultyReview === true,
    traceEventCount,
    safetyFlagLabels,
  }) : null;
  const facultyReviewPosture = facultyReviewPath?.posture ?? null;
  const facultyActionChecklist = facultyReviewPath?.actionChecklist ?? [];

  return (
    <section className="review-replay-workbench" aria-labelledby="review-replay-title">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Generated ReviewPacketReplay</Typography.Text>
          <Typography.Title id="review-replay-title" level={3}>
            Review Replay
          </Typography.Title>
        </div>
        <Space wrap>
          <Input
            aria-label="Station run ID"
            className="station-run-input"
            id="review-replay-station-run-id"
            name="stationRunId"
            value={stationRunIdInput}
            onChange={(event) => setStationRunIdInput(event.target.value)}
            onPressEnter={loadReplay}
          />
          <Button type="primary" onClick={loadReplay} disabled={stationRunIdInput.trim().length === 0}>
            Load replay
          </Button>
          <Button loading={seedState.status === "creating"} onClick={() => void createSeedReplay()}>
            Create seed replay
          </Button>
        </Space>
      </div>

      <FacultyAdjudicationWorkspace
        examRunId={examRunIdParam}
        loadPacket={(examRunId) => controlPlaneClient.getAssembledExamReviewPacket
          ? controlPlaneClient.getAssembledExamReviewPacket({ examRunId })
          : fetchAssembledExamReviewPacket(examRunId)}
        onLoadExamRun={(examRunId) => { const next = new URLSearchParams(searchParams); next.set("examRunId", examRunId); setSearchParams(next); }}
      />
      <FacultyDispositionPanel examRunId={examRunIdParam} onLoadExamRun={(examRunId) => { const next = new URLSearchParams(searchParams); next.set("examRunId", examRunId); setSearchParams(next); }} />

      {seedState.status === "error" ? (
        <Alert type="error" title="Seed replay failed" description={seedState.message} showIcon />
      ) : null}
      {state.status === "idle" ? (
        <Alert type="info" title="Station run required" description="Enter a station run ID to replay trace evidence and record a faculty draft." showIcon />
      ) : null}
      {state.status === "loading" ? <Spin /> : null}
      {state.status === "error" ? (
        <Alert type="error" title="Review replay unavailable" description={state.message} showIcon />
      ) : null}

      {/* Q4: always-visible bind of runtime-emission real turns (not seeds-only) into faculty review/replay */}
      <EmissionReplayBindPanel />

      {state.status === "ready" && !packet ? (
        <Alert type="warning" title="Review packet not found" description={state.stationRunId} showIcon />
      ) : null}

      {packet ? (
        <>
          <div className="readiness-strip review-replay-strip">
            <ReadinessMetric label={packet.scenarioId} detail={packet.stationRunId} />
            <ReadinessMetric label={`${packet.observedTraceTags.length} observed tags`} detail={`${packet.missingRequiredTraceTags.length} missing required`} />
            <ReadinessMetric label={`${packet.traceQuality.eventCount} trace events`} detail={`${packet.traceQuality.modelGeneratedEventCount} model generated`} />
            <ReadinessMetric label={`${packet.traceQuality.unsafeEventCount} unsafe events`} detail={`${packet.traceQuality.blockedGuardrailCount} blocked guardrails`} />
          </div>

          {clinicalEventReviewSummary ? (
            <ReviewReplaySafetyPanel
              packet={packet}
              clinicalEventReviewSummary={clinicalEventReviewSummary}
              traceEventCount={traceEventCount}
              safetyFlagLabels={safetyFlagLabels}
            />
          ) : null}

          {reviewReplayReadinessSummary ? (
            <ReviewReplayReadinessSummaryPanel
              summary={reviewReplayReadinessSummary}
              {...(reviewReplayReadinessSummary.caseDefinedHumanoidPerformanceContract
                ? { humanoidPerformanceContract: reviewReplayReadinessSummary.caseDefinedHumanoidPerformanceContract }
                : {})}
            />
          ) : null}

          <ActorTurnReplayPanel packet={packet} />
          <FacultyReviewDecisionPanel
            packet={packet}
            clinicalEventReviewSummary={clinicalEventReviewSummary}
            reviewReplayReadinessSummary={reviewReplayReadinessSummary}
            {...(reviewReplayReadinessSummary?.caseDefinedHumanoidPerformanceContract
              ? { humanoidPerformanceContract: reviewReplayReadinessSummary.caseDefinedHumanoidPerformanceContract }
              : {})}
            traceEventCount={traceEventCount}
            safetyFlagLabels={safetyFlagLabels}
            stationRunId={packet.stationRunId}
            saveFacultyReviewDecision={(input) => controlPlaneClient.saveFacultyReviewDecision(input)}
            reviewerId={reviewerId}
          />

          {facultyReviewPosture ? (
            <section className="workbench-panel" aria-label="Faculty review posture">
              <div className="workbench-title-row">
                <div>
                  <Typography.Text className="eyebrow">Completed-station faculty posture</Typography.Text>
                  <Typography.Title level={4}>Faculty Review Posture</Typography.Title>
                </div>
                <Tag color={facultyReviewPosture.color}>{facultyReviewPosture.title}</Tag>
              </div>
              <Typography.Paragraph>{facultyReviewPosture.guidance}</Typography.Paragraph>
              <ol className="compact-list">
                {facultyReviewPosture.checks.map((check) => (
                  <li key={check.label}>
                    <Typography.Text>{check.label}</Typography.Text>
                    <Space wrap>
                      <Tag color={check.color}>{check.status}</Tag>
                      <Typography.Text type="secondary">{check.detail}</Typography.Text>
                    </Space>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="workbench-panel" aria-label="Faculty action checklist">
            <div className="workbench-title-row">
              <div>
                <Typography.Text className="eyebrow">Completed-station next actions</Typography.Text>
                <Typography.Title level={4}>Faculty Action Checklist</Typography.Title>
              </div>
              <Tag color={facultyActionChecklist.some((item) => item.color !== "green") ? "gold" : "green"}>
                {facultyActionChecklist.some((item) => item.color !== "green") ? "Review actions present" : "No blocking actions"}
              </Tag>
            </div>
            <ol className="compact-list">
              {facultyActionChecklist.map((item) => (
                <li key={item.label}>
                  <Typography.Text>{item.label}</Typography.Text>
                  <Space wrap>
                    <Tag color={item.color}>{item.status}</Tag>
                    <Typography.Text type="secondary">{item.detail}</Typography.Text>
                  </Space>
                </li>
              ))}
            </ol>
          </section>

          {clinicalEventReviewSummary ? (
            <section className="workbench-panel" aria-label="Durable clinical-event review summary">
              <div className="workbench-title-row">
                <div>
                  <Typography.Text className="eyebrow">Replay-safe durable evidence</Typography.Text>
                  <Typography.Title level={4}>Clinical Event Review Summary</Typography.Title>
                </div>
                <Tag color={clinicalEventReviewSummary.safeForFacultyReview ? "green" : "gold"}>
                  {clinicalEventReviewSummary.safeForFacultyReview ? "Review safe" : "Needs redaction review"}
                </Tag>
              </div>
              <div className="readiness-strip review-replay-strip">
                <ReadinessMetric label={`${clinicalEventReviewSummary.eventCount} clinical ${pluralize(clinicalEventReviewSummary.eventCount, "event")}`} detail={`${clinicalEventReviewSummary.redactedEventCount} redacted`} />
                <ReadinessMetric label={clinicalEventReviewSummary.durableStore ?? "No durable store"} detail={`${clinicalEventReviewSummary.latestAtSecond ?? 0}s latest event`} />
                <ReadinessMetric label={`${clinicalEventReviewSummary.traceTags.length} trace links`} detail={clinicalEventReviewSummary.traceTags.join(", ") || "none"} />
                <ReadinessMetric label={`${Object.keys(clinicalEventReviewSummary.clinicalEventKinds as Record<string, unknown>).length} event kinds`} detail="summary only, no private payloads" />
              </div>
            </section>
          ) : null}

          <section className="workbench-panel" aria-label="Assessment use boundary">
            <div className="workbench-title-row">
              <div>
                <Typography.Text className="eyebrow">Psychometric guardrail</Typography.Text>
                <Typography.Title level={4}>Assessment Use Boundary</Typography.Title>
              </div>
              <Tag color="blue">Formative local practice only</Tag>
            </div>
            <Typography.Paragraph>
              Use only for local formative practice and debrief preparation until approved score-use evidence is complete.
            </Typography.Paragraph>
            <Typography.Paragraph>
              Faculty score drafts are local review aids for scenario iteration and debrief preparation until psychometric validation, rater training, and score-use evidence are complete.
            </Typography.Paragraph>
          </section>

          {saveState.status === "saved" ? (
            <Alert type="success" title="Faculty draft saved" description={`${packet.facultyScoreDraft.reviewerId} draft updated`} showIcon />
          ) : null}
          {saveState.status === "error" ? (
            <Alert type="error" title="Faculty draft failed" description={saveState.message} showIcon />
          ) : null}

          <div className="review-replay-grid">
            <section className="workbench-panel" aria-label="Required trace tag coverage">
              <Typography.Title level={4}>Trace Coverage</Typography.Title>
              <Typography.Text strong>Observed</Typography.Text>
              <div className="tag-row">
                {packet.observedTraceTags.map((tag) => (
                  <Tag key={tag} color="green">{tag}</Tag>
                ))}
              </div>
              <Typography.Text strong>Missing</Typography.Text>
              <div className="tag-row">
                {packet.missingRequiredTraceTags.length === 0 ? <Tag color="green">none</Tag> : packet.missingRequiredTraceTags.map((tag) => (
                  <Tag key={tag} color="gold">{tag}</Tag>
                ))}
              </div>
            </section>

            <section className="workbench-panel" aria-label="Review flags">
              <Typography.Title level={4}>Review Flags</Typography.Title>
              <Typography.Text strong>Late behaviors</Typography.Text>
              <div className="tag-row">
                {packet.lateTraceTags.length === 0 ? <Tag color="green">none</Tag> : packet.lateTraceTags.map((tag) => (
                  <Tag key={tag} color="orange">{tag}</Tag>
                ))}
              </div>
              <Typography.Text strong>Safety flags</Typography.Text>
              <div className="tag-row">
                {safetyFlagLabels.length === 0 ? <Tag color="green">none</Tag> : safetyFlagLabels.map((event) => (
                  <Tag key={event} color="red">{event}</Tag>
                ))}
              </div>
            </section>

            <section className="workbench-panel" aria-label="Review replay timeline">
              <Typography.Title level={4}>Timeline</Typography.Title>
              <ol className="compact-list replay-timeline-list">
                {packet.timeline.map((entry) => (
                  <li key={`${entry.sequence}:${entry.eventType}`}>
                    <Typography.Text>{entry.summary}</Typography.Text>
                    <Typography.Text type="secondary">{`${entry.atSecond}s / ${entry.eventType}${entry.tag ? ` / ${entry.tag}` : ""}`}</Typography.Text>
                  </li>
                ))}
              </ol>
            </section>

            <section className="workbench-panel" aria-label="Patient note">
              <Typography.Title level={4}>Patient Note</Typography.Title>
              {packet.patientNote ? (
                <>
                  <Typography.Text type="secondary">{`${packet.patientNote.submittedAtSecond}s`}</Typography.Text>
                  <Typography.Paragraph>{packet.patientNote.text}</Typography.Paragraph>
                </>
              ) : (
                <Typography.Paragraph className="empty-panel-note">No patient note submitted.</Typography.Paragraph>
              )}
            </section>

            <section className="workbench-panel faculty-score-panel" aria-label="Faculty score draft">
              <Typography.Title level={4}>Faculty Draft</Typography.Title>
              <label className="field-label" htmlFor="faculty-reviewer-id">
                <Typography.Text strong>Faculty reviewer ID</Typography.Text>
                <Input
                  aria-label="Faculty reviewer ID"
                  id="faculty-reviewer-id"
                  name="facultyReviewerId"
                  value={reviewerId}
                  onChange={(event) => setReviewerId(event.target.value)}
                />
              </label>
              <label className="field-label" htmlFor="faculty-draft-comments">
                <Typography.Text strong>Faculty draft comments</Typography.Text>
                <Input.TextArea
                  aria-label="Faculty draft comments"
                  id="faculty-draft-comments"
                  name="facultyDraftComments"
                  rows={4}
                  value={comments}
                  onChange={(event) => setComments(event.target.value)}
                />
              </label>
              <div className="score-input-grid">
                <label className="field-label" htmlFor="urgent-recognition-score">
                  <Typography.Text strong>Urgent recognition score</Typography.Text>
                  <Input
                    aria-label="Urgent recognition score"
                    id="urgent-recognition-score"
                    name="urgentRecognitionScore"
                    type="number"
                    min={0}
                    max={2}
                    value={urgentRecognitionScore}
                    onChange={(event) => setUrgentRecognitionScore(event.target.value)}
                  />
                </label>
                <label className="field-label" htmlFor="team-communication-score">
                  <Typography.Text strong>Team communication score</Typography.Text>
                  <Input
                    aria-label="Team communication score"
                    id="team-communication-score"
                    name="teamCommunicationScore"
                    type="number"
                    min={0}
                    max={2}
                    value={teamCommunicationScore}
                    onChange={(event) => setTeamCommunicationScore(event.target.value)}
                  />
                </label>
              </div>
              <Button type="primary" loading={saveState.status === "saving"} onClick={() => void saveDraft()}>
                Save faculty draft
              </Button>
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}