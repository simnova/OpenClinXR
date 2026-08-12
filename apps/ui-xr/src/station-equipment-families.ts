/**
 * Equipment family builders (#202).
 *
 * Split from station-equipment.ts so the parent stays under the apps/ 600-line
 * zone budget. Families — not fourteen unique builders — close the grey-pole
 * residual left by #198. Each family member must produce a DISTINCT silhouetteKey
 * (extent-based); sharing a builder is fine, sharing a key is the collapse again.
 *
 * claimScope: multi-mesh silhouettes for screen / tray / device-on-stand / iv_pole
 * / observation_station / 12_lead_ecg / abdominal_exam_light / iv_pump families.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
} from "three";

export type EquipmentMountSource = "gltf" | "parametric" | "fallback";

/** Declared equipment family labels for ledger accountability. */
export type EquipmentFamily =
  | "chair"
  | "screens"
  | "iv_pole"
  | "trays"
  | "device_on_stand"
  | "observation_station"
  | "ecg_cart"
  | "exam_light"
  | "iv_pump"
  | "hospital_bed"
  | "stretcher"
  | "support_surface"
  | "monitor"
  | "exam_table"
  | "handheld_device"
  | "own_geometry"
  | "medication_cart"
  | "call_bell"
  | "panic_button"
  | "privacy_curtain"
  | "tables"
  | "wall_sign"
  | "medication_bottles"
  | "urine_cup"
  | "drain"
  | "incentive_spirometer"
  | "blood_culture_kit";

function mat(color: ColorRepresentation, roughness = 0.55, metalness = 0.12): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

/** Shared helpers for family modules (medication cart etc.). */
export function equipmentMat(
  color: ColorRepresentation,
  roughness = 0.55,
  metalness = 0.12,
): MeshStandardMaterial {
  return mat(color, roughness, metalness);
}

function tagEquipmentRoot(
  root: Group,
  equipmentId: string,
  source: EquipmentMountSource,
  family: EquipmentFamily,
): Group {
  root.userData.openClinXrEquipmentId = equipmentId;
  root.userData.openClinXrEquipmentSource = source;
  root.userData.openClinXrRuntimeEquipmentAssetId = equipmentId;
  root.userData.openClinXrEquipmentFamily = family;
  root.userData.openClinXrAffordances = ["selectable_equipment_reference", "clinical_workflow_cue"];
  return root;
}

/** Shared tag helper for family modules (medication cart etc.). */
export function tagEquipmentRootShared(
  root: Group,
  equipmentId: string,
  source: EquipmentMountSource,
  family: EquipmentFamily,
): Group {
  return tagEquipmentRoot(root, equipmentId, source, family);
}

// ── Screens family (wall panel / cart monitor / handheld tablet) ────────────

export type ScreenFootprint = "wall_panel" | "cart_monitor" | "handheld";

/**
 * Flat display + bezel + footprint-appropriate mount.
 * Must have: display plane with bezel, mount per footprint.
 * Must not: tray surface.
 */
