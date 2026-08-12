/**
 * Simple furniture family — tables / desks (dedicated module; keeps
 * station-equipment-families.ts under its 600-line zone budget).
 *
 * Thin parametric table: small table (psych safe room) and consultation desk
 * (oncology) share this module with distinct silhouettes. Honest classes for
 * the "small table" / "consultation desk" prose labels.
 *
 * claimScope: factory routing + thin parametric runtime geometry.
 * notEvidenceFor: clinical device fidelity, Quest readiness, licensed geometry.
 */

import { BoxGeometry, Group, Mesh } from "three";
import { equipmentMat, tagEquipmentRootShared } from "./station-equipment-families.js";

export type TableKind = "small_table" | "consultation_desk";

export function buildSimpleTableEquipment(equipmentId: string, kind: TableKind): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  if (kind === "small_table") {
    // Square low table, four legs — psych safe-room furnishing.
    const top = new Mesh(new BoxGeometry(0.55, 0.035, 0.55), equipmentMat(0xd6d3d1, 0.6, 0.05));
    top.name = `${root.name}.top`;
    top.position.set(0, 0.68, 0);
    for (const [lx, lz] of [[-0.23, -0.23], [0.23, -0.23], [-0.23, 0.23], [0.23, 0.23]] as const) {
      const leg = new Mesh(new BoxGeometry(0.04, 0.66, 0.04), equipmentMat(0xa8a29e, 0.6, 0.05));
      leg.name = `${root.name}.leg`;
      leg.position.set(lx, 0.33, lz);
      root.add(leg);
    }
    root.add(top);
  } else {
    // Wider consultation desk with two pedestals.
    const top = new Mesh(new BoxGeometry(1.0, 0.04, 0.5), equipmentMat(0xd6d3d1, 0.6, 0.05));
    top.name = `${root.name}.top`;
    top.position.set(0, 0.74, 0);
    const pedestal0 = new Mesh(new BoxGeometry(0.44, 0.72, 0.4), equipmentMat(0xa8a29e, 0.6, 0.05));
    pedestal0.name = `${root.name}.pedestal_0`;
    pedestal0.position.set(-0.25, 0.36, 0);
    const pedestal1 = new Mesh(new BoxGeometry(0.44, 0.72, 0.4), equipmentMat(0xa8a29e, 0.6, 0.05));
    pedestal1.name = `${root.name}.pedestal_1`;
    pedestal1.position.set(0.25, 0.36, 0);
    root.add(top, pedestal0, pedestal1);
  }
  return tagEquipmentRootShared(root, equipmentId, "parametric", "tables");
}
