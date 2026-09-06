/**
 * Urine cup family (dedicated module — keeps station-equipment-families.ts
 * under its 600-line zone budget).
 *
 * Thin parametric specimen cup: small tapered cup with a lid and a label band.
 * Honest class for "urine cup" prose (OB triage scenario — the learner is
 * handed a labelled specimen cup) — not a blood-culture kit, not a vial.
 *
 * claimScope: factory routing + thin parametric runtime geometry.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { CylinderGeometry, Group, Mesh } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

export function buildUrineCupEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const cup = new Mesh(
    new CylinderGeometry(0.026, 0.018, 0.055, 12),
    equipmentMat(0xfefce8, 0.35, 0.05),
  );
  cup.name = `${root.name}.cup`;
  cup.position.set(0, 0.028, 0);
  const lid = new Mesh(new CylinderGeometry(0.027, 0.027, 0.008, 12), equipmentMat(0xf8fafc, 0.5, 0.08));
  lid.name = `${root.name}.lid`;
  lid.position.set(0, 0.059, 0);
  // Label band — silhouette only, no readable text.
  const label = new Mesh(new CylinderGeometry(0.024, 0.024, 0.016, 12), equipmentMat(0xfbbf24, 0.6, 0.05));
  label.name = `${root.name}.label`;
  label.position.set(0, 0.038, 0);
  root.add(cup, lid, label);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "urine_cup");
}
