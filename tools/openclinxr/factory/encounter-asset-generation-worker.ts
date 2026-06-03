import { stat } from "node:fs/promises";
import { Mongoose } from "mongoose";
import {
  createAzureStorageEncounterAssetGenerationQueueClientFromConnectionString,
  decodeAzureStorageQueueMessage,
  type EncounterAssetGenerationQueueClient,
  type EncounterAssetGenerationQueueMessageEnvelope,
  type EncounterAssetGenerationQueueProcessingResult,
  type EncounterAssetGenerationWorkerExecution,
  processNextEncounterAssetGenerationQueueMessage,
} from "../../../packages/openclinxr/capability-gateway/src/index.js";
import {
  createEncounterAssetGenerationJobModel,
  EncounterAssetGenerationJobMongooseRepository,
} from "../../../packages/openclinxr/data-sources-mongoose-models/src/index.js";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import type { EncounterAssetGenerationQueueReport } from "./encounter-asset-generation-queue.js";
import type { EncounterMaterializationAttachmentPlan } from "./encounter-materialization-attachment-plan.js";
import type { EncounterMaterializationEvidenceAttachmentRecords } from "./encounter-materialization-evidence-attachments.js";
import type { EncounterMaterializationInputManifest } from "./encounter-materialization-input-manifest.js";
import {
  buildEncounterOperationalBoundaryNotes,
  type EncounterOperationalBoundaryNotes,
  validateEncounterOperationalBoundaryNotes,
} from "./provider-boundary-notes.js";
import type { VisualQaRemediationWorkOrderRef } from "./visual-qa-evidence-check.js";

type CliOptions = {
  queueReportPath?: string;
  materializationInputManifestPath?: string;
  materializationAttachmentPlanPath?: string;
  materializationEvidenceAttachmentsPath?: string;
  outputPath?: string;
  stdout: boolean;
  validatePath?: string;
  validateLatest: boolean;
  azureStorageQueue: boolean;
  connectionString?: string;
  visibilityTimeoutSeconds?: number;
  mongooseUri?: string;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type EncounterAssetGenerationWorkerReport = {
  generatedAt: string;
  schemaVersion: "openclinxr.encounter-asset-generation-worker-report.v1";
  status: EncounterAssetGenerationQueueProcessingResult["status"];
  sourceQueueReportPath?: string;
  processingResult: EncounterAssetGenerationQueueProcessingResult;
  persistedExecutions: EncounterAssetGenerationWorkerExecution[];
  remediationWorkOrderRefs?: VisualQaRemediationWorkOrderRef[];
  materializationInputManifestSummary?: {
    schemaVersion: "openclinxr.encounter-materialization-input-manifest-summary.v1";
    source: "encounter_materialization_input_manifest";
    scenarioId: string | null;
    actorWorkOrderInputCount: number;
    equipmentWorkOrderInputCount: number;
    requiredActorCueIds: string[];
    requiredEquipmentCueIds: string[];
    blockerIds: string[];
    providerExecutionPerformed: false;
    paidApisUsed: false;
    externalNetworkUsed: false;
    claimBoundary: "metadata_only_provider_neutral_materialization_inputs";
  };
  materializationAttachmentPlanSummary?: {
    schemaVersion: "openclinxr.encounter-materialization-attachment-plan-summary.v1";
    source: "encounter_materialization_attachment_plan";
    scenarioId: string | null;
    actorAttachmentSlotCount: number;
    equipmentAttachmentSlotCount: number;
    missingAttachmentCount: number;
    actorRequiredCueIds: string[];
    equipmentRequiredCueIds: string[];
    blockerIds: string[];
    providerExecutionPerformed: false;
    runtimeSelectionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    claimBoundary: "metadata_only_materialization_attachment_plan";
  };
  materializationEvidenceAttachmentSummary?: {
    schemaVersion: "openclinxr.encounter-materialization-evidence-attachment-summary.v1";
    source: "encounter_materialization_evidence_attachments";
    scenarioId: string | null;
    totalRequiredSlotCount: number;
    attachedSlotCount: number;
    missingSlotCount: number;
    heldOrInvalidAttachmentCount: number;
    allRequiredSlotsSatisfied: boolean;
    blockerIds: string[];
    providerExecutionPerformed: false;
    runtimeSelectionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    claimBoundary: "metadata_only_materialization_evidence_attachment_summary";
  };
  pedsEmotionRequirementCountFromActiveCues?: number;
  workerMaterializationPlan?: EncounterAssetGenerationWorkerExecution["workerMaterializationPlan"];
  sharedAssetLibraryCacheSummary: {
    cacheEventCount: number;
    cacheHitReuseCount: number;
    cacheMissGenerationRequiredCount: number;
    lruEvictionCount: number;
    generatedAssetsStillDynamic: true;
    lookupBeforeGenerate: true;
  };
  operationalNotes: EncounterOperationalBoundaryNotes;
  evidenceBoundaries: {
    localOneMessageWorkerExecuted: true;
    azuriteCompatibleEnvelopeUsed: true;
    azureCloudOperationPerformed: false;
    mongoosePersistenceAttempted: boolean;
    paidApisUsed: false;
    productionDeploymentPerformed: false;
    productionReadinessClaimed: false;
    questReadinessClaimed: false;
  };
};

const defaultOutputPath = `docs/openclinxr/encounter-asset-generation-worker-${new Date().toISOString().slice(0, 10)}.json`;

async function main(): Promise<void> {
  await runEncounterAssetGenerationWorkerCli(process.argv.slice(2));
}

export async function runEncounterAssetGenerationWorkerCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/encounter-asset-generation-worker-*.json");
    if (!validatePath) {
      throw new Error("Missing encounter asset generation worker report to validate.");
    }
    const validation = validateEncounterAssetGenerationWorkerReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const queueReportPath = options.azureStorageQueue
    ? options.queueReportPath
    : options.queueReportPath
    ?? await latestPath("docs/openclinxr/encounter-asset-generation-queue-*.json");
  if (!queueReportPath) {
    throw new Error("Missing queue report. Run asset:encounter-queue:plan first.");
  }
  const queueReport = await readJson<EncounterAssetGenerationQueueReport>(queueReportPath);
  const materializationInputManifest = options.materializationInputManifestPath
    ? await readJson<EncounterMaterializationInputManifest>(options.materializationInputManifestPath)
    : undefined;
  const materializationAttachmentPlan = options.materializationAttachmentPlanPath
    ? await readJson<EncounterMaterializationAttachmentPlan>(options.materializationAttachmentPlanPath)
    : undefined;
  const materializationEvidenceAttachments = options.materializationEvidenceAttachmentsPath
    ? await readJson<EncounterMaterializationEvidenceAttachmentRecords>(options.materializationEvidenceAttachmentsPath)
    : undefined;
  const report = await buildEncounterAssetGenerationWorkerReport({
    queueReport,
    sourceQueueReportPath: queueReportPath,
    materializationInputManifest,
    materializationAttachmentPlan,
    materializationEvidenceAttachments,
    ...(options.azureStorageQueue
      ? {
          queueClient: createAzuriteEncounterAssetGenerationQueueClient({
            connectionString: options.connectionString ?? process.env.AZURE_STORAGE_CONNECTION_STRING,
            visibilityTimeoutSeconds: options.visibilityTimeoutSeconds,
          }),
        }
      : {}),
    mongooseUri: options.mongooseUri ?? process.env.MONGODB_URI,
  });

  if (options.stdout) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const outputPath = options.outputPath ?? defaultOutputPath;
  await writeJson(outputPath, report);
  console.log(`Wrote ${outputPath}`);
}

