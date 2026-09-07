import type { EnvironmentStateEvidence } from "@openclinxr/xr-runtime-state";
import type { Group } from "three";
import { BoxGeometry, Color, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import type { SceneCueEnvironmentVisualContext, SceneCueTraceVisualContext } from "./types.js";

export function applyRuntimeEquipmentTraceVisuals(ctx: SceneCueTraceVisualContext, evidence: EnvironmentStateEvidence): void {
  const activeEquipmentIds = new Set(evidence.activePropIds);
  for (const [assetId, slot] of ctx.equipmentSlots) {
    const active = activeEquipmentIds.has(assetId);
    const marker = ensureRuntimeEquipmentTraceMarker(ctx, slot, assetId);
    marker.visible = active;
    slot.userData["openClinXrTraceLinkedEquipmentActive"] = active;
    slot.userData["openClinXrTraceLinkedActiveTraceTags"] = active
      ? evidence.activeTraceTags.filter((tag) => ctx.equipmentIdsForTag(tag).includes(assetId))
      : [];
  }
}

export function ensureRuntimeEquipmentTraceMarker(ctx: SceneCueTraceVisualContext, slot: Group, assetId: string): Mesh {
  const markerName = `${ctx.scenarioObjectPrefix}.equipment-trace-active.${assetId}`;
  const existing = slot.children.find((child): child is Mesh => child instanceof Mesh && child.name === markerName);
  if (existing) {
    return existing;
  }
  const marker = new Mesh(
    new BoxGeometry(0.28, 0.035, 0.028),
    new MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.82 }),
  );
  marker.name = markerName;
  marker.position.set(0, 0.72, 0);
  marker.userData["openClinXrTraceLinkedEquipmentCue"] =
    "active_when_case_trace_references_this_runtime_equipment";
  marker.visible = false;
  slot.add(marker);
  return marker;
}

export function runtimeEquipmentIdsForTag(bundleEquipmentIds: readonly string[], tag: string): string[] {
  const includes = (pattern: RegExp) => bundleEquipmentIds.filter((equipmentId) => pattern.test(equipmentId));
  if (/oxygen|spo2|saturation|vitals/i.test(tag)) {
    return includes(/oxygen|pulse_ox|monitor|wall_port/i);
  }
  if (/bronchodilator|nebulizer|inhaler|spacer/i.test(tag)) {
    return includes(/nebulizer|inhaler|spacer|oxygen/i);
  }
  if (/trigger/i.test(tag)) {
    return includes(/parent_chair|stretcher|bed/i);
  }
  if (/urgent|escalation|safety/i.test(tag)) {
    return includes(/oxygen|pulse_ox|parent_chair|stretcher|bed/i);
  }
  if (/work_of_breathing|assessment|exam/i.test(tag)) {
    return includes(/stretcher|bed|pulse_ox|monitor/i);
  }
  if (/parent|family|guardian|empathy|communication/i.test(tag)) {
    return includes(/parent_chair|stretcher|bed/i);
  }
  if (/note|documentation/i.test(tag)) {
    return includes(/stretcher|bed|parent_chair|pulse_ox|monitor/i);
  }
  return [];
}

export function applyEnvironmentStateVisuals(ctx: SceneCueEnvironmentVisualContext, evidence: EnvironmentStateEvidence): void {
  const activeProps = new Set(evidence.activePropIds);
  for (const [propId, group] of ctx.reactiveProps) {
    const active = activeProps.has(propId);
    group.userData["openClinXrEnvironmentStateActive"] = active;
    group.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof MeshBasicMaterial) {
        object.material.opacity = active ? 0.95 : 0.82;
      }
      if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) {
        const material = object.material;
        const baseColorHex = typeof material.userData["openClinXrBaseColorHex"] === "number"
          ? material.userData["openClinXrBaseColorHex"]
          : material.color.getHex();
        material.userData["openClinXrBaseColorHex"] = baseColorHex;
        material.color.copy(new Color(baseColorHex)).lerp(new Color(0xfff2a8), active ? 0.32 : 0);
        material.emissive.setHex(active ? 0x3a2f08 : 0x000000);
        material.emissiveIntensity = active ? 0.35 : 0;
        material.needsUpdate = true;
      }
    });
    group.scale.setScalar(active ? 1.08 : 1);
  }
  const alarmActive = evidence.alarmCueMode === "visual_only_no_audio";
  for (const propId of ["ceiling-exam-light", "monitor-waveform-card"]) {
    const group = ctx.reactiveProps.get(propId);
    if (group) {
      group.userData["openClinXrVisualAlarmCue"] = alarmActive ? evidence.alarmState : "quiet";
    }
  }
}

