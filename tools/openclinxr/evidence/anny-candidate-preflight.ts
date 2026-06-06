import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { globFiles, readJson } from "../../agent-factory/lib.js";

const defaultOutputPath = `docs/openclinxr/anny-candidate-preflight-peds-asthma-parent-anxiety-${new Date().toISOString().slice(0, 10)}.json`;

type CandidateStatus = "blocked" | "reviewable_metadata_only" | "ready_for_local_import_trial" | "ready_for_webxr_visual_evidence";

function createGlbReader(): NodeIO {
  return new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
}

type AnnyCandidateSpec = {
  candidateId: string;
  scenarioId: string;
  actorId: string;
  actorRole: "patient" | "family" | "nurse" | "consultant" | "interpreter";
  actorDisplayRole: string;
  sourceGlbPath: string;
  provenancePath: string;
  reuseKey: string;
  expectedGeneratorMode: string;
  localCandidateBundle?: LocalCandidateBundleBinding;
};

type GlbStructuralMetrics = {
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
  clinicalIdlePoseClipCount: number;
};

type RigControlEvidence = {
  canonicalSkeletonNodesPresent: boolean;
  faceRigNodesPresent: boolean;
  gazeEyeNodesPresent: boolean;
  blinkControlPresent: boolean;
  locomotionPostureClipPresent: boolean;
  requiredMorphTargetsPresent: boolean;
  requiredMorphTargets: string[];
  missingMorphTargets: string[];
  observedMorphTargets: string[];
  observedControlNodes: string[];
};

type RawHumanoidProvenance = {
  schemaVersion?: unknown;
  scenarioId?: unknown;
  actorRole?: unknown;
  assetPath?: unknown;
  generatorMode?: unknown;
  usesRealAnnyForwardPass?: unknown;
  realAnnyWeightsUsed?: unknown;
  textureMode?: unknown;
  animationMode?: unknown;
  realismGrade?: unknown;
  promotionStatus?: unknown;
  notEvidenceFor?: unknown;
  sourceOriginChain?: unknown;
  licenseChain?: unknown;
  derivativeLineage?: unknown;
  toolVersion?: unknown;
  promptOrCaseParameterHash?: unknown;
};

type RawLocalCandidateBundle = {
  schemaVersion?: unknown;
  claimScope?: unknown;
  scenarioId?: unknown;
  actorId?: unknown;
  actorRole?: unknown;
  outputs?: unknown;
  generation?: unknown;
  providerExecution?: unknown;
  gates?: unknown;
  notEvidenceFor?: unknown;
};

type LocalCandidateBundleBinding = {
  bundlePath: string;
  raw: RawLocalCandidateBundle;
  sourceGlbPath: string;
  provenancePath: string;
  sourceManifestPath: string;
  riggingReportPath: string;
  objPath: string;
};

type LocalCandidateBundleEvidence = {
  schemaVersion: string;
  claimScope: string;
  bundlePath: string;
  actorRole: string;
  outputPaths: {
    objPath: string;
    sourceManifestPath: string;
    glbPath: string;
    riggingReportPath: string;
    provenancePath: string;
  };
  generation: {
    generatorMode: string;
    usesRealAnnyForwardPass: boolean;
    realAnnyWeightsUsed: boolean;
    useComfy: false;
    seed: number | null;
    paramsHash: string;
  };
  providerExecution: {
    cloudProviderUsed: false;
    paidApiUsed: false;
    modelDownloadUsed: false;
    comfyUsed: false;
  };
  gates: {
    realAnnyModelOutput: boolean;
    bPlusVisualRealismGate: false;
    scenePlacementReadiness: false;
    questReadiness: false;
    productionReadiness: false;
    learnerReadiness: false;
    clinicalValidity: false;
    scoringValidity: false;
  };
  outputEvidence: {
    allOutputsPresent: boolean;
    objSha256: string;
    sourceManifestSha256: string;
    glbSha256: string;
    riggingReportSha256: string;
    provenanceSha256: string;
  };
  roleMaterialHandoff?: RoleMaterialHandoff;
  roleAnimationHandoff?: RoleAnimationHandoff;
  proceduralFaceDetailHandoff?: ProceduralFaceDetailHandoff;
  morphTargetDiagnostics?: MorphTargetDiagnostics;
  notEvidenceFor: string[];
};

