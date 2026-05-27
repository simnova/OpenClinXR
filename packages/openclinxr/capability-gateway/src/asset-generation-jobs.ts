import type {
  CapabilityTransport,
  ImplementationLanguage,
  ProviderKind,
  RuntimeProfile,
} from "./index.js";

export type AssetGenerationCapabilityId =
  | "character-generation"
  | "medical-equipment-generation"
  | "voice-asset-generation"
  | "animation-generation"
  | "asset-bake";

export type EncounterAssetGenerationPipelineStage =
  | "encounter-definition-ingested"
  | "character-generation"
  | "medical-equipment-generation"
  | "environment-generation"
  | "animation-generation"
  | "voice-asset-generation"
  | "asset-bake"
  | "scene-manifest-freeze"
  | "runtime-bundle-publication"
  | "review-evidence-gate";

export type AssetGenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type AssetGenerationArtifactKind = "manifest" | "source" | "mesh" | "texture" | "preview" | "log";

export type AssetGenerationArtifact = {
  kind: AssetGenerationArtifactKind;
  path: string;
  mediaType: string;
};

export type AssetGenerationManifest = {
  schemaVersion: "asset-generation-manifest.v1";
  capabilityId: AssetGenerationCapabilityId;
  outputs?: string[];
  [key: string]: unknown;
};

export type AssetGenerationProvenance = {
  generator?: string;
  license: string;
  spendCents: number;
  externalNetworkUsed: boolean;
  [key: string]: unknown;
};

export type AssetGenerationRuntimePolicy = {
  providerKind: ProviderKind;
  implementationLanguage: ImplementationLanguage;
  transport: CapabilityTransport;
  executable?: string;
  args?: string[];
  environment?: Record<string, string>;
};

export type AssetGenerationJobPolicy = {
  timeoutMs: number;
  sandboxWorkdir: string;
  requireArtifactManifest: boolean;
  requireLicenseProvenance: boolean;
  allowExternalNetwork: boolean;
  spendLimitCents: number;
  runtime: AssetGenerationRuntimePolicy;
};

export type AssetGenerationJobPolicyInput = Partial<Omit<AssetGenerationJobPolicy, "runtime">> & {
  runtime?: Partial<AssetGenerationRuntimePolicy>;
};

export type AssetGenerationJobRequest<TPayload = unknown> = {
  profile: RuntimeProfile;
  capabilityId: AssetGenerationCapabilityId;
  payload: TPayload;
  policy?: AssetGenerationJobPolicyInput;
};

export type EncounterExecutableAssetGenerationRequest = {
  requestId: string;
  tenantId: string;
  examRunId: string;
  encounterId: string;
  scenarioId: string;
  stationId: string;
  encounterDefinitionRef: {
    storeKind: "mongoose" | "mongodb" | "blob" | "inline";
    collectionName?: string;
    documentId?: string;
    blobName?: string;
    contentHash?: string;
  };
  encounterFactoryInputSummary?: EncounterFactoryInputSummary;
  targetAssetStore: {
    storeKind: "azurite_blob" | "azure_blob";
    containerName: string;
    blobPrefix: string;
  };
  persistenceTarget: {
    storeKind: "mongoose" | "mongodb";
    collectionName: "encounter_asset_generation_jobs";
  };
  requestedStages: EncounterAssetGenerationPipelineStage[];
  humanoidRealismRequirements?: EncounterHumanoidRealismRequirements;
  optimizationWindow: {
    expectedMinimumHours: number;
    expectedMaximumHours: number;
    mayRunForDays: boolean;
    checkpointIntervalMinutes: number;
  };
  evidenceGates: {
    requireGeneratedSceneManifest: true;
    requireRuntimeBundlePublication: true;
    requireHumanReviewBeforeLearnerUse: true;
    requireQuestEvidenceBeforeQuestReadinessClaim: true;
  };
  policy: {
    allowPaidCloudApis: false;
    allowProductionDeployment: false;
    productionReadinessClaimed: false;
  };
};

export type EncounterFactoryInputSummary = {
  source: "scenario_definition_and_dialogue_seed_bank";
  scenarioBankOrder?: number;
  factorySelectionRole?: "anchor" | "next_factory_planning_scenario" | "candidate";
  factorySelectionMode?: "approved_encounter_variant" | "next_scenario_fallback" | "anchor_not_found";
  factorySelectionClaimBoundary?: "review_gated_factory_metadata_only";
  actorAssetWorkOrderCount: number;
  environmentAssetWorkOrderCount: number;
  equipmentAssetWorkOrderCount: number;
  sharedAssetLookupKeys: string[];
  requiredTraceTags?: string[];
  dynamicBehaviorTraceTags: string[];
  humanoidPerformanceContract?: {
    claimBoundary: "case_definition_humanoid_performance_metadata_only";
    actorCount: number;
    locomotionActorRoles: string[];
    expressionActorRoles: string[];
    gazeActorRoles: string[];
    lipSyncActorRoles: string[];
    interactiveActorRoles: string[];
    emotionStateCount: number;
    dialogueDrivenVisemeMappingRequired: boolean;
    gazeTargetingRequired: boolean;
    locomotionPlanningRequired: boolean;
    notEvidenceFor: Array<"generated_humanoid_asset_readiness" | "animation_quality" | "quest_readiness" | "runtime_readiness" | "clinical_validity">;
  };
};

export type EncounterHumanoidRealismRequirement = {
  actorRole: string;
  requiredAssetKinds: Array<
    | "generated_humanoid_mesh"
    | "skin_material_or_morph_targets"
    | "clinical_idle_animation"
    | "conversation_animation"
    | "viseme_phoneme_map"
    | "gaze_blink_control"
    | "role_appropriate_clothing"
  >;
  requiredSignalIds: string[];
  realismProfile?: EncounterHumanoidRealismProfile;
};

export type EncounterHumanoidRealismProfile = {
  ageBand: "adult" | "child_or_adolescent" | "contextual_adult";
  bodyPostureNotes: string[];
  clothingClinicalContextCues: string[];
  expressionAffectCues: string[];
  mobilityPositioningConstraints: string[];
  requiredRealismEvidenceIds: string[];
  claimScope: "metadata_only_not_visual_quality_evidence";
};

