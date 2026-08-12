/**
 * Call bell family (dedicated module — keeps station-equipment-families.ts
 * under its 600-line zone budget).
 *
 * Thin parametric bedside call button: small housing with a press button on
 * top and a short cord hint. Honest class for "call light" / "call bell"
 * prose (ward / OB scenarios) — not a monitor or a whiteboard.
 *
 * claimScope: factory routing + thin parametric runtime geometry.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

export function buildCallBellEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const housing = new Mesh(new BoxGeometry(0.09, 0.04, 0.07), equipmentMat(0xe2e8f0, 0.55, 0.08));
  housing.name = `${root.name}.housing`;
  housing.position.set(0, 0.02, 0);
  const button = new Mesh(new CylinderGeometry(0.022, 0.022, 0.018, 10), equipmentMat(0xf87171, 0.5, 0.05));
  button.name = `${root.name}.button`;
  button.position.set(0, 0.05, 0);
  const cord = new Mesh(new CylinderGeometry(0.006, 0.006, 0.14, 6), equipmentMat(0x64748b, 0.5, 0.1));
  cord.name = `${root.name}.cord`;
  cord.position.set(0.03, -0.06, 0);
  root.add(housing, button, cord);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "call_bell");
}

/**
 * Panic button: wall-mounted plate + large red press button. Distinct
 * silhouette (plate + no cord) vs bedside call bell. Honest class for
 * "panic button" prose (psych safety scenario).
 */
export function buildPanicButtonEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const plate = new Mesh(new BoxGeometry(0.14, 0.1, 0.02), equipmentMat(0xf8fafc, 0.6, 0.08));
  plate.name = `${root.name}.plate`;
  plate.position.set(0, 0.05, 0);
  const button = new Mesh(new CylinderGeometry(0.04, 0.04, 0.035, 12), equipmentMat(0xdc2626, 0.45, 0.05));
  button.name = `${root.name}.button`;
  button.position.set(0, 0.055, 0.016);
  const label = new Mesh(new BoxGeometry(0.09, 0.018, 0.004), equipmentMat(0xfbbf24, 0.6, 0.05));
  label.name = `${root.name}.label`;
  label.position.set(0, 0.075, 0.012);
  root.add(plate, button, label);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "panic_button");
}
