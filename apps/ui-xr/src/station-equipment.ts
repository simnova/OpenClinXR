/**
 * Declared clinical equipment — parametric builders + mount planning (#140).
 *
 * Pattern: station-chair.ts / station-stretcher.ts — a descriptor/id drives a
 * TypeScript builder that returns a multi-mesh Group. Not image-to-3D.
 *
 * Dimensions live here as named constants (clinical-scale placeholders for local
 * learner layout — not measured from physical devices).
 *
 * claimScope: station equipment is driven by the shipped scene-manifest
 * equipmentPlacements / bundle equipment ids; known kinds are multi-mesh.
 * notEvidenceFor: clinical correctness of any device, Quest readiness, asset
 * production readiness, scoring.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
  type Object3D,
} from "three";

/** Real equipment GLBs under apps/ui-xr/public/xr-assets/medical-equipment/. */
export const REAL_EQUIPMENT_GLTF_BY_ID: Readonly<Record<string, string>> = {
  ecg_cart_equipment: "ecg-cart-12-lead.glb",
  iv_stand_equipment: "iv-pole-with-pump.glb",
};

export type EquipmentMountSource = "gltf" | "parametric" | "fallback";

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

/** Wall clock: face diameter (m). */
export const WALL_CLOCK_FACE_DIAMETER_M = 0.32;
/** Bedside / fetal monitor screen diagonal-ish width (m). */
export const MONITOR_SCREEN_WIDTH_M = 0.38;
/** Exam table mattress length (m). */
export const EXAM_TABLE_LENGTH_M = 1.85;

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
};

/**
 * Default equipment mounts when a placement map is empty.
 * #169: first slot was (1.6, 0.28) — co-located with clean-encounter family framing
 * (1.42, 0.04), so chairs/exam tables bisected standing observers. Patient-side
 * offset first; doorway/wall mounts after.
 */
const DEFAULT_POSITIONS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: -1.55, y: 0, z: -0.85 },
  { x: 0.95, y: 0, z: 0.98 },
  { x: 2.15, y: 0, z: -0.55 },
  { x: -0.62, y: 0, z: -0.58 },
  { x: -1.72, y: 0, z: 0.28 },
  { x: 1.9, y: 0, z: 0.82 },
];

/** Kinds that get purpose-built multi-mesh geometry in this slice. */
const PARAMETRIC_KINDS = new Set([
  "wall_clock_equipment",
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
]);

