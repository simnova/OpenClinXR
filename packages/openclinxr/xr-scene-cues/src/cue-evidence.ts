import type { ActorPosture } from "@openclinxr/asset-registry";
import type { Group, Scene } from "three";
import { BoxGeometry, CylinderGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import type {
  DynamicSceneObjectNamingEvidence,
  SceneCueActorFramingContext,
  SceneCueNamingEvidenceContext,
  SceneCuePediatricCueEvidenceContext,
  SceneCuePediatricEquipmentContext,
  SceneCueRoleCueEvidenceContext,
} from "./types.js";

export function recordDynamicSceneObjectNamingEvidence(ctx: SceneCueNamingEvidenceContext, scene: Scene): DynamicSceneObjectNamingEvidence {
  const namedObjects: string[] = [];
  scene.traverse((object) => {
    if (object.name.trim().length > 0) namedObjects.push(object.name);
  });
  const scenarioPrefix = `${ctx.scenarioObjectPrefix}.`;
  const stableIwsdkObjectNameSet = new Set<string>(ctx.stableIwsdkObjectNames);
  const stableIwsdkLegacyObjectNames = namedObjects.filter((name) => stableIwsdkObjectNameSet.has(name));
  const stableIwsdkLegacyObjectNameSet = new Set(stableIwsdkLegacyObjectNames);
  const hardcodedEdPrefixLeakNames = namedObjects.filter((name) =>
    name.startsWith("openclinxr.ed-chest-pain.") && !stableIwsdkLegacyObjectNameSet.has(name)
  );
  const sampleScenarioPrefixedObjectNames = namedObjects.filter((name) => name.startsWith(scenarioPrefix)).slice(0, 40);
  const evidence: DynamicSceneObjectNamingEvidence = {
    source: "window.__openClinXrDynamicSceneObjectNamingEvidence",
    scenarioId: ctx.scenarioId,
    selectedScenarioId: ctx.selectedScenarioId,
    selectedScenarioMatchesBundle: ctx.selectedScenarioMatchesBundle,
    totalNamedObjects: namedObjects.length,
    scenarioPrefixedObjectCount: namedObjects.filter((name) => name.startsWith(scenarioPrefix)).length,
    stableIwsdkLegacyObjectNameCount: stableIwsdkLegacyObjectNames.length,
    stableIwsdkLegacyObjectNames: stableIwsdkLegacyObjectNames.slice(0, 40),
    hardcodedEdPrefixLeakCount: hardcodedEdPrefixLeakNames.length,
    hardcodedEdPrefixLeakNames: hardcodedEdPrefixLeakNames.slice(0, 40),
    sampleScenarioPrefixedObjectNames,
    notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness"],
  };
  window.__openClinXrDynamicSceneObjectNamingEvidence = evidence;
  return evidence;
}

export function recordRoleDistinctHumanoidCue(ctx: SceneCueRoleCueEvidenceContext, actorId: string, cueId: string, sceneObjectName: string): void {
  const existing = window.__openClinXrRoleDistinctHumanoidCueEvidence;
  const cues = existing?.cues ?? [];
  if (!cues.some((cue) => cue.actorId === actorId && cue.cueId === cueId && cue.sceneObjectName === sceneObjectName)) {
    cues.push({
      actorId,
      role: ctx.runtimeActorRole(actorId) ?? null,
      cueId,
      sceneObjectName,
    });
  }
  window.__openClinXrRoleDistinctHumanoidCueEvidence = {
    source: "window.__openClinXrRoleDistinctHumanoidCueEvidence",
    scenarioId: ctx.scenarioId,
    cueCount: cues.length,
    cues,
    notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness", "animation_quality"],
  };
}

export function addPediatricRespiratoryEquipmentCues(ctx: SceneCuePediatricEquipmentContext, record: (equipmentId: string, cueId: string, sceneObjectName: string) => void, slot: Group, equipmentId: string): void {
  if (!ctx.isPediatricScenario()) return;
  const key = equipmentId.toLowerCase();
  const addCue = (mesh: Mesh, cueId: string, localPosition: { x: number; y: number; z: number }, rotationZ = 0): void => {
    mesh.name = `${ctx.scenarioObjectPrefix}.equipment-cue.${cueId}`;
    mesh.position.set(localPosition.x, localPosition.y, localPosition.z);
    mesh.rotation.z = rotationZ;
    slot.add(mesh);
    record(equipmentId, cueId, mesh.name);
  };
  if (/nebulizer|mask/u.test(key)) {
    addCue(
      new Mesh(new BoxGeometry(0.22, 0.12, 0.035), new MeshStandardMaterial({ color: 0xe8f4fb, roughness: 0.5, transparent: true, opacity: 0.82 })),
      "pediatric_nebulizer_mask_readability_cue",
      { x: 0, y: 1.02, z: -0.24 },
    );
    addCue(
      new Mesh(new CylinderGeometry(0.01, 0.01, 0.76, 8), new MeshStandardMaterial({ color: 0xd9efff, roughness: 0.46, transparent: true, opacity: 0.82 })),
      "pediatric_nebulizer_tubing_line_cue",
      { x: -0.22, y: 0.72, z: -0.16 },
      0.94,
    );
  }
  if (/oxygen|wall_port/u.test(key)) {
    addCue(
      new Mesh(new CylinderGeometry(0.05, 0.05, 0.045, 18), new MeshStandardMaterial({ color: 0x92d3f5, roughness: 0.42 })),
      "oxygen_wall_port_round_connector_cue",
      { x: 0.16, y: 1.08, z: -0.18 },
    );
    addCue(
      new Mesh(new CylinderGeometry(0.008, 0.008, 0.9, 8), new MeshStandardMaterial({ color: 0xdaf1ff, roughness: 0.44, transparent: true, opacity: 0.78 })),
      "oxygen_tubing_clear_line_cue",
      { x: -0.16, y: 0.72, z: -0.2 },
      -0.72,
    );
  }
  if (/pulse_ox|oximeter|monitor/u.test(key)) {
    addCue(
      new Mesh(new BoxGeometry(0.12, 0.045, 0.08), new MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 })),
      "pulse_ox_finger_clip_readability_cue",
      { x: -0.18, y: 0.82, z: -0.2 },
    );
    addCue(
      new Mesh(new BoxGeometry(0.18, 0.08, 0.02), new MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.72 })),
      "pulse_ox_spo2_screen_91_cue",
      { x: 0.06, y: 1.08, z: -0.205 },
    );
  }
  if (/stretcher|bed/u.test(key)) {
    addCue(
      new Mesh(new BoxGeometry(0.72, 0.035, 0.03), new MeshStandardMaterial({ color: 0x9fb4c7, roughness: 0.68, transparent: true, opacity: 0.5 })),
      "low_translucent_pediatric_bed_rail_cue",
      { x: 0, y: 0.82, z: -0.24 },
    );
  }
}

