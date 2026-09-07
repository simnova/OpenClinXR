import { createContext, useContext, type ReactElement, useEffect, useState } from "react";
import { Alert, Button, Space, Spin, Tag, Typography } from "antd";
import { buildScenarioGovernanceCopy } from "@openclinxr/domain/claim-language";
import type {
  AdminControlPlaneClient,
  AdminStationRunQueueSnapshot,
  BlueprintScenarioReadiness,
  CreateScenarioSceneGenerationRequestResult,
  EnvironmentGenerationQueue,
  EnvironmentGenerationWorkOrderQueue,
  ExamBlueprint,
  ExamStationRunQueue,
  ExamTimingPlan,
  ScenarioAssetReadiness,
  ScenarioSceneGenerationPipelineWorkOrderQueue,
  ScenarioSceneGenerationRequestPublicationReadiness,
  ScenarioSceneGenerationRequestQueue,
  SubmitRuntimeVisualEvidenceAttachmentInput,
  AdminDynamicEncounterFactoryPlanningProjection,
  AdminRuntimeProviderReadiness,
  AdminRuntimeSelectionReviewPacket,
  AdminRuntimeProtocolPosture,
  AdminRealtimeVoicePosture,
} from "./admin-review-types.js";
import type { PlacementAuthorValue } from "./environment-generation-queue-panel.js";
import type { SeedWorldviewCompileGraph } from "./seed-worldview-queue.js";
import { formatDuration } from "./formatters.js";
import { formatStationQueueBlocker, formatMinutes } from "./scenario-bank-maturity-panel.js";
import { ReadinessMetric } from "./status-view-model.js";
import { SeedExamReadinessBoundaryPanel } from "./seed-exam-readiness-boundary-panel.js";
import { RuntimeSelectionReviewPacketPanel } from "./runtime-selection-review-packet-panel.js";
import { FacultyEncounterBundlePromotionHost } from "./encounter-bundle-promotion/index.js";
import { SeedWorldviewQueue } from "./seed-worldview-queue.js";
import { QueueReviewSnapshotHistory } from "./queue-review-snapshot-history.js";
import { useFacultyCompileLocks } from "./faculty-compile-lock.js";
import { FactoryRunProgressPanel } from "@openclinxr/ui-shared/factory-run-progress-panel";
import { fetchFactoryRunTable, type FactoryRunTable } from "@openclinxr/ui-shared/factory-run-table-client";

const seedExamGovernanceCopy = buildScenarioGovernanceCopy({
  scoreUseLabel: "formative_local_only",
  syntheticCaseDisclosure: "Synthetic training scenario for local review.",
  validationStage: "stage_1_expert_reviewed",
  validationLimitations: ["Prototype fixture review only."],
  requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
  sourceIds: ["src-public-clinical-skills-structure", "src-ama-clinical-skills-competencies"],
  safetyCriticalTraceTags: ["ecg_request", "urgent_escalation", "team_communication"],
  hiddenFactPolicy: {
    learnerView: "redact_hidden_facts",
    disclosureRequiresTrigger: true,
  },
});

export type SeedBlueprintWorkbenchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
    status: "ready";
    blueprint: ExamBlueprint;
    readiness: BlueprintScenarioReadiness;
    timingPlan: ExamTimingPlan;
    stationRunQueue: ExamStationRunQueue;
    queueSnapshots: AdminStationRunQueueSnapshot[];
    assetReadiness: ScenarioAssetReadiness[];
    environmentGenerationQueue: EnvironmentGenerationQueue;
    environmentGenerationWorkOrderQueue: EnvironmentGenerationWorkOrderQueue;
    sceneGenerationPipelineQueue: ScenarioSceneGenerationPipelineWorkOrderQueue;
    sceneGenerationRequestQueue: ScenarioSceneGenerationRequestQueue;
    dynamicEncounterFactoryPlanning: AdminDynamicEncounterFactoryPlanningProjection;
    runtimeProviderReadiness: AdminRuntimeProviderReadiness;
    runtimeSelectionReviewPacket: AdminRuntimeSelectionReviewPacket;
    runtimeProtocolPosture: AdminRuntimeProtocolPosture;
    realtimeVoicePosture: AdminRealtimeVoicePosture;
  };