/** Count of parametric equipment builders — counterweight for real-GLB assembly work (#168). */
export function parametricEquipmentKindCount(): number {
  return PARAMETRIC_KINDS.size;
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

  return ordered.map((equipmentId, index) => {
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
    return {
      equipmentId,
      label: placement?.label ?? equipmentDisplayLabel(equipmentId),
      position: placement?.position
        ? { x: placement.position.x, y: placement.position.y, z: placement.position.z }
        : { ...fallbackPos },
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

function mat(color: ColorRepresentation, roughness = 0.55, metalness = 0.12): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function tagEquipmentRoot(
  root: Group,
  equipmentId: string,
  source: EquipmentMountSource,
): Group {
  root.userData.openClinXrEquipmentId = equipmentId;
  root.userData.openClinXrEquipmentSource = source;
  root.userData.openClinXrRuntimeEquipmentAssetId = equipmentId;
  root.userData.openClinXrAffordances = ["selectable_equipment_reference", "clinical_workflow_cue"];
  return root;
}

/** Wall clock: housing + face + two hands (≥4 meshes). */
export function buildWallClockEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const housing = new Mesh(
    new CylinderGeometry(WALL_CLOCK_FACE_DIAMETER_M / 2 + 0.02, WALL_CLOCK_FACE_DIAMETER_M / 2 + 0.02, 0.05, 24),
    mat(0x2f3540, 0.5, 0.25),
  );
  housing.name = `${root.name}.housing`;
  housing.rotation.x = Math.PI / 2;
  housing.position.set(0, 1.55, 0);
  const face = new Mesh(
    new CylinderGeometry(WALL_CLOCK_FACE_DIAMETER_M / 2, WALL_CLOCK_FACE_DIAMETER_M / 2, 0.015, 24),
    mat(0xf5f0e6, 0.85, 0),
  );
  face.name = `${root.name}.face`;
  face.rotation.x = Math.PI / 2;
  face.position.set(0, 1.55, 0.02);
  const hour = new Mesh(new BoxGeometry(0.02, 0.09, 0.01), mat(0x1a1a1a, 0.6, 0.05));
  hour.name = `${root.name}.hour_hand`;
  hour.position.set(0.02, 1.55, 0.035);
  hour.rotation.z = -0.4;
  const minute = new Mesh(new BoxGeometry(0.015, 0.12, 0.01), mat(0x111111, 0.6, 0.05));
  minute.name = `${root.name}.minute_hand`;
  minute.position.set(-0.03, 1.58, 0.036);
  minute.rotation.z = 0.9;
  root.add(housing, face, hour, minute);
  return tagEquipmentRoot(root, equipmentId, "parametric");
}

/** Bedside vitals monitor: base + pole + bezel + screen. */
export function buildBedsideMonitorEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const base = new Mesh(new BoxGeometry(0.28, 0.04, 0.22), mat(0x374151, 0.55, 0.2));
  base.name = `${root.name}.base`;
  base.position.set(0, 0.02, 0);
  const pole = new Mesh(new CylinderGeometry(0.025, 0.03, 0.95, 10), mat(0x9ca3af, 0.4, 0.45));
  pole.name = `${root.name}.pole`;
  pole.position.set(0, 0.5, 0);
  const bezel = new Mesh(
    new BoxGeometry(MONITOR_SCREEN_WIDTH_M, 0.28, 0.06),
    mat(0x111827, 0.5, 0.15),
  );
  bezel.name = `${root.name}.bezel`;
  bezel.position.set(0, 1.05, 0);
  const screen = new Mesh(
    new BoxGeometry(MONITOR_SCREEN_WIDTH_M - 0.04, 0.22, 0.02),
    mat(0x0ea5e9, 0.35, 0.05),
  );
  screen.name = `${root.name}.screen`;
  screen.position.set(0, 1.05, 0.035);
  root.add(base, pole, bezel, screen);
  return tagEquipmentRoot(root, equipmentId, "parametric");
}

/** Fetal monitor cart: body + screen + probe rest. */
export function buildFetalMonitorEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const body = new Mesh(new BoxGeometry(0.42, 0.55, 0.32), mat(0xe5e7eb, 0.65, 0.08));
  body.name = `${root.name}.body`;
  body.position.set(0, 0.55, 0);
  const screen = new Mesh(new BoxGeometry(0.34, 0.22, 0.04), mat(0x0369a1, 0.4, 0.05));
  screen.name = `${root.name}.screen`;
  screen.position.set(0, 0.95, 0.14);
  const probe = new Mesh(new CylinderGeometry(0.035, 0.04, 0.12, 12), mat(0xf8fafc, 0.5, 0.1));
  probe.name = `${root.name}.probe`;
  probe.position.set(0.18, 0.72, 0.1);
  const base = new Mesh(new BoxGeometry(0.48, 0.06, 0.38), mat(0x4b5563, 0.55, 0.2));
  base.name = `${root.name}.base`;
  base.position.set(0, 0.03, 0);
  root.add(base, body, screen, probe);
  return tagEquipmentRoot(root, equipmentId, "parametric");
}

/** Exam table: base + mattress + pillow + side rail. */
export function buildExamTableEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const base = new Mesh(new BoxGeometry(EXAM_TABLE_LENGTH_M * 0.9, 0.12, 0.62), mat(0x6b7280, 0.5, 0.25));
  base.name = `${root.name}.base`;
  base.position.set(0, 0.35, 0);
  const mattress = new Mesh(new BoxGeometry(EXAM_TABLE_LENGTH_M, 0.1, 0.7), mat(0xd1d5db, 0.75, 0.02));
  mattress.name = `${root.name}.mattress`;
  mattress.position.set(0, 0.5, 0);
  const pillow = new Mesh(new BoxGeometry(0.28, 0.08, 0.4), mat(0xf3f4f6, 0.8, 0));
  pillow.name = `${root.name}.pillow`;
  pillow.position.set(-EXAM_TABLE_LENGTH_M * 0.35, 0.58, 0);
  const rail = new Mesh(new BoxGeometry(EXAM_TABLE_LENGTH_M * 0.7, 0.04, 0.03), mat(0x9ca3af, 0.45, 0.35));
  rail.name = `${root.name}.rail`;
  rail.position.set(0, 0.62, 0.36);
  root.add(base, mattress, pillow, rail);
  // Mattress top ≈ 0.55 m — not box.maxY (rail tip). Clearance detectors need the deck.
  root.userData.deckTopYMeters = 0.55;
  root.userData.seatHeightMeters = 0.55;
  return tagEquipmentRoot(root, equipmentId, "parametric");
}

