/**
 * Medication bottles family (dedicated module — keeps station-equipment-families.ts
 * under its 600-line zone budget).
 *
 * Thin parametric small prescription bottles: 3 cylindrical bottles with caps on
 * a small tray hint. Honest class for "medication bottles" prose (telehealth
 * diabetes scenario — the learner reviews the patient's pill bottles) — not an
 * IV bag, not a cart.
 *
 * claimScope: factory routing + thin parametric runtime geometry.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { CylinderGeometry, Group, Mesh } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

export function buildMedicationBottlesEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const tray = new Mesh(new CylinderGeometry(0.09, 0.1, 0.012, 16), equipmentMat(0x94a3b8, 0.6, 0.1));
  tray.name = `${root.name}.tray`;
  tray.position.set(0, 0.006, 0);
  const bottles: Array<{ r: number; h: number; x: number; z: number; cap: number }> = [
    { r: 0.028, h: 0.09, x: -0.028, z: 0.012, cap: 0xdc2626 },
    { r: 0.032, h: 0.11, x: 0.0, z: -0.02, cap: 0x2563eb },
    { r: 0.026, h: 0.075, x: 0.03, z: 0.016, cap: 0x16a34a },
  ];
  for (let i = 0; i < bottles.length; i += 1) {
    const b = bottles[i]!;
    const body = new Mesh(new CylinderGeometry(b.r, b.r, b.h, 12), equipmentMat(0xf1f5f9, 0.55, 0.08));
    body.name = `${root.name}.bottle${i + 1}`;
    body.position.set(b.x, 0.012 + b.h / 2, b.z);
    const cap = new Mesh(new CylinderGeometry(b.r * 0.85, b.r * 0.85, 0.02, 12), equipmentMat(b.cap, 0.5, 0.05));
    cap.name = `${root.name}.cap${i + 1}`;
    cap.position.set(b.x, 0.024 + b.h, b.z);
    root.add(body, cap);
  }
  root.add(tray);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "medication_bottles");
}
