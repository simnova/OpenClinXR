/**
 * Medication cart family (dedicated module — keeps station-equipment-families.ts
 * under its 600-line zone budget).
 *
 * Thin parametric medication cart: drawer-stack body on 4 casters, top work
 * surface with low rail, push handle. Distinct silhouette (tall box + handle)
 * vs tray/stand families. Honest class for "medication cart" prose — NOT the
 * ECG cart (MADR 0049/0054: no silent wrong maps).
 *
 * claimScope: factory routing + thin parametric runtime geometry.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

export function buildMedicationCartEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const body = new Mesh(new BoxGeometry(0.55, 0.78, 0.42), equipmentMat(0x64748b, 0.5, 0.15));
  body.name = `${root.name}.body`;
  body.position.set(0, 0.41, 0);
  // Drawer-stack hint (three thin fronts).
  for (let i = 0; i < 3; i++) {
    const drawer = new Mesh(new BoxGeometry(0.46, 0.12, 0.03), equipmentMat(0x94a3b8, 0.55, 0.12));
    drawer.name = `${root.name}.drawer_${i}`;
    drawer.position.set(0, 0.3 + i * 0.18, 0.215);
    root.add(drawer);
  }
  // Work surface with low rail.
  const surface = new Mesh(new BoxGeometry(0.62, 0.04, 0.48), equipmentMat(0xe2e8f0, 0.55, 0.08));
  surface.name = `${root.name}.work_surface`;
  surface.position.set(0, 0.83, 0);
  const rail = new Mesh(new BoxGeometry(0.66, 0.05, 0.03), equipmentMat(0x94a3b8, 0.5, 0.15));
  rail.name = `${root.name}.rail`;
  rail.position.set(0, 0.88, -0.21);
  root.add(body, surface, rail);
  // Four casters.
  for (const [cx, cz] of [[-0.22, -0.16], [0.22, -0.16], [-0.22, 0.16], [0.22, 0.16]] as const) {
    const caster = new Mesh(new CylinderGeometry(0.035, 0.035, 0.06, 10), equipmentMat(0x1f2937, 0.6, 0.3));
    caster.name = `${root.name}.caster`;
    caster.position.set(cx, 0.03, cz);
    root.add(caster);
  }
  // Push handle at rear.
  const postL = new Mesh(new CylinderGeometry(0.02, 0.02, 0.5, 8), equipmentMat(0x94a3b8, 0.5, 0.15));
  postL.name = `${root.name}.handle_post_l`;
  postL.position.set(-0.24, 1.1, -0.3);
  const postR = new Mesh(new CylinderGeometry(0.02, 0.02, 0.5, 8), equipmentMat(0x94a3b8, 0.5, 0.15));
  postR.name = `${root.name}.handle_post_r`;
  postR.position.set(0.24, 1.1, -0.3);
  const bar = new Mesh(new CylinderGeometry(0.02, 0.02, 0.52, 8), equipmentMat(0x94a3b8, 0.5, 0.15));
  bar.name = `${root.name}.handle_bar`;
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.33, -0.3);
  root.add(postL, postR, bar);
  return tagEquipmentRootShared(root, equipmentId, "parametric", "medication_cart");
}
