/**
 * Parametric equipment geometry builders + dispatcher (#140 / #202).
 *
 * Split from station-equipment.ts so the parent (plan + mount SSOT) stays under
 * the apps/ 600-line zone budget. Family-specific modules own screens/trays/etc.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
} from "three";
import {
  buildAbdominalExamLightEquipment,
  buildDeviceOnStandFamilyEquipment,
  buildEcgMachineEquipment,
  buildIvPoleFamilyEquipment,
  buildIvPumpEquipment,
  buildObservationStationEquipment,
  buildPediatricStretcherEquipment,
  buildPostOpBedEquipment,
  buildScreenFamilyEquipment,
  buildTrayFamilyEquipment,
  type EquipmentFamily,
} from "./station-equipment-families.js";
import { buildMedicationCartEquipment } from "./station-equipment-medication-cart.js";
import {
  buildHospitalBedEquipment,
  buildSideRailsEquipment,
  buildStretcherEquipment,
} from "./station-equipment-support-surfaces.js";

export type EquipmentMountSource = "gltf" | "parametric" | "fallback";

/** Wall clock: face diameter (m). */
export const WALL_CLOCK_FACE_DIAMETER_M = 0.32;
/** Bedside / fetal monitor screen diagonal-ish width (m). */
export const MONITOR_SCREEN_WIDTH_M = 0.38;
/** Exam table mattress length (m). */
export const EXAM_TABLE_LENGTH_M = 1.85;

function mat(color: ColorRepresentation, roughness = 0.55, metalness = 0.12): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function tagEquipmentRoot(
  root: Group,
  equipmentId: string,
  source: EquipmentMountSource,
  family?: EquipmentFamily,
): Group {
  root.userData.openClinXrEquipmentId = equipmentId;
  root.userData.openClinXrEquipmentSource = source;
  root.userData.openClinXrRuntimeEquipmentAssetId = equipmentId;
  root.userData.openClinXrAffordances = ["selectable_equipment_reference", "clinical_workflow_cue"];
  if (family) root.userData.openClinXrEquipmentFamily = family;
  return root;
}

/**
 * Wall clock: housing + face + two hands (≥4 meshes).
 *
 * Geometry is origin-centered. Mount height is the equipment placement root Y only
 * (main.ts: slot.position.set). Children used to bake y≈1.55 AND placements also set
 * y=1.55 → world Y≈3.1 above a 2.65 m ceiling (#183 handback double-stack).
 */
export function buildWallClockEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const housing = new Mesh(
    new CylinderGeometry(WALL_CLOCK_FACE_DIAMETER_M / 2 + 0.02, WALL_CLOCK_FACE_DIAMETER_M / 2 + 0.02, 0.05, 24),
    mat(0x2f3540, 0.5, 0.25),
  );
  housing.name = `${root.name}.housing`;
  housing.rotation.x = Math.PI / 2;
  housing.position.set(0, 0, 0);
  const face = new Mesh(
    new CylinderGeometry(WALL_CLOCK_FACE_DIAMETER_M / 2, WALL_CLOCK_FACE_DIAMETER_M / 2, 0.015, 24),
    mat(0xf5f0e6, 0.85, 0),
  );
  face.name = `${root.name}.face`;
  face.rotation.x = Math.PI / 2;
  face.position.set(0, 0, 0.02);
  const hour = new Mesh(new BoxGeometry(0.02, 0.09, 0.01), mat(0x1a1a1a, 0.6, 0.05));
  hour.name = `${root.name}.hour_hand`;
  hour.position.set(0.02, 0, 0.035);
  hour.rotation.z = -0.4;
  const minute = new Mesh(new BoxGeometry(0.015, 0.12, 0.01), mat(0x111111, 0.6, 0.05));
  minute.name = `${root.name}.minute_hand`;
  minute.position.set(-0.03, 0.03, 0.036);
  minute.rotation.z = 0.9;
  root.add(housing, face, hour, minute);
  root.userData.openClinXrEquipmentLocalYPolicy = "origin_centered_mount_height_from_placement_root";
  return tagEquipmentRoot(root, equipmentId, "parametric", "own_geometry");
}

