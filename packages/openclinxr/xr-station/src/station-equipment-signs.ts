/**
 * Wall sign family (dedicated module — keeps station-equipment-families.ts
 * under its 600-line zone budget).
 *
 * Thin parametric wall-mounted informational sign: frame + face + text-line
 * hints + mounting bracket. Honest class for "privacy notice", "CT direction
 * sign", "fall-risk sign" and "sepsis alert panel" prose (psych / ED stroke /
 * ward delirium / stepdown scenarios) — a framed wall panel, not a monitor or
 * a whiteboard.
 *
 * claimScope: factory routing + thin parametric runtime geometry.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

export function buildWallSignEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const frame = new Mesh(new BoxGeometry(0.36, 0.24, 0.02), equipmentMat(0x334155, 0.55, 0.1));
  frame.name = `${root.name}.frame`;
  frame.position.set(0, 0.12, 0);
  const face = new Mesh(new BoxGeometry(0.33, 0.21, 0.012), equipmentMat(0xf8fafc, 0.75, 0.05));
  face.name = `${root.name}.face`;
  face.position.set(0, 0.12, 0.013);
  // Text-line hints (3 horizontal bars) — no readable text, silhouette only.
  for (let i = 0; i < 3; i += 1) {
    const line = new Mesh(new BoxGeometry(0.24 - i * 0.05, 0.014, 0.004), equipmentMat(0x94a3b8, 0.6, 0.05));
    line.name = `${root.name}.line${i + 1}`;
    line.position.set(0, 0.165 - i * 0.035, 0.02);
    root.add(line);
  }
  // Mounting bracket (wall side).
  const bracket = new Mesh(new CylinderGeometry(0.01, 0.01, 0.05, 6), equipmentMat(0x64748b, 0.5, 0.15));
  bracket.name = `${root.name}.bracket`;
  bracket.rotation.x = Math.PI / 2;
  bracket.position.set(0, 0.12, -0.02);
  root.add(frame, face, bracket);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "wall_sign");
}

/**
 * Wall / freestanding clinical whiteboard with frame + writing surface + tray.
 * Moved here from station-equipment-builders.ts (#347) to keep that dispatcher
 * under the apps/ 600-line zone budget.
 */
export function buildSafetyPlanWhiteboardEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const board = new Mesh(new BoxGeometry(0.9, 0.55, 0.03), equipmentMat(0xf8fafc, 0.85, 0.02));
  board.name = `${root.name}.board`;
  board.position.set(0, 1.35, 0);
  const frame = new Mesh(new BoxGeometry(0.96, 0.61, 0.04), equipmentMat(0x64748b, 0.55, 0.2));
  frame.name = `${root.name}.frame`;
  frame.position.set(0, 1.35, -0.01);
  const tray = new Mesh(new BoxGeometry(0.7, 0.04, 0.08), equipmentMat(0x475569, 0.6, 0.15));
  tray.name = `${root.name}.marker_tray`;
  tray.position.set(0, 1.05, 0.04);
  const strip = new Mesh(new BoxGeometry(0.55, 0.03, 0.01), equipmentMat(0x0ea5e9, 0.45, 0.05));
  strip.name = `${root.name}.header_strip`;
  strip.position.set(0, 1.55, 0.02);
  root.add(frame, board, tray, strip);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "own_geometry");
}

/** ECG lead wires + clip pack resting on the bed deck (multi-mesh, not a unit box). */
export function buildEkgLeadsOnBedEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const pack = new Mesh(new BoxGeometry(0.14, 0.04, 0.1), equipmentMat(0x1e293b, 0.55, 0.1));
  pack.name = `${root.name}.lead_pack`;
  pack.position.set(0, 0.03, 0);
  const clipL = new Mesh(new BoxGeometry(0.03, 0.02, 0.04), equipmentMat(0xf87171, 0.5, 0.1));
  clipL.name = `${root.name}.clip_l`;
  clipL.position.set(-0.08, 0.04, 0.06);
  const clipR = new Mesh(new BoxGeometry(0.03, 0.02, 0.04), equipmentMat(0x60a5fa, 0.5, 0.1));
  clipR.name = `${root.name}.clip_r`;
  clipR.position.set(0.08, 0.04, 0.06);
  const wire1 = new Mesh(new CylinderGeometry(0.006, 0.006, 0.22, 6), equipmentMat(0x334155, 0.5, 0.2));
  wire1.name = `${root.name}.wire_a`;
  wire1.rotation.z = Math.PI / 2;
  wire1.position.set(0, 0.05, 0.08);
  const wire2 = new Mesh(new CylinderGeometry(0.006, 0.006, 0.18, 6), equipmentMat(0x475569, 0.5, 0.2));
  wire2.name = `${root.name}.wire_b`;
  wire2.rotation.z = Math.PI / 2.4;
  wire2.position.set(0.02, 0.045, -0.05);
  root.add(pack, clipL, clipR, wire1, wire2);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "own_geometry");
}