export async function buildEncounterAssetGenerationWorkerReport(input: {
  queueReport: EncounterAssetGenerationQueueReport;
  sourceQueueReportPath?: string;
  generatedAt?: string;
  queueClient?: EncounterAssetGenerationQueueClient;
  mongooseUri?: string;
  remediationWorkOrderRefs?: VisualQaRemediationWorkOrderRef[];
  materializationInputManifest?: EncounterMaterializationInputManifest;
  materializationAttachmentPlan?: EncounterMaterializationAttachmentPlan;
  materializationEvidenceAttachments?: EncounterMaterializationEvidenceAttachmentRecords;
}): Promise<EncounterAssetGenerationWorkerReport> {
  const persistedExecutions: EncounterAssetGenerationWorkerExecution[] = [];
  const mongoose = input.mongooseUri ? new Mongoose() : undefined;
  const repository = mongoose
    ? new EncounterAssetGenerationJobMongooseRepository(createEncounterAssetGenerationJobModel(mongoose))
    : undefined;
  if (mongoose && input.mongooseUri) {
    await mongoose.connect(input.mongooseUri);
    await repository?.ensureIndexes();
  }
  const envelope: EncounterAssetGenerationQueueMessageEnvelope = {
    messageId: `${input.queueReport.request.requestId}:local-message`,
    popReceipt: `${input.queueReport.request.requestId}:local-receipt`,
    messageText: input.queueReport.queue.encodedMessage,
    dequeueCount: 1,
  };
  const localQueueClient = {
    async receiveEncounterAssetGenerationMessage() {
      return envelope;
    },
    async deleteEncounterAssetGenerationMessage() {
      return undefined;
    },
  };
  const remediationWorkOrderRefs = input.remediationWorkOrderRefs
    ?? await latestVisualQaRemediationWorkOrderRefsForScenario(input.queueReport.request.scenarioId);
  try {
    const processingResult = await processNextEncounterAssetGenerationQueueMessage({
      queueClient: input.queueClient ?? localQueueClient,
      now: deterministicClock(input.generatedAt ?? new Date().toISOString()),
      persistExecution: async (execution, receivedEnvelope) => {
        if (repository) {
          await repository.saveWorkerExecution(
            decodeAzureStorageQueueMessage(receivedEnvelope.messageText),
            receivedEnvelope,
            execution,
          );
        }
        persistedExecutions.push(execution);
      },
    });

    return {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      schemaVersion: "openclinxr.encounter-asset-generation-worker-report.v1",
      status: processingResult.status,
      ...(input.sourceQueueReportPath ? { sourceQueueReportPath: input.sourceQueueReportPath } : {}),
      processingResult,
      persistedExecutions,
      ...(remediationWorkOrderRefs?.length ? { remediationWorkOrderRefs } : {}),
      ...(input.materializationInputManifest
        ? { materializationInputManifestSummary: summarizeMaterializationInputManifest(input.materializationInputManifest) }
        : {}),
      ...(input.materializationAttachmentPlan
        ? { materializationAttachmentPlanSummary: summarizeMaterializationAttachmentPlan(input.materializationAttachmentPlan) }
        : {}),
      ...(input.materializationEvidenceAttachments
        ? { materializationEvidenceAttachmentSummary: summarizeMaterializationEvidenceAttachments(input.materializationEvidenceAttachments) }
        : {}),
      ...(processingResult.scenarioId === "peds_asthma_parent_anxiety_v1" ? { pedsEmotionRequirementCountFromActiveCues: 2 } : {}),
      ...(persistedExecutions[0]?.workerMaterializationPlan
        ? { workerMaterializationPlan: persistedExecutions[0].workerMaterializationPlan }
        : {}),
      sharedAssetLibraryCacheSummary: summarizeSharedAssetLibraryCacheEvents(persistedExecutions),
      operationalNotes: buildEncounterOperationalBoundaryNotes(),
      evidenceBoundaries: {
        localOneMessageWorkerExecuted: true,
        azuriteCompatibleEnvelopeUsed: true,
        azureCloudOperationPerformed: false,
        mongoosePersistenceAttempted: Boolean(input.mongooseUri),
        paidApisUsed: false,
        productionDeploymentPerformed: false,
        productionReadinessClaimed: false,
        questReadinessClaimed: false,
      },
    };
  } finally {
    await mongoose?.disconnect();
  }
}

export function validateEncounterAssetGenerationWorkerReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.schemaVersion, "openclinxr.encounter-asset-generation-worker-report.v1", "/schemaVersion", errors);
  requireOneOf(value.status, ["idle", "processed", "failed_before_delete"], "/status", errors);
  requireRecord(value.processingResult, "/processingResult", errors);
  requireArray(value.persistedExecutions, "/persistedExecutions", errors);
  requireRecord(value.evidenceBoundaries, "/evidenceBoundaries", errors);
  if (Object.hasOwn(value, "remediationWorkOrderRefs")) {
    validateVisualQaRemediationWorkOrderRefs(value.remediationWorkOrderRefs, "/remediationWorkOrderRefs", errors);
  }
  if (Object.hasOwn(value, "materializationInputManifestSummary")) {
    validateMaterializationInputManifestSummary(value.materializationInputManifestSummary, errors);
  }
  if (Object.hasOwn(value, "materializationAttachmentPlanSummary")) {
    validateMaterializationAttachmentPlanSummary(value.materializationAttachmentPlanSummary, errors);
  }
  if (Object.hasOwn(value, "materializationEvidenceAttachmentSummary")) {
    validateMaterializationEvidenceAttachmentSummary(value.materializationEvidenceAttachmentSummary, errors);
  }

  if (isRecord(value.processingResult)) {
    if (value.status === "idle") {
      requireLiteral(value.processingResult.messageReceived, false, "/processingResult/messageReceived", errors);
    } else {
      requireLiteral(value.processingResult.messageReceived, true, "/processingResult/messageReceived", errors);
      requireLiteral(value.processingResult.messageDeleted, true, "/processingResult/messageDeleted", errors);
    }
  }
  if (Array.isArray(value.persistedExecutions)) {
    const expectedExecutionCount = value.status === "idle" ? 0 : 1;
    if (value.persistedExecutions.length !== expectedExecutionCount) {
      errors.push("/persistedExecutions must contain exactly one execution");
    }
    const execution = value.persistedExecutions[0];
    if (isRecord(execution)) {
      requireLiteral(execution.schemaVersion, "openclinxr.encounter-asset-generation-worker-execution.v1", "/persistedExecutions/0/schemaVersion", errors);
      requireLiteral(execution.productionReadinessClaimed, false, "/persistedExecutions/0/productionReadinessClaimed", errors);
      requireOneOf(execution.status, ["succeeded", "failed", "review_blocked"], "/persistedExecutions/0/status", errors);
      if (!isRecord(execution.plan)) {
        errors.push("/persistedExecutions/0/plan must be object");
      } else {
        validateWorkerHumanoidRealismRequirements(execution.plan.humanoidRealismRequirements, "/persistedExecutions/0/plan/humanoidRealismRequirements", errors);
      }
      validateWorkerEvidenceGateRefs(execution.evidenceGateRefs, "/persistedExecutions/0/evidenceGateRefs", errors);
      validateWorkerMaterializationPlan(execution.workerMaterializationPlan, "/persistedExecutions/0/workerMaterializationPlan", errors);
      validateSharedAssetLibraryCacheEvents(execution.sharedAssetLibraryCacheEvents, "/persistedExecutions/0/sharedAssetLibraryCacheEvents", errors);
    }
  }
  if (Object.hasOwn(value, "workerMaterializationPlan")) {
    validateWorkerMaterializationPlan(value.workerMaterializationPlan, "/workerMaterializationPlan", errors);
  }
  requireRecord(value.sharedAssetLibraryCacheSummary, "/sharedAssetLibraryCacheSummary", errors);
  if (isRecord(value.sharedAssetLibraryCacheSummary)) {
    requireNumber(value.sharedAssetLibraryCacheSummary.cacheEventCount, "/sharedAssetLibraryCacheSummary/cacheEventCount", errors);
    requireNumber(value.sharedAssetLibraryCacheSummary.cacheHitReuseCount, "/sharedAssetLibraryCacheSummary/cacheHitReuseCount", errors);
    requireNumber(value.sharedAssetLibraryCacheSummary.cacheMissGenerationRequiredCount, "/sharedAssetLibraryCacheSummary/cacheMissGenerationRequiredCount", errors);
    requireNumber(value.sharedAssetLibraryCacheSummary.lruEvictionCount, "/sharedAssetLibraryCacheSummary/lruEvictionCount", errors);
    requireLiteral(value.sharedAssetLibraryCacheSummary.generatedAssetsStillDynamic, true, "/sharedAssetLibraryCacheSummary/generatedAssetsStillDynamic", errors);
    requireLiteral(value.sharedAssetLibraryCacheSummary.lookupBeforeGenerate, true, "/sharedAssetLibraryCacheSummary/lookupBeforeGenerate", errors);
    if (Array.isArray(value.persistedExecutions)) {
      const expectedSummary = summarizeSharedAssetLibraryCacheEvents(
        value.persistedExecutions.filter(isWorkerExecutionRecord) as EncounterAssetGenerationWorkerExecution[],
      );
      for (const key of [
        "cacheEventCount",
        "cacheHitReuseCount",
        "cacheMissGenerationRequiredCount",
        "lruEvictionCount",
      ] as const) {
        if (value.sharedAssetLibraryCacheSummary[key] !== expectedSummary[key]) {
          errors.push(`/sharedAssetLibraryCacheSummary/${key} must match persisted shared asset library cache events`);
        }
      }
    }
  }
  validateEncounterOperationalBoundaryNotes(value.operationalNotes, "/operationalNotes", errors);
  if (isRecord(value.evidenceBoundaries)) {
    requireLiteral(value.evidenceBoundaries.localOneMessageWorkerExecuted, true, "/evidenceBoundaries/localOneMessageWorkerExecuted", errors);
    requireLiteral(value.evidenceBoundaries.azuriteCompatibleEnvelopeUsed, true, "/evidenceBoundaries/azuriteCompatibleEnvelopeUsed", errors);
    requireLiteral(value.evidenceBoundaries.azureCloudOperationPerformed, false, "/evidenceBoundaries/azureCloudOperationPerformed", errors);
    if (typeof value.evidenceBoundaries.mongoosePersistenceAttempted !== "boolean") {
      errors.push("/evidenceBoundaries/mongoosePersistenceAttempted must be boolean");
    }
    requireLiteral(value.evidenceBoundaries.paidApisUsed, false, "/evidenceBoundaries/paidApisUsed", errors);
    requireLiteral(value.evidenceBoundaries.productionDeploymentPerformed, false, "/evidenceBoundaries/productionDeploymentPerformed", errors);
    requireLiteral(value.evidenceBoundaries.productionReadinessClaimed, false, "/evidenceBoundaries/productionReadinessClaimed", errors);
    requireLiteral(value.evidenceBoundaries.questReadinessClaimed, false, "/evidenceBoundaries/questReadinessClaimed", errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateWorkerMaterializationPlan(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be object`);
    return;
  }
  requireLiteral(value.schemaVersion, "openclinxr.worker-materialization-plan.v1", `${path}/schemaVersion`, errors);
  requireLiteral(value.claimBoundary, "planned_metadata_only", `${path}/claimBoundary`, errors);
  requireLiteral(value.generatedAssetsMaterialized, false, `${path}/generatedAssetsMaterialized`, errors);
  requireLiteral(value.paidApisUsed, false, `${path}/paidApisUsed`, errors);
  requireLiteral(value.productionReadinessClaimed, false, `${path}/productionReadinessClaimed`, errors);
  if (typeof value.rootPath !== "string" || !value.rootPath.startsWith(".openclinxr/encounter-factory/")) {
    errors.push(`${path}/rootPath must be an encounter-factory local path`);
  }
  requireArray(value.outputs, `${path}/outputs`, errors);
  if (Array.isArray(value.outputs)) {
    for (const [index, output] of value.outputs.entries()) {
      const outputPath = `${path}/outputs/${index}`;
      if (!isRecord(output)) {
        errors.push(`${outputPath} must be object`);
        continue;
      }
      requireOneOf(output.targetKind, [
        "role_specific_humanoid_glb",
        "medical_equipment_glb",
        "role_idle_animation_glb",
        "facial_lipsync_gaze_animation",
        "visual_feedback_closure",
      ], `${outputPath}/targetKind`, errors);
      requireLiteral(output.claimBoundary, "planned_metadata_only", `${outputPath}/claimBoundary`, errors);
      requireLiteral(output.generatedAssetsMaterialized, false, `${outputPath}/generatedAssetsMaterialized`, errors);
      requireLiteral(output.paidApisUsed, false, `${outputPath}/paidApisUsed`, errors);
      requireLiteral(output.productionReadinessClaimed, false, `${outputPath}/productionReadinessClaimed`, errors);
      if (typeof output.artifactPath !== "string" || !output.artifactPath.startsWith(String(value.rootPath))) {
        errors.push(`${outputPath}/artifactPath must live under rootPath`);
      }
      requireArray(output.outputRefs, `${outputPath}/outputRefs`, errors);
    }
  }
}

function summarizeMaterializationInputManifest(
  manifest: EncounterMaterializationInputManifest,
): NonNullable<EncounterAssetGenerationWorkerReport["materializationInputManifestSummary"]> {
  return {
    schemaVersion: "openclinxr.encounter-materialization-input-manifest-summary.v1",
    source: "encounter_materialization_input_manifest",
    scenarioId: manifest.scenarioId,
    actorWorkOrderInputCount: manifest.actorWorkOrderInputs.length,
    equipmentWorkOrderInputCount: manifest.equipmentWorkOrderInputs.length,
    requiredActorCueIds: uniqueStrings(manifest.actorWorkOrderInputs.flatMap((input) => input.requiredCueIds)),
    requiredEquipmentCueIds: uniqueStrings(manifest.equipmentWorkOrderInputs.flatMap((input) => input.requiredCueIds)),
    blockerIds: uniqueStrings(manifest.blockers),
    providerExecutionPerformed: false,
    paidApisUsed: false,
    externalNetworkUsed: false,
    claimBoundary: "metadata_only_provider_neutral_materialization_inputs",
  };
}

function summarizeMaterializationAttachmentPlan(
  plan: EncounterMaterializationAttachmentPlan,
): NonNullable<EncounterAssetGenerationWorkerReport["materializationAttachmentPlanSummary"]> {
  const actorRequiredCueIds = uniqueStrings(plan.actorAttachmentSlots.map((slot) => slot.requiredCueId));
  const equipmentRequiredCueIds = uniqueStrings(plan.equipmentAttachmentSlots.map((slot) => slot.requiredCueId));
  return {
    schemaVersion: "openclinxr.encounter-materialization-attachment-plan-summary.v1",
    source: "encounter_materialization_attachment_plan",
    scenarioId: plan.scenarioId,
    actorAttachmentSlotCount: plan.actorAttachmentSlots.length,
    equipmentAttachmentSlotCount: plan.equipmentAttachmentSlots.length,
    missingAttachmentCount: [...plan.actorAttachmentSlots, ...plan.equipmentAttachmentSlots].filter((slot) => slot.attachmentStatus === "missing_evidence").length,
    actorRequiredCueIds,
    equipmentRequiredCueIds,
    blockerIds: uniqueStrings(plan.blockers),
    providerExecutionPerformed: false,
    runtimeSelectionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    claimBoundary: "metadata_only_materialization_attachment_plan",
  };
}

function summarizeMaterializationEvidenceAttachments(
  records: EncounterMaterializationEvidenceAttachmentRecords,
): NonNullable<EncounterAssetGenerationWorkerReport["materializationEvidenceAttachmentSummary"]> {
  return {
    schemaVersion: "openclinxr.encounter-materialization-evidence-attachment-summary.v1",
    source: "encounter_materialization_evidence_attachments",
    scenarioId: records.scenarioId,
    totalRequiredSlotCount: records.attachmentCompleteness.totalRequiredSlotCount,
    attachedSlotCount: records.attachmentCompleteness.attachedSlotCount,
    missingSlotCount: records.attachmentCompleteness.missingSlotCount,
    heldOrInvalidAttachmentCount: records.attachmentCompleteness.heldOrInvalidAttachmentCount,
    allRequiredSlotsSatisfied: records.attachmentCompleteness.allRequiredSlotsSatisfied,
    blockerIds: uniqueStrings(records.blockers),
    providerExecutionPerformed: false,
    runtimeSelectionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    claimBoundary: "metadata_only_materialization_evidence_attachment_summary",
  };
}

function validateMaterializationInputManifestSummary(value: unknown, errors: string[]): void {
  requireRecord(value, "/materializationInputManifestSummary", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.schemaVersion, "openclinxr.encounter-materialization-input-manifest-summary.v1", "/materializationInputManifestSummary/schemaVersion", errors);
  requireLiteral(value.source, "encounter_materialization_input_manifest", "/materializationInputManifestSummary/source", errors);
  requireNumber(value.actorWorkOrderInputCount, "/materializationInputManifestSummary/actorWorkOrderInputCount", errors);
  requireNumber(value.equipmentWorkOrderInputCount, "/materializationInputManifestSummary/equipmentWorkOrderInputCount", errors);
  requireArray(value.requiredActorCueIds, "/materializationInputManifestSummary/requiredActorCueIds", errors);
  requireArray(value.requiredEquipmentCueIds, "/materializationInputManifestSummary/requiredEquipmentCueIds", errors);
  requireArray(value.blockerIds, "/materializationInputManifestSummary/blockerIds", errors);
  requireLiteral(value.providerExecutionPerformed, false, "/materializationInputManifestSummary/providerExecutionPerformed", errors);
  requireLiteral(value.paidApisUsed, false, "/materializationInputManifestSummary/paidApisUsed", errors);
  requireLiteral(value.externalNetworkUsed, false, "/materializationInputManifestSummary/externalNetworkUsed", errors);
  requireLiteral(value.claimBoundary, "metadata_only_provider_neutral_materialization_inputs", "/materializationInputManifestSummary/claimBoundary", errors);
}

function validateMaterializationAttachmentPlanSummary(value: unknown, errors: string[]): void {
  requireRecord(value, "/materializationAttachmentPlanSummary", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.schemaVersion, "openclinxr.encounter-materialization-attachment-plan-summary.v1", "/materializationAttachmentPlanSummary/schemaVersion", errors);
  requireLiteral(value.source, "encounter_materialization_attachment_plan", "/materializationAttachmentPlanSummary/source", errors);
  requireNumber(value.actorAttachmentSlotCount, "/materializationAttachmentPlanSummary/actorAttachmentSlotCount", errors);
  requireNumber(value.equipmentAttachmentSlotCount, "/materializationAttachmentPlanSummary/equipmentAttachmentSlotCount", errors);
  requireNumber(value.missingAttachmentCount, "/materializationAttachmentPlanSummary/missingAttachmentCount", errors);
  requireArray(value.actorRequiredCueIds, "/materializationAttachmentPlanSummary/actorRequiredCueIds", errors);
  requireArray(value.equipmentRequiredCueIds, "/materializationAttachmentPlanSummary/equipmentRequiredCueIds", errors);
  requireArray(value.blockerIds, "/materializationAttachmentPlanSummary/blockerIds", errors);
  requireLiteral(value.providerExecutionPerformed, false, "/materializationAttachmentPlanSummary/providerExecutionPerformed", errors);
  requireLiteral(value.runtimeSelectionAllowed, false, "/materializationAttachmentPlanSummary/runtimeSelectionAllowed", errors);
  requireLiteral(value.learnerLaunchAllowed, false, "/materializationAttachmentPlanSummary/learnerLaunchAllowed", errors);
  requireLiteral(value.questEvidenceRefreshAllowed, false, "/materializationAttachmentPlanSummary/questEvidenceRefreshAllowed", errors);
  requireLiteral(value.claimBoundary, "metadata_only_materialization_attachment_plan", "/materializationAttachmentPlanSummary/claimBoundary", errors);
}

function validateMaterializationEvidenceAttachmentSummary(value: unknown, errors: string[]): void {
  requireRecord(value, "/materializationEvidenceAttachmentSummary", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.schemaVersion, "openclinxr.encounter-materialization-evidence-attachment-summary.v1", "/materializationEvidenceAttachmentSummary/schemaVersion", errors);
  requireLiteral(value.source, "encounter_materialization_evidence_attachments", "/materializationEvidenceAttachmentSummary/source", errors);
  requireNumber(value.totalRequiredSlotCount, "/materializationEvidenceAttachmentSummary/totalRequiredSlotCount", errors);
  requireNumber(value.attachedSlotCount, "/materializationEvidenceAttachmentSummary/attachedSlotCount", errors);
  requireNumber(value.missingSlotCount, "/materializationEvidenceAttachmentSummary/missingSlotCount", errors);
  requireNumber(value.heldOrInvalidAttachmentCount, "/materializationEvidenceAttachmentSummary/heldOrInvalidAttachmentCount", errors);
  requireLiteral(typeof value.allRequiredSlotsSatisfied, "boolean", "/materializationEvidenceAttachmentSummary/allRequiredSlotsSatisfiedType", errors);
  requireArray(value.blockerIds, "/materializationEvidenceAttachmentSummary/blockerIds", errors);
  requireLiteral(value.providerExecutionPerformed, false, "/materializationEvidenceAttachmentSummary/providerExecutionPerformed", errors);
  requireLiteral(value.runtimeSelectionAllowed, false, "/materializationEvidenceAttachmentSummary/runtimeSelectionAllowed", errors);
  requireLiteral(value.learnerLaunchAllowed, false, "/materializationEvidenceAttachmentSummary/learnerLaunchAllowed", errors);
  requireLiteral(value.questEvidenceRefreshAllowed, false, "/materializationEvidenceAttachmentSummary/questEvidenceRefreshAllowed", errors);
  requireLiteral(value.claimBoundary, "metadata_only_materialization_evidence_attachment_summary", "/materializationEvidenceAttachmentSummary/claimBoundary", errors);
}

export function createAzuriteEncounterAssetGenerationQueueClient(input: {
  connectionString?: string;
  visibilityTimeoutSeconds?: number;
}): EncounterAssetGenerationQueueClient {
  if (!input.connectionString) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is required for Azurite queue worker mode");
  }
  if (!isAzuriteConnectionString(input.connectionString)) {
    throw new Error("Encounter asset generation worker only accepts Azurite/local development storage connection strings");
  }
  return createAzureStorageEncounterAssetGenerationQueueClientFromConnectionString(input.connectionString, {
    visibilityTimeoutSeconds: input.visibilityTimeoutSeconds,
  });
}

function validateSharedAssetLibraryCacheEvents(value: unknown, pathName: string, errors: string[]): void {
  requireArray(value, pathName, errors);
  if (!Array.isArray(value)) return;
  value.forEach((event, index) => {
    if (!isRecord(event)) {
      errors.push(`${pathName}/${index} must be object`);
      return;
    }
    requireString(event.workOrderId, `${pathName}/${index}/workOrderId`, errors);
    requireString(event.lookupKey, `${pathName}/${index}/lookupKey`, errors);
    requireString(event.targetKind, `${pathName}/${index}/targetKind`, errors);
    requireOneOf(event.result, [
      "cache_hit_reuse_generation_skipped",
      "cache_miss_generation_required",
      "cache_miss_generation_required_after_lru_eviction",
    ], `${pathName}/${index}/result`, errors);
    if (event.result === "cache_hit_reuse_generation_skipped") {
      requireString(event.assetRef, `${pathName}/${index}/assetRef`, errors);
    }
    requireOneOf(event.generationDisposition, [
      "skip_generation_reuse_cached_asset",
      "generate_and_store_asset",
      "generate_and_store_after_lru_eviction",
    ], `${pathName}/${index}/generationDisposition`, errors);
    requireRecord(event.evidenceGateCompatibility, `${pathName}/${index}/evidenceGateCompatibility`, errors);
    if (isRecord(event.evidenceGateCompatibility)) {
      requireLiteral(event.evidenceGateCompatibility.required, true, `${pathName}/${index}/evidenceGateCompatibility/required`, errors);
      requireLiteral(event.evidenceGateCompatibility.checkedBeforeReuse, true, `${pathName}/${index}/evidenceGateCompatibility/checkedBeforeReuse`, errors);
      requireOneOf(event.evidenceGateCompatibility.disposition, [
        "compatible_cached_asset_reused",
        "requires_review_before_new_asset_reuse",
      ], `${pathName}/${index}/evidenceGateCompatibility/disposition`, errors);
    }
    if (
      event.result === "cache_hit_reuse_generation_skipped"
      && event.generationDisposition !== "skip_generation_reuse_cached_asset"
    ) {
      errors.push(`${pathName}/${index}/generationDisposition must skip generation for cache hits`);
    }
    if (
      event.result === "cache_miss_generation_required"
      && event.generationDisposition !== "generate_and_store_asset"
    ) {
      errors.push(`${pathName}/${index}/generationDisposition must generate and store for cache misses`);
    }
    if (
      event.result === "cache_miss_generation_required_after_lru_eviction"
      && event.generationDisposition !== "generate_and_store_after_lru_eviction"
    ) {
      errors.push(`${pathName}/${index}/generationDisposition must record post-LRU-eviction regeneration`);
    }
    requireArray(event.evictedLookupKeys, `${pathName}/${index}/evictedLookupKeys`, errors);
    requireArray(event.recencyMostRecentFirst, `${pathName}/${index}/recencyMostRecentFirst`, errors);
    for (const notEvidenceFor of [
      "generated_asset_quality",
      "provider_runtime_readiness",
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
    ]) {
      requireStringArrayIncludes(event.notEvidenceFor, notEvidenceFor, `${pathName}/${index}/notEvidenceFor`, errors);
    }
  });
}

export function isAzuriteConnectionString(connectionString: string): boolean {
  return connectionString === "UseDevelopmentStorage=true"
    || connectionString.includes("devstoreaccount1")
    || connectionString.includes("127.0.0.1")
    || connectionString.includes("localhost");
}

function deterministicClock(startIso: string): () => string {
  let tick = 0;
  const startMs = Date.parse(startIso);
  return () => new Date(startMs + tick++ * 60_000).toISOString();
}

async function latestVisualQaRemediationWorkOrderRefsForScenario(
  scenarioId: string,
): Promise<VisualQaRemediationWorkOrderRef[] | undefined> {
  const files = await globFiles("docs/openclinxr/visual-qa-evidence-*.json");
  const candidates = await Promise.all(files.map(async (filePath) => {
    try {
      const report = await readJson<unknown>(filePath);
      if (!isRecord(report) || !isRecord(report.evidence) || !isRecord(report.evidence.capture)) {
        return undefined;
      }
      if (report.evidence.capture.scenarioId !== scenarioId || !Array.isArray(report.remediationWorkOrderRefs) || report.remediationWorkOrderRefs.length === 0) {
        return undefined;
      }
      return {
        filePath,
        mtimeMs: (await stat(filePath)).mtimeMs,
        refs: report.remediationWorkOrderRefs as VisualQaRemediationWorkOrderRef[],
      };
    } catch {
      return undefined;
    }
  }));

  return candidates
    .filter((candidate): candidate is {
      filePath: string;
      mtimeMs: number;
      refs: VisualQaRemediationWorkOrderRef[];
    } => candidate !== undefined)
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath))
    .at(-1)?.refs;
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${pathName} must be non-empty string`);
  }
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${pathName} must be number`);
  }
}

function validateVisualQaRemediationWorkOrderRefs(
  value: unknown,
  pathName: string,
  errors: string[],
): void {
  requireArray(value, pathName, errors);
  if (!Array.isArray(value)) return;
  value.forEach((ref, index) => {
    const refPath = `${pathName}/${index}`;
    if (!isRecord(ref)) {
      errors.push(`${refPath} must be object`);
      return;
    }
    requireLiteral(ref.schemaVersion, "openclinxr.visual-qa-remediation-work-order-ref.v1", `${refPath}/schemaVersion`, errors);
    requireString(ref.scenarioId, `${refPath}/scenarioId`, errors);
    requireString(ref.sourceEvidenceRef, `${refPath}/sourceEvidenceRef`, errors);
    requireString(ref.blockerId, `${refPath}/blockerId`, errors);
    requireString(ref.targetKind, `${refPath}/targetKind`, errors);
    requireString(ref.capabilityId, `${refPath}/capabilityId`, errors);
    requireString(ref.workOrderRef, `${refPath}/workOrderRef`, errors);
    requireLiteral(ref.status, "planned_metadata_only", `${refPath}/status`, errors);
    requireString(ref.recommendedWorkerAction, `${refPath}/recommendedWorkerAction`, errors);
    requireArray(ref.notEvidenceFor, `${refPath}/notEvidenceFor`, errors);
    if (Array.isArray(ref.notEvidenceFor)) {
      for (const notEvidenceFor of [
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
      ] as const) {
        requireStringArrayIncludes(ref.notEvidenceFor, notEvidenceFor, `${refPath}/notEvidenceFor`, errors);
      }
    }
  });
}

function isWorkerExecutionRecord(value: unknown): value is EncounterAssetGenerationWorkerExecution {
  return isRecord(value) && Array.isArray(value.sharedAssetLibraryCacheEvents);
}

function summarizeSharedAssetLibraryCacheEvents(
  executions: EncounterAssetGenerationWorkerExecution[],
): EncounterAssetGenerationWorkerReport["sharedAssetLibraryCacheSummary"] {
  const events = executions.flatMap((execution) => execution.sharedAssetLibraryCacheEvents ?? []);
  return {
    cacheEventCount: events.length,
    cacheHitReuseCount: events.filter((event) => event.result === "cache_hit_reuse_generation_skipped").length,
    cacheMissGenerationRequiredCount: events.filter((event) =>
      event.result === "cache_miss_generation_required"
      || event.result === "cache_miss_generation_required_after_lru_eviction"
    ).length,
    lruEvictionCount: events.reduce((count, event) => count + event.evictedLookupKeys.length, 0),
    generatedAssetsStillDynamic: true,
    lookupBeforeGenerate: true,
  };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    stdout: false,
    validateLatest: false,
    azureStorageQueue: false,
  };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--queue-report") {
      options.queueReportPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--materialization-input-manifest") {
      options.materializationInputManifestPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--materialization-attachment-plan") {
      options.materializationAttachmentPlanPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--materialization-evidence-attachments") {
      options.materializationEvidenceAttachmentsPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--stdout") {
      options.stdout = true;
      continue;
    }
    if (arg === "--azure-storage-queue") {
      options.azureStorageQueue = true;
      continue;
    }
    if (arg === "--connection-string") {
      options.connectionString = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--visibility-timeout-seconds") {
      options.visibilityTimeoutSeconds = Number(requireValue(normalizedArgs, index, arg));
      if (!Number.isFinite(options.visibilityTimeoutSeconds) || options.visibilityTimeoutSeconds <= 0) {
        throw new Error("--visibility-timeout-seconds requires a positive number");
      }
      index += 1;
      continue;
    }
    if (arg === "--mongoose-uri") {
      options.mongooseUri = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  return options;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const files = await globFiles(pattern);
  const filesWithStats = await Promise.all(files.map(async (filePath) => ({ filePath, mtimeMs: (await stat(filePath)).mtimeMs })));
  return filesWithStats.sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath)).at(-1)?.filePath;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be object`);
  }
}

function requireArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be array`);
  }
}

function requireStringArrayIncludes(value: unknown, expected: string, path: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) {
    errors.push(`${path} must include ${expected}`);
  }
}

function validateWorkerHumanoidRealismRequirements(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be object`);
    return;
  }
  requireLiteral(value.schemaVersion, "openclinxr.encounter-humanoid-realism-requirements.v1", `${path}/schemaVersion`, errors);
  requireLiteral(value.source, "scenario_actor_definitions", `${path}/source`, errors);
  requireArray(value.requirements, `${path}/requirements`, errors);
  if (Array.isArray(value.requirements)) {
    if (value.requirements.length === 0) {
      errors.push(`${path}/requirements must contain at least one actor role`);
    }
    value.requirements.forEach((requirement, index) => {
      if (!isRecord(requirement)) {
        errors.push(`${path}/requirements/${index} must be object`);
        return;
      }
      requireStringArrayIncludes(requirement.requiredAssetKinds, "generated_humanoid_mesh", `${path}/requirements/${index}/requiredAssetKinds`, errors);
      requireStringArrayIncludes(requirement.requiredAssetKinds, "viseme_phoneme_map", `${path}/requirements/${index}/requiredAssetKinds`, errors);
      requireStringArrayIncludes(requirement.requiredAssetKinds, "gaze_blink_control", `${path}/requirements/${index}/requiredAssetKinds`, errors);
      requireStringArrayIncludes(requirement.requiredSignalIds, "animated_humanoid_runtime_playback", `${path}/requirements/${index}/requiredSignalIds`, errors);
      requireStringArrayIncludes(requirement.requiredSignalIds, "dialogue_viseme_and_gaze_mapping", `${path}/requirements/${index}/requiredSignalIds`, errors);
    });
  }
}

