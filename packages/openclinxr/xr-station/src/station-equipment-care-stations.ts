/**
 * Equipment care-station families: observation station, ECG cart, exam light,
 * IV pump, pediatric stretcher, post-op bed (#202).
 *
 * Split from station-equipment-families.ts so both modules stay under the
 * packages/ 500-line zone budget. Same builders, new address.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
} from "three";
import { equipmentMat as mat, tagEquipmentRootShared as tagEquipmentRoot } from "./station-equipment-families.js";

// ── Own-geometry clinical objects ───────────────────────────────────────────

/**
 * Observation station: desk surface + seat-height void + screen.
 * Must not: bare pole.
 */
export function buildObservationStationEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  // Desk top
  const desk = new Mesh(new BoxGeometry(1.1, 0.05, 0.55), mat(0x78716c, 0.65, 0.08));
  desk.name = `${root.name}.desk_surface`;
  desk.position.set(0, 0.75, 0);
  // Two legs leaving a seat void beneath
  const legL = new Mesh(new BoxGeometry(0.06, 0.72, 0.5), mat(0x57534e, 0.6, 0.1));
  legL.name = `${root.name}.leg_left`;
  legL.position.set(-0.48, 0.36, 0);
  const legR = new Mesh(new BoxGeometry(0.06, 0.72, 0.5), mat(0x57534e, 0.6, 0.1));
  legR.name = `${root.name}.leg_right`;
  legR.position.set(0.48, 0.36, 0);
  // Screen on desk
  const bezel = new Mesh(new BoxGeometry(0.45, 0.32, 0.04), mat(0x111827, 0.5, 0.12));
  bezel.name = `${root.name}.screen_bezel`;
  bezel.position.set(0.15, 1.05, -0.15);
  const screen = new Mesh(new BoxGeometry(0.4, 0.27, 0.015), mat(0x38bdf8, 0.35, 0.05));
  screen.name = `${root.name}.display`;
  screen.position.set(0.15, 1.05, -0.12);
  // Keyboard plate for extra distinct volume
  const keyboard = new Mesh(new BoxGeometry(0.35, 0.02, 0.14), mat(0x1f2937, 0.55, 0.1));
  keyboard.name = `${root.name}.keyboard`;
  keyboard.position.set(0.1, 0.79, 0.1);
  root.add(desk, legL, legR, bezel, screen, keyboard);
  root.userData.deckTopYMeters = 0.75;
  return tagEquipmentRoot(root, equipmentId, "parametric", "observation_station");
}

/**
 * 12-lead ECG machine: wheeled cart body + screen + lead hooks.
 * Must not: bare pole.
 */
export function buildEcgMachineEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const body = new Mesh(new BoxGeometry(0.55, 0.7, 0.4), mat(0xf8fafc, 0.6, 0.08));
  body.name = `${root.name}.cart_body`;
  body.position.set(0, 0.55, 0);
  const base = new Mesh(new BoxGeometry(0.6, 0.06, 0.45), mat(0x4b5563, 0.55, 0.2));
  base.name = `${root.name}.cart_base`;
  base.position.set(0, 0.03, 0);
  const screen = new Mesh(new BoxGeometry(0.4, 0.28, 0.04), mat(0x0369a1, 0.4, 0.05));
  screen.name = `${root.name}.display`;
  screen.position.set(0, 1.0, 0.18);
  // Lead bundle / hooks on the side
  const leadRail = new Mesh(new BoxGeometry(0.04, 0.25, 0.08), mat(0x9ca3af, 0.45, 0.35));
  leadRail.name = `${root.name}.lead_hooks`;
  leadRail.position.set(0.3, 0.7, 0);
  const leadBundle = new Mesh(new CylinderGeometry(0.03, 0.03, 0.2, 8), mat(0xef4444, 0.5, 0.05));
  leadBundle.name = `${root.name}.lead_bundle`;
  leadBundle.position.set(0.32, 0.55, 0.05);
  const drawer = new Mesh(new BoxGeometry(0.45, 0.12, 0.35), mat(0xe5e7eb, 0.6, 0.1));
  drawer.name = `${root.name}.drawer`;
  drawer.position.set(0, 0.28, 0.02);
  // Casters
  const wheelGeo = new CylinderGeometry(0.045, 0.045, 0.03, 10);
  const wheelMat = mat(0x111827, 0.55, 0.15);
  const ecgWheels: Array<[number, number]> = [
    [-0.24, -0.18],
    [0.24, -0.18],
    [-0.24, 0.18],
    [0.24, 0.18],
  ];
  for (let i = 0; i < ecgWheels.length; i += 1) {
    const [wx, wz] = ecgWheels[i]!;
    const w = new Mesh(wheelGeo, wheelMat);
    w.name = `${root.name}.caster_${i}`;
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.045, wz);
    root.add(w);
  }
  root.add(base, body, screen, leadRail, leadBundle, drawer);
  return tagEquipmentRoot(root, equipmentId, "parametric", "ecg_cart");
}

