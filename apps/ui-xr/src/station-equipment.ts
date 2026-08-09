/**
 * Declared clinical equipment — mount planning + geometry re-exports (#140 / #202).
 *
 * Geometry builders live in station-equipment-builders.ts and family modules so
 * this file stays under the apps/ 600-line zone budget.
 *
 * claimScope: station equipment is driven by the shipped scene-manifest
 * equipmentPlacements / bundle equipment ids; known kinds are multi-mesh.
 * notEvidenceFor: clinical correctness of any device, Quest readiness, asset
 * production readiness, scoring.
 */

import {
  Mesh,
  type Object3D,
} from "three";
import { equipmentSuppressedByFixtureOwnership } from "./fixture-role-ownership.js";
import {
  type EquipmentMountSource,
} from "./station-equipment-builders.js";

export type { EquipmentMountSource } from "./station-equipment-builders.js";
export type { EquipmentFamily } from "./station-equipment-families.js";

export {
  buildDeclaredEquipmentGeometry,
  buildGenericClinicalEquipmentFallback,
  buildGltfEquipmentPlaceholderSlot,
  buildAbdominalDressingEquipment,
  buildAbdominalExamZoneEquipment,
  buildBedsideMonitorEquipment,
  buildBloodPressureCuffEquipment,
  buildExamTableEquipment,
  buildFetalMonitorEquipment,
  buildWallClockEquipment,
  buildWallMonitorEquipment,
  EXAM_TABLE_LENGTH_M,
  MONITOR_SCREEN_WIDTH_M,
  WALL_CLOCK_FACE_DIAMETER_M,
} from "./station-equipment-builders.js";

export {
  buildHospitalBedEquipment,
  buildSideRailsEquipment,
  buildStretcherEquipment,
  HOSPITAL_BED_DECK_TOP_M,
  HOSPITAL_BED_LENGTH_M,
  STRETCHER_EQ_DECK_TOP_M,
  STRETCHER_EQ_LENGTH_M,
} from "./station-equipment-support-surfaces.js";

/** Real equipment GLBs under apps/ui-xr/public/xr-assets/medical-equipment/. */
export const REAL_EQUIPMENT_GLTF_BY_ID: Readonly<Record<string, string>> = {
  ecg_cart_equipment: "ecg-cart-12-lead.glb",
  iv_stand_equipment: "iv-pole-with-pump.glb",
  // #244: TRELLIS-generated wall clock (34,507 tris) — the one equipment subject that
  // clears the 60k per-asset ceiling; promoted byte-identical from issue-239 evidence.
  wall_clock_equipment: "wall-clock-analog.glb",
};

export function countEquipmentGeometry(root: Object3D): { meshCount: number; triangleCount: number } {
  let meshCount = 0;
  let triangleCount = 0;
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.geometry) return;
    meshCount += 1;
    const geometry = object.geometry;
    if (geometry.index && typeof geometry.index.count === "number") {
      triangleCount += Math.floor(geometry.index.count / 3);
    } else {
      const position = geometry.getAttribute("position");
      if (position && typeof position.count === "number") {
        triangleCount += Math.floor(position.count / 3);
      }
    }
  });
  return { meshCount, triangleCount };
}

export type DeclaredEquipmentEvidenceItem = {
  equipmentId: string;
  source: EquipmentMountSource | "none";
  triangleCount: number;
  meshCount: number;
};

/** Re-scan scene roots tagged with openClinXrEquipmentId (after GLB attach). */
export function collectDeclaredEquipmentEvidenceFromScene(scene: Object3D): DeclaredEquipmentEvidenceItem[] {
  const byId = new Map<string, DeclaredEquipmentEvidenceItem>();
  scene.traverse((object) => {
    const equipmentId = object.userData?.openClinXrEquipmentId;
    if (typeof equipmentId !== "string" || equipmentId.length === 0) return;
    let ancestorTagged = false;
    let parent = object.parent;
    let depth = 0;
    while (parent && depth < 8) {
      if (typeof parent.userData?.openClinXrEquipmentId === "string" && parent.userData.openClinXrEquipmentId.length > 0) {
        ancestorTagged = true;
        break;
      }
      parent = parent.parent;
      depth += 1;
    }
    if (ancestorTagged) return;
    const counts = countEquipmentGeometry(object);
    const sourceRaw = object.userData.openClinXrEquipmentSource;
    const source: EquipmentMountSource | "none" =
      sourceRaw === "gltf" || sourceRaw === "parametric" || sourceRaw === "fallback"
        ? sourceRaw
        : "fallback";
    const prev = byId.get(equipmentId);
    if (!prev || counts.triangleCount > prev.triangleCount) {
      byId.set(equipmentId, {
        equipmentId,
        source,
        triangleCount: counts.triangleCount,
        meshCount: counts.meshCount,
      });
    }
  });
  return Array.from(byId.values());
}

