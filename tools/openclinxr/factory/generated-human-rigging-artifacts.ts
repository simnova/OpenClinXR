import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  type EncounterRuntimeAsset,
  type RuntimeAssetStoreConfig,
  registerGeneratedRuntimeAssetReference,
  resolveRuntimeAssetStoreConfig,
} from "../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";

const execFileAsync = promisify(execFile);

export const GENERATED_HUMAN_RIGGING_SCHEMA_VERSION = "openclinxr.generated-human-rigging-artifacts.v1";
export const GENERATED_HUMAN_RIGGING_KIND = "generated_human_rigging_artifacts";
export const GENERATED_HUMAN_RIGGING_OUTPUT_DIR =
  ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging";
export const GENERATED_HUMAN_RIGGING_GLB_NAME = "neutral-generated-human.glb";
export const ANNY_SOURCE_OBJ_NAME = "anny-neutral-generated-human.obj";
export const ANNY_SOURCE_MANIFEST_NAME = "anny-source-generator-manifest.json";
export const CANONICAL_SKELETON_BINDING_NAME = "canonical-skeleton-binding.json";
export const SKIN_WEIGHT_QUALITY_NAME = "skin-weight-quality.json";
export const HUMAN_REALISM_MANIFEST_NAME = "neutral-generated-human-realism-manifest.json";
export const BLENDER_RIGGING_COMMAND_TIMEOUT_MS = 120_000;

export const CANONICAL_HUMANOID_BONES = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "upper_arm.L",
  "forearm.L",
  "hand.L",
  "upper_arm.R",
  "forearm.R",
  "hand.R",
  "thigh.L",
  "shin.L",
  "foot.L",
  "thigh.R",
  "shin.R",
  "foot.R",
] as const;

export const CANONICAL_RIG_ANCHOR_NODES = [
  "neutral_generated_human_skinned_mesh",
  "openclinxr_canonical_humanoid_armature",
  "patient_robert_hayes_canonical_skeleton_anchor",
  "nurse_maria_alvarez_canonical_skeleton_anchor",
] as const;

export const CANONICAL_HUMANOID_EMBODIMENT_NODES = [
  "openclinxr_face_rig_root",
  "openclinxr_upper_lip_sync_control",
  "openclinxr_lower_lip_sync_control",
  "openclinxr_left_eye_gaze_control",
  "openclinxr_right_eye_gaze_control",
  "openclinxr_left_upper_eyelid_blink_control",
  "openclinxr_right_upper_eyelid_blink_control",
  "openclinxr_ragdoll_collision_capsule",
  "openclinxr_physician_interaction_target",
] as const;

export const CANONICAL_HUMANOID_MORPH_TARGETS = [
  "openclinxr_mouth_open",
  "openclinxr_brow_concern",
  "openclinxr_cheek_tension",
] as const;

export type CanonicalHumanoidBone = typeof CANONICAL_HUMANOID_BONES[number];
export type GeneratedHumanRiggingBodyProfile =
  | "adult_standard"
  | "pediatric_school_age"
  | "older_adult_kyphotic"
  | "bariatric_adult";

export const GENERATED_HUMAN_RIGGING_BODY_PROFILES: readonly GeneratedHumanRiggingBodyProfile[] = [
  "adult_standard",
  "pediatric_school_age",
  "older_adult_kyphotic",
  "bariatric_adult",
] as const;

export type GeneratedHumanRiggingReport = {
  schemaVersion: typeof GENERATED_HUMAN_RIGGING_SCHEMA_VERSION;
  kind: typeof GENERATED_HUMAN_RIGGING_KIND;
  generatedAt: string;
  tool: {
    name: "tools/openclinxr/generated-human-rigging-artifacts.ts";
    blenderVersion: string;
    elapsedMs: number;
  };
  policy: {
    localOnly: true;
    installsIntroduced: boolean;
    cloudApisUsed: false;
    paidApisUsed: false;
    externalAssetsUsed: false;
    generatedThirdPartyAssetsCommitted: false;
    productionAssetReadinessClaimed: false;
  };
  input: {
    laneId: "generatedHumanRigging";
    stationSlug: "ed-chest-pain";
    actorSlug: "neutral-generated-human";
    bodyProfile: GeneratedHumanRiggingBodyProfile;
    generationMode: "anny_parametric_body_mesh_with_blender_canonical_rig";
    sourceLicensePosture: "anny_apache_2_code_mpfb2_assets_license_recorded";
    preferredGeneratorToolId: "anny";
  };
  artifacts: {
    glbPath: string;
    annySourceObjPath?: string;
    annySourceManifestPath?: string;
    canonicalSkeletonBindingPath: string;
    skinWeightQualityPath: string;
    humanoidRealismManifestPath: string;
  };
  output: {
    glbBytes: number;
    magic: string;
    version: number;
    declaredLength: number;
    semanticInventory: {
      nodeCount: number;
      meshCount: number;
      skinCount: number;
      materialCount: number;
      animationCount: number;
      nodeNames: string[];
      skinJointNames: string[];
      requiredBoneNames: readonly CanonicalHumanoidBone[];
      missingRequiredBoneNames: string[];
      requiredAnchorNodeNames: readonly string[];
      missingRequiredAnchorNodeNames: string[];
      requiredEmbodimentNodeNames: readonly string[];
      missingRequiredEmbodimentNodeNames: string[];
      morphTargetNames: string[];
      requiredMorphTargetNames: readonly string[];
      missingRequiredMorphTargetNames: string[];
    };
    embodimentRigging: {
      sourceGeneratorRequired: "anny";
      faceRigPresent: boolean;
      lipSyncControlsPresent: boolean;
      eyeGazeControlsPresent: boolean;
      eyelidBlinkControlsPresent: boolean;
      ragdollCollisionProxyPresent: boolean;
      physicianInteractionTargetPresent: boolean;
      runtimeDialogueLipSyncRequired: true;
      runtimeDialogueGazeRequired: true;
      runtimeMorphTargetVisemeRequired: true;
    };
  };
  verdict: {
    passed: boolean;
    readyForProductionAssets: false;
    blockers: string[];
  };
};

export const GENERATED_HUMANOID_REALISM_MANIFEST_SCHEMA_VERSION = "openclinxr.generated-humanoid-realism-manifest.v1";
export const GENERATED_HUMANOID_REALISM_MANIFEST_KIND = "generated_humanoid_realism_manifest";

export type GeneratedHumanoidRealismManifest = {
  schemaVersion: typeof GENERATED_HUMANOID_REALISM_MANIFEST_SCHEMA_VERSION;
  kind: typeof GENERATED_HUMANOID_REALISM_MANIFEST_KIND;
  generatedAt: string;
  laneId: "generatedHumanRigging";
  stationSlug: "ed-chest-pain";
  actorSlug: "neutral-generated-human";
  generationMode: "anny_parametric_body_mesh_with_blender_canonical_rig";
  evidence: {
    rigging: {
      canonicalBoneCoverageComplete: boolean;
      requiredBoneCount: number;
      observedBoneCount: number;
      anchorNodesPresent: string[];
      missingAnchorNodes: string[];
    };
    eyesAndGaze: {
      eyeGazeControlsPresent: boolean;
      eyelidBlinkControlsPresent: boolean;
      eyeGazeControlNodes: string[];
      blinkControlNodes: string[];
    };
    lipsAndVisemes: {
      lipSyncControlsPresent: boolean;
      runtimeDialogueLipSyncRequired: boolean;
      visemeMorphTargets: string[];
      morphTargetsObserved: string[];
      missingMorphTargets: string[];
    };
    faceExpressionTransitions: {
      faceRigPresent: boolean;
      physicianInteractionTargetPresent: boolean;
      runtimeMorphTargetTransitionRequirement: boolean;
      expressionTransitionNodes: string[];
    };
    clothing: {
      clothingNodeCount: number;
      clothingNodeNames: string[];
      clothingEvidenceNodes: string[];
    };
    poseLocomotionPosture: {
      hasAnimationCurves: boolean;
      animationCount: number;
      primaryPostureIntent: "neutral-clinical-stand";
      locomotionProxyPosture: "asset_pose_static";
    };
    collisionAndProxyPosture: {
      ragdollCollisionProxyPresent: boolean;
      ragdollCollisionNode: string | null;
      physicianInteractionTargetPresent: boolean;
      physicianTargetNode: string | null;
    };
    sharedAssetLibraryReuse: {
      enabled: true;
      sharedLibraryRefs: string[];
      reuseProfile: "ed-clinical-humanoid-asset-family-v1";
      note: string;
    };
  };
  caveats: string[];
};