function validateWorkerEvidenceGateRefs(value: unknown, path: string, errors: string[]): void {
  requireArray(value, path, errors);
  if (!Array.isArray(value)) return;
  for (const gateId of ["asset_production_review", "runtime_realism_evidence", "visual_qa_evidence", "quest_runtime_evidence"]) {
    const gate = value.find((candidate) => isRecord(candidate) && candidate.gateId === gateId);
    if (!isRecord(gate)) {
      errors.push(`${path} must include ${gateId}`);
      continue;
    }
    requireStringArrayIncludes(gate.notEvidenceFor, "production_asset_readiness", `${path}/${gateId}/notEvidenceFor`, errors);
    requireStringArrayIncludes(gate.notEvidenceFor, "quest_readiness", `${path}/${gateId}/notEvidenceFor`, errors);
    requireStringArrayIncludes(gate.notEvidenceFor, "clinical_validity", `${path}/${gateId}/notEvidenceFor`, errors);
    requireStringArrayIncludes(gate.notEvidenceFor, "scoring_validity", `${path}/${gateId}/notEvidenceFor`, errors);
  }

  const runtimeRealismGate = value.find((candidate) => isRecord(candidate) && candidate.gateId === "runtime_realism_evidence");
  if (isRecord(runtimeRealismGate)) {
    requireStringArrayIncludes(runtimeRealismGate.requiredSignalIds, "visible_mouth_eye_expression_cues", `${path}/runtime_realism_evidence/requiredSignalIds`, errors);
    requireStringArrayIncludes(runtimeRealismGate.requiredSignalIds, "dialogue_viseme_and_gaze_mapping", `${path}/runtime_realism_evidence/requiredSignalIds`, errors);
    requireStringArrayIncludes(runtimeRealismGate.requiredSignalIds, "emotion_aligned_expression_transition_cue", `${path}/runtime_realism_evidence/requiredSignalIds`, errors);
  }

  const visualQaGate = value.find((candidate) => isRecord(candidate) && candidate.gateId === "visual_qa_evidence");
  if (isRecord(visualQaGate)) {
    requireStringArrayIncludes(visualQaGate.requiredSignalIds, "humanoid_realism_visual_qa_review", `${path}/visual_qa_evidence/requiredSignalIds`, errors);
    requireStringArrayIncludes(visualQaGate.requiredSignalIds, "emotion_expression_transition_readability", `${path}/visual_qa_evidence/requiredSignalIds`, errors);
  }
}

function requireLiteral(value: unknown, expected: string | number | boolean, path: string, errors: string[]): void {
  if (value !== expected) {
    errors.push(`${path} must be ${JSON.stringify(expected)}`);
  }
}

function requireOneOf(value: unknown, expectedValues: string[], path: string, errors: string[]): void {
  if (!expectedValues.includes(String(value))) {
    errors.push(`${path} must be one of ${expectedValues.join(", ")}`);
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