/**
 * Bedside monitor stand: base + pole (#260).
 *
 * Extracted from buildBedsideMonitorEquipment so the parametric STAND survives a
 * GLB swap: REAL_EQUIPMENT_GLTF_BY_ID substitutes a single body mesh for the
 * whole composite id, which would silently drop whatever else the builder emits.
 * The stand is the part that stays parametric; the GLB body mounts onto it
 * (MADR 0050 step 10 hybrid — a generated body with a parametric stand).
 *
 * Mesh names are the composite's original names
 * (openclinxr.equipment.<id>.base / .pole) so geometry stays byte-identical to
 * the pre-#260 composite; only the nesting under a `stand` Group changes.
 */
export function buildBedsideMonitorStand(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}.stand`;
  const base = new Mesh(new BoxGeometry(0.28, 0.04, 0.22), mat(0x374151, 0.55, 0.2));
  base.name = `openclinxr.equipment.${equipmentId}.base`;
  base.position.set(0, 0.02, 0);
  const pole = new Mesh(new CylinderGeometry(0.025, 0.03, 0.95, 10), mat(0x9ca3af, 0.4, 0.45));
  pole.name = `openclinxr.equipment.${equipmentId}.pole`;
  pole.position.set(0, 0.5, 0);
  root.add(base, pole);
  return root;
}

/**
 * #260 — parametric stand support for a gltf-sourced composite id, or null.
 *
 * When REAL_EQUIPMENT_GLTF_BY_ID gives an id a GLB, the mount path replaces the
 * whole parametric composite. For ids whose composite emits a floor stand (base
 * + pole) under a body, this returns the stand so the GLB body mounts ON it
 * instead of being grounded flat at floor level. Null for ids with no floor
 * stand (the wall clock's composite is origin-centered with no stand — its
 * elevated placement is the whole story).
 */
export function buildGltfEquipmentStandSupport(equipmentId: string): Group | null {
  switch (equipmentId) {
    case "bedside_monitor_equipment":
      return buildBedsideMonitorStand(equipmentId);
    default:
      return null;
  }
}

/** Bedside vitals monitor: base + pole + bezel + screen. */
export function buildBedsideMonitorEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const stand = buildBedsideMonitorStand(equipmentId);
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
  root.add(stand, bezel, screen);
  return tagEquipmentRoot(root, equipmentId, "parametric", "monitor");
}

/**
 * Wall/general monitor — wider bezel on a short mast (distinct from bedside pole stack).
 * #202: was identical to bedside_monitor; shared key is the collapse.
 */
export function buildWallMonitorEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const mast = new Mesh(new BoxGeometry(0.06, 0.55, 0.06), mat(0x6b7280, 0.5, 0.3));
  mast.name = `${root.name}.mast`;
  mast.position.set(0, 0.9, 0);
  const bezel = new Mesh(new BoxGeometry(0.52, 0.36, 0.05), mat(0x111827, 0.5, 0.15));
  bezel.name = `${root.name}.bezel`;
  bezel.position.set(0, 1.35, 0);
  const screen = new Mesh(new BoxGeometry(0.46, 0.3, 0.02), mat(0x22d3ee, 0.35, 0.05));
  screen.name = `${root.name}.screen`;
  screen.position.set(0, 1.35, 0.03);
  const wallPlate = new Mesh(new BoxGeometry(0.18, 0.12, 0.03), mat(0x4b5563, 0.55, 0.25));
  wallPlate.name = `${root.name}.wall_plate`;
  wallPlate.position.set(0, 1.35, -0.04);
  root.add(mast, bezel, screen, wallPlate);
  return tagEquipmentRoot(root, equipmentId, "parametric", "monitor");
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
  return tagEquipmentRoot(root, equipmentId, "parametric", "own_geometry");
}

/** Exam table: base + mattress + pillow + side rail (flat examination surface only). */
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
  return tagEquipmentRoot(root, equipmentId, "parametric", "exam_table");
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
  return tagEquipmentRoot(root, equipmentId, "parametric", "own_geometry");
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
  return tagEquipmentRoot(root, equipmentId, "parametric", "own_geometry");
}

/** Abdominal dressing pack — bandage roll + pad (distinct from exam-zone rails). */
export function buildAbdominalDressingEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const tray = new Mesh(new BoxGeometry(0.4, 0.03, 0.28), mat(0xf8fafc, 0.7, 0));
  tray.name = `${root.name}.dressing_tray`;
  tray.position.set(0, 0.9, 0);
  const roll = new Mesh(new CylinderGeometry(0.04, 0.04, 0.12, 12), mat(0xf1f5f9, 0.75, 0));
  roll.name = `${root.name}.bandage_roll`;
  roll.rotation.z = Math.PI / 2;
  roll.position.set(-0.08, 0.96, 0);
  const gauze = new Mesh(new BoxGeometry(0.12, 0.02, 0.1), mat(0xe2e8f0, 0.8, 0));
  gauze.name = `${root.name}.gauze_pad`;
  gauze.position.set(0.1, 0.93, 0.02);
  root.add(tray, roll, gauze);
  return tagEquipmentRoot(root, equipmentId, "parametric", "own_geometry");
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

type ChairVariant = "clinic" | "parent" | "safe_room";

/** Chair family — shared seat/back class, distinct footprints per role. */
function buildSimpleChairEquipment(equipmentId: string, variant: ChairVariant = "clinic"): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  if (variant === "parent") {
    // Wider seat + arms for parent seating.
    const seat = new Mesh(new BoxGeometry(0.55, 0.05, 0.5), mat(0x78716c, 0.7, 0.05));
    seat.position.set(0, 0.42, 0);
    seat.name = `${root.name}.seat`;
    const back = new Mesh(new BoxGeometry(0.55, 0.52, 0.05), mat(0x78716c, 0.7, 0.05));
    back.position.set(0, 0.7, -0.22);
    back.name = `${root.name}.back`;
    const leg = new Mesh(new BoxGeometry(0.48, 0.4, 0.45), mat(0x57534e, 0.65, 0.08));
    leg.position.set(0, 0.2, 0);
    leg.name = `${root.name}.legs`;
    const armL = new Mesh(new BoxGeometry(0.05, 0.08, 0.35), mat(0x78716c, 0.7, 0.05));
    armL.position.set(-0.28, 0.55, 0);
    armL.name = `${root.name}.arm_l`;
    const armR = new Mesh(new BoxGeometry(0.05, 0.08, 0.35), mat(0x78716c, 0.7, 0.05));
    armR.position.set(0.28, 0.55, 0);
    armR.name = `${root.name}.arm_r`;
    root.add(seat, back, leg, armL, armR);
  } else if (variant === "safe_room") {
    // Soft rounded footprint — low back, no hard arms (psych-safe silhouette cue).
    const seat = new Mesh(new BoxGeometry(0.5, 0.06, 0.48), mat(0xa8a29e, 0.75, 0.02));
    seat.position.set(0, 0.4, 0);
    seat.name = `${root.name}.seat`;
    const back = new Mesh(new BoxGeometry(0.5, 0.35, 0.08), mat(0xa8a29e, 0.75, 0.02));
    back.position.set(0, 0.6, -0.2);
    back.name = `${root.name}.back`;
    const base = new Mesh(new CylinderGeometry(0.22, 0.24, 0.38, 12), mat(0x78716c, 0.7, 0.05));
    base.position.set(0, 0.19, 0);
    base.name = `${root.name}.soft_base`;
    root.add(seat, back, base);
  } else {
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
  }
  // Seat top — not box.maxY (backrest). Clearance detectors need the deck, not the back tip.
  root.userData.seatHeightMeters = 0.45;
  root.userData.deckTopYMeters = 0.45;
  return tagEquipmentRoot(root, equipmentId, "parametric", "chair");
}

type HandheldKind = "pulse_ox" | "nebulizer" | "inhaler" | "o2_port";

/** Compact device on a stand — distinct body geometry per kind (not color-only). */
function buildHandheldDeviceOnStand(equipmentId: string, kind: HandheldKind): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const stand = new Mesh(new CylinderGeometry(0.02, 0.03, 0.7, 8), mat(0x9ca3af, 0.45, 0.35));
  stand.position.set(0, 0.4, 0);
  stand.name = `${root.name}.stand`;
  const base = new Mesh(new CylinderGeometry(0.08, 0.1, 0.025, 10), mat(0x4b5563, 0.55, 0.2));
  base.position.set(0, 0.012, 0);
  base.name = `${root.name}.base`;

  if (kind === "pulse_ox") {
    const body = new Mesh(new BoxGeometry(0.12, 0.08, 0.06), mat(0x1f2937, 0.55, 0.1));
    body.position.set(0, 0.8, 0);
    body.name = `${root.name}.body`;
    const clip = new Mesh(new BoxGeometry(0.05, 0.03, 0.08), mat(0x111827, 0.5, 0.1));
    clip.position.set(0.08, 0.8, 0);
    clip.name = `${root.name}.finger_clip`;
    root.add(base, stand, body, clip);
  } else if (kind === "nebulizer") {
    const cup = new Mesh(new CylinderGeometry(0.05, 0.04, 0.12, 12), mat(0xe0f2fe, 0.55, 0.05));
    cup.position.set(0, 0.82, 0);
    cup.name = `${root.name}.nebulizer_cup`;
    const mask = new Mesh(new BoxGeometry(0.1, 0.08, 0.06), mat(0xf0f9ff, 0.6, 0.02));
    mask.position.set(0.1, 0.85, 0);
    mask.name = `${root.name}.mask`;
    root.add(base, stand, cup, mask);
  } else if (kind === "inhaler") {
    const body = new Mesh(new BoxGeometry(0.05, 0.14, 0.04), mat(0x38bdf8, 0.5, 0.08));
    body.position.set(0, 0.85, 0);
    body.name = `${root.name}.canister`;
    const spacer = new Mesh(new CylinderGeometry(0.035, 0.04, 0.1, 10), mat(0xe0f2fe, 0.55, 0.05));
    spacer.position.set(0.08, 0.82, 0);
    spacer.name = `${root.name}.spacer`;
    root.add(base, stand, body, spacer);
  } else {
    // Wall O2 port — short stem. Origin-centered so placement Y is wall height only
    // (#183 handback: same double-stack class as wall_clock when placement y was 1.2).
    const plate = new Mesh(new BoxGeometry(0.12, 0.16, 0.03), mat(0x7dd3fc, 0.5, 0.15));
    plate.position.set(0, 0, 0);
    plate.name = `${root.name}.wall_plate`;
    const outlet = new Mesh(new CylinderGeometry(0.025, 0.025, 0.06, 10), mat(0xf8fafc, 0.45, 0.2));
    outlet.rotation.x = Math.PI / 2;
    outlet.position.set(0, 0, 0.04);
    outlet.name = `${root.name}.outlet`;
    const gauge = new Mesh(new CylinderGeometry(0.03, 0.03, 0.015, 12), mat(0xfef08a, 0.5, 0.1));
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(0, 0.08, 0.02);
    gauge.name = `${root.name}.gauge`;
    root.add(plate, outlet, gauge);
    root.userData.openClinXrEquipmentLocalYPolicy = "origin_centered_mount_height_from_placement_root";
  }
  return tagEquipmentRoot(root, equipmentId, "parametric", "handheld_device");
}

/**
 * Build multi-mesh geometry for a non-GLB equipment id.
 * Known kinds get recognisable silhouettes; unknown ids get the cart fallback.
 * #202: every declared id is parametric, GLB, or a named family — never silent pole.
 */
export function buildDeclaredEquipmentGeometry(equipmentId: string): Group {
  switch (equipmentId) {
    case "wall_clock_equipment":
      return buildWallClockEquipment(equipmentId);
    case "bedside_monitor_equipment":
      return buildBedsideMonitorEquipment(equipmentId);
    case "monitor_equipment":
      return buildWallMonitorEquipment(equipmentId);
    case "fetal_monitor_equipment":
      return buildFetalMonitorEquipment(equipmentId);
    case "exam_table_equipment":
      return buildExamTableEquipment(equipmentId);
    // #202 deck family: post_op → hospital_bed class; pediatric → stretcher @ child scale.
    case "post_op_bed_equipment":
      return buildPostOpBedEquipment(equipmentId, buildHospitalBedEquipment);
    case "pediatric_stretcher_equipment":
      return buildPediatricStretcherEquipment(equipmentId);
    case "hospital_bed_equipment":
      return buildHospitalBedEquipment(equipmentId);
    case "stretcher_equipment":
      return buildStretcherEquipment(equipmentId);
    case "side_rails_equipment":
      return buildSideRailsEquipment(equipmentId);
    case "blood_pressure_cuff_equipment":
      return buildBloodPressureCuffEquipment(equipmentId);
    case "abdominal_exam_zone_equipment":
      return buildAbdominalExamZoneEquipment(equipmentId);
    case "abdominal_dressing_equipment":
      return buildAbdominalDressingEquipment(equipmentId);
    case "parent_chair_equipment":
      return buildSimpleChairEquipment(equipmentId, "parent");
    case "chairs_equipment":
      return buildSimpleChairEquipment(equipmentId, "clinic");
    case "safe_room_chair_equipment":
      return buildSimpleChairEquipment(equipmentId, "safe_room");
    case "pulse_oximeter_equipment":
      return buildHandheldDeviceOnStand(equipmentId, "pulse_ox");
    case "nebulizer_mask_equipment":
      return buildHandheldDeviceOnStand(equipmentId, "nebulizer");
    case "inhaler_spacer_equipment":
      return buildHandheldDeviceOnStand(equipmentId, "inhaler");
    case "oxygen_wall_port_equipment":
      return buildHandheldDeviceOnStand(equipmentId, "o2_port");
    case "iv_pump_equipment":
      return buildIvPumpEquipment(equipmentId);
    // #202 screens family
    case "ehr_screen_equipment":
      return buildScreenFamilyEquipment(equipmentId, "wall_panel");
    case "lab_results_panel_equipment":
      return buildScreenFamilyEquipment(equipmentId, "cart_monitor");
    case "tablet_visit_equipment":
      return buildScreenFamilyEquipment(equipmentId, "handheld");
    // #202 IV pole
    case "iv_pole_equipment":
      return buildIvPoleFamilyEquipment(equipmentId);
    // #202 trays
    case "antipyretic_tray_equipment":
      return buildTrayFamilyEquipment(equipmentId, "antipyretic");
    case "hydration_supplies_equipment":
      return buildTrayFamilyEquipment(equipmentId, "hydration");
    // #202 medication cart — honest class for "medication cart" prose (was unmapped)
    case "medication_cart_equipment":
      return buildMedicationCartEquipment(equipmentId);
    // #202 device-on-stand
    case "digital_thermometer_equipment":
      return buildDeviceOnStandFamilyEquipment(equipmentId, "thermometer");
    case "glucometer_review_equipment":
      return buildDeviceOnStandFamilyEquipment(equipmentId, "glucometer");
    case "oxygen_nasal_cannula_equipment":
      return buildDeviceOnStandFamilyEquipment(equipmentId, "nasal_cannula");
    case "surgical_consult_phone_equipment":
      return buildDeviceOnStandFamilyEquipment(equipmentId, "consult_phone");
    // #202 own geometry
    case "observation_station_equipment":
      return buildObservationStationEquipment(equipmentId);
    case "12_lead_ecg_machine_equipment":
      return buildEcgMachineEquipment(equipmentId);
    case "abdominal_exam_light_equipment":
      return buildAbdominalExamLightEquipment(equipmentId);
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
      return tagEquipmentRoot(root, equipmentId, "parametric", "own_geometry");
    }
    // #223 physical roomProps — whiteboard + ECG leads (not pedagogy cues).
    case "safety_plan_whiteboard_equipment":
      return buildSafetyPlanWhiteboardEquipment(equipmentId);
    case "ekg_leads_on_bed_equipment":
      return buildEkgLeadsOnBedEquipment(equipmentId);
    default:
      return buildGenericClinicalEquipmentFallback(equipmentId);
  }
}

/** Wall / freestanding clinical whiteboard with frame + writing surface + tray. */
export function buildSafetyPlanWhiteboardEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const board = new Mesh(new BoxGeometry(0.9, 0.55, 0.03), mat(0xf8fafc, 0.85, 0.02));
  board.name = `${root.name}.board`;
  board.position.set(0, 1.35, 0);
  const frame = new Mesh(new BoxGeometry(0.96, 0.61, 0.04), mat(0x64748b, 0.55, 0.2));
  frame.name = `${root.name}.frame`;
  frame.position.set(0, 1.35, -0.01);
  const tray = new Mesh(new BoxGeometry(0.7, 0.04, 0.08), mat(0x475569, 0.6, 0.15));
  tray.name = `${root.name}.marker_tray`;
  tray.position.set(0, 1.05, 0.04);
  const strip = new Mesh(new BoxGeometry(0.55, 0.03, 0.01), mat(0x0ea5e9, 0.45, 0.05));
  strip.name = `${root.name}.header_strip`;
  strip.position.set(0, 1.55, 0.02);
  root.add(frame, board, tray, strip);
  return tagEquipmentRoot(root, equipmentId, "parametric", "own_geometry");
}

/** ECG lead wires + clip pack resting on the bed deck (multi-mesh, not a unit box). */
export function buildEkgLeadsOnBedEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const pack = new Mesh(new BoxGeometry(0.14, 0.04, 0.1), mat(0x1e293b, 0.55, 0.1));
  pack.name = `${root.name}.lead_pack`;
  pack.position.set(0, 0.03, 0);
  const clipL = new Mesh(new BoxGeometry(0.03, 0.02, 0.04), mat(0xf87171, 0.5, 0.1));
  clipL.name = `${root.name}.clip_l`;
  clipL.position.set(-0.08, 0.04, 0.06);
  const clipR = new Mesh(new BoxGeometry(0.03, 0.02, 0.04), mat(0x60a5fa, 0.5, 0.1));
  clipR.name = `${root.name}.clip_r`;
  clipR.position.set(0.08, 0.04, 0.06);
  const wire1 = new Mesh(new CylinderGeometry(0.006, 0.006, 0.22, 6), mat(0x334155, 0.5, 0.2));
  wire1.name = `${root.name}.wire_a`;
  wire1.rotation.z = Math.PI / 2;
  wire1.position.set(0, 0.05, 0.08);
  const wire2 = new Mesh(new CylinderGeometry(0.006, 0.006, 0.18, 6), mat(0x475569, 0.5, 0.2));
  wire2.name = `${root.name}.wire_b`;
  wire2.rotation.z = Math.PI / 2.4;
  wire2.position.set(0.02, 0.045, -0.05);
  root.add(pack, clipL, clipR, wire1, wire2);
  return tagEquipmentRoot(root, equipmentId, "parametric", "own_geometry");
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