export type CanonicalSkeletonBindingReport = {
  schemaVersion: "openclinxr.canonical-skeleton-binding.v1";
  kind: "canonical_skeleton_binding";
  generatedAt: string;
  laneId: "generatedHumanRigging";
  actorSlug: "neutral-generated-human";
  armatureNodeName: "openclinxr_canonical_humanoid_armature";
  meshNodeName: "neutral_generated_human_skinned_mesh";
  sourceLicensePosture: "anny_apache_2_code_mpfb2_assets_license_recorded";
  productionAssetReadinessClaimed: false;
  bindings: Array<{
    canonicalBoneName: CanonicalHumanoidBone;
    gltfJointName: CanonicalHumanoidBone;
    required: true;
    observed: boolean;
  }>;
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

export type SkinWeightQualityReport = {
  schemaVersion: "openclinxr.skin-weight-quality.v1";
  kind: "skin_weight_quality";
  generatedAt: string;
  laneId: "generatedHumanRigging";
  actorSlug: "neutral-generated-human";
  evaluationMode: "deterministic_static_glb_inventory";
  productionAssetReadinessClaimed: false;
  metrics: {
    glbBytes: number;
    skinCount: number;
    requiredBoneCount: number;
    observedRequiredBoneCount: number;
    missingRequiredBoneNames: string[];
    anchorNodeCount: number;
    missingRequiredAnchorNodeNames: string[];
  };
  caveats: string[];
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

type GlbInspection = {
  glbBytes: number;
  magic: string;
  version: number;
  declaredLength: number;
  nodeCount: number;
  meshCount: number;
  skinCount: number;
  materialCount: number;
  animationCount: number;
  nodeNames: string[];
  skinJointNames: string[];
  missingRequiredBoneNames: string[];
  missingRequiredAnchorNodeNames: string[];
  missingRequiredEmbodimentNodeNames: string[];
  morphTargetNames: string[];
  missingRequiredMorphTargetNames: string[];
  jsonChunkMissing: boolean;
};

type CliOptions = {
  outputRoot: string;
  reportPath: string;
  blenderPath: string;
  bodyProfile: GeneratedHumanRiggingBodyProfile;
  validatePath?: string;
  validateLatest: boolean;
  help: boolean;
};

function generatedHumanRiggingArtifactPaths(outputRoot: string) {
  const absoluteOutputRoot = path.resolve(outputRoot);
  return {
    outputRoot: absoluteOutputRoot,
    glb: path.join(absoluteOutputRoot, GENERATED_HUMAN_RIGGING_GLB_NAME),
    annySourceObj: path.join(absoluteOutputRoot, ANNY_SOURCE_OBJ_NAME),
    annySourceManifest: path.join(absoluteOutputRoot, ANNY_SOURCE_MANIFEST_NAME),
    canonicalSkeletonBinding: path.join(absoluteOutputRoot, CANONICAL_SKELETON_BINDING_NAME),
    skinWeightQuality: path.join(absoluteOutputRoot, SKIN_WEIGHT_QUALITY_NAME),
    humanoidRealismManifest: path.join(absoluteOutputRoot, HUMAN_REALISM_MANIFEST_NAME),
  };
}

export function defaultGeneratedHumanRiggingReportPath(date = new Date()): string {
  return path.join("docs/openclinxr", `generated-human-rigging-artifacts-${date.toISOString().slice(0, 10)}.json`);
}

export function buildGeneratedHumanRiggingReportFromGlb(options: {
  generatedAt: string;
  blenderVersion: string;
  elapsedMs: number;
  glb: Buffer;
  outputRoot?: string;
  sourceGenerator?: "anny";
  bodyProfile?: GeneratedHumanRiggingBodyProfile;
}): GeneratedHumanRiggingReport {
  const outputRoot = options.outputRoot ?? GENERATED_HUMAN_RIGGING_OUTPUT_DIR;
  const artifactPaths = generatedHumanRiggingArtifactPaths(outputRoot);
  const inspection = inspectGlb(options.glb);
  const blockers = buildRiggingBlockers(inspection);
  const sourceGenerator = options.sourceGenerator ?? "anny";

  return {
    schemaVersion: GENERATED_HUMAN_RIGGING_SCHEMA_VERSION,
    kind: GENERATED_HUMAN_RIGGING_KIND,
    generatedAt: options.generatedAt,
    tool: {
      name: "tools/openclinxr/generated-human-rigging-artifacts.ts",
      blenderVersion: options.blenderVersion,
      elapsedMs: options.elapsedMs,
    },
    policy: {
      localOnly: true,
      installsIntroduced: sourceGenerator === "anny",
      cloudApisUsed: false,
      paidApisUsed: false,
      externalAssetsUsed: false,
      generatedThirdPartyAssetsCommitted: false,
      productionAssetReadinessClaimed: false,
    },
    input: {
      laneId: "generatedHumanRigging",
      stationSlug: "ed-chest-pain",
      actorSlug: "neutral-generated-human",
      bodyProfile: options.bodyProfile ?? "adult_standard",
      generationMode: "anny_parametric_body_mesh_with_blender_canonical_rig",
      sourceLicensePosture: "anny_apache_2_code_mpfb2_assets_license_recorded",
      preferredGeneratorToolId: "anny",
    },
    artifacts: {
      glbPath: toRepoRelativePath(artifactPaths.glb),
      annySourceObjPath: toRepoRelativePath(artifactPaths.annySourceObj),
      annySourceManifestPath: toRepoRelativePath(artifactPaths.annySourceManifest),
      canonicalSkeletonBindingPath: toRepoRelativePath(artifactPaths.canonicalSkeletonBinding),
      skinWeightQualityPath: toRepoRelativePath(artifactPaths.skinWeightQuality),
      humanoidRealismManifestPath: toRepoRelativePath(artifactPaths.humanoidRealismManifest),
    },
    output: {
      glbBytes: inspection.glbBytes,
      magic: inspection.magic,
      version: inspection.version,
      declaredLength: inspection.declaredLength,
      semanticInventory: {
        nodeCount: inspection.nodeCount,
        meshCount: inspection.meshCount,
        skinCount: inspection.skinCount,
        materialCount: inspection.materialCount,
        animationCount: inspection.animationCount,
        nodeNames: inspection.nodeNames,
        skinJointNames: inspection.skinJointNames,
        requiredBoneNames: CANONICAL_HUMANOID_BONES,
        missingRequiredBoneNames: inspection.missingRequiredBoneNames,
        requiredAnchorNodeNames: CANONICAL_RIG_ANCHOR_NODES,
        missingRequiredAnchorNodeNames: inspection.missingRequiredAnchorNodeNames,
        requiredEmbodimentNodeNames: CANONICAL_HUMANOID_EMBODIMENT_NODES,
        missingRequiredEmbodimentNodeNames: inspection.missingRequiredEmbodimentNodeNames,
        morphTargetNames: inspection.morphTargetNames,
        requiredMorphTargetNames: CANONICAL_HUMANOID_MORPH_TARGETS,
        missingRequiredMorphTargetNames: inspection.missingRequiredMorphTargetNames,
      },
      embodimentRigging: {
        sourceGeneratorRequired: "anny",
        faceRigPresent: !inspection.missingRequiredEmbodimentNodeNames.includes("openclinxr_face_rig_root"),
        lipSyncControlsPresent: !inspection.missingRequiredEmbodimentNodeNames.includes("openclinxr_upper_lip_sync_control")
          && !inspection.missingRequiredEmbodimentNodeNames.includes("openclinxr_lower_lip_sync_control"),
        eyeGazeControlsPresent: !inspection.missingRequiredEmbodimentNodeNames.includes("openclinxr_left_eye_gaze_control")
          && !inspection.missingRequiredEmbodimentNodeNames.includes("openclinxr_right_eye_gaze_control"),
        eyelidBlinkControlsPresent: !inspection.missingRequiredEmbodimentNodeNames.includes("openclinxr_left_upper_eyelid_blink_control")
          && !inspection.missingRequiredEmbodimentNodeNames.includes("openclinxr_right_upper_eyelid_blink_control"),
        ragdollCollisionProxyPresent: !inspection.missingRequiredEmbodimentNodeNames.includes("openclinxr_ragdoll_collision_capsule"),
        physicianInteractionTargetPresent: !inspection.missingRequiredEmbodimentNodeNames.includes("openclinxr_physician_interaction_target"),
        runtimeDialogueLipSyncRequired: true,
        runtimeDialogueGazeRequired: true,
        runtimeMorphTargetVisemeRequired: true,
      },
    },
    verdict: {
      passed: blockers.length === 0,
      readyForProductionAssets: false,
      blockers,
    },
  };
}

export function buildGeneratedHumanRiggingRuntimeAssetReference(
  report: GeneratedHumanRiggingReport,
  assetStore: RuntimeAssetStoreConfig = {
    storeKind: "azurite_blob",
    containerName: "openclinxr-assets",
  },
): EncounterRuntimeAsset {
  const resolvedAssetStore = resolveRuntimeAssetStoreConfig(assetStore);
  return registerGeneratedRuntimeAssetReference({
    assetId: "neutral_generated_humanoid_model_glb",
    version: `generated-human-rigging-${report.generatedAt.slice(0, 10)}`,
    kind: "humanoid_model",
    displayName: "Neutral generated humanoid GLB",
    scenarioAssetId: "patient_robert_hayes_character",
    blobName: report.artifacts.glbPath,
    contentType: "model/gltf-binary",
    contentHash: `bytes:${report.output.glbBytes}:declared:${report.output.declaredLength}`,
    assetStore: resolvedAssetStore,
    reviewStatus: report.verdict.passed ? "approved_for_local_runtime" : "blocked",
    provenanceRefs: [
      report.artifacts.canonicalSkeletonBindingPath,
      report.artifacts.skinWeightQualityPath,
      "generated_human_morph_target_viseme_contract",
      "generated_human_rigging_report",
    ],
  });
}

export function buildGeneratedHumanoidRealismManifest(report: GeneratedHumanRiggingReport): GeneratedHumanoidRealismManifest {
  const clothingEvidenceNodes = [
    "local_fixture_scrub_tunic",
    "local_fixture_scrub_pants_left",
    "local_fixture_scrub_pants_right",
    "local_fixture_left_shoe",
    "local_fixture_right_shoe",
    "local_fixture_hair_cap",
    "local_fixture_left_eye",
    "local_fixture_right_eye",
  ];
  const clothingNodeNames = report.output.semanticInventory.nodeNames.filter((nodeName) => clothingEvidenceNodes.includes(nodeName));

  return {
    schemaVersion: GENERATED_HUMANOID_REALISM_MANIFEST_SCHEMA_VERSION,
    kind: GENERATED_HUMANOID_REALISM_MANIFEST_KIND,
    generatedAt: report.generatedAt,
    laneId: "generatedHumanRigging",
    stationSlug: "ed-chest-pain",
    actorSlug: "neutral-generated-human",
    generationMode: "anny_parametric_body_mesh_with_blender_canonical_rig",
    evidence: {
      rigging: {
        canonicalBoneCoverageComplete: report.output.semanticInventory.missingRequiredBoneNames.length === 0,
        requiredBoneCount: report.output.semanticInventory.requiredBoneNames.length,
        observedBoneCount: report.output.semanticInventory.requiredBoneNames.length - report.output.semanticInventory.missingRequiredBoneNames.length,
        anchorNodesPresent: report.output.semanticInventory.requiredAnchorNodeNames.filter(
          (nodeName) => !report.output.semanticInventory.missingRequiredAnchorNodeNames.includes(nodeName),
        ),
        missingAnchorNodes: report.output.semanticInventory.missingRequiredAnchorNodeNames,
      },
      eyesAndGaze: {
        eyeGazeControlsPresent: report.output.embodimentRigging.eyeGazeControlsPresent,
        eyelidBlinkControlsPresent: report.output.embodimentRigging.eyelidBlinkControlsPresent,
        eyeGazeControlNodes: ["openclinxr_left_eye_gaze_control", "openclinxr_right_eye_gaze_control"],
        blinkControlNodes: ["openclinxr_left_upper_eyelid_blink_control", "openclinxr_right_upper_eyelid_blink_control"],
      },
      lipsAndVisemes: {
        lipSyncControlsPresent: report.output.embodimentRigging.lipSyncControlsPresent,
        runtimeDialogueLipSyncRequired: true,
        visemeMorphTargets: [...CANONICAL_HUMANOID_MORPH_TARGETS],
        morphTargetsObserved: report.output.semanticInventory.morphTargetNames,
        missingMorphTargets: report.output.semanticInventory.missingRequiredMorphTargetNames,
      },
      faceExpressionTransitions: {
        faceRigPresent: report.output.embodimentRigging.faceRigPresent,
        physicianInteractionTargetPresent: report.output.embodimentRigging.physicianInteractionTargetPresent,
        runtimeMorphTargetTransitionRequirement: true,
        expressionTransitionNodes: [
          "openclinxr_face_rig_root",
          "openclinxr_upper_lip_sync_control",
          "openclinxr_lower_lip_sync_control",
        ],
      },
      clothing: {
        clothingNodeCount: clothingNodeNames.length,
        clothingNodeNames,
        clothingEvidenceNodes,
      },
      poseLocomotionPosture: {
        hasAnimationCurves: report.output.semanticInventory.animationCount > 0,
        animationCount: report.output.semanticInventory.animationCount,
        primaryPostureIntent: "neutral-clinical-stand",
        locomotionProxyPosture: "asset_pose_static",
      },
      collisionAndProxyPosture: {
        ragdollCollisionProxyPresent: report.output.embodimentRigging.ragdollCollisionProxyPresent,
        ragdollCollisionNode: report.output.embodimentRigging.ragdollCollisionProxyPresent
          ? "openclinxr_ragdoll_collision_capsule"
          : null,
        physicianInteractionTargetPresent: report.output.embodimentRigging.physicianInteractionTargetPresent,
        physicianTargetNode: report.output.embodimentRigging.physicianInteractionTargetPresent
          ? "openclinxr_physician_interaction_target"
          : null,
      },
      sharedAssetLibraryReuse: {
        enabled: true,
        sharedLibraryRefs: [
          "shared-asset-library-lookup://ed_humanoid_realism__ed_chest_pain__neutral_generated_human__pose_libraries",
          "shared-asset-library-lookup://ed_humanoid_realism__ed_chest_pain__neutral_generated_human__expression_tracks",
        ],
        reuseProfile: "ed-clinical-humanoid-asset-family-v1",
        note: "Reuse pose and expression primitives from the shared ED humanoid realism catalog for consistency across actor variants.",
      },
    },
    caveats: [
      "Manifest records artifact-level realism support signals and does not assert production clinical validity.",
      "Locomotion posture evidence is based on GLB inventory and does not execute runtime walk/trot trajectories.",
    ],
  };
}

export function buildCanonicalSkeletonBindingReport(
  report: GeneratedHumanRiggingReport,
): CanonicalSkeletonBindingReport {
  const observedJoints = new Set(report.output.semanticInventory.skinJointNames);
  const blockers = report.output.semanticInventory.missingRequiredBoneNames.map(
    (boneName) => `canonical_bone_missing:${boneName}`,
  );

  return {
    schemaVersion: "openclinxr.canonical-skeleton-binding.v1",
    kind: "canonical_skeleton_binding",
    generatedAt: report.generatedAt,
    laneId: "generatedHumanRigging",
    actorSlug: "neutral-generated-human",
    armatureNodeName: "openclinxr_canonical_humanoid_armature",
    meshNodeName: "neutral_generated_human_skinned_mesh",
    sourceLicensePosture: "anny_apache_2_code_mpfb2_assets_license_recorded",
    productionAssetReadinessClaimed: false,
    bindings: CANONICAL_HUMANOID_BONES.map((boneName) => ({
      canonicalBoneName: boneName,
      gltfJointName: boneName,
      required: true,
      observed: observedJoints.has(boneName),
    })),
    verdict: {
      passed: blockers.length === 0,
      blockers,
    },
  };
}

export function buildSkinWeightQualityReport(report: GeneratedHumanRiggingReport): SkinWeightQualityReport {
  const missingAnchorNodeNames = report.output.semanticInventory.missingRequiredAnchorNodeNames;
  const missingRequiredBoneNames = report.output.semanticInventory.missingRequiredBoneNames;
  const blockers = [
    ...missingRequiredBoneNames.map((boneName) => `canonical_bone_missing:${boneName}`),
    ...missingAnchorNodeNames.map((nodeName) => `anchor_node_missing:${nodeName}`),
  ];

  if (report.output.semanticInventory.skinCount < 1) {
    blockers.push("glb_skin_missing");
  }

  return {
    schemaVersion: "openclinxr.skin-weight-quality.v1",
    kind: "skin_weight_quality",
    generatedAt: report.generatedAt,
    laneId: "generatedHumanRigging",
    actorSlug: "neutral-generated-human",
    evaluationMode: "deterministic_static_glb_inventory",
    productionAssetReadinessClaimed: false,
    metrics: {
      glbBytes: report.output.glbBytes,
      skinCount: report.output.semanticInventory.skinCount,
      requiredBoneCount: CANONICAL_HUMANOID_BONES.length,
      observedRequiredBoneCount: CANONICAL_HUMANOID_BONES.length - missingRequiredBoneNames.length,
      missingRequiredBoneNames,
      anchorNodeCount: CANONICAL_RIG_ANCHOR_NODES.length - missingAnchorNodeNames.length,
      missingRequiredAnchorNodeNames: missingAnchorNodeNames,
    },
    caveats: [
      "This is a deterministic local rigging fixture for pipeline hardening, not a production avatar.",
      "Static GLB inventory verifies skeleton and skin presence only; it does not verify animation quality or clinical realism.",
      "No third-party generated assets, cloud APIs, paid APIs, or production-readiness claims are introduced.",
    ],
    verdict: {
      passed: blockers.length === 0,
      blockers,
    },
  };
}

export function validateGeneratedHumanRiggingArtifactsReport(report: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(report)) {
    return { ok: false, errors: ["/ must be an object"] };
  }

  if (report.schemaVersion !== GENERATED_HUMAN_RIGGING_SCHEMA_VERSION) {
    errors.push(`/schemaVersion must be ${GENERATED_HUMAN_RIGGING_SCHEMA_VERSION}`);
  }
  if (report.kind !== GENERATED_HUMAN_RIGGING_KIND) {
    errors.push(`/kind must be ${GENERATED_HUMAN_RIGGING_KIND}`);
  }

  const policy = isRecord(report.policy) ? report.policy : {};
  if (policy.cloudApisUsed !== false) errors.push("/policy/cloudApisUsed must be false");
  if (policy.paidApisUsed !== false) errors.push("/policy/paidApisUsed must be false");
  if (policy.externalAssetsUsed !== false) errors.push("/policy/externalAssetsUsed must be false");
  if (policy.productionAssetReadinessClaimed !== false) {
    errors.push("/policy/productionAssetReadinessClaimed must be false");
  }

  const artifacts = isRecord(report.artifacts) ? report.artifacts : {};
  for (const key of [
    "glbPath",
    "annySourceObjPath",
    "annySourceManifestPath",
    "canonicalSkeletonBindingPath",
    "skinWeightQualityPath",
    "humanoidRealismManifestPath",
  ] as const) {
    if (typeof artifacts[key] !== "string" || artifacts[key].length === 0) {
      errors.push(`/artifacts/${key} must be a non-empty string`);
    }
  }
  const input = isRecord(report.input) ? report.input : {};
  if (input.preferredGeneratorToolId !== "anny") {
    errors.push("/input/preferredGeneratorToolId must be anny");
  }
  if (input.generationMode !== "anny_parametric_body_mesh_with_blender_canonical_rig") {
    errors.push("/input/generationMode must be anny_parametric_body_mesh_with_blender_canonical_rig");
  }

  const output = isRecord(report.output) ? report.output : {};
  const semanticInventory = isRecord(output.semanticInventory) ? output.semanticInventory : {};
  const embodimentRigging = isRecord(output.embodimentRigging) ? output.embodimentRigging : {};
  const missingRequiredBoneNames = asStringArray(semanticInventory.missingRequiredBoneNames);
  const missingRequiredAnchorNodeNames = asStringArray(semanticInventory.missingRequiredAnchorNodeNames);
  const missingRequiredEmbodimentNodeNames = asStringArray(semanticInventory.missingRequiredEmbodimentNodeNames);
  const missingRequiredMorphTargetNames = asStringArray(semanticInventory.missingRequiredMorphTargetNames);
  const skinCount = typeof semanticInventory.skinCount === "number" ? semanticInventory.skinCount : 0;
  const meshCount = typeof semanticInventory.meshCount === "number" ? semanticInventory.meshCount : 0;
  const magic = typeof output.magic === "string" ? output.magic : "";
  const version = typeof output.version === "number" ? output.version : 0;
  const declaredLength = typeof output.declaredLength === "number" ? output.declaredLength : 0;
  const glbBytes = typeof output.glbBytes === "number" ? output.glbBytes : 0;

  const expectedBlockers = [
    ...missingRequiredBoneNames.map((boneName) => `canonical_bone_missing:${boneName}`),
    ...missingRequiredAnchorNodeNames.map((nodeName) => `anchor_node_missing:${nodeName}`),
    ...missingRequiredEmbodimentNodeNames.map((nodeName) => `embodiment_node_missing:${nodeName}`),
    ...missingRequiredMorphTargetNames.map((targetName) => `morph_target_missing:${targetName}`),
  ];
  for (const key of [
    "faceRigPresent",
    "lipSyncControlsPresent",
    "eyeGazeControlsPresent",
    "eyelidBlinkControlsPresent",
    "ragdollCollisionProxyPresent",
    "physicianInteractionTargetPresent",
    "runtimeDialogueLipSyncRequired",
    "runtimeDialogueGazeRequired",
    "runtimeMorphTargetVisemeRequired",
  ] as const) {
    if (embodimentRigging[key] !== true) errors.push(`/output/embodimentRigging/${key} must be true`);
  }
  if (embodimentRigging.sourceGeneratorRequired !== "anny") {
    errors.push("/output/embodimentRigging/sourceGeneratorRequired must be anny");
  }

  if (magic !== "glTF") expectedBlockers.push("glb_magic_invalid");
  if (version !== 2) expectedBlockers.push("glb_version_invalid");
  if (declaredLength !== glbBytes) expectedBlockers.push("glb_declared_length_mismatch");
  if (meshCount < 1) expectedBlockers.push("glb_mesh_missing");
  if (skinCount < 1) expectedBlockers.push("glb_skin_missing");

  const verdict = isRecord(report.verdict) ? report.verdict : {};
  const verdictBlockers = asStringArray(verdict.blockers);
  for (const blocker of expectedBlockers) {
    if (!verdictBlockers.includes(blocker)) {
      errors.push(`/verdict/blockers must include ${blocker}`);
    }
  }

  const shouldPass = expectedBlockers.length === 0;
  if (verdict.passed !== shouldPass) {
    errors.push(`/verdict/passed must be ${shouldPass}`);
  }
  if (verdict.readyForProductionAssets !== false) {
    errors.push("/verdict/readyForProductionAssets must be false");
  }

  return { ok: errors.length === 0, errors };
}

export async function runGeneratedHumanRiggingArtifactsCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);

  if (options.help) {
    process.stdout.write(`${generatedHumanRiggingHelp()}\n`);
    return;
  }

  if (options.validateLatest || options.validatePath) {
    const validatePath = options.validateLatest ? defaultGeneratedHumanRiggingReportPath() : options.validatePath;
    if (!validatePath) {
      process.stderr.write("Missing generated human rigging report path.\n");
      process.exitCode = 1;
      return;
    }
    await validateReportFile(validatePath, { validateArtifacts: options.validateLatest });
    return;
  }

  const start = Date.now();
  const artifactPaths = generatedHumanRiggingArtifactPaths(options.outputRoot);
  await mkdir(artifactPaths.outputRoot, { recursive: true });
  const blenderVersion = await readBlenderVersion(options.blenderPath);
  const annySource = await prepareAnnySourceMesh(artifactPaths);
  await runBlenderRiggingBake({
    blenderPath: options.blenderPath,
    glbPath: artifactPaths.glb,
    sourceObjPath: annySource.objPath,
    bodyProfile: options.bodyProfile,
  });
  const glb = await readFile(artifactPaths.glb);
  const report = buildGeneratedHumanRiggingReportFromGlb({
    generatedAt: new Date().toISOString(),
    blenderVersion,
    elapsedMs: Date.now() - start,
    glb,
    outputRoot: artifactPaths.outputRoot,
    sourceGenerator: "anny",
    bodyProfile: options.bodyProfile,
  });
  const bindingReport = buildCanonicalSkeletonBindingReport(report);
  const qualityReport = buildSkinWeightQualityReport(report);
  const realismManifest = buildGeneratedHumanoidRealismManifest(report);

  await mkdir(path.dirname(path.resolve(options.reportPath)), { recursive: true });
  await writeFile(artifactPaths.canonicalSkeletonBinding, `${JSON.stringify(bindingReport, null, 2)}\n`, "utf8");
  await writeFile(artifactPaths.skinWeightQuality, `${JSON.stringify(qualityReport, null, 2)}\n`, "utf8");
  await writeFile(
    artifactPaths.humanoidRealismManifest,
    `${JSON.stringify(realismManifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const validation = validateGeneratedHumanRiggingArtifactsReport(report);
  if (!validation.ok) {
    process.stderr.write(`Generated human rigging report failed validation:\n${validation.errors.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Generated rigged humanoid artifacts: ${report.artifacts.glbPath}, ${report.artifacts.canonicalSkeletonBindingPath}, ${report.artifacts.skinWeightQualityPath}, ${report.artifacts.humanoidRealismManifestPath}\n`,
  );
}

async function validateReportFile(reportPath: string, options: { validateArtifacts: boolean }): Promise<void> {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  const validation = validateGeneratedHumanRiggingArtifactsReport(report);
  const errors = [...validation.errors];

  if (options.validateArtifacts && isRecord(report)) {
    const artifacts = isRecord(report.artifacts) ? report.artifacts : {};
    const artifactKeys = [
      "glbPath",
      "canonicalSkeletonBindingPath",
      "skinWeightQualityPath",
      "humanoidRealismManifestPath",
      "annySourceObjPath",
      "annySourceManifestPath",
    ] as const;
    for (const key of artifactKeys) {
      const artifactPath = artifacts[key];
      if (typeof artifactPath === "string" && !existsSync(path.resolve(artifactPath))) {
        errors.push(`/artifacts/${key} must point at an existing file for --validate-latest`);
      }
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`Generated human rigging report validation failed:\n${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}

async function prepareAnnySourceMesh(artifactPaths: ReturnType<typeof generatedHumanRiggingArtifactPaths>): Promise<{ objPath: string }> {
  // User "Try this" pipeline: delegate to the clean, documented local Anny stage.
  // This replaces the previous inline "import anny from special runtime" stub.
  // The new generate_mesh.py is self-contained for the stub (real PyTorch Anny drops in).
  // It produces exactly the ANNY_SOURCE_OBJ_NAME + ANNY_SOURCE_MANIFEST_NAME the rest of this
  // module and the runtime contract expect.
  const params = {
    age: 37,
    body_profile: "adult_standard",
    pose: "standing_neutral",
    phenotype: { skin_tone: "warm_light", hair_color: "brown", eye_color: "hazel", age_wrinkle: 0.5, bmi: 25, brow_tension: 0.6, anxious: 0.5 },
  };
  await execFileAsync("python3", [
    path.resolve("tools/openclinxr/asset-pipeline/anny/generate_mesh.py"),
    "--params", JSON.stringify(params),
    "--output", artifactPaths.annySourceObj,
    "--manifest", artifactPaths.annySourceManifest,
  ], { timeout: 120_000 });
  return { objPath: artifactPaths.annySourceObj };
}

async function runBlenderRiggingBake(options: { blenderPath: string; glbPath: string; sourceObjPath?: string; bodyProfile: GeneratedHumanRiggingBodyProfile }): Promise<void> {
  // User "Try this" pipeline: delegate the full headless Blender stage (import + rig + texturing + hair/eyes + export)
  // to the clean, documented automate_blender.py (or the orchestrator for the single-call experience).
  // This replaces the previous inline temp script generation (createGeneratedHumanRiggingBlenderScript).
  // The new script matches the exact flow in the proposal and produces a GLB that satisfies the
  // canonical contract used by the rest of this file and the runtime.
  const orchestrator = path.resolve("tools/openclinxr/asset-pipeline/anny/orchestrate_character.py");
  const isPed = options.bodyProfile.includes("pediatric") || options.bodyProfile.includes("child");
  // Case-driven phenotype scalars (from peds_asthma_parent_anxiety_v1 commProfile/roles + ed) for B+ iteration.
  // anxious_parent: stress age_wrinkle, flush, brow_tension for emotion start; child patient: small build.
  const pheno = isPed
    ? { skin_tone: "warm_light_child", hair_color: "light_brown", eye_color: "brown", age_wrinkle: 0.15, bmi: 17, build: "slender_asthma", brow_tension: 0.25, anxious: 0.35, flush: 0.1 }
    : { skin_tone: "warm_light", hair_color: "brown", eye_color: "hazel", age_wrinkle: 0.55, bmi: 25.5, build: "average", brow_tension: 0.65, anxious: 0.55, flush: 0.25 };
  const params = {
    age: isPed ? 8 : 37,
    body_profile: options.bodyProfile,
    pose: "standing_neutral",
    phenotype: pheno,
  };
  const caseId = isPed ? "peds_asthma_parent_anxiety_v1" : "ed_chest_pain_priority_v1";
  const actorRole = isPed ? "patient" : "patient";  // caller can override for parent/nurse variants

  // Prefer the single orchestrator call (does mesh if needed + full Blender stage). Now emits report with B grade.
  try {
    await execFileAsync("python3", [
      orchestrator,
      "--case-id", caseId,
      "--actor-role", actorRole,
      "--params-json", JSON.stringify(params),
      "--output-glb", options.glbPath,
    ], { timeout: BLENDER_RIGGING_COMMAND_TIMEOUT_MS * 2 });
    // Attach report for case pipeline (worker materialization, runtime-state player, review packets caseDerived asset expectations)
    try {
      const fsMod = await import("fs");
      const reportPath = options.glbPath.replace(/\.glb$/, "_rigging_report.json");
      if (fsMod.existsSync(reportPath)) {
        const rep = JSON.parse(fsMod.readFileSync(reportPath, "utf8"));
        (globalThis as any).__openClinXrLastHumanoidRiggingReport = rep;
        (globalThis as any).__openClinXrLastHumanoidGlb = options.glbPath;
        console.log(`[asset-pipeline] B+ humanoid report attached (realismGrade=${rep.realismGrade || "B"}): ${reportPath}`);
      }
    } catch {}
    return;
  } catch (e) {
    // Fall back to direct Blender call to the automate script (in case orchestrator Python path differs).
  }

  const blenderBin = options.blenderPath || "blender";
  const automate = path.resolve("tools/openclinxr/asset-pipeline/anny/automate_blender.py");
  const inputMesh = options.sourceObjPath || path.resolve("tools/openclinxr/asset-pipeline/anny/anny-neutral-generated-human.obj"); // may be produced by prepare step or seed
  const inputManifest = inputMesh.replace(/\.obj$/, "-manifest.json").replace(/\.glb$/, "-manifest.json");

  await execFileAsync(blenderBin, [
    "--background", "--python", automate, "--",
    "--input-mesh", inputMesh,
    "--input-manifest", inputManifest,
    "--output-glb", options.glbPath,
    "--case-id", isPed ? "peds_asthma_parent_anxiety_v1" : "ed_chest_pain_priority_v1",
    "--actor-role", isPed ? "patient" : "patient",
  ], { timeout: BLENDER_RIGGING_COMMAND_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 });
}

async function readBlenderVersion(blenderPath: string): Promise<string> {
  const { stdout } = await execFileAsync(blenderPath, ["--version"], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.split(/\r?\n/u)[0]?.trim() || "unknown";
}

function inspectGlb(glb: Buffer): GlbInspection {
  const magic = glb.length >= 4 ? glb.subarray(0, 4).toString("utf8") : "";
  const version = glb.length >= 8 ? glb.readUInt32LE(4) : 0;
  const declaredLength = glb.length >= 12 ? glb.readUInt32LE(8) : 0;
  const gltfJson = readGlbJsonChunk(glb);

  if (!gltfJson) {
    return {
      glbBytes: glb.length,
      magic,
      version,
      declaredLength,
      nodeCount: 0,
      meshCount: 0,
      skinCount: 0,
      materialCount: 0,
      animationCount: 0,
      nodeNames: [],
      skinJointNames: [],
      missingRequiredBoneNames: [...CANONICAL_HUMANOID_BONES],
      missingRequiredAnchorNodeNames: [...CANONICAL_RIG_ANCHOR_NODES],
      missingRequiredEmbodimentNodeNames: [...CANONICAL_HUMANOID_EMBODIMENT_NODES],
      morphTargetNames: [],
      missingRequiredMorphTargetNames: [...CANONICAL_HUMANOID_MORPH_TARGETS],
      jsonChunkMissing: true,
    };
  }

  const nodes = asRecordArray(gltfJson.nodes);
  const skins = asRecordArray(gltfJson.skins);
  const morphTargetNames = collectMorphTargetNames(asRecordArray(gltfJson.meshes));
  const nodeNames = nodes.map((node, index) => (typeof node.name === "string" ? node.name : `node_${index}`));
  const skinJointNames = collectSkinJointNames(nodes, skins);
  const skinJointNameSet = new Set(skinJointNames);
  const nodeNameSet = new Set(nodeNames);

  return {
    glbBytes: glb.length,
    magic,
    version,
    declaredLength,
    nodeCount: nodes.length,
    meshCount: Array.isArray(gltfJson.meshes) ? gltfJson.meshes.length : 0,
    skinCount: skins.length,
    materialCount: Array.isArray(gltfJson.materials) ? gltfJson.materials.length : 0,
    animationCount: Array.isArray(gltfJson.animations) ? gltfJson.animations.length : 0,
    nodeNames,
    skinJointNames,
    missingRequiredBoneNames: CANONICAL_HUMANOID_BONES.filter((boneName) => !skinJointNameSet.has(boneName)),
    missingRequiredAnchorNodeNames: CANONICAL_RIG_ANCHOR_NODES.filter((nodeName) => !nodeNameSet.has(nodeName)),
    missingRequiredEmbodimentNodeNames: CANONICAL_HUMANOID_EMBODIMENT_NODES.filter((nodeName) => !nodeNameSet.has(nodeName)),
    morphTargetNames,
    missingRequiredMorphTargetNames: CANONICAL_HUMANOID_MORPH_TARGETS.filter((targetName) => !morphTargetNames.includes(targetName)),
    jsonChunkMissing: false,
  };
}

function buildRiggingBlockers(inspection: GlbInspection): string[] {
  const blockers: string[] = [];

  if (inspection.magic !== "glTF") blockers.push("glb_magic_invalid");
  if (inspection.version !== 2) blockers.push("glb_version_invalid");
  if (inspection.declaredLength !== inspection.glbBytes) blockers.push("glb_declared_length_mismatch");
  if (inspection.jsonChunkMissing) blockers.push("glb_json_chunk_missing");
  if (inspection.meshCount < 1) blockers.push("glb_mesh_missing");
  if (inspection.skinCount < 1) blockers.push("glb_skin_missing");
  for (const boneName of inspection.missingRequiredBoneNames) {
    blockers.push(`canonical_bone_missing:${boneName}`);
  }
  for (const nodeName of inspection.missingRequiredAnchorNodeNames) {
    blockers.push(`anchor_node_missing:${nodeName}`);
  }
  for (const nodeName of inspection.missingRequiredEmbodimentNodeNames) {
    blockers.push(`embodiment_node_missing:${nodeName}`);
  }
  for (const targetName of inspection.missingRequiredMorphTargetNames) {
    blockers.push(`morph_target_missing:${targetName}`);
  }

  return blockers;
}

function readGlbJsonChunk(glb: Buffer): Record<string, unknown> | undefined {
  if (glb.length < 20 || glb.subarray(0, 4).toString("utf8") !== "glTF") {
    return undefined;
  }

  let offset = 12;
  while (offset + 8 <= glb.length) {
    const chunkLength = glb.readUInt32LE(offset);
    const chunkType = glb.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > glb.length) return undefined;
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(glb.subarray(chunkStart, chunkEnd).toString("utf8").trim()) as Record<string, unknown>;
    }
    offset = chunkEnd;
  }

  return undefined;
}

function collectSkinJointNames(nodes: Array<Record<string, unknown>>, skins: Array<Record<string, unknown>>): string[] {
  const names = new Set<string>();
  for (const skin of skins) {
    if (!Array.isArray(skin.joints)) continue;
    for (const joint of skin.joints) {
      if (typeof joint !== "number") continue;
      const node = nodes[joint];
      if (typeof node?.name === "string") {
        names.add(node.name);
      }
    }
  }
  return [...names].sort();
}

function collectMorphTargetNames(meshes: Array<Record<string, unknown>>): string[] {
  const names = new Set<string>();
  for (const mesh of meshes) {
    const extras = isRecord(mesh.extras) ? mesh.extras : {};
    for (const targetName of asStringArray(extras.targetNames)) {
      names.add(targetName);
    }
  }
  return [...names].sort();
}

function createGeneratedHumanRiggingBlenderScript(): string {
  return String.raw`
import json
import os
import sys
import bpy

def load_config():
    args = sys.argv
    if "--" not in args:
        raise RuntimeError("Missing -- config path")
    config_path = args[args.index("--") + 1]
    with open(config_path, "r", encoding="utf-8") as handle:
        return json.load(handle)

def make_material(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    return material

def create_bone(edit_bones, name, head, tail, parent=None):
    bone = edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    if parent is not None:
        bone.parent = parent
    return bone

def add_box(vertices, faces, vertex_bones, face_materials, min_corner, max_corner, bone_name, material_index):
    base = len(vertices)
    x0, y0, z0 = min_corner
    x1, y1, z1 = max_corner
    vertices.extend([
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ])
    faces.extend([
        (base + 0, base + 1, base + 2, base + 3),
        (base + 4, base + 7, base + 6, base + 5),
        (base + 0, base + 4, base + 5, base + 1),
        (base + 1, base + 5, base + 6, base + 2),
        (base + 2, base + 6, base + 7, base + 3),
        (base + 3, base + 7, base + 4, base + 0),
    ])
    vertex_bones.extend([bone_name] * 8)
    face_materials.extend([material_index] * 6)

def load_obj_mesh(obj_path):
    vertices = []
    faces = []
    with open(obj_path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith("v "):
                _, x, y, z = line.split()[:4]
                vertices.append((float(x), float(y), float(z)))
            elif line.startswith("f "):
                indices = []
                for token in line.split()[1:]:
                    indices.append(int(token.split("/")[0]) - 1)
                if len(indices) >= 3:
                    faces.append(tuple(indices[:3]))
    return vertices, faces

def normalize_anny_vertices(vertices):
    if not vertices:
        return []
    min_x = min(v[0] for v in vertices)
    max_x = max(v[0] for v in vertices)
    min_y = min(v[1] for v in vertices)
    max_y = max(v[1] for v in vertices)
    min_z = min(v[2] for v in vertices)
    max_z = max(v[2] for v in vertices)
    height = max(max_z - min_z, 0.001)
    scale = 1.84 / height
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    return [((x - center_x) * scale, (y - center_y) * scale, (z - min_z) * scale + 0.03) for x, y, z in vertices]

def apply_body_profile(vertices, body_profile):
    profile_scales = {
        "adult_standard": (1.0, 1.0, 1.0),
        "pediatric_school_age": (0.74, 0.74, 0.78),
        "older_adult_kyphotic": (0.94, 0.98, 0.92),
        "bariatric_adult": (1.28, 1.18, 0.96),
    }
    sx, sy, sz = profile_scales.get(body_profile, profile_scales["adult_standard"])
    adjusted = []
    for x, y, z in vertices:
        next_y = y * sy
        next_z = z * sz
        if body_profile == "older_adult_kyphotic" and z > 1.18:
            next_y += min((z - 1.18) * 0.10, 0.06)
        adjusted.append((x * sx, next_y, next_z))
    return adjusted

def canonical_bone_for_vertex(vertex):
    x, y, z = vertex
    if z < 0.16:
        return "foot.L" if x >= 0 else "foot.R"
    if z < 0.50:
        return "shin.L" if x >= 0 else "shin.R"
    if z < 0.88:
        return "thigh.L" if x >= 0 else "thigh.R"
    if abs(x) > 0.70 and z < 1.24:
        return "hand.L" if x >= 0 else "hand.R"
    if abs(x) > 0.48 and z < 1.36:
        return "forearm.L" if x >= 0 else "forearm.R"
    if abs(x) > 0.24 and z < 1.54:
        return "upper_arm.L" if x >= 0 else "upper_arm.R"
    if z < 1.06:
        return "pelvis"
    if z < 1.31:
        return "spine"
    if z < 1.53:
        return "chest"
    if z < 1.66:
        return "neck"
    return "head"

def material_for_face(vertices, face):
    avg_z = sum(vertices[index][2] for index in face) / len(face)
    if avg_z < 0.16:
        return 2
    if 0.84 <= avg_z <= 1.53:
        return 1
    return 0

config = load_config()
glb_path = config["glbPath"]
body_profile = config.get("bodyProfile", "adult_standard")
os.makedirs(os.path.dirname(glb_path), exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

skin = make_material("reviewed_local_fixture_skin", (0.72, 0.51, 0.39, 1.0))
scrubs = make_material("reviewed_local_fixture_scrubs", (0.07, 0.35, 0.43, 1.0))
shoes = make_material("reviewed_local_fixture_shoes", (0.05, 0.05, 0.05, 1.0))
hair = make_material("reviewed_local_fixture_hair", (0.08, 0.045, 0.025, 1.0))
eye_white = make_material("reviewed_local_fixture_eye_white", (0.92, 0.96, 1.0, 1.0))
eye_pupil = make_material("reviewed_local_fixture_eye_pupil", (0.02, 0.03, 0.04, 1.0))

bpy.ops.object.armature_add(enter_editmode=True, align="WORLD", location=(0, 0, 0))
armature = bpy.context.object
armature.name = "openclinxr_canonical_humanoid_armature"
armature.data.name = "openclinxr_canonical_humanoid_skeleton"
armature.show_in_front = True
edit_bones = armature.data.edit_bones
edit_bones.remove(edit_bones[0])

pelvis = create_bone(edit_bones, "pelvis", (0, 0, 0.86), (0, 0, 1.05))
spine = create_bone(edit_bones, "spine", (0, 0, 1.05), (0, 0, 1.30), pelvis)
chest = create_bone(edit_bones, "chest", (0, 0, 1.30), (0, 0, 1.52), spine)
neck = create_bone(edit_bones, "neck", (0, 0, 1.52), (0, 0, 1.66), chest)
create_bone(edit_bones, "head", (0, 0, 1.66), (0, 0, 1.88), neck)
upper_arm_l = create_bone(edit_bones, "upper_arm.L", (0.18, 0, 1.45), (0.52, 0, 1.32), chest)
forearm_l = create_bone(edit_bones, "forearm.L", (0.52, 0, 1.32), (0.78, 0, 1.14), upper_arm_l)
create_bone(edit_bones, "hand.L", (0.78, 0, 1.14), (0.93, 0, 1.05), forearm_l)
upper_arm_r = create_bone(edit_bones, "upper_arm.R", (-0.18, 0, 1.45), (-0.52, 0, 1.32), chest)
forearm_r = create_bone(edit_bones, "forearm.R", (-0.52, 0, 1.32), (-0.78, 0, 1.14), upper_arm_r)
create_bone(edit_bones, "hand.R", (-0.78, 0, 1.14), (-0.93, 0, 1.05), forearm_r)
thigh_l = create_bone(edit_bones, "thigh.L", (0.10, 0, 0.86), (0.12, 0, 0.48), pelvis)
shin_l = create_bone(edit_bones, "shin.L", (0.12, 0, 0.48), (0.13, 0, 0.14), thigh_l)
create_bone(edit_bones, "foot.L", (0.13, 0, 0.14), (0.24, -0.12, 0.05), shin_l)
thigh_r = create_bone(edit_bones, "thigh.R", (-0.10, 0, 0.86), (-0.12, 0, 0.48), pelvis)
shin_r = create_bone(edit_bones, "shin.R", (-0.12, 0, 0.48), (-0.13, 0, 0.14), thigh_r)
create_bone(edit_bones, "foot.R", (-0.13, 0, 0.14), (-0.24, -0.12, 0.05), shin_r)

bpy.ops.object.mode_set(mode="OBJECT")

vertices = []
faces = []
vertex_bones = []
face_materials = []
source_obj_path = config.get("sourceObjPath")
if source_obj_path and os.path.exists(source_obj_path):
    vertices, faces = load_obj_mesh(source_obj_path)
    vertices = normalize_anny_vertices(vertices)
    vertices = apply_body_profile(vertices, body_profile)
    vertex_bones = [canonical_bone_for_vertex(vertex) for vertex in vertices]
    face_materials = [material_for_face(vertices, face) for face in faces]
else:
    raise RuntimeError("Anny source OBJ is required; legacy Blender humanoid fixture fallback is disabled")

mesh = bpy.data.meshes.new("neutral_generated_human_skinned_mesh_data")
mesh.from_pydata(vertices, [], faces)
mesh.update()
humanoid = bpy.data.objects.new("neutral_generated_human_skinned_mesh", mesh)
bpy.context.collection.objects.link(humanoid)
humanoid.data.materials.append(skin)
humanoid.data.materials.append(scrubs)
humanoid.data.materials.append(shoes)
for index, material_index in enumerate(face_materials):
    humanoid.data.polygons[index].material_index = material_index

humanoid.shape_key_add(name="Basis")
for target_name in ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"]:
    shape_key = humanoid.shape_key_add(name=target_name)
    for vertex in humanoid.data.vertices:
        base = vertex.co
        adjusted = shape_key.data[vertex.index].co
        if target_name == "openclinxr_mouth_open" and 1.62 <= base.z <= 1.74 and abs(base.x) <= 0.12 and base.y <= 0.04:
            adjusted.y -= 0.018
            adjusted.z -= 0.012
        elif target_name == "openclinxr_brow_concern" and 1.74 <= base.z <= 1.88 and abs(base.x) <= 0.16 and base.y <= 0.05:
            adjusted.x *= 0.94
            adjusted.z += 0.010
        elif target_name == "openclinxr_cheek_tension" and 1.64 <= base.z <= 1.78 and 0.08 <= abs(base.x) <= 0.20 and base.y <= 0.06:
            adjusted.x *= 1.025
            adjusted.y -= 0.010
humanoid.data["openclinxr_morph_target_contract"] = "mouth_open,brow_concern,cheek_tension"

vertex_groups = {}
for bone_name in ${JSON.stringify(CANONICAL_HUMANOID_BONES)}:
    vertex_groups[bone_name] = humanoid.vertex_groups.new(name=bone_name)
for vertex_index, bone_name in enumerate(vertex_bones):
    vertex_groups[bone_name].add([vertex_index], 1.0, "REPLACE")

modifier = humanoid.modifiers.new("canonical_humanoid_armature", "ARMATURE")
modifier.object = armature
humanoid.parent = armature
humanoid["openclinxr_artifact_lane"] = "generatedHumanRigging"
humanoid["openclinxr_claim_boundary"] = "local_fixture_not_production_avatar"
armature["openclinxr_canonical_bone_count"] = len(${JSON.stringify(CANONICAL_HUMANOID_BONES)})

def add_accessory_box(name, location, scale, material, role):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    obj.parent = armature
    obj["openclinxr_artifact_lane"] = "generatedHumanRigging"
    obj["openclinxr_visual_role"] = role
    return obj

def add_accessory_sphere(name, location, scale, material, role):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    obj.parent = armature
    obj["openclinxr_artifact_lane"] = "generatedHumanRigging"
    obj["openclinxr_visual_role"] = role
    return obj

add_accessory_box("local_fixture_scrub_tunic", (0, -0.012, 1.18), (0.48, 0.18, 0.42), scrubs, "visible_clothing_tunic")
add_accessory_box("local_fixture_scrub_pants_left", (0.115, -0.006, 0.58), (0.17, 0.14, 0.58), scrubs, "visible_clothing_pants")
add_accessory_box("local_fixture_scrub_pants_right", (-0.115, -0.006, 0.58), (0.17, 0.14, 0.58), scrubs, "visible_clothing_pants")
add_accessory_box("local_fixture_left_shoe", (0.155, -0.105, 0.06), (0.24, 0.24, 0.08), shoes, "visible_shoes")
add_accessory_box("local_fixture_right_shoe", (-0.155, -0.105, 0.06), (0.24, 0.24, 0.08), shoes, "visible_shoes")
add_accessory_sphere("local_fixture_hair_cap", (0, 0.025, 1.83), (0.155, 0.12, 0.075), hair, "visible_hair")
add_accessory_sphere("local_fixture_left_eye", (0.055, -0.125, 1.765), (0.026, 0.012, 0.018), eye_white, "visible_eye")
add_accessory_sphere("local_fixture_right_eye", (-0.055, -0.125, 1.765), (0.026, 0.012, 0.018), eye_white, "visible_eye")
add_accessory_sphere("local_fixture_left_pupil", (0.055, -0.137, 1.765), (0.010, 0.005, 0.008), eye_pupil, "visible_eye_pupil")
add_accessory_sphere("local_fixture_right_pupil", (-0.055, -0.137, 1.765), (0.010, 0.005, 0.008), eye_pupil, "visible_eye_pupil")
add_accessory_box("openclinxr_face_rig_root", (0, -0.145, 1.735), (0.18, 0.018, 0.08), eye_pupil, "face_rig_root")
add_accessory_box("openclinxr_upper_lip_sync_control", (0, -0.154, 1.700), (0.105, 0.012, 0.012), eye_pupil, "lip_sync_upper_control")
add_accessory_box("openclinxr_lower_lip_sync_control", (0, -0.156, 1.678), (0.115, 0.012, 0.012), eye_pupil, "lip_sync_lower_control")
add_accessory_box("openclinxr_left_eye_gaze_control", (0.055, -0.155, 1.765), (0.036, 0.008, 0.018), eye_pupil, "eye_gaze_control")
add_accessory_box("openclinxr_right_eye_gaze_control", (-0.055, -0.155, 1.765), (0.036, 0.008, 0.018), eye_pupil, "eye_gaze_control")
add_accessory_box("openclinxr_left_upper_eyelid_blink_control", (0.055, -0.151, 1.779), (0.038, 0.006, 0.006), eye_pupil, "eyelid_blink_control")
add_accessory_box("openclinxr_right_upper_eyelid_blink_control", (-0.055, -0.151, 1.779), (0.038, 0.006, 0.006), eye_pupil, "eyelid_blink_control")
ragdoll = add_accessory_box("openclinxr_ragdoll_collision_capsule", (0, 0, 0.98), (0.5, 0.36, 1.72), eye_pupil, "ragdoll_collision_proxy")
ragdoll.display_type = "WIRE"
ragdoll.hide_render = True
interaction = add_accessory_box("openclinxr_physician_interaction_target", (0, -0.22, 1.18), (0.42, 0.035, 0.92), eye_pupil, "physician_interaction_target")
interaction.display_type = "WIRE"
interaction.hide_render = True

for name, location in [
    ("patient_robert_hayes_canonical_skeleton_anchor", (0, 0, 0.86)),
    ("nurse_maria_alvarez_canonical_skeleton_anchor", (0.75, 0.35, 0.86)),
]:
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=location)
    anchor = bpy.context.object
    anchor.name = name
    anchor["openclinxr_role"] = "canonical_skeleton_anchor"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", export_skins=True, export_animations=False)
`;
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    outputRoot: GENERATED_HUMAN_RIGGING_OUTPUT_DIR,
    reportPath: defaultGeneratedHumanRiggingReportPath(),
    blenderPath: process.env.BLENDER ?? "blender",
    bodyProfile: "adult_standard",
    validateLatest: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextValue = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--output-root") options.outputRoot = nextValue();
    else if (arg === "--report" || arg === "--output") options.reportPath = nextValue();
    else if (arg === "--blender") options.blenderPath = nextValue();
    else if (arg === "--body-profile") options.bodyProfile = parseBodyProfile(nextValue());
    else if (arg === "--validate") options.validatePath = nextValue();
    else if (arg === "--validate-latest") options.validateLatest = true;
    else throw new Error(`Unknown generated human rigging option: ${arg}`);
  }

  return options;
}

function generatedHumanRiggingHelp(): string {
  return [
    "Usage: tsx tools/openclinxr/generated-human-rigging-artifacts.ts [options]",
    "",
    "Options:",
    "  --output-root <path>   Directory for neutral-generated-human.glb and companion reports.",
    "  --report <path>        Summary report path.",
    "  --blender <path>       Blender executable path. Defaults to BLENDER or blender.",
    `  --body-profile <id>    Body profile: ${GENERATED_HUMAN_RIGGING_BODY_PROFILES.join(", ")}.`,
    "  --validate <path>      Validate one summary report without launching Blender.",
    "  --validate-latest      Validate today's default summary report and artifact paths.",
  ].join("\n");
}

function parseBodyProfile(value: string): GeneratedHumanRiggingBodyProfile {
  if ((GENERATED_HUMAN_RIGGING_BODY_PROFILES as readonly string[]).includes(value)) {
    return value as GeneratedHumanRiggingBodyProfile;
  }
  throw new Error(`Unknown generated human body profile: ${value}`);
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRepoRelativePath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  runGeneratedHumanRiggingArtifactsCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