/**
 * Abdominal exam light: articulated arm + lamp head.
 * Must not: tray.
 */
export function buildAbdominalExamLightEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const base = new Mesh(new CylinderGeometry(0.14, 0.16, 0.05, 12), mat(0x374151, 0.55, 0.25));
  base.name = `${root.name}.base`;
  base.position.set(0, 0.03, 0);
  const column = new Mesh(new CylinderGeometry(0.025, 0.03, 1.1, 10), mat(0x9ca3af, 0.4, 0.45));
  column.name = `${root.name}.column`;
  column.position.set(0, 0.58, 0);
  // Articulated arm segments
  const arm1 = new Mesh(new BoxGeometry(0.35, 0.04, 0.04), mat(0xd1d5db, 0.4, 0.4));
  arm1.name = `${root.name}.arm_proximal`;
  arm1.position.set(0.18, 1.15, 0);
  arm1.rotation.z = -0.25;
  const arm2 = new Mesh(new BoxGeometry(0.28, 0.03, 0.03), mat(0x9ca3af, 0.4, 0.4));
  arm2.name = `${root.name}.arm_distal`;
  arm2.position.set(0.42, 1.05, 0);
  arm2.rotation.z = 0.35;
  // Lamp head
  const lamp = new Mesh(new CylinderGeometry(0.08, 0.1, 0.06, 12), mat(0xf8fafc, 0.5, 0.15));
  lamp.name = `${root.name}.lamp_head`;
  lamp.rotation.z = Math.PI / 2;
  lamp.position.set(0.55, 0.98, 0);
  const bulb = new Mesh(new CylinderGeometry(0.05, 0.05, 0.02, 12), mat(0xfef08a, 0.3, 0.05));
  bulb.name = `${root.name}.bulb`;
  bulb.rotation.z = Math.PI / 2;
  bulb.position.set(0.58, 0.98, 0);
  const joint = new Mesh(new BoxGeometry(0.06, 0.06, 0.06), mat(0x6b7280, 0.45, 0.35));
  joint.name = `${root.name}.elbow_joint`;
  joint.position.set(0.32, 1.12, 0);
  root.add(base, column, arm1, arm2, lamp, bulb, joint);
  return tagEquipmentRoot(root, equipmentId, "parametric", "exam_light");
}

/**
 * IV pump: small pole-mounted box with display + channel slot.
 * Must not: floor base / cart body (that is fetal_monitor).
 */
export function buildIvPumpEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  // Short pole segment (pump clamps to an existing IV pole — no wheeled base).
  const clampPole = new Mesh(new CylinderGeometry(0.015, 0.015, 0.5, 8), mat(0xd1d5db, 0.35, 0.55));
  clampPole.name = `${root.name}.clamp_pole`;
  clampPole.position.set(0, 1.0, 0);
  // Small pump body
  const body = new Mesh(new BoxGeometry(0.14, 0.22, 0.1), mat(0xe5e7eb, 0.55, 0.1));
  body.name = `${root.name}.pump_body`;
  body.position.set(0.09, 1.05, 0);
  const display = new Mesh(new BoxGeometry(0.1, 0.06, 0.015), mat(0x0ea5e9, 0.35, 0.05));
  display.name = `${root.name}.display`;
  display.position.set(0.09, 1.12, 0.055);
  // Channel slot for the infusion set
  const channel = new Mesh(new BoxGeometry(0.04, 0.16, 0.03), mat(0x1f2937, 0.5, 0.1));
  channel.name = `${root.name}.channel_slot`;
  channel.position.set(0.14, 1.0, 0.04);
  const clamp = new Mesh(new BoxGeometry(0.05, 0.04, 0.06), mat(0x6b7280, 0.45, 0.3));
  clamp.name = `${root.name}.pole_clamp`;
  clamp.position.set(0.03, 1.05, 0);
  const keypad = new Mesh(new BoxGeometry(0.08, 0.08, 0.01), mat(0x374151, 0.55, 0.1));
  keypad.name = `${root.name}.keypad`;
  keypad.position.set(0.09, 1.0, 0.055);
  root.add(clampPole, body, display, channel, clamp, keypad);
  return tagEquipmentRoot(root, equipmentId, "parametric", "iv_pump");
}

/**
 * Pediatric stretcher proportions — reuses stretcher silhouette class at child scale.
 * Does NOT mutate adult stretcher constants.
 */
