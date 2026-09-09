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
  Box3,
  type Group,
  Mesh,
  type Object3D,
} from "three";
import { equipmentSuppressedByFixtureOwnership } from "./fixture-role-ownership.js";
import {
  buildGltfEquipmentStandSupport,
  type EquipmentMountSource,
} from "./station-equipment-builders.js";
import { measureParametricComposite } from "./station-equipment-composite-measure.js";
import {
  PARAMETRIC_KINDS,
  resolveRoomPropBuilderEquipmentId,
} from "./room-prop-classification.js";
import {
  stampSupportSurfaceDeckMetadata,
  SUPPORT_SURFACE_DECK_TOP_BY_EQUIPMENT_ID,
} from "./station-equipment-support-deck.js";
import { REAL_EQUIPMENT_GLTF_BY_ID, equipmentDisplayLabel } from "./station-equipment-catalog.js";
import {
  buildRealizedEquipmentMountItem,
  copyPlacementKeysInMapOrder,
  equipmentIdForStationPlacement,
  orderRealizedEquipmentPlacementIds,
  resolveRealizedEquipmentAssetId,
  rowEquipmentAssetIds,
  type EquipmentMountPlanItem,
} from "./station-equipment-mount-order.js";

export type { EquipmentMountPlanItem } from "./station-equipment-mount-order.js";
export { REAL_EQUIPMENT_GLTF_BY_ID, equipmentDisplayLabel } from "./station-equipment-catalog.js";

export type { EquipmentMountSource } from "./station-equipment-builders.js";
export type { EquipmentFamily } from "./station-equipment-families.js";
export {
  stampSupportSurfaceDeckMetadata,
  SUPPORT_SURFACE_DECK_TOP_BY_EQUIPMENT_ID,
};

// #347 split: the roomProp→builder-arm resolver lives in room-prop-classification.js
// (a leaf module) so this file stays under the apps/ 600-line zone budget. Re-exported
// here to preserve existing imports (room-prop-geometry, main).
export {
  resolveRoomPropBuilderEquipmentId,
  roomPropIdsAliasedToEquipment,
  stampRoomPropAliasesOnEquipmentRoot,
} from "./room-prop-classification.js";

export {
  buildDeclaredEquipmentGeometry,
  buildGenericClinicalEquipmentFallback,
  buildGltfEquipmentPlaceholderSlot,
  buildGltfEquipmentStandSupport,
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
  // #347 MADR 0055 item 5 — reusable scale-setting wall prop builders.
  buildWallOutletPlateEquipment,
  buildLightSwitchEquipment,
  buildHandGelDispenserEquipment,
  buildCurtainTrackEquipment,
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

/** Real equipment GLBs — catalog lives in station-equipment-catalog.js. */

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
  equipmentId?: string | undefined;
  position: { x: number; y: number; z: number };
  label: string;
  interactionCueIds: string[];
};

export type { EquipmentMountPlanItem } from "./station-equipment-mount-order.js";

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
 * Default equipment mounts — positions live in station-equipment-positions.js.
 */

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

export function isEdChestPainBayScenario(scenarioId: string): boolean {
  return scenarioId === "ed_chest_pain_priority_v1" || scenarioId === "ed_chest_pain_priority_v2";
}

/**
 * #258 — placements with |Y| below this are FLOOR placements: the object stands on
 * the floor with its base at the placement Y (the parametric bedside monitor /
 * exam table / fetal monitor convention). Placements at or above it are ELEVATED
 * mounts where the placement Y is the mount height and origin-centered geometry is
 * correct (wall clock, O2 wall port, inhaler — the builders stamp
 * openClinXrEquipmentLocalYPolicy = "origin_centered_mount_height_from_placement_root").
 */
