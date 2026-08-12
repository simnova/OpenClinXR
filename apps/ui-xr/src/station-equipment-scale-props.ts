/**
 * Scale-setting wall props (#347, MADR 0055 item 5).
 *
 * The eye calibrates a room's size from objects of known size; a room with
 * nothing in it has no scale whatever its measured area (#342). These are
 * parametric multi-mesh builders for the everyday clinical room props — a
 * duplex outlet plate, a light switch, a wall-mounted hand-gel dispenser and a
 * curtain track — each with real-world metric dimensions and enough parts to be
 * recognised at a glance (a flat-coloured box labelled "outlet_plate" sets no
 * scale).
 *
 * Convention: geometry is origin-centred at the WALL-MOUNT POINT (same rule as
 * buildWallClockEquipment — the mount height is the placement root Y only), so
 * a manifest position {x, y, z} puts the prop's centre there.
 *
 * claimScope: parametric runtime room-prop geometry for scale-setting props.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { BoxGeometry, Group, Mesh } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

/**
 * Duplex outlet plate — 0.075 x 0.12 m wall plate, two recessed sockets and two
 * screw dots. A standard duplex outlet is a universal size reference.
 */
export function buildWallOutletPlateEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const plate = new Mesh(new BoxGeometry(0.075, 0.12, 0.012), equipmentMat(0xf7f8f7, 0.62, 0.05));
  plate.name = `${root.name}.plate`;
  const socketL = new Mesh(new BoxGeometry(0.024, 0.038, 0.008), equipmentMat(0x383b3e, 0.55, 0.1));
  socketL.name = `${root.name}.socket_l`;
  socketL.position.set(-0.013, 0.036, 0.01);
  const socketR = new Mesh(new BoxGeometry(0.024, 0.038, 0.008), equipmentMat(0x383b3e, 0.55, 0.1));
  socketR.name = `${root.name}.socket_r`;
  socketR.position.set(0.013, 0.036, 0.01);
  const screwTop = new Mesh(new BoxGeometry(0.005, 0.005, 0.003), equipmentMat(0xd6d3d1, 0.4, 0.3));
  screwTop.name = `${root.name}.screw_top`;
  screwTop.position.set(0, 0.052, 0.008);
  const screwBottom = new Mesh(new BoxGeometry(0.005, 0.005, 0.003), equipmentMat(0xd6d3d1, 0.4, 0.3));
  screwBottom.name = `${root.name}.screw_bottom`;
  screwBottom.position.set(0, -0.052, 0.008);
  root.add(plate, socketL, socketR, screwTop, screwBottom);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "scale_props");
}

/**
 * Light switch — 0.075 x 0.12 m wall plate with a protruding toggle, mounted at
 * ~1.2 m in a room. Toggle silhouette is what makes it read as a switch.
 */
export function buildLightSwitchEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const plate = new Mesh(new BoxGeometry(0.075, 0.12, 0.012), equipmentMat(0xf2efe7, 0.62, 0.05));
  plate.name = `${root.name}.plate`;
  const toggle = new Mesh(new BoxGeometry(0.022, 0.04, 0.016), equipmentMat(0xfafafa, 0.5, 0.08));
  toggle.name = `${root.name}.toggle`;
  toggle.position.set(0, 0.01, 0.012);
  const screw = new Mesh(new BoxGeometry(0.005, 0.005, 0.003), equipmentMat(0xd6d3d1, 0.4, 0.3));
  screw.name = `${root.name}.screw`;
  screw.position.set(0, -0.052, 0.008);
  root.add(plate, toggle, screw);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "scale_props");
}

/**
 * Wall-mounted hand-gel dispenser — wall bracket, teal pump bottle, nozzle.
 * ~0.36 m tall assembly; the pump silhouette is the recogniser.
 */
export function buildHandGelDispenserEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const bracket = new Mesh(new BoxGeometry(0.05, 0.04, 0.04), equipmentMat(0xb8bdc2, 0.5, 0.25));
  bracket.name = `${root.name}.bracket`;
  bracket.position.set(0, 0.13, -0.02);
  const bottle = new Mesh(new BoxGeometry(0.11, 0.26, 0.075), equipmentMat(0x2f8f9d, 0.45, 0.05));
  bottle.name = `${root.name}.bottle`;
  bottle.position.set(0, -0.02, 0);
  const nozzle = new Mesh(new BoxGeometry(0.035, 0.06, 0.05), equipmentMat(0x4a4d52, 0.5, 0.15));
  nozzle.name = `${root.name}.nozzle`;
  nozzle.position.set(0, 0.13, 0.045);
  const band = new Mesh(new BoxGeometry(0.112, 0.03, 0.078), equipmentMat(0xf3f4f6, 0.5, 0.05));
  band.name = `${root.name}.label_band`;
  band.position.set(0, -0.1, 0);
  root.add(bracket, bottle, nozzle, band);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "scale_props");
}

/**
 * Curtain track — horizontal ceiling rail with hanging rings. The ~0.21 m ring
 * spacing and rail length give the eye a size reference near the ceiling.
 */
export function buildCurtainTrackEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const rail = new Mesh(new BoxGeometry(0.03, 0.02, 1.4), equipmentMat(0xb8bdc2, 0.5, 0.3));
  rail.name = `${root.name}.rail`;
  const ringCount = 6;
  const ringSpacing = 1.4 / (ringCount + 1);
  for (let index = 0; index < ringCount; index += 1) {
    const z = -0.7 + ringSpacing * (index + 1);
    const ring = new Mesh(new BoxGeometry(0.014, 0.055, 0.014), equipmentMat(0xc6c9cc, 0.45, 0.35));
    ring.name = `${root.name}.ring_${index + 1}`;
    ring.position.set(0, -0.028, z);
    root.add(ring);
  }
  root.add(rail);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "scale_props");
}
