import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeEncounterRuntimeAssetBundle } from "../../../packages/openclinxr/asset-registry/src/asset-writer.js";
import { createAzuriteAssetObjectStore } from "../../../packages/openclinxr/asset-registry/src/object-store.js";
import type { RuntimeAssetReviewDecision } from "../../../packages/openclinxr/asset-registry/src/runtime-asset-review.js";
import {
  buildEncounterRuntimeAssetBundle,
  type EncounterRuntimeAssetBundle,
  type LearnerRuntimeAssetBundle,
  type RuntimeAssetStoreConfig,
  registerGeneratedRuntimeAssetReference,
  resolveRuntimeAssetStoreConfig,
  toLearnerRuntimeAssetBundle,
} from "../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import { buildEnvironmentRuntimeAssetReference, defaultEnvironmentArtifactsReportPath, type EnvironmentArtifactsReport } from "../evidence/environment-artifacts.js";
import { buildGeneratedHumanRiggingRuntimeAssetReference, defaultGeneratedHumanRiggingReportPath, type GeneratedHumanRiggingReport } from "./generated-human-rigging-artifacts.js";
import { buildMedicalEquipmentRuntimeAssetReferences, defaultMedicalEquipmentReportPath, type MedicalEquipmentArtifactsReport } from "../evidence/medical-equipment-artifacts.js";

export type GeneratedEdStationRuntimeBundleReport = {
  schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1";
  generatedAt: string;
  status: "bundle_ready" | "not_configured" | "blocked";
  bundle: EncounterRuntimeAssetBundle | null;
  learnerBundle: LearnerRuntimeAssetBundle | null;
  actorHumanoidMaterializationContract: {
    schemaVersion: "openclinxr.actor-humanoid-materialization-contract.v1";
    scenarioId: string | null;
    source: "generated_station_runtime_bundle";
    actorSpecificVariantKeysRequired: boolean;
    sharedNeutralMeshReuseDetected: boolean;
    sharedNeutralMeshReuseActorIds: string[];
    actorVariants: Array<{
      actorId: string;
      actorRole: string;
      modelAssetId: string;
      variantSemanticKey: string;
      sourceBlobName: string;
      humanoidVariantProfile: {
        ageBand: "child" | "adult";
        bodyScale: "small_child" | "adult_standard";
        hairFaceRequired: true;
        clothingLayer: "patient_gown" | "clinical_scrubs" | "civilian_family" | "role_specific";
        faceEyeLipRigRequired: true;
        idlePoseRequired: true;
        locomotionRequired: boolean;
      };
      requiredMaterializationCueIds: string[];
    }>;
    materializationBlockers: string[];
    caveats: string[];
    recommendedNextAction: string;
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "animation_quality"];
  } | null;
  equipmentMaterializationContract: {
    schemaVersion: "openclinxr.equipment-materialization-contract.v1";
    scenarioId: string | null;
    source: "generated_station_runtime_bundle";
    equipmentSpecificVariantKeysRequired: boolean;
    genericEquipmentReuseDetected: boolean;
    genericEquipmentReuseEquipmentIds: string[];
    equipmentVariants: Array<{
      equipmentId: string;
      modelAssetId: string;
      variantSemanticKey: string;
      sourceBlobName: string;
      equipmentVariantProfile: {
        equipmentFamily: string;
        pediatricUseRequired: boolean;
        scenarioPlacementRequired: true;
        scaleValidationRequired: true;
        interactionAffordanceRequired: boolean;
      };
      requiredMaterializationCueIds: string[];
      requiredEvidenceRefs: string[];
    }>;
    materializationBlockers: string[];
    caveats: string[];
    recommendedNextAction: string;
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
  } | null;
  bundleBlobName: string | null;
  runtimeAssetReviewDecisions: RuntimeAssetReviewDecision[];
  blockers: string[];
  productionCloudCall: false;
  notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
};

type CliOptions = {
  humanReportPath: string;
  equipmentReportPath: string;
  environmentReportPath: string;
  runtimeAssetReviewDecisionsPath: string | null;
  scenarioId: string;
  outputPath: string;
  writeAzurite: boolean;
  validateLatest: boolean;
  help: boolean;
};

const NOT_EVIDENCE_FOR = ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"] as const;

export function defaultGeneratedEdStationRuntimeBundleReportPath(date = new Date()): string {
  return path.join("docs/openclinxr", `generated-ed-station-runtime-bundle-${date.toISOString().slice(0, 10)}.json`);
}