export interface SeedBlueprintWorkbenchContextState {
  state: SeedBlueprintWorkbenchState;
  snapshotState:
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved"; snapshotId: string }
    | { status: "error"; message: string };
  sceneGenerationRequestState:
    | { status: "idle" }
    | { status: "requested"; requestId: string }
    | { status: "error"; message: string };
  compileEncounterState:
    | { status: "idle" }
    | { status: "compiling" }
    | { status: "compiled"; scenarioId: string }
    | { status: "error"; message: string };
  sceneGenerationPublicationReadiness: ScenarioSceneGenerationRequestPublicationReadiness | undefined;
  runtimeVisualEvidenceAttachmentSubmitState:
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "submitted"; message: string }
    | { status: "error"; message: string };
  placementAuthorValues: Record<string, PlacementAuthorValue>;
  infinigenPrompt: string;
  factoryRunTable: FactoryRunTable;
}

export interface SeedBlueprintWorkbenchContextActions {
  createSnapshot: () => Promise<void>;
  initiateSceneGeneration: (scenarioId: string) => Promise<void>;
  compileEncounter: (scenarioId: string, graph?: SeedWorldviewCompileGraph) => Promise<void>;
  attachSceneGenerationReview: (request: CreateScenarioSceneGenerationRequestResult) => Promise<void>;
  checkSceneGenerationPublicationReadiness: (request: CreateScenarioSceneGenerationRequestResult) => Promise<void>;
  submitRuntimeVisualEvidenceAttachment: (input: SubmitRuntimeVisualEvidenceAttachmentInput) => Promise<void>;
  setPlacementAuthorValues: React.Dispatch<React.SetStateAction<Record<string, PlacementAuthorValue>>>;
  setInfinigenPrompt: (value: string) => void;
}

export interface SeedBlueprintWorkbenchContextMeta {
  controlPlaneClient: AdminControlPlaneClient;
  compileEncounterWorld: (input: {
    scenarioId: string;
    compileNodes?: unknown[];
    facultyLocks?: unknown[];
    infinigenPrompt?: string;
    removedNodeIds?: string[];
    stationPayloads?: Partial<Record<string, Record<string, unknown>>>;
  }) => Promise<Record<string, unknown>>;
  factoryRunTableBaseUrl: string;
}

export type SeedBlueprintWorkbenchContextValue = {
  state: SeedBlueprintWorkbenchContextState;
  actions: SeedBlueprintWorkbenchContextActions;
  meta: SeedBlueprintWorkbenchContextMeta;
};

const SeedBlueprintWorkbenchContext = createContext<SeedBlueprintWorkbenchContextValue | null>(null);

export function useSeedBlueprintWorkbenchContext(): SeedBlueprintWorkbenchContextValue {
  const context = useContext(SeedBlueprintWorkbenchContext);
  if (!context) {
    throw new Error("useSeedBlueprintWorkbenchContext must be used within a SeedBlueprintWorkbenchProvider");
  }
  return context;
}