type RoleMaterialHandoff = {
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

type RoleAnimationHandoff = {
  actorRole: string;
  roleSpecificClipNames: string[];
  claimScope: string;
  notEvidenceFor: string[];
};

type ProceduralFaceDetailHandoff = {
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

type MorphTargetDiagnostics = {
  defaultWeightThreshold: number;
  extremeDeltaThreshold: number;
  nonzeroDefaultWeights: Array<{
    name: string;
    defaultValue: number;
  }>;
  extremeMorphDeltas: Array<{
    name: string;
    maxDelta: number;
    maxAxisDelta: number;
  }>;
  claimScope: string;
  notEvidenceFor: string[];
};

type CandidatePreflight = {
  candidateId: string;
  scenarioId: string;
  actorMapping: {
    actorId: string;
    actorRole: AnnyCandidateSpec["actorRole"];
    actorDisplayRole: string;
    reuseKey: string;
    mappingAuthority: "case_definition_actor_mapping";
  };
  source: {
    sourceKind: "anny_compatible_stub_mesh" | "real_anny_candidate_unverified" | "imported_humanoid_candidate";
    generatorMode: string;
    usesRealAnnyForwardPass: boolean;
    realAnnyWeightsUsed: boolean;
    localOnly: true;
    executionEnabled: false;
    externalNetworkUsed: false;
    paidApiUsed: false;
  };
  paths: {
    sourceGlbPath: string;
    provenancePath: string;
    localCandidateBundlePath?: string;
  };
  localCandidateBundle?: LocalCandidateBundleEvidence;
  provenance: {
    schemaVersion: string;
    assetPath: string;
    textureMode: string;
    animationMode: string;
    realismGrade: string;
    promotionStatus: string;
    notEvidenceFor: string[];
    documentSha256: string;
    sourceOriginChainPresent: boolean;
    licenseChainPresent: boolean;
    derivativeLineagePresent: boolean;
    toolVersionPresent: boolean;
    promptOrCaseParameterHashPresent: boolean;
  };
  roleNormalization: {
    sourceActorRole: string;
    normalizedActorRole: AnnyCandidateSpec["actorRole"];
    aliasPolicy: "case_definition_role_alias_map";
    aliasAccepted: boolean;
    mappingNote: string;
  };
  glb: GlbStructuralMetrics;
  rigEvidence: {
    skinPresent: boolean;
    animationPresent: boolean;
    morphTargetsPresent: boolean;
    clinicalIdlePosePresent: boolean;
  };
  rigControlEvidence: RigControlEvidence;
  status: CandidateStatus;
  blockers: string[];
  nextEvidenceRequired: string[];
  quarantine: {
    failedCandidatesRemainReviewOnly: true;
    runtimeBundlePromotionAllowed: false;
    productionManifestPromotionAllowed: false;
  };
};

export type AnnyCandidatePreflightReport = {
  schemaVersion: "openclinxr.anny-candidate-preflight.v1";
  generatedAt: string;
  claimScope: "anny_candidate_preflight_metadata_and_structural_only";
  providerBoundary: {
    providerId: "anny_local_or_anny_compatible_import";
    policyMode: "local_metadata_and_structural_inspection_only";
    executionEnabled: false;
    localOnly: true;
    externalProviderExecutionAttempted: false;
    externalNetworkUsed: false;
    paidApiUsed: false;
    credentialsRequired: false;
  };
  advisoryReview: {
    moonbridgeDeepSeekFirstPass: "useful_policy_contract_reviewer";
    grade: "B";
    score: 0.8;
    nonAuthoritativeFor: ["runtime_visual_quality", "clinical_validity", "scoring_validity", "quest_readiness", "production_readiness"];
  };
  candidates: CandidatePreflight[];
  decision: {
    status: "blocked_until_candidate_evidence_clears" | "metadata_review_ready";
    currentFallbacksRemainActive: true;
    runtimePromotionAllowed: false;
    nextSafeStep: string;
  };
  notEvidenceFor: [
    "b_plus_visual_realism_gate",
    "provider_runtime_readiness",
    "generated_asset_quality",
    "production_asset_readiness",
    "quest_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
};

type CliOptions = {
  outputPath?: string;
  validateLatest: boolean;
  validatePath?: string;
  candidateBundleDir?: string;
  candidateBundlePaths: string[];
};

const defaultCandidates: AnnyCandidateSpec[] = [
  {
    candidateId: "peds_patient_child_anny_compatible_candidate",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    actorId: "patient_maya_johnson_v1",
    actorRole: "patient",
    actorDisplayRole: "school-age pediatric asthma patient",
    sourceGlbPath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.provenance.json",
    reuseKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_candidate",
    expectedGeneratorMode: "real_anny_local_forward_pass_plus_blender_procedural",
  },
  {
    candidateId: "peds_anxious_parent_anny_compatible_candidate",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    actorId: "parent_tara_johnson_v1",
    actorRole: "family",
    actorDisplayRole: "anxious parent",
    sourceGlbPath: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.provenance.json",
    reuseKey: "peds_asthma_parent_anxiety_v1:parent_tara_johnson_v1:family:anny_candidate",
    expectedGeneratorMode: "real_anny_local_forward_pass_plus_blender_procedural",
  },
  {
    candidateId: "peds_nurse_kevin_anny_compatible_candidate",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    actorId: "nurse_kevin_lee_v1",
    actorRole: "nurse",
    actorDisplayRole: "pediatric clinic nurse",
    sourceGlbPath: "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.provenance.json",
    reuseKey: "peds_asthma_parent_anxiety_v1:nurse_kevin_lee_v1:nurse:anny_candidate",
    expectedGeneratorMode: "real_anny_local_forward_pass_plus_blender_procedural",
  },
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/anny-candidate-preflight-*.json");
    if (!validatePath) throw new Error("Missing Anny candidate preflight report to validate.");
    const validation = validateAnnyCandidatePreflightReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const report = await buildAnnyCandidatePreflightReport({
    localCandidateBundlePaths: await collectCandidateBundlePaths(options),
  });
  const outputPath = options.outputPath ?? defaultOutputPath;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

export async function buildAnnyCandidatePreflightReport(input: {
  generatedAt?: string;
  candidates?: AnnyCandidateSpec[];
  localCandidateBundlePaths?: string[];
} = {}): Promise<AnnyCandidatePreflightReport> {
  const bundleMap = await loadLocalCandidateBundleMap(input.localCandidateBundlePaths ?? []);
  const candidateSpecs = (input.candidates ?? defaultCandidates).map((spec) => applyLocalCandidateBundle(spec, bundleMap.get(spec.actorId)));
  const candidates = await Promise.all(candidateSpecs.map(evaluateCandidate));
  const hardBlocked = candidates.some((candidate) => candidate.status === "blocked");
  return {
    schemaVersion: "openclinxr.anny-candidate-preflight.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    claimScope: "anny_candidate_preflight_metadata_and_structural_only",
    providerBoundary: {
      providerId: "anny_local_or_anny_compatible_import",
      policyMode: "local_metadata_and_structural_inspection_only",
      executionEnabled: false,
      localOnly: true,
      externalProviderExecutionAttempted: false,
      externalNetworkUsed: false,
      paidApiUsed: false,
      credentialsRequired: false,
    },
    advisoryReview: {
      moonbridgeDeepSeekFirstPass: "useful_policy_contract_reviewer",
      grade: "B",
      score: 0.8,
      nonAuthoritativeFor: ["runtime_visual_quality", "clinical_validity", "scoring_validity", "quest_readiness", "production_readiness"],
    },
    candidates,
    decision: {
      status: hardBlocked ? "blocked_until_candidate_evidence_clears" : "metadata_review_ready",
      currentFallbacksRemainActive: true,
      runtimePromotionAllowed: false,
      nextSafeStep: hardBlocked
        ? "Repair blocked candidate provenance, actor mapping, or GLB structure before any Anny local import trial."
        : "Use these candidates as review-only Anny-compatible baselines, then add a local real-Anny/import candidate directory preflight before any runtime replacement.",
    },
    notEvidenceFor: [
      "b_plus_visual_realism_gate",
      "provider_runtime_readiness",
      "generated_asset_quality",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

async function evaluateCandidate(spec: AnnyCandidateSpec): Promise<CandidatePreflight> {
  const provenance = await readJson<RawHumanoidProvenance>(spec.provenancePath);
  const provenanceBytes = await readFile(spec.provenancePath);
  let sourceBytes: Buffer;
  try {
    sourceBytes = await readFile(spec.sourceGlbPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return buildMissingGeneratedAssetCandidate(spec, provenance, provenanceBytes);
    }
    throw error;
  }
  await MeshoptDecoder.ready;
  const document = await createGlbReader().read(spec.sourceGlbPath);
  const root = document.getRoot();
  const meshes = root.listMeshes();
  const primitives = meshes.flatMap((mesh) => mesh.listPrimitives());
  const animations = root.listAnimations();
  const nodeNames = root.listNodes().map((node) => node.getName()).filter((name): name is string => name.length > 0);
  const animationNames = animations.map((animation) => animation.getName()).filter((name): name is string => name.length > 0);
  const morphTargetPrimitiveCount = primitives.filter((primitive) => primitive.listTargets().length > 0).length;
  const vertexCount = primitives.reduce((count, primitive) => count + (primitive.getAttribute("POSITION")?.getCount() ?? 0), 0);
  const clinicalIdlePoseClipCount = animations.filter((animation) => /clinical|idle|relaxed|conversation|consult/i.test(animation.getName())).length;
  const notEvidenceFor = stringArray(provenance.notEvidenceFor);
  const sourceActorRole = String(provenance.actorRole ?? "");
  const roleNormalization = normalizeActorRole(sourceActorRole, spec.actorRole);
  const requiredMorphTargets = ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"];
  const observedMorphTargets = readGlbMorphTargetNames(sourceBytes);
  const missingMorphTargets = requiredMorphTargets.filter((target) => !observedMorphTargets.includes(target));
  const rigControlEvidence: RigControlEvidence = {
    canonicalSkeletonNodesPresent: ["head", "neck", "pelvis", "spine"].every((nodeName) => nodeNames.includes(nodeName)),
    faceRigNodesPresent: nodeNames.some((name) => /face|jaw|mouth|brow|cheek/i.test(name)),
    gazeEyeNodesPresent: nodeNames.some((name) => /eye|gaze/i.test(name)),
    blinkControlPresent: nodeNames.some((name) => /blink|eyelid/i.test(name)) || observedMorphTargets.some((name) => /blink|eyelid/i.test(name)),
    locomotionPostureClipPresent: animationNames.some((name) => /locomotion|walk|stand|sit|posture|idle|clinical|conversation/i.test(name)),
    requiredMorphTargetsPresent: missingMorphTargets.length === 0,
    requiredMorphTargets,
    missingMorphTargets,
    observedMorphTargets,
    observedControlNodes: nodeNames.filter((name) => /head|neck|pelvis|spine|eye|blink|eyelid|jaw|mouth|brow|cheek/i.test(name)).sort(),
  };
  const localCandidateBundle = spec.localCandidateBundle
    ? await evaluateLocalCandidateBundle(spec.localCandidateBundle, sourceBytes, provenanceBytes)
    : undefined;
  const bundleRoleNormalization = spec.localCandidateBundle
    ? normalizeActorRole(String(spec.localCandidateBundle.raw.actorRole ?? ""), spec.actorRole)
    : undefined;
  const blockers = uniqueStrings([
    ...(provenance.schemaVersion === "openclinxr.generated-humanoid-provenance.v1" ? [] : ["provenance_schema_invalid"]),
    ...(provenance.scenarioId === spec.scenarioId ? [] : ["provenance_scenario_mismatch"]),
    ...(typeof provenance.actorRole === "string" && provenance.actorRole.length > 0 ? [] : ["provenance_actor_role_missing"]),
    ...(roleNormalization.aliasAccepted ? [] : ["actor_role_alias_unmapped"]),
    ...(provenance.generatorMode === spec.expectedGeneratorMode ? [] : ["unexpected_generator_mode"]),
    ...(typeof provenance.realAnnyWeightsUsed === "boolean" ? [] : ["real_anny_weights_flag_missing"]),
    ...(hasRecordOrString(provenance.sourceOriginChain) ? [] : ["source_origin_chain_missing"]),
    ...(hasRecordOrString(provenance.licenseChain) ? [] : ["license_chain_missing"]),
    ...(hasRecordOrString(provenance.derivativeLineage) ? [] : ["derivative_lineage_missing"]),
    ...(typeof provenance.toolVersion === "string" && provenance.toolVersion.length > 0 ? [] : ["tool_version_missing"]),
    ...(typeof provenance.promptOrCaseParameterHash === "string" && /^[a-f0-9]{32,64}$/u.test(provenance.promptOrCaseParameterHash) ? [] : ["prompt_or_case_parameter_hash_missing"]),
    ...(provenance.usesRealAnnyForwardPass === true || notEvidenceFor.includes("real_anny_model_output") ? [] : ["real_anny_false_gate_missing"]),
    ...(notEvidenceFor.includes("b_plus_visual_realism_gate") ? [] : ["b_plus_false_gate_missing"]),
    ...(notEvidenceFor.includes("production_asset_readiness") ? [] : ["production_false_gate_missing"]),
    ...(notEvidenceFor.includes("quest_readiness") ? [] : ["quest_false_gate_missing"]),
    ...(root.listScenes().length > 0 ? [] : ["glb_scene_missing"]),
    ...(meshes.length > 0 ? [] : ["glb_mesh_missing"]),
    ...(root.listSkins().length > 0 ? [] : ["skin_missing"]),
    ...(animations.length > 0 ? [] : ["animation_clips_missing"]),
    ...(morphTargetPrimitiveCount > 0 ? [] : ["facial_morph_targets_missing"]),
    ...(clinicalIdlePoseClipCount > 0 ? [] : ["clinical_idle_or_conversation_clip_missing"]),
    ...(rigControlEvidence.faceRigNodesPresent ? [] : ["face_rig_control_nodes_missing"]),
    ...(rigControlEvidence.gazeEyeNodesPresent ? [] : ["gaze_eye_nodes_missing"]),
    ...(rigControlEvidence.blinkControlPresent ? [] : ["blink_control_nodes_missing"]),
    ...(rigControlEvidence.requiredMorphTargetsPresent ? [] : ["required_expression_morph_targets_missing"]),
    ...(rigControlEvidence.locomotionPostureClipPresent ? [] : ["locomotion_posture_clip_missing"]),
    ...(localCandidateBundle && bundleRoleNormalization?.aliasAccepted === false ? ["local_candidate_bundle_actor_role_unmapped"] : []),
    ...(localCandidateBundle && localCandidateBundle.outputEvidence.allOutputsPresent ? [] : localCandidateBundle ? ["local_candidate_bundle_outputs_missing"] : []),
    ...(localCandidateBundle && typeof localCandidateBundle.generation.usesRealAnnyForwardPass === "boolean" ? [] : localCandidateBundle ? ["local_candidate_bundle_real_anny_generation_flag_missing"] : []),
    ...(localCandidateBundle && localCandidateBundle.providerExecution.cloudProviderUsed === false ? [] : localCandidateBundle ? ["local_candidate_bundle_cloud_gate_missing"] : []),
    ...(localCandidateBundle && localCandidateBundle.providerExecution.paidApiUsed === false ? [] : localCandidateBundle ? ["local_candidate_bundle_paid_api_gate_missing"] : []),
    ...(localCandidateBundle && localCandidateBundle.gates.bPlusVisualRealismGate === false ? [] : localCandidateBundle ? ["local_candidate_bundle_b_plus_gate_missing"] : []),
    ...(localCandidateBundle && localCandidateBundle.gates.questReadiness === false ? [] : localCandidateBundle ? ["local_candidate_bundle_quest_gate_missing"] : []),
    ...(localCandidateBundle && localCandidateBundle.gates.productionReadiness === false ? [] : localCandidateBundle ? ["local_candidate_bundle_production_gate_missing"] : []),
    ...morphTargetDiagnosticsBlockers(localCandidateBundle?.morphTargetDiagnostics),
  ]);
  const structuralBlockers = new Set([
    "glb_scene_missing",
    "glb_mesh_missing",
    "skin_missing",
    "animation_clips_missing",
    "facial_morph_targets_missing",
    "face_rig_control_nodes_missing",
    "gaze_eye_nodes_missing",
    "blink_control_nodes_missing",
    "required_expression_morph_targets_missing",
    "locomotion_posture_clip_missing",
  ]);
  const hardBlocked = blockers.some((blocker) =>
    structuralBlockers.has(blocker)
    || blocker.startsWith("provenance_")
    || blocker.endsWith("_false_gate_missing")
    || blocker === "unexpected_generator_mode"
    || blocker.startsWith("local_candidate_bundle_")
  );
  const status: CandidateStatus = hardBlocked
    ? "blocked"
    : clinicalIdlePoseClipCount === 0
      ? "reviewable_metadata_only"
      : "ready_for_webxr_visual_evidence";

  return {
    candidateId: spec.candidateId,
    scenarioId: spec.scenarioId,
    actorMapping: {
      actorId: spec.actorId,
      actorRole: spec.actorRole,
      actorDisplayRole: spec.actorDisplayRole,
      reuseKey: spec.reuseKey,
      mappingAuthority: "case_definition_actor_mapping",
    },
    source: {
      sourceKind: provenance.usesRealAnnyForwardPass === true ? "real_anny_candidate_unverified" : "anny_compatible_stub_mesh",
      generatorMode: String(provenance.generatorMode ?? "unknown"),
      usesRealAnnyForwardPass: provenance.usesRealAnnyForwardPass === true,
      realAnnyWeightsUsed: provenance.realAnnyWeightsUsed === true,
      localOnly: true,
      executionEnabled: false,
      externalNetworkUsed: false,
      paidApiUsed: false,
    },
    paths: {
      sourceGlbPath: spec.sourceGlbPath,
      provenancePath: spec.provenancePath,
      ...(spec.localCandidateBundle ? { localCandidateBundlePath: spec.localCandidateBundle.bundlePath } : {}),
    },
    ...(localCandidateBundle ? { localCandidateBundle } : {}),
    provenance: {
      schemaVersion: String(provenance.schemaVersion ?? "unknown"),
      assetPath: String(provenance.assetPath ?? ""),
      textureMode: String(provenance.textureMode ?? "unknown"),
      animationMode: String(provenance.animationMode ?? "unknown"),
      realismGrade: String(provenance.realismGrade ?? "unknown"),
      promotionStatus: String(provenance.promotionStatus ?? "unknown"),
      notEvidenceFor,
      documentSha256: createHash("sha256").update(provenanceBytes).digest("hex"),
      sourceOriginChainPresent: hasRecordOrString(provenance.sourceOriginChain),
      licenseChainPresent: hasRecordOrString(provenance.licenseChain),
      derivativeLineagePresent: hasRecordOrString(provenance.derivativeLineage),
      toolVersionPresent: typeof provenance.toolVersion === "string" && provenance.toolVersion.length > 0,
      promptOrCaseParameterHashPresent: typeof provenance.promptOrCaseParameterHash === "string" && /^[a-f0-9]{32,64}$/u.test(provenance.promptOrCaseParameterHash),
    },
    roleNormalization: {
      sourceActorRole,
      normalizedActorRole: spec.actorRole,
      aliasPolicy: "case_definition_role_alias_map",
      aliasAccepted: roleNormalization.aliasAccepted,
      mappingNote: roleNormalization.mappingNote,
    },
    glb: {
      byteLength: sourceBytes.byteLength,
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      sceneCount: root.listScenes().length,
      nodeCount: root.listNodes().length,
      meshCount: meshes.length,
      materialCount: root.listMaterials().length,
      skinCount: root.listSkins().length,
      animationCount: animations.length,
      morphTargetPrimitiveCount,
      vertexCount,
      clinicalIdlePoseClipCount,
    },
    rigEvidence: {
      skinPresent: root.listSkins().length > 0,
      animationPresent: animations.length > 0,
      morphTargetsPresent: morphTargetPrimitiveCount > 0,
      clinicalIdlePosePresent: clinicalIdlePoseClipCount > 0,
    },
    rigControlEvidence,
    status,
    blockers,
    nextEvidenceRequired: uniqueStrings([
      localCandidateBundle?.generation.usesRealAnnyForwardPass
        ? "isolated_model_vetting_video_and_visual_realism_review_for_real_anny_candidate"
        : localCandidateBundle
          ? "local_candidate_bundle_is_consumed_by_preflight_but_still_requires_real_anny_forward_pass_manifest_or_keep_stub_label"
          : "real_anny_forward_pass_manifest_or_keep_stub_label",
      "license_provenance_chain_review_with_source_origin_derivative_lineage_and_document_hash",
      "canonical_rig_expression_gaze_blink_and_locomotion_clip_evidence",
      "webxr_only_actor_closeup_screenshot",
      "visual_realism_adversarial_review",
      "quest_budget_evidence_before_quest_claims",
      ...(status === "blocked" ? ["resolve_structural_or_provenance_blockers"] : []),
    ]),
    quarantine: {
      failedCandidatesRemainReviewOnly: true,
      runtimeBundlePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
    },
  };
}

function morphTargetDiagnosticsBlockers(diagnostics: MorphTargetDiagnostics | undefined): string[] {
  if (!diagnostics) return [];
  return uniqueStrings([
    ...diagnostics.nonzeroDefaultWeights.map((entry) => `default_morph_weight_detected:${entry.name}:${entry.defaultValue}`),
    ...diagnostics.extremeMorphDeltas.map((entry) => `extreme_morph_delta_detected:${entry.name}:${entry.maxDelta}`),
  ]);
}

function buildMissingGeneratedAssetCandidate(
  spec: AnnyCandidateSpec,
  provenance: RawHumanoidProvenance,
  provenanceBytes: Buffer,
): CandidatePreflight {
  const notEvidenceFor = stringArray(provenance.notEvidenceFor);
  const sourceActorRole = String(provenance.actorRole ?? "");
  const roleNormalization = normalizeActorRole(sourceActorRole, spec.actorRole);
  const requiredMorphTargets = ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"];
  return {
    candidateId: spec.candidateId,
    scenarioId: spec.scenarioId,
    actorMapping: {
      actorId: spec.actorId,
      actorRole: spec.actorRole,
      actorDisplayRole: spec.actorDisplayRole,
      reuseKey: spec.reuseKey,
      mappingAuthority: "case_definition_actor_mapping",
    },
    source: {
      sourceKind: provenance.usesRealAnnyForwardPass === true ? "real_anny_candidate_unverified" : "anny_compatible_stub_mesh",
      generatorMode: String(provenance.generatorMode ?? "unknown"),
      usesRealAnnyForwardPass: provenance.usesRealAnnyForwardPass === true,
      realAnnyWeightsUsed: provenance.realAnnyWeightsUsed === true,
      localOnly: true,
      executionEnabled: false,
      externalNetworkUsed: false,
      paidApiUsed: false,
    },
    paths: {
      sourceGlbPath: spec.sourceGlbPath,
      provenancePath: spec.provenancePath,
      ...(spec.localCandidateBundle ? { localCandidateBundlePath: spec.localCandidateBundle.bundlePath } : {}),
    },
    provenance: {
      schemaVersion: String(provenance.schemaVersion ?? "unknown"),
      assetPath: String(provenance.assetPath ?? ""),
      textureMode: String(provenance.textureMode ?? "unknown"),
      animationMode: String(provenance.animationMode ?? "unknown"),
      realismGrade: String(provenance.realismGrade ?? "unknown"),
      promotionStatus: String(provenance.promotionStatus ?? "unknown"),
      notEvidenceFor,
      documentSha256: createHash("sha256").update(provenanceBytes).digest("hex"),
      sourceOriginChainPresent: hasRecordOrString(provenance.sourceOriginChain),
      licenseChainPresent: hasRecordOrString(provenance.licenseChain),
      derivativeLineagePresent: hasRecordOrString(provenance.derivativeLineage),
      toolVersionPresent: typeof provenance.toolVersion === "string" && provenance.toolVersion.length > 0,
      promptOrCaseParameterHashPresent: typeof provenance.promptOrCaseParameterHash === "string" && /^[a-f0-9]{32,64}$/u.test(provenance.promptOrCaseParameterHash),
    },
    roleNormalization: {
      sourceActorRole,
      normalizedActorRole: spec.actorRole,
      aliasPolicy: "case_definition_role_alias_map",
      aliasAccepted: roleNormalization.aliasAccepted,
      mappingNote: roleNormalization.mappingNote,
    },
    glb: {
      byteLength: 0,
      sha256: "0".repeat(64),
      sceneCount: 0,
      nodeCount: 0,
      meshCount: 0,
      materialCount: 0,
      skinCount: 0,
      animationCount: 0,
      morphTargetPrimitiveCount: 0,
      vertexCount: 0,
      clinicalIdlePoseClipCount: 0,
    },
    rigEvidence: {
      skinPresent: false,
      animationPresent: false,
      morphTargetsPresent: false,
      clinicalIdlePosePresent: false,
    },
    rigControlEvidence: {
      canonicalSkeletonNodesPresent: false,
      faceRigNodesPresent: false,
      gazeEyeNodesPresent: false,
      blinkControlPresent: false,
      locomotionPostureClipPresent: false,
      requiredMorphTargetsPresent: false,
      requiredMorphTargets,
      missingMorphTargets: requiredMorphTargets,
      observedMorphTargets: [],
      observedControlNodes: [],
    },
    status: "blocked",
    blockers: ["generated_glb_local_artifact_missing"],
    nextEvidenceRequired: [
      "regenerate_or_restore_local_generated_glb_artifact_outside_git",
      "license_provenance_chain_review_with_source_origin_derivative_lineage_and_document_hash",
      "canonical_rig_expression_gaze_blink_and_locomotion_clip_evidence",
      "webxr_only_actor_closeup_screenshot",
      "visual_realism_adversarial_review",
      "quest_budget_evidence_before_quest_claims",
      "resolve_structural_or_provenance_blockers",
    ],
    quarantine: {
      failedCandidatesRemainReviewOnly: true,
      runtimeBundlePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
    },
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function validateAnnyCandidatePreflightReport(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value["schemaVersion"], "openclinxr.anny-candidate-preflight.v1", "/schemaVersion", errors);
  requireLiteral(value["claimScope"], "anny_candidate_preflight_metadata_and_structural_only", "/claimScope", errors);
  const providerBoundary = value["providerBoundary"];
  requireRecord(providerBoundary, "/providerBoundary", errors);
  if (isRecord(providerBoundary)) {
    requireLiteral(providerBoundary["executionEnabled"], false, "/providerBoundary/executionEnabled", errors);
    requireLiteral(providerBoundary["localOnly"], true, "/providerBoundary/localOnly", errors);
    requireLiteral(providerBoundary["externalProviderExecutionAttempted"], false, "/providerBoundary/externalProviderExecutionAttempted", errors);
    requireLiteral(providerBoundary["externalNetworkUsed"], false, "/providerBoundary/externalNetworkUsed", errors);
    requireLiteral(providerBoundary["paidApiUsed"], false, "/providerBoundary/paidApiUsed", errors);
  }
  const advisoryReview = value["advisoryReview"];
  requireRecord(advisoryReview, "/advisoryReview", errors);
  if (isRecord(advisoryReview)) {
    requireLiteral(advisoryReview["moonbridgeDeepSeekFirstPass"], "useful_policy_contract_reviewer", "/advisoryReview/moonbridgeDeepSeekFirstPass", errors);
    requireLiteral(advisoryReview["grade"], "B", "/advisoryReview/grade", errors);
  }
  const candidates = value["candidates"];
  if (!Array.isArray(candidates) || candidates.length === 0) errors.push("/candidates must be nonempty array");
  if (Array.isArray(candidates)) {
    for (const [index, candidate] of candidates.entries()) {
      if (!isRecord(candidate)) {
        errors.push(`/candidates/${index} must be object`);
        continue;
      }
      const actorMapping = candidate["actorMapping"];
      const source = candidate["source"];
      const provenance = candidate["provenance"];
      const roleNormalization = candidate["roleNormalization"];
      const glb = candidate["glb"];
      const rigControlEvidence = candidate["rigControlEvidence"];
      const localCandidateBundle = candidate["localCandidateBundle"];
      const quarantine = candidate["quarantine"];
      requireString(candidate["candidateId"], `/candidates/${index}/candidateId`, errors);
      requireRecord(actorMapping, `/candidates/${index}/actorMapping`, errors);
      requireRecord(source, `/candidates/${index}/source`, errors);
      requireRecord(provenance, `/candidates/${index}/provenance`, errors);
      requireRecord(roleNormalization, `/candidates/${index}/roleNormalization`, errors);
      requireRecord(glb, `/candidates/${index}/glb`, errors);
      requireRecord(rigControlEvidence, `/candidates/${index}/rigControlEvidence`, errors);
      requireRecord(quarantine, `/candidates/${index}/quarantine`, errors);
      if (isRecord(provenance)) {
        requireSha(provenance["documentSha256"], `/candidates/${index}/provenance/documentSha256`, errors);
      }
      if (isRecord(roleNormalization)) {
        requireLiteral(roleNormalization["aliasPolicy"], "case_definition_role_alias_map", `/candidates/${index}/roleNormalization/aliasPolicy`, errors);
        requireLiteral(roleNormalization["aliasAccepted"], true, `/candidates/${index}/roleNormalization/aliasAccepted`, errors);
      }
      if (isRecord(source)) {
        if (typeof source["usesRealAnnyForwardPass"] !== "boolean") errors.push(`/candidates/${index}/source/usesRealAnnyForwardPass must be boolean`);
        if (typeof source["realAnnyWeightsUsed"] !== "boolean") errors.push(`/candidates/${index}/source/realAnnyWeightsUsed must be boolean`);
        requireLiteral(source["executionEnabled"], false, `/candidates/${index}/source/executionEnabled`, errors);
        requireLiteral(source["externalNetworkUsed"], false, `/candidates/${index}/source/externalNetworkUsed`, errors);
        requireLiteral(source["paidApiUsed"], false, `/candidates/${index}/source/paidApiUsed`, errors);
      }
      if (localCandidateBundle !== undefined) {
        requireRecord(localCandidateBundle, `/candidates/${index}/localCandidateBundle`, errors);
        if (isRecord(localCandidateBundle)) {
          requireLiteral(localCandidateBundle["schemaVersion"], "openclinxr.anny-local-candidate-bundle.v1", `/candidates/${index}/localCandidateBundle/schemaVersion`, errors);
          if (!["local_anny_compatible_candidate_bundle_not_real_anny_or_readiness", "local_real_anny_candidate_bundle_not_readiness"].includes(String(localCandidateBundle["claimScope"]))) {
            errors.push(`/candidates/${index}/localCandidateBundle/claimScope invalid`);
          }
          requireString(localCandidateBundle["bundlePath"], `/candidates/${index}/localCandidateBundle/bundlePath`, errors);
          requireStringArrayIncludes(localCandidateBundle["notEvidenceFor"], "b_plus_visual_realism_gate", `/candidates/${index}/localCandidateBundle/notEvidenceFor`, errors);
          requireStringArrayIncludes(localCandidateBundle["notEvidenceFor"], "quest_readiness", `/candidates/${index}/localCandidateBundle/notEvidenceFor`, errors);
          const bundleGeneration = localCandidateBundle["generation"];
          const bundleProviderExecution = localCandidateBundle["providerExecution"];
          const bundleGates = localCandidateBundle["gates"];
          const bundleOutputEvidence = localCandidateBundle["outputEvidence"];
          requireRecord(bundleGeneration, `/candidates/${index}/localCandidateBundle/generation`, errors);
          requireRecord(bundleProviderExecution, `/candidates/${index}/localCandidateBundle/providerExecution`, errors);
          requireRecord(bundleGates, `/candidates/${index}/localCandidateBundle/gates`, errors);
          requireRecord(bundleOutputEvidence, `/candidates/${index}/localCandidateBundle/outputEvidence`, errors);
          if (isRecord(bundleGeneration)) {
            if (typeof bundleGeneration["usesRealAnnyForwardPass"] !== "boolean") errors.push(`/candidates/${index}/localCandidateBundle/generation/usesRealAnnyForwardPass must be boolean`);
            if (typeof bundleGeneration["realAnnyWeightsUsed"] !== "boolean") errors.push(`/candidates/${index}/localCandidateBundle/generation/realAnnyWeightsUsed must be boolean`);
            requireLiteral(bundleGeneration["useComfy"], false, `/candidates/${index}/localCandidateBundle/generation/useComfy`, errors);
            requireSha(bundleGeneration["paramsHash"], `/candidates/${index}/localCandidateBundle/generation/paramsHash`, errors);
          }
          if (isRecord(bundleProviderExecution)) {
            requireLiteral(bundleProviderExecution["cloudProviderUsed"], false, `/candidates/${index}/localCandidateBundle/providerExecution/cloudProviderUsed`, errors);
            requireLiteral(bundleProviderExecution["paidApiUsed"], false, `/candidates/${index}/localCandidateBundle/providerExecution/paidApiUsed`, errors);
            requireLiteral(bundleProviderExecution["modelDownloadUsed"], false, `/candidates/${index}/localCandidateBundle/providerExecution/modelDownloadUsed`, errors);
            requireLiteral(bundleProviderExecution["comfyUsed"], false, `/candidates/${index}/localCandidateBundle/providerExecution/comfyUsed`, errors);
          }
          if (isRecord(bundleGates)) {
            if (typeof bundleGates["realAnnyModelOutput"] !== "boolean") errors.push(`/candidates/${index}/localCandidateBundle/gates/realAnnyModelOutput must be boolean`);
            for (const gate of ["bPlusVisualRealismGate", "scenePlacementReadiness", "questReadiness", "productionReadiness", "learnerReadiness", "clinicalValidity", "scoringValidity"]) {
              requireLiteral(bundleGates[gate], false, `/candidates/${index}/localCandidateBundle/gates/${gate}`, errors);
            }
          }
          if (isRecord(bundleOutputEvidence)) {
            requireLiteral(bundleOutputEvidence["allOutputsPresent"], true, `/candidates/${index}/localCandidateBundle/outputEvidence/allOutputsPresent`, errors);
            for (const key of ["objSha256", "sourceManifestSha256", "glbSha256", "riggingReportSha256", "provenanceSha256"]) {
              requireSha(bundleOutputEvidence[key], `/candidates/${index}/localCandidateBundle/outputEvidence/${key}`, errors);
            }
          }
          const roleMaterialHandoff = localCandidateBundle["roleMaterialHandoff"];
          if (roleMaterialHandoff !== undefined) {
            requireRecord(roleMaterialHandoff, `/candidates/${index}/localCandidateBundle/roleMaterialHandoff`, errors);
            if (isRecord(roleMaterialHandoff)) {
              requireString(roleMaterialHandoff["roleVisualCue"], `/candidates/${index}/localCandidateBundle/roleMaterialHandoff/roleVisualCue`, errors);
              requireString(roleMaterialHandoff["wardrobeRole"], `/candidates/${index}/localCandidateBundle/roleMaterialHandoff/wardrobeRole`, errors);
              requireString(roleMaterialHandoff["clothingStyle"], `/candidates/${index}/localCandidateBundle/roleMaterialHandoff/clothingStyle`, errors);
              if (!Array.isArray(roleMaterialHandoff["objectNames"]) || roleMaterialHandoff["objectNames"].length === 0) {
                errors.push(`/candidates/${index}/localCandidateBundle/roleMaterialHandoff/objectNames must be nonempty array`);
              }
              requireStringArrayIncludes(roleMaterialHandoff["notEvidenceFor"], "production_asset_readiness", `/candidates/${index}/localCandidateBundle/roleMaterialHandoff/notEvidenceFor`, errors);
            }
          }
          const roleAnimationHandoff = localCandidateBundle["roleAnimationHandoff"];
          if (roleAnimationHandoff !== undefined) {
            requireRecord(roleAnimationHandoff, `/candidates/${index}/localCandidateBundle/roleAnimationHandoff`, errors);
            if (isRecord(roleAnimationHandoff)) {
              if (!Array.isArray(roleAnimationHandoff["roleSpecificClipNames"]) || roleAnimationHandoff["roleSpecificClipNames"].length === 0) {
                errors.push(`/candidates/${index}/localCandidateBundle/roleAnimationHandoff/roleSpecificClipNames must be nonempty array`);
              }
              requireString(roleAnimationHandoff["claimScope"], `/candidates/${index}/localCandidateBundle/roleAnimationHandoff/claimScope`, errors);
              requireStringArrayIncludes(roleAnimationHandoff["notEvidenceFor"], "production_asset_readiness", `/candidates/${index}/localCandidateBundle/roleAnimationHandoff/notEvidenceFor`, errors);
            }
          }
          const proceduralFaceDetailHandoff = localCandidateBundle["proceduralFaceDetailHandoff"];
          if (proceduralFaceDetailHandoff !== undefined) {
            requireRecord(proceduralFaceDetailHandoff, `/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff`, errors);
            if (isRecord(proceduralFaceDetailHandoff)) {
              requireString(proceduralFaceDetailHandoff["hairPlacementMode"], `/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff/hairPlacementMode`, errors);
              requireString(proceduralFaceDetailHandoff["eyePlacementMode"], `/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff/eyePlacementMode`, errors);
              requireString(proceduralFaceDetailHandoff["featurePlacementMode"], `/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff/featurePlacementMode`, errors);
              requireString(proceduralFaceDetailHandoff["hairObjectName"], `/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff/hairObjectName`, errors);
              requireString(proceduralFaceDetailHandoff["coordinateBasis"], `/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff/coordinateBasis`, errors);
              if (!Array.isArray(proceduralFaceDetailHandoff["eyeObjectNames"]) || proceduralFaceDetailHandoff["eyeObjectNames"].length === 0) {
                errors.push(`/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff/eyeObjectNames must be nonempty array`);
              }
              if (!Array.isArray(proceduralFaceDetailHandoff["facialFeatureObjectNames"])) {
                errors.push(`/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff/facialFeatureObjectNames must be array`);
              }
              requireString(proceduralFaceDetailHandoff["claimScope"], `/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff/claimScope`, errors);
              requireStringArrayIncludes(proceduralFaceDetailHandoff["notEvidenceFor"], "production_asset_readiness", `/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff/notEvidenceFor`, errors);
              requireStringArrayIncludes(proceduralFaceDetailHandoff["notEvidenceFor"], "b_plus_visual_realism_gate", `/candidates/${index}/localCandidateBundle/proceduralFaceDetailHandoff/notEvidenceFor`, errors);
            }
          }
          const morphTargetDiagnostics = localCandidateBundle["morphTargetDiagnostics"];
          if (morphTargetDiagnostics !== undefined) {
            requireRecord(morphTargetDiagnostics, `/candidates/${index}/localCandidateBundle/morphTargetDiagnostics`, errors);
            if (isRecord(morphTargetDiagnostics)) {
              if (typeof morphTargetDiagnostics["defaultWeightThreshold"] !== "number") {
                errors.push(`/candidates/${index}/localCandidateBundle/morphTargetDiagnostics/defaultWeightThreshold must be number`);
              }
              if (typeof morphTargetDiagnostics["extremeDeltaThreshold"] !== "number") {
                errors.push(`/candidates/${index}/localCandidateBundle/morphTargetDiagnostics/extremeDeltaThreshold must be number`);
              }
              if (!Array.isArray(morphTargetDiagnostics["nonzeroDefaultWeights"])) {
                errors.push(`/candidates/${index}/localCandidateBundle/morphTargetDiagnostics/nonzeroDefaultWeights must be array`);
              }
              if (!Array.isArray(morphTargetDiagnostics["extremeMorphDeltas"])) {
                errors.push(`/candidates/${index}/localCandidateBundle/morphTargetDiagnostics/extremeMorphDeltas must be array`);
              }
              requireString(morphTargetDiagnostics["claimScope"], `/candidates/${index}/localCandidateBundle/morphTargetDiagnostics/claimScope`, errors);
              requireStringArrayIncludes(morphTargetDiagnostics["notEvidenceFor"], "production_asset_readiness", `/candidates/${index}/localCandidateBundle/morphTargetDiagnostics/notEvidenceFor`, errors);
              requireStringArrayIncludes(morphTargetDiagnostics["notEvidenceFor"], "b_plus_visual_realism_gate", `/candidates/${index}/localCandidateBundle/morphTargetDiagnostics/notEvidenceFor`, errors);
            }
          }
        }
      }
      if (isRecord(glb)) {
        requireSha(glb["sha256"], `/candidates/${index}/glb/sha256`, errors);
      }
      if (isRecord(rigControlEvidence)) {
        requireStringArrayIncludes(rigControlEvidence["requiredMorphTargets"], "openclinxr_mouth_open", `/candidates/${index}/rigControlEvidence/requiredMorphTargets`, errors);
        requireStringArrayIncludes(rigControlEvidence["requiredMorphTargets"], "openclinxr_brow_concern", `/candidates/${index}/rigControlEvidence/requiredMorphTargets`, errors);
        requireStringArrayIncludes(rigControlEvidence["requiredMorphTargets"], "openclinxr_cheek_tension", `/candidates/${index}/rigControlEvidence/requiredMorphTargets`, errors);
        if (!Array.isArray(rigControlEvidence["observedControlNodes"])) {
          errors.push(`/candidates/${index}/rigControlEvidence/observedControlNodes must be array`);
        }
        if (!Array.isArray(rigControlEvidence["observedMorphTargets"])) {
          errors.push(`/candidates/${index}/rigControlEvidence/observedMorphTargets must be array`);
        }
      }
      if (isRecord(quarantine)) {
        requireLiteral(quarantine["runtimeBundlePromotionAllowed"], false, `/candidates/${index}/quarantine/runtimeBundlePromotionAllowed`, errors);
        requireLiteral(quarantine["productionManifestPromotionAllowed"], false, `/candidates/${index}/quarantine/productionManifestPromotionAllowed`, errors);
      }
      if (!["blocked", "reviewable_metadata_only", "ready_for_local_import_trial", "ready_for_webxr_visual_evidence"].includes(String(candidate["status"]))) {
        errors.push(`/candidates/${index}/status invalid`);
      }
    }
  }
  const decision = value["decision"];
  requireRecord(decision, "/decision", errors);
  if (isRecord(decision)) {
    requireLiteral(decision["currentFallbacksRemainActive"], true, "/decision/currentFallbacksRemainActive", errors);
    requireLiteral(decision["runtimePromotionAllowed"], false, "/decision/runtimePromotionAllowed", errors);
  }
  for (const gate of ["b_plus_visual_realism_gate", "production_asset_readiness", "quest_readiness", "learner_readiness", "clinical_validity", "scoring_validity"]) {
    requireStringArrayIncludes(value["notEvidenceFor"], gate, "/notEvidenceFor", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { validateLatest: false, candidateBundlePaths: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--candidate-bundle-dir") options.candidateBundleDir = requireNext(args, ++index, arg);
    else if (arg === "--candidate-bundle") options.candidateBundlePaths.push(requireNext(args, ++index, arg));
  }
  return options;
}

async function collectCandidateBundlePaths(options: CliOptions): Promise<string[]> {
  const paths = [...options.candidateBundlePaths];
  if (!options.candidateBundleDir && paths.length === 0) {
    paths.push(...await globFiles("apps/ui-xr/public/generated-humanoids/*.bundle.json"));
  }
  if (options.candidateBundleDir) {
    const dir = options.candidateBundleDir.replace(/\/$/u, "");
    paths.push(...await globFiles(`${dir}/*.bundle.json`));
  }
  return uniqueStrings(paths).sort();
}

async function loadLocalCandidateBundleMap(bundlePaths: string[]): Promise<Map<string, LocalCandidateBundleBinding>> {
  const bundles = new Map<string, LocalCandidateBundleBinding>();
  for (const bundlePath of bundlePaths) {
    const raw = await readJson<RawLocalCandidateBundle>(bundlePath);
    const actorId = typeof raw.actorId === "string" ? raw.actorId : "";
    if (!actorId) throw new Error(`${bundlePath} missing actorId`);
    if (bundles.has(actorId)) throw new Error(`Duplicate local candidate bundle for actor ${actorId}`);
    const outputs = raw.outputs;
    if (!isRecord(outputs)) throw new Error(`${bundlePath} missing outputs`);
    bundles.set(actorId, {
      bundlePath,
      raw,
      sourceGlbPath: requireOutputPath(outputs, "glbPath", bundlePath),
      provenancePath: requireOutputPath(outputs, "provenancePath", bundlePath),
      sourceManifestPath: requireOutputPath(outputs, "sourceManifestPath", bundlePath),
      riggingReportPath: requireOutputPath(outputs, "riggingReportPath", bundlePath),
      objPath: requireOutputPath(outputs, "objPath", bundlePath),
    });
  }
  return bundles;
}

function requireOutputPath(outputs: Record<string, unknown>, key: string, bundlePath: string): string {
  const value = outputs[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${bundlePath} missing outputs.${key}`);
  return value;
}

function applyLocalCandidateBundle(spec: AnnyCandidateSpec, bundle: LocalCandidateBundleBinding | undefined): AnnyCandidateSpec {
  if (!bundle) return spec;
  return {
    ...spec,
    sourceGlbPath: bundle.sourceGlbPath,
    provenancePath: bundle.provenancePath,
    localCandidateBundle: bundle,
  };
}

async function evaluateLocalCandidateBundle(
  bundle: LocalCandidateBundleBinding,
  sourceBytes: Buffer,
  provenanceBytes: Buffer,
): Promise<LocalCandidateBundleEvidence> {
  const generation = isRecord(bundle.raw.generation) ? bundle.raw.generation : {};
  const providerExecution = isRecord(bundle.raw.providerExecution) ? bundle.raw.providerExecution : {};
  const gates = isRecord(bundle.raw.gates) ? bundle.raw.gates : {};
  const objBytes = await readFile(bundle.objPath);
  const sourceManifestBytes = await readFile(bundle.sourceManifestPath);
  const riggingReportBytes = await readFile(bundle.riggingReportPath);
  const riggingReport = parseJsonRecord(riggingReportBytes, bundle.riggingReportPath);
  const roleMaterialHandoff = roleMaterialHandoffFromRiggingReport(riggingReport);
  const roleAnimationHandoff = roleAnimationHandoffFromRiggingReport(riggingReport);
  const proceduralFaceDetailHandoff = proceduralFaceDetailHandoffFromRiggingReport(riggingReport);
  const morphTargetDiagnostics = morphTargetDiagnosticsFromRiggingReport(riggingReport);
  return {
    schemaVersion: String(bundle.raw.schemaVersion ?? "unknown"),
    claimScope: String(bundle.raw.claimScope ?? "unknown"),
    bundlePath: bundle.bundlePath,
    actorRole: String(bundle.raw.actorRole ?? ""),
    outputPaths: {
      objPath: bundle.objPath,
      sourceManifestPath: bundle.sourceManifestPath,
      glbPath: bundle.sourceGlbPath,
      riggingReportPath: bundle.riggingReportPath,
      provenancePath: bundle.provenancePath,
    },
    generation: {
      generatorMode: String(generation["generatorMode"] ?? "unknown"),
      usesRealAnnyForwardPass: generation["usesRealAnnyForwardPass"] === true,
      realAnnyWeightsUsed: generation["realAnnyWeightsUsed"] === true,
      useComfy: generation["useComfy"] === false ? false : true as never,
      seed: typeof generation["seed"] === "number" ? generation["seed"] : null,
      paramsHash: String(generation["paramsHash"] ?? ""),
    },
    providerExecution: {
      cloudProviderUsed: providerExecution["cloudProviderUsed"] === false ? false : true as never,
      paidApiUsed: providerExecution["paidApiUsed"] === false ? false : true as never,
      modelDownloadUsed: providerExecution["modelDownloadUsed"] === false ? false : true as never,
      comfyUsed: providerExecution["comfyUsed"] === false ? false : true as never,
    },
    gates: {
      realAnnyModelOutput: gates["realAnnyModelOutput"] === true,
      bPlusVisualRealismGate: gates["bPlusVisualRealismGate"] === false ? false : true as never,
      scenePlacementReadiness: gates["scenePlacementReadiness"] === false ? false : true as never,
      questReadiness: gates["questReadiness"] === false ? false : true as never,
      productionReadiness: gates["productionReadiness"] === false ? false : true as never,
      learnerReadiness: gates["learnerReadiness"] === false ? false : true as never,
      clinicalValidity: gates["clinicalValidity"] === false ? false : true as never,
      scoringValidity: gates["scoringValidity"] === false ? false : true as never,
    },
    outputEvidence: {
      allOutputsPresent: true,
      objSha256: createHash("sha256").update(objBytes).digest("hex"),
      sourceManifestSha256: createHash("sha256").update(sourceManifestBytes).digest("hex"),
      glbSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      riggingReportSha256: createHash("sha256").update(riggingReportBytes).digest("hex"),
      provenanceSha256: createHash("sha256").update(provenanceBytes).digest("hex"),
    },
    ...(roleMaterialHandoff ? { roleMaterialHandoff } : {}),
    ...(roleAnimationHandoff ? { roleAnimationHandoff } : {}),
    ...(proceduralFaceDetailHandoff ? { proceduralFaceDetailHandoff } : {}),
    ...(morphTargetDiagnostics ? { morphTargetDiagnostics } : {}),
    notEvidenceFor: stringArray(bundle.raw.notEvidenceFor),
  };
}

function parseJsonRecord(bytes: Buffer, sourcePath: string): Record<string, unknown> {
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!isRecord(value)) throw new Error(`${sourcePath} must contain a JSON object`);
  return value;
}

function roleMaterialHandoffFromRiggingReport(report: Record<string, unknown>): RoleMaterialHandoff | null {
  const roleVisualMarkers = isRecord(report["roleVisualMarkers"]) ? report["roleVisualMarkers"] : null;
  const roleClothingMaterialRegions = isRecord(report["roleClothingMaterialRegions"]) ? report["roleClothingMaterialRegions"] : null;
  const wardrobeTags = isRecord(report["wardrobeTags"]) ? report["wardrobeTags"] : {};
  const accessoryPresence = isRecord(report["accessoryPresence"]) ? report["accessoryPresence"] : {};
  if (!roleVisualMarkers) return null;
  const objectNames = stringArray(roleVisualMarkers["objectNames"]);
  if (objectNames.length === 0) return null;
  return {
    actorRole: stringOr(roleVisualMarkers["actorRole"], "unknown"),
    roleVisualCue: stringOr(roleVisualMarkers["roleVisualCue"], "unknown"),
    clothingStyle: stringOr(roleVisualMarkers["clothingStyle"], "unknown"),
    objectNames,
    ...(roleClothingMaterialRegions ? {
      meshRegionMaterialMode: stringOr(roleClothingMaterialRegions["meshRegionMaterialMode"], "unknown"),
      topMaterialName: stringOr(roleClothingMaterialRegions["topMaterialName"], "unknown"),
      lowerMaterialName: stringOr(roleClothingMaterialRegions["lowerMaterialName"], "unknown"),
      topFaceCount: numberOr(roleClothingMaterialRegions["topFaceCount"], 0),
      lowerFaceCount: numberOr(roleClothingMaterialRegions["lowerFaceCount"], 0),
    } : {}),
    wardrobeRole: stringOr(wardrobeTags["wardrobeRole"], stringOr(roleVisualMarkers["roleVisualCue"], "unknown")),
    garmentLayers: stringArray(wardrobeTags["garmentLayers"]),
    fabricPalette: stringOr(wardrobeTags["fabricPalette"], "unknown"),
    materialFinish: stringOr(wardrobeTags["materialFinish"], "unknown"),
    accessoryMarkers: stringArray(accessoryPresence["markers"]),
    generatedAccessoryObjects: stringArray(accessoryPresence["generatedObjects"]),
    claimScope: stringOr(roleVisualMarkers["claimScope"], "procedural_role_distinction_marker_not_production_costume"),
    notEvidenceFor: stringArray(roleVisualMarkers["notEvidenceFor"]),
  };
}

function roleAnimationHandoffFromRiggingReport(report: Record<string, unknown>): RoleAnimationHandoff | null {
  const handoff = isRecord(report["roleAnimationHandoff"]) ? report["roleAnimationHandoff"] : null;
  if (!handoff) return null;
  const roleSpecificClipNames = stringArray(handoff["roleSpecificClipNames"]);
  if (roleSpecificClipNames.length === 0) return null;
  return {
    actorRole: stringOr(handoff["actorRole"], "unknown"),
    roleSpecificClipNames,
    claimScope: stringOr(handoff["claimScope"], "deterministic_role_specific_procedural_gesture_not_mocap_or_speech2motion"),
    notEvidenceFor: stringArray(handoff["notEvidenceFor"]),
  };
}

function proceduralFaceDetailHandoffFromRiggingReport(report: Record<string, unknown>): ProceduralFaceDetailHandoff | null {
  const markers = isRecord(report["faceDetailMarkers"]) ? report["faceDetailMarkers"] : null;
  if (!markers) return null;
  if (markers["status"] === "abandoned_rejected_experiment") return null;
  const eyeObjectNames = stringArray(markers["eyeObjectNames"]);
  if (eyeObjectNames.length === 0) return null;
  return {
    hairPlacementMode: stringOr(markers["hairPlacementMode"], "unknown"),
    eyePlacementMode: stringOr(markers["eyePlacementMode"], "unknown"),
    featurePlacementMode: stringOr(markers["featurePlacementMode"], "unknown"),
    hairObjectName: stringOr(markers["hairObjectName"], "unknown"),
    eyeObjectNames,
    facialFeatureObjectNames: stringArray(markers["facialFeatureObjectNames"]),
    coordinateBasis: stringOr(markers["coordinateBasis"], "unknown"),
    headTopY: numberOrNull(markers["headTopY"]),
    eyeY: numberOrNull(markers["eyeY"]),
    faceZ: numberOrNull(markers["faceZ"]),
    claimScope: stringOr(markers["claimScope"], "procedural_face_detail_marker_not_production_groom_or_eye_shader"),
    notEvidenceFor: stringArray(markers["notEvidenceFor"]),
  };
}

function morphTargetDiagnosticsFromRiggingReport(report: Record<string, unknown>): MorphTargetDiagnostics | null {
  const diagnostics = isRecord(report["morphTargetDiagnostics"]) ? report["morphTargetDiagnostics"] : null;
  if (!diagnostics) return null;
  const nonzeroDefaultWeights = Array.isArray(diagnostics["nonzeroDefaultWeights"]) ? diagnostics["nonzeroDefaultWeights"] : [];
  const extremeMorphDeltas = Array.isArray(diagnostics["extremeMorphDeltas"]) ? diagnostics["extremeMorphDeltas"] : [];
  if (nonzeroDefaultWeights.length === 0 && extremeMorphDeltas.length === 0) return null;
  return {
    defaultWeightThreshold: numberOr(diagnostics["defaultWeightThreshold"], 0.001),
    extremeDeltaThreshold: numberOr(diagnostics["extremeDeltaThreshold"], 0.05),
    nonzeroDefaultWeights: nonzeroDefaultWeights.map((entry) => ({
      name: stringOr(isRecord(entry) ? entry["name"] : undefined, "unknown"),
      defaultValue: numberOr(isRecord(entry) ? entry["defaultValue"] : undefined, 0),
    })),
    extremeMorphDeltas: extremeMorphDeltas.map((entry) => ({
      name: stringOr(isRecord(entry) ? entry["name"] : undefined, "unknown"),
      maxDelta: numberOr(isRecord(entry) ? entry["maxDelta"] : undefined, 0),
      maxAxisDelta: numberOr(isRecord(entry) ? entry["maxAxisDelta"] : undefined, 0),
    })),
    claimScope: stringOr(diagnostics["claimScope"], "morph_target_diagnostic_not_readiness"),
    notEvidenceFor: stringArray(diagnostics["notEvidenceFor"]),
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const paths = await globFiles(pattern);
  return paths.sort().at(-1);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRecordOrString(value: unknown): boolean {
  return (typeof value === "string" && value.length > 0) || isRecord(value);
}

function normalizeActorRole(sourceActorRole: string, normalizedActorRole: AnnyCandidateSpec["actorRole"]): { aliasAccepted: boolean; mappingNote: string } {
  const aliases: Record<AnnyCandidateSpec["actorRole"], string[]> = {
    patient: ["patient", "patient_child", "standardized_patient"],
    family: ["family", "parent", "anxious_parent", "caregiver", "guardian"],
    nurse: ["nurse", "rn", "triage_nurse"],
    consultant: ["consultant", "specialist", "consulting_physician"],
    interpreter: ["interpreter", "medical_interpreter"],
  };
  const aliasAccepted = aliases[normalizedActorRole].includes(sourceActorRole);
  return {
    aliasAccepted,
    mappingNote: aliasAccepted
      ? `${sourceActorRole} normalized to ${normalizedActorRole} by case-definition alias policy.`
      : `${sourceActorRole || "missing"} is not accepted for ${normalizedActorRole}.`,
  };
}

function readGlbMorphTargetNames(glb: Buffer): string[] {
  if (glb.length < 20 || glb.subarray(0, 4).toString("utf8") !== "glTF") return [];
  const jsonChunkLength = glb.readUInt32LE(12);
  const jsonChunkType = glb.subarray(16, 20).toString("utf8");
  if (jsonChunkType !== "JSON" || glb.length < 20 + jsonChunkLength) return [];
  const json = JSON.parse(glb.subarray(20, 20 + jsonChunkLength).toString("utf8")) as unknown;
  if (!isRecord(json) || !Array.isArray(json["meshes"])) return [];
  const names: string[] = [];
  for (const mesh of json["meshes"]) {
    if (!isRecord(mesh)) continue;
    const extras = mesh["extras"];
    if (!isRecord(extras)) continue;
    for (const targetName of stringArray(extras["targetNames"])) names.push(targetName);
  }
  return uniqueStrings(names);
}

function requireRecord(value: unknown, pointer: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${pointer} must be object`);
}

function requireString(value: unknown, pointer: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pointer} required`);
}

function requireLiteral(value: unknown, expected: unknown, pointer: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pointer} must be ${JSON.stringify(expected)}`);
}

function requireSha(value: unknown, pointer: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) errors.push(`${pointer} must be sha256 hex`);
}

function requireStringArrayIncludes(value: unknown, expected: string, pointer: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) errors.push(`${pointer} must include ${expected}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
