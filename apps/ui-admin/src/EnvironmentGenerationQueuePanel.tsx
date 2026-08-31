import {
  buildEnvironmentGenerationWorkOrder,
  buildEnvironmentGenerationWorkOrderQueue,
  type EnvironmentGenerationPacket,
  type EnvironmentGenerationQueue,
  type EnvironmentGenerationWorkOrderQueue,
  type ScenarioSceneGenerationPipelineWorkOrderQueue,
} from "@openclinxr/asset-registry";
import { Button, Form, Input, InputNumber, Select, Space, Table, Tag, Typography } from "antd";
import { lazy, type ReactElement, Suspense, useEffect, useMemo } from "react";
import type { CreateScenarioSceneGenerationRequestResult, ScenarioSceneGenerationRequestPublicationReadiness, ScenarioSceneGenerationRequestQueue } from "./api-client.js";
import { supportSurfaceOptions } from "./case-authoring-model.js";
import type { CompileEdge } from "./CompileGraphCanvas.js";
import {
  buildFacultyCompileLockColumns,
  type FacultyCompileLockRow,
  type FacultyCompileOverridePath,
  ProposedVsAcceptedList,
} from "./faculty-compile-lock.js";

const CompileGraphCanvas = lazy(() =>
  import("./CompileGraphCanvas.js").then((module) => ({ default: module.CompileGraphCanvas })),
);

import {
  sceneGenerationRequestProjectionArtifactStatusColor,
  sceneGenerationRequestProjectionArtifactStatusLabel,
  sceneGenerationRequestReviewStatusColor,
} from "./status-view-model.js";
import {
  summarizeAssetReleaseLadderReplayProjection,
  summarizeDynamicBehaviorCoverage,
  summarizeEncounterFactoryDryRun,
  summarizeEncounterFactoryInputPlanning,
  summarizeEvidenceGateRefs,
  summarizeHumanoidMetadataBlockers,
  summarizeHumanoidRealismProfiles,
  summarizeHumanReviewActions,
  summarizeMaterializationEvidenceAttachments,
  summarizeMaterializationInputManifest,
  summarizeMaterializationInputReviewActions,
  summarizeMaterializationInputReviewDecisionRecord,
  summarizePedsGeneratedPlayerAndEmotion,
  summarizePublicationMetadata,
  summarizeRuntimeBundleAssemblyAudit,
  summarizeRuntimeBundleGateRefs,
  summarizeRuntimeEvidenceCaptureScaffold,
  summarizeRuntimeRealismEvidenceInputReviewDecisionRecord,
  summarizeRuntimeVisualEvidenceAttachmentActions,
  summarizeRuntimeVisualEvidenceAttachmentRecord,
  summarizeRuntimeVisualEvidenceAttachmentSummary,
  summarizeScenarioReviewGate,
} from "./environment-queue-readiness-summaries.js";