export function recordPediatricRespiratoryEquipmentCue(ctx: SceneCuePediatricCueEvidenceContext, equipmentId: string, cueId: string, sceneObjectName: string): void {
  const existing = window.__openClinXrPediatricRespiratoryEquipmentCueEvidence;
  const cues = existing?.cues ?? [];
  if (!cues.some((cue) => cue.equipmentId === equipmentId && cue.cueId === cueId && cue.sceneObjectName === sceneObjectName)) {
    cues.push({ equipmentId, cueId, sceneObjectName });
  }
  window.__openClinXrPediatricRespiratoryEquipmentCueEvidence = {
    source: "window.__openClinXrPediatricRespiratoryEquipmentCueEvidence",
    scenarioId: ctx.scenarioId,
    cueCount: cues.length,
    cues,
    notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness", "equipment_asset_readiness"],
  };
}

export function applyCleanEncounterVisualReviewActorFraming(ctx: SceneCueActorFramingContext, actor: Group, actorId: string): void {
  // #83: frame from the SELECTED scenario (URL), not the local ED fixture bundle id.
  // Telehealth patient_chair seating never applied while bundle stayed ed_chest_pain_*.
  ctx.applyActorFraming({
    actor,
    actorId,
    scenarioId: ctx.selectedScenarioId(),
    role: ctx.runtimeActorRole(actorId) ?? String(actor.userData["openClinXrActorRole"] ?? ""),
    posture: (actor.userData["openClinXrActorPosture"] as ActorPosture | undefined) ?? undefined,
    skipFraming:
      ctx.skipFraming,
    onWardrobeCue: ctx.onWardrobeCue,
  });
}

