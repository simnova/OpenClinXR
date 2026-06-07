export type ModelVettingGateResult =
  | "blocked_before_scene"
  | "ready_for_scene_placement_evidence"
  | "needs_provider_iteration"
  | "archive_as_reference_only";

export type ModelVettingProviderBoundary = {
  providerId: "anny_local_or_anny_compatible_import";
  policyMode: "local_metadata_only";
  approvalStatus: "not_required_for_metadata_only";
  localOnly: true;
  providerExecutionEnabled: false;
  externalNetworkUsed: false;
  paidApiUsed: false;
  credentialsRequired: false;
  blockedProviderExecutionReasons: string[];
};

export type ModelVettingFalseGates = {
  realAnny: boolean;
  bPlusRealism: false;
  scenePlacementReadiness: false;
  questReadiness: false;
  productionReadiness: false;
  learnerReadiness: false;
  clinicalValidity: false;
  scoringValidity: false;
};

export type ModelVettingLabModeId =
  | "static_model_inspection"
  | "rig_inspection"
  | "morph_phoneme_inspection"
  | "animation_clip_inspection"
  | "material_realism_inspection"
  | "optimization_inspection";

export type ModelVettingLabMode = {
  modeId: ModelVettingLabModeId;
  status: "pass" | "warn" | "block";
  evidence: string[];
  requiredArtifactKinds: Array<"json" | "screenshot" | "video">;
  capturedArtifactPaths: string[];
  blockers: string[];
};

export type ModelVettingCaptureArtifacts = {
  fixedCameraScreenshots: string[];
  turntableVideo?: string;
  morphVisemeTimelineCapture?: string;
  emotionTransitionCapture?: string;
};

export type ModelVettingRoleMaterialHandoff = {
  actorRole: string;
  roleVisualCue: string;
  clothingStyle: string;
  objectNames: string[];
  meshRegionMaterialMode?: string;
  topMaterialName?: string;
  lowerMaterialName?: string;
  topFaceCount?: number;
  lowerFaceCount?: number;
  wardrobeRole: string;
  garmentLayers: string[];
  fabricPalette: string;
  materialFinish: string;
  accessoryMarkers: string[];
  generatedAccessoryObjects: string[];
  claimScope: string;
  notEvidenceFor: string[];
};

export type ModelVettingRoleAnimationHandoff = {
  actorRole: string;
  roleSpecificClipNames: string[];
  claimScope: string;
  notEvidenceFor: string[];
};

export type ModelVettingProceduralFaceDetailHandoff = {
  hairPlacementMode: string;
  eyePlacementMode: string;
  featurePlacementMode: string;
  hairObjectName: string;
  eyeObjectNames: string[];
  facialFeatureObjectNames: string[];
  coordinateBasis: string;
  headTopY: number | null;
  eyeY: number | null;
  faceZ: number | null;
  claimScope: string;
  notEvidenceFor: string[];
};

export type ModelVettingCandidate = {
  candidateId: string;
  scenarioId: string;
  actorId: string;
  actorRole: "patient" | "family" | "nurse" | "consultant" | "interpreter";
  actorDisplayRole: string;
  reuseKey: string;
  sourceGlbPath: string;
  provenancePath: string;
  sourcePreflightStatus: string;
  sourceKind: "anny_compatible_stub_mesh" | "real_anny_candidate_unverified" | "imported_humanoid_candidate";
  usesRealAnnyForwardPass: boolean;
  gateResult: ModelVettingGateResult;
  labModes: ModelVettingLabMode[];
  structuralMetrics: {
    byteLength: number;
    sha256: string;
    sceneCount: number;
    nodeCount: number;
    meshCount: number;
    materialCount: number;
    skinCount: number;
    animationCount: number;
    morphTargetPrimitiveCount: number;
    vertexCount: number;
  };
  rigAndAnimation: {
    canonicalSkeletonNodesPresent: boolean;
    faceRigNodesPresent: boolean;
    gazeEyeNodesPresent: boolean;
    blinkControlPresent: boolean;
    requiredMorphTargetsPresent: boolean;
    requiredMorphTargets: string[];
    missingMorphTargets: string[];
    observedMorphTargets: string[];
    locomotionPostureClipPresent: boolean;
    clinicalIdlePoseClipCount: number;
  };
  roleMaterialHandoff?: ModelVettingRoleMaterialHandoff;
  roleAnimationHandoff?: ModelVettingRoleAnimationHandoff;
  proceduralFaceDetailHandoff?: ModelVettingProceduralFaceDetailHandoff;
  provenance: {
    documentSha256: string;
    sourceReportCandidateId: string;
    sourceGlbPath: string;
    provenancePath: string;
    auditPointers: string[];
    sourceOriginChainPresent: boolean;
    licenseChainPresent: boolean;
    derivativeLineagePresent: boolean;
    toolVersionPresent: boolean;
    promptOrCaseParameterHashPresent: boolean;
    notEvidenceFor: string[];
  };
  captureArtifacts: ModelVettingCaptureArtifacts;
  providerBoundary: ModelVettingProviderBoundary;
  falseGates: ModelVettingFalseGates;
  blockers: string[];
  nextEvidenceRequired: string[];
};