export type EnvironmentGenerationQueuePanelProps = {
  environmentGenerationQueue: EnvironmentGenerationQueue;
  environmentGenerationWorkOrderQueue?: EnvironmentGenerationWorkOrderQueue;
  sceneGenerationPipelineQueue?: ScenarioSceneGenerationPipelineWorkOrderQueue;
  sceneGenerationRequestQueue?: ScenarioSceneGenerationRequestQueue;
  sceneGenerationPublicationReadiness?: ScenarioSceneGenerationRequestPublicationReadiness;
  onInitiateSceneGeneration?: (scenarioId: string) => void;
  onAttachSceneGenerationReview?: (request: CreateScenarioSceneGenerationRequestResult) => void;
  onCheckSceneGenerationPublicationReadiness?: (request: CreateScenarioSceneGenerationRequestResult) => void;
  /** Faculty lock review rows for compile/materialization actor+equipment subjects. Metadata only; not wired to Mongo or a real lock API yet. */
  facultyCompileLockRows?: FacultyCompileLockRow[];
  /** Parent-owned lock toggle: a locked row survives re-render only when the parent persists the change. */
  onFacultyCompileLockChange?: (rowId: string, locked: boolean) => void;
  /** Parent-owned override path change for a faculty lock row (ActorPhenotypeSchema pointers only). */
  onFacultyCompileOverrideChange?: (rowId: string, overridePath: FacultyCompileOverridePath | undefined) => void;
  /** Parent-owned override VALUE change for a faculty lock row (the value half of the overridePatch). */
  onFacultyCompileOverrideValueChange?: (rowId: string, overrideValue: unknown) => void;
  /** Compile/materialization dependency edges for a read-only graph view. Optional; writes stay on the lock Table API. */
  compileEdges?: CompileEdge[];
  /** Featured scenario id for the faculty world-compile request; parent-owned. */
  featuredScenarioId?: string;
  /** Faculty "Compile this encounter": runs the world compile for featuredScenarioId. */
  onCompileEncounter?: (scenarioId: string) => void;
  infinigenPrompt?: string;
  onInfinigenPromptChange?: (prompt: string) => void;
  /**
   * Worldview add-actor: unique actorId plus an ActorVariant compile node.
   * CaseAuthoringWorkbench Form.List Add actor remains the case-card splice.
   */
  onAddActor?: (payload: { actorId: string; compileNodeKind: "ActorVariant" }) => void;
  onBindEquipmentFixtureSlot?: (payload: { equipmentId: string; fixtureSlot: string }) => void;
  onAddNode?: (nodeId: string) => void;
  onRemoveNode?: (nodeId: string) => void;
  /** Authored Scenario.version for the featured case (worldview header). */
  caseDefVersion?: number;
  /** Last world-compile compileVersion for the featured case (worldview header). */
  compileVersion?: number;
  /**
   * Actor staging authoring rows (optional). When omitted, rows derive from the
   * faculty compile lock actor subjects, so the staging surface stays populated
   * wherever the lock table is. Parent-owned identity only; authored placement
   * values flow back through `onPlacementAuthorChange`.
   */
  placementAuthorRows?: readonly PlacementAuthorRow[];
  /** Parent-owned seeded placement values, keyed by actorId (survives panel re-render). */
  initialPlacementAuthorValues?: Readonly<Record<string, PlacementAuthorValue>>;
  /** Parent-owned placement change: the actor's authored staging (ActorCard.placement fields). */
  onPlacementAuthorChange?: (actorId: string, placement: PlacementAuthorValue) => void;
};

export { FACULTY_COMPILE_OVERRIDE_PATHS } from "./faculty-compile-lock.js";
export type { FacultyCompileLockRow, FacultyCompileOverridePath } from "./faculty-compile-lock.js";

/** One faculty-authored staging row (actor identity for the staging authoring list). */
export type PlacementAuthorRow = {
  actorId: string;
  displayName?: string;
};

/**
 * Authored staging placement for an actor — the same ActorCard.placement fields
 * the factory Placement compile nodes and PLACEMENT_OVERRIDE_PATHS
 * (/supportSurface, /plantOffsetMeters) consume. Metadata only.
 */
export type PlacementAuthorValue = {
  supportSurface?: string;
  plantOffsetMeters?: number;
};

function toPlacementSelectOptions(values: readonly string[]): { label: string; value: string }[] {
  return values.map((value) => ({ label: value, value }));
}
const supportSurfaceSelectOptions = toPlacementSelectOptions(supportSurfaceOptions);