export const EQUIPMENT_FLOOR_PLACEMENT_EPSILON_M = 0.05;

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * #266 — fit a unit-normalized gltf-sourced equipment's footprint to its declared
 * placement envelope.
 * #268 — fit UNIFORMLY (single factor on all three axes), never per-axis.
 *
 * TRELLIS image-to-3D exports are unit-normalized: the bake pipeline spans the
 * mesh to ±0.5 on the dominant axes (bedside-monitor-generated.glb spans exactly
 * ±0.5 on x/z → 1.00 m wide). The placement descriptor was authored against the
 * parametric composite's footprint (the composite this GLB replaced: 0.38 m wide
 * × 0.22 m deep), so a unit cube renders 2.6× too wide and occludes adjacent
 * actors. #258 fixed the object-centered TRANSLATE (grounding) and never touched
 * scale — this is the scale half of the same statement.
 *
 * The declared envelope = the id's parametric composite total AABB (x/z spans).
 * Only ids with a DEDICATED parametric builder have one; the ED bay library GLBs
 * (ecg cart / IV pole, deliberate Blender fixture sizes) resolve to the generic
 * fallback composite and are untouched. Elevated placements (the wall clock
 * control) keep origin-centered mount-height semantics and are untouched.
 *
 * #268 — the factor is UNIFORM: scale = min(1, envW/glbW, envD/glbD) applied to
 * all three axes, the largest single factor that keeps the mesh inside its
 * declared envelope. Per-axis scaling (the #266 original) squashed the aspect:
 * a landscape monitor (source 1.00 × 0.81, aspect 1.23) rendered portrait
 * (0.38 × 0.81, aspect 0.47) — measured in issue-268/pre-fix.json
 * (relative aspect deviation 0.62). Uniform scaling preserves aspect; the
 * asset gets smaller, never stretched, and never scaled up. The three fixes
 * compose into one rule:
 * a generated GLB is object-centered and unit-normalized, so mounting it
 * requires translate (#258) + preserve-composite-stand (#260) + uniform
 * fit-to-envelope (this). Every future generated equipment asset needs all three.
 */
export function applyGltfEquipmentFootprintFit(equipment: Group, equipmentId: string): void {
  const composite = measureParametricComposite(equipmentId);
  if (composite.source !== "parametric") return;
  const envelopeWidth = composite.totalAabbMax.x - composite.totalAabbMin.x;
  const envelopeDepth = composite.totalAabbMax.z - composite.totalAabbMin.z;
  if (envelopeWidth <= 0 || envelopeDepth <= 0) return;
  const bounds = new Box3().setFromObject(equipment);
  const glbWidth = bounds.max.x - bounds.min.x;
  const glbDepth = bounds.max.z - bounds.min.z;
  if (glbWidth <= 0 || glbDepth <= 0) return;
  // #268 — a single factor on all three axes: the largest that keeps the mesh
  // inside its declared envelope. Aspect is preserved; the asset gets smaller,
  // never stretched (and never scaled up, matching the pre-#268 shrink-only rule).
  const scale = Math.min(1, envelopeWidth / glbWidth, envelopeDepth / glbDepth);
  if (scale === 1) return;
  equipment.scale.x = (equipment.scale.x ?? 1) * scale;
  equipment.scale.y = (equipment.scale.y ?? 1) * scale;
  equipment.scale.z = (equipment.scale.z ?? 1) * scale;
  equipment.userData.openClinXrEquipmentFootprintFit = {
    scale: round3(scale),
    envelopeWidthM: round3(envelopeWidth),
    envelopeDepthM: round3(envelopeDepth),
    glbWidthM: round3(glbWidth),
    glbDepthM: round3(glbDepth),
    glbHeightM: round3(bounds.max.y - bounds.min.y),
  };
}

/**
 * #258 — normalize a freshly loaded equipment GLB to the placement descriptor's
 * convention. TRELLIS image-to-3D exports are object-centered (geometry spans
 * ±half-size around the origin), while floor placements (Y≈0) are authored against
 * the parametric builders' base-on-floor convention. Grounding by the measured
 * local min-Y puts the object's base on the floor instead of half-buried below it.
 * Elevated placements (Y>0) keep origin-centered mount-height semantics untouched.
 *
 * #260 — hybrid mounts. When the id's parametric composite emits a FLOOR STAND
 * (base + pole) under its body, grounding the body GLB at floor level would drop
 * the stand (the composite's working height came from the stand, not the
 * descriptor). For those ids the stand stays parametric and the GLB body mounts
 * ON it (MADR 0050 step 10 hybrid) — the body's base rests on the stand top.
 *
 * #266 — footprint fit. A generated GLB is not only object-centered but
 * unit-normalized (spans ±0.5 on x/z), so a floor mount also needs SCALING to
 * its declared placement envelope — the parametric composite footprint — before
 * the translate/stand passes below run. #268 — that scaling is UNIFORM (one
 * factor on all three axes), so aspect is preserved; per-axis scaling squashed
 * a landscape monitor into portrait.
 *
 * This is a general convention adapter, not a per-asset placement fudge: no
 * per-equipment constants beyond the stand builder and the composite footprint.
 * Wall clock (y=1.55, elevated, no stand) is unaffected.
 */
export function normalizeGltfEquipmentMount(
  equipment: Group,
  mountSlot: Group,
): Group {
  const isFloor = Math.abs(mountSlot.position.y) < EQUIPMENT_FLOOR_PLACEMENT_EPSILON_M;
  const equipmentId =
    typeof mountSlot.userData?.openClinXrEquipmentId === "string"
      ? mountSlot.userData.openClinXrEquipmentId
      : null;
  // #266 — fit a unit-normalized GLB's footprint to its declared placement
  // envelope (floor placements only; the wall-clock control is elevated and
  // keeps its origin-centered mount-height semantics). Applied BEFORE the
  // stand/grounding passes so their Box3 measurements read the scaled bounds.
  if (isFloor && equipmentId !== null) {
    applyGltfEquipmentFootprintFit(equipment, equipmentId);
  }
  const stand = equipmentId !== null && isFloor ? buildGltfEquipmentStandSupport(equipmentId) : null;
  if (stand) {
    // #260 hybrid: the parametric stand stays, the GLB body rests on its top.
    const glbBounds = new Box3().setFromObject(equipment);
    const standBounds = new Box3().setFromObject(stand);
    equipment.position.y = standBounds.max.y - glbBounds.min.y;
    mountSlot.add(stand);
    return equipment;
  }
  if (!isFloor) {
    stampSupportSurfaceDeckMetadata(equipment, equipmentId);
    return equipment;
  }
  const bounds = new Box3().setFromObject(equipment);
  if (bounds.min.y < 0) {
    equipment.position.y -= bounds.min.y;
  }
  stampSupportSurfaceDeckMetadata(equipment, equipmentId);
  if (equipmentId) {
    stampSupportSurfaceDeckMetadata(mountSlot, equipmentId);
  }
  return equipment;
}

/**
 * Build the ordered list of equipment the station should mount.
 *
 * Declared ids come from equipmentPlacements keys ∪ bundle.equipment ids.
 * ED bay scenarios always keep the two real GLB assets (counterweight / historical bay)
 * even when the shipped placement map is empty.
 *
 * Ordering is by realized placement id (station-equipment-mount-order.js): two
 * copies of one asset id produce two mount items, while two references to the
 * same realized placement still produce one.
 */
export function planStationEquipmentMounts(input: PlanStationEquipmentInput): EquipmentMountPlanItem[] {
  const placements = input.equipmentPlacements ?? {};
  const declared = new Set<string>();
  for (const id of Object.keys(placements)) {
    if (id) declared.add(equipmentIdForStationPlacement(placements, id));
  }
  for (const row of input.equipment) {
    if (row.equipmentId) declared.add(row.equipmentId);
  }

  const ordered = orderRealizedEquipmentPlacementIds(input, placements);

  // ED bay counterweight: real ECG cart + IV pole GLBs even when placements are empty.
  const push = (id: string) => {
    if (!id || ordered.includes(id)) return;
    ordered.push(id);
  };
  if (isEdChestPainBayScenario(input.scenarioId)) {
    push("ecg_cart_equipment");
    push("iv_stand_equipment");
  }

  const rowAssetIds = rowEquipmentAssetIds(input.equipment);
  const copyKeysInMapOrder = copyPlacementKeysInMapOrder(placements, rowAssetIds);

  const owned = input.fixtureOwnedRoles
    ? input.fixtureOwnedRoles instanceof Set
      ? input.fixtureOwnedRoles
      : new Set(input.fixtureOwnedRoles)
    : null;

  return ordered
    // #186: fixture owns support/seating/architecture — do not dual-mount equipment.
    .filter((placementId) => {
      if (!owned || owned.size === 0) return true;
      const assetId = resolveRealizedEquipmentAssetId(placements, rowAssetIds, copyKeysInMapOrder, placementId);
      return !equipmentSuppressedByFixtureOwnership(
        assetId,
        owned as Set<import("./fixture-role-ownership.js").FixtureRoleClass>,
      );
    })
    .map((placementId, index) => {
      const equipmentId = resolveRealizedEquipmentAssetId(placements, rowAssetIds, copyKeysInMapOrder, placementId);
      return buildRealizedEquipmentMountItem(placements, placementId, equipmentId, index, declared);
    });
}