export function SeedBlueprintWorkbenchProvider({
  children,
  controlPlaneClient,
  compileEncounterWorld,
  factoryRunTableBaseUrl = "",
}: {
  children: React.ReactNode;
  controlPlaneClient: AdminControlPlaneClient;
  compileEncounterWorld: (input: {
    scenarioId: string;
    compileNodes?: unknown[];
    facultyLocks?: unknown[];
    infinigenPrompt?: string;
    removedNodeIds?: string[];
    stationPayloads?: Partial<Record<string, Record<string, unknown>>>;
  }) => Promise<Record<string, unknown>>;
  factoryRunTableBaseUrl?: string;
}): ReactElement {
  const [state, setState] = useState<SeedBlueprintWorkbenchState>({ status: "loading" });
  const [snapshotState, setSnapshotState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved"; snapshotId: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [sceneGenerationRequestState, setSceneGenerationRequestState] = useState<
    | { status: "idle" }
    | { status: "requested"; requestId: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [compileEncounterState, setCompileEncounterState] = useState<
    | { status: "idle" }
    | { status: "compiling" }
    | { status: "compiled"; scenarioId: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [sceneGenerationPublicationReadiness, setSceneGenerationPublicationReadiness] = useState<ScenarioSceneGenerationRequestPublicationReadiness | undefined>();
  const [runtimeVisualEvidenceAttachmentSubmitState, setRuntimeVisualEvidenceAttachmentSubmitState] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "submitted"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [placementAuthorValues, setPlacementAuthorValues] = useState<Record<string, PlacementAuthorValue>>({});
  const [infinigenPrompt, setInfinigenPrompt] = useState("");
  const [factoryRunTable, setFactoryRunTable] = useState<FactoryRunTable>({ cases: [] });

  useEffect(() => {
    let active = true;
    void fetchFactoryRunTable({
      baseUrl: factoryRunTableBaseUrl,
    }).then((table) => {
      if (active) setFactoryRunTable(table);
    });
    return () => {
      active = false;
    };
  }, [factoryRunTableBaseUrl]);

  useEffect(() => {
    let active = true;

    Promise.all([
      controlPlaneClient.getStep2CsSeedBlueprint(),
      controlPlaneClient.getStep2CsSeedBlueprintReadiness(),
      controlPlaneClient.getStep2CsSeedTimingPlan(),
      controlPlaneClient.getStep2CsSeedStationRunQueue(),
      controlPlaneClient.listStep2CsSeedStationRunQueueSnapshots(),
      controlPlaneClient.getScenarioBankAssetReadiness(),
      controlPlaneClient.getScenarioBankEnvironmentGenerationQueue(),
      controlPlaneClient.getScenarioBankEnvironmentWorkOrderQueue(),
      controlPlaneClient.getScenarioBankSceneGenerationPipelineQueue(),
      controlPlaneClient.listScenarioSceneGenerationRequests(),
      controlPlaneClient.getDynamicEncounterFactoryPlanning(),
      controlPlaneClient.getRuntimeProviderReadiness(),
      controlPlaneClient.getRuntimeSelectionReviewPacket(),
      controlPlaneClient.getRuntimeProtocolPosture(),
      controlPlaneClient.getRealtimeVoicePosture(),
    ])
      .then(([blueprint, readiness, timingPlan, stationRunQueue, queueSnapshots, assetReadiness, environmentGenerationQueue, environmentGenerationWorkOrderQueue, sceneGenerationPipelineQueue, sceneGenerationRequestQueue, dynamicEncounterFactoryPlanning, runtimeProviderReadiness, runtimeSelectionReviewPacket, runtimeProtocolPosture, realtimeVoicePosture]) => {
        if (active) {
          setState({ status: "ready", blueprint, readiness, timingPlan, stationRunQueue, queueSnapshots, assetReadiness, environmentGenerationQueue, environmentGenerationWorkOrderQueue, sceneGenerationPipelineQueue, sceneGenerationRequestQueue, dynamicEncounterFactoryPlanning, runtimeProviderReadiness, runtimeSelectionReviewPacket, runtimeProtocolPosture, realtimeVoicePosture });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Unknown admin API error" });
        }
      });

    return () => {
      active = false;
    };
  }, [controlPlaneClient]);

  const createSnapshot = async () => {
    setSnapshotState({ status: "saving" });
    try {
      const snapshot = await controlPlaneClient.createStep2CsSeedStationRunQueueSnapshot({
        reviewerId: "admin_seed_reviewer",
        createdAt: new Date().toISOString(),
      });
      const queueSnapshots = await controlPlaneClient.listStep2CsSeedStationRunQueueSnapshots();
      setState((currentState) => currentState.status === "ready" ? { ...currentState, queueSnapshots } : currentState);
      setSnapshotState({ status: "saved", snapshotId: snapshot.snapshotId });
    } catch (error) {
      setSnapshotState({ status: "error", message: error instanceof Error ? error.message : "Unknown snapshot error" });
    }
  };

  const initiateSceneGeneration = async (scenarioId: string) => {
    try {
      const result = await controlPlaneClient.createScenarioSceneGenerationRequest({ scenarioId });
      setState((currentState) => currentState.status === "ready"
        ? {
          ...currentState,
          sceneGenerationRequestQueue: {
            ...currentState.sceneGenerationRequestQueue,
            requestCount: currentState.sceneGenerationRequestQueue.requestCount + 1,
            requests: [result, ...currentState.sceneGenerationRequestQueue.requests],
          },
        }
        : currentState);
      setSceneGenerationRequestState({ status: "requested", requestId: result.requestId });
    } catch (error) {
      setSceneGenerationRequestState({ status: "error", message: error instanceof Error ? error.message : "Unknown scene generation request error" });
    }
  };

  const sceneGenerationPipelineQueue = state.status === "ready" ? state.sceneGenerationPipelineQueue : undefined;
  const { facultyCompileLockRows, handleFacultyCompileLockChange, handleFacultyCompileOverrideChange, handleFacultyCompileOverrideValueChange, compileEdges } =
    useFacultyCompileLocks(sceneGenerationPipelineQueue, controlPlaneClient);

  const compileEncounter = async (scenarioId: string, graph?: SeedWorldviewCompileGraph) => {
    setCompileEncounterState({ status: "compiling" });
    try {
      await compileEncounterWorld({
        scenarioId,
        compileNodes: graph?.compileNodes ?? compileEdges,
        facultyLocks: graph?.facultyLocks ?? facultyCompileLockRows,
        ...(infinigenPrompt.trim() ? { infinigenPrompt: infinigenPrompt.trim() } : {}),
        ...(graph?.stationPayloads ? { stationPayloads: graph.stationPayloads } : {}),
      });
      setCompileEncounterState({ status: "compiled", scenarioId });
    } catch (error) {
      setCompileEncounterState({ status: "error", message: error instanceof Error ? error.message : "Unknown world compile error" });
    }
  };

  const attachSceneGenerationReview = async (request: CreateScenarioSceneGenerationRequestResult) => {
    const assetId = request.workOrder.characterAssetIds[0] ?? request.workOrder.environmentAssetIds[0] ?? request.scenarioId;
    const result = await controlPlaneClient.submitScenarioSceneGenerationRequestReview({
      requestId: request.requestId,
      decisions: [
        {
          assetId,
          reviewerRole: "asset_pipeline",
          reviewerId: "admin_asset_pipeline_reviewer",
          decision: "approved_for_local_runtime",
          comments: "Local generated asset references are ready for local runtime promotion review only.",
          evidenceRefs: [`${request.requestId}:asset_pipeline:local-admin`],
          reviewedAt: new Date().toISOString(),
        },
        {
          assetId,
          reviewerRole: "security_privacy",
          reviewerId: "admin_security_privacy_reviewer",
          decision: "approved_for_local_runtime",
          comments: "Local runtime asset references do not include identity-bearing URLs in the admin-visible request record.",
          evidenceRefs: [`${request.requestId}:security_privacy:local-admin`],
          reviewedAt: new Date().toISOString(),
        },
      ],
    });
    const publicationReadiness = await controlPlaneClient.getScenarioSceneGenerationRequestPublicationReadiness({ requestId: request.requestId });
    setSceneGenerationPublicationReadiness(publicationReadiness);
    setState((currentState) => currentState.status === "ready"
      ? {
        ...currentState,
        sceneGenerationRequestQueue: {
          ...currentState.sceneGenerationRequestQueue,
          requests: currentState.sceneGenerationRequestQueue.requests.map((candidate) => candidate.requestId === result.requestId ? result : candidate),
        },
      }
      : currentState);
  };

  const checkSceneGenerationPublicationReadiness = async (request: CreateScenarioSceneGenerationRequestResult) => {
    const publicationReadiness = await controlPlaneClient.getScenarioSceneGenerationRequestPublicationReadiness({ requestId: request.requestId });
    setSceneGenerationPublicationReadiness(publicationReadiness);
  };

  const submitRuntimeVisualEvidenceAttachment = async (input: SubmitRuntimeVisualEvidenceAttachmentInput) => {
    setRuntimeVisualEvidenceAttachmentSubmitState({ status: "submitting" });
    try {
      const record = await controlPlaneClient.submitRuntimeVisualEvidenceAttachment(input);
      const runtimeSelectionReviewPacket = await controlPlaneClient.getRuntimeSelectionReviewPacket();
      setState((currentState) => currentState.status === "ready"
        ? { ...currentState, runtimeSelectionReviewPacket }
        : currentState);
      setSceneGenerationPublicationReadiness((currentReadiness) =>
        currentReadiness?.scenarioId === record.scenarioId
          ? { ...currentReadiness, runtimeVisualEvidenceAttachmentRecord: record }
          : currentReadiness
      );
      setRuntimeVisualEvidenceAttachmentSubmitState({
        status: "submitted",
        message: `${record.attachmentCount} metadata-only runtime visual evidence attachment ref${record.attachmentCount === 1 ? "" : "s"} accepted; launch gates remain blocked.`,
      });
    } catch (error) {
      setRuntimeVisualEvidenceAttachmentSubmitState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown runtime visual evidence attachment error",
      });
    }
  };

  const featuredScenarioId = state.status === "ready" ? state.sceneGenerationPipelineQueue?.featuredFactoryPlanningScenarioId ?? "" : "";

  const contextValue: SeedBlueprintWorkbenchContextValue = {
    state: {
      state,
      snapshotState,
      sceneGenerationRequestState,
      compileEncounterState,
      sceneGenerationPublicationReadiness,
      runtimeVisualEvidenceAttachmentSubmitState,
      placementAuthorValues,
      infinigenPrompt,
      factoryRunTable,
    },
    actions: {
      createSnapshot,
      initiateSceneGeneration,
      compileEncounter,
      attachSceneGenerationReview,
      checkSceneGenerationPublicationReadiness,
      submitRuntimeVisualEvidenceAttachment,
      setPlacementAuthorValues,
      setInfinigenPrompt,
    },
    meta: { controlPlaneClient, compileEncounterWorld, factoryRunTableBaseUrl },
  };

  void featuredScenarioId;
  void facultyCompileLockRows;
  void handleFacultyCompileLockChange;
  void handleFacultyCompileOverrideChange;
  void handleFacultyCompileOverrideValueChange;
  void compileEdges;

  return <SeedBlueprintWorkbenchContext.Provider value={contextValue}>{children}</SeedBlueprintWorkbenchContext.Provider>;
}

export function SeedBlueprintWorkbenchUI(): ReactElement {
  const {
    state: { state, snapshotState, sceneGenerationRequestState, compileEncounterState, sceneGenerationPublicationReadiness, runtimeVisualEvidenceAttachmentSubmitState, placementAuthorValues, infinigenPrompt, factoryRunTable },
    actions: { createSnapshot, initiateSceneGeneration, compileEncounter, attachSceneGenerationReview, checkSceneGenerationPublicationReadiness, submitRuntimeVisualEvidenceAttachment, setPlacementAuthorValues, setInfinigenPrompt },
    meta: { controlPlaneClient },
  } = useSeedBlueprintWorkbenchContext();

  const sceneGenerationPipelineQueue = state.status === "ready" ? state.sceneGenerationPipelineQueue : undefined;
  const { facultyCompileLockRows, handleFacultyCompileLockChange, handleFacultyCompileOverrideChange, handleFacultyCompileOverrideValueChange, compileEdges } =
    useFacultyCompileLocks(sceneGenerationPipelineQueue, controlPlaneClient);

  if (state.status === "loading") {
    return (
      <section className="seed-workbench" aria-labelledby="seed-exam-readiness-title">
        <Typography.Title id="seed-exam-readiness-title" level={3}>
          Seed Exam Readiness
        </Typography.Title>
        <Spin />
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="seed-workbench" aria-labelledby="seed-exam-readiness-title">
        <Typography.Title id="seed-exam-readiness-title" level={3}>
          Seed Exam Readiness
        </Typography.Title>
        <Alert type="error" title="Control-plane data unavailable" description={state.message} showIcon />
      </section>
    );
  }

  const productionReadyScenes = state.assetReadiness.filter((readiness) => readiness.productionReady).length;
  const devReadyScenes = state.assetReadiness.filter((readiness) => readiness.devReady).length;
  const firstBlockedScenario = state.readiness.blockedScenarioIds[0];
  const featuredScenarioId = state.sceneGenerationPipelineQueue?.featuredFactoryPlanningScenarioId ?? "";

  return (
    <section className="seed-workbench" aria-labelledby="seed-exam-readiness-title">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Clinical-skills seed form</Typography.Text>
          <Typography.Title id="seed-exam-readiness-title" level={3}>
            Seed Exam Readiness
          </Typography.Title>
        </div>
        <Space wrap>
          <Button type="primary" loading={snapshotState.status === "saving"} onClick={() => void createSnapshot()}>
            Create review snapshot
          </Button>
          <Tag color={state.readiness.canAssembleReadyForm ? "green" : "gold"}>
            {state.readiness.canAssembleReadyForm ? "Assembly ready" : "Review blocked"}
          </Tag>
        </Space>
      </div>

      <Alert
        aria-label="Seed exam governance notice"
        type="info"
        title={seedExamGovernanceCopy.scoreUseNotice}
        description={`${seedExamGovernanceCopy.syntheticCaseNotice} ${seedExamGovernanceCopy.validationNotice} ${seedExamGovernanceCopy.humanReviewNotice}`}
        showIcon
      />

      <div className="readiness-strip">
        <ReadinessMetric label={`${state.blueprint.stationSlots.length} stations`} detail={`${state.blueprint.requiredTraceTags.length} trace tags`} />
        <ReadinessMetric label={`${state.readiness.activationEligibleScenarioIds.length} activation ready`} detail={`${state.readiness.stationCount.candidate} candidates`} />
        <ReadinessMetric label={`${state.readiness.blockedScenarioIds.length} blocked drafts`} detail={firstBlockedScenario?.reason ?? "none"} />
        <ReadinessMetric label={`${formatDuration(state.timingPlan.totalStationTimeSeconds)} total`} detail={`${state.timingPlan.breakCheckpoints.length} scheduled breaks`} />
        <ReadinessMetric label={`${devReadyScenes} dev-ready scenes`} detail={`${productionReadyScenes} production-ready scenes`} />
        <ReadinessMetric
          label={state.stationRunQueue.canStartLearnerExam ? "Learner launch ready" : "Learner launch blocked"}
          detail={`${state.stationRunQueue.summary.draftBlocked} draft, ${state.stationRunQueue.summary.governanceBlocked} governance blocked`}
        />
      </div>

      {snapshotState.status === "saved" ? <Alert type="success" title="Review snapshot saved" description={snapshotState.snapshotId} showIcon /> : null}
      {snapshotState.status === "error" ? <Alert type="error" title="Review snapshot failed" description={snapshotState.message} showIcon /> : null}
      {sceneGenerationRequestState.status === "requested" ? <Alert type="success" title="Scene generation request created" description={sceneGenerationRequestState.requestId} showIcon /> : null}
      {sceneGenerationRequestState.status === "error" ? <Alert type="error" title="Scene generation request failed" description={sceneGenerationRequestState.message} showIcon /> : null}
      {compileEncounterState.status === "compiled" ? <Alert type="success" title="World compile request accepted" description={`${compileEncounterState.scenarioId} posted to /internal/world-compile`} showIcon /> : null}
      {compileEncounterState.status === "error" ? <Alert type="error" title="World compile request failed" description={compileEncounterState.message} showIcon /> : null}

      <div className="workbench-panels">
        <SeedExamReadinessBoundaryPanel
          assetReadiness={state.assetReadiness}
          stationRunQueue={state.stationRunQueue}
          runtimeProviderReadiness={state.runtimeProviderReadiness}
          runtimeProtocolPosture={state.runtimeProtocolPosture}
          realtimeVoicePosture={state.realtimeVoicePosture}
          environmentGenerationQueue={state.environmentGenerationQueue}
        />

        <RuntimeSelectionReviewPacketPanel
          packet={state.runtimeSelectionReviewPacket}
          runtimeVisualEvidenceAttachmentSubmitStatus={runtimeVisualEvidenceAttachmentSubmitState.status}
          runtimeVisualEvidenceAttachmentSubmitMessage={"message" in runtimeVisualEvidenceAttachmentSubmitState ? runtimeVisualEvidenceAttachmentSubmitState.message : undefined}
          onSubmitRuntimeVisualEvidenceAttachment={(input) => void submitRuntimeVisualEvidenceAttachment(input)}
        />

        <FacultyEncounterBundlePromotionHost
          client={controlPlaneClient}
          scenarioId={state.runtimeSelectionReviewPacket.selectedScenarioId}
          stationId={state.runtimeSelectionReviewPacket.selectedStationId}
        />

        <section className="workbench-panel" aria-label="Dynamic encounter factory planning">
          <Typography.Title level={4}>Dynamic Encounter Factory Planning</Typography.Title>
          <Typography.Paragraph type="secondary">
            {`Boundary: ${state.dynamicEncounterFactoryPlanning.claimBoundary}; next scenario: ${state.dynamicEncounterFactoryPlanning.nextFactoryPlanningScenarioId ?? "none"} via ${state.dynamicEncounterFactoryPlanning.nextFactoryPlanningScenarioSelectionMode}.`}
          </Typography.Paragraph>
          <fieldset className="readiness-strip" aria-label="Dynamic encounter factory planning metrics">
            <ReadinessMetric
              label={`${state.dynamicEncounterFactoryPlanning.scenarios.length} factory candidates`}
              detail={`anchor ${state.dynamicEncounterFactoryPlanning.anchorScenarioId}`}
            />
            <ReadinessMetric
              label={state.dynamicEncounterFactoryPlanning.routeContractBoundary?.posture ?? "read_only_review_packet"}
              detail={`provider ${String(state.dynamicEncounterFactoryPlanning.routeContractBoundary?.providerExecutionAllowed ?? false)}; runtime ${String(state.dynamicEncounterFactoryPlanning.routeContractBoundary?.runtimeExecutionAllowed ?? false)}; Quest ${String(state.dynamicEncounterFactoryPlanning.routeContractBoundary?.questEvidenceRefreshAllowed ?? false)}`}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Dynamic encounter factory candidate summaries">
            {state.dynamicEncounterFactoryPlanning.scenarios.slice(0, 3).map((scenario) => (
              <li key={scenario.scenarioId}>
                <Typography.Text>{scenario.scenarioId}</Typography.Text>
                <Typography.Text type="secondary">
                  {`actors ${scenario.encounterFactoryInputSummary.actorAssetWorkOrderCount}; environment ${scenario.encounterFactoryInputSummary.environmentAssetWorkOrderCount}; equipment ${scenario.encounterFactoryInputSummary.equipmentAssetWorkOrderCount}; ${scenario.encounterFactoryInputSummary.factorySelectionClaimBoundary}`}
                </Typography.Text>
                {scenario.humanoidPerformanceContract ? (
                  <Typography.Text type="secondary">
                    {`humanoid behavior contract actors ${scenario.humanoidPerformanceContract.actorCount}; locomotion ${scenario.humanoidPerformanceContract.locomotionActorRoles.length}; expression ${scenario.humanoidPerformanceContract.expressionActorRoles.length}; gaze ${scenario.humanoidPerformanceContract.gazeActorRoles.length}; lip-sync ${scenario.humanoidPerformanceContract.lipSyncActorRoles.length}; interactivity ${scenario.humanoidPerformanceContract.interactiveActorRoles.length}; emotion states ${scenario.humanoidPerformanceContract.emotionStateCount}; viseme mapping ${String(scenario.humanoidPerformanceContract.dialogueDrivenVisemeMappingRequired)}; ${scenario.humanoidPerformanceContract.claimBoundary}; not evidence for ${scenario.humanoidPerformanceContract.notEvidenceFor.join(", ")}`}
                  </Typography.Text>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Factory run record">
          <Typography.Title level={4}>Factory run record</Typography.Title>
          <Typography.Text type="secondary">
            Per-station outcome for each case in the last recorded chain run. A
            deterministic station means an artifact was written, not that it is usable.
          </Typography.Text>
          <FactoryRunProgressPanel cases={factoryRunTable.cases} />
        </section>

        <SeedWorldviewQueue
          environmentGenerationQueue={state.environmentGenerationQueue}
          environmentGenerationWorkOrderQueue={state.environmentGenerationWorkOrderQueue}
          sceneGenerationPipelineQueue={state.sceneGenerationPipelineQueue}
          sceneGenerationRequestQueue={state.sceneGenerationRequestQueue}
          {...(sceneGenerationPublicationReadiness ? { sceneGenerationPublicationReadiness } : {})}
          facultyCompileLockRows={facultyCompileLockRows}
          onFacultyCompileLockChange={handleFacultyCompileLockChange}
          onFacultyCompileOverrideChange={handleFacultyCompileOverrideChange}
          onFacultyCompileOverrideValueChange={handleFacultyCompileOverrideValueChange}
          compileEdges={compileEdges}
          featuredScenarioId={featuredScenarioId}
          onCompileEncounter={(scenarioId, graph) => void compileEncounter(scenarioId, graph)}
          infinigenPrompt={infinigenPrompt}
          onInfinigenPromptChange={setInfinigenPrompt}
          onInitiateSceneGeneration={(scenarioId) => void initiateSceneGeneration(scenarioId)}
          onAttachSceneGenerationReview={(request) => void attachSceneGenerationReview(request)}
          onCheckSceneGenerationPublicationReadiness={(request) => void checkSceneGenerationPublicationReadiness(request)}
          initialPlacementAuthorValues={placementAuthorValues}
          onPlacementAuthorChange={(actorId, placement) =>
            setPlacementAuthorValues((current) => ({ ...current, [actorId]: placement }))
          }
        />

        <section className="workbench-panel station-queue-panel" aria-labelledby="station-queue-title">
          <Typography.Title id="station-queue-title" level={4}>
            Station Run Queue
          </Typography.Title>
          <Typography.Text>{`${state.stationRunQueue.summary.activationReady} activation-ready station, ${state.stationRunQueue.summary.draftBlocked} draft-blocked, ${state.stationRunQueue.summary.governanceBlocked} governance-blocked`}</Typography.Text>
          <ol className="station-queue-list">
            {state.stationRunQueue.stationQueue.map((station) => (
              <li key={station.slotId}>
                <div className="station-queue-row">
                  <Typography.Text strong>{`Station ${station.stationOrder}`}</Typography.Text>
                  <Tag color={station.status === "activation_ready" ? "green" : "gold"}>{station.status}</Tag>
                </div>
                <Typography.Text>{station.scenarioId ?? "missing scenario"}</Typography.Text>
                {station.blockers.length > 0 ? <Typography.Text type="secondary">{station.blockers.map(formatStationQueueBlocker).join(", ")}</Typography.Text> : null}
                {station.blockers.length > 0 ? <Typography.Text type="secondary">{`Blocker IDs: ${station.blockers.join(", ")}`}</Typography.Text> : null}
              </li>
            ))}
          </ol>
        </section>

        <QueueReviewSnapshotHistory snapshots={state.queueSnapshots} />

        <section className="workbench-panel" aria-labelledby="timing-title">
          <Typography.Title id="timing-title" level={4}>
            Timing
          </Typography.Title>
          <Typography.Text>{`Breaks after stations ${state.timingPlan.breakCheckpoints.map((checkpoint) => checkpoint.afterStationOrder).join(", ")}`}</Typography.Text>
          <ol className="station-window-list">
            {state.timingPlan.stationWindows.slice(0, 6).map((window) => (
              <li key={window.slotId}>
                <Typography.Text strong>{`Station ${window.stationOrder}`}</Typography.Text>
                <Typography.Text>{`Doorway ${formatMinutes(window.doorway.durationSeconds)}, encounter ${formatMinutes(window.encounter.durationSeconds)}, note ${formatMinutes(window.note.durationSeconds)}`}</Typography.Text>
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-labelledby="blocked-scenarios-title">
          <Typography.Title id="blocked-scenarios-title" level={4}>
            Blocked Scenarios
          </Typography.Title>
          <ol className="blocked-scenario-list">
            {state.readiness.blockedScenarioIds.map((blockedScenario) => (
              <li key={blockedScenario.scenarioId}>
                <Typography.Text strong>{blockedScenario.scenarioId}</Typography.Text>
                <Tag color="gold">{blockedScenario.reason}</Tag>
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-labelledby="asset-readiness-title">
          <Typography.Title id="asset-readiness-title" level={4}>
            Asset Readiness
          </Typography.Title>
          <Typography.Text>{`${state.assetReadiness.length} scenario manifests generated from the seed bank`}</Typography.Text>
          <ol className="asset-readiness-list">
            {state.assetReadiness.map((assetReadiness) => (
              <li key={assetReadiness.scenarioId}>
                <Typography.Text strong>{assetReadiness.scenarioId}</Typography.Text>
                <Tag color={assetReadiness.devReady ? "green" : "red"}>{assetReadiness.devReady ? "dev ready" : "blocked"}</Tag>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}