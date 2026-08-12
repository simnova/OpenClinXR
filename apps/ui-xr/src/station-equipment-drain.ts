/**
 * Surgical drain family (dedicated module — keeps station-equipment-families.ts
 * under its 600-line zone budget).
 *
 * Thin parametric surgical drain: bulb reservoir + drainage tube + connector.
 * Honest class for "drain" prose (post-op fever scenario — a JP-style bulb
 * drain at the bedside) — not an IV line, not a urine cup.
 *
 * claimScope: factory routing + thin parametric runtime geometry.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { CylinderGeometry, Group, Mesh, SphereGeometry } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

export function buildDrainEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const bulb = new Mesh(new SphereGeometry(0.045, 14, 10), equipmentMat(0xfde68a, 0.35, 0.05));
  bulb.name = `${root.name}.bulb`;
  bulb.scale.set(1, 0.8, 1);
  bulb.position.set(0, 0.05, 0);
  const tube = new Mesh(new CylinderGeometry(0.007, 0.007, 0.22, 6), equipmentMat(0x93c5fd, 0.4, 0.05));
  tube.name = `${root.name}.tube`;
  tube.rotation.z = Math.PI / 2;
  tube.position.set(0.1, 0.03, 0);
  const connector = new Mesh(new CylinderGeometry(0.012, 0.012, 0.03, 8), equipmentMat(0xcbd5e1, 0.5, 0.1));
  connector.name = `${root.name}.connector`;
  connector.rotation.z = Math.PI / 2;
  connector.position.set(0.19, 0.03, 0);
  root.add(bulb, tube, connector);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "drain");
}