export function buildScreenFamilyEquipment(
  equipmentId: string,
  footprint: ScreenFootprint,
): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;

  if (footprint === "wall_panel") {
    // Large wall-mounted EHR panel — tall thin footprint.
    const bezel = new Mesh(new BoxGeometry(0.72, 0.48, 0.05), mat(0x111827, 0.5, 0.15));
    bezel.name = `${root.name}.bezel`;
    bezel.position.set(0, 1.35, 0);
    const screen = new Mesh(new BoxGeometry(0.66, 0.42, 0.02), mat(0x0ea5e9, 0.35, 0.05));
    screen.name = `${root.name}.display`;
    screen.position.set(0, 1.35, 0.03);
    const wallPlate = new Mesh(new BoxGeometry(0.2, 0.12, 0.03), mat(0x4b5563, 0.55, 0.25));
    wallPlate.name = `${root.name}.wall_mount`;
    wallPlate.position.set(0, 1.35, -0.04);
    root.add(bezel, screen, wallPlate);
  } else if (footprint === "cart_monitor") {
    // Lab-results style cart with wheeled base + pole + screen.
    const base = new Mesh(new BoxGeometry(0.4, 0.05, 0.32), mat(0x374151, 0.55, 0.2));
    base.name = `${root.name}.cart_base`;
    base.position.set(0, 0.03, 0);
    const pole = new Mesh(new CylinderGeometry(0.022, 0.028, 1.05, 10), mat(0x9ca3af, 0.4, 0.45));
    pole.name = `${root.name}.cart_pole`;
    pole.position.set(0, 0.55, 0);
    const bezel = new Mesh(new BoxGeometry(0.5, 0.34, 0.06), mat(0x1f2937, 0.5, 0.12));
    bezel.name = `${root.name}.bezel`;
    bezel.position.set(0, 1.15, 0);
    const screen = new Mesh(new BoxGeometry(0.44, 0.28, 0.02), mat(0x22d3ee, 0.35, 0.05));
    screen.name = `${root.name}.display`;
    screen.position.set(0, 1.15, 0.04);
    // Four casters — distinct volume from wall/handheld.
    const wheelGeo = new CylinderGeometry(0.04, 0.04, 0.03, 10);
    const wheelMat = mat(0x111827, 0.55, 0.15);
    const cartWheels: Array<[number, number]> = [
      [-0.16, -0.12],
      [0.16, -0.12],
      [-0.16, 0.12],
      [0.16, 0.12],
    ];
    for (let i = 0; i < cartWheels.length; i += 1) {
      const [wx, wz] = cartWheels[i]!;
      const w = new Mesh(wheelGeo, wheelMat);
      w.name = `${root.name}.caster_${i}`;
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.04, wz);
      root.add(w);
    }
    root.add(base, pole, bezel, screen);
  } else {
    // Handheld tablet — small flat slab at hand height, no cart.
    const bezel = new Mesh(new BoxGeometry(0.22, 0.3, 0.018), mat(0x111827, 0.5, 0.15));
    bezel.name = `${root.name}.bezel`;
    bezel.position.set(0, 1.05, 0);
    const screen = new Mesh(new BoxGeometry(0.19, 0.26, 0.008), mat(0x38bdf8, 0.35, 0.05));
    screen.name = `${root.name}.display`;
    screen.position.set(0, 1.05, 0.012);
    const grip = new Mesh(new BoxGeometry(0.06, 0.04, 0.03), mat(0x6b7280, 0.55, 0.1));
    grip.name = `${root.name}.hand_grip`;
    grip.position.set(0, 0.88, 0);
    root.add(bezel, screen, grip);
  }

  return tagEquipmentRoot(root, equipmentId, "parametric", "screens");
}

// ── IV pole family ──────────────────────────────────────────────────────────

/**
 * Vertical pole + wheeled base + ≥2 top hooks. No screen (that is iv_pump).
 */
export function buildIvPoleFamilyEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const base = new Mesh(new CylinderGeometry(0.22, 0.24, 0.04, 12), mat(0x4b5563, 0.55, 0.25));
  base.name = `${root.name}.wheeled_base`;
  base.position.set(0, 0.02, 0);
  const pole = new Mesh(new CylinderGeometry(0.018, 0.022, 1.55, 10), mat(0xd1d5db, 0.35, 0.55));
  pole.name = `${root.name}.pole`;
  pole.position.set(0, 0.8, 0);
  // Four casters on the base ring
  const wheelGeo = new CylinderGeometry(0.035, 0.035, 0.025, 10);
  const wheelMat = mat(0x111827, 0.55, 0.15);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2;
    const w = new Mesh(wheelGeo, wheelMat);
    w.name = `${root.name}.caster_${i}`;
    w.rotation.z = Math.PI / 2;
    w.position.set(Math.cos(a) * 0.18, 0.035, Math.sin(a) * 0.18);
    root.add(w);
  }
  // ≥2 hooks at the top
  const hookMat = mat(0x9ca3af, 0.4, 0.5);
  const hook0 = new Mesh(new BoxGeometry(0.12, 0.02, 0.02), hookMat);
  hook0.name = `${root.name}.hook_0`;
  hook0.position.set(0.08, 1.55, 0);
  const hook1 = new Mesh(new BoxGeometry(0.12, 0.02, 0.02), hookMat);
  hook1.name = `${root.name}.hook_1`;
  hook1.position.set(-0.08, 1.55, 0);
  const hook2 = new Mesh(new BoxGeometry(0.02, 0.08, 0.02), hookMat);
  hook2.name = `${root.name}.hook_stem`;
  hook2.position.set(0, 1.52, 0);
  root.add(base, pole, hook0, hook1, hook2);
  return tagEquipmentRoot(root, equipmentId, "parametric", "iv_pole");
}