export function EnvironmentGenerationQueuePanel({
  environmentGenerationQueue,
  environmentGenerationWorkOrderQueue,
  sceneGenerationPipelineQueue,
  sceneGenerationRequestQueue,
  sceneGenerationPublicationReadiness,
  onInitiateSceneGeneration,
  onAttachSceneGenerationReview,
  onCheckSceneGenerationPublicationReadiness,
  facultyCompileLockRows = [],
  onFacultyCompileLockChange,
  onFacultyCompileOverrideChange,
  onFacultyCompileOverrideValueChange,
  compileEdges = [],
  featuredScenarioId,
  onCompileEncounter,
  infinigenPrompt,
  onInfinigenPromptChange,
  onAddActor,
  onBindEquipmentFixtureSlot,
  onAddNode,
  onRemoveNode,
  caseDefVersion,
  compileVersion,
  placementAuthorRows,
  initialPlacementAuthorValues,
  onPlacementAuthorChange,
}: EnvironmentGenerationQueuePanelProps): ReactElement {
  const nextGateSummary = summarizeEnvironmentNextGateCounts(environmentGenerationQueue);
  const workOrderQueue = environmentGenerationWorkOrderQueue ?? buildEnvironmentGenerationWorkOrderQueue(environmentGenerationQueue);
  const prohibitedActionSummary = summarizeEnvironmentWorkOrderCounts(workOrderQueue.prohibitedActionCounts);
  const missingEvidenceCountSummary = summarizeEnvironmentWorkOrderCounts(workOrderQueue.missingEvidenceCounts);
  const prohibitedActionEntries = summarizeEnvironmentWorkOrderCountEntries(workOrderQueue.prohibitedActionCounts);
  const featuredPackets = environmentGenerationQueue.packets.slice(0, 3);
  const featuredPipeline = sceneGenerationPipelineQueue?.workOrders.find((workOrder) =>
    workOrder.workOrderId === sceneGenerationPipelineQueue.featuredFactoryPlanningWorkOrderId
  ) ?? sceneGenerationPipelineQueue?.workOrders[0];
  const latestSceneGenerationRequest = sceneGenerationRequestQueue?.requests[0];

  const placementRows = useMemo(() => {
    const source = placementAuthorRows ?? facultyCompileLockRows
      .filter((row) => row.kind === "actor")
      .map((row): PlacementAuthorRow => ({ actorId: row.compileSubject }));
    const seenActorIds = new Set<string>();
    return source.filter((row) => {
      if (seenActorIds.has(row.actorId)) {
        return false;
      }
      seenActorIds.add(row.actorId);
      return true;
    });
  }, [placementAuthorRows, facultyCompileLockRows]);
  const placementRowKey = placementRows.map((row) => row.actorId).join("\u0000");
  const [placementForm] = Form.useForm();

  useEffect(() => {
    const currentActors = (placementForm.getFieldValue("actors") as Array<Record<string, unknown>> | undefined) ?? [];
    const currentByActorId = new Map(currentActors.map((entry) => [String(entry["actorId"]), entry]));
    const nextActors = placementRows.map((row) => {
      const existing = currentByActorId.get(row.actorId);
      if (existing !== undefined) {
        return existing;
      }
      const seeded = initialPlacementAuthorValues?.[row.actorId];
      return {
        actorId: row.actorId,
        ...(seeded !== undefined && Object.keys(seeded).length > 0 ? { placement: { ...seeded } } : {}),
      };
    });
    const needsSync =
      currentActors.length !== nextActors.length ||
      currentActors.some((entry, index) => String(entry["actorId"]) !== String(nextActors[index]?.["actorId"]));
    if (needsSync) {
      placementForm.setFieldsValue({ actors: nextActors });
    }
  }, [placementRowKey, initialPlacementAuthorValues, placementForm]);

  const handlePlacementValuesChange = (): void => {
    const values = placementForm.getFieldsValue() as {
      actors?: Array<{ actorId?: string; placement?: PlacementAuthorValue }>;
    };
    const actors = values.actors ?? [];
    actors.forEach((entry, index) => {
      const row = placementRows[index];
      if (!row) {
        return;
      }
      const placement = entry?.placement;
      if (!placement) {
        return;
      }
      const authored: PlacementAuthorValue = {};
      if (placement.supportSurface !== undefined) {
        authored.supportSurface = placement.supportSurface;
      }
      if (placement.plantOffsetMeters !== undefined) {
        authored.plantOffsetMeters = placement.plantOffsetMeters;
      }
      if (Object.keys(authored).length > 0) {
        onPlacementAuthorChange?.(row.actorId, authored);
      }
    });
  };

  return (
    <section className="workbench-panel" aria-label="3D environment generation queue">
      <div className="station-queue-row">
        <Typography.Title level={4}>3D Environment Generation Queue</Typography.Title>
        <Tag color={(environmentGenerationQueue.readyForGenerationReviewScenarioIds ?? []).length > 0 ? "blue" : "gold"}>
          {`${(environmentGenerationQueue.blockedScenarioIds ?? []).length} blocked before generation review`}
        </Tag>
      </div>
      <Typography.Paragraph type="secondary">
        Admin-initiated scene generation starts after scenario configuration and covers humanoids, hair, clothing, rigging, animation, equipment, environment assets, blob publication, runtime bundle binding, and review evidence. Planning/review packet only; no generated asset, runtime dependency, or Quest evidence is implied.
      </Typography.Paragraph>
      <div className="readiness-strip">
        <EnvironmentQueueMetric label={`${environmentGenerationQueue.packetCount} environment packets`} detail={`${environmentGenerationQueue.scenarioCount ?? 0} seed-bank scenarios`} />
        <EnvironmentQueueMetric label={`${(environmentGenerationQueue.readyForGenerationReviewScenarioIds ?? []).length} ready for generation review`} detail={`${(environmentGenerationQueue.blockedScenarioIds ?? []).length} blocked before generation review`} />
        <EnvironmentQueueMetric label="Next blocked gate" detail={nextGateSummary} />
        <EnvironmentQueueMetric label="Prohibited generation actions" detail={prohibitedActionSummary} />
        <EnvironmentQueueMetric label="Missing evidence types" detail={missingEvidenceCountSummary} />
        <EnvironmentQueueMetric label={`${workOrderQueue.pendingTaskCount} pending authoring tasks`} detail={`${workOrderQueue.blockedWorkOrderCount} blocked ${workOrderQueue.blockedWorkOrderCount === 1 ? "work order" : "work orders"}`} />
        <EnvironmentQueueMetric label="Work-order boundary" detail={workOrderQueue.claimBoundary} />
        {sceneGenerationPipelineQueue ? (
          <EnvironmentQueueMetric label={`${sceneGenerationPipelineQueue.pendingStageCount} pending pipeline stages`} detail={sceneGenerationPipelineQueue.claimBoundary} />
        ) : null}
        {sceneGenerationPipelineQueue ? (
          <EnvironmentQueueMetric
            label={`factory target ${sceneGenerationPipelineQueue.featuredFactoryPlanningScenarioId ?? "none"}`}
            detail={`${sceneGenerationPipelineQueue.factoryPlanningClaimBoundary}; generation approval inferred ${String(sceneGenerationPipelineQueue.generationApprovalInferred)}`}
          />
        ) : null}
        {sceneGenerationRequestQueue ? (
          <EnvironmentQueueMetric label={`${sceneGenerationRequestQueue.requestCount} scene generation requests`} detail={sceneGenerationRequestQueue.claimBoundary} />
        ) : null}
      </div>
      {featuredPipeline ? (
        <div className="station-queue-row">
          <Typography.Text strong>{`Scene pipeline: ${featuredPipeline.scenarioId}`}</Typography.Text>
          <Tag color="gold">review-gated factory target</Tag>
          <Tag color="blue">{featuredPipeline.initiatedFrom}</Tag>
          <Tag color="cyan">{featuredPipeline.storageTarget.storeKind}</Tag>
          <Typography.Text type="secondary">{featuredPipeline.stages.map((stage) => stage.stageId).slice(0, 5).join(" -> ")}</Typography.Text>
          {onInitiateSceneGeneration ? (
            <Button size="small" onClick={() => onInitiateSceneGeneration(featuredPipeline.scenarioId)}>
              Initiate scene generation request
            </Button>
          ) : null}
        </div>
      ) : null}
      {featuredPipeline ? (
        <fieldset className="station-queue-row" aria-label="Humanoid runtime readiness handoff">
          <Typography.Text strong>Humanoid runtime readiness handoff</Typography.Text>
          <Typography.Text type="secondary">{summarizeHumanoidRuntimeReadinessHandoff(featuredPipeline)}</Typography.Text>
        </fieldset>
      ) : null}
      {latestSceneGenerationRequest ? (
        <fieldset className="station-queue-row" aria-label="Latest scene generation request review status">
          <Typography.Text strong>{`Latest scene request: ${latestSceneGenerationRequest.scenarioId}`}</Typography.Text>
          <Tag color={sceneGenerationRequestReviewStatusColor(latestSceneGenerationRequest.reviewStatus)}>{latestSceneGenerationRequest.reviewStatus}</Tag>
          <Tag color={sceneGenerationRequestProjectionArtifactStatusColor(latestSceneGenerationRequest.reviewStatus)}>
            {sceneGenerationRequestProjectionArtifactStatusLabel(latestSceneGenerationRequest.reviewStatus)}
          </Tag>
          <Typography.Text type="secondary">{latestSceneGenerationRequest.nextAction}</Typography.Text>
          <Typography.Text type="secondary">
            {`${latestSceneGenerationRequest.runtimeAssetReviewDecisionCount} runtime asset review decision${latestSceneGenerationRequest.runtimeAssetReviewDecisionCount === 1 ? "" : "s"}`}
          </Typography.Text>
          {latestSceneGenerationRequest.factoryPlanningContext ? (
            <Typography.Text type="secondary">
              {`Factory planning context: ${latestSceneGenerationRequest.factoryPlanningContext.workOrderId}; featured=${String(latestSceneGenerationRequest.factoryPlanningContext.isFeaturedFactoryPlanningTarget)}; ${latestSceneGenerationRequest.factoryPlanningContext.factoryPlanningClaimBoundary}; generation approval inferred ${String(latestSceneGenerationRequest.factoryPlanningContext.generationApprovalInferred)}`}
            </Typography.Text>
          ) : null}
          {onAttachSceneGenerationReview ? (
            <Button size="small" onClick={() => onAttachSceneGenerationReview(latestSceneGenerationRequest)}>
              Attach local runtime review decisions
            </Button>
          ) : null}
          {onCheckSceneGenerationPublicationReadiness ? (
            <Button size="small" onClick={() => onCheckSceneGenerationPublicationReadiness(latestSceneGenerationRequest)}>
              Check publication readiness
            </Button>
          ) : null}
        </fieldset>
      ) : null}
      {sceneGenerationPublicationReadiness ? (
        <div className="station-queue-row">
          <Typography.Text strong>{sceneGenerationPublicationReadiness.canRunGeneratedBundlePublisher ? "Publication gate: ready to run generated bundle publisher" : "Publication gate: blocked"}</Typography.Text>
          <Tag color={sceneGenerationPublicationReadiness.canRunGeneratedBundlePublisher ? "blue" : "gold"}>{sceneGenerationPublicationReadiness.claimBoundary}</Tag>
          <Tag color={sceneGenerationPublicationReadiness.canUseGeneratedBundleForLearnerRuntime ? "blue" : "gold"}>
            {sceneGenerationPublicationReadiness.canUseGeneratedBundleForLearnerRuntime ? "learner runtime gate: evidence attached" : "learner runtime gate: blocked"}
          </Tag>
          <Typography.Text type="secondary">{sceneGenerationPublicationReadiness.blockers.join(", ") || sceneGenerationPublicationReadiness.nextAction}</Typography.Text>
          <Typography.Text type="secondary">{`Learner-use blockers: ${sceneGenerationPublicationReadiness.learnerRuntimeUseBlockers?.join(", ") || "none"}`}</Typography.Text>
          <Typography.Text type="secondary">{`Evidence gates: ${summarizeEvidenceGateRefs(sceneGenerationPublicationReadiness.evidenceGateRefs)}`}</Typography.Text>
          <Typography.Text type="secondary">{summarizeScenarioReviewGate(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeRuntimeBundleGateRefs(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeRuntimeBundleAssemblyAudit(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizePublicationMetadata(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeHumanoidRealismProfiles(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeHumanoidMetadataBlockers(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeHumanReviewActions(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeDynamicBehaviorCoverage(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeEncounterFactoryInputPlanning(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeMaterializationInputManifest(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeMaterializationEvidenceAttachments(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeMaterializationInputReviewActions(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeMaterializationInputReviewDecisionRecord(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeRuntimeRealismEvidenceInputReviewDecisionRecord(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeRuntimeVisualEvidenceAttachmentSummary(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeRuntimeVisualEvidenceAttachmentRecord(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeAssetReleaseLadderReplayProjection(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeRuntimeVisualEvidenceAttachmentActions(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeRuntimeEvidenceCaptureScaffold(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizePedsGeneratedPlayerAndEmotion(sceneGenerationPublicationReadiness)}</Typography.Text>
          <Typography.Text type="secondary">{summarizeEncounterFactoryDryRun(sceneGenerationPublicationReadiness)}</Typography.Text>
        </div>
      ) : null}
      {prohibitedActionEntries.length > 0 ? (
        <div className="station-queue-row">
          {prohibitedActionEntries.map((entry) => (
            <Tag color="orange" key={entry}>
              {entry}
            </Tag>
          ))}
        </div>
      ) : null}
      {featuredPackets.length > 0 ? (
        <ol className="station-queue-list" aria-label="3D environment queue packet preview">
          {featuredPackets.map((packet) => (
            <EnvironmentPacketPreview key={`${packet.scenarioId}:${packet.environmentAssetId}`} packet={packet} />
          ))}
        </ol>
      ) : (
        <Typography.Text type="secondary">No environment packets are attached yet.</Typography.Text>
      )}
      <fieldset className="station-queue-row" aria-label="Faculty compile this encounter">
        <Typography.Text strong>Faculty compile this encounter</Typography.Text>
        <Typography.Text type="secondary">
          {`caseDefVersion ${caseDefVersion ?? "—"} · compileVersion ${compileVersion ?? "—"}`}
        </Typography.Text>
        <Typography.Text type="secondary">
          {`Runs the world compile for ${featuredScenarioId ?? "the featured scenario"}; world-compile request only, not a baker invoke or packet promote.`}
        </Typography.Text>
        <Input.TextArea
          aria-label="Room Infinigen prompt"
          value={infinigenPrompt}
          onChange={(event) => onInfinigenPromptChange?.(event.target.value)}
          placeholder="Infinigen prompt for the Room compile node"
          autoSize={{ minRows: 2, maxRows: 6 }}
        />
        {onCompileEncounter ? (
          <Button
            size="small"
            disabled={!featuredScenarioId}
            onClick={() => {
              if (featuredScenarioId) {
                onCompileEncounter(featuredScenarioId);
              }
            }}
          >
            Compile this encounter
          </Button>
        ) : null}
        <Button
          size="small"
          aria-label="Add actor compile node"
          onClick={() => {
            const actorId = `actor_worldview_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}_v1`;
            onAddActor?.({ actorId, compileNodeKind: "ActorVariant" });
          }}
        >
          Add actor compile node
        </Button>
        <Select allowClear showSearch={false} virtual={false} aria-label="Equipment fixtureSlot" placeholder="Bind equipment to fixtureSlot" style={{ minWidth: 220 }} options={[{ value: "stretcher", label: "stretcher" }, { value: "monitor", label: "monitor" }, { value: "ecg_cart", label: "ecg_cart" }]} onChange={(fixtureSlot) => { if (typeof fixtureSlot === "string") onBindEquipmentFixtureSlot?.({ equipmentId: `equip_worldview_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`, fixtureSlot }); }} />
      </fieldset>
      <fieldset className="station-queue-row" aria-label="Faculty compile/materialization lock table">
        <Typography.Text strong>Faculty compile lock</Typography.Text>
        <Typography.Text type="secondary">
          {`${facultyCompileLockRows.length} compile/materialization subject${facultyCompileLockRows.length === 1 ? "" : "s"}`}
        </Typography.Text>
        <ProposedVsAcceptedList rows={facultyCompileLockRows} />
        <Table<FacultyCompileLockRow>
          size="small"
          pagination={false}
          rowKey="rowId"
          dataSource={facultyCompileLockRows}
          columns={buildFacultyCompileLockColumns({ onFacultyCompileLockChange, onFacultyCompileOverrideChange, onFacultyCompileOverrideValueChange })}
          locale={{ emptyText: "No compile/materialization lock rows attached yet." }}
        />
        <Typography.Paragraph type="secondary">
          Lock and override changes are faculty review metadata persisted to the local compile-lock store; they do not promote or publish a compile/materialization packet.
        </Typography.Paragraph>
      </fieldset>
      <fieldset className="station-queue-row" aria-label="Faculty staging authoring">
        <Typography.Text strong>Faculty staging authoring</Typography.Text>
        <Typography.Text type="secondary">
          {`${placementRows.length} actor staging subject${placementRows.length === 1 ? "" : "s"}; staging metadata only, no generated asset or runtime placement is implied.`}
        </Typography.Text>
        {placementRows.length === 0 ? (
          <Typography.Text type="secondary">
            No actor staging rows yet. Actors appear here once the scene pipeline work orders (or faculty compile lock rows) attach.
          </Typography.Text>
        ) : (
          <Form form={placementForm} layout="vertical" onValuesChange={handlePlacementValuesChange}>
            <Form.List name="actors">
              {(fields) => (
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {fields.map((field) => {
                    const row = placementRows[field.name];
                    const subject = row?.displayName ? `${row.displayName} (${row.actorId})` : row?.actorId ?? `actor ${field.name}`;
                    return (
                      <Space key={field.key} wrap align="end" size={8}>
                        <Typography.Text strong style={{ minWidth: 240 }}>
                          {subject}
                        </Typography.Text>
                        <Form.Item
                          name={[field.name, "placement", "supportSurface"]}
                          label="Support surface"
                          tooltip="Where this actor is staged (stretcher|chair|none); 'none' is an explicit standing decision. Writes ActorCard.placement.supportSurface — the field the factory Placement compile node and PLACEMENT_OVERRIDE_PATHS consume."
                        >
                          <Select
                            allowClear
                            options={supportSurfaceSelectOptions}
                            style={{ minWidth: 160 }}
                            aria-label={`Support surface for ${subject}`}
                            placeholder="unset"
                          />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, "placement", "plantOffsetMeters"]}
                          label="Plant offset (m)"
                          tooltip="Floor offset in meters applied to the actor placement (PLACEMENT_OVERRIDE_PATHS /plantOffsetMeters)."
                        >
                          <InputNumber
                            min={0}
                            step={0.1}
                            style={{ minWidth: 140 }}
                            aria-label={`Plant offset for ${subject}`}
                            placeholder="default"
                          />
                        </Form.Item>
                      </Space>
                    );
                  })}
                </Space>
              )}
            </Form.List>
          </Form>
        )}
        <Typography.Paragraph type="secondary">
          Faculty-authored staging writes the same ActorCard.placement fields (supportSurface, plantOffsetMeters) the factory Placement compile nodes read; staging metadata only, no asset bake, room layout, or runtime staging is implied.
        </Typography.Paragraph>
      </fieldset>
      <fieldset className="station-queue-row" aria-label="Compile/materialization dependency graph">
        <Typography.Text strong>Compile graph</Typography.Text>
        <Typography.Text type="secondary">
          {`${compileEdges.length} compile dependency edge${compileEdges.length === 1 ? "" : "s"}; read-only view; writes stay on the faculty compile lock table.`}
        </Typography.Text>
        <Suspense fallback={<Typography.Text type="secondary">Loading compile graph…</Typography.Text>}>
          <CompileGraphCanvas compileEdges={compileEdges} onAddNode={onAddNode} onRemoveNode={onRemoveNode} />
        </Suspense>
        <Typography.Paragraph type="secondary">
          Read-only @xyflow/react rendering of compile/materialization dependencies; no write path, Mongo persistence, or lock-API enforcement is implied.
        </Typography.Paragraph>
      </fieldset>
    </section>
  );
}

function EnvironmentQueueMetric({ label, detail }: { label: string; detail: string }): ReactElement {
  return (
    <div className="readiness-metric">
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type="secondary">{detail}</Typography.Text>
    </div>
  );
}

function EnvironmentPacketPreview({ packet }: { packet: EnvironmentGenerationPacket }): ReactElement {
  const firstZone = packet.spatialZones[0];
  const workOrder = buildEnvironmentGenerationWorkOrder(packet);
  const firstTask = workOrder.tasks[0];
  const requiredEvidenceSummary = workOrder.requiredOutputEvidence.slice(0, 3).join(", ");
  const gateBlockerSummary = summarizeEnvironmentPacketGateBlockers(packet);
  const missingEvidenceSummary = workOrder.operatorHandoff.missingEvidenceIds.slice(0, 3).join(", ");
  const reviewBlockerSummary = workOrder.operatorHandoff.reviewBlockerIds.slice(0, 3).join(", ") || "no review blockers";

  return (
    <li>
      <div className="station-queue-row">
        <div>
          <Typography.Text strong>{packet.displayName}</Typography.Text>
          <Typography.Text type="secondary">{packet.environmentAssetId}</Typography.Text>
        </div>
        <Tag color={packet.readyForGenerationReview ? "blue" : "gold"}>
          {packet.readyForGenerationReview ? "generation review ready" : packet.nextReviewGate ?? "generation review blocked"}
        </Tag>
      </div>
      <Typography.Paragraph type="secondary">
        {`${packet.spatialZones.length} spatial zones; first zone: ${firstZone?.zoneId ?? "none"}. Required assets: ${packet.requiredAssetIds.length}.`}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {`${workOrder.tasks.length} authoring tasks; first task: ${firstTask?.taskId ?? "none"}. Authoring tool: ${workOrder.authoringToolId}.`}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Handoff summary: ${workOrder.operatorHandoff.summary}`}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Next action: ${workOrder.operatorHandoff.nextAction}`}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Missing evidence: ${missingEvidenceSummary}`}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Review blockers: ${reviewBlockerSummary}`}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Gate blockers: ${gateBlockerSummary}`}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{`Required evidence: ${requiredEvidenceSummary}`}</Typography.Paragraph>
      <Typography.Text type="secondary">{`Handoff boundary: ${workOrder.operatorHandoff.claimBoundary}`}</Typography.Text>
      <Typography.Text type="secondary">{workOrder.claimBoundary}</Typography.Text>
    </li>
  );
}

function summarizeEnvironmentPacketGateBlockers(packet: EnvironmentGenerationPacket): string {
  const blockers = Array.from(new Set(packet.reviewGates.flatMap((gate) => gate.blockers)));

  return blockers.length > 0 ? blockers.slice(0, 3).join(", ") : "no gate blockers";
}

function summarizeEnvironmentNextGateCounts(environmentGenerationQueue: EnvironmentGenerationQueue): string {
  const entries = Object.entries(environmentGenerationQueue.nextReviewGateCounts ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
    .map(([gate, count]) => `${gate}: ${count}`);

  return entries.length > 0 ? entries.slice(0, 3).join(", ") : "no blocked generation gates";
}

function summarizeEnvironmentWorkOrderCounts(counts: Record<string, number>): string {
  const entries = summarizeEnvironmentWorkOrderCountEntries(counts);

  return entries.length > 0 ? entries.slice(0, 3).join(", ") : "no prohibited generation actions";
}

function summarizeEnvironmentWorkOrderCountEntries(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
    .map(([item, count]) => `${item}: ${count}`);
}

function summarizeHumanoidRuntimeReadinessHandoff(
  workOrder: ScenarioSceneGenerationPipelineWorkOrderQueue["workOrders"][number],
): string {
  const actorSummaries = workOrder.actorWorkOrders
    .slice(0, 4)
    .map((actorWorkOrder) => {
      const handoff = actorWorkOrder.humanoidRuntimeReadinessHandoff;
      return [
        actorWorkOrder.actorRole,
        "badge realismBlocked until actor-specific humanoid gate evidence attaches",
        `signals ${handoff.requiredSignalIds.join(", ") || "none"}`,
        `locomotion ${String(handoff.locomotionRequired)}`,
        `expression ${String(handoff.expressionRequired)}`,
        `gaze ${String(handoff.gazeRequired)}`,
        `lip-sync ${String(handoff.lipSyncRequired)}`,
        `interactive ${String(handoff.interactiveRequired)}`,
        `blockers ${handoff.blockers.join(", ") || "none"}`,
        handoff.claimBoundary,
        `not evidence for ${handoff.notEvidenceFor.join(", ")}`,
      ].join("; ");
    });
  return actorSummaries.length > 0
    ? actorSummaries.join(" | ")
    : "No humanoid actor runtime handoff metadata attached";
}

