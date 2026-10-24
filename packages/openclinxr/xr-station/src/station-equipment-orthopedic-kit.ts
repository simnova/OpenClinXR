/**
 * Orthopedic clinic kit family builders: crutches / goniometer / ice-pack.
 *
 * Closes the #785 residual: `crutches_equipment`, `goniometer_equipment` and
 * `ice_pack_equipment` (declared by the sports-medicine knee-pain scenario) fell
 * through to `buildGenericClinicalEquipmentFallback` — base box + upright
 * cylinder + tray box, 3 meshes / 56 triangles, no named family.
 *
 * One SHARED parametrized family builder (not three unique builders): the
 * #198 lesson was "do NOT make fourteen unique; that is the exam-table collapse
 * again". The family label is the honest clinical grouping — the knee-clinic
 * orthopedic kit — and every kind emits a genuinely distinct silhouette
 * (distinct meshCount AND triangle count AND 2dp extent, so the #202
 * silhouetteKey collision check passes for the right reason).
 *
 * Kind geometry (all units metres, axis-aligned, origin at floor centre):
 *  - crutches: PAIRED axillary crutches staged together + tie strap.
 *    11 meshes / 292 tris, extent ~0.38 x 1.29 x 0.20 (tall narrow pair).
 *  - goniometer: wall-hook plate + protractor dial + long/short ROM arms +
 *    pivot knob. 5 meshes / 148 tris, extent ~0.32 x 0.30 x 0.05.
 *  - ice_pack: cooler body + lid + hinge + carry handle + pack slab on the
 *    cooler + retaining strap ("ice pack on the cooler, not an ED cart").
 *    6 meshes / 92 tris, extent ~0.47 x 0.44 x 0.32.
 *
 * Every kind mixes Box and Cylinder primitives (basic non-box shape check) and
 * stays above the >3 parametric mesh floor. Part names carry no deck/mattress/
 * seat/top tokens, so deckHeightM stays null (no false deck claims).
 *
 * claimScope: multi-mesh silhouettes for the three knee-clinic kit ids.
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
import {
  tagEquipmentRootShared,
} from "./station-equipment-families.js";

function mat(color: ColorRepresentation, roughness = 0.55, metalness = 0.12): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

export type OrthopedicKitKind = "crutches" | "goniometer" | "ice_pack";

function buildCrutchesPair(rootName: string): Mesh[] {
  const parts: Mesh[] = [];
  const aluminum = mat(0x9ca3af, 0.4, 0.5);
  const padMat = mat(0x374151, 0.7, 0.05);
  const gripMat = mat(0x1f2937, 0.65, 0.08);
  const tipMat = mat(0x111827, 0.8, 0);
  // Two axillary crutches side by side (x = -0.16 / +0.16).
  for (const [ci, cx] of [-0.16, 0.16].entries()) {
    const uprightGeo = new CylinderGeometry(0.011, 0.013, 1.1, 8);
    for (const [ui, uz] of [-0.055, 0.055].entries()) {
      const upright = new Mesh(uprightGeo, aluminum);
      upright.name = `${rootName}.upright_${ci}_${ui}`;
      upright.position.set(cx, 0.68, uz);
      parts.push(upright);
    }
    const pad = new Mesh(new BoxGeometry(0.06, 0.05, 0.2), padMat);
    pad.name = `${rootName}.underarm_pad_${ci}`;
    pad.position.set(cx, 1.26, 0);
    parts.push(pad);
    const grip = new Mesh(new CylinderGeometry(0.013, 0.013, 0.16, 8), gripMat);
    grip.name = `${rootName}.handgrip_${ci}`;
    grip.rotation.x = Math.PI / 2;
    grip.position.set(cx, 0.72, 0);
    parts.push(grip);
    const tip = new Mesh(new CylinderGeometry(0.016, 0.02, 0.06, 8), tipMat);
    tip.name = `${rootName}.tip_${ci}`;
    tip.position.set(cx, 0.03, 0);
    parts.push(tip);
  }
  // Tie strap holding the staged pair together.
  const strap = new Mesh(new BoxGeometry(0.4, 0.03, 0.03), gripMat);
  strap.name = `${rootName}.pair_strap`;
  strap.position.set(0, 1.05, 0);
  parts.push(strap);
  return parts;
}

function buildGoniometer(rootName: string): Mesh[] {
  const parts: Mesh[] = [];
  const plate = new Mesh(new BoxGeometry(0.1, 0.14, 0.02), mat(0x4b5563, 0.55, 0.25));
  plate.name = `${rootName}.wall_hook_plate`;
  plate.position.set(0, 1.0, -0.02);
  parts.push(plate);
  const dial = new Mesh(new CylinderGeometry(0.07, 0.07, 0.012, 20), mat(0xf8fafc, 0.5, 0.08));
  dial.name = `${rootName}.protractor_dial`;
  dial.rotation.x = Math.PI / 2;
  dial.position.set(0, 1.02, 0.02);
  parts.push(dial);
  const armMat = mat(0x0ea5e9, 0.45, 0.15);
  const armLong = new Mesh(new BoxGeometry(0.3, 0.025, 0.012), armMat);
  armLong.name = `${rootName}.arm_long`;
  armLong.position.set(0.1, 1.1, 0.03);
  armLong.rotation.z = 0.5;
  parts.push(armLong);
  const armShort = new Mesh(new BoxGeometry(0.2, 0.025, 0.012), armMat);
  armShort.name = `${rootName}.arm_short`;
  armShort.position.set(-0.06, 0.96, 0.03);
  armShort.rotation.z = -0.9;
  parts.push(armShort);
  const pivot = new Mesh(new CylinderGeometry(0.014, 0.014, 0.03, 8), mat(0x374151, 0.5, 0.3));
  pivot.name = `${rootName}.pivot_knob`;
  pivot.rotation.x = Math.PI / 2;
  pivot.position.set(0, 1.02, 0.035);
  parts.push(pivot);
  return parts;
}

function buildIcePackOnCooler(rootName: string): Mesh[] {
  const parts: Mesh[] = [];
  const body = new Mesh(new BoxGeometry(0.45, 0.28, 0.3), mat(0xdc2626, 0.6, 0.05));
  body.name = `${rootName}.cooler_body`;
  body.position.set(0, 0.16, 0);
  parts.push(body);
  const lid = new Mesh(new BoxGeometry(0.47, 0.06, 0.32), mat(0xf8fafc, 0.6, 0.05));
  lid.name = `${rootName}.cooler_lid`;
  lid.position.set(0, 0.33, 0);
  parts.push(lid);
  const hinge = new Mesh(new BoxGeometry(0.1, 0.03, 0.03), mat(0x4b5563, 0.55, 0.2));
  hinge.name = `${rootName}.lid_hinge`;
  hinge.position.set(0, 0.3, -0.15);
  parts.push(hinge);
  const handle = new Mesh(new CylinderGeometry(0.015, 0.015, 0.3, 8), mat(0x374151, 0.55, 0.2));
  handle.name = `${rootName}.carry_handle`;
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, 0.42, 0);
  parts.push(handle);
  const slab = new Mesh(new BoxGeometry(0.25, 0.035, 0.18), mat(0xbae6fd, 0.45, 0.05));
  slab.name = `${rootName}.ice_pack_slab`;
  slab.position.set(0, 0.378, 0);
  parts.push(slab);
  const strap = new Mesh(new BoxGeometry(0.26, 0.012, 0.05), mat(0x1e3a5f, 0.6, 0.05));
  strap.name = `${rootName}.retaining_strap`;
  strap.position.set(0, 0.4, 0);
  parts.push(strap);
  return parts;
}

/**
 * Shared orthopedic-kit family builder. `kind` selects genuinely distinct
 * geometry; the family tag is the clinical grouping, not a silhouette claim.
 */
export function buildOrthopedicKitFamilyEquipment(
  equipmentId: string,
  kind: OrthopedicKitKind,
): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const parts =
    kind === "crutches"
      ? buildCrutchesPair(root.name)
      : kind === "goniometer"
        ? buildGoniometer(root.name)
        : buildIcePackOnCooler(root.name);
  root.add(...parts);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "orthopedic_kit");
}
