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
  Group,
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

/** Real equipment GLBs under apps/ui-xr/public/xr-assets/medical-equipment/. */
export const REAL_EQUIPMENT_GLTF_BY_ID: Readonly<Record<string, string>> = {
  ecg_cart_equipment: "ecg-cart-12-lead.glb",
  iv_stand_equipment: "iv-pole-with-pump.glb",
  // #244: TRELLIS-generated wall clock (34,507 tris) — the first equipment subject to
  // clear the 60k per-asset ceiling; promoted byte-identical from issue-239 evidence.
  wall_clock_equipment: "wall-clock-analog.glb",
  // #253: TRELLIS-generated bedside monitor (60,000 tris) — second equipment subject to
  // clear the 60k per-asset ceiling; promoted byte-identical from issue-250 evidence.
  bedside_monitor_equipment: "bedside-monitor-generated.glb",
  // Sketchfab CC BY 4.0 bank (2026-08-12): measure-first normalize → deck/length SSOT.
  // Provenance sidecars + PROVENANCE.md carry attribution strings (#193).
  hospital_bed_equipment: "hospital-bed-sketchfab-ccby.glb",
  stretcher_equipment: "stretcher-sketchfab-ccby.glb",
  exam_table_equipment: "exam-table-sketchfab-ccby.glb",
  privacy_curtain_equipment: "privacy-curtain-monitor-sketchfab-ccby.glb",
  // #646: Kenney Furniture Kit CC0 — promoted via kenney-promote-cli.ts (seat-height
  // normalize: detected seat 0.24 m -> 0.45 m, scale 1.875 baked into vertices). CC0 needs
  // no attribution surface. Staging kit untouched; provenance sidecar records both hashes.
  chairs_equipment: "clinic-chair-kenney-cc0.glb",
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

export function equipmentDisplayLabel(equipmentId: string): string {
  return equipmentId
    .replace(/_equipment$/u, "")
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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