export type EquipmentPlacement = {
  position: { x: number; y: number; z: number };
  label: string;
  interactionCueIds: string[];
};

export type EquipmentMountPlanItem = {
  equipmentId: string;
  label: string;
  position: { x: number; y: number; z: number };
  interactionCueIds: string[];
  source: EquipmentMountSource;
  /** Filename under /xr-assets/medical-equipment/ when source is gltf. */
  gltfFileName?: string;
  /** True when this id appears in the shipped placement map or bundle.equipment. */
  declared: boolean;
};

export type PlanStationEquipmentInput = {
  scenarioId: string;
  equipment: ReadonlyArray<{ equipmentId: string }>;
  equipmentPlacements: Readonly<Record<string, Partial<EquipmentPlacement> | undefined>>;
  /**
   * #186 — role classes already owned by environment fixture slots.
   * Equipment claiming an owned role is skipped (one mesh per role).
   */
  fixtureOwnedRoles?: ReadonlySet<string> | ReadonlyArray<string>;
};

/**
 * Default equipment mounts when a placement map is empty.
 * #169: first slot was (1.6, 0.28) — co-located with clean-encounter family framing
 * (1.42, 0.04), so chairs/exam tables bisected standing observers. Patient-side
 * offset first; doorway/wall mounts after.
 * #183: keep defaults clear of standing plants — clinical (0.64, 0.3), family (1.42, 0.04),
 * additional_cast (1.95, 0.15). Prefer walls / patient-side bay over mid-bay defaults.
 */
const DEFAULT_POSITIONS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: -1.55, y: 0, z: -0.85 },
  { x: -2.15, y: 0, z: 0.55 },
  { x: 2.25, y: 0, z: -1.05 },
  { x: -2.05, y: 0, z: -1.15 },
  { x: 2.15, y: 0, z: 0.95 },
  { x: -1.85, y: 0, z: 0.95 },
];

/** Kinds that get purpose-built multi-mesh geometry (parametric path). */
const PARAMETRIC_KINDS = new Set([
  "bedside_monitor_equipment",
  "fetal_monitor_equipment",
  "exam_table_equipment",
  "blood_pressure_cuff_equipment",
  "abdominal_exam_zone_equipment",
  "monitor_equipment",
  "iv_pump_equipment",
  "pulse_oximeter_equipment",
  "nebulizer_mask_equipment",
  "oxygen_wall_port_equipment",
  "pediatric_stretcher_equipment",
  "parent_chair_equipment",
  "inhaler_spacer_equipment",
  "chairs_equipment",
  "tissue_box_equipment",
  "post_op_bed_equipment",
  "abdominal_dressing_equipment",
  // #198 support surfaces — distinct silhouettes (not exam-table clones).
  "hospital_bed_equipment",
  "stretcher_equipment",
  "side_rails_equipment",
  // #202 family closures — grey-pole residual + deck/pump collisions.
  "safe_room_chair_equipment",
  "ehr_screen_equipment",
  "lab_results_panel_equipment",
  "tablet_visit_equipment",
  "iv_pole_equipment",
  "antipyretic_tray_equipment",
  "hydration_supplies_equipment",
  "digital_thermometer_equipment",
  "glucometer_review_equipment",
  "oxygen_nasal_cannula_equipment",
  "surgical_consult_phone_equipment",
  "observation_station_equipment",
  "12_lead_ecg_machine_equipment",
  "abdominal_exam_light_equipment",
  // #223 physical roomProp ids that need dedicated geometry (not unit-box fallback).
  "safety_plan_whiteboard_equipment",
  "ekg_leads_on_bed_equipment",
]);

/**
 * Manifest roomProp id → parametric builder arm when hyphen/suffix alone is insufficient.
 * e.g. safe-room-soft-chair → safe_room_chair_equipment (not safe_room_soft_chair_equipment).
 */
