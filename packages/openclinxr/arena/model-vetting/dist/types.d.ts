export type ModelVettingGateResult = "blocked_before_scene" | "ready_for_scene_placement_evidence" | "needs_provider_iteration" | "archive_as_reference_only";
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
export type ModelVettingLabModeId = "static_model_inspection" | "rig_inspection" | "morph_phoneme_inspection" | "animation_clip_inspection" | "material_realism_inspection" | "optimization_inspection";
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
        "scoring_validity"
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
//# sourceMappingURL=types.d.ts.map