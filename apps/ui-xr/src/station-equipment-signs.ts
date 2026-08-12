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