/** BP cuff: cuff band + gauge + bulb. */
export function buildBloodPressureCuffEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const cuff = new Mesh(new CylinderGeometry(0.07, 0.075, 0.14, 16), mat(0x1e3a5f, 0.7, 0.05));
  cuff.name = `${root.name}.cuff`;
  cuff.position.set(0, 0.85, 0);
  const gauge = new Mesh(new CylinderGeometry(0.04, 0.04, 0.02, 16), mat(0xf8fafc, 0.5, 0.1));
  gauge.name = `${root.name}.gauge`;
  gauge.rotation.x = Math.PI / 2;
  gauge.position.set(0.1, 0.9, 0.05);
  const bulb = new Mesh(new CylinderGeometry(0.03, 0.035, 0.08, 12), mat(0x111827, 0.6, 0.05));
  bulb.name = `${root.name}.bulb`;
  bulb.position.set(-0.12, 0.72, 0.05);
  root.add(cuff, gauge, bulb);
  return tagEquipmentRoot(root, equipmentId, "parametric");
}

/** Abdominal exam zone: pad + outline rails (not a single cube). */
export function buildAbdominalExamZoneEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const pad = new Mesh(new BoxGeometry(0.55, 0.04, 0.45), mat(0xfef3c7, 0.8, 0));
  pad.name = `${root.name}.pad`;
  pad.position.set(0, 0.92, 0);
  const railA = new Mesh(new BoxGeometry(0.55, 0.02, 0.02), mat(0xb45309, 0.5, 0.1));
  railA.name = `${root.name}.rail_a`;
  railA.position.set(0, 0.95, 0.22);
  const railB = new Mesh(new BoxGeometry(0.55, 0.02, 0.02), mat(0xb45309, 0.5, 0.1));
  railB.name = `${root.name}.rail_b`;
  railB.position.set(0, 0.95, -0.22);
  root.add(pad, railA, railB);
  return tagEquipmentRoot(root, equipmentId, "parametric");
}

/** Generic multi-mesh clinical cart fallback (beats a single scaled cube). */
export function buildGenericClinicalEquipmentFallback(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const base = new Mesh(new BoxGeometry(0.36, 0.06, 0.3), mat(0x4b5563, 0.55, 0.2));
  base.name = `${root.name}.base`;
  base.position.set(0, 0.03, 0);
  const upright = new Mesh(new CylinderGeometry(0.02, 0.025, 1.1, 8), mat(0x9ca3af, 0.4, 0.4));
  upright.name = `${root.name}.upright`;
  upright.position.set(0, 0.58, 0);
  const tray = new Mesh(new BoxGeometry(0.32, 0.03, 0.24), mat(0xe5e7eb, 0.6, 0.1));
  tray.name = `${root.name}.tray`;
  tray.position.set(0, 0.95, 0);
  root.add(base, upright, tray);
  return tagEquipmentRoot(root, equipmentId, "fallback");
}

/** Parent/clinic chair silhouette. */
function buildSimpleChairEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const seat = new Mesh(new BoxGeometry(0.45, 0.05, 0.45), mat(0x78716c, 0.7, 0.05));
  seat.position.set(0, 0.42, 0);
  seat.name = `${root.name}.seat`;
  const back = new Mesh(new BoxGeometry(0.45, 0.48, 0.05), mat(0x78716c, 0.7, 0.05));
  back.position.set(0, 0.68, -0.2);
  back.name = `${root.name}.back`;
  const leg = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), mat(0x57534e, 0.65, 0.08));
  leg.position.set(0, 0.2, 0);
  leg.name = `${root.name}.legs`;
  root.add(seat, back, leg);
  // Seat top — not box.maxY (backrest). Clearance detectors need the deck, not the back tip.
  root.userData.seatHeightMeters = 0.45;
  root.userData.deckTopYMeters = 0.45;
  return tagEquipmentRoot(root, equipmentId, "parametric");
}

