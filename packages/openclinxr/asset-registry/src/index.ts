import { type Scenario, type ValidationResult, validateAssetManifest as validateSharedAssetManifest } from "@openclinxr/shared-schemas";

export * from "./asset-writer.js";
export type {
  AssetObjectStore,
  AssetObjectStoreGetInput,
  AssetObjectStoreGetResult,
  AssetObjectStorePutInput,
  AssetObjectStorePutResult,
  AzuriteAssetObjectStoreOptions,
} from "./object-store.js";
export * from "./runtime-asset-review.js";
export * from "./runtime-bundles.js";

export type AssetKind = "character" | "environment" | "equipment" | "prop" | "texture" | "audio";

export type AssetTargetRuntime = "quest3_webxr" | "desktop_webxr";

export type AssetGenerationMethod = "procedural_placeholder" | "makehuman2" | "anny" | "stablegen" | "smplitex" | "manual_modeling";

export type AssetLicenseStatus = "approved" | "permissive_review_required" | "copyleft_blocked" | "unknown";

export type AssetPipelineLane =
  | "human_base_mesh"
  | "skin_texture"
  | "clothing"
  | "rigging"
  | "animation"
  | "face_lip_sync"
  | "environment_equipment"
  | "optimization";

export type AssetToolRuntimePlacement =
  | "local_or_ci_authoring"
  | "offline_gpu_authoring"
  | "external_commercial_adapter"
  | "production_runtime";

export type AssetToolLicensePolicy =
  | "production_allowed"
  | "authoring_output_allowed"
  | "sidecar_review_required"
  | "blocked_without_exception";

export type AssetPipelineTool = {
  toolId: string;
  displayName: string;
  lanes: AssetPipelineLane[];
  sourceRefs: string[];
  licenseSummary: string;
  licensePolicy: AssetToolLicensePolicy;
  runtimePlacement: AssetToolRuntimePlacement;
  preferredForInitialBuild: boolean;
  hardRequirements: string[];
  approvalBlockers: string[];
  requiredOutputEvidence: string[];
  prohibitedUses: string[];
};

export type AssetPipelineToolReadiness = {
  toolId: string;
  authoringAllowedNow: boolean;
  productionRuntimeAllowed: boolean;
  sidecarCandidate: boolean;
  blockers: string[];
  warnings: string[];
};

export type AssetPipelineToolMatrixReadiness = {
  authoringReadyToolIds: string[];
  sidecarCandidateToolIds: string[];
  blockedToolIds: string[];
  productionRuntimeToolIds: string[];
  policyBlockers: string[];
};

export type AssetPipelineStageName = "requested" | "source_reviewed" | "mesh_generated" | "rigged" | "optimized" | "qa_ready";

export type AssetPipelineStage = {
  stage: AssetPipelineStageName;
  completedAt: string;
  notes: string;
};

export type AssetQuestQaStatus = {
  status: "not_reviewed" | "placeholder_dev_ready" | "sim_qa_ready" | "failed";
  reviewedAt: string;
  limitations: string[];
};

export type AssetOptimizationEvidence = {
  lodTiers?: string[];
  textureCompressionFormat?: string;
  textureBudgetReportId?: string;
  colliderSimplificationReportId?: string;
};

export type AssetGenerationEvidence = {
  generatedHumanRiggingReportId?: string;
  skinClothingProvenanceId?: string;
  medicalEquipmentLibraryRecordId?: string;
  animationRetargetingReportId?: string;
};

export type HumanoidRealismMetadata = {
  schemaVersion: "openclinxr.humanoid-realism-metadata.v1";
  actorRole: string;
  metadataScope: "review_contract_only";
  fixtureStatus: {
    fixtureOnly: boolean;
    nonProduction: true;
    materializedAssetGenerated: false;
  };
  claimBoundaries: {
    productionReadinessClaimed: false;
    questReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
  };
  faceAndMouthControls: {
    facialBlendshapeMapRef: string;
    requiredBlendshapeIds: string[];
    visemeMapRef: string;
    requiredVisemeIds: string[];
    mouthSyncNeeds: string[];
  };
  eyeAndGazeControls: {
    gazeControlMapRef: string;
    blinkControlMapRef: string;
    eyeContactTargets: {
      defaultTarget: "learner_camera";
      allowedTargetKinds: Array<"learner_camera" | "actor" | "clinical_object">;
      targetActorIds: string[];
    };
    gazeLimitations: string[];
  };
  poseAndAnimationNeeds: {
    locomotionClipNeeds: string[];
    idleClipNeeds: string[];
    conversationGestureNeeds: string[];
    postureConstraints: string[];
  };
  appearanceConstraints: {
    clothing: string[];
    skinMaterial: string[];
    hairOrHeadCovering: string[];
    protectedClassAndIdentityConstraints: string[];
  };
  collisionAndInteractionProxyNeeds: {
    requiredProxyIds: string[];
    interactionProxyLimitations: string[];
  };
  provenanceAndLicenseNeeds: {
    requiredRefs: string[];
    prohibitedSourcePosture: string[];
  };
  limitations: string[];
  visualQaBlockers: string[];
  requiredReviewEvidenceIds: string[];
};

export type AssetManifest = {
  assetId: string;
  scenarioId: string;
  kind: AssetKind;
  displayName: string;
  description: string;
  requiredForScenario: boolean;
  targetRuntime: AssetTargetRuntime;
  provenance: {
    generationMethod: AssetGenerationMethod;
    sourceRefs: string[];
    licenseStatus: AssetLicenseStatus;
  };
  generationEvidence?: AssetGenerationEvidence;
  humanoidRealismMetadata?: HumanoidRealismMetadata;
  optimizationEvidence?: AssetOptimizationEvidence;
  questQaStatus: AssetQuestQaStatus;
  geometryBudget: {
    maxTriangles: number;
    maxTextureMegabytes: number;
    maxDrawCalls: number;
  };
  pipelineStages: AssetPipelineStage[];
  tags: string[];
};

export type AssetReadiness = {
  assetId: string;
  devReady: boolean;
  productionReady: boolean;
  blockers: string[];
  productionBlockers: string[];
  warnings: string[];
};

export type AssetProductionReadinessStepName =
  | "provenance_license"
  | "generation_evidence"
  | "optimization_evidence"
  | "quest_qa"
  | "visual_clinical_critique"
  | "production_release";

export type AssetProductionReadinessStep = {
  step: AssetProductionReadinessStepName;
  status: "complete" | "blocked";
  evidenceRefs: string[];
  blockers: string[];
};

export type AssetProductionReadinessLadder = {
  assetId: string;
  scenarioId: string;
  productionReady: boolean;
  blockers: string[];
  steps: AssetProductionReadinessStep[];
};

export type AssetProductionReviewPacket = {
  assetId: string;
  scenarioId: string;
  displayName: string;
  kind: AssetKind;
  targetRuntime: AssetTargetRuntime;
  productionReady: boolean;
  claimBoundary: "review_packet_not_release_approval";
  nextReviewStep: AssetProductionReadinessStepName | null;
  blockerCount: number;
  evidenceChecklist: Array<AssetProductionReadinessStep & {
    recommendedAction: string;
  }>;
};

export type EnvironmentGenerationReviewGateName =
  | "provenance_license"
  | "attach_environment_generation_evidence"
  | "attach_optimization_evidence"
  | "visual_clinical_critique"
  | "quest_runtime_evidence";

export type EnvironmentGenerationReviewGate = {
  gate: EnvironmentGenerationReviewGateName;
  status: "complete" | "blocked";
  evidenceRefs: string[];
  blockers: string[];
  recommendedAction: string;
};

export type EnvironmentSpatialZone = {
  zoneId: "learner_entry" | "patient_bedside" | "nurse_workflow" | "family_interrupt" | "diagnostic_equipment";
  label: string;
  purpose: string;
  assetIds: string[];
  spatialAnchors: string[];
  clinicalFidelityNotes: string[];
};

export type EnvironmentGenerationPacket = {
  scenarioId: string;
  environmentAssetId: string;
  displayName: string;
  targetRuntime: AssetTargetRuntime;
  claimBoundary: "environment_generation_plan_not_generated_asset";
  requiredAssetIds: string[];
  optionalContextAssetIds: string[];
  spatialZones: EnvironmentSpatialZone[];
  questBudget: ScenarioAssetBudget;
  authoringToolIds: string[];
  sidecarToolIds: string[];
  blockedToolIds: string[];
  productionRuntimeToolIds: string[];
  reviewGates: EnvironmentGenerationReviewGate[];
  nextReviewGate: EnvironmentGenerationReviewGateName | null;
  readyForGenerationReview: boolean;
};

export type EnvironmentGenerationQueue = {
  scenarioCount: number;
  packetCount: number;
  readyForGenerationReviewScenarioIds: string[];
  blockedScenarioIds: string[];
  nextReviewGateCounts: Partial<Record<EnvironmentGenerationReviewGateName, number>>;
  packets: EnvironmentGenerationPacket[];
};

export type EnvironmentGenerationWorkOrderTaskId =
  | "prepare_scene_layout"
  | "model_static_room_shell"
  | "place_required_equipment"
  | "export_quest_budget_reports"
  | "request_clinical_visual_review";

export type EnvironmentGenerationWorkOrderTask = {
  taskId: EnvironmentGenerationWorkOrderTaskId;
  title: string;
  status: "pending";
  instructions: string;
  evidenceOutputs: string[];
};

export type EnvironmentGenerationOperatorHandoff = {
  summary: string;
  nextAction: string;
  missingEvidenceIds: string[];
  reviewBlockerIds: string[];
  claimBoundary: "operator_handoff_not_asset_generation";
};

export type EnvironmentGenerationWorkOrder = {
  workOrderId: string;
  scenarioId: string;
  environmentAssetId: string;
  targetRuntime: AssetTargetRuntime;
  authoringToolId: string;
  claimBoundary: "authoring_work_order_not_generated_asset";
  nextEvidenceGate: EnvironmentGenerationReviewGateName | null;
  status: "blocked_pending_evidence" | "ready_for_generation_review";
  requiredOutputEvidence: string[];
  assetBundle: {
    requiredAssetIds: string[];
    optionalContextAssetIds: string[];
    spatialZoneCount: number;
    spatialAnchorCount: number;
  };
  tasks: EnvironmentGenerationWorkOrderTask[];
  prohibitedActions: string[];
  operatorHandoff: EnvironmentGenerationOperatorHandoff;
};

export type EnvironmentGenerationWorkOrderQueue = {
  scenarioCount: number;
  workOrderCount: number;
  blockedWorkOrderCount: number;
  pendingTaskCount: number;
  readyForGenerationReviewWorkOrderIds: string[];
  claimBoundary: "work_order_queue_not_asset_production";
  nextEvidenceGateCounts: Partial<Record<EnvironmentGenerationReviewGateName, number>>;
  prohibitedActionCounts: Record<string, number>;
  missingEvidenceCounts: Record<string, number>;
  workOrders: EnvironmentGenerationWorkOrder[];
};

export type SceneGenerationPipelineStageId =
  | "admin_scenario_configuration"
  | "asset_need_expansion"
  | "humanoid_generation"
  | "hair_clothing_skin_generation"
  | "rigging_animation_generation"
  | "equipment_environment_generation"
  | "blob_storage_publication"
  | "runtime_bundle_binding"
  | "review_and_quest_evidence";

export type SceneGenerationPipelineStage = {
  stageId: SceneGenerationPipelineStageId;
  title: string;
  status: "pending";
  initiatedBy: "admin_user_after_scenario_configuration";
  requiredInputs: string[];
  expectedOutputs: string[];
};

export type SceneGenerationActorWorkOrder = {
  workOrderId: string;
  actorId: string;
  actorRole: string;
  displayName: string;
  characterAssetId: string;
  source: "scenario_actor_definition";
  ageBand: "adult" | "child_or_adolescent" | "contextual_adult";
  appearanceCues: {
    roleAppropriateClothing: string[];
    hairOrHeadCovering: string[];
    skinMaterial: string[];
  };
  riggingAndAnimationCues: string[];
  humanoidRuntimeReadinessHandoff: {
    claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only";
    actorRole: string;
    requiredSignalIds: string[];
    locomotionRequired: boolean;
    expressionRequired: boolean;
    gazeRequired: boolean;
    lipSyncRequired: boolean;
    interactiveRequired: boolean;
    blockers: string[];
    notEvidenceFor: Array<"generated_humanoid_asset_readiness" | "animation_quality" | "quest_readiness" | "runtime_readiness" | "clinical_validity" | "scoring_validity">;
  };
  humanoidRealismMetadata: HumanoidRealismMetadata;
  provenanceAndLicensingRefs: string[];
  optimizationAndPerformanceRefs: string[];
  requiredEvidenceIds: string[];
  evidenceGateRefs: string[];
  claimBoundary: "metadata_work_order_not_generated_asset";
};

export type SceneGenerationEnvironmentWorkOrder = {
  workOrderId: string;
  environmentAssetId: string;
  equipmentAssetIds: string[];
  requiredEvidenceIds: string[];
  provenanceAndLicensingRefs: string[];
  optimizationAndPerformanceRefs: string[];
  evidenceGateRefs: string[];
  claimBoundary: "metadata_work_order_not_generated_asset";
};

export type ScenarioSceneGenerationPipelineWorkOrder = {
  workOrderId: string;
  scenarioId: string;
  scenarioStatus: Scenario["status"];
  initiatedFrom: "admin_scenario_configuration";
  claimBoundary: "admin_initiated_pipeline_contract_not_generated_asset";
  approvalBoundary: "scenario_status_preserved_no_generation_approval_inferred";
  targetRuntime: AssetTargetRuntime;
  storageTarget: {
    storeKind: "azurite_blob" | "azure_blob";
    containerName: string;
    blobPrefix: string;
    emulatorAllowed: boolean;
  };
  scenarioAssetIds: string[];
  characterAssetIds: string[];
  environmentAssetIds: string[];
  equipmentAssetIds: string[];
  pipelineStageCount: number;
  stages: SceneGenerationPipelineStage[];
  actorWorkOrders: SceneGenerationActorWorkOrder[];
  environmentWorkOrder: SceneGenerationEnvironmentWorkOrder;
  requiredOutputEvidence: string[];
  prohibitedActions: string[];
};

export type ScenarioSceneGenerationPipelineWorkOrderQueue = {
  scenarioCount: number;
  workOrderCount: number;
  pendingStageCount: number;
  claimBoundary: "scene_generation_pipeline_queue_not_asset_production";
  featuredFactoryPlanningScenarioId: string | null;
  featuredFactoryPlanningWorkOrderId: string | null;
  factoryPlanningClaimBoundary: "review_gated_factory_metadata_only";
  generationApprovalInferred: false;
  storageTargets: Array<ScenarioSceneGenerationPipelineWorkOrder["storageTarget"]>;
  workOrders: ScenarioSceneGenerationPipelineWorkOrder[];
};

