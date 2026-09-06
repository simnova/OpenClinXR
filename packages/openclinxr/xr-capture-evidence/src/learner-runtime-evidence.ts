/**
 * Learner-runtime use-gate + actor-slot-assignment evidence recorders —
 * extracted from apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE).
 *
 * Gate evaluation lives in @openclinxr/asset-registry/runtime-bundles and
 * @openclinxr/xr-runtime-state; this module only builds the window evidence
 * records. Slot assignment reads the bundle passed in — the module keeps no
 * cached assignment (the app's encounterRuntimeAssetBundle cache stays in the
 * composition root).
 */

import {
  ENCOUNTER_LEARNER_RUNTIME_REQUIRED_GATE_IDS,
  evaluateEncounterRuntimeLearnerUseGate,
  type EncounterRuntimeAsset,
  type LearnerRuntimeAssetBundle,
} from "@openclinxr/asset-registry/runtime-bundles";
import {
  assignRuntimeActorSlots,
  readRuntimeActorEquipmentMaterializationGate,
  type LearnerRuntimeUseGateEvidence,
  type RuntimeSlotAssignment,
} from "@openclinxr/xr-runtime-state";

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    __openClinXrLearnerRuntimeUseGateEvidence?: LearnerRuntimeUseGateEvidence;
    /** #122 — machine-readable residual for declared humanoids not staged in a slot. */
    __openClinXrActorSlotAssignment?: {
      source: "window.__openClinXrActorSlotAssignment";
      scenarioId: string;
      declaredHumanoidActorIds: string[];
      stagedActorIds: string[];
      notStagedActorIds: { actorId: string; reason: string }[];
      maxVisibleSlots: number;
    };
  }
}

export function runtimeBundleAssets(bundle: LearnerRuntimeAssetBundle): EncounterRuntimeAsset[] {
  return [
    bundle.environment,
    ...bundle.actors.map((actor) => actor.model),
    ...bundle.actors.flatMap((actor) => actor.animationClips),
    ...bundle.actors.map((actor) => actor.phonemeMap).filter((asset): asset is EncounterRuntimeAsset => Boolean(asset)),
    ...bundle.equipment.map((equipment) => equipment.model),
    ...bundle.uiSurfaces.flatMap((surface) => [surface.schema, surface.data].filter((asset): asset is EncounterRuntimeAsset => Boolean(asset))),
  ];
}

export function bundleUsesOnlyApprovedLocalFixtureAssets(bundle: LearnerRuntimeAssetBundle): boolean {
  return runtimeBundleAssets(bundle).every((asset) =>
    asset.blob.storeKind === "app_public_fixture"
      && asset.reviewStatus !== "blocked"
      && (asset.reviewStatus === "fixture_approved_for_local_runtime" || asset.reviewStatus === "approved_for_local_runtime"),
  );
}

export function shouldUseLearnerRuntimeAssetBundle(bundle: LearnerRuntimeAssetBundle): boolean {
  const learnerUseGate = evaluateEncounterRuntimeLearnerUseGate(bundle);
  return bundleUsesOnlyApprovedLocalFixtureAssets(bundle)
    || learnerUseGate.canUseGeneratedBundleForLearnerRuntime;
}

export function recordLearnerRuntimeUseGateEvidence(
  bundle: LearnerRuntimeAssetBundle,
  source: LearnerRuntimeUseGateEvidence["activeBundleSource"],
  fallbackReason: string | null,
): LearnerRuntimeUseGateEvidence {
  const learnerUseGate = evaluateEncounterRuntimeLearnerUseGate(bundle);
  const approvedLocalFixtureOnly = bundleUsesOnlyApprovedLocalFixtureAssets(bundle);
  const blockingGateIds = ENCOUNTER_LEARNER_RUNTIME_REQUIRED_GATE_IDS
    .filter((gateId) => learnerUseGate.pendingGateIds.includes(gateId));
  const actorEquipmentMaterializationGate = readRuntimeActorEquipmentMaterializationGate(bundle);
  const evidence: LearnerRuntimeUseGateEvidence = {
    ...learnerUseGate,
    source: "window.__openClinXrLearnerRuntimeUseGateEvidence",
    bundleId: bundle.bundleId,
    scenarioId: bundle.scenarioId,
    assetStoreKind: bundle.assetStoreKind,
    activeBundleSource: source,
    generatedBundleLearnerUseBlocked: !approvedLocalFixtureOnly && !learnerUseGate.canUseGeneratedBundleForLearnerRuntime,
    fallbackActive: source === "local_fixture_fallback" || fallbackReason !== null,
    fallbackReason,
    requiredGateIds: [
      "runtime_realism_evidence",
      "visual_qa_evidence",
      "quest_runtime_evidence",
    ],
    blockingGateIds,
    approvedLocalFixtureOnly,
    actorEquipmentMaterializationGate,
    claimBoundary: "learner_scene_uses_local_fixture_until_runtime_visual_quest_gates_attach",
  };
  window.__openClinXrLearnerRuntimeUseGateEvidence = evidence;
  return evidence;
}

export function resolveRuntimeSlotAssignment(bundle: LearnerRuntimeAssetBundle): RuntimeSlotAssignment {
  return assignRuntimeActorSlots(
    bundle.actors.map((actor) => ({
      actorId: actor.actorId,
      role: actor.role,
      embodiment: actor.embodiment,
    })),
  );
}

export function publishRuntimeActorSlotAssignmentEvidence(
  bundle: LearnerRuntimeAssetBundle,
  slots: RuntimeSlotAssignment,
): void {
  const declaredHumanoidActorIds = bundle.actors
    .filter((actor) => {
      if (actor.embodiment === "virtual_device" || actor.embodiment === "voice_only") return false;
      if (/_phone_|_tablet_|telehealth_system/iu.test(actor.actorId)) return false;
      return true;
    })
    .map((actor) => actor.actorId);
  const evidence = {
    source: "window.__openClinXrActorSlotAssignment" as const,
    scenarioId: bundle.scenarioId,
    declaredHumanoidActorIds,
    stagedActorIds: [...slots.stagedActorIds],
    notStagedActorIds: slots.notStagedActorIds.map((n) => ({ ...n })),
    maxVisibleSlots: 4,
  };
  window.__openClinXrActorSlotAssignment = evidence;
}
