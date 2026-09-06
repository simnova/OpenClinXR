/**
 * Scene-asset + XR-entry evidence recorders — extracted from apps/ui-xr/src/main.ts
 * (shrink-only SIZE_FREEZE). The record map lives here (module state), replacing
 * the app's sceneAssetStatusRecords map; callers keep calling the same names.
 */

import type { SceneAssetEvidence } from "@openclinxr/xr-runtime-state";

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    __openClinXrSceneAssetEvidence?: SceneAssetEvidence;
    __openClinXrXrEntryEvidence?: OpenClinXrXrEntryEvidence;
    __openClinXrDebugScene?: import("three").Scene;
    __openClinXrDeclaredEquipmentMountEvidence?: DeclaredEquipmentMountEvidence;
  }
}

export type OpenClinXrXrEntryEvidence = {
  sessionMode: "immersive-vr";
  attempts: number;
  lastStatus: "not_requested" | "requesting" | "started" | "ended" | "failed";
  lastRequestedAtMs: number | null;
  lastUpdatedAtMs: number;
  lastError: string | null;
};

/** #140 — live declared-equipment mount evidence for inspectors / captures. */
export type DeclaredEquipmentMountEvidence = {
  source: "window.__openClinXrDeclaredEquipmentMountEvidence";
  scenarioId: string;
  items: Array<{
    equipmentId: string;
    source: "gltf" | "parametric" | "fallback" | "none";
    triangleCount: number;
    meshCount: number;
  }>;
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness" | "equipment_asset_readiness">;
};

const sceneAssetStatusRecords = new Map<string, SceneAssetEvidence["assets"][number]>();

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

export function roundPerformanceNow(): number {
  return Number(performance.now().toFixed(2));
}

export function runtimeAssetAffordanceCueIds(assetId: string, affordances: readonly string[]): string[] {
  return affordances.map((affordance) => `${assetId}:${affordance}`);
}

export function recordSceneAssetStatus(input: SceneAssetEvidence["assets"][number]): SceneAssetEvidence {
  sceneAssetStatusRecords.set(input.assetId, { ...input });
  const assets = [...sceneAssetStatusRecords.values()].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const evidence: SceneAssetEvidence = {
    source: "window.__openClinXrSceneAssetEvidence",
    generatedAtMs: roundPerformanceNow(),
    expectedAssetCount: assets.length,
    loadedCount: assets.filter((asset) => asset.status === "loaded").length,
    failedCount: assets.filter((asset) => asset.status === "failed").length,
    pendingCount: assets.filter((asset) => asset.status === "pending").length,
    fallbackActiveCount: assets.filter((asset) => asset.fallbackActive).length,
    cameraFramingCue: "humanoid_camera_framing_decluttered_three_actor_environment_review",
    visualFidelityCueIds: [
      "generated_humanoid_front_fidelity_badge",
      "generated_humanoid_face_hair_eyes_scrubs_shoes_cue",
      "room_prop_label_occlusion_reduced",
      "generated_humanoid_generator_native_front_orientation_preserved",
      "humanoid_interaction_target_decluttered",
      "generated_humanoid_facial_features_unobscured",
      "visible_runtime_mouth_eye_expression_cues",
    ],
    interactionCollisionEvidence: {
      proxyCueCount: assets.filter((asset) =>
        asset.affordanceCueIds?.some((cueId) => cueId.includes("ragdoll_collision_proxy_cue")),
      ).length,
      physicsProbeMode: "runtime_proxy_cues_with_offline_rapier_gate",
      latestProbeReportPath: "docs/openclinxr/humanoid-collision-probe-active-viseme-2026-05-23.json",
      notEvidenceFor: ["production_physics_readiness", "validated_ragdoll_biomechanics", "learner_readiness"],
    },
    assets,
    productionAssetReadinessClaimed: false,
    notEvidenceFor: [
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
    ],
  };
  window.__openClinXrSceneAssetEvidence = evidence;
  return evidence;
}

export function formatSceneAssetEvidenceStatus(evidence: SceneAssetEvidence | null): string {
  if (!evidence) {
    return "generated assets pending";
  }
  return [
    `${evidence.loadedCount}/${evidence.expectedAssetCount} generated loaded`,
    evidence.failedCount === 0 ? "no load failures" : `${evidence.failedCount} failed`,
    evidence.fallbackActiveCount === 0 ? "no fallbacks active" : `${evidence.fallbackActiveCount} fallbacks active`,
    `${evidence.assets.reduce((count, asset) => count + (asset.affordanceCueIds?.length ?? 0), 0)} affordance cues`,
    `${evidence.assets.filter((asset) => asset.animationPlayback === "gltf_role_animation_clip_playing").length} role clips active`,
    ...evidence.assets
      .filter((asset) => asset.activeRoleAnimationClipName)
      .map((asset) => `${asset.sceneObjectName} ${asset.activeRoleAnimationClipName}`),
  ].join(" | ");
}

export function recordXrEntryEvidence(status: OpenClinXrXrEntryEvidence["lastStatus"], error?: unknown): void {
  const current = window.__openClinXrXrEntryEvidence ?? {
    sessionMode: "immersive-vr",
    attempts: 0,
    lastStatus: "not_requested",
    lastRequestedAtMs: null,
    lastUpdatedAtMs: Number(performance.now().toFixed(2)),
    lastError: null,
  };
  const now = Number(performance.now().toFixed(2));
  const requesting = status === "requesting";
  window.__openClinXrXrEntryEvidence = {
    sessionMode: "immersive-vr",
    attempts: current.attempts + (requesting ? 1 : 0),
    lastStatus: status,
    lastRequestedAtMs: requesting ? now : current.lastRequestedAtMs,
    lastUpdatedAtMs: now,
    lastError: error === undefined ? null : formatUnknownError(error),
  };
}

export function refreshDeclaredEquipmentMountEvidenceFromScene(
  collectItems: (scene: import("three").Scene) => DeclaredEquipmentMountEvidence["items"],
): void {
  const evidence = window.__openClinXrDeclaredEquipmentMountEvidence;
  const scene = window.__openClinXrDebugScene;
  if (!evidence || !scene) return;
  const items = collectItems(scene);
  if (items.length === 0) return;
  window.__openClinXrDeclaredEquipmentMountEvidence = { ...evidence, items };
}
