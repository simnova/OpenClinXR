/**
 * Incentive spirometer family (dedicated module — keeps
 * station-equipment-families.ts under its 600-line zone budget).
 *
 * Thin parametric incentive spirometer: base + three vertical indicator
 * chambers (each with a float ball) + mouthpiece tube. Honest class for
 * "incentive spirometer" prose (post-op fever scenario — the bedside
 * breathing-exercise device) — not an IV device, not a nebulizer mask.
 *
 * claimScope: factory routing + thin parametric runtime geometry.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh, SphereGeometry } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

export function buildIncentiveSpirometerEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const base = new Mesh(new BoxGeometry(0.16, 0.03, 0.09), equipmentMat(0x93c5fd, 0.5, 0.08));
  base.name = `${root.name}.base`;
  base.position.set(0, 0.015, 0);
  const ballColors = [0xdc2626, 0x16a34a, 0x2563eb];
  for (let i = 0; i < 3; i += 1) {
    const x = -0.05 + i * 0.05;
    const chamber = new Mesh(new CylinderGeometry(0.016, 0.016, 0.11, 10), equipmentMat(0xf1f5f9, 0.3, 0.05));
    chamber.name = `${root.name}.chamber${i + 1}`;
    chamber.position.set(x, 0.085, 0);
    const ball = new Mesh(new SphereGeometry(0.012, 10, 8), equipmentMat(ballColors[i]!, 0.4, 0.05));
    ball.name = `${root.name}.ball${i + 1}`;
    ball.position.set(x, 0.04 + i * 0.025, 0);
    root.add(chamber, ball);
  }
  const mouthpiece = new Mesh(new CylinderGeometry(0.01, 0.01, 0.12, 8), equipmentMat(0x94a3b8, 0.45, 0.05));
  mouthpiece.name = `${root.name}.mouthpiece`;
  mouthpiece.rotation.z = Math.PI / 2;
  mouthpiece.position.set(0.1, 0.03, 0);
  root.add(base, mouthpiece);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "incentive_spirometer");
}