// ── Trays family ────────────────────────────────────────────────────────────

export type TrayLoadout = "antipyretic" | "hydration";

/**
 * Horizontal tray surface with raised lip + loadout contents on a stand.
 * Must not: display plane.
 */
export function buildTrayFamilyEquipment(equipmentId: string, loadout: TrayLoadout): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const stand = new Mesh(new CylinderGeometry(0.025, 0.03, 0.85, 8), mat(0x9ca3af, 0.4, 0.4));
  stand.name = `${root.name}.stand`;
  stand.position.set(0, 0.45, 0);
  const base = new Mesh(new BoxGeometry(0.28, 0.04, 0.28), mat(0x4b5563, 0.55, 0.2));
  base.name = `${root.name}.base`;
  base.position.set(0, 0.02, 0);

  if (loadout === "antipyretic") {
    // Wider shallow tray + two medicine bottles + a small cup.
    const tray = new Mesh(new BoxGeometry(0.36, 0.025, 0.28), mat(0xe5e7eb, 0.6, 0.1));
    tray.name = `${root.name}.tray_surface`;
    tray.position.set(0, 0.9, 0);
    const lip = new Mesh(new BoxGeometry(0.38, 0.03, 0.3), mat(0xd1d5db, 0.55, 0.12));
    lip.name = `${root.name}.tray_lip`;
    lip.position.set(0, 0.885, 0);
    const bottle0 = new Mesh(new CylinderGeometry(0.025, 0.025, 0.1, 10), mat(0xfbbf24, 0.5, 0.05));
    bottle0.name = `${root.name}.bottle_0`;
    bottle0.position.set(-0.08, 0.96, 0.04);
    const bottle1 = new Mesh(new CylinderGeometry(0.02, 0.02, 0.08, 10), mat(0xf87171, 0.5, 0.05));
    bottle1.name = `${root.name}.bottle_1`;
    bottle1.position.set(0.06, 0.95, -0.05);
    const cup = new Mesh(new CylinderGeometry(0.03, 0.028, 0.05, 10), mat(0xf8fafc, 0.7, 0));
    cup.name = `${root.name}.med_cup`;
    cup.position.set(0.1, 0.935, 0.06);
    root.add(base, stand, lip, tray, bottle0, bottle1, cup);
  } else {
    // Deeper tray + IV bag pouch + water bottle (hydration loadout).
    const tray = new Mesh(new BoxGeometry(0.32, 0.04, 0.34), mat(0xdbeafe, 0.6, 0.08));
    tray.name = `${root.name}.tray_surface`;
    tray.position.set(0, 0.92, 0);
    const lip = new Mesh(new BoxGeometry(0.34, 0.05, 0.36), mat(0x93c5fd, 0.55, 0.1));
    lip.name = `${root.name}.tray_lip`;
    lip.position.set(0, 0.9, 0);
    const bag = new Mesh(new BoxGeometry(0.1, 0.16, 0.04), mat(0xbfdbfe, 0.45, 0.05));
    bag.name = `${root.name}.iv_bag`;
    bag.position.set(-0.06, 1.02, 0);
    const water = new Mesh(new CylinderGeometry(0.035, 0.035, 0.14, 10), mat(0x38bdf8, 0.4, 0.05));
    water.name = `${root.name}.water_bottle`;
    water.position.set(0.08, 1.01, 0.05);
    root.add(base, stand, lip, tray, bag, water);
  }

  return tagEquipmentRoot(root, equipmentId, "parametric", "trays");
}

// ── Device-on-stand family ──────────────────────────────────────────────────

export type DeviceHeadKind =
  | "thermometer"
  | "glucometer"
  | "nasal_cannula"
  | "consult_phone";

/**
 * Common stand + distinct device head per id.
 * Must not: deck surface.
 */