const ROOM_PROP_BUILDER_ALIASES: Readonly<Record<string, string>> = {
  "safe-room-soft-chair": "safe_room_chair_equipment",
  safe_room_soft_chair: "safe_room_chair_equipment",
  "telehealth-tablet-stand": "tablet_visit_equipment",
  telehealth_tablet_stand: "tablet_visit_equipment",
  "observer-station": "observation_station_equipment",
  observer_station: "observation_station_equipment",
  "safety-plan-whiteboard": "safety_plan_whiteboard_equipment",
  safety_plan_whiteboard: "safety_plan_whiteboard_equipment",
  "ekg-leads-on-bed": "ekg_leads_on_bed_equipment",
  ekg_leads_on_bed: "ekg_leads_on_bed_equipment",
  "chest-pain-monitor": "monitor_equipment",
  chest_pain_monitor: "monitor_equipment",
  "handoff-whiteboard": "safety_plan_whiteboard_equipment",
  handoff_whiteboard: "safety_plan_whiteboard_equipment",
  "parent-coaching-chair": "parent_chair_equipment",
  parent_coaching_chair: "parent_chair_equipment",
  "pediatric-pulse-ox-monitor": "pulse_oximeter_equipment",
  pediatric_pulse_ox_monitor: "pulse_oximeter_equipment",
  "pediatric-nebulizer-station": "nebulizer_mask_equipment",
  pediatric_nebulizer_station: "nebulizer_mask_equipment",
};

/** Count of parametric equipment builders — counterweight for real-GLB assembly work (#168). */
export function parametricEquipmentKindCount(): number {
  return PARAMETRIC_KINDS.size;
}

/**
 * #185 — true when `buildDeclaredEquipmentGeometry` has a dedicated case arm
 * (not the generic cart fallback). Room-prop channel consults this before boxing.
 */
export function hasDeclaredEquipmentBuilderArm(equipmentId: string): boolean {
  return resolveRoomPropBuilderEquipmentId(equipmentId) !== null;
}

/** Sorted dedicated builder arm ids (discoverable; do not hardcode in evidence). */
export function listDeclaredEquipmentBuilderArms(): string[] {
  return [...PARAMETRIC_KINDS].sort();
}

/**
 * #185 — resolve a roomProp propId to a parametric builder arm, or null.
 * Exact match first, then hyphen→underscore, then `_equipment` suffix.
 * Manifest ids like `monitor` / `wall-clock` map to `monitor_equipment` /
 * `wall_clock_equipment` without a second geometry SSOT.
 */
export function resolveRoomPropBuilderEquipmentId(propId: string): string | null {
  if (!propId) return null;
  if (PARAMETRIC_KINDS.has(propId)) return propId;
  const alias = ROOM_PROP_BUILDER_ALIASES[propId] ?? ROOM_PROP_BUILDER_ALIASES[propId.replace(/-/gu, "_")];
  if (alias && PARAMETRIC_KINDS.has(alias)) return alias;
  const normalized = propId.replace(/-/gu, "_");
  if (PARAMETRIC_KINDS.has(normalized)) return normalized;
  if (!normalized.endsWith("_equipment")) {
    const withSuffix = `${normalized}_equipment`;
    if (PARAMETRIC_KINDS.has(withSuffix)) return withSuffix;
  }
  return null;
}

/**
 * #223 — reverse map: builder equipment id → roomProp propIds that alias to it.
 * Stamp these as openClinXrEquipmentIdAliases so #209 declared-equipment matching
 * sees the roomProp declaration fulfilled when only the equipment channel mounts.
 */
export function roomPropIdsAliasedToEquipment(equipmentId: string): string[] {
  if (!equipmentId) return [];
  const out: string[] = [];
  for (const [propId, arm] of Object.entries(ROOM_PROP_BUILDER_ALIASES)) {
    if (arm === equipmentId && !out.includes(propId) && propId.includes("-")) {
      // Prefer hyphenated manifest propIds over underscore duplicates.
      out.push(propId);
    }
  }
  return out;
}