export type ScenarioAssetProductionReadinessLadder = {
  scenarioId: string;
  productionReady: boolean;
  assetCount: number;
  productionReadyAssetIds: string[];
  blockedAssetIds: string[];
  missingRequiredAssetIds: string[];
  blockers: string[];
  stationBudget: ScenarioAssetBudget;
  assetLadders: AssetProductionReadinessLadder[];
};

export type EncounterAssetReadinessBehaviorCategory = "animation" | "emotion" | "gaze" | "lip_sync";

export type EncounterSharedAssetLibraryLookupKey = {
  targetKind: "role_specific_humanoid_glb" | "role_idle_animation_glb" | "facial_lipsync_gaze_animation" | "environment_shell_glb" | "medical_equipment_glb";
  actorRole: string | null;
  semanticInputs: string[];
  lookupKey: string;
};

export type EncounterActorAssetNeed = {
  actorId: string;
  actorRole: string;
  assetNeedId: string;
  hasExplicitAssetNeed: boolean;
  inferredFromActorId: boolean;
  behaviorCategoryRequirements: Record<EncounterAssetReadinessBehaviorCategory, string[]>;
  sharedAssetLibraryLookupKeys: EncounterSharedAssetLibraryLookupKey[];
};

export type EncounterEnvironmentAssetNeed = {
  environmentId: string;
  assetNeedId: string;
  hasExplicitAssetNeed: boolean;
  roomSemanticTokens: string[];
  sharedAssetLibraryLookupKey: EncounterSharedAssetLibraryLookupKey;
};

export type EncounterEquipmentAssetNeed = {
  source: string;
  assetNeedId: string;
  hasExplicitAssetNeed: boolean;
  semanticTokens: string[];
  sharedAssetLibraryLookupKey: EncounterSharedAssetLibraryLookupKey;
};

export type EncounterAssetNeedsReadinessManifest = {
  schemaVersion: "openclinxr.encounter-asset-needs-readiness.v1";
  scenarioId: string;
  scenarioTitle: string;
  scenarioStatus: Scenario["status"];
  generatedAt: string;
  requiredHumanoids: EncounterActorAssetNeed[];
  requiredEnvironment: EncounterEnvironmentAssetNeed | null;
  requiredPropsAndEquipment: EncounterEquipmentAssetNeed[];
  animationRequirements: {
    requiredSignalIds: string[];
    requiredAssetKinds: string[];
  };
  emotionRequirements: {
    requiredSignalIds: string[];
    requiredAssetKinds: string[];
  };
  gazeRequirements: {
    requiredSignalIds: string[];
    requiredAssetKinds: string[];
  };
  lipSyncRequirements: {
    requiredSignalIds: string[];
    requiredAssetKinds: string[];
  };
  sharedAssetLibrarySemanticKeys: string[];
  missingRequiredAssetNeedIds: string[];
  blockers: string[];
  warnings: string[];
  readyForDeterministicGeneration: boolean;
};

type EncounterProfileNeeds = {
  animation: string[];
  emotion: string[];
  gaze: string[];
  lipSync: string[];
  assetKinds: {
    animation: string[];
    emotion: string[];
    gaze: string[];
    lipSync: string[];
  };
};

export type ScenarioAssetReadiness = {
  scenarioId: string;
  devReady: boolean;
  productionReady: boolean;
  stationBudget: ScenarioAssetBudget;
  missingRequiredAssetIds: string[];
  blockedAssets: Array<{
    assetId: string;
    blockers: string[];
  }>;
  productionBlockedAssets: Array<{
    assetId: string;
    blockers: string[];
  }>;
  productionReadinessLadder?: ScenarioAssetProductionReadinessLadder;
};

export type ScenarioAssetBudget = {
  maxVisibleTriangles: number;
  maxTextureMegabytes: number;
  maxDrawCalls: number;
  totalTriangles: number;
  totalTextureMegabytes: number;
  totalDrawCalls: number;
  blockers: string[];
};

export type ScenarioOptimizationEvidence = {
  lodTiersObserved: boolean;
  textureCompressionBudgetObserved: boolean;
  colliderSimplificationObserved: boolean;
  placeholderOnly: boolean;
  blockers: string[];
};

export type ScenarioGenerationEvidence = {
  generatedHumanRiggingObserved: boolean;
  skinClothingProvenanceObserved: boolean;
  medicalEquipmentLibraryObserved: boolean;
  animationRetargetingObserved: boolean;
  placeholderOnly: boolean;
  blockers: string[];
};

const quest3AssetBudget = {
  maxTriangles: 60000,
  maxTextureMegabytes: 64,
  maxDrawCalls: 24,
};

const quest3StationBudget = {
  maxVisibleTriangles: 180000,
  maxTextureMegabytes: 512,
  maxDrawCalls: 120,
};