/** Compact device on a stand (pulse ox / inhaler / nebulizer family). */
function buildHandheldDeviceOnStand(equipmentId: string, accent: number): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const stand = new Mesh(new CylinderGeometry(0.02, 0.03, 0.7, 8), mat(0x9ca3af, 0.45, 0.35));
  stand.position.set(0, 0.4, 0);
  stand.name = `${root.name}.stand`;
  const body = new Mesh(new BoxGeometry(0.14, 0.1, 0.08), mat(accent, 0.55, 0.1));
  body.position.set(0, 0.8, 0);
  body.name = `${root.name}.body`;
  const tip = new Mesh(new BoxGeometry(0.06, 0.04, 0.04), mat(0x111827, 0.5, 0.1));
  tip.position.set(0.08, 0.8, 0);
  tip.name = `${root.name}.tip`;
  root.add(stand, body, tip);
  return tagEquipmentRoot(root, equipmentId, "parametric");
}

/**
 * Build multi-mesh geometry for a non-GLB equipment id.
 * Known kinds get recognisable silhouettes; unknown ids get the cart fallback.
 */
export function buildDeclaredEquipmentGeometry(equipmentId: string): Group {
  switch (equipmentId) {
    case "wall_clock_equipment":
      return buildWallClockEquipment(equipmentId);
    case "bedside_monitor_equipment":
    case "monitor_equipment":
      return buildBedsideMonitorEquipment(equipmentId);
    case "fetal_monitor_equipment":
      return buildFetalMonitorEquipment(equipmentId);
    case "exam_table_equipment":
    case "post_op_bed_equipment":
    case "pediatric_stretcher_equipment":
      return buildExamTableEquipment(equipmentId);
    case "blood_pressure_cuff_equipment":
      return buildBloodPressureCuffEquipment(equipmentId);
    case "abdominal_exam_zone_equipment":
    case "abdominal_dressing_equipment":
      return buildAbdominalExamZoneEquipment(equipmentId);
    case "parent_chair_equipment":
    case "chairs_equipment":
      return buildSimpleChairEquipment(equipmentId);
    case "pulse_oximeter_equipment":
      return buildHandheldDeviceOnStand(equipmentId, 0x1f2937);
    case "nebulizer_mask_equipment":
    case "inhaler_spacer_equipment":
      return buildHandheldDeviceOnStand(equipmentId, 0xe0f2fe);
    case "oxygen_wall_port_equipment":
      return buildHandheldDeviceOnStand(equipmentId, 0x7dd3fc);
    case "iv_pump_equipment":
      return buildFetalMonitorEquipment(equipmentId); // cart+screen silhouette
    case "tissue_box_equipment": {
      const root = new Group();
      root.name = `openclinxr.equipment.${equipmentId}`;
      const box = new Mesh(new BoxGeometry(0.18, 0.1, 0.12), mat(0xfef9c3, 0.75, 0));
      box.position.set(0, 0.9, 0);
      box.name = `${root.name}.box`;
      const slot = new Mesh(new BoxGeometry(0.12, 0.02, 0.04), mat(0xf8fafc, 0.8, 0));
      slot.position.set(0, 0.96, 0);
      slot.name = `${root.name}.slot`;
      const base = new Mesh(new BoxGeometry(0.2, 0.02, 0.14), mat(0xd6d3d1, 0.7, 0));
      base.position.set(0, 0.84, 0);
      base.name = `${root.name}.base`;
      root.add(base, box, slot);
      return tagEquipmentRoot(root, equipmentId, "parametric");
    }
    default:
      return buildGenericClinicalEquipmentFallback(equipmentId);
  }
}

/** Placeholder slot mesh used under a GLB load (hidden when GLB attaches). */
export function buildGltfEquipmentPlaceholderSlot(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const body = new Mesh(new BoxGeometry(0.42, 0.72, 0.32), mat(0xf3f5f0, 0.72, 0.05));
  body.position.y = 0.46;
  body.name = `${root.name}.placeholder_body`;
  const accent = new Mesh(new BoxGeometry(0.32, 0.18, 0.04), mat(0x111820, 0.65, 0.1));
  accent.position.set(0, 0.92, -0.18);
  accent.name = `${root.name}.placeholder_accent`;
  root.add(body, accent);
  return tagEquipmentRoot(root, equipmentId, "gltf");
}
