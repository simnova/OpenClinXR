/**
 * Privacy curtain family (dedicated module — keeps station-equipment-families.ts
 * under its 600-line zone budget).
 *
 * Thin parametric bed-side privacy curtain: ceiling track + two hanging
 * panels. Honest class for "privacy curtain" prose (clinic / OB scenarios).
 * Distinct silhouette (wide thin hanging panels) vs screens/trays.
 *
 * claimScope: factory routing + thin parametric runtime geometry.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

export function buildPrivacyCurtainEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const track = new Mesh(new CylinderGeometry(0.015, 0.015, 1.6, 8), equipmentMat(0x475569, 0.5, 0.3));
  track.name = `${root.name}.track`;
  track.rotation.z = Math.PI / 2;
  track.position.set(0, 1.9, 0);
  // Two hanging panels with a slight gap (openable).
  const panel0 = new Mesh(new BoxGeometry(0.78, 1.75, 0.008), equipmentMat(0x93c5fd, 0.7, 0));
  panel0.name = `${root.name}.panel_0`;
  panel0.position.set(-0.4, 0.9, 0);
  const panel1 = new Mesh(new BoxGeometry(0.78, 1.75, 0.008), equipmentMat(0xbfdbfe, 0.7, 0));
  panel1.name = `${root.name}.panel_1`;
  panel1.position.set(0.4, 0.9, 0);
  root.add(track, panel0, panel1);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "privacy_curtain");
}