export type EncounterHumanoidRealismRequirements = {
  schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1";
  source: "scenario_actor_definitions";
  requirements: EncounterHumanoidRealismRequirement[];
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterGenerationWorkOrderTargetKind =
  | "role_specific_humanoid_glb"
  | "medical_equipment_glb"
  | "role_idle_animation_glb"
  | "facial_lipsync_gaze_animation"
  | "visual_feedback_closure";

export type EncounterGenerationProviderRoute =
  | "deterministic-mock"
  | "local-runtime-planned"
  | "open-source-local-model-planned"
  | "cloud-approved-planned";

export type EncounterGenerationProviderRoutingPreference =
  | "meshy_cloud_requires_approval"
  | "hunyuan3d_local"
  | "blender_mixamo_style_rigging_fallback"
  | "tripo_cloud_requires_approval"
  | "local_open_vlm_if_available"
  | "frontier_cloud_vlm_requires_approval"
  | "deterministic_fixture";

export type EncounterGenerationModelProviderPolicy = {
  executionStatus: "metadata_only_not_executed";
  allowPaidCloudApis: false;
  allowExternalNetwork: false;
  secretsRequired: false;
  providerRoutesRequireExplicitApproval: true;
};

export type EncounterSharedAssetLibraryReusePolicy = {
  lookupKey: string;
  lookupKeySource: "encounter_definition_semantic_requirements";
  sharedLibraryRefs: {
    blobPrefix: string;
    mongooseCollectionName: "shared_encounter_asset_library";
  };
  lruCache: {
    enabled: true;
    maxEntries: number;
    evictionPolicy: "least_recently_used";
    reuseRequiresEvidenceGateCompatibility: true;
    updateRecencyOnHit: true;
  };
  cacheDisposition: "lookup_before_generate";
};

export type EncounterHumanoidRemediationDimension =
  | "gaze"
  | "mouth_viseme"
  | "pose"
  | "posture_collision"
  | "clothing"
  | "shared_asset_reuse";

export type EncounterProviderDisabledRemediationPlanningMetadata = {
  schemaVersion: "openclinxr.provider-disabled-remediation-planning-metadata.v1";
  dimension: EncounterHumanoidRemediationDimension;
  actorRole?: string;
  sharedAssetLookupKey: string;
  sourceBlockerRefs: string[];
  requiredSignalRefs: string[];
  providerExecutionBoundary: EncounterGenerationModelProviderPolicy & {
    disabledReason: "operator_approval_or_runtime_evidence_required_before_provider_execution";
  };
  acceptanceCriteria: string[];
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterGenerationWorkOrder = {
  workOrderId: string;
  scenarioId: string;
  encounterId: string;
  targetKind: EncounterGenerationWorkOrderTargetKind;
  capabilityId: AssetGenerationCapabilityId;
  providerRoute: EncounterGenerationProviderRoute;
  providerRoutingPreference: EncounterGenerationProviderRoutingPreference[];
  modelProviderPolicy: EncounterGenerationModelProviderPolicy;
  sharedAssetLibraryReuse: EncounterSharedAssetLibraryReusePolicy;
  actorRole?: string;
  caseDefinedHumanoidPerformanceRequirements?: {
    claimBoundary: "case_definition_humanoid_performance_metadata_only";
    actorRole: string;
    locomotionRequired: boolean;
    expressionRequired: boolean;
    gazeRequired: boolean;
    lipSyncRequired: boolean;
    interactiveRequired: boolean;
    dialogueDrivenVisemeMappingRequired: boolean;
    gazeTargetingRequired: boolean;
    locomotionPlanningRequired: boolean;
    notEvidenceFor: Array<"generated_humanoid_asset_readiness" | "animation_quality" | "quest_readiness" | "runtime_readiness" | "clinical_validity">;
  };
  inputRefs: string[];
  outputRefs: string[];
  evidenceGateRefs: EncounterAssetGenerationEvidenceGateRef["gateId"][];
  visualQaBlockerRefs: string[];
  acceptanceCriteria: string[];
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterWorkerMaterializationPlanOutput = {
  workOrderId: string;
  targetKind: EncounterGenerationWorkOrderTargetKind;
  artifactPath: string;
  outputRefs: string[];
  generatedAssetsMaterialized: false;
  paidApisUsed: false;
  productionReadinessClaimed: false;
  claimBoundary: "planned_metadata_only";
};

export type EncounterWorkerMaterializationPlan = {
  schemaVersion: "openclinxr.worker-materialization-plan.v1";
  requestId: string;
  scenarioId: string;
  encounterId: string;
  rootPath: string;
  outputs: EncounterWorkerMaterializationPlanOutput[];
  generatedAssetsMaterialized: false;
  paidApisUsed: false;
  productionReadinessClaimed: false;
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
  claimBoundary: "planned_metadata_only";
};

export type VisualQaRemediationLoopReadinessInput = {
  category: string;
  blockerIds: string[];
  remediationDimension?: EncounterHumanoidRemediationDimension;
  actorRole?: string;
  requiredSignalRefs?: string[];
  targetKinds: EncounterGenerationWorkOrderTargetKind[];
  capabilityIds: AssetGenerationCapabilityId[];
  workOrderRefs: string[];
  recommendedWorkerActions: string[];
};

export type VisualQaRemediationWorkOrderPlan = {
  schemaVersion: "openclinxr.visual-qa-remediation-work-order-plan.v1";
  scenarioId: string;
  sourceEvidenceRef: string;
  category: string;
  blockerIds: string[];
  recommendedWorkerActions: string[];
  temporalEvidenceBoundary: "metadata_only_not_quest_or_production_claims";
  providerDisabledPlanningMetadata: EncounterProviderDisabledRemediationPlanningMetadata;
  workOrder: EncounterGenerationWorkOrder;
};

export type AzureStorageQueueEncounterAssetMessage = {
  schemaVersion: "openclinxr.azure-storage-queue.encounter-asset-generation.v1";
  queueName: "encounter-asset-generation";
  messageKind: "encounter_definition_to_executable_encounter";
  visibilityTimeoutSeconds: number;
  timeToLiveSeconds: number;
  dequeueAttemptLimit: number;
  request: EncounterExecutableAssetGenerationRequest;
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterAssetGenerationPlan = {
  schemaVersion: "openclinxr.encounter-asset-generation-plan.v1";
  requestId: string;
  queueName: AzureStorageQueueEncounterAssetMessage["queueName"];
  stages: Array<{
    stage: EncounterAssetGenerationPipelineStage;
    capabilityId?: AssetGenerationCapabilityId;
    queueMessageRequired: boolean;
    durableCheckpointRequired: boolean;
    outputTarget: "blob" | "mongoose" | "blob_and_mongoose";
  }>;
  expectedDuration: {
    minimumHours: number;
    maximumHours: number;
    mayRunForDays: boolean;
  };
  executableEncounterReadyOnlyAfter: string[];
  humanoidRealismRequirements?: EncounterHumanoidRealismRequirements;
  generationWorkOrders: EncounterGenerationWorkOrder[];
  productionReadinessClaimed: false;
};

export type EncounterAssetGenerationWorkerCheckpoint = {
  stage: EncounterAssetGenerationPipelineStage;
  status: "running" | "succeeded" | "failed" | "review_blocked";
  at: string;
  artifactRefs: string[];
  message?: string;
};

export type EncounterAssetGenerationStageOperationalNote = {
  stage: EncounterAssetGenerationPipelineStage;
  transitions: Array<"queued_to_running" | "running_to_succeeded" | "running_to_failed" | "running_to_review_blocked">;
  retryCheckpoint: "before_stage_dispatch" | "after_stage_success" | "after_stage_failure" | "after_review_blocked";
  retryable: boolean;
  note: string;
};

export type EncounterSharedAssetLibraryOperationalNote = {
  workOrderId: string;
  lookupKey: string;
  targetKind: EncounterGenerationWorkOrderTargetKind;
  result: EncounterSharedAssetLibraryCacheEvent["result"];
  retryCheckpoint: "reuse_cached_asset" | "regenerate_shared_asset" | "regenerate_after_lru_eviction";
  retryable: boolean;
  note: string;
};

export type EncounterAssetGenerationOperationalNotes = {
  stageNotes: EncounterAssetGenerationStageOperationalNote[];
  sharedLibraryNotes: EncounterSharedAssetLibraryOperationalNote[];
};

export type EncounterAssetGenerationStageHandlerInput = {
  stage: EncounterAssetGenerationPipelineStage;
  request: EncounterExecutableAssetGenerationRequest;
  outputTarget: EncounterAssetGenerationPlan["stages"][number]["outputTarget"];
};

export type EncounterAssetGenerationStageHandlerResult = {
  status?: "succeeded" | "failed" | "review_blocked";
  artifactRefs?: string[];
  message?: string;
  generatedSceneManifestBlobName?: string;
  learnerRuntimeBundleId?: string;
};

export type EncounterAssetGenerationStageHandler = (
  input: EncounterAssetGenerationStageHandlerInput,
) => Promise<EncounterAssetGenerationStageHandlerResult> | EncounterAssetGenerationStageHandlerResult;

export type EncounterAssetGenerationWorkerExecution = {
  schemaVersion: "openclinxr.encounter-asset-generation-worker-execution.v1";
  requestId: string;
  queueName: AzureStorageQueueEncounterAssetMessage["queueName"];
  status: "succeeded" | "failed" | "review_blocked";
  plan: EncounterAssetGenerationPlan;
  sharedAssetLibraryCacheEvents: EncounterSharedAssetLibraryCacheEvent[];
  checkpoints: EncounterAssetGenerationWorkerCheckpoint[];
  operationalNotes: EncounterAssetGenerationOperationalNotes;
  workerMaterializationPlan: EncounterWorkerMaterializationPlan;
  evidenceGateRefs: EncounterAssetGenerationEvidenceGateRef[];
  generatedSceneManifestBlobName?: string;
  learnerRuntimeBundleId?: string;
  productionReadinessClaimed: false;
};

export type EncounterSharedAssetLibraryEntry = {
  lookupKey: string;
  assetRef: string;
  evidenceGateRefs: EncounterAssetGenerationEvidenceGateRef["gateId"][];
  lastUsedAt: string;
};

export type EncounterSharedAssetLibraryCacheEvent = {
  workOrderId: string;
  lookupKey: string;
  targetKind: EncounterGenerationWorkOrderTargetKind;
  result: "cache_hit_reuse_generation_skipped" | "cache_miss_generation_required" | "cache_miss_generation_required_after_lru_eviction";
  generationDisposition: "skip_generation_reuse_cached_asset" | "generate_and_store_asset" | "generate_and_store_after_lru_eviction";
  evidenceGateCompatibility: {
    required: true;
    checkedBeforeReuse: true;
    disposition: "compatible_cached_asset_reused" | "requires_review_before_new_asset_reuse";
  };
  assetRef?: string;
  evictedLookupKeys: string[];
  recencyMostRecentFirst: string[];
  notEvidenceFor: Array<"generated_asset_quality" | "provider_runtime_readiness" | "production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterAssetGenerationEvidenceGateRef = {
  gateId: "asset_production_review" | "runtime_realism_evidence" | "visual_qa_evidence" | "quest_runtime_evidence";
  status: "pending" | "attached" | "blocked";
  evidenceRefs: string[];
  requiredSignalIds: string[];
  blockers: string[];
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterAssetGenerationPublicationTargets = {
  generatedSceneManifestBlobName: string;
  learnerRuntimeBundleBlobName: string;
  learnerRuntimeBundleId: string;
  learnerRuntimeBundleMongoCollection: "learner_runtime_asset_bundles";
  jobStateMongoCollection: "encounter_asset_generation_jobs";
};

export type EncounterAssetGenerationQueueMessageEnvelope = {
  messageId: string;
  popReceipt: string;
  messageText: string;
  dequeueCount?: number;
};

export interface EncounterAssetGenerationQueueClient {
  receiveEncounterAssetGenerationMessage(): Promise<EncounterAssetGenerationQueueMessageEnvelope | undefined>;
  deleteEncounterAssetGenerationMessage(messageId: string, popReceipt: string): Promise<void>;
}

export type EncounterAssetGenerationQueueProcessingResult =
  | {
      status: "idle";
      messageReceived: false;
    }
  | {
      status: "processed";
      messageReceived: true;
      messageDeleted: boolean;
      envelope: EncounterAssetGenerationQueueMessageEnvelope;
      execution: EncounterAssetGenerationWorkerExecution;
    }
  | {
      status: "failed_before_delete";
      messageReceived: true;
      messageDeleted: false;
      envelope: EncounterAssetGenerationQueueMessageEnvelope;
      error: string;
    };

export type AssetGenerationJobHistoryEvent = {
  status: AssetGenerationJobStatus;
  at: string;
  message?: string;
};

export type AssetGenerationWorkerDescriptor = {
  providerId: string;
  providerKind: ProviderKind;
  implementationLanguage: ImplementationLanguage;
  transport: CapabilityTransport;
};

export type AssetGenerationJobError = {
  message: string;
};

export type AssetGenerationJobRecord<TPayload = unknown> = {
  id: string;
  request: AssetGenerationJobRequest<TPayload>;
  status: AssetGenerationJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  policy: AssetGenerationJobPolicy;
  worker: AssetGenerationWorkerDescriptor;
  artifacts: AssetGenerationArtifact[];
  manifest?: AssetGenerationManifest;
  provenance?: AssetGenerationProvenance;
  error?: AssetGenerationJobError;
  history: AssetGenerationJobHistoryEvent[];
};

export type AssetGenerationWorkerResult = {
  artifacts: AssetGenerationArtifact[];
  manifest: AssetGenerationManifest;
  provenance: AssetGenerationProvenance;
};

export type CommandRunnerInvocation = {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env: Record<string, string>;
  input?: string;
};

export type CommandRunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export interface CommandRunner {
  run(invocation: CommandRunnerInvocation): Promise<CommandRunnerResult>;
}

export type AssetGenerationWorkerContext = {
  jobId: string;
  commandRunner: CommandRunner;
};

export interface AssetGenerationWorkerAdapter {
  readonly capabilityId: AssetGenerationCapabilityId;
  readonly providerId: string;
  readonly providerKind: ProviderKind;
  readonly implementationLanguage: ImplementationLanguage;
  readonly transport: CapabilityTransport;
  run(
    request: AssetGenerationJobRequest,
    policy: AssetGenerationJobPolicy,
    context: AssetGenerationWorkerContext,
  ): Promise<AssetGenerationWorkerResult>;
}

export interface AssetGenerationJobStore {
  save<TPayload>(record: AssetGenerationJobRecord<TPayload>): Promise<AssetGenerationJobRecord<TPayload>>;
  get(id: string): Promise<AssetGenerationJobRecord | undefined>;
  list(): Promise<AssetGenerationJobRecord[]>;
}

export type AssetGenerationCapabilityFacadeOptions = {
  adapters?: AssetGenerationWorkerAdapter[];
  store?: AssetGenerationJobStore;
  commandRunner?: CommandRunner;
  idFactory?: () => string;
  now?: () => string;
};

const defaultSandboxWorkdir = ".openclinxr/asset-generation";
const defaultTimeoutMs = 120_000;

const defaultRuntime: AssetGenerationRuntimePolicy = {
  providerKind: "deterministic-mock",
  implementationLanguage: "typescript",
  transport: "in-process",
};

export class InMemoryAssetGenerationJobStore implements AssetGenerationJobStore {
  private readonly records = new Map<string, AssetGenerationJobRecord>();

  async save<TPayload>(record: AssetGenerationJobRecord<TPayload>): Promise<AssetGenerationJobRecord<TPayload>> {
    const storedRecord = cloneAssetGenerationJobRecord(record);
    this.records.set(record.id, storedRecord as AssetGenerationJobRecord);
    return cloneAssetGenerationJobRecord(storedRecord);
  }

  async get(id: string): Promise<AssetGenerationJobRecord | undefined> {
    const record = this.records.get(id);
    return record ? cloneAssetGenerationJobRecord(record) : undefined;
  }

  async list(): Promise<AssetGenerationJobRecord[]> {
    return [...this.records.values()].map((record) => cloneAssetGenerationJobRecord(record));
  }
}

export class AssetGenerationCapabilityFacade {
  private readonly adapters: AssetGenerationWorkerAdapter[];
  private readonly store: AssetGenerationJobStore;
  private readonly commandRunner: CommandRunner;
  private readonly idFactory: () => string;
  private readonly now: () => string;

  constructor(options: AssetGenerationCapabilityFacadeOptions = {}) {
    this.adapters = options.adapters ?? [
      createDeterministicAssetGenerationAdapter("character-generation"),
      createDeterministicAssetGenerationAdapter("medical-equipment-generation"),
      createDeterministicAssetGenerationAdapter("voice-asset-generation"),
      createDeterministicAssetGenerationAdapter("animation-generation"),
      createDeterministicAssetGenerationAdapter("asset-bake"),
    ];
    this.store = options.store ?? new InMemoryAssetGenerationJobStore();
    this.commandRunner = options.commandRunner ?? noNativeWorkerCommandRunner;
    this.idFactory = options.idFactory ?? createDefaultId;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async submit<TPayload>(
    request: AssetGenerationJobRequest<TPayload>,
  ): Promise<AssetGenerationJobRecord<TPayload>> {
    const adapter = this.adapterFor(request.capabilityId);
    const policy = normalizePolicy(request.policy, adapter);
    validatePolicy(policy);
    const id = this.idFactory();
    if (id.trim().length === 0) {
      throw new Error("Asset generation jobs require a job id");
    }
    const createdAt = this.now();
    let record: AssetGenerationJobRecord<TPayload> = {
      id,
      request,
      status: "queued",
      createdAt,
      updatedAt: createdAt,
      policy,
      worker: describeAdapter(adapter),
      artifacts: [],
      history: [{ status: "queued", at: createdAt }],
    };
    await this.store.save(record);

    const startedAt = this.now();
    record = {
      ...record,
      status: "running",
      startedAt,
      updatedAt: startedAt,
      history: [...record.history, { status: "running", at: startedAt }],
    };
    await this.store.save(record);

    try {
      const result = await adapter.run(request, policy, {
        jobId: id,
        commandRunner: this.commandRunner,
      });
      validateWorkerResult(result, policy, request.capabilityId);
      const completedAt = this.now();
      record = {
        ...record,
        status: "succeeded",
        updatedAt: completedAt,
        completedAt,
        artifacts: result.artifacts,
        manifest: result.manifest,
        provenance: result.provenance,
        history: [...record.history, { status: "succeeded", at: completedAt }],
      };
      await this.store.save(record);
      return record;
    } catch (error) {
      const completedAt = this.now();
      record = {
        ...record,
        status: "failed",
        updatedAt: completedAt,
        completedAt,
        error: { message: errorMessage(error) },
        history: [...record.history, { status: "failed", at: completedAt, message: errorMessage(error) }],
      };
      await this.store.save(record);
      return record;
    }
  }

  async get(id: string): Promise<AssetGenerationJobRecord | undefined> {
    return this.store.get(id);
  }

  async list(): Promise<AssetGenerationJobRecord[]> {
    return this.store.list();
  }

  private adapterFor(capabilityId: AssetGenerationCapabilityId): AssetGenerationWorkerAdapter {
    const adapter = this.adapters.find((candidate) => candidate.capabilityId === capabilityId);
    if (!adapter) {
      throw new Error(`No asset generation adapter configured for ${capabilityId}`);
    }
    return adapter;
  }
}

export function createEncounterAssetGenerationQueueMessage(
  request: EncounterExecutableAssetGenerationRequest,
  options: {
    visibilityTimeoutSeconds?: number;
    timeToLiveSeconds?: number;
    dequeueAttemptLimit?: number;
  } = {},
): AzureStorageQueueEncounterAssetMessage {
  validateEncounterAssetGenerationRequest(request);
  return {
    schemaVersion: "openclinxr.azure-storage-queue.encounter-asset-generation.v1",
    queueName: "encounter-asset-generation",
    messageKind: "encounter_definition_to_executable_encounter",
    visibilityTimeoutSeconds: options.visibilityTimeoutSeconds ?? 300,
    timeToLiveSeconds: options.timeToLiveSeconds ?? 7 * 24 * 60 * 60,
    dequeueAttemptLimit: options.dequeueAttemptLimit ?? 25,
    request: cloneJson(request),
    notEvidenceFor: [
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

export function encodeAzureStorageQueueMessage(message: AzureStorageQueueEncounterAssetMessage): string {
  const json = JSON.stringify(message);
  if (Buffer.byteLength(json, "utf8") > 48 * 1024) {
    throw new Error("Encounter asset generation queue messages must remain under 48 KiB before Azure queue encoding");
  }
  return Buffer.from(json, "utf8").toString("base64");
}

export function decodeAzureStorageQueueMessage(encoded: string): AzureStorageQueueEncounterAssetMessage {
  const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as unknown;
  if (!isEncounterAssetGenerationQueueMessage(parsed)) {
    throw new Error("Invalid encounter asset generation queue message");
  }
  return parsed;
}

export function buildEncounterAssetGenerationPlan(
  message: AzureStorageQueueEncounterAssetMessage,
): EncounterAssetGenerationPlan {
  const capabilityByStage: Partial<Record<EncounterAssetGenerationPipelineStage, AssetGenerationCapabilityId>> = {
    "character-generation": "character-generation",
    "medical-equipment-generation": "medical-equipment-generation",
    "animation-generation": "animation-generation",
    "voice-asset-generation": "voice-asset-generation",
    "asset-bake": "asset-bake",
  };
  return {
    schemaVersion: "openclinxr.encounter-asset-generation-plan.v1",
    requestId: message.request.requestId,
    queueName: message.queueName,
    stages: message.request.requestedStages.map((stage) => ({
      stage,
      ...(capabilityByStage[stage] ? { capabilityId: capabilityByStage[stage] } : {}),
      queueMessageRequired: true,
      durableCheckpointRequired: true,
      outputTarget: stage === "scene-manifest-freeze" || stage === "runtime-bundle-publication"
        ? "blob_and_mongoose"
        : stage === "review-evidence-gate"
          ? "mongoose"
          : "blob",
    })),
    expectedDuration: {
      minimumHours: message.request.optimizationWindow.expectedMinimumHours,
      maximumHours: message.request.optimizationWindow.expectedMaximumHours,
      mayRunForDays: message.request.optimizationWindow.mayRunForDays,
    },
    executableEncounterReadyOnlyAfter: [
      "generated_scene_manifest_persisted",
      "assets_written_to_blob_store",
      "learner_runtime_bundle_persisted_to_mongoose_or_mongodb",
      "human_review_gate_passed_for_local_runtime",
      "runtime_realism_evidence_attached",
      "humanoid_visual_qa_evidence_attached",
      "quest_runtime_evidence_attached_before_quest_readiness_claim",
    ],
    ...(message.request.humanoidRealismRequirements
      ? { humanoidRealismRequirements: cloneJson(message.request.humanoidRealismRequirements) }
      : {}),
    generationWorkOrders: buildEncounterGenerationWorkOrders(message.request),
    productionReadinessClaimed: false,
  };
}

export async function processEncounterAssetGenerationQueueMessage(
  encodedOrMessage: string | AzureStorageQueueEncounterAssetMessage,
  options: {
    now?: () => string;
    runStage?: EncounterAssetGenerationStageHandler;
    sharedAssetLibraryEntries?: EncounterSharedAssetLibraryEntry[];
    maxSharedAssetLibraryEntries?: number;
  } = {},
): Promise<EncounterAssetGenerationWorkerExecution> {
  const message = typeof encodedOrMessage === "string"
    ? decodeAzureStorageQueueMessage(encodedOrMessage)
    : encodedOrMessage;
  const plan = buildEncounterAssetGenerationPlan(message);
  const now = options.now ?? (() => new Date().toISOString());
  const runStage = options.runStage ?? runDefaultEncounterAssetGenerationStage;
  const sharedAssetLibraryCacheEvents = buildEncounterSharedAssetLibraryCacheEvents({
    plan,
    at: now(),
    entries: options.sharedAssetLibraryEntries ?? [],
    maxEntries: options.maxSharedAssetLibraryEntries ?? 500,
  });
  const checkpoints: EncounterAssetGenerationWorkerCheckpoint[] = [];
  let generatedSceneManifestBlobName: string | undefined;
  let learnerRuntimeBundleId: string | undefined;
  let status: EncounterAssetGenerationWorkerExecution["status"] = "succeeded";

  for (const stagePlan of plan.stages) {
    checkpoints.push({
      stage: stagePlan.stage,
      status: "running",
      at: now(),
      artifactRefs: [],
    });

    try {
      const result = await runStage({
        stage: stagePlan.stage,
        request: message.request,
        outputTarget: stagePlan.outputTarget,
      });
      const stageStatus = result.status ?? "succeeded";
      checkpoints.push({
        stage: stagePlan.stage,
        status: stageStatus,
        at: now(),
        artifactRefs: result.artifactRefs ?? [],
        ...(result.message ? { message: result.message } : {}),
      });
      generatedSceneManifestBlobName = result.generatedSceneManifestBlobName ?? generatedSceneManifestBlobName;
      learnerRuntimeBundleId = result.learnerRuntimeBundleId ?? learnerRuntimeBundleId;

      if (stageStatus === "failed" || stageStatus === "review_blocked") {
        status = stageStatus;
        break;
      }
    } catch (error) {
      checkpoints.push({
        stage: stagePlan.stage,
        status: "failed",
        at: now(),
        artifactRefs: [],
        message: errorMessage(error),
      });
      status = "failed";
      break;
    }
  }

  return {
    schemaVersion: "openclinxr.encounter-asset-generation-worker-execution.v1",
    requestId: message.request.requestId,
    queueName: message.queueName,
    status,
    plan,
    sharedAssetLibraryCacheEvents,
    checkpoints,
    operationalNotes: buildEncounterAssetGenerationOperationalNotes({
      plan,
      checkpoints,
      sharedAssetLibraryCacheEvents,
    }),
    workerMaterializationPlan: buildEncounterWorkerMaterializationPlan({
      request: message.request,
      workOrders: plan.generationWorkOrders,
    }),
    evidenceGateRefs: buildEncounterAssetGenerationEvidenceGateRefs(message.request),
    ...(generatedSceneManifestBlobName ? { generatedSceneManifestBlobName } : {}),
    ...(learnerRuntimeBundleId ? { learnerRuntimeBundleId } : {}),
    productionReadinessClaimed: false,
  };
}

export function buildEncounterWorkerMaterializationPlan(input: {
  request: EncounterExecutableAssetGenerationRequest;
  workOrders: EncounterGenerationWorkOrder[];
}): EncounterWorkerMaterializationPlan {
  const rootPath = `.openclinxr/encounter-factory/${safeWorkOrderSegment(input.request.scenarioId)}/${safeWorkOrderSegment(input.request.requestId)}`;
  return {
    schemaVersion: "openclinxr.worker-materialization-plan.v1",
    requestId: input.request.requestId,
    scenarioId: input.request.scenarioId,
    encounterId: input.request.encounterId,
    rootPath,
    outputs: input.workOrders.map((workOrder) => ({
      workOrderId: workOrder.workOrderId,
      targetKind: workOrder.targetKind,
      artifactPath: `${rootPath}/${safeWorkOrderSegment(workOrder.targetKind)}/${safeWorkOrderSegment(workOrder.workOrderId)}.planned.json`,
      outputRefs: [...workOrder.outputRefs],
      generatedAssetsMaterialized: false,
      paidApisUsed: false,
      productionReadinessClaimed: false,
      claimBoundary: "planned_metadata_only",
    })),
    generatedAssetsMaterialized: false,
    paidApisUsed: false,
    productionReadinessClaimed: false,
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    claimBoundary: "planned_metadata_only",
  };
}

export function buildEncounterSharedAssetLibraryCacheEvents(input: {
  plan: EncounterAssetGenerationPlan;
  entries?: EncounterSharedAssetLibraryEntry[];
  maxEntries?: number;
  at: string;
}): EncounterSharedAssetLibraryCacheEvent[] {
  const maxEntries = input.maxEntries ?? 500;
  const cache = new Map<string, EncounterSharedAssetLibraryEntry>();
  for (const entry of input.entries ?? []) {
    cache.set(entry.lookupKey, { ...entry });
  }
  const events: EncounterSharedAssetLibraryCacheEvent[] = [];
  for (const workOrder of input.plan.generationWorkOrders) {
    const lookupKey = workOrder.sharedAssetLibraryReuse.lookupKey;
    const evictedLookupKeys: string[] = [];
    const existing = cache.get(lookupKey);
    if (existing && evidenceGateRefsCompatible(existing.evidenceGateRefs, workOrder.evidenceGateRefs)) {
      cache.delete(lookupKey);
      cache.set(lookupKey, { ...existing, lastUsedAt: input.at });
      events.push({
        workOrderId: workOrder.workOrderId,
        lookupKey,
        targetKind: workOrder.targetKind,
        result: "cache_hit_reuse_generation_skipped",
        generationDisposition: "skip_generation_reuse_cached_asset",
        evidenceGateCompatibility: {
          required: true,
          checkedBeforeReuse: true,
          disposition: "compatible_cached_asset_reused",
        },
        assetRef: existing.assetRef,
        evictedLookupKeys,
        recencyMostRecentFirst: [...cache.keys()].reverse(),
        notEvidenceFor: sharedAssetLibraryCacheNotEvidenceFor(),
      });
      continue;
    }
    cache.set(lookupKey, {
      lookupKey,
      assetRef: workOrder.sharedAssetLibraryReuse.sharedLibraryRefs.blobPrefix,
      evidenceGateRefs: [...workOrder.evidenceGateRefs],
      lastUsedAt: input.at,
    });
    while (cache.size > maxEntries) {
      const leastRecentKey = cache.keys().next().value as string | undefined;
      if (!leastRecentKey) break;
      cache.delete(leastRecentKey);
      evictedLookupKeys.push(leastRecentKey);
    }
    events.push({
      workOrderId: workOrder.workOrderId,
      lookupKey,
      targetKind: workOrder.targetKind,
      result: evictedLookupKeys.length > 0
        ? "cache_miss_generation_required_after_lru_eviction"
        : "cache_miss_generation_required",
      generationDisposition: evictedLookupKeys.length > 0
        ? "generate_and_store_after_lru_eviction"
        : "generate_and_store_asset",
      evidenceGateCompatibility: {
        required: true,
        checkedBeforeReuse: true,
        disposition: "requires_review_before_new_asset_reuse",
      },
      evictedLookupKeys,
      recencyMostRecentFirst: [...cache.keys()].reverse(),
      notEvidenceFor: sharedAssetLibraryCacheNotEvidenceFor(),
    });
  }
  return events;
}

export function buildEncounterAssetGenerationOperationalNotes(input: {
  plan: EncounterAssetGenerationPlan;
  checkpoints: EncounterAssetGenerationWorkerCheckpoint[];
  sharedAssetLibraryCacheEvents: EncounterSharedAssetLibraryCacheEvent[];
}): EncounterAssetGenerationOperationalNotes {
  const finalStatusByStage = new Map<EncounterAssetGenerationPipelineStage, EncounterAssetGenerationWorkerCheckpoint["status"]>();
  for (const checkpoint of input.checkpoints) {
    if (checkpoint.status !== "running") {
      finalStatusByStage.set(checkpoint.stage, checkpoint.status);
    }
  }

  const stageNotes = input.plan.stages.map<EncounterAssetGenerationStageOperationalNote>((stagePlan) => {
    const finalStatus = finalStatusByStage.get(stagePlan.stage) ?? "succeeded";
    if (finalStatus === "failed") {
      return {
        stage: stagePlan.stage,
        transitions: ["queued_to_running", "running_to_failed"],
        retryCheckpoint: "after_stage_failure",
        retryable: true,
        note: `Stage ${stagePlan.stage} should be retried from the durable checkpoint after a failure.`,
      };
    }
    if (finalStatus === "review_blocked") {
      return {
        stage: stagePlan.stage,
        transitions: ["queued_to_running", "running_to_review_blocked"],
        retryCheckpoint: "after_review_blocked",
        retryable: false,
        note: `Stage ${stagePlan.stage} is paused at a human review checkpoint and should resume only after the review gate is satisfied.`,
      };
    }
    return {
      stage: stagePlan.stage,
      transitions: ["queued_to_running", "running_to_succeeded"],
      retryCheckpoint: "after_stage_success",
      retryable: false,
      note: `Stage ${stagePlan.stage} can advance to the next queued stage after its durable checkpoint is written.`,
    };
  });

  const sharedLibraryNotes = input.sharedAssetLibraryCacheEvents.map<EncounterSharedAssetLibraryOperationalNote>((event) => {
    if (event.result === "cache_hit_reuse_generation_skipped") {
      return {
        workOrderId: event.workOrderId,
        lookupKey: event.lookupKey,
        targetKind: event.targetKind,
        result: event.result,
        retryCheckpoint: "reuse_cached_asset",
        retryable: false,
        note: `Shared asset reuse is satisfied by the cached ${event.targetKind} artifact; no regeneration is needed unless evidence gates change.`,
      };
    }
    if (event.result === "cache_miss_generation_required_after_lru_eviction") {
      return {
        workOrderId: event.workOrderId,
        lookupKey: event.lookupKey,
        targetKind: event.targetKind,
        result: event.result,
        retryCheckpoint: "regenerate_after_lru_eviction",
        retryable: true,
        note: `Shared asset reuse missed after LRU eviction; regenerate the ${event.targetKind} artifact and backfill the shared library entry.`,
      };
    }
    return {
      workOrderId: event.workOrderId,
      lookupKey: event.lookupKey,
      targetKind: event.targetKind,
      result: event.result,
      retryCheckpoint: "regenerate_shared_asset",
      retryable: true,
      note: `Shared asset reuse missed; generate the ${event.targetKind} artifact and persist it to the shared library for later reuse.`,
    };
  });

  return {
    stageNotes,
    sharedLibraryNotes,
  };
}

export async function processNextEncounterAssetGenerationQueueMessage(options: {
  queueClient: EncounterAssetGenerationQueueClient;
  persistExecution: (
    execution: EncounterAssetGenerationWorkerExecution,
    envelope: EncounterAssetGenerationQueueMessageEnvelope,
  ) => Promise<void>;
  now?: () => string;
  runStage?: EncounterAssetGenerationStageHandler;
  deleteProcessedMessage?: boolean;
}): Promise<EncounterAssetGenerationQueueProcessingResult> {
  const envelope = await options.queueClient.receiveEncounterAssetGenerationMessage();
  if (!envelope) {
    return {
      status: "idle",
      messageReceived: false,
    };
  }

  try {
    const execution = await processEncounterAssetGenerationQueueMessage(envelope.messageText, {
      ...(options.now ? { now: options.now } : {}),
      ...(options.runStage ? { runStage: options.runStage } : {}),
    });
    await options.persistExecution(execution, envelope);
    const shouldDelete = options.deleteProcessedMessage ?? execution.status !== "failed";
    if (shouldDelete) {
      await options.queueClient.deleteEncounterAssetGenerationMessage(envelope.messageId, envelope.popReceipt);
    }
    return {
      status: "processed",
      messageReceived: true,
      messageDeleted: shouldDelete,
      envelope,
      execution,
    };
  } catch (error) {
    return {
      status: "failed_before_delete",
      messageReceived: true,
      messageDeleted: false,
      envelope,
      error: errorMessage(error),
    };
  }
}

export function buildEncounterAssetGenerationPublicationTargets(
  request: EncounterExecutableAssetGenerationRequest,
): EncounterAssetGenerationPublicationTargets {
  return {
    generatedSceneManifestBlobName: `${request.targetAssetStore.blobPrefix}scene-manifest.v1.json`,
    learnerRuntimeBundleBlobName: `${request.targetAssetStore.blobPrefix}learner-runtime-bundle.v1.json`,
    learnerRuntimeBundleId: `${request.encounterId}:learner-runtime-bundle:v1`,
    learnerRuntimeBundleMongoCollection: "learner_runtime_asset_bundles",
    jobStateMongoCollection: request.persistenceTarget.collectionName,
  };
}

export function buildEncounterAssetGenerationEvidenceGateRefs(
  request: EncounterExecutableAssetGenerationRequest,
): EncounterAssetGenerationEvidenceGateRef[] {
  const notEvidenceFor = [
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
  ] as const;
  return [
    {
      gateId: "asset_production_review",
      status: request.evidenceGates.requireHumanReviewBeforeLearnerUse ? "pending" : "blocked",
      evidenceRefs: [],
      requiredSignalIds: ["human_review_before_learner_use"],
      blockers: request.evidenceGates.requireHumanReviewBeforeLearnerUse
        ? ["asset_production_review_not_attached_to_generation_job"]
        : ["human_review_gate_not_required_by_request"],
      notEvidenceFor: [...notEvidenceFor],
    },
    {
      gateId: "runtime_realism_evidence",
      status: "pending",
      evidenceRefs: [],
      requiredSignalIds: [
        "animated_humanoid_runtime_playback",
        "authored_clinical_idle_pose_runtime_cue",
        "visible_mouth_eye_expression_cues",
        "dialogue_viseme_and_gaze_mapping",
        "emotion_aligned_expression_transition_cue",
      ],
      blockers: ["runtime_realism_evidence_not_attached_to_generation_job"],
      notEvidenceFor: [...notEvidenceFor],
    },
    {
      gateId: "visual_qa_evidence",
      status: "pending",
      evidenceRefs: [],
      requiredSignalIds: ["humanoid_realism_visual_qa_review", "no_rejected_visual_regression_cues", "emotion_expression_transition_readability"],
      blockers: ["visual_qa_evidence_not_attached_to_generation_job"],
      notEvidenceFor: [...notEvidenceFor],
    },
    {
      gateId: "quest_runtime_evidence",
      status: "pending",
      evidenceRefs: [],
      requiredSignalIds: ["worn_headset_or_documented_quest_webxr_evidence"],
      blockers: request.evidenceGates.requireQuestEvidenceBeforeQuestReadinessClaim
        ? ["quest_runtime_evidence_not_attached_to_generation_job"]
        : ["quest_readiness_claim_not_allowed_without_evidence"],
      notEvidenceFor: [...notEvidenceFor],
    },
  ];
}

export function buildEncounterGenerationWorkOrders(
  request: EncounterExecutableAssetGenerationRequest,
): EncounterGenerationWorkOrder[] {
  const notEvidenceFor = [
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
  ] as const;
  const modelProviderPolicy: EncounterGenerationModelProviderPolicy = {
    executionStatus: "metadata_only_not_executed",
    allowPaidCloudApis: false,
    allowExternalNetwork: false,
    secretsRequired: false,
    providerRoutesRequireExplicitApproval: true,
  };
  const workOrders: EncounterGenerationWorkOrder[] = [];
  const encounterFactoryInputSummary = request.encounterFactoryInputSummary;
  const scenarioSemanticLookupKeys = encounterFactoryInputSummary?.sharedAssetLookupKeys ?? [];
  const dynamicBehaviorTraceTags = encounterFactoryInputSummary?.dynamicBehaviorTraceTags ?? [];
  const humanoidPerformanceContract = encounterFactoryInputSummary?.humanoidPerformanceContract;

  for (const requirement of request.humanoidRealismRequirements?.requirements ?? []) {
    const actorRoleId = safeWorkOrderSegment(requirement.actorRole);
    const caseDefinedHumanoidPerformanceRequirements = buildCaseDefinedHumanoidPerformanceRequirements(
      requirement.actorRole,
      humanoidPerformanceContract,
    );
    const humanoidCacheKey = buildSharedAssetLibraryLookupKey({
      scenarioId: request.scenarioId,
      targetKind: "role_specific_humanoid_glb",
      actorRole: requirement.actorRole,
      semanticInputs: [
        requirement.realismProfile?.ageBand ?? "contextual_adult",
        ...(requirement.realismProfile?.bodyPostureNotes ?? []),
        ...(requirement.realismProfile?.clothingClinicalContextCues ?? []),
        ...(requirement.realismProfile?.expressionAffectCues ?? []),
        ...(requirement.requiredAssetKinds ?? []),
        ...scenarioSemanticLookupKeys.filter((key) => key.includes(`::${requirement.actorRole}::`)),
        ...dynamicBehaviorTraceTags,
      ],
    });
    workOrders.push({
      workOrderId: `${request.requestId}:${actorRoleId}:role-specific-humanoid`,
      scenarioId: request.scenarioId,
      encounterId: request.encounterId,
      targetKind: "role_specific_humanoid_glb",
      capabilityId: "character-generation",
      providerRoute: "open-source-local-model-planned",
      providerRoutingPreference: [
        "meshy_cloud_requires_approval",
        "hunyuan3d_local",
        "blender_mixamo_style_rigging_fallback",
      ],
      modelProviderPolicy,
      sharedAssetLibraryReuse: buildSharedAssetLibraryReusePolicy(request, humanoidCacheKey),
      actorRole: requirement.actorRole,
      ...(caseDefinedHumanoidPerformanceRequirements ? { caseDefinedHumanoidPerformanceRequirements } : {}),
      inputRefs: [
        `mongoose://scenario_definitions/${request.encounterDefinitionRef.documentId ?? request.scenarioId}`,
        `humanoid-realism-requirement://${request.scenarioId}/${actorRoleId}`,
        `shared-asset-library-lookup://${humanoidCacheKey}`,
        ...scenarioSemanticLookupKeys
          .filter((key) => key.includes(`::${requirement.actorRole}::`))
          .map((key) => `encounter-factory-input-summary://${key}`),
      ],
      outputRefs: [
        `blob://${request.targetAssetStore.containerName}/${request.targetAssetStore.blobPrefix}humanoids/${actorRoleId}/model.glb`,
        `blob://${request.targetAssetStore.containerName}/${request.targetAssetStore.blobPrefix}humanoids/${actorRoleId}/clothing-and-materials.json`,
        `blob://${request.targetAssetStore.containerName}/shared-encounter-assets/${humanoidCacheKey}/model.glb`,
        `mongoose://shared_encounter_asset_library/${humanoidCacheKey}`,
      ],
      evidenceGateRefs: ["asset_production_review", "runtime_realism_evidence", "visual_qa_evidence"],
      visualQaBlockerRefs: [
        "role_readability",
        "clothing_authenticity",
        "anatomy_plausibility",
        "pose_intent",
        "variation",
      ],
      acceptanceCriteria: [
        "actor_role_is_distinguishable_without_runtime_overlay_labels",
        "clothing_matches_encounter_role_and_clinical_context",
        "mesh_includes_face_eye_lip_rig_metadata_or_morph_targets",
        "pose_matches_encounter_definition_blocking",
      ],
      notEvidenceFor: [...notEvidenceFor],
    });

    if (request.requestedStages.includes("animation-generation")) {
      const animationCacheKey = buildSharedAssetLibraryLookupKey({
        scenarioId: request.scenarioId,
        targetKind: "role_idle_animation_glb",
        actorRole: requirement.actorRole,
        semanticInputs: [
          ...(requirement.requiredSignalIds ?? []),
          ...(requirement.realismProfile?.mobilityPositioningConstraints ?? []),
          ...(requirement.realismProfile?.expressionAffectCues ?? []),
          ...dynamicBehaviorTraceTags,
        ],
      });
      workOrders.push({
        workOrderId: `${request.requestId}:${actorRoleId}:role-animation`,
        scenarioId: request.scenarioId,
        encounterId: request.encounterId,
        targetKind: "role_idle_animation_glb",
        capabilityId: "animation-generation",
        providerRoute: "local-runtime-planned",
        providerRoutingPreference: [
          "blender_mixamo_style_rigging_fallback",
          "meshy_cloud_requires_approval",
        ],
        modelProviderPolicy,
        sharedAssetLibraryReuse: buildSharedAssetLibraryReusePolicy(request, animationCacheKey),
        actorRole: requirement.actorRole,
        ...(caseDefinedHumanoidPerformanceRequirements ? { caseDefinedHumanoidPerformanceRequirements } : {}),
        inputRefs: [
          `blob://${request.targetAssetStore.containerName}/${request.targetAssetStore.blobPrefix}humanoids/${actorRoleId}/model.glb`,
          `humanoid-realism-signals://${request.scenarioId}/${actorRoleId}`,
          `shared-asset-library-lookup://${animationCacheKey}`,
        ],
        outputRefs: [
          `blob://${request.targetAssetStore.containerName}/${request.targetAssetStore.blobPrefix}humanoids/${actorRoleId}/clinical-idle.anim.glb`,
          `blob://${request.targetAssetStore.containerName}/${request.targetAssetStore.blobPrefix}humanoids/${actorRoleId}/facial-viseme-gaze.anim.json`,
          `blob://${request.targetAssetStore.containerName}/shared-encounter-assets/${animationCacheKey}/clinical-idle.anim.glb`,
          `mongoose://shared_encounter_asset_library/${animationCacheKey}`,
        ],
        evidenceGateRefs: ["runtime_realism_evidence", "visual_qa_evidence"],
        visualQaBlockerRefs: [
          "eye_contact_logic",
          "facial_state",
          "mouth_talking_realism",
          "idle_motion",
          "interaction_timing",
        ],
        acceptanceCriteria: [
          "idle_motion_includes_breathing_blink_micro_saccades_and_weight_shift",
          "dialogue_animation_includes_viseme_phoneme_gaze_and_emotion_transition_tracks",
          "animation_timing_aligns_with_scenario_dialogue_and_affect_timeline",
        ],
        notEvidenceFor: [...notEvidenceFor],
      });
    }
  }

  if (request.requestedStages.includes("medical-equipment-generation")) {
    const equipmentCacheKey = buildSharedAssetLibraryLookupKey({
      scenarioId: request.scenarioId,
      targetKind: "medical_equipment_glb",
      semanticInputs: [
        request.stationId,
        "clinical_zone_layout",
          "recognizable_ed_props",
          "functional_placement",
          "scale_validation",
          "cable_tube_logic",
          ...scenarioSemanticLookupKeys.filter((key) => key.startsWith("semantic::equipment::")),
          ...dynamicBehaviorTraceTags,
        ],
    });
    workOrders.push({
      workOrderId: `${request.requestId}:scenario-medical-equipment`,
      scenarioId: request.scenarioId,
      encounterId: request.encounterId,
      targetKind: "medical_equipment_glb",
      capabilityId: "medical-equipment-generation",
      providerRoute: "open-source-local-model-planned",
      providerRoutingPreference: [
        "hunyuan3d_local",
        "meshy_cloud_requires_approval",
        "tripo_cloud_requires_approval",
      ],
      modelProviderPolicy,
      sharedAssetLibraryReuse: buildSharedAssetLibraryReusePolicy(request, equipmentCacheKey),
      inputRefs: [
        `mongoose://scenario_definitions/${request.encounterDefinitionRef.documentId ?? request.scenarioId}`,
        `encounter-room-grammar://${request.scenarioId}/clinical-zones`,
        `shared-asset-library-lookup://${equipmentCacheKey}`,
        ...scenarioSemanticLookupKeys
          .filter((key) => key.startsWith("semantic::equipment::") || key.startsWith("semantic::environment::"))
          .map((key) => `encounter-factory-input-summary://${key}`),
      ],
      outputRefs: [
        `blob://${request.targetAssetStore.containerName}/${request.targetAssetStore.blobPrefix}equipment/semantic-medical-props.manifest.json`,
        `blob://${request.targetAssetStore.containerName}/shared-encounter-assets/${equipmentCacheKey}/semantic-medical-props.manifest.json`,
        `mongoose://shared_encounter_asset_library/${equipmentCacheKey}`,
      ],
      evidenceGateRefs: ["asset_production_review", "visual_qa_evidence"],
      visualQaBlockerRefs: [
        "recognizable_ed_props",
        "functional_placement",
        "scale_validation",
        "cable_tube_logic",
        "clinical_affordances",
      ],
      acceptanceCriteria: [
        "every_prop_has_semantic_type_scale_anchor_surface_and_room_zone",
        "monitor_leads_iv_lines_and_tubing_have_plausible_connection_endpoints",
        "unlabeled_blockout_geometry_is_removed_or_replaced",
      ],
      notEvidenceFor: [...notEvidenceFor],
    });
  }

  workOrders.push({
    workOrderId: `${request.requestId}:adversarial-visual-feedback-closure`,
    scenarioId: request.scenarioId,
    encounterId: request.encounterId,
    targetKind: "visual_feedback_closure",
    capabilityId: "asset-bake",
    providerRoute: "deterministic-mock",
    providerRoutingPreference: [
      "local_open_vlm_if_available",
      "frontier_cloud_vlm_requires_approval",
      "deterministic_fixture",
    ],
    modelProviderPolicy,
    sharedAssetLibraryReuse: buildSharedAssetLibraryReusePolicy(
      request,
      buildSharedAssetLibraryLookupKey({
        scenarioId: request.scenarioId,
        targetKind: "visual_feedback_closure",
        semanticInputs: [
          "adversarial_visual_feedback",
          "blocked_visual_qa_items",
          "screenshot_or_video_evidence_required",
          ...scenarioSemanticLookupKeys,
          ...dynamicBehaviorTraceTags,
        ],
      }),
    ),
    inputRefs: [
      `visual-qa-evidence://${request.scenarioId}/latest-adversarial-review`,
      `screenshot-analysis://${request.scenarioId}/latest-multimodal-findings`,
    ],
    outputRefs: [
      `mongoose://${request.persistenceTarget.collectionName}/${request.requestId}/visualFeedbackClosureWorkOrders`,
      `blob://${request.targetAssetStore.containerName}/${request.targetAssetStore.blobPrefix}visual-feedback/remediation-plan.json`,
    ],
    evidenceGateRefs: ["visual_qa_evidence"],
    visualQaBlockerRefs: [
      "floating_geometry",
      "body_clipping",
      "duplicate_humanoids",
      "unlabeled_abstractions",
      "render_polish",
    ],
    acceptanceCriteria: [
      "adversarial_multimodal_findings_are_converted_to_worker_remediation_inputs",
      "blocked_visual_qa_items_remain_pending_until_new_screenshot_or_video_evidence_closes_them",
      "framework_can_apply_the_same_feedback_to_many_encounter_definitions",
    ],
    notEvidenceFor: [...notEvidenceFor],
  });

  return workOrders;
}

function buildCaseDefinedHumanoidPerformanceRequirements(
  actorRole: string,
  contract: EncounterFactoryInputSummary["humanoidPerformanceContract"] | undefined,
): EncounterGenerationWorkOrder["caseDefinedHumanoidPerformanceRequirements"] | undefined {
  if (!contract) {
    return undefined;
  }
  const normalizedActorRole = normalizeActorRole(actorRole);
  return {
    claimBoundary: "case_definition_humanoid_performance_metadata_only",
    actorRole,
    locomotionRequired: contract.locomotionActorRoles.some((role) => normalizeActorRole(role) === normalizedActorRole),
    expressionRequired: contract.expressionActorRoles.some((role) => normalizeActorRole(role) === normalizedActorRole),
    gazeRequired: contract.gazeActorRoles.some((role) => normalizeActorRole(role) === normalizedActorRole),
    lipSyncRequired: contract.lipSyncActorRoles.some((role) => normalizeActorRole(role) === normalizedActorRole),
    interactiveRequired: contract.interactiveActorRoles.some((role) => normalizeActorRole(role) === normalizedActorRole),
    dialogueDrivenVisemeMappingRequired: contract.dialogueDrivenVisemeMappingRequired,
    gazeTargetingRequired: contract.gazeTargetingRequired,
    locomotionPlanningRequired: contract.locomotionPlanningRequired,
    notEvidenceFor: [...contract.notEvidenceFor],
  };
}

function normalizeActorRole(value: string): string {
  return value.trim().toLowerCase();
}

export function buildVisualQaRemediationWorkOrderPlans(input: {
  requestId: string;
  encounterId: string;
  scenarioId: string;
  sourceEvidenceRef: string;
  encounterDefinitionRef: EncounterExecutableAssetGenerationRequest["encounterDefinitionRef"];
  targetAssetStore: EncounterExecutableAssetGenerationRequest["targetAssetStore"];
  persistenceTarget: EncounterExecutableAssetGenerationRequest["persistenceTarget"];
  remediationInputs: VisualQaRemediationLoopReadinessInput[];
  notEvidenceFor?: EncounterGenerationWorkOrder["notEvidenceFor"];
}): VisualQaRemediationWorkOrderPlan[] {
  const notEvidenceFor: EncounterGenerationWorkOrder["notEvidenceFor"] = input.notEvidenceFor ?? [
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
  const encounterDefinitionRefPath = input.encounterDefinitionRef.storeKind === "mongoose" || input.encounterDefinitionRef.storeKind === "mongodb"
    ? `mongoose://${input.encounterDefinitionRef.collectionName ?? "scenario_definitions"}/${input.encounterDefinitionRef.documentId ?? input.scenarioId}`
    : input.encounterDefinitionRef.storeKind === "blob"
      ? `blob://${input.encounterDefinitionRef.blobName ?? input.scenarioId}`
      : `inline://${input.scenarioId}`;
  const modelProviderPolicy: EncounterGenerationModelProviderPolicy = {
    executionStatus: "metadata_only_not_executed",
    allowPaidCloudApis: false,
    allowExternalNetwork: false,
    secretsRequired: false,
    providerRoutesRequireExplicitApproval: true,
  };

  return input.remediationInputs.map<VisualQaRemediationWorkOrderPlan>((remediationInput) => {
    const targetKind = remediationInput.targetKinds[0];
    const capabilityId = remediationInput.capabilityIds[0];
    if (!targetKind || !capabilityId) {
      throw new Error("Visual QA remediation inputs require at least one target kind and capability id");
    }

    const lookupKey = buildSharedAssetLibraryLookupKey({
      scenarioId: input.scenarioId,
      targetKind,
      semanticInputs: [
        remediationInput.category,
        ...remediationInput.blockerIds,
        ...remediationInput.recommendedWorkerActions,
      ],
    });
    const remediationDimension = remediationInput.remediationDimension ?? remediationDimensionForVisualQaCategory(remediationInput.category);
    const workOrderId = `${input.requestId}:${safeWorkOrderSegment(remediationInput.category)}:${safeWorkOrderSegment(targetKind)}:${safeWorkOrderSegment(capabilityId)}`;
    const providerDisabledPlanningMetadata: EncounterProviderDisabledRemediationPlanningMetadata = {
      schemaVersion: "openclinxr.provider-disabled-remediation-planning-metadata.v1",
      dimension: remediationDimension,
      ...(remediationInput.actorRole ? { actorRole: remediationInput.actorRole } : {}),
      sharedAssetLookupKey: lookupKey,
      sourceBlockerRefs: [...remediationInput.blockerIds],
      requiredSignalRefs: remediationInput.requiredSignalRefs?.length
        ? [...remediationInput.requiredSignalRefs]
        : requiredSignalRefsForHumanoidRemediationDimension(remediationDimension),
      providerExecutionBoundary: {
        ...modelProviderPolicy,
        disabledReason: "operator_approval_or_runtime_evidence_required_before_provider_execution",
      },
      acceptanceCriteria: acceptanceCriteriaForHumanoidRemediationDimension(remediationDimension),
      notEvidenceFor: [...notEvidenceFor],
    };
    const workOrder: EncounterGenerationWorkOrder = {
      workOrderId,
      scenarioId: input.scenarioId,
      encounterId: input.encounterId,
      targetKind,
      capabilityId,
      providerRoute: providerRouteForVisualQaRemediation(targetKind),
      providerRoutingPreference: providerRoutingPreferenceForVisualQaRemediation(targetKind),
      modelProviderPolicy,
      sharedAssetLibraryReuse: buildSharedAssetLibraryReusePolicy({
        targetAssetStore: input.targetAssetStore,
      }, lookupKey),
      inputRefs: [
        encounterDefinitionRefPath,
        input.sourceEvidenceRef,
        `visual-qa-loop-readiness://${input.scenarioId}/${safeWorkOrderSegment(remediationInput.category)}`,
        `visual-qa-remediation-input://${input.scenarioId}/${safeWorkOrderSegment(remediationInput.category)}`,
        ...remediationInput.workOrderRefs,
        `shared-asset-library-lookup://${lookupKey}`,
      ],
      outputRefs: [
        `blob://${input.targetAssetStore.containerName}/${input.targetAssetStore.blobPrefix}visual-feedback/${safeWorkOrderSegment(remediationInput.category)}-${safeWorkOrderSegment(targetKind)}-${safeWorkOrderSegment(capabilityId)}.work-order-plan.json`,
        `mongoose://${input.persistenceTarget.collectionName}/${input.requestId}/visualRemediationWorkOrderPlans/${safeWorkOrderSegment(remediationInput.category)}-${safeWorkOrderSegment(targetKind)}-${safeWorkOrderSegment(capabilityId)}`,
        `blob://${input.targetAssetStore.containerName}/shared-encounter-assets/${lookupKey}/work-order-plan.json`,
      ],
      evidenceGateRefs: ["visual_qa_evidence"],
      visualQaBlockerRefs: [...remediationInput.blockerIds],
      acceptanceCriteria: [
        "normalized_visual_remediation_inputs_are_preserved_as_asset_planning_inputs",
        "work_order_planning_stays_metadata_only_without_quest_or_production_claims",
        "temporal_evidence_boundaries_remain_metadata_only_until_new_evidence_closes_the_blockers",
      ],
      notEvidenceFor: [...notEvidenceFor],
    };

    return {
      schemaVersion: "openclinxr.visual-qa-remediation-work-order-plan.v1",
      scenarioId: input.scenarioId,
      sourceEvidenceRef: input.sourceEvidenceRef,
      category: remediationInput.category,
      blockerIds: [...remediationInput.blockerIds],
      recommendedWorkerActions: [...remediationInput.recommendedWorkerActions],
      temporalEvidenceBoundary: "metadata_only_not_quest_or_production_claims",
      providerDisabledPlanningMetadata,
      workOrder,
    };
  });
}

export function buildDefaultHumanoidRemediationLoopInputs(input: {
  actorRole: string;
  workOrderRefs: string[];
}): VisualQaRemediationLoopReadinessInput[] {
  const targetKindsByDimension: Record<EncounterHumanoidRemediationDimension, EncounterGenerationWorkOrderTargetKind[]> = {
    gaze: ["facial_lipsync_gaze_animation"],
    mouth_viseme: ["facial_lipsync_gaze_animation"],
    pose: ["role_idle_animation_glb"],
    posture_collision: ["role_idle_animation_glb"],
    clothing: ["role_specific_humanoid_glb"],
    shared_asset_reuse: ["visual_feedback_closure"],
  };
  const capabilityByDimension: Record<EncounterHumanoidRemediationDimension, AssetGenerationCapabilityId[]> = {
    gaze: ["animation-generation"],
    mouth_viseme: ["animation-generation"],
    pose: ["animation-generation"],
    posture_collision: ["asset-bake"],
    clothing: ["character-generation"],
    shared_asset_reuse: ["asset-bake"],
  };
  return ([
    "gaze",
    "mouth_viseme",
    "pose",
    "posture_collision",
    "clothing",
    "shared_asset_reuse",
  ] as const).map((dimension) => ({
    category: `${input.actorRole}_${dimension}_remediation`,
    blockerIds: blockerRefsForHumanoidRemediationDimension(dimension),
    remediationDimension: dimension,
    actorRole: input.actorRole,
    requiredSignalRefs: requiredSignalRefsForHumanoidRemediationDimension(dimension),
    targetKinds: targetKindsByDimension[dimension],
    capabilityIds: capabilityByDimension[dimension],
    workOrderRefs: [...input.workOrderRefs],
    recommendedWorkerActions: workerActionsForHumanoidRemediationDimension(dimension),
  }));
}

function runDefaultEncounterAssetGenerationStage(
  input: EncounterAssetGenerationStageHandlerInput,
): EncounterAssetGenerationStageHandlerResult {
  const basePrefix = input.request.targetAssetStore.blobPrefix;
  const publicationTargets = buildEncounterAssetGenerationPublicationTargets(input.request);
  if (input.stage === "scene-manifest-freeze") {
    return {
      artifactRefs: [
        `blob://${input.request.targetAssetStore.containerName}/${publicationTargets.generatedSceneManifestBlobName}`,
        `mongoose://${publicationTargets.jobStateMongoCollection}/${input.request.requestId}/generatedSceneManifestBlobName`,
      ],
      generatedSceneManifestBlobName: publicationTargets.generatedSceneManifestBlobName,
      message: "Generated scene manifest must be persisted before runtime bundle publication.",
    };
  }
  if (input.stage === "runtime-bundle-publication") {
    return {
      artifactRefs: [
        `blob://${input.request.targetAssetStore.containerName}/${publicationTargets.learnerRuntimeBundleBlobName}`,
        `mongoose://${publicationTargets.learnerRuntimeBundleMongoCollection}/${publicationTargets.learnerRuntimeBundleId}`,
      ],
      learnerRuntimeBundleId: publicationTargets.learnerRuntimeBundleId,
      message: "Learner runtime bundle publication checkpoint prepared for Blob plus Mongoose/Mongo persistence.",
    };
  }
  if (input.stage === "review-evidence-gate") {
    return {
      status: "review_blocked",
      artifactRefs: [`${basePrefix}review-gate.required.json`],
      message: "Human review evidence is required before learner runtime use; no readiness claim is made.",
    };
  }
  return {
    artifactRefs: [`${basePrefix}${input.stage}/artifact-manifest.json`],
    message: `${input.stage} checkpoint prepared for ${input.outputTarget}.`,
  };
}

export function createDeterministicAssetGenerationAdapter(
  capabilityId: AssetGenerationCapabilityId,
): AssetGenerationWorkerAdapter {
  return {
    capabilityId,
    providerId: `deterministic-${capabilityId}`,
    providerKind: "deterministic-mock",
    implementationLanguage: "typescript",
    transport: "in-process",
    async run(_request, policy, context) {
      const basePath = `${policy.sandboxWorkdir}/${context.jobId}`;
      return {
        artifacts: [
          {
            kind: "manifest",
            path: `${basePath}/${capabilityId}-manifest.json`,
            mediaType: "application/json",
          },
          {
            kind: "source",
            path: `${basePath}/${capabilityId}-source.asset.json`,
            mediaType: "application/json",
          },
        ],
        manifest: {
          schemaVersion: "asset-generation-manifest.v1",
          capabilityId,
          outputs: [
            `${capabilityId}-manifest.json`,
            `${capabilityId}-source.asset.json`,
          ],
        },
        provenance: {
          generator: `deterministic-${capabilityId}`,
          license: "openclinxr-deterministic-test-fixture",
          spendCents: 0,
          externalNetworkUsed: false,
        },
      };
    },
  };
}

function normalizePolicy(
  policy: AssetGenerationJobPolicyInput | undefined,
  adapter: AssetGenerationWorkerAdapter,
): AssetGenerationJobPolicy {
  const runtime: AssetGenerationRuntimePolicy = {
    providerKind: policy?.runtime?.providerKind ?? adapter.providerKind ?? defaultRuntime.providerKind,
    implementationLanguage: policy?.runtime?.implementationLanguage
      ?? adapter.implementationLanguage
      ?? defaultRuntime.implementationLanguage,
    transport: policy?.runtime?.transport ?? adapter.transport ?? defaultRuntime.transport,
    ...(policy?.runtime?.executable ? { executable: policy.runtime.executable } : {}),
    ...(policy?.runtime?.args ? { args: policy.runtime.args } : {}),
    ...(policy?.runtime?.environment ? { environment: policy.runtime.environment } : {}),
  };

  return {
    timeoutMs: policy?.timeoutMs ?? defaultTimeoutMs,
    sandboxWorkdir: policy?.sandboxWorkdir ?? defaultSandboxWorkdir,
    requireArtifactManifest: policy?.requireArtifactManifest ?? true,
    requireLicenseProvenance: policy?.requireLicenseProvenance ?? true,
    allowExternalNetwork: policy?.allowExternalNetwork ?? false,
    spendLimitCents: policy?.spendLimitCents ?? 0,
    runtime,
  };
}

function validateEncounterAssetGenerationRequest(request: EncounterExecutableAssetGenerationRequest): void {
  if (request.requestId.trim().length === 0) throw new Error("Encounter asset generation requests require requestId");
  if (request.encounterDefinitionRef.storeKind !== "inline" && !request.encounterDefinitionRef.documentId && !request.encounterDefinitionRef.blobName) {
    throw new Error("Encounter asset generation requests require a persisted encounter definition reference");
  }
  if (request.targetAssetStore.storeKind !== "azurite_blob" && request.targetAssetStore.storeKind !== "azure_blob") {
    throw new Error("Encounter asset generation requires Azure Blob or Azurite Blob target storage");
  }
  if (!request.targetAssetStore.blobPrefix.endsWith("/")) {
    throw new Error("Encounter asset generation blobPrefix must end with /");
  }
  if (request.optimizationWindow.expectedMaximumHours < request.optimizationWindow.expectedMinimumHours) {
    throw new Error("Encounter asset generation maximum hours must be >= minimum hours");
  }
  if (request.optimizationWindow.expectedMaximumHours < 1) {
    throw new Error("Encounter asset generation must allow long-running optimization windows");
  }
  if (request.policy.allowPaidCloudApis || request.policy.allowProductionDeployment || request.policy.productionReadinessClaimed) {
    throw new Error("Encounter asset generation queue messages cannot authorize paid APIs, production deployment, or production readiness claims");
  }
  validateHumanoidRealismRequirements(request.humanoidRealismRequirements);
  for (const requiredStage of ["scene-manifest-freeze", "runtime-bundle-publication", "review-evidence-gate"] as const) {
    if (!request.requestedStages.includes(requiredStage)) {
      throw new Error(`Encounter asset generation requests require ${requiredStage}`);
    }
  }
}

function validateHumanoidRealismRequirements(requirements: EncounterHumanoidRealismRequirements | undefined): void {
  if (!requirements) return;
  if (requirements.schemaVersion !== "openclinxr.encounter-humanoid-realism-requirements.v1") {
    throw new Error("Humanoid realism requirements require schemaVersion openclinxr.encounter-humanoid-realism-requirements.v1");
  }
  if (requirements.source !== "scenario_actor_definitions") {
    throw new Error("Humanoid realism requirements must be derived from scenario actor definitions");
  }
  if (requirements.requirements.length === 0) {
    throw new Error("Humanoid realism requirements require at least one actor role");
  }
  const seenActorRoles = new Set<string>();
  for (const requirement of requirements.requirements) {
    const normalizedActorRole = normalizeHumanoidActorRole(requirement.actorRole);
    if (normalizedActorRole.length === 0) {
      throw new Error("Humanoid realism actor requirements require actorRole");
    }
    if (seenActorRoles.has(normalizedActorRole)) {
      throw new Error("Humanoid realism actor requirements require unique actorRole");
    }
    seenActorRoles.add(normalizedActorRole);
    for (const requiredKind of [
      "generated_humanoid_mesh",
      "clinical_idle_animation",
      "viseme_phoneme_map",
      "gaze_blink_control",
    ] as const) {
      if (!requirement.requiredAssetKinds.includes(requiredKind)) {
        throw new Error(`Humanoid realism requirements for ${requirement.actorRole} require ${requiredKind}`);
      }
    }
    for (const requiredSignal of [
      "animated_humanoid_runtime_playback",
      "dialogue_viseme_and_gaze_mapping",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      "emotion_aligned_expression_transition_cue",
    ]) {
      if (!requirement.requiredSignalIds.includes(requiredSignal)) {
        throw new Error(`Humanoid realism requirements for ${requirement.actorRole} require ${requiredSignal}`);
      }
    }
    if (!requirement.realismProfile) {
      throw new Error(`Humanoid realism requirements for ${requirement.actorRole} require metadata-only realismProfile`);
    }
    if (requirement.realismProfile) {
      if (requirement.realismProfile.claimScope !== "metadata_only_not_visual_quality_evidence") {
        throw new Error(`Humanoid realism profile for ${requirement.actorRole} must remain metadata-only`);
      }
      for (const requiredEvidenceId of [
        "dialogue_viseme_and_gaze_mapping",
        "dialogue_eye_micro_saccade_blink_cue",
        "generated_eyelid_blink_control_cue",
        "emotion_aligned_expression_transition_cue",
      ]) {
        if (!requirement.realismProfile.requiredRealismEvidenceIds.includes(requiredEvidenceId)) {
          throw new Error(`Humanoid realism profile for ${requirement.actorRole} require ${requiredEvidenceId}`);
        }
      }
    }
  }
}

function normalizeHumanoidActorRole(value: string): string {
  return value.trim().toLowerCase();
}

function safeWorkOrderSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "actor";
}

function evidenceGateRefsCompatible(
  existing: EncounterAssetGenerationEvidenceGateRef["gateId"][],
  required: EncounterAssetGenerationEvidenceGateRef["gateId"][],
): boolean {
  const existingRefs = new Set(existing);
  return required.every((gateId) => existingRefs.has(gateId));
}

function sharedAssetLibraryCacheNotEvidenceFor(): EncounterSharedAssetLibraryCacheEvent["notEvidenceFor"] {
  return [
    "generated_asset_quality",
    "provider_runtime_readiness",
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
}

function buildSharedAssetLibraryReusePolicy(
  request: Pick<EncounterExecutableAssetGenerationRequest, "targetAssetStore">,
  lookupKey: string,
): EncounterSharedAssetLibraryReusePolicy {
  return {
    lookupKey,
    lookupKeySource: "encounter_definition_semantic_requirements",
    sharedLibraryRefs: {
      blobPrefix: `blob://${request.targetAssetStore.containerName}/shared-encounter-assets/${lookupKey}/`,
      mongooseCollectionName: "shared_encounter_asset_library",
    },
    lruCache: {
      enabled: true,
      maxEntries: 500,
      evictionPolicy: "least_recently_used",
      reuseRequiresEvidenceGateCompatibility: true,
      updateRecencyOnHit: true,
    },
    cacheDisposition: "lookup_before_generate",
  };
}

function buildSharedAssetLibraryLookupKey(input: {
  scenarioId: string;
  targetKind: EncounterGenerationWorkOrderTargetKind;
  actorRole?: string;
  semanticInputs: string[];
}): string {
  return safeWorkOrderSegment([
    input.targetKind,
    input.actorRole ?? "scenario",
    ...input.semanticInputs,
  ].join("__"));
}

function providerRouteForVisualQaRemediation(
  targetKind: EncounterGenerationWorkOrderTargetKind,
): EncounterGenerationProviderRoute {
  if (targetKind === "visual_feedback_closure") {
    return "deterministic-mock";
  }
  if (targetKind === "role_idle_animation_glb" || targetKind === "facial_lipsync_gaze_animation") {
    return "local-runtime-planned";
  }
  return "open-source-local-model-planned";
}

function providerRoutingPreferenceForVisualQaRemediation(
  targetKind: EncounterGenerationWorkOrderTargetKind,
): EncounterGenerationProviderRoutingPreference[] {
  if (targetKind === "visual_feedback_closure") {
    return [
      "local_open_vlm_if_available",
      "frontier_cloud_vlm_requires_approval",
      "deterministic_fixture",
    ];
  }
  if (targetKind === "role_idle_animation_glb" || targetKind === "facial_lipsync_gaze_animation") {
    return [
      "blender_mixamo_style_rigging_fallback",
      "meshy_cloud_requires_approval",
    ];
  }
  if (targetKind === "medical_equipment_glb") {
    return [
      "hunyuan3d_local",
      "meshy_cloud_requires_approval",
      "tripo_cloud_requires_approval",
    ];
  }
  return [
    "meshy_cloud_requires_approval",
    "hunyuan3d_local",
    "blender_mixamo_style_rigging_fallback",
  ];
}

function remediationDimensionForVisualQaCategory(category: string): EncounterHumanoidRemediationDimension {
  const normalized = category.toLowerCase();
  if (normalized.includes("gaze") || normalized.includes("eye")) return "gaze";
  if (normalized.includes("mouth") || normalized.includes("viseme") || normalized.includes("lip")) return "mouth_viseme";
  if (normalized.includes("collision") || normalized.includes("ragdoll") || normalized.includes("posture")) return "posture_collision";
  if (normalized.includes("cloth") || normalized.includes("skin") || normalized.includes("hair")) return "clothing";
  if (normalized.includes("shared") || normalized.includes("cache") || normalized.includes("reuse")) return "shared_asset_reuse";
  return "pose";
}

function requiredSignalRefsForHumanoidRemediationDimension(
  dimension: EncounterHumanoidRemediationDimension,
): string[] {
  const refs: Record<EncounterHumanoidRemediationDimension, string[]> = {
    gaze: ["dialogue_viseme_and_gaze_mapping", "gaze_blink_control_map", "speaker_targeting"],
    mouth_viseme: ["viseme_phoneme_map", "lip_sync_timing_evidence", "viseme_phoneme_alignment_review"],
    pose: ["clinical_idle_animation", "authored_clinical_idle_pose_runtime_cue", "conversation_animation"],
    posture_collision: ["collision_proxy_manifest", "ragdoll_interaction_proxy", "movement_must_preserve_clinical_spatial_blocking"],
    clothing: ["hair_clothing_skin_provenance", "role_appropriate_clothing", "clothing_matches_encounter_role_and_clinical_context"],
    shared_asset_reuse: ["shared_asset_lookup_key", "evidence_gate_compatible_cache_reuse", "lru_cache_reuse_decision"],
  };
  return [...refs[dimension]];
}

function blockerRefsForHumanoidRemediationDimension(
  dimension: EncounterHumanoidRemediationDimension,
): string[] {
  const refs: Record<EncounterHumanoidRemediationDimension, string[]> = {
    gaze: ["gaze_target_quality_not_reviewed"],
    mouth_viseme: ["mouth_viseme_quality_not_reviewed"],
    pose: ["pose_quality_not_reviewed"],
    posture_collision: ["collision_interaction_proxy_not_reviewed"],
    clothing: ["pose_clothing_skin_hair_quality_not_reviewed"],
    shared_asset_reuse: ["shared_asset_reuse_evidence_gate_compatibility_not_reviewed"],
  };
  return [...refs[dimension]];
}

function workerActionsForHumanoidRemediationDimension(
  dimension: EncounterHumanoidRemediationDimension,
): string[] {
  const actions: Record<EncounterHumanoidRemediationDimension, string[]> = {
    gaze: ["plan_actor_targeted_gaze_tracks", "preserve_speaker_targeting_evidence_refs"],
    mouth_viseme: ["plan_dialogue_viseme_timing_tracks", "preserve_phoneme_alignment_review_refs"],
    pose: ["plan_clinical_idle_and_conversation_pose_tracks", "preserve_pose_review_refs"],
    posture_collision: ["plan_collision_proxy_and_ragdoll_interaction_refs", "preserve_contact_safety_review_refs"],
    clothing: ["plan_role_appropriate_clothing_skin_hair_refs", "preserve_license_and_provenance_refs"],
    shared_asset_reuse: ["plan_shared_asset_lookup_before_generation", "preserve_evidence_gate_compatible_lru_reuse_refs"],
  };
  return [...actions[dimension]];
}

function acceptanceCriteriaForHumanoidRemediationDimension(
  dimension: EncounterHumanoidRemediationDimension,
): string[] {
  const criteria: Record<EncounterHumanoidRemediationDimension, string[]> = {
    gaze: ["gaze_plan_targets_current_speaker_or_learner_without_claiming_runtime_quality"],
    mouth_viseme: ["mouth_viseme_plan_preserves_dialogue_timing_without_claiming_lip_sync_quality"],
    pose: ["pose_plan_preserves_clinical_role_context_without_claiming_animation_quality"],
    posture_collision: ["posture_collision_plan_preserves_proxy_requirements_without_claiming_physics_quality"],
    clothing: ["clothing_plan_preserves_role_and_license_context_without_claiming_visual_quality"],
    shared_asset_reuse: ["shared_asset_reuse_plan_requires_evidence_gate_compatible_cache_reuse_before_regeneration"],
  };
  return [
    ...criteria[dimension],
    "provider_execution_remains_disabled_until_operator_approval_and_runtime_evidence_exist",
  ];
}

function isEncounterAssetGenerationQueueMessage(value: unknown): value is AzureStorageQueueEncounterAssetMessage {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== "openclinxr.azure-storage-queue.encounter-asset-generation.v1") return false;
  if (value.queueName !== "encounter-asset-generation") return false;
  if (value.messageKind !== "encounter_definition_to_executable_encounter") return false;
  if (!isRecord(value.request)) return false;
  validateEncounterAssetGenerationRequest(value.request as EncounterExecutableAssetGenerationRequest);
  return true;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePolicy(policy: AssetGenerationJobPolicy): void {
  if (policy.timeoutMs <= 0) {
    throw new Error("Asset generation jobs require a positive timeout");
  }
  if (policy.sandboxWorkdir.trim().length === 0) {
    throw new Error("Asset generation jobs require a sandbox workdir");
  }
  if (policy.allowExternalNetwork) {
    throw new Error("Asset generation jobs must disable external network access");
  }
  if (policy.spendLimitCents !== 0) {
    throw new Error("Asset generation jobs must be configured for zero spend");
  }
  if (policy.runtime.providerKind === "paid-cloud-provider") {
    throw new Error("Asset generation runtime swaps cannot use paid cloud providers");
  }
  if (policy.runtime.transport === "outbound-provider-api") {
    throw new Error("Asset generation runtime swaps cannot call outbound provider APIs");
  }
}

function validateWorkerResult(
  result: AssetGenerationWorkerResult,
  policy: AssetGenerationJobPolicy,
  capabilityId: AssetGenerationCapabilityId,
): void {
  if (policy.requireArtifactManifest && !result.manifest) {
    throw new Error("Asset generation worker did not return a manifest");
  }
  if (result.manifest && result.manifest.capabilityId !== capabilityId) {
    throw new Error(`Asset generation worker returned manifest for ${result.manifest.capabilityId}, expected ${capabilityId}`);
  }
  if (policy.requireLicenseProvenance && !result.provenance?.license) {
    throw new Error("Asset generation worker did not return license provenance");
  }
  if (result.provenance.externalNetworkUsed) {
    throw new Error("Asset generation worker reported external network use");
  }
  if (result.provenance.spendCents !== 0) {
    throw new Error("Asset generation worker reported non-zero spend");
  }
}

function describeAdapter(adapter: AssetGenerationWorkerAdapter): AssetGenerationWorkerDescriptor {
  return {
    providerId: adapter.providerId,
    providerKind: adapter.providerKind,
    implementationLanguage: adapter.implementationLanguage,
    transport: adapter.transport,
  };
}

function createDefaultId(): string {
  return `asset-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneAssetGenerationJobRecord<TPayload>(
  record: AssetGenerationJobRecord<TPayload>,
): AssetGenerationJobRecord<TPayload> {
  return JSON.parse(JSON.stringify(record)) as AssetGenerationJobRecord<TPayload>;
}

const noNativeWorkerCommandRunner: CommandRunner = {
  async run() {
    throw new Error("No command runner configured for native asset generation worker");
  },
};