/** Stamp reverse roomProp aliases onto an equipment root (no extra geometry). */
export function stampRoomPropAliasesOnEquipmentRoot(
  root: { userData: Record<string, unknown> },
  equipmentId: string,
): void {
  const propIds = roomPropIdsAliasedToEquipment(equipmentId);
  if (propIds.length === 0) return;
  const aliases = Array.isArray(root.userData.openClinXrEquipmentIdAliases)
    ? (root.userData.openClinXrEquipmentIdAliases as string[])
    : [];
  for (const propId of propIds) {
    if (!aliases.includes(propId)) aliases.push(propId);
  }
  root.userData.openClinXrEquipmentIdAliases = aliases;
}

export function isEdChestPainBayScenario(scenarioId: string): boolean {
  return scenarioId === "ed_chest_pain_priority_v1" || scenarioId === "ed_chest_pain_priority_v2";
}

export function equipmentDisplayLabel(equipmentId: string): string {
  return equipmentId
    .replace(/_equipment$/u, "")
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Build the ordered list of equipment the station should mount.
 *
 * Declared ids come from equipmentPlacements keys ∪ bundle.equipment ids.
 * ED bay scenarios always keep the two real GLB assets (counterweight / historical bay)
 * even when the shipped placement map is empty.
 */
export function planStationEquipmentMounts(input: PlanStationEquipmentInput): EquipmentMountPlanItem[] {
  const declared = new Set<string>();
  for (const id of Object.keys(input.equipmentPlacements ?? {})) {
    if (id) declared.add(id);
  }
  for (const row of input.equipment) {
    if (row.equipmentId) declared.add(row.equipmentId);
  }

  const ordered: string[] = [];
  const push = (id: string) => {
    if (!id || ordered.includes(id)) return;
    ordered.push(id);
  };
  for (const id of Object.keys(input.equipmentPlacements ?? {})) push(id);
  for (const row of input.equipment) push(row.equipmentId);

  // ED bay counterweight: real ECG cart + IV pole GLBs even when placements are empty.
  if (isEdChestPainBayScenario(input.scenarioId)) {
    push("ecg_cart_equipment");
    push("iv_stand_equipment");
  }

  const owned = input.fixtureOwnedRoles
    ? input.fixtureOwnedRoles instanceof Set
      ? input.fixtureOwnedRoles
      : new Set(input.fixtureOwnedRoles)
    : null;

  return ordered
    // #186: fixture owns support/seating/architecture — do not dual-mount equipment.
    .filter((equipmentId) => {
      if (!owned || owned.size === 0) return true;
      return !equipmentSuppressedByFixtureOwnership(
        equipmentId,
        owned as Set<import("./fixture-role-ownership.js").FixtureRoleClass>,
      );
    })
    .map((equipmentId, index) => {
      const placement = input.equipmentPlacements?.[equipmentId];
      const fallbackPos = DEFAULT_POSITIONS[index % DEFAULT_POSITIONS.length] ?? DEFAULT_POSITIONS[0]!;
      const gltfFile = REAL_EQUIPMENT_GLTF_BY_ID[equipmentId];
      let source: EquipmentMountSource;
      if (gltfFile) {
        source = "gltf";
      } else if (PARAMETRIC_KINDS.has(equipmentId)) {
        source = "parametric";
      } else {
        source = "fallback";
      }
      // #179: post_op bed is the sole patient support (equipment path). Manifest ships it
      // at the standing OFFSET (-2.05,-0.75). Runtime supine plant hard-centers on
      // DEFAULT_STRETCHER_POSITION (-0.9,-0.1) — co-locate the deck under that plant.
      // Rejected: fixture + equipment (double-bed #133); rejected: editing generated manifests.
      // #186: when fixture stretcher owns support_surface, this id is filtered above.
      const plantAlignedBed =
        equipmentId === "post_op_bed_equipment"
          ? { x: -0.9, y: 0, z: -0.1 }
          : null;
      const position = plantAlignedBed
        ?? (placement?.position
          ? { x: placement.position.x, y: placement.position.y, z: placement.position.z }
          : { ...fallbackPos });
      return {
        equipmentId,
        label: placement?.label ?? equipmentDisplayLabel(equipmentId),
        position,
        interactionCueIds: Array.isArray(placement?.interactionCueIds) && placement.interactionCueIds.length > 0
          ? [...placement.interactionCueIds]
          : [
              `${equipmentId}:selectable_equipment_reference`,
              `${equipmentId}:clinical_workflow_cue`,
            ],
        source,
        ...(gltfFile ? { gltfFileName: gltfFile } : {}),
        declared: declared.has(equipmentId),
      };
    });
}