const encounterReadinessManifestTimestamp = "2026-05-25T00:00:00.000Z";
const encounterReadinessTraceTagNeedMap: Record<string, {
  animation: string[];
  emotion: string[];
  gaze: string[];
  lipSync: string[];
  assetKinds: {
    animation: string[];
    emotion: string[];
    gaze: string[];
    lipSync: string[];
  };
}> = {
  history_opqrst: {
    animation: ["history_question_pose", "history_turn_taking_animation"],
    emotion: ["concerned_listen_and_build_rapport"],
    gaze: ["learner_camera_transition_to_speaker"],
    lipSync: ["clear_questioning_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  risk_factor_question: {
    animation: ["risk_review_turn_taking_animation", "risk_focus_body_posture_shift"],
    emotion: ["risk_discussion_clarity"],
    gaze: ["speaker_facing_shift"],
    lipSync: ["rationale_focused_pauses"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  associated_symptom_question: {
    animation: ["symptom_discussion_pose", "symptom_listening_pose"],
    emotion: ["reassurance_during_exploration"],
    gaze: ["learner_camera_and_patient_alignment"],
    lipSync: ["empathetic_question_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  vitals_review: {
    animation: ["monitor_check_pose", "urgent_focus_step", "ecg_request_transition"],
    emotion: ["escalation_attention"],
    gaze: ["monitor_and_provider_head_turn"],
    lipSync: ["short_directive_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity", "stress_signal_stability"],
      gaze: ["speaker_targeting", "monitor_targeting"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  ecg_request: {
    animation: ["order_acknowledgement_pose", "order_delivery_animation"],
    emotion: ["urgency_tempered_by_clarity"],
    gaze: ["team_member_targeting"],
    lipSync: ["directive_pronunciation_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity", "stress_signal_stability"],
      gaze: ["speaker_targeting", "team_gaze_reallocation"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  oxygen_request: {
    animation: ["urgent_order_pose", "order_confirmation_motion"],
    emotion: ["focus_and_stability_under_time_pressure"],
    gaze: ["team_and_patient_target_switch"],
    lipSync: ["order_clarity_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity", "stress_signal_stability"],
      gaze: ["speaker_targeting", "team_gaze_reallocation"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  urgent_escalation: {
    animation: ["escalation_posture_shift", "closed_loop_escalation_pose"],
    emotion: ["heightened_attentive_state"],
    gaze: ["distributed_attention_scan"],
    lipSync: ["compressed_escalation_timing"],
    assetKinds: {
      animation: ["conversation_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity", "stress_signal_stability"],
      gaze: ["team_gaze_reallocation", "learner_camera_safety_scan"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  team_communication: {
    animation: ["team_turn_taking_pose", "role_check_pose"],
    emotion: ["team_alignment_readiness"],
    gaze: ["team_member_targeting"],
    lipSync: ["closed_loop_turn_taking_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity", "team_confidence_transfer"],
      gaze: ["speaker_targeting", "team_targeting"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  family_communication: {
    animation: ["interruption_acknowledgement_pose", "family_checkin_pose"],
    emotion: ["concern_regulation_support"],
    gaze: ["family_targeting"],
    lipSync: ["empathetic_reassurance_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity", "family_warmth_modulation"],
      gaze: ["speaker_targeting", "family_targeting"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  empathy_statement: {
    animation: ["empathy_pause_pose", "reflective_acknowledgement_motion"],
    emotion: ["empathy_presence"],
    gaze: ["softened_face_alignment"],
    lipSync: ["empathetic_vocal_pause_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation"],
      emotion: ["emotion_tone_continuity", "empathy_projection"],
      gaze: ["eye_contact_softening"],
      lipSync: ["viseme_phoneme_map", "dialogue_viseme_and_gaze_mapping"],
    },
  },
  work_of_breathing_assessment: {
    animation: ["assessment_pose", "clinical_focus_stillness"],
    emotion: ["observant_attention_state"],
    gaze: ["symptom_focus_gaze", "breath_sign_visibility_scan"],
    lipSync: ["assessment_query_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting", "symptom_focus_gaze"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  trigger_history: {
    animation: ["history_review_pose", "clarifying_followup_pose"],
    emotion: ["timeline_recall_support"],
    gaze: ["supportive_turn_direction"],
    lipSync: ["followup_probe_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  inhaler_history: {
    animation: ["history_review_pose", "clarifying_followup_pose"],
    emotion: ["timeline_recall_support"],
    gaze: ["supportive_turn_direction"],
    lipSync: ["followup_probe_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
  patient_note_submitted: {
    animation: ["completion_pose", "handoff_preparation_pose"],
    emotion: ["closure_readiness"],
    gaze: ["final_confirmation_alignment"],
    lipSync: ["handoff_turn_timing"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["learner_camera_lock"],
      lipSync: ["viseme_phoneme_map"],
    },
  },
};

const encounterReadinessRoleDefaults: Record<string, {
  animation: string[];
  emotion: string[];
  gaze: string[];
  lipSync: string[];
  assetKinds: {
    animation: string[];
    emotion: string[];
    gaze: string[];
    lipSync: string[];
  };
}> = {
  patient: {
    animation: ["clinical_idle_animation", "conversation_animation"],
    emotion: ["patient_reporting_affect_clarity"],
    gaze: ["learner_camera_facing", "speaker_targeting"],
    lipSync: ["patient_voice_projection"],
    assetKinds: {
      animation: ["clinical_idle_animation", "conversation_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["dialogue_gaze_profile"],
      lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
    },
  },
  nurse: {
    animation: ["clinical_idle_animation", "conversation_animation", "alertness_adjustment"],
    emotion: ["calm_under_pressure_clarity"],
    gaze: ["team_and_learnercamera_targeting"],
    lipSync: ["directive_clarity_timing"],
    assetKinds: {
      animation: ["clinical_idle_animation", "conversation_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity", "stress_signal_stability"],
      gaze: ["team_targeting", "speaker_targeting"],
      lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
    },
  },
  family: {
    animation: ["clinical_idle_animation", "conversation_animation", "concern_response_wait_pose"],
    emotion: ["concern_acknowledgement_clarity"],
    gaze: ["learner_camera_and_actor_targeting"],
    lipSync: ["concern_statement_timing"],
    assetKinds: {
      animation: ["clinical_idle_animation", "conversation_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity", "family_warmth_modulation"],
      gaze: ["speaker_targeting", "family_targeting"],
      lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
    },
  },
  physician: {
    animation: ["clinical_idle_animation", "conversation_animation", "directive_pose"],
    emotion: ["clinical_confidence_projection"],
    gaze: ["team_and_learner_camera_targeting"],
    lipSync: ["clinical_directive_timing"],
    assetKinds: {
      animation: ["clinical_idle_animation", "conversation_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["team_targeting", "speaker_targeting"],
      lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
    },
  },
  interpreter: {
    animation: ["clinical_idle_animation", "conversation_animation", "language_facilitation_pose"],
    emotion: ["clarity_preservation"],
    gaze: ["speaker_and_learner_switch"],
    lipSync: ["translation_aware_timing"],
    assetKinds: {
      animation: ["clinical_idle_animation", "conversation_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting", "audience_targeting"],
      lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
    },
  },
  medical_assistant: {
    animation: ["clinical_idle_animation", "conversation_animation", "assistive_pose"],
    emotion: ["supportive_clinical_presence"],
    gaze: ["task_facing"],
    lipSync: ["instruction_clarity_timing"],
    assetKinds: {
      animation: ["clinical_idle_animation", "conversation_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting", "task_targeting"],
      lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
    },
  },
  respiratory_therapist: {
    animation: ["clinical_idle_animation", "conversation_animation", "therapy_equipment_pose"],
    emotion: ["calm_technical_communication"],
    gaze: ["equipment_and_actor_targeting"],
    lipSync: ["equipment_instruction_timing"],
    assetKinds: {
      animation: ["clinical_idle_animation", "conversation_animation", "role_idle_animation_glb"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting", "equipment_targeting"],
      lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
    },
  },
};

export const recommendedAssetPipelineTools: AssetPipelineTool[] = [
  {
    toolId: "anny",
    displayName: "Anny",
    lanes: ["human_base_mesh"],
    sourceRefs: ["src-anny-github-2026"],
    licenseSummary: "Apache-2.0 code with CC0 adapted assets noted in the technology brief.",
    licensePolicy: "authoring_output_allowed",
    runtimePlacement: "local_or_ci_authoring",
    preferredForInitialBuild: true,
    hardRequirements: ["per_asset_provenance", "body_diversity_review", "quest_lod_export"],
    approvalBlockers: [],
    requiredOutputEvidence: ["source_license_record", "mesh_topology_report", "quest_budget_report"],
    prohibitedUses: ["live_quest_runtime_generation", "unreviewed_identity_replica_generation"],
  },
  {
    toolId: "blender",
    displayName: "Blender",
    lanes: ["human_base_mesh", "clothing", "environment_equipment", "optimization"],
    sourceRefs: ["src-blender-license-2026"],
    licenseSummary: "GPL-licensed executable acceptable as an external authoring tool; do not embed Blender source or scripts into production runtime without review.",
    licensePolicy: "authoring_output_allowed",
    runtimePlacement: "local_or_ci_authoring",
    preferredForInitialBuild: true,
    hardRequirements: ["headless_bake_script", "deterministic_export_settings", "asset_license_manifest"],
    approvalBlockers: [],
    requiredOutputEvidence: ["blender_bake_report", "gltf_validation_report", "quest_budget_report"],
    prohibitedUses: ["production_runtime_dependency", "bundled_binary_without_distribution_review"],
  },
  {
    toolId: "makehuman_outputs",
    displayName: "MakeHuman / MPFB Outputs",
    lanes: ["human_base_mesh", "clothing"],
    sourceRefs: ["src-makehuman-community-license-2026", "src-makehuman-makeclothes-github-2026"],
    licenseSummary: "Application/source packages are AGPL/GPL in places, while core assets are documented as CC0; use reviewed outputs only.",
    licensePolicy: "authoring_output_allowed",
    runtimePlacement: "local_or_ci_authoring",
    preferredForInitialBuild: false,
    hardRequirements: ["asset_output_license_record", "no_makehuman_source_embedding", "human_review_for_clinical_realism"],
    approvalBlockers: [],
    requiredOutputEvidence: ["asset_license_manifest", "mesh_topology_report", "quest_budget_report"],
    prohibitedUses: ["shipping_makehuman_source", "production_runtime_dependency", "unreviewed_community_assets"],
  },
  {
    toolId: "mesh2motion",
    displayName: "Mesh2Motion",
    lanes: ["rigging", "animation"],
    sourceRefs: ["src-mesh2motion-2026"],
    licenseSummary: "MIT code with exported animation-content claims that still require output QA.",
    licensePolicy: "authoring_output_allowed",
    runtimePlacement: "local_or_ci_authoring",
    preferredForInitialBuild: true,
    hardRequirements: ["rig_deformation_qa", "animation_retarget_report", "quest_lod_export"],
    approvalBlockers: [],
    requiredOutputEvidence: ["rig_validation_report", "motion_retarget_report", "quest_animation_budget_report"],
    prohibitedUses: ["live_quest_runtime_rigging", "unreviewed_patient_motion_library_release"],
  },
  {
    toolId: "skintokens_tokenrig",
    displayName: "SkinTokens / TokenRig",
    lanes: ["rigging"],
    sourceRefs: ["src-skintokens-github-2026"],
    licenseSummary: "MIT code, but local inference path documents Python 3.11, CUDA, flash-attn, and NVIDIA GPU memory requirements; model/data provenance still requires review.",
    licensePolicy: "sidecar_review_required",
    runtimePlacement: "offline_gpu_authoring",
    preferredForInitialBuild: false,
    hardRequirements: ["cuda_gpu_worker_or_external_gpu_box", "model_data_provenance_review", "rig_deformation_qa"],
    approvalBlockers: ["not_apple_silicon_default", "cuda_gpu_required", "model_data_provenance_review_required"],
    requiredOutputEvidence: ["skeleton_hierarchy_report", "skin_weight_quality_report", "retargeting_qa_report"],
    prohibitedUses: ["quest_runtime_dependency", "default_m4_local_pipeline", "production_adoption_without_model_provenance_review"],
  },
  {
    toolId: "stablegen",
    displayName: "StableGen",
    lanes: ["skin_texture"],
    sourceRefs: ["src-stablegen-github-2026"],
    licenseSummary: "GPL-3.0 source path; treat as blocked unless counsel approves an isolated authoring exception.",
    licensePolicy: "blocked_without_exception",
    runtimePlacement: "offline_gpu_authoring",
    preferredForInitialBuild: false,
    hardRequirements: ["legal_exception", "isolated_authoring_environment", "texture_provenance_manifest"],
    approvalBlockers: ["gpl3_source_path", "legal_exception_required"],
    requiredOutputEvidence: ["texture_provenance_manifest", "derivative_asset_review", "clinical_skin_tone_bias_review"],
    prohibitedUses: ["production_runtime_dependency", "default_local_pipeline", "committed_generated_texture_without_license_review"],
  },
  {
    toolId: "audio2face_adapter",
    displayName: "NVIDIA ACE / Audio2Face Adapter",
    lanes: ["face_lip_sync", "animation"],
    sourceRefs: ["src-nvidia-ace-audio2face-2026"],
    licenseSummary: "Commercial/proprietary adapter candidate, not an open-source baseline.",
    licensePolicy: "sidecar_review_required",
    runtimePlacement: "external_commercial_adapter",
    preferredForInitialBuild: false,
    hardRequirements: ["commercial_terms_review", "deployment_cost_review", "voice_face_safety_review"],
    approvalBlockers: ["commercial_terms_review_required", "cloud_or_gpu_dependency_review_required"],
    requiredOutputEvidence: ["latency_report", "lip_sync_quality_report", "data_processing_review"],
    prohibitedUses: ["unapproved_cloud_runtime", "default_local_development_dependency"],
  },
];

export function evaluateAssetPipelineTool(tool: AssetPipelineTool): AssetPipelineToolReadiness {
  const blockers = [...tool.approvalBlockers];
  const warnings: string[] = [];

  if (!tool.sourceRefs.some((sourceRef) => sourceRef.trim().length > 0)) {
    blockers.push("missing_source_refs");
  }
  if (tool.licensePolicy === "blocked_without_exception") {
    blockers.push("license_exception_required");
  }
  if (tool.runtimePlacement === "production_runtime" && tool.licensePolicy !== "production_allowed") {
    blockers.push("production_runtime_license_policy_not_allowed");
  }
  if (tool.runtimePlacement !== "production_runtime") {
    warnings.push("not_a_production_runtime_dependency");
  }
  if (!tool.preferredForInitialBuild) {
    warnings.push("not_preferred_for_initial_build");
  }

  return {
    toolId: tool.toolId,
    authoringAllowedNow: blockers.length === 0
      && (tool.licensePolicy === "production_allowed" || tool.licensePolicy === "authoring_output_allowed"),
    productionRuntimeAllowed: blockers.length === 0
      && tool.runtimePlacement === "production_runtime"
      && tool.licensePolicy === "production_allowed",
    sidecarCandidate: tool.licensePolicy === "sidecar_review_required",
    blockers,
    warnings,
  };
}

export function evaluateAssetPipelineToolMatrix(tools: readonly AssetPipelineTool[] = recommendedAssetPipelineTools): AssetPipelineToolMatrixReadiness {
  const readiness = tools.map((tool) => evaluateAssetPipelineTool(tool));
  const authoringReadyToolIds = readiness.filter((tool) => tool.authoringAllowedNow).map((tool) => tool.toolId);
  const sidecarCandidateToolIds = readiness.filter((tool) => tool.sidecarCandidate).map((tool) => tool.toolId);
  const blockedToolIds = readiness.filter((tool) => tool.blockers.length > 0 && !tool.sidecarCandidate).map((tool) => tool.toolId);
  const productionRuntimeToolIds = readiness.filter((tool) => tool.productionRuntimeAllowed).map((tool) => tool.toolId);
  const policyBlockers = readiness.flatMap((tool) => tool.blockers.map((blocker) => `${tool.toolId}:${blocker}`));

  return {
    authoringReadyToolIds,
    sidecarCandidateToolIds,
    blockedToolIds,
    productionRuntimeToolIds,
    policyBlockers,
  };
}

export function selectAssetPipelineToolsForLane(
  lane: AssetPipelineLane,
  tools: readonly AssetPipelineTool[] = recommendedAssetPipelineTools,
): AssetPipelineTool[] {
  return tools
    .filter((tool) => tool.lanes.includes(lane))
    .sort((left, right) => Number(right.preferredForInitialBuild) - Number(left.preferredForInitialBuild));
}

export function evaluateAssetManifest(manifest: AssetManifest): AssetReadiness {
  const blockers: string[] = [];
  const productionBlockers: string[] = [];
  const warnings: string[] = [];
  const runtimeManifest = manifest as AssetManifest & {
    geometryBudget?: AssetManifest["geometryBudget"];
    pipelineStages?: AssetManifest["pipelineStages"];
    provenance?: AssetManifest["provenance"];
    questQaStatus?: AssetQuestQaStatus;
  };
  const stages = new Set((runtimeManifest.pipelineStages ?? []).map((stage) => stage.stage));
  const licenseStatus = runtimeManifest.provenance?.licenseStatus;

  if (!licenseStatus) {
    blockers.push("license_status_missing");
  }
  if (!runtimeManifest.geometryBudget) {
    blockers.push("optimization_target_missing");
  }
  if (!runtimeManifest.questQaStatus) {
    blockers.push("quest_qa_status_missing");
  }
  if (licenseStatus === "copyleft_blocked") {
    blockers.push("license_copyleft_blocked");
  }
  if (licenseStatus === "unknown") {
    blockers.push("license_unknown");
  }
  if (licenseStatus === "permissive_review_required") {
    blockers.push("license_review_required");
  }
  if (runtimeManifest.questQaStatus?.status === "not_reviewed") {
    blockers.push("quest_qa_not_reviewed");
  }
  if (runtimeManifest.questQaStatus?.status === "failed") {
    blockers.push("quest_qa_failed");
  }
  if (!stages.has("qa_ready")) {
    blockers.push("missing_qa_ready_stage");
  }
  if (runtimeManifest.geometryBudget && runtimeManifest.geometryBudget.maxTriangles > quest3AssetBudget.maxTriangles) {
    blockers.push("over_triangle_budget");
  }
  if (runtimeManifest.geometryBudget && runtimeManifest.geometryBudget.maxTextureMegabytes > quest3AssetBudget.maxTextureMegabytes) {
    blockers.push("over_texture_budget");
  }
  if (runtimeManifest.geometryBudget && runtimeManifest.geometryBudget.maxDrawCalls > quest3AssetBudget.maxDrawCalls) {
    blockers.push("over_draw_call_budget");
  }
  if (!stages.has("optimized")) {
    warnings.push("missing_optimized_stage");
  }
  if (!isPlaceholderAsset(manifest) && hasProductionLimitingQuestQaStatus(runtimeManifest.questQaStatus)) {
    productionBlockers.push("quest_qa_production_limitations_present");
  }
  if (isPlaceholderAsset(manifest)) {
    if (runtimeManifest.questQaStatus?.status !== "placeholder_dev_ready" && runtimeManifest.questQaStatus?.status !== "sim_qa_ready") {
      blockers.push("placeholder_quest_qa_status_missing");
    }
    productionBlockers.push("placeholder_asset_not_clinical_release_ready");
  }

  return {
    assetId: manifest.assetId,
    devReady: blockers.length === 0,
    productionReady: blockers.length === 0 && productionBlockers.length === 0,
    blockers,
    productionBlockers,
    warnings,
  };
}

export function evaluateAssetProductionReadinessLadder(manifest: AssetManifest): AssetProductionReadinessLadder {
  const readiness = evaluateAssetManifest(manifest);
  const generationEvidenceRefs = assetGenerationEvidenceRefs(manifest);
  const generationEvidenceBlockers = assetGenerationEvidenceBlockers(manifest);
  const optimizationEvidenceRefs = assetOptimizationEvidenceRefs(manifest);
  const optimizationEvidenceBlockers = assetOptimizationEvidenceBlockers(manifest);
  const questQaEvidenceRefs = manifest.questQaStatus ? [`${manifest.questQaStatus.status}:${manifest.questQaStatus.reviewedAt}`] : [];
  const questQaBlockers = [
    ...readiness.blockers.filter((blocker) => blocker.startsWith("quest_") || blocker.startsWith("placeholder_quest_qa")),
    ...readiness.productionBlockers.filter((blocker) => blocker.startsWith("quest_")),
  ];
  const visualClinicalCritiqueBlockers = ["visual_clinical_critique_missing"];
  const productionReleaseBlockers = uniqueAssetReadinessValues([
    ...readiness.blockers,
    ...readiness.productionBlockers,
    ...visualClinicalCritiqueBlockers,
  ]);

  return {
    assetId: manifest.assetId,
    scenarioId: manifest.scenarioId,
    productionReady: readiness.productionReady && visualClinicalCritiqueBlockers.length === 0,
    blockers: productionReleaseBlockers,
    steps: [
      readinessStep("provenance_license", manifest.provenance.sourceRefs.filter((sourceRef) => sourceRef.trim().length > 0), provenanceLicenseBlockers(manifest)),
      readinessStep("generation_evidence", generationEvidenceRefs, generationEvidenceBlockers),
      readinessStep("optimization_evidence", optimizationEvidenceRefs, optimizationEvidenceBlockers),
      readinessStep("quest_qa", questQaEvidenceRefs, uniqueAssetReadinessValues(questQaBlockers)),
      readinessStep("visual_clinical_critique", [], visualClinicalCritiqueBlockers),
      readinessStep("production_release", [], productionReleaseBlockers),
    ],
  };
}

export function buildAssetProductionReviewPacket(manifest: AssetManifest): AssetProductionReviewPacket {
  const ladder = evaluateAssetProductionReadinessLadder(manifest);
  const nextReviewStep = ladder.steps.find((step) => step.status === "blocked")?.step ?? null;

  return {
    assetId: manifest.assetId,
    scenarioId: manifest.scenarioId,
    displayName: manifest.displayName,
    kind: manifest.kind,
    targetRuntime: manifest.targetRuntime,
    productionReady: ladder.productionReady,
    claimBoundary: "review_packet_not_release_approval",
    nextReviewStep,
    blockerCount: ladder.blockers.length,
    evidenceChecklist: ladder.steps.map((step) => ({
      ...step,
      evidenceRefs: [...step.evidenceRefs],
      blockers: [...step.blockers],
      recommendedAction: recommendedAssetReviewAction(step),
    })),
  };
}

export function buildEnvironmentGenerationPacket(
  scenario: Scenario,
  manifests: readonly AssetManifest[],
): EnvironmentGenerationPacket {
  const scenarioManifests = manifests.filter((manifest) => manifest.scenarioId === scenario.scenarioId);
  const requiredAssetIds = uniqueAssetReadinessValues(scenario.assetNeeds?.map((assetNeed) => assetNeed.assetId) ?? []);
  const requiredAssetIdSet = new Set(requiredAssetIds);
  const requiredManifests = requiredAssetIds
    .map((assetId) => scenarioManifests.find((manifest) => manifest.assetId === assetId))
    .filter((manifest): manifest is AssetManifest => Boolean(manifest));
  const environmentManifest = scenarioManifests.find((manifest) => manifest.kind === "environment" && requiredAssetIdSet.has(manifest.assetId))
    ?? scenarioManifests.find((manifest) => manifest.kind === "environment");

  if (!environmentManifest) {
    throw new Error(`Missing environment asset manifest for ${scenario.scenarioId}`);
  }

  const toolMatrix = evaluateAssetPipelineToolMatrix();
  const authoringToolIds = selectAssetPipelineToolsForLane("environment_equipment")
    .filter((tool) => evaluateAssetPipelineTool(tool).authoringAllowedNow)
    .map((tool) => tool.toolId);
  const optionalContextAssetIds = scenarioManifests
    .map((manifest) => manifest.assetId)
    .filter((assetId) => !requiredAssetIdSet.has(assetId))
    .sort((left, right) => left.localeCompare(right));
  const reviewGates = buildEnvironmentGenerationReviewGates(environmentManifest);
  const nextReviewGate = reviewGates.find((gate) => gate.status === "blocked")?.gate ?? null;

  return {
    scenarioId: scenario.scenarioId,
    environmentAssetId: environmentManifest.assetId,
    displayName: environmentManifest.displayName,
    targetRuntime: environmentManifest.targetRuntime,
    claimBoundary: "environment_generation_plan_not_generated_asset",
    requiredAssetIds,
    optionalContextAssetIds,
    spatialZones: buildEdBaySpatialZones(environmentManifest.assetId, requiredAssetIds, optionalContextAssetIds),
    questBudget: evaluateScenarioAssetBudget(requiredManifests),
    authoringToolIds,
    sidecarToolIds: toolMatrix.sidecarCandidateToolIds,
    blockedToolIds: toolMatrix.blockedToolIds,
    productionRuntimeToolIds: toolMatrix.productionRuntimeToolIds,
    reviewGates,
    nextReviewGate,
    readyForGenerationReview: reviewGates.every((gate) => gate.status === "complete"),
  };
}

export function buildEnvironmentGenerationQueue(
  scenarios: readonly Scenario[],
  manifests: readonly AssetManifest[],
): EnvironmentGenerationQueue {
  const packets = scenarios.map((scenario) => buildEnvironmentGenerationPacket(scenario, manifests));
  const readyForGenerationReviewScenarioIds = packets
    .filter((packet) => packet.readyForGenerationReview)
    .map((packet) => packet.scenarioId);
  const blockedScenarioIds = packets
    .filter((packet) => !packet.readyForGenerationReview)
    .map((packet) => packet.scenarioId);
  const nextReviewGateCounts = packets.reduce<Partial<Record<EnvironmentGenerationReviewGateName, number>>>((counts, packet) => {
    if (!packet.nextReviewGate) {
      return counts;
    }
    counts[packet.nextReviewGate] = (counts[packet.nextReviewGate] ?? 0) + 1;
    return counts;
  }, {});

  return {
    scenarioCount: scenarios.length,
    packetCount: packets.length,
    readyForGenerationReviewScenarioIds,
    blockedScenarioIds,
    nextReviewGateCounts,
    packets,
  };
}

export function buildEnvironmentGenerationWorkOrder(packet: EnvironmentGenerationPacket): EnvironmentGenerationWorkOrder {
  const authoringToolId = packet.authoringToolIds.includes("blender") ? "blender" : packet.authoringToolIds[0] ?? "manual_modeling";
  const tasks = buildEnvironmentGenerationWorkOrderTasks(packet);

  return {
    workOrderId: `environment_work_order:${packet.scenarioId}:${packet.environmentAssetId}`,
    scenarioId: packet.scenarioId,
    environmentAssetId: packet.environmentAssetId,
    targetRuntime: packet.targetRuntime,
    authoringToolId,
    claimBoundary: "authoring_work_order_not_generated_asset",
    nextEvidenceGate: packet.nextReviewGate,
    status: packet.readyForGenerationReview ? "ready_for_generation_review" : "blocked_pending_evidence",
    requiredOutputEvidence: [
      "blender_bake_report",
      "gltf_validation_report",
      "quest_budget_report",
      "environment_spatial_layout_notes",
      "clinical_visual_review_request",
    ],
    assetBundle: {
      requiredAssetIds: [...packet.requiredAssetIds],
      optionalContextAssetIds: [...packet.optionalContextAssetIds],
      spatialZoneCount: packet.spatialZones.length,
      spatialAnchorCount: packet.spatialZones.reduce((count, zone) => count + zone.spatialAnchors.length, 0),
    },
    tasks,
    prohibitedActions: [
      "do_not_use_stablegen_without_legal_exception",
      "do_not_add_blender_as_production_runtime_dependency",
      "do_not_claim_quest_runtime_readiness_without_attached_worn_headset_evidence",
      "do_not_release_without_visual_clinical_critique",
    ],
    operatorHandoff: buildEnvironmentGenerationOperatorHandoff(packet, tasks),
  };
}

export function buildEnvironmentGenerationWorkOrderQueue(generationQueue: EnvironmentGenerationQueue): EnvironmentGenerationWorkOrderQueue {
  const workOrders = generationQueue.packets.map((packet) => buildEnvironmentGenerationWorkOrder(packet));
  const blockedWorkOrderCount = workOrders.filter((workOrder) => workOrder.status === "blocked_pending_evidence").length;
  const readyForGenerationReviewWorkOrderIds = workOrders
    .filter((workOrder) => workOrder.status === "ready_for_generation_review")
    .map((workOrder) => workOrder.workOrderId);
  const pendingTaskCount = workOrders.reduce((count, workOrder) => count + workOrder.tasks.filter((task) => task.status === "pending").length, 0);
  const prohibitedActionCounts = workOrders.reduce<Record<string, number>>((counts, workOrder) => {
    for (const action of workOrder.prohibitedActions) {
      counts[action] = (counts[action] ?? 0) + 1;
    }
    return counts;
  }, {});
  const missingEvidenceCounts = workOrders.reduce<Record<string, number>>((counts, workOrder) => {
    for (const evidenceId of workOrder.operatorHandoff.missingEvidenceIds) {
      counts[evidenceId] = (counts[evidenceId] ?? 0) + 1;
    }
    return counts;
  }, {});

  return {
    scenarioCount: generationQueue.scenarioCount,
    workOrderCount: workOrders.length,
    blockedWorkOrderCount,
    pendingTaskCount,
    readyForGenerationReviewWorkOrderIds,
    claimBoundary: "work_order_queue_not_asset_production",
    nextEvidenceGateCounts: { ...generationQueue.nextReviewGateCounts },
    prohibitedActionCounts,
    missingEvidenceCounts,
    workOrders,
  };
}

export function buildScenarioSceneGenerationPipelineWorkOrder(
  scenario: Scenario,
  options: {
    storeKind?: "azurite_blob" | "azure_blob";
    containerName?: string;
    blobPrefix?: string;
  } = {},
): ScenarioSceneGenerationPipelineWorkOrder {
  const assetNeeds = scenario.assetNeeds ?? [];
  const scenarioAssetIds = uniqueAssetReadinessValues(assetNeeds.map((assetNeed) => assetNeed.assetId));
  const characterAssetIds = uniqueAssetReadinessValues(assetNeeds.filter((assetNeed) => assetNeed.assetType === "character").map((assetNeed) => assetNeed.assetId));
  const environmentAssetIds = uniqueAssetReadinessValues(assetNeeds.filter((assetNeed) => assetNeed.assetType === "environment").map((assetNeed) => assetNeed.assetId));
  const explicitEquipmentAssetIds = assetNeeds.filter((assetNeed) => assetNeed.assetType === "equipment").map((assetNeed) => assetNeed.assetId);
  const equipmentAssetIds = uniqueAssetReadinessValues(explicitEquipmentAssetIds.length > 0
    ? explicitEquipmentAssetIds
    : (scenario.equipment ?? []).map((equipment) => typeof equipment === "string" ? equipment : String(equipment)));
  const blobPrefix = options.blobPrefix ?? `scenario-assets/${scenario.scenarioId}/`;
  const stages: SceneGenerationPipelineStage[] = [
    scenePipelineStage("admin_scenario_configuration", "Scenario configuration captured for asset generation planning", ["scenario_configuration", "asset_needs"], ["scene_generation_request"]),
    scenePipelineStage("asset_need_expansion", "Expand scenario asset needs into work orders", ["scene_generation_request"], ["character_asset_orders", "environment_asset_orders", "equipment_asset_orders"]),
    scenePipelineStage("humanoid_generation", "Generate humanoid source meshes", ["character_asset_orders", "anny_authoring_runtime"], ["humanoid_mesh_manifest", "humanoid_source_manifests"]),
    scenePipelineStage("hair_clothing_skin_generation", "Generate hair, clothing, and skin authoring artifacts", ["humanoid_source_manifests"], ["hair_clothing_skin_provenance", "runtime_safe_materials", "license_provenance_report"]),
    scenePipelineStage("rigging_animation_generation", "Rig humanoids and bind animation/dialogue cues", ["humanoid_source_meshes", "canonical_skeleton_contract"], ["rig_validation_report", "facial_blendshape_map", "viseme_phoneme_map", "gaze_blink_control_map", "animation_clip_manifest", "collision_proxy_manifest"]),
    scenePipelineStage("equipment_environment_generation", "Generate environment and equipment scene assets", ["environment_asset_orders", "equipment_asset_orders"], ["environment_glbs", "equipment_glbs", "scene_layout_manifest", "equipment_placement_manifest"]),
    scenePipelineStage("blob_storage_publication", "Publish generated static assets to configured blob storage", ["rigged_humanoid_glbs", "environment_glbs", "equipment_glbs"], ["blob_asset_urls", "content_hash_manifest", "quest_budget_report"]),
    scenePipelineStage("runtime_bundle_binding", "Bind generated assets into learner runtime bundle", ["blob_asset_urls", "content_hash_manifest"], ["learner_runtime_asset_bundle"]),
    scenePipelineStage("review_and_quest_evidence", "Attach review and Quest/WebXR evidence before learner use", ["learner_runtime_asset_bundle"], ["visual_clinical_review_packet", "quest_runtime_evidence"]),
  ];
  const actorWorkOrders = buildSceneGenerationActorWorkOrders(scenario, characterAssetIds);
  const environmentWorkOrder = buildSceneGenerationEnvironmentWorkOrder(scenario, environmentAssetIds, equipmentAssetIds);

  return {
    workOrderId: `scene_generation_pipeline:${scenario.scenarioId}`,
    scenarioId: scenario.scenarioId,
    scenarioStatus: scenario.status,
    initiatedFrom: "admin_scenario_configuration",
    claimBoundary: "admin_initiated_pipeline_contract_not_generated_asset",
    approvalBoundary: "scenario_status_preserved_no_generation_approval_inferred",
    targetRuntime: "quest3_webxr",
    storageTarget: {
      storeKind: options.storeKind ?? "azurite_blob",
      containerName: options.containerName ?? "openclinxr-assets",
      blobPrefix,
      emulatorAllowed: (options.storeKind ?? "azurite_blob") === "azurite_blob",
    },
    scenarioAssetIds,
    characterAssetIds,
    environmentAssetIds,
    equipmentAssetIds,
    pipelineStageCount: stages.length,
    stages,
    actorWorkOrders,
    environmentWorkOrder,
    requiredOutputEvidence: uniqueAssetReadinessValues(stages.flatMap((stage) => stage.expectedOutputs)),
    prohibitedActions: [
      "do_not_generate_assets_before_admin_scenario_configuration",
      "do_not_bind_assets_to_runtime_without_content_hash_manifest",
      "do_not_claim_quest_readiness_without_worn_headset_evidence",
      "do_not_use_paid_or_cloud_generation_without_explicit_approval",
      "do_not_use_agpl_or_copyleft_assets_without_legal_exception",
      "do_not_materialize_production_assets_from_this_metadata_work_order",
      "do_not_release_without_visual_clinical_review",
    ],
  };
}

function buildSceneGenerationActorWorkOrders(
  scenario: Scenario,
  characterAssetIds: string[],
): SceneGenerationActorWorkOrder[] {
  return scenario.actors
    .filter((actor) => actor.role !== "system")
    .map((actor) => {
      const characterAssetId = characterAssetIds.find((assetId) => assetId.startsWith(`${actor.role}_`))
        ?? characterAssetIds.find((assetId) => assetId.includes(actor.displayName.toLowerCase().split(/\s+/)[0] ?? ""))
        ?? `${actor.actorId.replace(/_v\d+$/, "")}_character_pending_definition`;
      const roleCue = actor.role === "family" ? "family_or_parent" : actor.role;
      const requiredEvidenceIds = [
        "humanoid_mesh_manifest",
        "license_provenance_report",
        "rig_validation_report",
        "facial_blendshape_map",
        "viseme_phoneme_map",
        "gaze_blink_control_map",
        "animation_clip_manifest",
        "collision_proxy_manifest",
      ];

      return {
        workOrderId: `actor_asset_work_order:${scenario.scenarioId}:${actor.actorId}`,
        actorId: actor.actorId,
        actorRole: actor.role,
        displayName: actor.displayName,
        characterAssetId,
        source: "scenario_actor_definition",
        ageBand: scenario.scenarioId.includes("peds_") && actor.role === "patient" ? "child_or_adolescent" : actor.role === "patient" ? "adult" : "contextual_adult",
        appearanceCues: {
          roleAppropriateClothing: [`${roleCue}_role_appropriate_clothing`, "clinical_context_consistent_materials"],
          hairOrHeadCovering: [`${roleCue}_hair_or_head_covering_profile`, "avoid_unlicensed_likeness_reference"],
          skinMaterial: [`${roleCue}_skin_material_or_morph_target_profile`, "review_for_clinical_visual_context_only"],
        },
        riggingAndAnimationCues: [
          "canonical_skeleton_contract",
          "facial_rigging_blendshape_map",
          "viseme_phoneme_mapping",
          "gaze_blink_controls",
          "locomotion_idle_conversation_animation_set",
          "collision_proxy_preparation",
        ],
        humanoidRuntimeReadinessHandoff: buildHumanoidRuntimeReadinessHandoff({
          actorRole: actor.role,
          baselineMoodCount: actor.communicationProfile?.baselineMood.length ?? 0,
          requiredTraceTags: scenario.requiredTraceTags,
        }),
        humanoidRealismMetadata: buildHumanoidRealismMetadata({
          actorRole: actor.role,
          actorId: actor.actorId,
          targetActorIds: scenario.actors
            .filter((targetActor) => targetActor.role !== "system" && targetActor.actorId !== actor.actorId)
            .map((targetActor) => targetActor.actorId),
          roleCue,
          fixtureOnly: true,
        }),
        provenanceAndLicensingRefs: ["license_provenance_report", "source_asset_manifest", "no_agpl_or_copyleft_without_exception"],
        optimizationAndPerformanceRefs: ["quest_budget_report", "lod_manifest", "texture_budget_report", "collision_proxy_manifest"],
        requiredEvidenceIds,
        evidenceGateRefs: ["asset_production_review", "runtime_realism_evidence", "visual_qa_evidence", "quest_runtime_evidence"],
        claimBoundary: "metadata_work_order_not_generated_asset",
      };
    });
}

function buildHumanoidRuntimeReadinessHandoff(input: {
  actorRole: string;
  baselineMoodCount: number;
  requiredTraceTags: string[];
}): SceneGenerationActorWorkOrder["humanoidRuntimeReadinessHandoff"] {
  const traceSignals = deriveEncounterTraceTagNeeds(new Set(input.requiredTraceTags));
  const expressionRequired = input.baselineMoodCount > 0 || traceSignals.emotion.length > 0;
  const gazeRequired = traceSignals.gaze.length > 0;
  const lipSyncRequired = traceSignals.lipSync.length > 0;
  return {
    claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
    actorRole: input.actorRole,
    requiredSignalIds: uniqueValues([
      "animated_humanoid_runtime_playback",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      ...(expressionRequired ? ["emotion_aligned_expression_transition_cue"] : []),
      ...(gazeRequired || lipSyncRequired ? ["dialogue_viseme_and_gaze_mapping"] : []),
      ...traceSignals.animation,
      ...traceSignals.emotion,
      ...traceSignals.gaze,
      ...traceSignals.lipSync,
    ]),
    locomotionRequired: true,
    expressionRequired,
    gazeRequired,
    lipSyncRequired,
    interactiveRequired: true,
    blockers: [
      "runtime_realism_evidence_not_attached_to_encounter_bundle",
      "visual_qa_evidence_not_attached_to_encounter_bundle",
    ],
    notEvidenceFor: [
      "generated_humanoid_asset_readiness",
      "animation_quality",
      "quest_readiness",
      "runtime_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

function buildSceneGenerationEnvironmentWorkOrder(
  scenario: Scenario,
  environmentAssetIds: string[],
  equipmentAssetIds: string[],
): SceneGenerationEnvironmentWorkOrder {
  const environmentAssetId = environmentAssetIds[0] ?? `${scenario.scenarioId}:environment_pending_definition`;

  return {
    workOrderId: `environment_asset_work_order:${scenario.scenarioId}:${environmentAssetId}`,
    environmentAssetId,
    equipmentAssetIds,
    requiredEvidenceIds: [
      "scene_layout_manifest",
      "equipment_placement_manifest",
      "license_provenance_report",
      "quest_budget_report",
      "content_hash_manifest",
      "visual_clinical_review_packet",
    ],
    provenanceAndLicensingRefs: ["license_provenance_report", "source_asset_manifest", "no_agpl_or_copyleft_without_exception"],
    optimizationAndPerformanceRefs: ["quest_budget_report", "lod_manifest", "texture_budget_report", "collision_proxy_manifest"],
    evidenceGateRefs: ["asset_production_review", "visual_qa_evidence", "quest_runtime_evidence"],
    claimBoundary: "metadata_work_order_not_generated_asset",
  };
}

export function buildScenarioSceneGenerationPipelineWorkOrderQueue(
  scenarios: readonly Scenario[],
): ScenarioSceneGenerationPipelineWorkOrderQueue {
  const workOrders = scenarios.map((scenario) => buildScenarioSceneGenerationPipelineWorkOrder(scenario));
  const featuredFactoryPlanningWorkOrder = workOrders.find((workOrder) => workOrder.scenarioId === "peds_asthma_parent_anxiety_v1")
    ?? workOrders[1]
    ?? workOrders[0];

  return {
    scenarioCount: scenarios.length,
    workOrderCount: workOrders.length,
    pendingStageCount: workOrders.reduce((count, workOrder) => count + workOrder.stages.filter((stage) => stage.status === "pending").length, 0),
    claimBoundary: "scene_generation_pipeline_queue_not_asset_production",
    featuredFactoryPlanningScenarioId: featuredFactoryPlanningWorkOrder?.scenarioId ?? null,
    featuredFactoryPlanningWorkOrderId: featuredFactoryPlanningWorkOrder?.workOrderId ?? null,
    factoryPlanningClaimBoundary: "review_gated_factory_metadata_only",
    generationApprovalInferred: false,
    storageTargets: workOrders.map((workOrder) => workOrder.storageTarget),
    workOrders,
  };
}

export function buildEncounterAssetNeedsReadinessManifest(scenario: Scenario): EncounterAssetNeedsReadinessManifest {
  const assetNeeds = scenario.assetNeeds ?? [];
  const assetNeedIds = new Set(assetNeeds.map((assetNeed) => assetNeed.assetId));
  const requiredHumanoids = scenario.actors
    .filter((actor) => actor.role !== "system")
    .map((actor) => {
      const actorAssetNeedId = deriveActorAssetNeedId(actor.actorId);
      const roleNeeds = encounterReadinessRoleDefaults[actor.role] ?? requiredEncounterReadinessRoleDefaults("patient");
      const styleNeeds = actor.communicationProfile?.style
        ? deriveProfileNeeds(actor.communicationProfile.style)
        : {
          animation: [],
          emotion: [],
          gaze: [],
          lipSync: [],
          assetKinds: {
            animation: [],
            emotion: [],
            gaze: [],
            lipSync: [],
          },
        };
      const traceRequirements = deriveEncounterTraceTagNeeds(new Set(scenario.requiredTraceTags));
      const communicationProfileMoodNeeds = (actor.communicationProfile?.baselineMood ?? [])
        .map((mood) => `mood:${toSlug(mood)}`)
        .concat(actor.communicationProfile?.communicativeness ? [`communicativeness:${toSlug(actor.communicationProfile.communicativeness)}`] : []);
      const requiredSignals = uniqueValues([
        ...roleNeeds.animation,
        ...styleNeeds.animation,
        ...traceRequirements.animation,
        ...communicationProfileMoodNeeds,
      ]);
      const requiredEmotionSignals = uniqueValues([
        ...roleNeeds.emotion,
        ...styleNeeds.emotion,
        ...traceRequirements.emotion,
      ]);
      const requiredGazeSignals = uniqueValues([
        ...roleNeeds.gaze,
        ...styleNeeds.gaze,
        ...traceRequirements.gaze,
      ]);
      const requiredLipSyncSignals = uniqueValues([
        ...roleNeeds.lipSync,
        ...styleNeeds.lipSync,
        ...traceRequirements.lipSync,
      ]);
      const behaviorCategoryRequirements: Record<EncounterAssetReadinessBehaviorCategory, string[]> = {
        animation: requiredSignals,
        emotion: requiredEmotionSignals,
        gaze: requiredGazeSignals,
        lip_sync: requiredLipSyncSignals,
      };

      const keys: EncounterSharedAssetLibraryLookupKey[] = [
        buildEncounterSharedAssetLibraryLookupKey({
          scenarioId: scenario.scenarioId,
          targetKind: "role_specific_humanoid_glb",
          actorRole: actor.role,
          semanticInputs: [actor.role, actor.actorId, ...requiredSignals, ...requiredEmotionSignals, ...requiredGazeSignals],
        }),
        buildEncounterSharedAssetLibraryLookupKey({
          scenarioId: scenario.scenarioId,
          targetKind: "role_idle_animation_glb",
          actorRole: actor.role,
          semanticInputs: [actor.role, ...requiredSignals, ...requiredEmotionSignals],
        }),
        buildEncounterSharedAssetLibraryLookupKey({
          scenarioId: scenario.scenarioId,
          targetKind: "facial_lipsync_gaze_animation",
          actorRole: actor.role,
          semanticInputs: [actor.role, ...requiredGazeSignals, ...requiredLipSyncSignals],
        }),
      ];

      return {
        actorId: actor.actorId,
        actorRole: actor.role,
        assetNeedId: actorAssetNeedId,
        hasExplicitAssetNeed: assetNeedIds.has(actorAssetNeedId),
        inferredFromActorId: true,
        behaviorCategoryRequirements,
        sharedAssetLibraryLookupKeys: keys,
      };
    });
  const requiredEnvironment = scenario.environment
    ? buildEnvironmentNeed({
      scenarioId: scenario.scenarioId,
      environmentId: scenario.environment.environmentId,
      environmentNeedIds: assetNeeds.filter((assetNeed) => assetNeed.assetType === "environment").map((assetNeed) => assetNeed.assetId),
      environmentDescription: scenario.environment.description,
      environmentTags: scenario.requiredTraceTags,
    })
    : null;
  const requiredPropsAndEquipment = inferRequiredPropsAndEquipment({
    scenarioId: scenario.scenarioId,
    scenarioEquipment: scenario.equipment ?? [],
    explicitEquipmentAssetNeeds: assetNeeds.filter((assetNeed) => assetNeed.assetType === "equipment").map((assetNeed) => assetNeed.assetId),
  });
  const sharedAssetLibrarySemanticKeys = uniqueValues([
    ...requiredHumanoids.flatMap((actor) => actor.sharedAssetLibraryLookupKeys.map((key) => key.lookupKey)),
    ...(requiredEnvironment ? [requiredEnvironment.sharedAssetLibraryLookupKey.lookupKey] : []),
    ...requiredPropsAndEquipment.map((equipment) => equipment.sharedAssetLibraryLookupKey.lookupKey),
  ]);
  const traceNeeds = deriveEncounterTraceTagNeeds(new Set(scenario.requiredTraceTags));
  const animationRequirements = uniqueValues([
    ...requiredHumanoids.flatMap((actor) => actor.behaviorCategoryRequirements.animation),
    ...traceNeeds.animation,
    "role_specific_humanoid_glb",
    "conversation_animation",
  ]);
  const emotionRequirements = uniqueValues([
    ...requiredHumanoids.flatMap((actor) => actor.behaviorCategoryRequirements.emotion),
    ...traceNeeds.emotion,
    "emotion_transition_control",
  ]);
  const gazeRequirements = uniqueValues([
    ...requiredHumanoids.flatMap((actor) => actor.behaviorCategoryRequirements.gaze),
    ...traceNeeds.gaze,
    "dialogue_gaze_profile",
  ]);
  const lipSyncRequirements = uniqueValues([
    ...requiredHumanoids.flatMap((actor) => actor.behaviorCategoryRequirements.lip_sync),
    ...traceNeeds.lipSync,
    "viseme_phoneme_map",
    "dialogue_viseme_and_gaze_mapping",
    "gaze_blink_control_map",
  ]);
  const missingRequiredAssetNeedIds = [
    ...requiredHumanoids.filter((actor) => !actor.hasExplicitAssetNeed).map((actor) => actor.assetNeedId),
    ...(requiredEnvironment && !requiredEnvironment.hasExplicitAssetNeed ? [requiredEnvironment.assetNeedId] : []),
    ...requiredPropsAndEquipment.filter((equipment) => !equipment.hasExplicitAssetNeed).map((equipment) => equipment.assetNeedId),
  ];
  const blockers = uniqueValues(missingRequiredAssetNeedIds.length > 0
    ? missingRequiredAssetNeedIds.map((missingAssetNeedId) => `missing_required_asset_need:${missingAssetNeedId}`)
    : []);
  const warnings = uniqueValues([
    ...scenario.actors.filter((actor) => actor.role !== "system" && !actor.communicationProfile).map((actor) => `actor_missing_communication_profile:${actor.actorId}`),
    ...(requiredEnvironment && !requiredEnvironment.hasExplicitAssetNeed ? ["environment_asset_need_not_found"] : []),
  ]);
  return {
    schemaVersion: "openclinxr.encounter-asset-needs-readiness.v1",
    scenarioId: scenario.scenarioId,
    scenarioTitle: scenario.title,
    scenarioStatus: scenario.status,
    generatedAt: encounterReadinessManifestTimestamp,
    requiredHumanoids,
    requiredEnvironment,
    requiredPropsAndEquipment,
    animationRequirements: {
      requiredSignalIds: animationRequirements,
      requiredAssetKinds: uniqueValues(requiredHumanoids.flatMap((actor) => encounterReadinessRoleDefaults[actor.actorRole]?.assetKinds.animation ?? [])),
    },
    emotionRequirements: {
      requiredSignalIds: emotionRequirements,
      requiredAssetKinds: uniqueValues(requiredHumanoids.flatMap((actor) => encounterReadinessRoleDefaults[actor.actorRole]?.assetKinds.emotion ?? [])),
    },
    gazeRequirements: {
      requiredSignalIds: gazeRequirements,
      requiredAssetKinds: uniqueValues(requiredHumanoids.flatMap((actor) => encounterReadinessRoleDefaults[actor.actorRole]?.assetKinds.gaze ?? [])),
    },
    lipSyncRequirements: {
      requiredSignalIds: lipSyncRequirements,
      requiredAssetKinds: uniqueValues(requiredHumanoids.flatMap((actor) => encounterReadinessRoleDefaults[actor.actorRole]?.assetKinds.lipSync ?? [])),
    },
    sharedAssetLibrarySemanticKeys,
    missingRequiredAssetNeedIds,
    blockers,
    warnings,
    readyForDeterministicGeneration: blockers.length === 0 && warnings.length === 0,
  };
}

function deriveActorAssetNeedId(actorId: string): string {
  return `${actorId.replace(/_v\d+$/u, "").replace(/_character$/u, "")}_character`;
}

function deriveProfileNeeds(style: string): EncounterProfileNeeds {
  const styleNeeds: Record<string, EncounterProfileNeeds> = {
    congruent: {
      animation: ["active_listening_pause", "validated_empathy_pose"],
      emotion: ["supportive_acknowledgement", "concern_regulation_support"],
      gaze: ["speaker_listener_targeting", "concern_alignment_gaze"],
      lipSync: ["clarity_anchored_turning_points"],
      assetKinds: {
        animation: ["conversation_animation", "clinical_idle_animation"],
        emotion: ["emotion_tone_continuity", "empathy_projection"],
        gaze: ["speaker_targeting", "learner_camera_targeting"],
        lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
      },
    },
    accuser: {
      animation: ["assertive_direct_pose", "instruction_reinforcement_animation"],
      emotion: ["firm_attention_projection"],
      gaze: ["focused_direct_gaze"],
      lipSync: ["directive_timing"],
      assetKinds: {
        animation: ["conversation_animation", "alertness_adjustment"],
        emotion: ["emotion_tone_continuity", "stress_signal_stability"],
        gaze: ["speaker_targeting", "task_targeting"],
        lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
      },
    },
    rationalizer: {
      animation: ["clinical_reasoning_pose", "stepwise_instruction_pose"],
      emotion: ["focused_rationale_clarity"],
      gaze: ["evidence_focused_gaze"],
      lipSync: ["logic_and_ordered_timing"],
      assetKinds: {
        animation: ["conversation_animation", "clinical_idle_animation"],
        emotion: ["emotion_tone_continuity", "team_confidence_transfer"],
        gaze: ["speaker_targeting", "team_targeting"],
        lipSync: ["viseme_phoneme_map", "dialogue_viseme_and_gaze_mapping"],
      },
    },
    appeaser: {
      animation: ["reassurance_pose", "softening_posture_shift"],
      emotion: ["deescalation_affect_readability"],
      gaze: ["softened_face_alignment", "comfort_tracking"],
      lipSync: ["paced_reassurance_timing"],
      assetKinds: {
        animation: ["conversation_animation", "clinical_idle_animation"],
        emotion: ["emotion_tone_continuity", "stress_signal_stability"],
        gaze: ["eye_contact_softening"],
        lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
      },
    },
    distractor: {
      animation: ["attention_redirection_pose", "brief_distraction_cue"],
      emotion: ["nonthreatening_bonding_tone"],
      gaze: ["attention_diversion_gaze"],
      lipSync: ["soft_attention_shift_timing"],
      assetKinds: {
        animation: ["conversation_animation", "clinical_idle_animation"],
        emotion: ["emotion_tone_continuity"],
        gaze: ["speaker_targeting", "environment_targeting"],
        lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
      },
    },
    withdrawn_guarded: {
      animation: ["brief_closed_posture", "guarded_listening_pose"],
      emotion: ["guarded_readability_support"],
      gaze: ["limited_face_tracking"],
      lipSync: ["careful_clarity_timing"],
      assetKinds: {
        animation: ["conversation_animation", "clinical_idle_animation"],
        emotion: ["emotion_tone_continuity", "concern_acknowledgement_clarity"],
        gaze: ["speaker_targeting", "learner_camera_focusing"],
        lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
      },
    },
    angry_family_member: {
      animation: ["emotional_escalation_cue", "concern_response_pose"],
      emotion: ["concern_acknowledgement_clarity"],
      gaze: ["family_targeting"],
      lipSync: ["urgent_empathy_timing"],
      assetKinds: {
        animation: ["conversation_animation", "clinical_idle_animation"],
        emotion: ["emotion_tone_continuity", "family_warmth_modulation"],
        gaze: ["speaker_targeting", "family_targeting"],
        lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
      },
    },
    custom: {
      animation: ["clinical_idle_animation", "conversation_animation"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["dialogue_gaze_profile"],
      lipSync: ["clear_directional_turn_timing"],
      assetKinds: {
        animation: ["conversation_animation", "clinical_idle_animation", "role_idle_animation_glb"],
        emotion: ["emotion_tone_continuity"],
        gaze: ["speaker_targeting", "dialogue_gaze_profile"],
        lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
      },
    },
  };

  return styleNeeds[style] ?? {
    animation: ["conversation_animation", "clinical_idle_animation"],
    emotion: ["emotion_tone_continuity"],
    gaze: ["dialogue_gaze_profile"],
    lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting", "dialogue_gaze_profile"],
      lipSync: ["viseme_phoneme_map"],
    },
  };
}

function deriveEncounterTraceTagNeeds(tags: Set<string>): EncounterProfileNeeds {
  const requirements: EncounterProfileNeeds = {
    animation: ["conversation_animation", "clinical_idle_animation"],
    emotion: ["emotion_tone_continuity"],
    gaze: ["dialogue_gaze_profile"],
    lipSync: ["viseme_phoneme_map", "dialogue_viseme_and_gaze_mapping"],
    assetKinds: {
      animation: ["conversation_animation", "clinical_idle_animation"],
      emotion: ["emotion_tone_continuity"],
      gaze: ["speaker_targeting", "dialogue_gaze_profile"],
      lipSync: ["viseme_phoneme_map", "facial_lipsync_gaze_animation"],
    },
  };

  for (const tag of tags) {
    const mapped = encounterReadinessTraceTagNeedMap[tag];
    if (!mapped) {
      continue;
    }
    requirements.animation.push(...mapped.animation);
    requirements.emotion.push(...mapped.emotion);
    requirements.gaze.push(...mapped.gaze);
    requirements.lipSync.push(...mapped.lipSync);
    requirements.assetKinds.animation.push(...mapped.assetKinds.animation);
    requirements.assetKinds.emotion.push(...mapped.assetKinds.emotion);
    requirements.assetKinds.gaze.push(...mapped.assetKinds.gaze);
    requirements.assetKinds.lipSync.push(...mapped.assetKinds.lipSync);
  }

  return {
    animation: uniqueValues(requirements.animation),
    emotion: uniqueValues(requirements.emotion),
    gaze: uniqueValues(requirements.gaze),
    lipSync: uniqueValues(requirements.lipSync),
    assetKinds: {
      animation: uniqueValues(requirements.assetKinds.animation),
      emotion: uniqueValues(requirements.assetKinds.emotion),
      gaze: uniqueValues(requirements.assetKinds.gaze),
      lipSync: uniqueValues(requirements.assetKinds.lipSync),
    },
  };
}

function buildEnvironmentNeed(input: {
  scenarioId: string;
  environmentId: string;
  environmentNeedIds: readonly string[];
  environmentDescription: string;
  environmentTags: readonly string[];
}): EncounterEnvironmentAssetNeed {
  const assetNeedId = `${input.environmentId.replace(/_v\d+$/u, "").replace(/_environment$/u, "")}_environment`;
  const roomSemanticTokens = uniqueValuesBy([
    ...input.environmentTags.map((tag) => toSlug(tag)),
    ...toSlug(input.environmentDescription).split("_").filter(Boolean),
    ...toSlug(input.environmentId).split("_").filter(Boolean),
  ], (token) => token);
  const lookupKey = buildEncounterSharedAssetLibraryLookupKey({
    scenarioId: input.scenarioId,
    targetKind: "environment_shell_glb",
    actorRole: null,
    semanticInputs: roomSemanticTokens,
  });

  return {
    environmentId: input.environmentId,
    assetNeedId,
    hasExplicitAssetNeed: input.environmentNeedIds.includes(assetNeedId),
    roomSemanticTokens,
    sharedAssetLibraryLookupKey: lookupKey,
  };
}

function inferRequiredPropsAndEquipment(input: {
  scenarioId: string;
  scenarioEquipment: readonly string[];
  explicitEquipmentAssetNeeds: readonly string[];
}): EncounterEquipmentAssetNeed[] {
  const explicitEquipmentNeeds = new Set(input.explicitEquipmentAssetNeeds);
  const explicitLookup = new Set<string>();
  const inferredFromEquipment = input.scenarioEquipment.map((equipment) => {
    const normalizedId = toSlug(equipment).replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    const assetNeedId = `${normalizedId || "medical_equipment"}_equipment`;
    explicitLookup.add(assetNeedId);
    const semanticTokens = uniqueValues([normalizedId, ...toSlug(equipment).split("_").filter(Boolean), toSlug(input.scenarioId)]);
    return {
      source: `${input.scenarioId}:${equipment}`,
      assetNeedId,
      hasExplicitAssetNeed: explicitEquipmentNeeds.has(assetNeedId),
      semanticTokens,
      sharedAssetLibraryLookupKey: buildEncounterSharedAssetLibraryLookupKey({
        scenarioId: input.scenarioId,
        targetKind: "medical_equipment_glb",
        actorRole: null,
        semanticInputs: semanticTokens,
      }),
    };
  });
  const explicitOnly = input.explicitEquipmentAssetNeeds
    .filter((assetNeedId) => !explicitLookup.has(assetNeedId))
    .map((assetNeedId) => {
      const normalizedId = toSlug(assetNeedId).replace(/_equipment$/u, "");
      const semanticTokens = uniqueValues([normalizedId, "equipment", "medical_prop"]);
      return {
        source: `explicit_asset_need:${assetNeedId}`,
        assetNeedId,
        hasExplicitAssetNeed: true,
        semanticTokens,
        sharedAssetLibraryLookupKey: buildEncounterSharedAssetLibraryLookupKey({
          scenarioId: input.scenarioId,
          targetKind: "medical_equipment_glb",
          actorRole: null,
          semanticInputs: semanticTokens,
        }),
      };
    });

  return uniqueValuesBy([...inferredFromEquipment, ...explicitOnly], (need) => need.assetNeedId);
}

function buildEncounterSharedAssetLibraryLookupKey(input: {
  scenarioId: string;
  targetKind: EncounterSharedAssetLibraryLookupKey["targetKind"];
  actorRole: string | null;
  semanticInputs: string[];
}): EncounterSharedAssetLibraryLookupKey {
  const role = input.actorRole ?? "scenario";
  const normalizedScenarioId = toSlug(input.scenarioId);
  const normalizedInputs = uniqueValuesBy([...input.semanticInputs, normalizedScenarioId], (value) => toSlug(value));
  return {
    targetKind: input.targetKind,
    actorRole: input.actorRole,
    semanticInputs: normalizedInputs.map(toSlug),
    lookupKey: safeSlug([
      input.targetKind,
      role,
      ...normalizedInputs,
    ].join("__")),
  };
}

function safeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "encounter_asset";
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/giu, "_")
    .replace(/^_+|_+$/g, "");
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function requiredEncounterReadinessRoleDefaults(role: string): NonNullable<typeof encounterReadinessRoleDefaults[string]> {
  const defaults = encounterReadinessRoleDefaults[role];
  if (!defaults) {
    throw new Error(`Missing encounter readiness role defaults for ${role}`);
  }
  return defaults;
}

function uniqueValuesBy<T>(values: readonly T[], by: (value: T) => string): T[] {
  const seen = new Set<string>();
  const results: T[] = [];
  for (const value of values) {
    const key = by(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(value);
  }
  return results;
}

function scenePipelineStage(
  stageId: SceneGenerationPipelineStageId,
  title: string,
  requiredInputs: string[],
  expectedOutputs: string[],
): SceneGenerationPipelineStage {
  return {
    stageId,
    title,
    status: "pending",
    initiatedBy: "admin_user_after_scenario_configuration",
    requiredInputs,
    expectedOutputs,
  };
}

export class InMemoryAssetRegistry {
  private readonly manifests = new Map<string, AssetManifest>();

  upsert(manifest: AssetManifest): void {
    const validation = validateAssetManifestStructure(manifest);
    if (!validation.ok) {
      throw new Error(`Invalid asset manifest ${manifest.assetId}: ${validation.errors.join("; ")}`);
    }

    this.manifests.set(manifest.assetId, cloneAssetManifest(manifest));
  }

  get(assetId: string): AssetManifest | undefined {
    const manifest = this.manifests.get(assetId);
    return manifest ? cloneAssetManifest(manifest) : undefined;
  }

  listByScenario(scenarioId: string): AssetManifest[] {
    return [...this.manifests.values()]
      .filter((manifest) => manifest.scenarioId === scenarioId)
      .sort((left, right) => left.assetId.localeCompare(right.assetId))
      .map((manifest) => cloneAssetManifest(manifest));
  }

  evaluateScenarioReadiness(scenario: Scenario): ScenarioAssetReadiness {
    const requiredAssetIds = [...new Set(scenario.assetNeeds?.map((assetNeed) => assetNeed.assetId) ?? [])];
    const missingRequiredAssetIds: string[] = [];
    const blockedAssets: Array<{ assetId: string; blockers: string[] }> = [];
    const productionBlockedAssets: Array<{ assetId: string; blockers: string[] }> = [];
    const presentRequiredManifests: AssetManifest[] = [];

    for (const assetId of requiredAssetIds) {
      const manifest = this.manifests.get(assetId);
      if (!manifest) {
        missingRequiredAssetIds.push(assetId);
        continue;
      }
      presentRequiredManifests.push(manifest);

      const readiness = evaluateAssetManifest(manifest);
      if (!readiness.productionReady) {
        if (readiness.productionBlockers.length > 0) {
          productionBlockedAssets.push({
            assetId,
            blockers: readiness.productionBlockers,
          });
        }
      }
      if (!readiness.devReady) {
        blockedAssets.push({
          assetId,
          blockers: readiness.blockers,
        });
      }
    }
    const stationBudget = evaluateScenarioAssetBudget(presentRequiredManifests);

    return {
      scenarioId: scenario.scenarioId,
      devReady: missingRequiredAssetIds.length === 0 && blockedAssets.length === 0 && stationBudget.blockers.length === 0,
      productionReady: missingRequiredAssetIds.length === 0
        && blockedAssets.length === 0
        && productionBlockedAssets.length === 0
        && stationBudget.blockers.length === 0,
      stationBudget,
      missingRequiredAssetIds,
      blockedAssets,
      productionBlockedAssets,
    };
  }

  evaluateScenarioProductionReadinessLadder(scenario: Scenario): ScenarioAssetProductionReadinessLadder {
    const scenarioReadiness = this.evaluateScenarioReadiness(scenario);
    const requiredAssetIds = [...new Set(scenario.assetNeeds?.map((assetNeed) => assetNeed.assetId) ?? [])];
    const assetLadders = requiredAssetIds
      .map((assetId) => this.manifests.get(assetId))
      .filter((manifest): manifest is AssetManifest => Boolean(manifest))
      .map(evaluateAssetProductionReadinessLadder);
    const blockedAssetIds = assetLadders
      .filter((ladder) => !ladder.productionReady)
      .map((ladder) => ladder.assetId);
    const productionReadyAssetIds = assetLadders
      .filter((ladder) => ladder.productionReady)
      .map((ladder) => ladder.assetId);
    const blockers = uniqueAssetReadinessValues([
      ...scenarioReadiness.missingRequiredAssetIds.map((assetId) => `missing_required_asset:${assetId}`),
      ...scenarioReadiness.stationBudget.blockers,
      ...assetLadders.flatMap((ladder) => ladder.blockers.map((blocker) => `${ladder.assetId}:${blocker}`)),
    ]);

    return {
      scenarioId: scenario.scenarioId,
      productionReady: scenarioReadiness.productionReady && blockedAssetIds.length === 0,
      assetCount: assetLadders.length,
      productionReadyAssetIds,
      blockedAssetIds,
      missingRequiredAssetIds: scenarioReadiness.missingRequiredAssetIds,
      blockers,
      stationBudget: scenarioReadiness.stationBudget,
      assetLadders,
    };
  }
}

function readinessStep(
  step: AssetProductionReadinessStepName,
  evidenceRefs: string[],
  blockers: string[],
): AssetProductionReadinessStep {
  return {
    step,
    status: blockers.length === 0 ? "complete" : "blocked",
    evidenceRefs,
    blockers,
  };
}

function recommendedAssetReviewAction(step: AssetProductionReadinessStep): string {
  if (step.status === "complete") {
    return "Keep evidence attached for release review.";
  }

  const actions: Record<AssetProductionReadinessStepName, string> = {
    provenance_license: "Attach approved source, provenance, and license records before any downstream release review.",
    generation_evidence: "Attach generated-human, skin/clothing, equipment, rigging, or animation evidence required for this asset type.",
    optimization_evidence: "Attach LOD, texture-budget, and collider-simplification evidence for the Quest/WebXR target.",
    quest_qa: "Run or attach Quest QA evidence and resolve any production-limiting limitations before release review.",
    visual_clinical_critique: "Complete visual clinical realism critique with simulation/clinical reviewers before release review.",
    production_release: "Do not release until every prior evidence step is complete and no production blockers remain.",
  };
  return actions[step.step];
}

function buildEnvironmentGenerationReviewGates(environmentManifest: AssetManifest): EnvironmentGenerationReviewGate[] {
  const provenanceRefs = environmentManifest.provenance.sourceRefs.filter((sourceRef) => sourceRef.trim().length > 0);
  const generationEvidenceRefs = assetGenerationEvidenceRefs(environmentManifest);
  const optimizationEvidenceRefs = assetOptimizationEvidenceRefs(environmentManifest);
  const generationBlockers = environmentManifest.generationEvidence?.medicalEquipmentLibraryRecordId
    ? []
    : ["environment_generation_evidence_missing"];
  const optimizationBlockers = assetOptimizationEvidenceBlockers(environmentManifest).length === 0
    ? []
    : ["environment_optimization_evidence_missing"];

  return [
    environmentReviewGate(
      "provenance_license",
      provenanceRefs,
      provenanceLicenseBlockers(environmentManifest),
      "Keep approved environment source and license records attached before generation review.",
    ),
    environmentReviewGate(
      "attach_environment_generation_evidence",
      generationEvidenceRefs,
      generationBlockers,
      "Attach Blender/manual-modeling export evidence, equipment library records, and scene-layout notes before review.",
    ),
    environmentReviewGate(
      "attach_optimization_evidence",
      optimizationEvidenceRefs,
      optimizationBlockers,
      "Attach LOD, texture-compression, collider, and draw-call budget reports for Quest/WebXR review.",
    ),
    environmentReviewGate(
      "visual_clinical_critique",
      [],
      ["visual_clinical_critique_missing"],
      "Complete clinical/simulation review of spatial layout, equipment realism, and distraction fidelity.",
    ),
    environmentReviewGate(
      "quest_runtime_evidence",
      [],
      ["quest_runtime_evidence_not_attached"],
      "Attach approved worn-headset or documented Quest/WebXR evidence before any runtime-readiness claim.",
    ),
  ];
}

function environmentReviewGate(
  gate: EnvironmentGenerationReviewGateName,
  evidenceRefs: string[],
  blockers: string[],
  recommendedAction: string,
): EnvironmentGenerationReviewGate {
  return {
    gate,
    status: blockers.length === 0 ? "complete" : "blocked",
    evidenceRefs,
    blockers,
    recommendedAction,
  };
}

function buildEdBaySpatialZones(
  environmentAssetId: string,
  requiredAssetIds: readonly string[],
  optionalContextAssetIds: readonly string[],
): EnvironmentSpatialZone[] {
  const hasRequired = (assetId: string) => requiredAssetIds.includes(assetId);
  const hasOptional = (assetId: string) => optionalContextAssetIds.includes(assetId);
  const includeExisting = (assetIds: readonly string[]) => assetIds.filter((assetId) => (
    assetId === environmentAssetId || hasRequired(assetId) || hasOptional(assetId)
  ));

  return [
    {
      zoneId: "learner_entry",
      label: "Learner entry and orientation",
      purpose: "Give the examinee a clear start position, doorway sightline, and safe movement envelope before the encounter timer starts.",
      assetIds: includeExisting([environmentAssetId]),
      spatialAnchors: ["doorway_panel", "hand_hygiene_marker", "exam_timer_sightline"],
      clinicalFidelityNotes: ["Doorway framing should support first-impression scan and interruption timing without cluttering controller movement."],
    },
    {
      zoneId: "patient_bedside",
      label: "Patient bedside interaction",
      purpose: "Anchor history-taking, pain-response observation, focused exam prompts, and patient gaze/gesture alignment.",
      assetIds: includeExisting([environmentAssetId, "patient_robert_hayes_character", "ed_stretcher_bed_equipment"]),
      spatialAnchors: ["patient_head_position", "left_bed_rail", "examiner_standing_zone"],
      clinicalFidelityNotes: ["Bed height, patient posture, and reach distance should remain readable in Quest/WebXR without requiring unsafe leaning."],
    },
    {
      zoneId: "nurse_workflow",
      label: "Nurse workflow and escalation",
      purpose: "Support nurse handoff, medication/order clarification, vital-sign changes, and team-communication pressure.",
      assetIds: includeExisting([environmentAssetId, "nurse_maria_alvarez_character", "bedside_monitor_equipment"]),
      spatialAnchors: ["nurse_standing_zone", "monitor_glance_target", "handoff_tablet_marker"],
      clinicalFidelityNotes: ["Nurse position should be visible from bedside while preserving conversational turn-taking and de-escalation cues."],
    },
    {
      zoneId: "family_interrupt",
      label: "Family interruption lane",
      purpose: "Provide a believable doorway/side-chair location for family concern, emotional pressure, and consent-boundary beats.",
      assetIds: includeExisting([environmentAssetId, "spouse_anna_hayes_character"]),
      spatialAnchors: ["doorway_interrupt_position", "family_waiting_spot", "privacy_boundary_marker"],
      clinicalFidelityNotes: ["Family placement should increase pressure without blocking learner access to the patient or nurse."],
    },
    {
      zoneId: "diagnostic_equipment",
      label: "Diagnostic equipment cluster",
      purpose: "Place ECG cart, IV stand, and monitor affordances where diagnostic-order and interpretation trace events can be observed.",
      assetIds: includeExisting([environmentAssetId, "bedside_monitor_equipment", "ecg_cart_equipment", "iv_stand_equipment"]),
      spatialAnchors: ["ecg_cart_parking_spot", "iv_stand_side_position", "vital_sign_display_plane"],
      clinicalFidelityNotes: ["Equipment should be recognizable but low-poly, with readable silhouettes and no production-readiness claim until review gates clear."],
    },
  ];
}

function buildEnvironmentGenerationWorkOrderTasks(packet: EnvironmentGenerationPacket): EnvironmentGenerationWorkOrderTask[] {
  return [
    {
      taskId: "prepare_scene_layout",
      title: "Prepare reviewed spatial layout",
      status: "pending",
      instructions: `Map ${packet.spatialZones.length} spatial zones and preserve named anchors for learner entry, bedside interaction, team workflow, family interruption, and equipment tracing.`,
      evidenceOutputs: ["environment_spatial_layout_notes"],
    },
    {
      taskId: "model_static_room_shell",
      title: "Model static room shell",
      status: "pending",
      instructions: `Author ${packet.displayName} as a low-poly static scene targeting ${packet.targetRuntime}; keep Blender/manual-modeling output outside production runtime dependencies.`,
      evidenceOutputs: ["blender_bake_report", "gltf_validation_report"],
    },
    {
      taskId: "place_required_equipment",
      title: "Place required equipment and context assets",
      status: "pending",
      instructions: `Place ${packet.requiredAssetIds.length} required assets and ${packet.optionalContextAssetIds.length} optional context assets according to spatial-zone anchors without blocking learner movement.`,
      evidenceOutputs: ["equipment_placement_manifest", "environment_spatial_layout_notes"],
    },
    {
      taskId: "export_quest_budget_reports",
      title: "Export Quest/WebXR budget reports",
      status: "pending",
      instructions: `Export triangle, texture, draw-call, LOD, and collider evidence against ${packet.questBudget.maxVisibleTriangles} visible triangles, ${packet.questBudget.maxTextureMegabytes} MB textures, and ${packet.questBudget.maxDrawCalls} draw calls.`,
      evidenceOutputs: ["quest_budget_report", "texture_budget_report", "collider_simplification_report"],
    },
    {
      taskId: "request_clinical_visual_review",
      title: "Request clinical visual critique",
      status: "pending",
      instructions: "Send screenshots or lightweight scene review artifacts to clinical/simulation reviewers for spatial realism, equipment fidelity, and distraction-pressure critique before release review.",
      evidenceOutputs: ["clinical_visual_review_request"],
    },
  ];
}

function buildEnvironmentGenerationOperatorHandoff(
  packet: EnvironmentGenerationPacket,
  tasks: EnvironmentGenerationWorkOrderTask[],
): EnvironmentGenerationOperatorHandoff {
  const evidenceOutputIds = Array.from(new Set(tasks.flatMap((task) => task.evidenceOutputs))).sort();
  const missingEvidenceIds = packet.readyForGenerationReview ? [] : evidenceOutputIds;
  const reviewBlockerIds = Array.from(new Set(packet.reviewGates.flatMap((gate) => gate.blockers))).sort();
  const nextBlockedGate = packet.reviewGates.find((gate) => gate.blockers.length > 0) ?? packet.reviewGates[0];

  return {
    summary: `${packet.displayName}: ${tasks.length} authoring tasks and ${missingEvidenceIds.length} evidence outputs before generation review.`,
    nextAction: nextBlockedGate?.recommendedAction ?? "Submit environment generation packet for review.",
    missingEvidenceIds,
    reviewBlockerIds,
    claimBoundary: "operator_handoff_not_asset_generation",
  };
}

function provenanceLicenseBlockers(manifest: AssetManifest): string[] {
  return [
    manifest.provenance.sourceRefs.some((sourceRef) => sourceRef.trim().length > 0) ? undefined : "source_refs_missing",
    manifest.provenance.licenseStatus === "approved" ? undefined : `license_${manifest.provenance.licenseStatus}`,
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function assetGenerationEvidenceRefs(manifest: AssetManifest): string[] {
  return [
    manifest.generationEvidence?.generatedHumanRiggingReportId,
    manifest.generationEvidence?.skinClothingProvenanceId,
    manifest.generationEvidence?.medicalEquipmentLibraryRecordId,
    manifest.generationEvidence?.animationRetargetingReportId,
  ].filter((value): value is string => Boolean(value));
}

function assetGenerationEvidenceBlockers(manifest: AssetManifest): string[] {
  if (manifest.kind === "character") {
    return [
      manifest.generationEvidence?.generatedHumanRiggingReportId ? undefined : "generated_human_rigging_missing",
      manifest.generationEvidence?.skinClothingProvenanceId ? undefined : "skin_clothing_provenance_missing",
      manifest.generationEvidence?.animationRetargetingReportId ? undefined : "animation_retargeting_missing",
    ].filter((blocker): blocker is string => typeof blocker === "string");
  }
  if (manifest.kind === "environment" || manifest.kind === "equipment") {
    return manifest.generationEvidence?.medicalEquipmentLibraryRecordId ? [] : ["medical_equipment_library_missing"];
  }
  return [];
}

function assetOptimizationEvidenceRefs(manifest: AssetManifest): string[] {
  return [
    ...(manifest.optimizationEvidence?.lodTiers ?? []),
    manifest.optimizationEvidence?.textureBudgetReportId,
    manifest.optimizationEvidence?.colliderSimplificationReportId,
  ].filter((value): value is string => Boolean(value));
}

function assetOptimizationEvidenceBlockers(manifest: AssetManifest): string[] {
  return [
    (manifest.optimizationEvidence?.lodTiers?.length ?? 0) >= 2 ? undefined : "lod_tiers_missing",
    manifest.optimizationEvidence?.textureBudgetReportId ? undefined : "texture_compression_budget_missing",
    manifest.optimizationEvidence?.colliderSimplificationReportId ? undefined : "collider_simplification_report_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function uniqueAssetReadinessValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function cloneAssetManifest(manifest: AssetManifest): AssetManifest {
  return JSON.parse(JSON.stringify(manifest)) as AssetManifest;
}

export function validateAssetManifestStructure(manifest: unknown): ValidationResult {
  return validateSharedAssetManifest(manifest);
}

export function evaluateScenarioAssetBudget(manifests: readonly AssetManifest[]): ScenarioAssetBudget {
  const totals = manifests.reduce(
    (sum, manifest) => ({
      totalTriangles: sum.totalTriangles + manifest.geometryBudget.maxTriangles,
      totalTextureMegabytes: sum.totalTextureMegabytes + manifest.geometryBudget.maxTextureMegabytes,
      totalDrawCalls: sum.totalDrawCalls + manifest.geometryBudget.maxDrawCalls,
    }),
    { totalTriangles: 0, totalTextureMegabytes: 0, totalDrawCalls: 0 },
  );
  const blockers = [
    totals.totalTriangles > quest3StationBudget.maxVisibleTriangles ? "station_triangle_budget_exceeded" : undefined,
    totals.totalTextureMegabytes > quest3StationBudget.maxTextureMegabytes ? "station_texture_budget_exceeded" : undefined,
    totals.totalDrawCalls > quest3StationBudget.maxDrawCalls ? "station_draw_call_budget_exceeded" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    ...quest3StationBudget,
    ...totals,
    blockers,
  };
}

export function evaluateScenarioOptimizationEvidence(manifests: readonly AssetManifest[]): ScenarioOptimizationEvidence {
  const lodTiersObserved = manifests.length > 0
    && manifests.every((manifest) => (manifest.optimizationEvidence?.lodTiers?.length ?? 0) >= 2);
  const textureCompressionBudgetObserved = manifests.length > 0
    && manifests.every((manifest) => Boolean(
      manifest.optimizationEvidence?.textureCompressionFormat
      && manifest.optimizationEvidence.textureBudgetReportId,
    ));
  const colliderSimplificationObserved = manifests.length > 0
    && manifests.every((manifest) => Boolean(manifest.optimizationEvidence?.colliderSimplificationReportId));
  const blockers = [
    lodTiersObserved ? undefined : "lod_tiers_missing",
    textureCompressionBudgetObserved ? undefined : "texture_compression_budget_missing",
    colliderSimplificationObserved ? undefined : "collider_simplification_report_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    lodTiersObserved,
    textureCompressionBudgetObserved,
    colliderSimplificationObserved,
    placeholderOnly: manifests.length > 0 && manifests.every(isPlaceholderAsset),
    blockers,
  };
}

export function evaluateScenarioGenerationEvidence(manifests: readonly AssetManifest[]): ScenarioGenerationEvidence {
  const characterManifests = manifests.filter((manifest) => manifest.kind === "character");
  const equipmentOrEnvironmentManifests = manifests.filter((manifest) => manifest.kind === "equipment" || manifest.kind === "environment");
  const placeholderOnly = manifests.length > 0 && manifests.every(isPlaceholderAsset);
  const hasProductionSource = (manifest: AssetManifest) => !isPlaceholderAsset(manifest)
    && manifest.provenance.licenseStatus === "approved"
    && manifest.provenance.sourceRefs.some((sourceRef) => sourceRef.trim().length > 0);
  const generatedHumanRiggingObserved = characterManifests.length > 0
    && characterManifests.every((manifest) => hasProductionSource(manifest)
      && Boolean(manifest.generationEvidence?.generatedHumanRiggingReportId));
  const skinClothingProvenanceObserved = characterManifests.length > 0
    && characterManifests.every((manifest) => hasProductionSource(manifest)
      && Boolean(manifest.generationEvidence?.skinClothingProvenanceId));
  const medicalEquipmentLibraryObserved = equipmentOrEnvironmentManifests.length > 0
    && equipmentOrEnvironmentManifests.every((manifest) => hasProductionSource(manifest)
      && Boolean(manifest.generationEvidence?.medicalEquipmentLibraryRecordId));
  const animationRetargetingObserved = characterManifests.length > 0
    && characterManifests.every((manifest) => hasProductionSource(manifest)
      && Boolean(manifest.generationEvidence?.animationRetargetingReportId));
  const blockers = [
    generatedHumanRiggingObserved ? undefined : "generated_human_rigging_missing",
    skinClothingProvenanceObserved ? undefined : "skin_clothing_provenance_missing",
    medicalEquipmentLibraryObserved ? undefined : "medical_equipment_library_missing",
    animationRetargetingObserved ? undefined : "animation_retargeting_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    generatedHumanRiggingObserved,
    skinClothingProvenanceObserved,
    medicalEquipmentLibraryObserved,
    animationRetargetingObserved,
    placeholderOnly,
    blockers,
  };
}

export function createEdChestPainPlaceholderManifests(): AssetManifest[] {
  return [
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "patient_robert_hayes_character",
      kind: "character",
      displayName: "Robert Hayes patient character",
      description: "Middle-aged standardized patient placeholder with chest discomfort poses and hospital gown.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-mesh"],
      maxTriangles: 18000,
      maxTextureMegabytes: 24,
      maxDrawCalls: 8,
      tags: ["patient", "diaphoretic", "hospital-gown"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "nurse_maria_alvarez_character",
      kind: "character",
      displayName: "Maria Alvarez nurse character",
      description: "ED nurse placeholder with scrubs, badge, tablet, and urgent escalation gestures.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-mesh"],
      maxTriangles: 18000,
      maxTextureMegabytes: 24,
      maxDrawCalls: 8,
      tags: ["nurse", "scrubs", "team-communication"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "spouse_anna_hayes_character",
      kind: "character",
      displayName: "Anna Hayes spouse character",
      description: "Family member placeholder for doorway interruption, concern escalation, and emotional-pressure beats.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-mesh"],
      maxTriangles: 18000,
      maxTextureMegabytes: 24,
      maxDrawCalls: 8,
      tags: ["family", "spouse", "interruption"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "ed_exam_bay_environment",
      kind: "environment",
      displayName: "Emergency department exam bay",
      description: "Quest-budgeted ED bay placeholder with stretcher, wall monitor, ECG cart position, IV pole, and doorway panel.",
      generationMethod: "manual_modeling",
      sourceRefs: ["openclinxr-placeholder-environment"],
      maxTriangles: 24000,
      maxTextureMegabytes: 32,
      maxDrawCalls: 12,
      tags: ["environment", "ed-bay", "stretcher", "monitor"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "12_lead_ecg_machine_equipment",
      kind: "equipment",
      displayName: "12-lead ECG machine",
      description: "ECG machine placeholder with cable bundle and placement affordance for order/request tracing.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-equipment"],
      maxTriangles: 5000,
      maxTextureMegabytes: 8,
      maxDrawCalls: 4,
      tags: ["equipment", "ecg", "diagnostic-order"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "bedside_monitor_equipment",
      kind: "equipment",
      displayName: "Bedside monitor",
      description: "Readable bedside monitor placeholder for vital-sign display and nurse-interruption beats.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-equipment"],
      maxTriangles: 5000,
      maxTextureMegabytes: 8,
      maxDrawCalls: 4,
      tags: ["equipment", "monitor", "vitals"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "stretcher_equipment",
      kind: "equipment",
      displayName: "ED stretcher bed",
      description: "Quest-budgeted stretcher placeholder with side rails, pillow, blanket, and patient positioning markers.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-equipment"],
      maxTriangles: 5000,
      maxTextureMegabytes: 8,
      maxDrawCalls: 4,
      tags: ["equipment", "bed", "stretcher"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "iv_pole_equipment",
      kind: "equipment",
      displayName: "IV pole",
      description: "Low-poly IV pole placeholder for ED room realism and equipment inventory planning.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-equipment"],
      maxTriangles: 5000,
      maxTextureMegabytes: 8,
      maxDrawCalls: 4,
      tags: ["equipment", "iv-pole", "room-context"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "oxygen_nasal_cannula_equipment",
      kind: "equipment",
      displayName: "Oxygen nasal cannula",
      description: "Low-poly oxygen nasal cannula placeholder for oxygen-order and patient-comfort interaction beats.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-equipment"],
      maxTriangles: 5000,
      maxTextureMegabytes: 8,
      maxDrawCalls: 4,
      tags: ["equipment", "oxygen", "nasal-cannula"],
    }),
    createManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assetId: "wall_clock_equipment",
      kind: "equipment",
      displayName: "Wall clock",
      description: "Wall clock placeholder for time-pressure cues and encounter timing evidence.",
      generationMethod: "procedural_placeholder",
      sourceRefs: ["openclinxr-placeholder-equipment"],
      maxTriangles: 5000,
      maxTextureMegabytes: 8,
      maxDrawCalls: 4,
      tags: ["equipment", "clock", "time-pressure"],
    }),
  ];
}

export function createEdChestPainLocalAssetEvidenceFixtureManifests(): AssetManifest[] {
  return createEdChestPainPlaceholderManifests().map((manifest) => {
    const sourceRef = "openclinxr-local-asset-evidence-fixture-2026-05-06";

    return {
      ...manifest,
      provenance: {
        generationMethod: manifest.kind === "environment" ? "manual_modeling" : "anny",
        sourceRefs: [sourceRef, `${manifest.assetId}_local_fixture_provenance`],
        licenseStatus: "approved",
      },
      generationEvidence: {
        ...(manifest.kind === "character" ? {
          generatedHumanRiggingReportId: `${manifest.assetId}_canonical_skeleton_report`,
          skinClothingProvenanceId: `${manifest.assetId}_skin_clothing_provenance`,
          animationRetargetingReportId: `${manifest.assetId}_retargeting_report`,
        } : {}),
        ...(manifest.kind === "environment" || manifest.kind === "equipment" ? {
          medicalEquipmentLibraryRecordId: `${manifest.assetId}_ecg_cart_equipment_library`,
        } : {}),
      },
      optimizationEvidence: {
        lodTiers: [`${manifest.assetId}_lod0`, `${manifest.assetId}_lod1`, `${manifest.assetId}_lod2`],
        textureCompressionFormat: "none_flat_generated_materials",
        textureBudgetReportId: `${manifest.assetId}_texture_budget_report`,
        colliderSimplificationReportId: `${manifest.assetId}_collider_simplification_report`,
      },
      questQaStatus: {
        status: "sim_qa_ready",
        reviewedAt: "2026-05-06T00:00:00.000Z",
        limitations: ["Local fixture evidence only; not a production clinical realism approval."],
      },
      pipelineStages: manifest.pipelineStages.map((stageRecord) => ({
        ...stageRecord,
        notes: `Local fixture evidence for ${stageRecord.stage} on ${manifest.assetId}.`,
      })),
    };
  });
}

export function createScenarioPlaceholderManifests(scenario: Scenario): AssetManifest[] {
  return (scenario.assetNeeds ?? []).map((assetNeed) => {
    const kind = assetKindFromNeed(assetNeed.assetType);
    const budget = placeholderBudgetForKind(kind);

    return createManifest({
      scenarioId: scenario.scenarioId,
      assetId: assetNeed.assetId,
      kind,
      displayName: humanizeAssetId(assetNeed.assetId),
      description: assetNeed.description,
      generationMethod: kind === "environment" ? "manual_modeling" : "procedural_placeholder",
      sourceRefs: [`openclinxr-placeholder-${kind}`],
      maxTriangles: budget.maxTriangles,
      maxTextureMegabytes: budget.maxTextureMegabytes,
      maxDrawCalls: budget.maxDrawCalls,
      tags: [
        kind,
        scenario.scenarioId,
        ...(kind === "character" ? [characterRoleFromAssetId(assetNeed.assetId)] : []),
      ],
    });
  });
}

function createManifest(input: {
  scenarioId: string;
  assetId: string;
  kind: AssetKind;
  displayName: string;
  description: string;
  generationMethod: AssetGenerationMethod;
  sourceRefs: string[];
  maxTriangles: number;
  maxTextureMegabytes: number;
  maxDrawCalls: number;
  tags: string[];
}): AssetManifest {
  const actorRole = input.kind === "character" ? characterRoleFromTags(input.tags) : null;

  return {
    assetId: input.assetId,
    scenarioId: input.scenarioId,
    kind: input.kind,
    displayName: input.displayName,
    description: input.description,
    requiredForScenario: true,
    targetRuntime: "quest3_webxr",
    provenance: {
      generationMethod: input.generationMethod,
      sourceRefs: [...input.sourceRefs],
      licenseStatus: "approved",
    },
    ...(actorRole ? {
      humanoidRealismMetadata: buildHumanoidRealismMetadata({
        actorRole,
        actorId: input.assetId.replace(/_character$/u, "_v1"),
        targetActorIds: [],
        roleCue: actorRole === "family" ? "family_or_parent" : actorRole,
        fixtureOnly: true,
      }),
    } : {}),
    geometryBudget: {
      maxTriangles: input.maxTriangles,
      maxTextureMegabytes: input.maxTextureMegabytes,
      maxDrawCalls: input.maxDrawCalls,
    },
    questQaStatus: {
      status: "placeholder_dev_ready",
      reviewedAt: "2026-05-03T16:15:00.000Z",
      limitations: ["Placeholder asset is approved for deterministic development and simulation QA only."],
    },
    pipelineStages: [
      stage("requested", `Asset need extracted from ${input.scenarioId}.`),
      stage("source_reviewed", "Placeholder source is local and approved for repository use."),
      stage("mesh_generated", "Low-poly placeholder mesh generated for runtime scaffolding."),
      stage("rigged", "Placeholder character or static-scene rig metadata recorded."),
      stage("optimized", "Quest 3 budget checked for initial WebXR shell."),
      stage("qa_ready", "Ready for deterministic runtime tests; not production clinical realism."),
    ],
    tags: [...input.tags],
  };
}

function buildHumanoidRealismMetadata(input: {
  actorRole: string;
  actorId: string;
  targetActorIds: string[];
  roleCue: string;
  fixtureOnly: boolean;
}): HumanoidRealismMetadata {
  const safeActorId = input.actorId.replace(/[^a-z0-9_:-]+/giu, "_").toLowerCase();
  return {
    schemaVersion: "openclinxr.humanoid-realism-metadata.v1",
    actorRole: input.actorRole,
    metadataScope: "review_contract_only",
    fixtureStatus: {
      fixtureOnly: input.fixtureOnly,
      nonProduction: true,
      materializedAssetGenerated: false,
    },
    claimBoundaries: {
      productionReadinessClaimed: false,
      questReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    },
    faceAndMouthControls: {
      facialBlendshapeMapRef: `${safeActorId}:facial_blendshape_map_required`,
      requiredBlendshapeIds: ["neutral", "brow_raise", "brow_furrow", "blink_left", "blink_right", "jaw_open", "mouth_close", "lip_funnel", "lip_pucker"],
      visemeMapRef: `${safeActorId}:viseme_phoneme_map_required`,
      requiredVisemeIds: ["sil", "aa", "ee", "oh", "f_v", "l", "m_b_p", "s_z", "th"],
      mouthSyncNeeds: ["dialogue_turn_viseme_timing", "closed_mouth_rest_pose", "speech_pause_mouth_return"],
    },
    eyeAndGazeControls: {
      gazeControlMapRef: `${safeActorId}:gaze_blink_control_map_required`,
      blinkControlMapRef: `${safeActorId}:blink_cue_map_required`,
      eyeContactTargets: {
        defaultTarget: "learner_camera",
        allowedTargetKinds: ["learner_camera", "actor", "clinical_object"],
        targetActorIds: [...input.targetActorIds],
      },
      gazeLimitations: ["metadata_only_no_eye_contact_quality_claim", "requires_visual_qa_for_uncanny_or_fixed_stare_blockers"],
    },
    poseAndAnimationNeeds: {
      locomotionClipNeeds: [`${input.roleCue}_safe_room_movement_or_stationary_transition`],
      idleClipNeeds: [`${input.roleCue}_breathing_idle`, `${input.roleCue}_listening_idle`],
      conversationGestureNeeds: [`${input.roleCue}_turn_taking_gesture`, `${input.roleCue}_emotionally_appropriate_response_gesture`],
      postureConstraints: ["maintain_clinical_context_readability", "avoid_interpenetration_with_bed_chair_equipment"],
    },
    appearanceConstraints: {
      clothing: [`${input.roleCue}_role_appropriate_clothing`, "no_brand_or_institution_logo_without_license"],
      skinMaterial: [`${input.roleCue}_skin_material_review_needed`, "avoid_diagnostic_visual_cues_without_clinical_review"],
      hairOrHeadCovering: [`${input.roleCue}_hair_or_head_covering_profile`, "avoid_unlicensed_likeness_reference"],
      protectedClassAndIdentityConstraints: ["synthetic_identity_only", "no_real_person_likeness_without_explicit_rights", "review_for_bias_or_stereotype_cues"],
    },
    collisionAndInteractionProxyNeeds: {
      requiredProxyIds: [`${safeActorId}:body_collision_proxy`, `${safeActorId}:conversation_target_proxy`, `${safeActorId}:personal_space_proxy`],
      interactionProxyLimitations: ["proxy_metadata_only_no_physics_quality_claim", "requires_runtime_collision_review_before_learner_use"],
    },
    provenanceAndLicenseNeeds: {
      requiredRefs: ["source_asset_manifest", "license_provenance_report", "derivative_materials_record"],
      prohibitedSourcePosture: ["agpl_or_copyleft_without_legal_exception", "unreviewed_paid_or_cloud_generation", "real_person_likeness_without_rights"],
    },
    limitations: ["metadata_contract_only", "no_materialized_humanoid_asset_generated", "fixture_or_non_production_status_must_remain_visible"],
    visualQaBlockers: [
      "visual_qa_not_attached",
      "facial_expression_quality_not_reviewed",
      "eye_contact_and_blink_quality_not_reviewed",
      "mouth_viseme_quality_not_reviewed",
      "pose_clothing_skin_hair_quality_not_reviewed",
      "collision_interaction_proxy_not_reviewed",
    ],
    requiredReviewEvidenceIds: [
      "humanoid_mesh_manifest",
      "facial_blendshape_map",
      "viseme_phoneme_map",
      "gaze_blink_control_map",
      "animation_clip_manifest",
      "collision_proxy_manifest",
      "license_provenance_report",
      "visual_qa_evidence",
    ],
  };
}

function characterRoleFromTags(tags: readonly string[]): string | null {
  if (tags.includes("patient")) {
    return "patient";
  }
  if (tags.includes("nurse")) {
    return "nurse";
  }
  if (tags.includes("family") || tags.includes("spouse") || tags.includes("parent")) {
    return "family";
  }
  return tags.includes("character") ? "other" : null;
}

function characterRoleFromAssetId(assetId: string): string {
  if (assetId.startsWith("patient_")) {
    return "patient";
  }
  if (assetId.startsWith("nurse_")) {
    return "nurse";
  }
  if (assetId.startsWith("family_") || assetId.startsWith("parent_") || assetId.startsWith("spouse_")) {
    return "family";
  }
  return "other";
}

function assetKindFromNeed(assetType: string): AssetKind {
  if (assetType === "character" || assetType === "environment" || assetType === "equipment" || assetType === "prop" || assetType === "texture" || assetType === "audio") {
    return assetType;
  }
  return "prop";
}

function placeholderBudgetForKind(kind: AssetKind): Pick<AssetManifest["geometryBudget"], "maxTriangles" | "maxTextureMegabytes" | "maxDrawCalls"> {
  if (kind === "character") {
    return { maxTriangles: 18000, maxTextureMegabytes: 24, maxDrawCalls: 8 };
  }
  if (kind === "environment") {
    return { maxTriangles: 24000, maxTextureMegabytes: 32, maxDrawCalls: 12 };
  }
  if (kind === "equipment" || kind === "prop") {
    return { maxTriangles: 5000, maxTextureMegabytes: 8, maxDrawCalls: 4 };
  }
  return { maxTriangles: 1000, maxTextureMegabytes: 4, maxDrawCalls: 2 };
}

function humanizeAssetId(assetId: string): string {
  return assetId
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function stage(stageName: AssetPipelineStageName, notes: string): AssetPipelineStage {
  return {
    stage: stageName,
    completedAt: "2026-05-03T16:15:00.000Z",
    notes,
  };
}

function isPlaceholderAsset(manifest: AssetManifest): boolean {
  return manifest.provenance?.generationMethod === "procedural_placeholder"
    || (manifest.provenance?.sourceRefs ?? []).some((sourceRef) => sourceRef.includes("placeholder"))
    || (manifest.pipelineStages ?? []).some((stage) => stage.notes.toLowerCase().includes("not production clinical realism"));
}

function hasProductionLimitingQuestQaStatus(status: AssetQuestQaStatus | undefined): boolean {
  return status?.limitations.some((limitation) => {
    const normalized = limitation.toLowerCase();
    return normalized.includes("local fixture")
      || normalized.includes("not a production")
      || normalized.includes("not production")
      || normalized.includes("simulation qa only");
  }) ?? false;
}