export function buildDeviceOnStandFamilyEquipment(
  equipmentId: string,
  head: DeviceHeadKind,
): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const stand = new Mesh(new CylinderGeometry(0.018, 0.025, 0.75, 8), mat(0x9ca3af, 0.45, 0.35));
  stand.name = `${root.name}.stand`;
  stand.position.set(0, 0.4, 0);
  const base = new Mesh(new CylinderGeometry(0.1, 0.12, 0.03, 10), mat(0x4b5563, 0.55, 0.2));
  base.name = `${root.name}.base`;
  base.position.set(0, 0.015, 0);

  if (head === "thermometer") {
    // Slim probe stick with digital readout body.
    const body = new Mesh(new BoxGeometry(0.06, 0.12, 0.04), mat(0xf8fafc, 0.55, 0.08));
    body.name = `${root.name}.device_body`;
    body.position.set(0, 0.82, 0);
    const probe = new Mesh(new CylinderGeometry(0.008, 0.01, 0.18, 8), mat(0x94a3b8, 0.4, 0.4));
    probe.name = `${root.name}.probe`;
    probe.rotation.z = Math.PI / 2;
    probe.position.set(0.12, 0.82, 0);
    const tip = new Mesh(new CylinderGeometry(0.006, 0.006, 0.03, 8), mat(0xef4444, 0.5, 0.1));
    tip.name = `${root.name}.probe_tip`;
    tip.rotation.z = Math.PI / 2;
    tip.position.set(0.22, 0.82, 0);
    root.add(base, stand, body, probe, tip);
  } else if (head === "glucometer") {
    // Wider meter with strip slot.
    const body = new Mesh(new BoxGeometry(0.12, 0.08, 0.05), mat(0x1e3a5f, 0.55, 0.1));
    body.name = `${root.name}.device_body`;
    body.position.set(0, 0.82, 0);
    const screen = new Mesh(new BoxGeometry(0.08, 0.04, 0.01), mat(0x4ade80, 0.35, 0.05));
    screen.name = `${root.name}.meter_screen`;
    screen.position.set(0, 0.84, 0.03);
    const strip = new Mesh(new BoxGeometry(0.04, 0.01, 0.08), mat(0xfef08a, 0.6, 0));
    strip.name = `${root.name}.test_strip`;
    strip.position.set(0.08, 0.8, 0);
    root.add(base, stand, body, screen, strip);
  } else if (head === "nasal_cannula") {
    // Oxygen flow meter + dual prong tubes.
    const body = new Mesh(new CylinderGeometry(0.04, 0.04, 0.14, 12), mat(0x0ea5e9, 0.5, 0.1));
    body.name = `${root.name}.flow_meter`;
    body.position.set(0, 0.85, 0);
    const dial = new Mesh(new CylinderGeometry(0.035, 0.035, 0.015, 12), mat(0xf8fafc, 0.5, 0.1));
    dial.name = `${root.name}.dial`;
    dial.rotation.x = Math.PI / 2;
    dial.position.set(0, 0.9, 0.04);
    const prongL = new Mesh(new CylinderGeometry(0.006, 0.006, 0.12, 6), mat(0xe0f2fe, 0.5, 0.05));
    prongL.name = `${root.name}.prong_l`;
    prongL.rotation.z = 0.4;
    prongL.position.set(-0.06, 0.78, 0.02);
    const prongR = new Mesh(new CylinderGeometry(0.006, 0.006, 0.12, 6), mat(0xe0f2fe, 0.5, 0.05));
    prongR.name = `${root.name}.prong_r`;
    prongR.rotation.z = -0.4;
    prongR.position.set(0.06, 0.78, 0.02);
    root.add(base, stand, body, dial, prongL, prongR);
  } else {
    // Handset phone body + cord + base cradle.
    const handset = new Mesh(new BoxGeometry(0.06, 0.18, 0.04), mat(0x111827, 0.55, 0.1));
    handset.name = `${root.name}.handset`;
    handset.position.set(0.08, 0.88, 0);
    const cradle = new Mesh(new BoxGeometry(0.14, 0.05, 0.1), mat(0x374151, 0.55, 0.15));
    cradle.name = `${root.name}.cradle`;
    cradle.position.set(0, 0.8, 0);
    const cord = new Mesh(new CylinderGeometry(0.008, 0.008, 0.2, 6), mat(0x6b7280, 0.5, 0.1));
    cord.name = `${root.name}.cord`;
    cord.rotation.z = Math.PI / 3;
    cord.position.set(0.05, 0.92, 0);
    root.add(base, stand, cradle, handset, cord);
  }

  return tagEquipmentRoot(root, equipmentId, "parametric", "device_on_stand");
}

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