export async function runGeneratedEdStationRuntimeBundleCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }
  if (options.validateLatest) {
    const reportValue = JSON.parse(await readFile(options.outputPath, "utf8")) as unknown;
    const validation = validateGeneratedEdStationRuntimeBundleReport(reportValue);
    if (!validation.ok) {
      process.stderr.write(`Generated ED station runtime bundle validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
    }
    return;
  }

  const reportValue = await buildGeneratedEdStationRuntimeBundleReport(options);
  await mkdir(path.dirname(path.resolve(options.outputPath)), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(reportValue, null, 2)}\n`, "utf8");
  const validation = validateGeneratedEdStationRuntimeBundleReport(reportValue);
  if (!validation.ok) {
    process.stderr.write(`Generated ED station runtime bundle validation failed:\n${validation.errors.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Generated ED station runtime bundle status: ${reportValue.status}\n`);
}

export async function buildGeneratedEdStationRuntimeBundleReport(input: {
  humanReportPath: string;
  equipmentReportPath: string;
  environmentReportPath: string;
  scenarioId?: string | undefined;
  runtimeAssetReviewDecisionsPath?: string | null | undefined;
  writeAzurite?: boolean | undefined;
}): Promise<GeneratedEdStationRuntimeBundleReport> {
  const missing = [
    ["human_report_missing", input.humanReportPath],
    ["equipment_report_missing", input.equipmentReportPath],
    ["environment_report_missing", input.environmentReportPath],
  ].filter(([, filePath]) => !existsSync(path.resolve(filePath)));
  if (missing.length > 0) {
    return report({ status: "not_configured", bundle: null, learnerBundle: null, bundleBlobName: null, blockers: missing.map(([blocker, filePath]) => `${blocker}:${filePath}`) });
  }

  const assetStore = resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" });
  const humanReport = JSON.parse(await readFile(input.humanReportPath, "utf8")) as GeneratedHumanRiggingReport;
  const equipmentReport = JSON.parse(await readFile(input.equipmentReportPath, "utf8")) as MedicalEquipmentArtifactsReport;
  const environmentReport = JSON.parse(await readFile(input.environmentReportPath, "utf8")) as EnvironmentArtifactsReport;
  const runtimeAssetReviewDecisions = input.runtimeAssetReviewDecisionsPath
    ? parseRuntimeAssetReviewDecisions(JSON.parse(await readFile(input.runtimeAssetReviewDecisionsPath, "utf8")) as unknown)
    : [];
  const patientModel = buildGeneratedHumanRiggingRuntimeAssetReference(humanReport, assetStore);
  const equipmentAssets = buildMedicalEquipmentRuntimeAssetReferences(equipmentReport, assetStore);
  const baseEnvironment = buildEnvironmentRuntimeAssetReference(environmentReport, assetStore);
  const blockedAssets = [patientModel, baseEnvironment, ...equipmentAssets].filter((asset) => asset.reviewStatus === "blocked").map((asset) => `asset_blocked:${asset.assetId}`);
  const preset = scenarioRuntimePreset(input.scenarioId ?? "ed_chest_pain_priority_v1");
  const environment = {
    ...baseEnvironment,
    assetId: `openclinxr.${preset.scenarioId}.environment.generated-glb`,
    displayName: `${preset.scenarioId.replace(/_v\d+$/u, "").replaceAll("_", " ")} environment`,
    scenarioAssetId: `${preset.scenarioId}:environment`,
  };
  const bundle = buildEncounterRuntimeAssetBundle({
    bundleId: `local_exam_run:${preset.encounterId}:generated-runtime-assets`,
    tenantId: "local-dev-tenant",
    userId: "quest3_local_learner",
    examRunId: `local_exam_run_${preset.scenarioId}`,
    encounterId: preset.encounterId,
    stationId: preset.stationId,
    scenarioId: preset.scenarioId,
    assetStore,
    environment,
    actors: preset.actors.map((actor) => ({
      actorId: actor.actorId,
      embodiment: runtimeActorEmbodiment(actor),
      role: actor.role,
      model: {
        ...patientModel,
        assetId: `openclinxr.${preset.scenarioId}.${actor.actorId}.generated-humanoid-glb`,
        displayName: actor.actorId.replace(/_v\d+$/u, "").replaceAll("_", " "),
        scenarioAssetId: actor.scenarioAssetId,
      },
      animationClips: runtimeActorAnimationClipAssets(preset.scenarioId, actor.actorId, assetStore),
      phonemeMap: runtimeActorPhonemeMapAsset(preset.scenarioId, actor.actorId, assetStore),
      gazeProfile: { defaultTarget: "learner_camera", supportsActorTargets: true },
    })),
    equipment: preset.equipment.map((equipment, index) => {
      const model = requiredAsset(equipmentAssets, index % equipmentAssets.length);
      return {
        equipmentId: equipment,
        model: {
          ...model,
          assetId: `openclinxr.${preset.scenarioId}.${equipment}.generated-glb`,
          displayName: equipment.replace(/_equipment$/u, "").replaceAll("_", " "),
          scenarioAssetId: `${preset.scenarioId}:${equipment}`,
        },
      };
    }),
    sceneManifest: createScenarioRuntimeSceneManifest(preset),
    generatedAt: new Date().toISOString(),
  });

  const learnerBundle = toLearnerRuntimeAssetBundle(bundle);
  const actorHumanoidMaterializationContract = buildActorHumanoidMaterializationContract(bundle);
  const equipmentMaterializationContract = buildEquipmentMaterializationContract(bundle);

  if (blockedAssets.length > 0) return report({ status: "blocked", bundle, learnerBundle, actorHumanoidMaterializationContract, equipmentMaterializationContract, bundleBlobName: null, blockers: blockedAssets, runtimeAssetReviewDecisions });
  if (input.writeAzurite) {
    const accountKey = process.env.AZURITE_ACCOUNT_KEY || process.env.OPENCLINXR_AZURITE_ACCOUNT_KEY;
    if (!accountKey) return report({ status: "not_configured", bundle, learnerBundle, actorHumanoidMaterializationContract, equipmentMaterializationContract, bundleBlobName: null, blockers: ["azurite_account_key_missing"], runtimeAssetReviewDecisions });
    const result = await writeEncounterRuntimeAssetBundle({ store: createAzuriteAssetObjectStore({ accountKey }), bundle });
    return report({ status: "bundle_ready", bundle, learnerBundle, actorHumanoidMaterializationContract, equipmentMaterializationContract, bundleBlobName: result.bundleBlobName, blockers: [], runtimeAssetReviewDecisions });
  }
  return report({ status: "bundle_ready", bundle, learnerBundle, actorHumanoidMaterializationContract, equipmentMaterializationContract, bundleBlobName: null, blockers: [], runtimeAssetReviewDecisions });
}

export function validateGeneratedEdStationRuntimeBundleReport(reportValue: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(reportValue)) return { ok: false, errors: ["/ must be an object"] };
  if (reportValue.schemaVersion !== "openclinxr.generated-ed-station-runtime-bundle.v1") errors.push("/schemaVersion invalid");
  if (!["bundle_ready", "not_configured", "blocked"].includes(String(reportValue.status))) errors.push("/status invalid");
  if (reportValue.productionCloudCall !== false) errors.push("/productionCloudCall must be false");
  if (!Array.isArray(reportValue.runtimeAssetReviewDecisions)) errors.push("/runtimeAssetReviewDecisions must be an array");
  else {
    reportValue.runtimeAssetReviewDecisions.forEach((decision, index) => {
      if (!isRuntimeAssetReviewDecision(decision)) errors.push(`/runtimeAssetReviewDecisions/${index} invalid`);
    });
  }
  const notEvidenceFor = Array.isArray(reportValue.notEvidenceFor) ? reportValue.notEvidenceFor : [];
  for (const required of NOT_EVIDENCE_FOR) if (!notEvidenceFor.includes(required)) errors.push(`/notEvidenceFor must include ${required}`);
  if (reportValue.status === "bundle_ready") {
    const bundle = isRecord(reportValue.bundle) ? reportValue.bundle : null;
    const learnerBundle = isRecord(reportValue.learnerBundle) ? reportValue.learnerBundle : null;
    if (!bundle) errors.push("/bundle required when bundle_ready");
    if (bundle && bundle.assetStoreKind !== "azurite_blob") errors.push("/bundle/assetStoreKind must be azurite_blob");
    if (!learnerBundle) errors.push("/learnerBundle required when bundle_ready");
    if (!isRecord(reportValue.actorHumanoidMaterializationContract)) errors.push("/actorHumanoidMaterializationContract required when bundle_ready");
    else {
      if (reportValue.actorHumanoidMaterializationContract.schemaVersion !== "openclinxr.actor-humanoid-materialization-contract.v1") {
        errors.push("/actorHumanoidMaterializationContract/schemaVersion invalid");
      }
      if (reportValue.actorHumanoidMaterializationContract.actorSpecificVariantKeysRequired !== true) {
        errors.push("/actorHumanoidMaterializationContract/actorSpecificVariantKeysRequired must be true");
      }
      if (reportValue.actorHumanoidMaterializationContract.sharedNeutralMeshReuseDetected === true) {
        const materializationBlockers = Array.isArray(reportValue.actorHumanoidMaterializationContract.materializationBlockers)
          ? reportValue.actorHumanoidMaterializationContract.materializationBlockers
          : [];
        const caveats = Array.isArray(reportValue.actorHumanoidMaterializationContract.caveats)
          ? reportValue.actorHumanoidMaterializationContract.caveats
          : [];
        if (materializationBlockers.length === 0) errors.push("/actorHumanoidMaterializationContract/materializationBlockers required when shared neutral mesh reuse is detected");
        if (caveats.length === 0) errors.push("/actorHumanoidMaterializationContract/caveats required when shared neutral mesh reuse is detected");
      }
      const actorVariants = Array.isArray(reportValue.actorHumanoidMaterializationContract.actorVariants)
        ? reportValue.actorHumanoidMaterializationContract.actorVariants
        : [];
      if (actorVariants.length === 0) errors.push("/actorHumanoidMaterializationContract/actorVariants must not be empty");
      actorVariants.forEach((variant, index) => {
        if (!isRecord(variant)) {
          errors.push(`/actorHumanoidMaterializationContract/actorVariants/${index} must be an object`);
          return;
        }
        if (typeof variant.actorId !== "string" || variant.actorId.length === 0) errors.push(`/actorHumanoidMaterializationContract/actorVariants/${index}/actorId required`);
        if (typeof variant.variantSemanticKey !== "string" || !variant.variantSemanticKey.includes(":anny_humanoid_variant")) {
          errors.push(`/actorHumanoidMaterializationContract/actorVariants/${index}/variantSemanticKey must be actor-specific Anny variant key`);
        }
        if (!isRecord(variant.humanoidVariantProfile)) {
          errors.push(`/actorHumanoidMaterializationContract/actorVariants/${index}/humanoidVariantProfile required`);
        } else {
          if (variant.humanoidVariantProfile.hairFaceRequired !== true) errors.push(`/actorHumanoidMaterializationContract/actorVariants/${index}/humanoidVariantProfile/hairFaceRequired must be true`);
          if (variant.humanoidVariantProfile.faceEyeLipRigRequired !== true) errors.push(`/actorHumanoidMaterializationContract/actorVariants/${index}/humanoidVariantProfile/faceEyeLipRigRequired must be true`);
          if (variant.humanoidVariantProfile.idlePoseRequired !== true) errors.push(`/actorHumanoidMaterializationContract/actorVariants/${index}/humanoidVariantProfile/idlePoseRequired must be true`);
        }
        const cueIds = Array.isArray(variant.requiredMaterializationCueIds) ? variant.requiredMaterializationCueIds : [];
        for (const cueId of ["actor_specific_body_profile_required", "actor_specific_clothing_required", "actor_specific_hair_face_required", "actor_specific_rig_preservation_required"]) {
          if (!cueIds.includes(cueId)) errors.push(`/actorHumanoidMaterializationContract/actorVariants/${index}/requiredMaterializationCueIds must include ${cueId}`);
        }
      });
    }
    if (!isRecord(reportValue.equipmentMaterializationContract)) errors.push("/equipmentMaterializationContract required when bundle_ready");
    else {
      if (reportValue.equipmentMaterializationContract.schemaVersion !== "openclinxr.equipment-materialization-contract.v1") {
        errors.push("/equipmentMaterializationContract/schemaVersion invalid");
      }
      if (reportValue.equipmentMaterializationContract.equipmentSpecificVariantKeysRequired !== true) {
        errors.push("/equipmentMaterializationContract/equipmentSpecificVariantKeysRequired must be true");
      }
      if (reportValue.equipmentMaterializationContract.genericEquipmentReuseDetected === true) {
        const materializationBlockers = Array.isArray(reportValue.equipmentMaterializationContract.materializationBlockers)
          ? reportValue.equipmentMaterializationContract.materializationBlockers
          : [];
        const caveats = Array.isArray(reportValue.equipmentMaterializationContract.caveats)
          ? reportValue.equipmentMaterializationContract.caveats
          : [];
        if (materializationBlockers.length === 0) errors.push("/equipmentMaterializationContract/materializationBlockers required when generic equipment reuse is detected");
        if (caveats.length === 0) errors.push("/equipmentMaterializationContract/caveats required when generic equipment reuse is detected");
      }
      const equipmentVariants = Array.isArray(reportValue.equipmentMaterializationContract.equipmentVariants)
        ? reportValue.equipmentMaterializationContract.equipmentVariants
        : [];
      if (equipmentVariants.length === 0) errors.push("/equipmentMaterializationContract/equipmentVariants must not be empty");
      equipmentVariants.forEach((variant, index) => {
        if (!isRecord(variant)) {
          errors.push(`/equipmentMaterializationContract/equipmentVariants/${index} must be an object`);
          return;
        }
        if (typeof variant.equipmentId !== "string" || variant.equipmentId.length === 0) errors.push(`/equipmentMaterializationContract/equipmentVariants/${index}/equipmentId required`);
        if (typeof variant.variantSemanticKey !== "string" || !variant.variantSemanticKey.includes(":equipment_materialization_variant")) {
          errors.push(`/equipmentMaterializationContract/equipmentVariants/${index}/variantSemanticKey must be equipment-specific materialization variant key`);
        }
        if (!isRecord(variant.equipmentVariantProfile)) errors.push(`/equipmentMaterializationContract/equipmentVariants/${index}/equipmentVariantProfile required`);
        const cueIds = Array.isArray(variant.requiredMaterializationCueIds) ? variant.requiredMaterializationCueIds : [];
        for (const cueId of ["equipment_specific_mesh_required", "equipment_specific_scale_required", "equipment_specific_placement_required", "equipment_specific_affordance_required"]) {
          if (!cueIds.includes(cueId)) errors.push(`/equipmentMaterializationContract/equipmentVariants/${index}/requiredMaterializationCueIds must include ${cueId}`);
        }
        const evidenceRefs = Array.isArray(variant.requiredEvidenceRefs) ? variant.requiredEvidenceRefs : [];
        for (const evidenceRef of ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence", "equipment_placement_anchor_evidence"]) {
          if (!evidenceRefs.includes(evidenceRef)) errors.push(`/equipmentMaterializationContract/equipmentVariants/${index}/requiredEvidenceRefs must include ${evidenceRef}`);
        }
      });
    }
    if (learnerBundle && learnerBundle.identityScope !== "learner_runtime_opaque_bundle") errors.push("/learnerBundle/identityScope must be learner_runtime_opaque_bundle");
    for (const forbidden of ["tenantId", "userId", "examRunId", "encounterId"]) {
      if (learnerBundle && forbidden in learnerBundle) errors.push(`/learnerBundle must not include ${forbidden}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function buildActorHumanoidMaterializationContract(bundle: EncounterRuntimeAssetBundle): NonNullable<GeneratedEdStationRuntimeBundleReport["actorHumanoidMaterializationContract"]> {
  const humanoidActors = bundle.actors.filter((actor) => actor.embodiment === "humanoid");
  const blobActorIds = new Map<string, string[]>();
  for (const actor of humanoidActors) {
    const actorIds = blobActorIds.get(actor.model.blob.blobName) ?? [];
    actorIds.push(actor.actorId);
    blobActorIds.set(actor.model.blob.blobName, actorIds);
  }
  const sharedNeutralMeshReuseActorIds = Array.from(new Set(Array.from(blobActorIds.values()).filter((actorIds) => actorIds.length > 1).flat())).sort();
  const materializationBlockers = sharedNeutralMeshReuseActorIds.length > 0
    ? ["shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness"]
    : [];
  const caveats = sharedNeutralMeshReuseActorIds.length > 0
    ? ["Shared neutral humanoid reuse is local runtime scaffolding only until actor-specific Anny mesh, rig, hair/face, clothing, and animation evidence attaches."]
    : [];
  return {
    schemaVersion: "openclinxr.actor-humanoid-materialization-contract.v1",
    scenarioId: bundle.scenarioId,
    source: "generated_station_runtime_bundle",
    actorSpecificVariantKeysRequired: true,
    sharedNeutralMeshReuseDetected: sharedNeutralMeshReuseActorIds.length > 0,
    sharedNeutralMeshReuseActorIds,
    actorVariants: humanoidActors.map((actor) => ({
      actorId: actor.actorId,
      actorRole: actor.role,
      modelAssetId: actor.model.assetId,
      variantSemanticKey: `${bundle.scenarioId}:${actor.actorId}:${actor.role}:anny_humanoid_variant`,
      sourceBlobName: actor.model.blob.blobName,
      humanoidVariantProfile: buildHumanoidVariantProfile(bundle.scenarioId, actor.actorId, actor.role),
      requiredMaterializationCueIds: [
        "actor_specific_body_profile_required",
        "actor_specific_clothing_required",
        "actor_specific_hair_face_required",
        "actor_specific_rig_preservation_required",
      ],
    })),
    materializationBlockers,
    caveats,
    recommendedNextAction: sharedNeutralMeshReuseActorIds.length > 0
      ? "materialize actor-specific Anny humanoid GLBs before treating visual role distinction as asset-level progress"
      : "preserve actor-specific humanoid variant keys through publication and visual QA",
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "animation_quality"],
  };
}

function buildEquipmentMaterializationContract(bundle: EncounterRuntimeAssetBundle): NonNullable<GeneratedEdStationRuntimeBundleReport["equipmentMaterializationContract"]> {
  const blobEquipmentIds = new Map<string, string[]>();
  for (const equipment of bundle.equipment) {
    const equipmentIds = blobEquipmentIds.get(equipment.model.blob.blobName) ?? [];
    equipmentIds.push(equipment.equipmentId);
    blobEquipmentIds.set(equipment.model.blob.blobName, equipmentIds);
  }
  const genericEquipmentReuseEquipmentIds = Array.from(new Set(Array.from(blobEquipmentIds.values()).filter((equipmentIds) => equipmentIds.length > 1).flat())).sort();
  const genericEquipmentReuseDetected = genericEquipmentReuseEquipmentIds.length > 0
    || bundle.equipment.some((equipment) => equipment.model.provenanceRefs.some((ref) => ref.includes("shared-asset-library-lookup")));
  return {
    schemaVersion: "openclinxr.equipment-materialization-contract.v1",
    scenarioId: bundle.scenarioId,
    source: "generated_station_runtime_bundle",
    equipmentSpecificVariantKeysRequired: true,
    genericEquipmentReuseDetected,
    genericEquipmentReuseEquipmentIds,
    equipmentVariants: bundle.equipment.map((equipment) => ({
      equipmentId: equipment.equipmentId,
      modelAssetId: equipment.model.assetId,
      variantSemanticKey: `${bundle.scenarioId}:${equipment.equipmentId}:equipment_materialization_variant`,
      sourceBlobName: equipment.model.blob.blobName,
      equipmentVariantProfile: buildEquipmentVariantProfile(bundle.scenarioId, equipment.equipmentId),
      requiredMaterializationCueIds: [
        "equipment_specific_mesh_required",
        "equipment_specific_scale_required",
        "equipment_specific_placement_required",
        "equipment_specific_affordance_required",
      ],
      requiredEvidenceRefs: [
        "scenario_specific_equipment_variant_evidence",
        "equipment_scale_validation_evidence",
        "equipment_placement_anchor_evidence",
        "clinical_affordance_evidence",
      ],
    })),
    materializationBlockers: genericEquipmentReuseDetected
      ? ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"]
      : [],
    caveats: genericEquipmentReuseDetected
      ? ["Generic equipment reuse is local runtime scaffolding only until equipment-specific mesh/prefab, scale, placement, affordance, and scenario variant evidence attaches."]
      : [],
    recommendedNextAction: genericEquipmentReuseDetected
      ? "materialize equipment-specific generated GLBs or prefabs before treating pediatric equipment as Quest, clinical, scoring, or production-ready"
      : "preserve equipment-specific materialization variant keys through publication and visual QA",
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
}

function buildEquipmentVariantProfile(
  scenarioId: string,
  equipmentId: string,
): NonNullable<GeneratedEdStationRuntimeBundleReport["equipmentMaterializationContract"]>["equipmentVariants"][number]["equipmentVariantProfile"] {
  const equipmentFamily = equipmentId.replace(/_equipment$/u, "");
  return {
    equipmentFamily,
    pediatricUseRequired: scenarioId === "peds_asthma_parent_anxiety_v1",
    scenarioPlacementRequired: true,
    scaleValidationRequired: true,
    interactionAffordanceRequired: /pulse|nebulizer|oxygen|stretcher|chair|inhaler|spacer|ecg|iv|pump|monitor/u.test(equipmentId),
  };
}

function buildHumanoidVariantProfile(
  scenarioId: string,
  actorId: string,
  actorRole: string,
): NonNullable<GeneratedEdStationRuntimeBundleReport["actorHumanoidMaterializationContract"]>["actorVariants"][number]["humanoidVariantProfile"] {
  const isChild = scenarioId === "peds_asthma_parent_anxiety_v1" && actorRole === "patient";
  const clothingLayer = actorRole === "patient"
    ? "patient_gown"
    : ["nurse", "respiratory_therapist", "nurse_observer", "consultant"].includes(actorRole)
      ? "clinical_scrubs"
      : ["family", "spouse", "parent"].includes(actorRole)
        ? "civilian_family"
        : "role_specific";
  return {
    ageBand: isChild ? "child" : "adult",
    bodyScale: isChild ? "small_child" : "adult_standard",
    hairFaceRequired: true,
    clothingLayer,
    faceEyeLipRigRequired: true,
    idlePoseRequired: true,
    locomotionRequired: /nurse|therapist|consultant|family|spouse|parent/u.test(actorRole) || /nurse|parent|consult|family/u.test(actorId),
  };
}

function report(input: Pick<GeneratedEdStationRuntimeBundleReport, "status" | "bundle" | "learnerBundle" | "bundleBlobName" | "blockers"> & { actorHumanoidMaterializationContract?: GeneratedEdStationRuntimeBundleReport["actorHumanoidMaterializationContract"] | undefined; equipmentMaterializationContract?: GeneratedEdStationRuntimeBundleReport["equipmentMaterializationContract"] | undefined; runtimeAssetReviewDecisions?: RuntimeAssetReviewDecision[] | undefined }): GeneratedEdStationRuntimeBundleReport {
  return { schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1", generatedAt: new Date().toISOString(), productionCloudCall: false, runtimeAssetReviewDecisions: [], actorHumanoidMaterializationContract: null, equipmentMaterializationContract: null, notEvidenceFor: [...NOT_EVIDENCE_FOR], ...input };
}

function runtimeActorEmbodiment(actor: ReturnType<typeof scenarioRuntimePreset>["actors"][number]): EncounterRuntimeAssetBundle["actors"][number]["embodiment"] {
  if (actor.actorId.includes("tablet") || actor.role === "interpreter") return "virtual_device";
  return "humanoid";
}

function requiredAsset<T>(assets: T[], index: number): T {
  const asset = assets[index];
  if (!asset) throw new Error(`Missing generated equipment runtime asset ${index}`);
  return asset;
}

function runtimeActorAnimationClipAssets(
  scenarioId: string,
  actorId: string,
  assetStore: RuntimeAssetStoreConfig,
) {
  return ["idle_listen", "speak_emphasis", "concern_reaction", "gaze_shift"].map((clipId) => registerGeneratedRuntimeAssetReference({
    assetId: `openclinxr.${scenarioId}.${actorId}.${clipId}.animation-clip`,
    version: "generated-runtime-2026-05-23",
    kind: "animation_clip",
    displayName: `${actorId.replace(/_v\d+$/u, "").replaceAll("_", " ")} ${clipId.replaceAll("_", " ")}`,
    scenarioAssetId: `${scenarioId}:${actorId}:${clipId}`,
    blobName: `xr-assets/generated/${scenarioId}/actors/${actorId}/animations/${clipId}.glb`,
    contentType: "model/gltf-binary",
    assetStore,
    reviewStatus: "approved_for_local_runtime",
    provenanceRefs: [
      "openclinxr-generated-human-rigging-artifacts",
      "openclinxr-procedural-animation-placeholder-contract",
      "requires-retargeted-clip-materialization-before-production-readiness",
    ],
  }));
}

function runtimeActorPhonemeMapAsset(
  scenarioId: string,
  actorId: string,
  assetStore: RuntimeAssetStoreConfig,
) {
  return registerGeneratedRuntimeAssetReference({
    assetId: `openclinxr.${scenarioId}.${actorId}.phoneme-map`,
    version: "generated-runtime-2026-05-23",
    kind: "phoneme_map",
    displayName: `${actorId.replace(/_v\d+$/u, "").replaceAll("_", " ")} phoneme viseme map`,
    scenarioAssetId: `${scenarioId}:${actorId}:phoneme-map`,
    blobName: `xr-assets/generated/${scenarioId}/actors/${actorId}/phoneme-map.v1.json`,
    contentType: "application/json",
    assetStore,
    reviewStatus: "approved_for_local_runtime",
    provenanceRefs: [
      "openclinxr-deterministic-phoneme-viseme-runtime-map",
      "rhubarb-lip-sync-compatible-mouth-cue-contract",
      "requires-offline-audio-aligned-viseme-generation-before-production-readiness",
    ],
  });
}

function scenarioRuntimePreset(scenarioId: string): {
  scenarioId: string;
  encounterId: string;
  stationId: string;
  actors: Array<{ actorId: string; role: EncounterRuntimeAssetBundle["actors"][number]["role"]; scenarioAssetId: string }>;
  equipment: string[];
  stationContext: EncounterRuntimeAssetBundle["sceneManifest"]["stationContext"];
  roomProps: Array<{
    propId: string;
    label: string;
    semanticRole: EncounterRuntimeAssetBundle["sceneManifest"]["roomProps"][number]["semanticRole"];
    evidenceCue: string;
    colorHex: string;
    accentColorHex: string;
    x: number;
    y: number;
    z: number;
  }>;
} {
  if (scenarioId === "peds_asthma_parent_anxiety_v1") {
    const scenario = scenarioBank.find((candidate) => candidate.scenarioId === scenarioId);
    const characterAssetIds = scenario?.assetNeeds?.filter((assetNeed) => assetNeed.assetType === "character").map((assetNeed) => assetNeed.assetId) ?? [];
    const equipmentAssetIds = scenario?.assetNeeds?.filter((assetNeed) => assetNeed.assetType === "equipment").map((assetNeed) => assetNeed.assetId) ?? [];
    return {
      scenarioId,
      encounterId: "peds_asthma_parent_anxiety_encounter_v1",
      stationId: "peds_asthma_parent_anxiety_station_v1",
      actors: (scenario?.actors ?? []).slice(0, 3).map((actor) => ({
        actorId: actor.actorId,
        role: normalizeRuntimeActorRole(actor.role),
        scenarioAssetId: characterAssetIds.find((assetId) => assetId.startsWith(`${actor.role}_`))
          ?? `${actor.actorId.replace(/_v\d+$/u, "")}_character`,
      })),
      equipment: equipmentAssetIds.length > 0 ? equipmentAssetIds : ["pediatric_nebulizer_equipment", "pulse_oximeter_equipment"],
      stationContext: runtimeStationContextForScenario(scenarioId, "Pediatric Asthma"),
      roomProps: [
        runtimeScenarioRoomProp("pediatric-nebulizer-station", "Nebulizer station", "scenario_context", "nebulizer_workflow_context", "#dbeafe", "#2563eb", 1.4, 0.85, -0.4),
        runtimeScenarioRoomProp("parent-coaching-chair", "Parent coaching chair", "communication_cue", "parent_anxiety_support_cue", "#fef3c7", "#d97706", -1.8, 0.45, 0.85),
        runtimeScenarioRoomProp("pediatric-pulse-ox-monitor", "Pulse ox monitor", "objective_cue", "oxygenation_reassessment_cue", "#ecfeff", "#0891b2", 1.55, 1.35, 0.2),
        runtimeScenarioRoomProp("child-calm-breathing-card", "Breathing coaching card", "review_cue", "breathing_coaching_review_cue", "#dcfce7", "#16a34a", -0.6, 0.9, -0.75),
      ],
    };
  }
  if (scenarioId === "psych_suicidal_ideation_safety_v1") {
    return {
      scenarioId,
      encounterId: "psych_suicidal_ideation_safety_encounter_v1",
      stationId: "psych_suicidal_ideation_safety_station_v1",
      actors: [
        { actorId: "patient_morgan_lee_v1", role: "patient", scenarioAssetId: "patient_morgan_lee_character" },
        { actorId: "nurse_observer_jamie_v1", role: "nurse_observer", scenarioAssetId: "nurse_observer_jamie_character" },
      ],
      equipment: ["safe_room_chair_equipment", "observation_station_equipment"],
      stationContext: runtimeStationContextForScenario(scenarioId, "Psych Safety Assessment"),
      roomProps: [
        runtimeScenarioRoomProp("safe-room-soft-chair", "Safe room chair", "scenario_context", "safe_room_context_cue", "#e5e7eb", "#4b5563", -0.8, 0.45, -0.2),
        runtimeScenarioRoomProp("ligature-risk-cleared-zone", "Cleared safety zone", "objective_cue", "ligature_risk_cleared_zone_cue", "#f3f4f6", "#0f766e", 0.2, 0.08, 0.35),
        runtimeScenarioRoomProp("observer-station", "Observer station", "communication_cue", "observer_escalation_cue", "#e0f2fe", "#0284c7", 1.65, 0.9, 0.65),
        runtimeScenarioRoomProp("safety-plan-whiteboard", "Safety plan prompts", "review_cue", "safety_plan_review_cue", "#fefce8", "#ca8a04", 0.4, 1.65, -0.95),
      ],
    };
  }
  if (scenarioId === "telehealth_diabetes_health_literacy_v1") {
    return {
      scenarioId,
      encounterId: "telehealth_diabetes_health_literacy_encounter_v1",
      stationId: "telehealth_diabetes_health_literacy_station_v1",
      actors: [
        { actorId: "patient_luis_martinez_v1", role: "patient", scenarioAssetId: "patient_luis_martinez_character" },
        { actorId: "daughter_elena_martinez_v1", role: "family", scenarioAssetId: "daughter_elena_martinez_character" },
      ],
      equipment: ["tablet_visit_equipment", "glucometer_review_equipment"],
      stationContext: runtimeStationContextForScenario(scenarioId, "Telehealth Diabetes Plan"),
      roomProps: [
        runtimeScenarioRoomProp("telehealth-tablet-stand", "Telehealth tablet stand", "scenario_context", "telehealth_visit_context_cue", "#e0f2fe", "#0284c7", 0.8, 1.05, -0.45),
        runtimeScenarioRoomProp("plain-language-plan-card", "Plain-language plan card", "objective_cue", "teach_back_plain_language_cue", "#fef9c3", "#ca8a04", -0.65, 0.75, -0.65),
        runtimeScenarioRoomProp("glucometer-log-review", "Glucometer log review", "review_cue", "home_glucose_log_review_cue", "#dcfce7", "#16a34a", 1.45, 0.78, 0.45),
        runtimeScenarioRoomProp("cost-access-barrier-cue", "Cost and access cue", "communication_cue", "cost_access_barrier_cue", "#fee2e2", "#dc2626", -1.45, 0.65, 0.72),
      ],
    };
  }
  const scenario = scenarioId === "ed_chest_pain_priority_v1" ? undefined : scenarioBank.find((candidate) => candidate.scenarioId === scenarioId);
  if (scenario) {
    const scenarioSlug = scenarioId.replace(/_v\d+$/u, "");
    const authoredScenarioEquipment = scenario.equipment;
    const scenarioEquipment =
      authoredScenarioEquipment === undefined || authoredScenarioEquipment.length === 0
        ? ["primary_room_equipment", "secondary_room_equipment"]
        : authoredScenarioEquipment.slice(0, 2);
    return {
      scenarioId,
      encounterId: `${scenarioSlug}_encounter_v1`,
      stationId: `${scenarioSlug}_station_v1`,
      actors: scenario.actors.slice(0, 3).map((actor) => ({
        actorId: actor.actorId,
        role: normalizeRuntimeActorRole(actor.role),
        scenarioAssetId: `${actor.actorId.replace(/_v\d+$/u, "")}_character`,
      })),
      equipment: scenarioEquipment.map((equipment) => `${equipment.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}_equipment`),
      stationContext: runtimeStationContextForScenario(scenarioId, scenario.title),
      roomProps: [
        runtimeScenarioRoomProp(`${scenarioSlug.replaceAll("_", "-")}-primary-context`, scenario.title, "scenario_context", `${scenarioSlug}:primary_context_cue`, "#f8fafc", "#0f766e", -0.6, 0.85, -0.7),
        runtimeScenarioRoomProp(`${scenarioSlug.replaceAll("_", "-")}-objective-cue`, scenario.clinicalObjectives[0] ?? "Scenario objective cue", "objective_cue", `${scenarioSlug}:objective_cue`, "#eff6ff", "#2563eb", 1.25, 0.95, -0.4),
        runtimeScenarioRoomProp(`${scenarioSlug.replaceAll("_", "-")}-communication-cue`, scenario.requiredTraceTags[0] ?? "Communication cue", "communication_cue", `${scenarioSlug}:communication_cue`, "#fef3c7", "#d97706", -1.45, 0.65, 0.75),
        runtimeScenarioRoomProp(`${scenarioSlug.replaceAll("_", "-")}-review-cue`, "Faculty review evidence cue", "review_cue", `${scenarioSlug}:faculty_review_cue`, "#f3e8ff", "#7c3aed", 1.5, 0.7, 0.65),
      ],
    };
  }
  return {
    scenarioId: "ed_chest_pain_priority_v1",
    encounterId: "ed_chest_pain_local_encounter",
    stationId: "ed_chest_pain_station_v1",
    actors: [
      { actorId: "patient_robert_hayes_v1", role: "patient", scenarioAssetId: "generated_patient_robert_hayes_humanoid_glb" },
      { actorId: "nurse_maria_alvarez_v1", role: "nurse", scenarioAssetId: "nurse_maria_alvarez_character" },
      { actorId: "spouse_anna_hayes_v1", role: "family_member", scenarioAssetId: "spouse_anna_hayes_character" },
    ],
    equipment: ["ecg_cart_equipment", "iv_stand_equipment"],
    stationContext: runtimeStationContextForScenario("ed_chest_pain_priority_v1", "ED Chest Pain"),
    roomProps: [
      runtimeScenarioRoomProp("ecg-priority-zone", "ECG priority zone", "objective_cue", "ecg_priority_workflow_cue", "#fef3c7", "#f59e0b", 1.5, 0.75, 0.25),
      runtimeScenarioRoomProp("handoff-whiteboard", "Handoff whiteboard", "review_cue", "handoff_review_cue", "#f8fafc", "#14b8a6", -1.2, 1.6, -0.85),
      runtimeScenarioRoomProp("chest-pain-monitor", "Cardiac monitor", "scenario_context", "cardiac_monitor_context_cue", "#dbeafe", "#ef4444", 1.65, 1.3, -0.5),
      runtimeScenarioRoomProp("family-communication-zone", "Family communication zone", "communication_cue", "family_communication_zone_cue", "#ffedd5", "#f97316", -1.8, 0.6, 0.8),
    ],
  };
}

function runtimeScenarioRoomProp(
  propId: string,
  label: string,
  semanticRole: EncounterRuntimeAssetBundle["sceneManifest"]["roomProps"][number]["semanticRole"],
  evidenceCue: string,
  colorHex: string,
  accentColorHex: string,
  x: number,
  y: number,
  z: number,
): ReturnType<typeof scenarioRuntimePreset>["roomProps"][number] {
  return { propId, label, semanticRole, evidenceCue, colorHex, accentColorHex, x, y, z };
}

function runtimeStationContextForScenario(
  scenarioId: string,
  fallbackTitle: string,
): EncounterRuntimeAssetBundle["sceneManifest"]["stationContext"] {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === scenarioId);
  if (scenario) {
    const patient = scenario.actors.find((actor) => actor.role === "patient") ?? scenario.actors[0];
    const firstEvent = scenario.eventSchedule[0];
    return {
      title: fallbackTitle,
      subtitle: scenario.environment?.description ?? scenario.title,
      chiefConcern: scenario.clinicalObjectives[0] ?? scenario.title,
      initialVitals: initialVitalsForScenario(scenarioId),
      interruption: firstEvent
        ? `${actorDisplayName(firstEvent.actorId, scenario.actors.find((actor) => actor.actorId === firstEvent.actorId)?.role)} cue at ${firstEvent.atSecond}s: ${firstEvent.tag.replaceAll("_", " ")}`
        : "Scenario event cue pending review",
      stageAriaLabel: `${scenario.environment?.name ?? fallbackTitle} station scene`,
      canvasAriaLabel: `3D ${scenario.environment?.name ?? fallbackTitle} preview`,
      initialDialogueText: `${actorDisplayName(patient?.actorId ?? "patient_v1", patient?.role)}: ${patient?.demeanor ?? "I am ready to begin this encounter."}`,
    };
  }
  const contexts: Record<string, EncounterRuntimeAssetBundle["sceneManifest"]["stationContext"]> = {
    ed_chest_pain_priority_v1: {
      title: "ED Chest Pain",
      subtitle: "Patient, spouse, and nurse in a time-boxed emergency department encounter.",
      chiefConcern: "Crushing substernal chest pressure",
      initialVitals: "BP 152/92, HR 104, RR 20, SpO2 96%",
      interruption: "Nurse repeats vitals at minute seven",
      stageAriaLabel: "Emergency department station scene",
      canvasAriaLabel: "3D emergency department bay preview",
      initialDialogueText: "Robert Hayes: It feels heavy, like someone is sitting on my chest.",
    },
    peds_asthma_parent_anxiety_v1: {
      title: "Pediatric Asthma",
      subtitle: "Child, anxious parent, and respiratory therapist in a time-boxed pediatric respiratory encounter.",
      chiefConcern: "Shortness of breath and wheezing after activity",
      initialVitals: "HR 124, RR 32, SpO2 93%, mild retractions",
      interruption: "Parent anxiety escalates while respiratory status is reassessed",
      stageAriaLabel: "Pediatric asthma station scene",
      canvasAriaLabel: "3D pediatric respiratory room preview",
      initialDialogueText: "Jordan Williams: My chest feels tight and it is hard to breathe.",
    },
    psych_suicidal_ideation_safety_v1: {
      title: "Psych Safety Assessment",
      subtitle: "Patient and observer in a time-boxed suicide-risk and safety-planning encounter.",
      chiefConcern: "Suicidal ideation and inability to commit to being alone safely",
      initialVitals: "Calm but withdrawn; no acute medical instability documented",
      interruption: "Observer requests explicit safety plan and escalation threshold",
      stageAriaLabel: "Psychiatric safety assessment station scene",
      canvasAriaLabel: "3D psychiatric safety assessment room preview",
      initialDialogueText: "Morgan Lee: I do not feel safe being alone right now.",
    },
    telehealth_diabetes_health_literacy_v1: {
      title: "Telehealth Diabetes Plan",
      subtitle: "Patient and daughter in a time-boxed telehealth counseling encounter focused on teach-back and access barriers.",
      chiefConcern: "Diabetes medication confusion and difficulty following portal instructions",
      initialVitals: "Remote visit; home glucose logs variable with recent hypoglycemia concern",
      interruption: "Daughter begins answering for the patient unless communication is redirected respectfully",
      stageAriaLabel: "Telehealth diabetes health-literacy station scene",
      canvasAriaLabel: "3D telehealth counseling room preview",
      initialDialogueText: "Luis Martinez: I want to follow the plan, but the instructions are hard to understand.",
    },
    ob_headache_preeclampsia_triage_v1: {
      title: "OB Headache Preeclampsia Triage",
      subtitle: "Pregnant patient, partner, and OB nurse in a time-boxed triage encounter with fetal monitor and blood-pressure equipment.",
      chiefConcern: "Severe headache with visual sensitivity in late pregnancy",
      initialVitals: "BP cue requires repeat measurement and escalation consideration",
      interruption: "Partner anxiety rises while nurse requests a concise escalation plan",
      stageAriaLabel: "OB preeclampsia triage station scene",
      canvasAriaLabel: "3D OB triage room preview",
      initialDialogueText: "Aisha Khan: My headache is getting worse, and the lights are bothering my eyes.",
    },
    ed_stroke_alert_handoff_v1: {
      title: "ED Stroke Alert Handoff",
      subtitle: "Patient, family member, and stroke nurse in a time-critical handoff with clock and bedside monitor cues.",
      chiefConcern: "Acute speech difficulty and right-sided weakness",
      initialVitals: "Bedside monitor and last-known-well clock drive urgency",
      interruption: "Family member adds timeline details while stroke nurse presses for handoff clarity",
      stageAriaLabel: "ED stroke alert handoff station scene",
      canvasAriaLabel: "3D stroke alert room preview",
      initialDialogueText: "Samuel Brooks: My right arm feels weak, and I cannot get the words out clearly.",
    },
    stepdown_sepsis_nurse_escalation_v1: {
      title: "Stepdown Sepsis Escalation",
      subtitle: "Deteriorating patient with nurse and respiratory therapist in a stepdown escalation encounter.",
      chiefConcern: "Worsening fever, chills, and respiratory concern after earlier stability",
      initialVitals: "Monitor and IV pump cues support escalation and closed-loop team communication",
      interruption: "Respiratory therapist requests prioritization while nurse seeks escalation orders",
      stageAriaLabel: "Stepdown sepsis escalation station scene",
      canvasAriaLabel: "3D stepdown sepsis room preview",
      initialDialogueText: "Helen Carter: I feel worse than this morning, and I am shaking again.",
    },
    clinic_abdominal_pain_interpreter_v1: {
      title: "Clinic Abdominal Pain Interpreter",
      subtitle: "Patient, father, and remote interpreter tablet in an ambulatory abdominal-pain encounter.",
      chiefConcern: "Right-lower-quadrant abdominal pain with interpreter-mediated history",
      initialVitals: "Exam table and abdominal exam zone cues anchor the focused assessment",
      interruption: "Family member answers out of turn unless the learner uses interpreter best practices",
      stageAriaLabel: "Clinic abdominal pain interpreter station scene",
      canvasAriaLabel: "3D clinic interpreter room preview",
      initialDialogueText: "Lucia Morales: The pain is mostly on the lower right side, and I need the interpreter.",
    },
    oncology_bad_news_family_v1: {
      title: "Oncology Bad News Family",
      subtitle: "Patient and sister in a quiet oncology consultation focused on serious-news communication.",
      chiefConcern: "Reviewing difficult scan results with family present",
      initialVitals: "Chairs and tissue-box cues support emotionally realistic disclosure workflow",
      interruption: "Family emotion escalates and requires empathy before further explanation",
      stageAriaLabel: "Oncology serious-news family station scene",
      canvasAriaLabel: "3D oncology consultation room preview",
      initialDialogueText: "David Miller: I want my sister here before we talk about the scan results.",
    },
    postop_fever_consult_pressure_v1: {
      title: "Postop Fever Consult Pressure",
      subtitle: "Postoperative patient with floor nurse and surgery resident under consult-pressure dynamics.",
      chiefConcern: "Fever, worsening abdominal pain, and chills after surgery",
      initialVitals: "Post-op bed and abdominal dressing cues drive focused exam and escalation",
      interruption: "Consultant pressure risks premature closure unless the learner maintains safety priorities",
      stageAriaLabel: "Postoperative fever consult-pressure station scene",
      canvasAriaLabel: "3D postoperative fever room preview",
      initialDialogueText: "Priya Shah: My belly hurts more today, and I have chills.",
    },
  };
  return contexts[scenarioId] ?? {
    title: fallbackTitle,
    subtitle: "Scenario-bank generated encounter with actor, room prop, equipment, and dialogue evidence selected by runtime bundle.",
    chiefConcern: "Generated scenario objective pending review",
    initialVitals: "Generated environment evidence pending headset validation",
    interruption: "Trace event cue pending review",
    stageAriaLabel: `${fallbackTitle} station scene`,
    canvasAriaLabel: `3D ${fallbackTitle} preview`,
    initialDialogueText: "Patient: I am ready to begin this encounter.",
  };
}

function initialVitalsForScenario(scenarioId: string): string {
  if (scenarioId === "peds_asthma_parent_anxiety_v1") return "HR 128, RR 32, SpO2 91% on room air";
  if (scenarioId === "ed_chest_pain_priority_v1") return "BP 152/92, HR 104, RR 20, SpO2 96%";
  return "Generated environment evidence pending headset validation";
}

function runtimeDialogueTurnsForScenario(
  preset: ReturnType<typeof scenarioRuntimePreset>,
): EncounterRuntimeAssetBundle["sceneManifest"]["dialogueTurns"] {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === preset.scenarioId);
  if (scenario) {
    const patient = actorByRole(preset, "patient") ?? preset.actors[0];
    const team = actorByRole(preset, "nurse")
      ?? actorByRole(preset, "respiratory_therapist")
      ?? actorByRole(preset, "consultant")
      ?? actorByRole(preset, "interpreter")
      ?? preset.actors[1]
      ?? patient;
    const family = actorByRole(preset, "family")
      ?? actorByRole(preset, "family_member")
      ?? actorByRole(preset, "parent")
      ?? actorByRole(preset, "spouse")
      ?? preset.actors[2]
      ?? team;
    const actorForTraceTag = (traceTag: string): typeof patient => {
      const scheduledActorId = scenario.eventSchedule.find((event) => event.tag === traceTag)?.actorId;
      const scheduledActor = scheduledActorId ? preset.actors.find((actor) => actor.actorId === scheduledActorId) : undefined;
      if (scheduledActor) return scheduledActor;
      if (/empathy/i.test(traceTag)) return patient;
      if (/parent|family/i.test(traceTag)) return family;
      if (/oxygen|bronchodilator|vitals|team|escalation|note/i.test(traceTag)) return team;
      return patient;
    };
    return scenario.requiredTraceTags.map((traceTag) => {
      const actor = actorForTraceTag(traceTag);
      const scenarioActor = scenario.actors.find((candidate) => candidate.actorId === actor.actorId);
      const text = scenarioDialogueText({
        scenario,
        traceTag,
        actorId: actor.actorId,
        actorRole: actor.role,
      });
      return {
        traceTag,
        actorId: actor.actorId,
        text,
        gazeTargetKind: gazeTargetForTraceTag(traceTag, team, family).kind,
        gazeTargetActorId: gazeTargetForTraceTag(traceTag, team, family).actorId,
        affectTimeline: affectTimelineForDialogueTurn(preset.scenarioId, traceTag, text, scenarioActor),
        caseDefinitionRuntimeSignals: caseDefinitionRuntimeSignalsForDialogueTurn(scenarioActor, scenario),
      };
    });
  }
  const patient = actorByRole(preset, "patient") ?? preset.actors[0];
  const team = actorByRole(preset, "nurse") ?? actorByRole(preset, "consultant") ?? actorByRole(preset, "interpreter") ?? preset.actors[1] ?? patient;
  const family = actorByRole(preset, "family_member") ?? actorByRole(preset, "family") ?? actorByRole(preset, "parent") ?? actorByRole(preset, "spouse") ?? preset.actors[2] ?? team;
  const patientName = actorDisplayName(patient?.actorId ?? "patient_v1", patient?.role);
  const teamName = actorDisplayName(team?.actorId ?? "clinical_team_v1", team?.role);
  const familyName = actorDisplayName(family?.actorId ?? "family_v1", family?.role);
  const turns: Array<{ traceTag: string; actorId: string; text: string; target?: string | null }> = [
    { traceTag: "history_opqrst", actorId: patient.actorId, text: `${patientName}: I can tell you what has been happening if we go step by step.` },
    { traceTag: "risk_factor_question", actorId: patient.actorId, text: `${patientName}: There may be details I only mention if asked clearly.` },
    { traceTag: "associated_symptom_question", actorId: patient.actorId, text: `${patientName}: I have noticed a few related symptoms that worry me.` },
    { traceTag: "vitals_review", actorId: team.actorId, text: `${teamName}: I can help review the available status information.` },
    { traceTag: "ecg_request", actorId: team.actorId, text: `${teamName}: I will help gather the next piece of clinical information.` },
    { traceTag: "urgent_escalation", actorId: family.actorId, text: `${familyName}: I need to know when this becomes urgent.` },
    { traceTag: "team_communication", actorId: team.actorId, text: `${teamName}: A clear shared plan will help the team respond.`, target: team.actorId },
    { traceTag: "family_communication", actorId: family.actorId, text: `${familyName}: Please include us in a way that supports the patient.`, target: family.actorId },
    { traceTag: "empathy_statement", actorId: patient.actorId, text: `${patientName}: It helps when you acknowledge how stressful this feels.` },
    { traceTag: "patient_note_submitted", actorId: patient.actorId, text: "System: Patient note saved for faculty review." },
  ];
  return turns.map((turn) => {
    const refinedText = refinedDialogueTurnText(preset.scenarioId, turn.traceTag, turn.text, {
      patientName,
      teamName,
      familyName,
    });
    return {
      traceTag: turn.traceTag,
      actorId: turn.actorId,
      text: refinedText,
      gazeTargetKind: turn.target ? "actor" : "learner_camera",
      gazeTargetActorId: turn.target ?? null,
      affectTimeline: affectTimelineForDialogueTurn(preset.scenarioId, turn.traceTag, refinedText),
      caseDefinitionRuntimeSignals: caseDefinitionRuntimeSignalsForDialogueTurn(
        preset.actors.find((actor) => actor.actorId === turn.actorId),
        scenarioBank.find((scenario) => scenario.scenarioId === preset.scenarioId),
      ),
    };
  });
}

function scenarioDialogueText(input: {
  scenario: (typeof scenarioBank)[number];
  traceTag: string;
  actorId: string;
  actorRole: string;
}): string {
  const actor = input.scenario.actors.find((candidate) => candidate.actorId === input.actorId);
  const actorName = actorDisplayName(input.actorId, input.actorRole);
  const objective = input.scenario.reviewRubric.find((rubric) => rubric.requiredTraceTags.includes(input.traceTag))?.label
    ?? input.traceTag.replaceAll("_", " ");
  const style = actor?.communicationProfile?.baselineMood[0] ?? actor?.demeanor ?? "focused";
  const cue = scenarioDialogueCue(input.scenario.scenarioId, input.traceTag, actor?.hiddenFacts ?? [], actor?.communicationProfile?.deescalationTriggers ?? []);
  return `${actorName}: ${cue} I am ${style}; this response comes from the ${objective.toLowerCase()} requirement in the scenario definition.`;
}

function scenarioDialogueCue(
  scenarioId: string,
  traceTag: string,
  hiddenFacts: string[],
  deescalationTriggers: string[],
): string {
  if (scenarioId === "peds_asthma_parent_anxiety_v1") {
    const pedsCues: Record<string, string> = {
      work_of_breathing_assessment: "Maya is using short sentences, wheezing audibly, and needs her breathing effort named before more questions.",
      inhaler_history: hiddenFacts[0] ? `The key inhaler history is that ${hiddenFacts[0].toLowerCase()}.` : "Ask whether the rescue inhaler was available and used today.",
      trigger_history: hiddenFacts[1] ? `The likely trigger is that ${hiddenFacts[1].toLowerCase()}.` : "Ask about pets, viral symptoms, smoke, exercise, or recent exposure triggers.",
      oxygen_request: "Oxygen saturation is 91% on room air, so a clear oxygen request and reassessment plan should happen now.",
      bronchodilator_plan: "A nebulizer or bronchodilator plan should be stated clearly and checked back with the child and parent.",
      urgent_escalation: "If breathing effort or saturation worsens, the team needs an urgent escalation plan rather than reassurance alone.",
      parent_communication: `Tara can help once the plan is explained plainly: ${deescalationTriggers.join(", ") || "validate distress, explain oxygen, clarify parent role"}.`,
      empathy_statement: "Maya and Tara need a calm acknowledgement that fast breathing is scary before the next clinical step.",
      patient_note_submitted: "Patient note saved for faculty review with pediatric respiratory assessment, treatment response, and family communication documented.",
    };
    return pedsCues[traceTag] ?? `${traceTag.replaceAll("_", " ")} should be handled with pediatric urgency and family-centered language.`;
  }

  if (/note|documentation/i.test(traceTag)) return "Patient note saved for faculty review with scenario-specific findings and next steps documented.";
  if (/empathy|family|parent|communication/i.test(traceTag)) return `Use plain language and respond to emotion with ${deescalationTriggers[0] ?? "clear support"}.`;
  if (/urgent|escalation|oxygen|bronchodilator|vitals|team/i.test(traceTag)) return "State the clinical concern, give a closed-loop request, and name the immediate safety plan.";
  if (hiddenFacts[0]) return `A hidden case detail is available when asked directly: ${hiddenFacts[0].toLowerCase()}.`;
  return `${traceTag.replaceAll("_", " ")} should be explored with scenario-specific language.`;
}

function gazeTargetForTraceTag(
  traceTag: string,
  team: { actorId: string },
  family: { actorId: string },
): { kind: "learner_camera" | "actor"; actorId: string | null } {
  if (/parent|family/i.test(traceTag)) return { kind: "actor", actorId: family.actorId };
  if (/team|handoff|oxygen|bronchodilator|vitals|escalation/i.test(traceTag)) return { kind: "actor", actorId: team.actorId };
  return { kind: "learner_camera", actorId: null };
}

function caseDefinitionRuntimeSignalsForDialogueTurn(
  actor: { actorId: string; role: string; communicationProfile?: { baselineMood: string[] } } | undefined,
  scenario: (typeof scenarioBank)[number] | undefined,
): NonNullable<EncounterRuntimeAssetBundle["sceneManifest"]["dialogueTurns"][number]["caseDefinitionRuntimeSignals"]> {
  const actorHasCommunicationProfile = Boolean(actor?.communicationProfile);
  const actorRuntimeRealismRequirement = actor && scenario
    ? {
        actorId: actor.actorId,
        role: actor.role,
        baselineMood: [...(actor.communicationProfile?.baselineMood ?? [])],
        locomotionRequired: scenario.eventSchedule.length > 0,
        expressionRequired: actorHasCommunicationProfile,
        gazeRequired: scenario.actors.filter((candidate) => candidate.role !== "system").length > 1,
        lipSyncRequired: scenario.requiredTraceTags.length > 0 && actorHasCommunicationProfile,
        interactionRequired: true,
        requiredCueIds: [
          "case_definition_driven_expression_selection",
          "dialogue_viseme_and_gaze_mapping",
          "actor_target_gaze_from_trace_intent",
          "scenario_actor_interaction_affordance",
          ...(scenario.eventSchedule.length > 0 ? ["scenario_timeline_locomotion_or_posture_change"] : []),
        ],
      }
    : undefined;
  return {
    source: "scenario_definition_and_dialogue_seed_bank",
    expressionRequired: actorHasCommunicationProfile,
    gazeRequired: true,
    lipSyncRequired: Boolean(scenario && scenario.requiredTraceTags.length > 0 && actorHasCommunicationProfile),
    ...(actorRuntimeRealismRequirement ? { actorRuntimeRealismRequirement } : {}),
    requiredSignalIds: [
      "scenario_actor_baseline_mood_emotion_mapping",
      "case_definition_driven_expression_selection",
      "dialogue_viseme_and_gaze_mapping",
      "actor_target_gaze_from_trace_intent",
      "scenario_actor_interaction_affordance",
      ...(scenario?.eventSchedule.length ? ["scenario_timeline_locomotion_or_posture_change"] : []),
    ],
    claimBoundary: "case_definition_humanoid_runtime_metadata_only",
  };
}

function affectTimelineForDialogueTurn(
  scenarioId: string,
  traceTag: string,
  text: string,
  actor?: { communicationProfile?: { baselineMood: string[]; intensity: number; escalationTriggers: string[]; deescalationTriggers: string[] }; demeanor?: string },
): NonNullable<EncounterRuntimeAssetBundle["sceneManifest"]["dialogueTurns"][number]["affectTimeline"]> {
  const emotion = emotionForActorCommunicationProfile(actor) ?? emotionForRuntimeDialogueTurn(scenarioId, traceTag, text);
  const intensityByEmotion = {
    neutral: 0.2,
    anxious: 0.68,
    concerned: 0.58,
    reassured: 0.32,
    pain: 0.82,
  } as const;
  return {
    emotion,
    intensity: Number(Math.max(intensityByEmotion[emotion], actor?.communicationProfile?.intensity ?? 0).toFixed(2)),
    onsetMs: 120,
    transitionMs: emotion === "pain" || emotion === "anxious" ? 650 : 950,
    decayMs: 900,
    evidenceCueIds: [
      "emotion_aligned_expression_transition_cue",
      "visible_runtime_eyebrow_jaw_cheek_cue",
      "dialogue_viseme_and_gaze_mapping",
      "scenario_actor_baseline_mood_emotion_mapping",
      "case_definition_driven_expression_selection",
    ],
    notEvidenceFor: ["clinical_validity", "scoring_validity", "production_asset_readiness"],
  };
}

function emotionForActorCommunicationProfile(
  actor?: { communicationProfile?: { baselineMood: string[]; escalationTriggers: string[]; deescalationTriggers: string[] }; demeanor?: string },
): NonNullable<EncounterRuntimeAssetBundle["sceneManifest"]["dialogueTurns"][number]["affectTimeline"]>["emotion"] | undefined {
  const profile = [
    ...(actor?.communicationProfile?.baselineMood ?? []),
    ...(actor?.communicationProfile?.escalationTriggers ?? []),
    ...(actor?.communicationProfile?.deescalationTriggers ?? []),
    actor?.demeanor ?? "",
  ].join(" ").toLowerCase();
  if (/pain|uncomfortable|breathless|wheeze|distress/u.test(profile)) return "pain";
  if (/frightened|anxious|worried|fearful|protective|urgent|scared|frustrated/u.test(profile)) return "anxious";
  if (/concerned|focused|watchful|safety|ready to act/u.test(profile)) return "concerned";
  if (/reassur|calm|polite|helpful/u.test(profile)) return "reassured";
  return undefined;
}

function emotionForRuntimeDialogueTurn(
  scenarioId: string,
  traceTag: string,
  text: string,
): NonNullable<EncounterRuntimeAssetBundle["sceneManifest"]["dialogueTurns"][number]["affectTimeline"]>["emotion"] {
  if (traceTag === "patient_note_submitted") return "neutral";
  if (scenarioId === "oncology_bad_news_family_v1" && /pause|emotion|bad_news|diagnosis|family/i.test(traceTag)) return "concerned";
  if (/urgent|escalation|family|parent|anxiety|safety/i.test(traceTag)) return "anxious";
  if (/pain|chest|pressure|short of breath|hurts|crushing/i.test(text)) return "pain";
  if (/clear plan|saved|thank|better|support/i.test(text)) return "reassured";
  if (/worry|stress|concern|please|include/i.test(text)) return "concerned";
  return "neutral";
}

function refinedDialogueTurnText(
  scenarioId: string,
  traceTag: string,
  fallbackText: string,
  names: { patientName: string; teamName: string; familyName: string },
): string {
  if (scenarioId === "oncology_bad_news_family_v1") {
    const oncologyTurns: Record<string, string> = {
      history_opqrst: `${names.patientName}: I know the scan was important, but I am scared to hear what it showed.`,
      risk_factor_question: `${names.patientName}: I want the truth, but please say it in words I can understand.`,
      associated_symptom_question: `${names.patientName}: I have been more tired, and my pain has been harder to ignore.`,
      urgent_escalation: `${names.familyName}: Are you saying the cancer has spread? Please do not talk around it.`,
      team_communication: `${names.teamName}: I will pause, check understanding, and leave space for questions before next steps.`,
      family_communication: `${names.familyName}: I need you to say what this means for him, but please do it gently.`,
      empathy_statement: `${names.patientName}: It helps when you acknowledge that this is frightening before explaining the plan.`,
    };
    return oncologyTurns[traceTag] ?? fallbackText;
  }
  return fallbackText;
}

function runtimeActorPlacementsForScenario(
  preset: ReturnType<typeof scenarioRuntimePreset>,
): EncounterRuntimeAssetBundle["sceneManifest"]["actorPlacements"] {
  const patient = actorByRole(preset, "patient") ?? preset.actors[0];
  const team = actorByRole(preset, "nurse")
    ?? actorByRole(preset, "respiratory_therapist")
    ?? actorByRole(preset, "nurse_observer")
    ?? actorByRole(preset, "consultant")
    ?? actorByRole(preset, "interpreter")
    ?? preset.actors[1]
    ?? patient;
  const family = actorByRole(preset, "family")
    ?? actorByRole(preset, "family_member")
    ?? actorByRole(preset, "parent")
    ?? actorByRole(preset, "spouse")
    ?? preset.actors.find((actor) => actor.actorId !== patient.actorId && actor.actorId !== team.actorId)
    ?? preset.actors[2]
    ?? team;
  return {
    [patient.actorId]: { slotKind: "primary_patient", position: { x: -0.72, y: 1.06, z: -0.12 }, scale: { x: 1.1, y: 1.1, z: 1.1 }, verticalOffsetMeters: -0.98, labelPrefix: "Patient" },
    [team.actorId]: { slotKind: "clinical_team", position: { x: 1.45, y: 0.95, z: 0.55 }, scale: { x: 1, y: 1, z: 1 }, verticalOffsetMeters: -0.95, labelPrefix: team.role === "interpreter" ? "Interpreter" : "Team" },
    [family.actorId]: { slotKind: "family_or_observer", position: { x: -2.0, y: 0.95, z: 0.7 }, scale: { x: 1, y: 1, z: 1 }, verticalOffsetMeters: -0.95, labelPrefix: family.role === "consultant" ? "Consultant" : "Family" },
  };
}

function runtimeEquipmentPlacementsForScenario(
  preset: ReturnType<typeof scenarioRuntimePreset>,
): EncounterRuntimeAssetBundle["sceneManifest"]["equipmentPlacements"] {
  const placementAnchors = [
    { x: 1.6, y: 0, z: 0.28 },
    { x: 0.95, y: 0, z: 0.98 },
    { x: 1.75, y: 1.18, z: -1.12 },
    { x: -0.1, y: 0, z: -0.95 },
    { x: -1.75, y: 0, z: 0.52 },
    { x: 0.58, y: 0.72, z: -0.55 },
  ];
  return Object.fromEntries((preset.equipment.length > 0 ? preset.equipment : ["primary_equipment"]).map((equipmentId, index) => [
    equipmentId,
    {
      position: placementAnchors[index % placementAnchors.length] ?? placementAnchors[0],
      label: equipmentDisplayLabel(equipmentId),
      interactionCueIds: [`${equipmentId}:selectable_equipment_reference`, `${equipmentId}:clinical_workflow_cue`],
    },
  ]));
}

function equipmentDisplayLabel(equipmentId: string): string {
  return equipmentId
    .replace(/_equipment$/u, "")
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function actorByRole(
  preset: ReturnType<typeof scenarioRuntimePreset>,
  role: string,
): ReturnType<typeof scenarioRuntimePreset>["actors"][number] | undefined {
  return preset.actors.find((actor) => actor.role === role);
}

function normalizeRuntimeActorRole(role: string): EncounterRuntimeAssetBundle["actors"][number]["role"] {
  if (
    role === "patient"
    || role === "nurse"
    || role === "spouse"
    || role === "family"
    || role === "family_member"
    || role === "parent"
    || role === "consultant"
    || role === "interpreter"
    || role === "respiratory_therapist"
    || role === "nurse_observer"
  ) {
    return role;
  }
  return "other";
}

function actorDisplayName(actorId: string, role?: string): string {
  const words = actorId
    .replace(/_v\d+$/u, "")
    .split("_")
    .filter(Boolean);
  const trimmedWords = trimRolePrefix(words, role);
  return trimmedWords
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function trimRolePrefix(words: string[], role?: string): string[] {
  if (role === "patient" && ["patient", "child"].includes(words[0] ?? "")) return words.slice(1);
  if (["family", "family_member", "parent", "spouse"].includes(role ?? "") && ["family", "parent", "spouse", "partner", "son", "daughter", "father", "sister"].includes(words[0] ?? "")) return words.slice(1);
  if (role === "nurse") {
    const nurseIndex = words.indexOf("nurse");
    if (nurseIndex >= 0) return words.slice(nurseIndex);
  }
  if (role === "consultant") {
    const residentIndex = words.indexOf("resident");
    if (residentIndex >= 0) return words.slice(residentIndex);
  }
  if (role === "interpreter") {
    const interpreterIndex = words.indexOf("interpreter");
    if (interpreterIndex >= 0) return words.slice(interpreterIndex);
  }
  return words;
}

function createScenarioRuntimeSceneManifest(
  preset: ReturnType<typeof scenarioRuntimePreset>,
): EncounterRuntimeAssetBundle["sceneManifest"] {
  return {
    schemaVersion: "openclinxr.runtime-scene-manifest.v1",
    manifestId: `scene_manifest:${preset.scenarioId}:${preset.stationId}`,
    source: "generated_scene_pipeline",
    scenarioId: preset.scenarioId,
    stationId: preset.stationId,
    stationContext: preset.stationContext,
    dialogueTurns: runtimeDialogueTurnsForScenario(preset),
    actorPlacements: runtimeActorPlacementsForScenario(preset),
    equipmentPlacements: runtimeEquipmentPlacementsForScenario(preset),
    roomProps: preset.roomProps.map((prop) => ({
      propId: prop.propId,
      label: prop.label,
      semanticRole: prop.semanticRole,
      evidenceCue: prop.evidenceCue,
      colorHex: prop.colorHex,
      accentColorHex: prop.accentColorHex,
      position: { x: prop.x, y: prop.y, z: prop.z },
      scale: { x: 0.7, y: 0.18, z: 0.42 },
      affordanceCueIds: [`${prop.propId}:${prop.semanticRole}`, prop.evidenceCue],
      interactionTags: [prop.semanticRole, preset.scenarioId],
      generatedBy: "scene_manifest",
    })),
    productionReadinessClaimed: false,
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = { humanReportPath: defaultGeneratedHumanRiggingReportPath(), equipmentReportPath: defaultMedicalEquipmentReportPath(), environmentReportPath: defaultEnvironmentArtifactsReportPath(), runtimeAssetReviewDecisionsPath: null, scenarioId: "ed_chest_pain_priority_v1", outputPath: defaultGeneratedEdStationRuntimeBundleReportPath(), writeAzurite: false, validateLatest: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--write-azurite") options.writeAzurite = true;
    else if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--human-report") options.humanReportPath = requireNext(args, ++index, arg);
    else if (arg === "--equipment-report") options.equipmentReportPath = requireNext(args, ++index, arg);
    else if (arg === "--environment-report") options.environmentReportPath = requireNext(args, ++index, arg);
    else if (arg === "--runtime-asset-review-decisions") options.runtimeAssetReviewDecisionsPath = requireNext(args, ++index, arg);
    else if (arg === "--scenario-id" || arg === "--scenario") options.scenarioId = requireNext(args, ++index, arg);
    else if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function helpText(): string {
  return ["Usage: tsx tools/openclinxr/generated-ed-station-runtime-bundle.ts [options]", "  --write-azurite            Write frozen bundle JSON to local Azurite when configured", "  --human-report <path>      Generated human rigging report path", "  --equipment-report <path>  Medical equipment report path", "  --environment-report <path> Environment report path", "  --runtime-asset-review-decisions <path> Runtime asset review decision JSON array path", "  --scenario-id <id>         Scenario to package into a generated learner runtime bundle", "  --scenario <id>            Alias for --scenario-id", "  --output <path>            Bundle report output path", "  --validate-latest          Validate the report at --output"].join("\n");
}

function parseRuntimeAssetReviewDecisions(value: unknown): RuntimeAssetReviewDecision[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRuntimeAssetReviewDecision);
}

function isRuntimeAssetReviewDecision(value: unknown): value is RuntimeAssetReviewDecision {
  return isRecord(value)
    && typeof value.assetId === "string"
    && ["asset_pipeline", "clinical_simulation", "xr_performance", "security_privacy"].includes(String(value.reviewerRole))
    && typeof value.reviewerId === "string"
    && (value.decision === "approved_for_local_runtime" || value.decision === "changes_requested")
    && typeof value.comments === "string"
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.length > 0
    && value.evidenceRefs.every((ref) => typeof ref === "string" && ref.trim().length > 0)
    && typeof value.reviewedAt === "string"
    && !Number.isNaN(Date.parse(value.reviewedAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) await runGeneratedEdStationRuntimeBundleCli();