export type ModelVettingReport = {
  schemaVersion: "openclinxr.model-vetting-report.v1";
  generatedAt: string;
  claimScope: "isolated_model_vetting_metadata_structural_and_lab_contract_only";
  sourceReport: {
    kind: "anny_candidate_preflight";
    schemaVersion: string;
    generatedAt: string;
  };
  tracking: {
    canonicalPlanPath: "docs/openclinxr/asset-pipeline-vetting-and-cagematch-plan-2026-06-05.md";
    githubMirrorPolicy: "mirror_after_schema_stabilizes";
    githubProject: "simnova/OpenClinXR project 7 OpenClinXR-Planning";
  };
  providerBoundary: ModelVettingProviderBoundary;
  candidates: ModelVettingCandidate[];
  decision: {
    status: "blocked_before_scene" | "ready_for_scene_placement_evidence";
    isolatedLabCaptureComplete: boolean;
    scenePlacementEvidenceAllowed: boolean;
    runtimePromotionAllowed: false;
    productionManifestPromotionAllowed: false;
    nextSafeStep: string;
  };
  notEvidenceFor: [
    "b_plus_visual_realism_gate",
    "scene_placement_readiness",
    "quest_readiness",
    "production_asset_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
};

export type AnnyLikePreflightReport = {
  schemaVersion: string;
  generatedAt: string;
  candidates: AnnyLikeCandidate[];
};

export type AnnyLikeProvenance = {
  documentSha256: string;
  sourceOriginChainPresent: boolean;
  licenseChainPresent: boolean;
  derivativeLineagePresent: boolean;
  toolVersionPresent: boolean;
  promptOrCaseParameterHashPresent: boolean;
  notEvidenceFor: string[];
};

export type AnnyLikeCandidate = {
  candidateId: string;
  scenarioId: string;
  actorMapping: {
    actorId: string;
    actorRole: ModelVettingCandidate["actorRole"];
    actorDisplayRole: string;
    reuseKey: string;
  };
  paths: {
    sourceGlbPath: string;
    provenancePath: string;
  };
  source?: {
    sourceKind: ModelVettingCandidate["sourceKind"];
    usesRealAnnyForwardPass?: boolean;
  };
  provenance: AnnyLikeProvenance;
  glb: ModelVettingCandidate["structuralMetrics"] & {
    clinicalIdlePoseClipCount: number;
  };
  rigControlEvidence: Omit<ModelVettingCandidate["rigAndAnimation"], "clinicalIdlePoseClipCount"> & {
    canonicalSkeletonNodesPresent: boolean;
  };
  localCandidateBundle?: {
    roleMaterialHandoff?: ModelVettingRoleMaterialHandoff;
    roleAnimationHandoff?: ModelVettingRoleAnimationHandoff;
    proceduralFaceDetailHandoff?: ModelVettingProceduralFaceDetailHandoff;
  };
  status: string;
  blockers: string[];
  nextEvidenceRequired: string[];
  captureArtifacts?: ModelVettingCaptureArtifacts;
};

export function buildModelVettingReportFromAnnyPreflight(input: {
  generatedAt?: string;
  sourceReport: AnnyLikePreflightReport;
}): ModelVettingReport {
  const candidates = input.sourceReport.candidates.map(modelCandidateFromAnnyCandidate);
  const allReadyForScene = candidates.every((candidate) => candidate.gateResult === "ready_for_scene_placement_evidence");
  const isolatedLabCaptureComplete = candidates.every((candidate) => isolatedCaptureComplete(candidate.captureArtifacts));
  const scenePlacementEvidenceAllowed = allReadyForScene && isolatedLabCaptureComplete;
  return {
    schemaVersion: "openclinxr.model-vetting-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    claimScope: "isolated_model_vetting_metadata_structural_and_lab_contract_only",
    sourceReport: {
      kind: "anny_candidate_preflight",
      schemaVersion: input.sourceReport.schemaVersion,
      generatedAt: input.sourceReport.generatedAt,
    },
    tracking: {
      canonicalPlanPath: "docs/openclinxr/asset-pipeline-vetting-and-cagematch-plan-2026-06-05.md",
      githubMirrorPolicy: "mirror_after_schema_stabilizes",
      githubProject: "simnova/OpenClinXR project 7 OpenClinXR-Planning",
    },
    providerBoundary: localMetadataOnlyProviderBoundary(),
    candidates,
    decision: {
      status: scenePlacementEvidenceAllowed ? "ready_for_scene_placement_evidence" : "blocked_before_scene",
      isolatedLabCaptureComplete,
      scenePlacementEvidenceAllowed,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      nextSafeStep: scenePlacementEvidenceAllowed
        ? "Build the isolated model-vetting studio and capture deterministic lab screenshots/video before station scene placement."
        : !isolatedLabCaptureComplete
          ? "Capture fixed-camera screenshots plus turntable, viseme, and emotion-transition isolated lab videos before scene-placement evidence."
        : "Repair blocked isolated model lab modes before using these candidates in scene-placement evidence.",
    },
    notEvidenceFor: [
      "b_plus_visual_realism_gate",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

export function validateModelVettingReport(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value["schemaVersion"], "openclinxr.model-vetting-report.v1", "/schemaVersion", errors);
  requireLiteral(value["claimScope"], "isolated_model_vetting_metadata_structural_and_lab_contract_only", "/claimScope", errors);
  validateProviderBoundary(value["providerBoundary"], "/providerBoundary", errors);
  const candidates = value["candidates"];
  if (!Array.isArray(candidates) || candidates.length === 0) errors.push("/candidates must be nonempty array");
  if (Array.isArray(candidates)) {
    for (const [index, candidate] of candidates.entries()) validateCandidate(candidate, `/candidates/${index}`, errors);
  }
  const decision = value["decision"];
  requireRecord(decision, "/decision", errors);
  if (isRecord(decision)) {
    requireLiteral(decision["runtimePromotionAllowed"], false, "/decision/runtimePromotionAllowed", errors);
    requireLiteral(decision["productionManifestPromotionAllowed"], false, "/decision/productionManifestPromotionAllowed", errors);
    if (!["blocked_before_scene", "ready_for_scene_placement_evidence"].includes(String(decision["status"]))) {
      errors.push("/decision/status must be blocked_before_scene or ready_for_scene_placement_evidence");
    }
    if (typeof decision["scenePlacementEvidenceAllowed"] !== "boolean") {
      errors.push("/decision/scenePlacementEvidenceAllowed must be boolean");
    }
    if (typeof decision["isolatedLabCaptureComplete"] !== "boolean") {
      errors.push("/decision/isolatedLabCaptureComplete must be boolean");
    }
    if (decision["scenePlacementEvidenceAllowed"] === true && decision["isolatedLabCaptureComplete"] !== true) {
      errors.push("/decision/scenePlacementEvidenceAllowed requires isolatedLabCaptureComplete");
    }
    requireString(decision["nextSafeStep"], "/decision/nextSafeStep", errors);
  }
  requireStringArrayIncludes(value["notEvidenceFor"], "b_plus_visual_realism_gate", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "quest_readiness", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "clinical_validity", "/notEvidenceFor", errors);
  requireStringArrayIncludes(value["notEvidenceFor"], "scoring_validity", "/notEvidenceFor", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function modelCandidateFromAnnyCandidate(candidate: AnnyLikeCandidate): ModelVettingCandidate {
  const sourceKind = candidate.source?.sourceKind ?? "anny_compatible_stub_mesh";
  const usesRealAnnyForwardPass = candidate.source?.usesRealAnnyForwardPass === true;
  const captureArtifacts = candidate.captureArtifacts ?? { fixedCameraScreenshots: [] };
  const labModes = labModesForCandidate(candidate, captureArtifacts);
  const blockers = uniqueStrings([
    ...candidate.blockers,
    ...labModes.flatMap((mode) => mode.blockers),
  ]);
  const gateResult: ModelVettingGateResult = blockers.length === 0
    ? "ready_for_scene_placement_evidence"
    : "blocked_before_scene";
  return {
    candidateId: candidate.candidateId,
    scenarioId: candidate.scenarioId,
    actorId: candidate.actorMapping.actorId,
    actorRole: candidate.actorMapping.actorRole,
    actorDisplayRole: candidate.actorMapping.actorDisplayRole,
    reuseKey: candidate.actorMapping.reuseKey,
    sourceGlbPath: candidate.paths.sourceGlbPath,
    provenancePath: candidate.paths.provenancePath,
    sourcePreflightStatus: candidate.status,
    sourceKind,
    usesRealAnnyForwardPass,
    gateResult,
    labModes,
    structuralMetrics: {
      byteLength: candidate.glb.byteLength,
      sha256: candidate.glb.sha256,
      sceneCount: candidate.glb.sceneCount,
      nodeCount: candidate.glb.nodeCount,
      meshCount: candidate.glb.meshCount,
      materialCount: candidate.glb.materialCount,
      skinCount: candidate.glb.skinCount,
      animationCount: candidate.glb.animationCount,
      morphTargetPrimitiveCount: candidate.glb.morphTargetPrimitiveCount,
      vertexCount: candidate.glb.vertexCount,
    },
    rigAndAnimation: {
      canonicalSkeletonNodesPresent: candidate.rigControlEvidence.canonicalSkeletonNodesPresent,
      faceRigNodesPresent: candidate.rigControlEvidence.faceRigNodesPresent,
      gazeEyeNodesPresent: candidate.rigControlEvidence.gazeEyeNodesPresent,
      blinkControlPresent: candidate.rigControlEvidence.blinkControlPresent,
      requiredMorphTargetsPresent: candidate.rigControlEvidence.requiredMorphTargetsPresent,
      requiredMorphTargets: [...candidate.rigControlEvidence.requiredMorphTargets],
      missingMorphTargets: [...candidate.rigControlEvidence.missingMorphTargets],
      observedMorphTargets: [...candidate.rigControlEvidence.observedMorphTargets],
      locomotionPostureClipPresent: candidate.rigControlEvidence.locomotionPostureClipPresent,
      clinicalIdlePoseClipCount: candidate.glb.clinicalIdlePoseClipCount,
    },
    ...(candidate.localCandidateBundle?.roleMaterialHandoff ? { roleMaterialHandoff: candidate.localCandidateBundle.roleMaterialHandoff } : {}),
    ...(candidate.localCandidateBundle?.roleAnimationHandoff ? { roleAnimationHandoff: candidate.localCandidateBundle.roleAnimationHandoff } : {}),
    ...(candidate.localCandidateBundle?.proceduralFaceDetailHandoff ? { proceduralFaceDetailHandoff: candidate.localCandidateBundle.proceduralFaceDetailHandoff } : {}),
    provenance: {
      ...candidate.provenance,
      sourceReportCandidateId: candidate.candidateId,
      sourceGlbPath: candidate.paths.sourceGlbPath,
      provenancePath: candidate.paths.provenancePath,
      auditPointers: [
        candidate.paths.provenancePath,
        candidate.paths.sourceGlbPath,
      ],
      notEvidenceFor: [...candidate.provenance.notEvidenceFor],
    },
    captureArtifacts,
    providerBoundary: localMetadataOnlyProviderBoundary(),
    falseGates: falseGates(usesRealAnnyForwardPass),
    blockers,
    nextEvidenceRequired: uniqueStrings([
      ...candidate.nextEvidenceRequired,
      "fixed_camera_front_side_three_quarter_lab_screenshots",
      "deterministic_viseme_emotion_timeline_capture",
      "visual_realism_adversary_lab_review",
    ]),
  };
}

function labModesForCandidate(candidate: AnnyLikeCandidate, captureArtifacts: ModelVettingCaptureArtifacts): ModelVettingLabMode[] {
  const screenshotsPresent = captureArtifacts.fixedCameraScreenshots.length >= 3;
  const turntableVideoPresent = Boolean(captureArtifacts.turntableVideo);
  const morphVisemeCapturePresent = Boolean(captureArtifacts.morphVisemeTimelineCapture);
  const emotionCapturePresent = Boolean(captureArtifacts.emotionTransitionCapture);
  const morphVideoPaths = [captureArtifacts.morphVisemeTimelineCapture, captureArtifacts.emotionTransitionCapture].filter(Boolean) as string[];
  return [
    {
      modeId: "static_model_inspection",
      status: passIf(candidate.glb.sceneCount > 0 && candidate.glb.meshCount > 0 && candidate.glb.vertexCount > 0 && screenshotsPresent),
      evidence: [`glb_sha256:${candidate.glb.sha256}`, `vertices:${candidate.glb.vertexCount}`, `materials:${candidate.glb.materialCount}`],
      requiredArtifactKinds: ["json", "screenshot"],
      capturedArtifactPaths: [...captureArtifacts.fixedCameraScreenshots],
      blockers: blockersIf(!(candidate.glb.sceneCount > 0), "glb_scene_missing", !(candidate.glb.meshCount > 0), "glb_mesh_missing", !screenshotsPresent, "fixed_camera_screenshots_missing"),
    },
    {
      modeId: "rig_inspection",
      status: passIf(candidate.glb.skinCount > 0 && candidate.rigControlEvidence.canonicalSkeletonNodesPresent),
      evidence: [`skins:${candidate.glb.skinCount}`, `canonicalSkeletonNodesPresent:${candidate.rigControlEvidence.canonicalSkeletonNodesPresent}`],
      requiredArtifactKinds: ["json"],
      capturedArtifactPaths: [],
      blockers: blockersIf(!(candidate.glb.skinCount > 0), "skin_missing", !candidate.rigControlEvidence.canonicalSkeletonNodesPresent, "canonical_skeleton_nodes_missing"),
    },
    {
      modeId: "morph_phoneme_inspection",
      status: passIf(candidate.rigControlEvidence.requiredMorphTargetsPresent && candidate.rigControlEvidence.faceRigNodesPresent && morphVisemeCapturePresent && emotionCapturePresent),
      evidence: candidate.rigControlEvidence.observedMorphTargets.map((target) => `morph:${target}`),
      requiredArtifactKinds: ["json", "video"],
      capturedArtifactPaths: morphVideoPaths,
      blockers: [
        ...blockersIf(!candidate.rigControlEvidence.faceRigNodesPresent, "face_rig_control_nodes_missing"),
        ...candidate.rigControlEvidence.missingMorphTargets.map((target) => `missing_morph_target:${target}`),
        ...blockersIf(!morphVisemeCapturePresent, "morph_viseme_timeline_capture_missing", !emotionCapturePresent, "emotion_transition_capture_missing"),
      ],
    },
    {
      modeId: "animation_clip_inspection",
      status: passIf(candidate.glb.animationCount > 0 && candidate.glb.clinicalIdlePoseClipCount > 0 && candidate.rigControlEvidence.locomotionPostureClipPresent && turntableVideoPresent),
      evidence: [`animations:${candidate.glb.animationCount}`, `clinicalIdlePoseClipCount:${candidate.glb.clinicalIdlePoseClipCount}`],
      requiredArtifactKinds: ["json", "video"],
      capturedArtifactPaths: captureArtifacts.turntableVideo ? [captureArtifacts.turntableVideo] : [],
      blockers: blockersIf(
        !(candidate.glb.animationCount > 0),
        "animation_clips_missing",
        !(candidate.glb.clinicalIdlePoseClipCount > 0),
        "clinical_idle_or_conversation_clip_missing",
        !candidate.rigControlEvidence.locomotionPostureClipPresent,
        "locomotion_posture_clip_missing",
        !turntableVideoPresent,
        "turntable_animation_video_missing",
      ),
    },
    {
      modeId: "material_realism_inspection",
      status: passIf(candidate.glb.materialCount > 0 && candidate.provenance.sourceOriginChainPresent && candidate.provenance.licenseChainPresent && screenshotsPresent),
      evidence: [`materials:${candidate.glb.materialCount}`, `provenance:${candidate.provenance.documentSha256}`],
      requiredArtifactKinds: ["json", "screenshot"],
      capturedArtifactPaths: [...captureArtifacts.fixedCameraScreenshots],
      blockers: blockersIf(
        !(candidate.glb.materialCount > 0),
        "materials_missing",
        !candidate.provenance.sourceOriginChainPresent,
        "source_origin_chain_missing",
        !candidate.provenance.licenseChainPresent,
        "license_chain_missing",
        !screenshotsPresent,
        "material_fixed_camera_screenshots_missing",
      ),
    },
    {
      modeId: "optimization_inspection",
      status: passIf(candidate.glb.byteLength > 0 && candidate.glb.byteLength < 25_000_000 && candidate.glb.vertexCount < 150_000),
      evidence: [`bytes:${candidate.glb.byteLength}`, `vertices:${candidate.glb.vertexCount}`],
      requiredArtifactKinds: ["json"],
      capturedArtifactPaths: [],
      blockers: blockersIf(
        !(candidate.glb.byteLength > 0),
        "glb_empty",
        !(candidate.glb.byteLength < 25_000_000),
        "glb_byte_budget_exceeded_for_lab_gate",
        !(candidate.glb.vertexCount < 150_000),
        "vertex_budget_exceeded_for_lab_gate",
      ),
    },
  ];
}

function validateCandidate(value: unknown, path: string, errors: string[]): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;
  requireString(value["candidateId"], `${path}/candidateId`, errors);
  if (!["blocked_before_scene", "ready_for_scene_placement_evidence", "needs_provider_iteration", "archive_as_reference_only"].includes(String(value["gateResult"]))) {
    errors.push(`${path}/gateResult must be a known model-vetting gate result`);
  }
  if (!["anny_compatible_stub_mesh", "real_anny_candidate_unverified", "imported_humanoid_candidate"].includes(String(value["sourceKind"]))) {
    errors.push(`${path}/sourceKind must be a known source kind`);
  }
  if (typeof value["usesRealAnnyForwardPass"] !== "boolean") {
    errors.push(`${path}/usesRealAnnyForwardPass must be boolean`);
  }
  validateProviderBoundary(value["providerBoundary"], `${path}/providerBoundary`, errors);
  const falseGateValue = value["falseGates"];
  requireRecord(falseGateValue, `${path}/falseGates`, errors);
  if (isRecord(falseGateValue)) {
    if (typeof falseGateValue["realAnny"] !== "boolean") errors.push(`${path}/falseGates/realAnny must be boolean`);
    for (const gate of ["bPlusRealism", "scenePlacementReadiness", "questReadiness", "productionReadiness", "learnerReadiness", "clinicalValidity", "scoringValidity"]) {
      requireLiteral(falseGateValue[gate], false, `${path}/falseGates/${gate}`, errors);
    }
  }
  const labModes = value["labModes"];
  const requiredModeIds: ModelVettingLabModeId[] = [
    "static_model_inspection",
    "rig_inspection",
    "morph_phoneme_inspection",
    "animation_clip_inspection",
    "material_realism_inspection",
    "optimization_inspection",
  ];
  if (!Array.isArray(labModes) || labModes.length !== requiredModeIds.length) errors.push(`${path}/labModes must include exactly the six isolated lab modes`);
  if (Array.isArray(labModes)) {
    const modeIds = labModes.map((mode) => isRecord(mode) ? String(mode["modeId"]) : "");
    for (const modeId of requiredModeIds) {
      if (!modeIds.includes(modeId)) errors.push(`${path}/labModes must include ${modeId}`);
    }
    if (new Set(modeIds).size !== modeIds.length) errors.push(`${path}/labModes must not contain duplicate mode ids`);
    for (const [index, mode] of labModes.entries()) {
      if (!isRecord(mode)) {
        errors.push(`${path}/labModes/${index} must be object`);
        continue;
      }
      if (!["pass", "warn", "block"].includes(String(mode["status"]))) errors.push(`${path}/labModes/${index}/status must be pass, warn, or block`);
      if (!Array.isArray(mode["evidence"])) errors.push(`${path}/labModes/${index}/evidence must be array`);
      if (!Array.isArray(mode["requiredArtifactKinds"])) errors.push(`${path}/labModes/${index}/requiredArtifactKinds must be array`);
      if (!Array.isArray(mode["capturedArtifactPaths"])) errors.push(`${path}/labModes/${index}/capturedArtifactPaths must be array`);
      if (!Array.isArray(mode["blockers"])) errors.push(`${path}/labModes/${index}/blockers must be array`);
    }
  }
  const structuralMetrics = value["structuralMetrics"];
  requireRecord(structuralMetrics, `${path}/structuralMetrics`, errors);
  if (isRecord(structuralMetrics)) requireSha(structuralMetrics["sha256"], `${path}/structuralMetrics/sha256`, errors);
  const provenance = value["provenance"];
  requireRecord(provenance, `${path}/provenance`, errors);
  if (isRecord(provenance)) {
    requireSha(provenance["documentSha256"], `${path}/provenance/documentSha256`, errors);
    requireString(provenance["sourceReportCandidateId"], `${path}/provenance/sourceReportCandidateId`, errors);
    requireString(provenance["sourceGlbPath"], `${path}/provenance/sourceGlbPath`, errors);
    requireString(provenance["provenancePath"], `${path}/provenance/provenancePath`, errors);
    if (!Array.isArray(provenance["auditPointers"]) || provenance["auditPointers"].length === 0) errors.push(`${path}/provenance/auditPointers must be nonempty array`);
    requireStringArrayIncludes(provenance["notEvidenceFor"], "production_asset_readiness", `${path}/provenance/notEvidenceFor`, errors);
  }
  const roleMaterialHandoff = value["roleMaterialHandoff"];
  if (roleMaterialHandoff !== undefined) {
    requireRecord(roleMaterialHandoff, `${path}/roleMaterialHandoff`, errors);
    if (isRecord(roleMaterialHandoff)) {
      requireString(roleMaterialHandoff["roleVisualCue"], `${path}/roleMaterialHandoff/roleVisualCue`, errors);
      requireString(roleMaterialHandoff["wardrobeRole"], `${path}/roleMaterialHandoff/wardrobeRole`, errors);
      requireString(roleMaterialHandoff["clothingStyle"], `${path}/roleMaterialHandoff/clothingStyle`, errors);
      const objectNames = roleMaterialHandoff["objectNames"];
      const meshRegionMaterialMode = roleMaterialHandoff["meshRegionMaterialMode"];
      const hasObjectNames = Array.isArray(objectNames) && objectNames.length > 0;
      const hasMeshRegionMaterialMode = typeof meshRegionMaterialMode === "string" && meshRegionMaterialMode.length > 0;
      if (!hasObjectNames && !hasMeshRegionMaterialMode) {
        errors.push(`${path}/roleMaterialHandoff must include nonempty objectNames or meshRegionMaterialMode`);
      }
      requireStringArrayIncludes(roleMaterialHandoff["notEvidenceFor"], "production_asset_readiness", `${path}/roleMaterialHandoff/notEvidenceFor`, errors);
    }
  }
  const roleAnimationHandoff = value["roleAnimationHandoff"];
  if (roleAnimationHandoff !== undefined) {
    requireRecord(roleAnimationHandoff, `${path}/roleAnimationHandoff`, errors);
    if (isRecord(roleAnimationHandoff)) {
      if (!Array.isArray(roleAnimationHandoff["roleSpecificClipNames"]) || roleAnimationHandoff["roleSpecificClipNames"].length === 0) {
        errors.push(`${path}/roleAnimationHandoff/roleSpecificClipNames must be nonempty array`);
      }
      requireString(roleAnimationHandoff["claimScope"], `${path}/roleAnimationHandoff/claimScope`, errors);
      requireStringArrayIncludes(roleAnimationHandoff["notEvidenceFor"], "production_asset_readiness", `${path}/roleAnimationHandoff/notEvidenceFor`, errors);
    }
  }
  const proceduralFaceDetailHandoff = value["proceduralFaceDetailHandoff"];
  if (proceduralFaceDetailHandoff !== undefined) {
    requireRecord(proceduralFaceDetailHandoff, `${path}/proceduralFaceDetailHandoff`, errors);
    if (isRecord(proceduralFaceDetailHandoff)) {
      requireString(proceduralFaceDetailHandoff["hairPlacementMode"], `${path}/proceduralFaceDetailHandoff/hairPlacementMode`, errors);
      requireString(proceduralFaceDetailHandoff["eyePlacementMode"], `${path}/proceduralFaceDetailHandoff/eyePlacementMode`, errors);
      requireString(proceduralFaceDetailHandoff["featurePlacementMode"], `${path}/proceduralFaceDetailHandoff/featurePlacementMode`, errors);
      requireString(proceduralFaceDetailHandoff["hairObjectName"], `${path}/proceduralFaceDetailHandoff/hairObjectName`, errors);
      requireString(proceduralFaceDetailHandoff["coordinateBasis"], `${path}/proceduralFaceDetailHandoff/coordinateBasis`, errors);
      if (!Array.isArray(proceduralFaceDetailHandoff["eyeObjectNames"]) || proceduralFaceDetailHandoff["eyeObjectNames"].length === 0) {
        errors.push(`${path}/proceduralFaceDetailHandoff/eyeObjectNames must be nonempty array`);
      }
      if (!Array.isArray(proceduralFaceDetailHandoff["facialFeatureObjectNames"])) {
        errors.push(`${path}/proceduralFaceDetailHandoff/facialFeatureObjectNames must be array`);
      }
      requireString(proceduralFaceDetailHandoff["claimScope"], `${path}/proceduralFaceDetailHandoff/claimScope`, errors);
      requireStringArrayIncludes(proceduralFaceDetailHandoff["notEvidenceFor"], "production_asset_readiness", `${path}/proceduralFaceDetailHandoff/notEvidenceFor`, errors);
      requireStringArrayIncludes(proceduralFaceDetailHandoff["notEvidenceFor"], "b_plus_visual_realism_gate", `${path}/proceduralFaceDetailHandoff/notEvidenceFor`, errors);
    }
  }
  const captureArtifacts = value["captureArtifacts"];
  requireRecord(captureArtifacts, `${path}/captureArtifacts`, errors);
  if (isRecord(captureArtifacts) && !Array.isArray(captureArtifacts["fixedCameraScreenshots"])) errors.push(`${path}/captureArtifacts/fixedCameraScreenshots must be array`);
}

function validateProviderBoundary(value: unknown, path: string, errors: string[]): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;
  requireLiteral(value["providerId"], "anny_local_or_anny_compatible_import", `${path}/providerId`, errors);
  requireLiteral(value["policyMode"], "local_metadata_only", `${path}/policyMode`, errors);
  requireLiteral(value["approvalStatus"], "not_required_for_metadata_only", `${path}/approvalStatus`, errors);
  requireLiteral(value["localOnly"], true, `${path}/localOnly`, errors);
  requireLiteral(value["providerExecutionEnabled"], false, `${path}/providerExecutionEnabled`, errors);
  requireLiteral(value["externalNetworkUsed"], false, `${path}/externalNetworkUsed`, errors);
  requireLiteral(value["paidApiUsed"], false, `${path}/paidApiUsed`, errors);
  requireLiteral(value["credentialsRequired"], false, `${path}/credentialsRequired`, errors);
  if (!Array.isArray(value["blockedProviderExecutionReasons"]) || value["blockedProviderExecutionReasons"].length === 0) {
    errors.push(`${path}/blockedProviderExecutionReasons must be nonempty array`);
  }
}

function localMetadataOnlyProviderBoundary(): ModelVettingProviderBoundary {
  return {
    providerId: "anny_local_or_anny_compatible_import",
    policyMode: "local_metadata_only",
    approvalStatus: "not_required_for_metadata_only",
    localOnly: true,
    providerExecutionEnabled: false,
    externalNetworkUsed: false,
    paidApiUsed: false,
    credentialsRequired: false,
    blockedProviderExecutionReasons: [
      "provider_execution_not_requested_for_this_metadata_only_slice",
      "no_paid_api_credentials_or_network_execution_allowed",
    ],
  };
}

function falseGates(usesRealAnnyForwardPass = false): ModelVettingFalseGates {
  return {
    realAnny: usesRealAnnyForwardPass,
    bPlusRealism: false,
    scenePlacementReadiness: false,
    questReadiness: false,
    productionReadiness: false,
    learnerReadiness: false,
    clinicalValidity: false,
    scoringValidity: false,
  };
}

function passIf(condition: boolean): "pass" | "block" {
  return condition ? "pass" : "block";
}

function blockersIf(...pairs: Array<boolean | string>): string[] {
  const blockers: string[] = [];
  for (let index = 0; index < pairs.length; index += 2) {
    if (pairs[index] === true) blockers.push(String(pairs[index + 1]));
  }
  return blockers;
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${path} must be object`);
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${path} must be nonempty string`);
}

function requireSha(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) errors.push(`${path} must be sha256 hex`);
}

function requireLiteral<T extends boolean | string>(value: unknown, expected: T, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${String(expected)}`);
}

function requireStringArrayIncludes(value: unknown, expected: string, path: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string") || !value.includes(expected)) {
    errors.push(`${path} must include ${expected}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function isolatedCaptureComplete(captureArtifacts: ModelVettingCaptureArtifacts): boolean {
  return captureArtifacts.fixedCameraScreenshots.length >= 3
    && Boolean(captureArtifacts.turntableVideo)
    && Boolean(captureArtifacts.morphVisemeTimelineCapture)
    && Boolean(captureArtifacts.emotionTransitionCapture);
}

export type {
  CagematchDecisionBranch,
  CagematchFeasibilityCriterion,
  CagematchProcessExplanation,
  CagematchReportMedia,
  CagematchReportPage,
  CagematchReportRegistry,
  CagematchTechnologyId,
} from "./cagematch-report.js";
export { validateCagematchReportPage, validateCagematchReportRegistry } from "./cagematch-report.js";
export {
  PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE,
  applyMorphTargetVisemeCue,
  buildVisemeTimelineFromDialogue,
  humanoidDialogueDurationMs,
  phonemeSequenceForDialogue,
  visemeAtTimelineProgress,
  visemeForPhoneme,
  visemeOpenness,
} from "./viseme-timeline.js";
export type { MorphTargetVisemeCueEvidence, VisemeTimeline, VisemeTimelineMappingMode } from "./viseme-timeline.js";
export {
  applyMorphTargetEmotionCue,
  buildPedsAsthmaPatientEmotionTransitionTimeline,
  emotionWeightsAtTimelineProgress,
  expressionWeightsForEmotion,
} from "./emotion-transition.js";
export type {
  EmotionTransitionMappingMode,
  EmotionTransitionTimeline,
  HumanoidExpressionEmotion,
  HumanoidExpressionWeights,
  MorphTargetEmotionCueEvidence,
} from "./emotion-transition.js";