export function buildPediatricStretcherEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  // Child proportions: shorter + narrower + slightly lower deck than adult stretcher.
  const L = 1.45;
  const W = 0.52;
  const deckTop = 0.62;

  const frame = new Mesh(new BoxGeometry(L * 0.98, 0.045, W * 0.95), mat(0xa5b4fc, 0.4, 0.4));
  frame.name = `${root.name}.frame`;
  frame.position.set(0, deckTop - 0.1, 0);

  const mattress = new Mesh(new BoxGeometry(L * 0.92, 0.07, W * 0.88), mat(0xc7d2fe, 0.72, 0.02));
  mattress.name = `${root.name}.mattress_deck`;
  mattress.position.set(0, deckTop - 0.035, 0);

  const wheelGeo = new CylinderGeometry(0.045, 0.045, 0.035, 12);
  const wheelMat = mat(0x111827, 0.55, 0.15);
  const pedsWheels: Array<[number, number]> = [
    [-L * 0.4, -W * 0.42],
    [L * 0.4, -W * 0.42],
    [-L * 0.4, W * 0.42],
    [L * 0.4, W * 0.42],
  ];
  for (let i = 0; i < pedsWheels.length; i += 1) {
    const [wx, wz] = pedsWheels[i]!;
    const wheel = new Mesh(wheelGeo, wheelMat);
    wheel.name = `${root.name}.caster_${i}`;
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.045, wz);
    root.add(wheel);
  }

  const railMat = mat(0x818cf8, 0.4, 0.4);
  const leftRail = new Mesh(new BoxGeometry(L * 0.7, 0.18, 0.025), railMat);
  leftRail.name = `${root.name}.rail_left`;
  leftRail.position.set(0, deckTop + 0.06, -W * 0.48);
  const rightRail = new Mesh(new BoxGeometry(L * 0.7, 0.18, 0.025), railMat);
  rightRail.name = `${root.name}.rail_right`;
  rightRail.position.set(0, deckTop + 0.06, W * 0.48);

  const pushBar = new Mesh(new BoxGeometry(0.035, 0.28, W * 0.65), mat(0x6366f1, 0.45, 0.35));
  pushBar.name = `${root.name}.push_bar`;
  pushBar.position.set(-L * 0.48, deckTop + 0.08, 0);

  const col = new Mesh(new BoxGeometry(0.05, deckTop - 0.12, 0.05), mat(0xa5b4fc, 0.45, 0.4));
  col.name = `${root.name}.column`;
  col.position.set(0, (deckTop - 0.12) / 2, 0);

  root.add(frame, mattress, leftRail, rightRail, pushBar, col);
  root.userData.deckTopYMeters = deckTop;
  root.userData.seatHeightMeters = deckTop;
  return tagEquipmentRoot(root, equipmentId, "parametric", "stretcher");
}

/**
 * Post-op bed: hospital-bed silhouette class with a distinguishing over-bed table.
 * Does NOT mutate buildHospitalBedEquipment — adult hospital_bed key stays put.
 */
export function buildPostOpBedEquipment(
  equipmentId: string,
  buildHospitalBed: (id: string) => Group,
): Group {
  const root = buildHospitalBed(equipmentId);
  // Over-bed tray table — post-op specific, keeps hospital_bed key unchanged.
  const tableTop = new Mesh(new BoxGeometry(0.45, 0.03, 0.35), mat(0xe5e7eb, 0.55, 0.1));
  tableTop.name = `${root.name}.overbed_table`;
  tableTop.position.set(0.35, 0.95, 0.55);
  const tableLeg = new Mesh(new CylinderGeometry(0.02, 0.025, 0.9, 8), mat(0x9ca3af, 0.4, 0.4));
  tableLeg.name = `${root.name}.overbed_leg`;
  tableLeg.position.set(0.35, 0.45, 0.55);
  const tableBase = new Mesh(new BoxGeometry(0.3, 0.03, 0.25), mat(0x4b5563, 0.55, 0.2));
  tableBase.name = `${root.name}.overbed_base`;
  tableBase.position.set(0.35, 0.02, 0.55);
  root.add(tableTop, tableLeg, tableBase);
  root.userData.openClinXrEquipmentFamily = "hospital_bed";
  // Supine plant tags (from prior post_op_bed exam-table path).
  root.userData.openClinXrStretcherKind = "procedural_patient_stretcher";
  root.userData.openClinXrStretcherInclineDegrees = 0;
  root.userData.openClinXrInclineSource = "equipment_post_op_bed_flat_ssot";
  root.userData.openClinXrPatientSupportSource = "equipment";
  return root;
}
