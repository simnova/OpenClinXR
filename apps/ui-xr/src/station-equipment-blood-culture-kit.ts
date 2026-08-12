/**
 * Blood-culture kit family (dedicated module — keeps station-equipment-families.ts
 * under its 600-line zone budget).
 *
 * Thin parametric blood-culture collection set: tray with two collection
 * bottles (aerobic/anaerobic) + label bands. Honest class for "blood-culture
 * kit" prose (stepdown sepsis scenario — the nurse collects blood cultures)
 * — not a urine cup, not a vacutainer tube.
 *
 * claimScope: factory routing + thin parametric runtime geometry.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

export function buildBloodCultureKitEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const tray = new Mesh(new BoxGeometry(0.16, 0.015, 0.09), equipmentMat(0xe2e8f0, 0.55, 0.1));
  tray.name = `${root.name}.tray`;
  tray.position.set(0, 0.008, 0);
  const caps = [0x16a34a, 0x2563eb]; // aerobic / anaerobic
  for (let i = 0; i < 2; i += 1) {
    const x = i === 0 ? -0.035 : 0.035;
    const bottle = new Mesh(new CylinderGeometry(0.02, 0.02, 0.05, 10), equipmentMat(0xf8fafc, 0.3, 0.05));
    bottle.name = `${root.name}.bottle${i + 1}`;
    bottle.position.set(x, 0.04, 0);
    const cap = new Mesh(new CylinderGeometry(0.014, 0.014, 0.018, 10), equipmentMat(caps[i]!, 0.5, 0.05));
    cap.name = `${root.name}.cap${i + 1}`;
    cap.position.set(x, 0.075, 0);
    const band = new Mesh(new CylinderGeometry(0.021, 0.021, 0.012, 10), equipmentMat(0xfbbf24, 0.6, 0.05));
    band.name = `${root.name}.band${i + 1}`;
    band.position.set(x, 0.045, 0);
    root.add(bottle, cap, band);
  }
  root.add(tray);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "blood_culture_kit");
}
