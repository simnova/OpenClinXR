/**
 * Clinical support-surface equipment builders (#198).
 *
 * Split from station-equipment.ts by family (not alphabetically) so the parent
 * stays under the apps/ zone budget. Three SEPARATE functions — a shared
 * parameterised builder was rejected: #194 measured 18 parametric kinds
 * collapsing to ~8 triangle signatures; sharing a deck is the cheap green
 * this slice exists to forbid.
 *
 * side_rails_equipment is its own declared id and its own object (not geometry
 * parented to the bed). The bank declares it separately; absorbing it into the
 * bed would make the ledger id inert.
 *
 * claimScope: multi-mesh silhouettes for hospital_bed / stretcher / side_rails
 * equipment ids reachable from the shipped bank.
 * notEvidenceFor: clinical furniture fidelity, Quest readiness, licensed-device
 * geometry, exam-table family substitution.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
} from "three";

export type EquipmentMountSource = "gltf" | "parametric" | "fallback";

function mat(color: ColorRepresentation, roughness = 0.55, metalness = 0.12): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function tagEquipmentRoot(
  root: Group,
  equipmentId: string,
  source: EquipmentMountSource,
): Group {
  root.userData.openClinXrEquipmentId = equipmentId;
  root.userData.openClinXrEquipmentSource = source;
  root.userData.openClinXrRuntimeEquipmentAssetId = equipmentId;
  root.userData.openClinXrAffordances = ["selectable_equipment_reference", "clinical_workflow_cue"];
  return root;
}

/** Hospital bed length (m) — longer and taller than exam-table family. */
export const HOSPITAL_BED_LENGTH_M = 2.15;
export const HOSPITAL_BED_WIDTH_M = 0.98;
export const HOSPITAL_BED_DECK_TOP_M = 0.58;

/**
 * Hospital bed: frame + four legs + mattress + headboard + footboard + pillow.
 * Must not share silhouetteKey with exam_table / stretcher / side_rails.
 */
export function buildHospitalBedEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const L = HOSPITAL_BED_LENGTH_M;
  const W = HOSPITAL_BED_WIDTH_M;
  const deckTop = HOSPITAL_BED_DECK_TOP_M;

  const frame = new Mesh(new BoxGeometry(L * 0.96, 0.08, W * 0.92), mat(0x4b5563, 0.5, 0.3));
  frame.name = `${root.name}.frame`;
  frame.position.set(0, deckTop - 0.18, 0);

  const legGeo = new BoxGeometry(0.07, deckTop - 0.14, 0.07);
  const legMat = mat(0x6b7280, 0.45, 0.35);
  const legOffsets: Array<[number, number]> = [
    [-L * 0.42, -W * 0.38],
    [L * 0.42, -W * 0.38],
    [-L * 0.42, W * 0.38],
    [L * 0.42, W * 0.38],
  ];
  for (let i = 0; i < legOffsets.length; i += 1) {
    const [lx, lz] = legOffsets[i]!;
    const leg = new Mesh(legGeo, legMat);
    leg.name = `${root.name}.leg_${i}`;
    leg.position.set(lx, (deckTop - 0.14) / 2, lz);
    root.add(leg);
  }

  const mattress = new Mesh(new BoxGeometry(L * 0.94, 0.12, W * 0.88), mat(0xdbe4ee, 0.78, 0.02));
  mattress.name = `${root.name}.mattress_deck`;
  mattress.position.set(0, deckTop - 0.06, 0);

  const headboard = new Mesh(new BoxGeometry(0.08, 0.55, W * 0.95), mat(0x374151, 0.5, 0.2));
  headboard.name = `${root.name}.headboard`;
  headboard.position.set(-L * 0.48, deckTop + 0.2, 0);

  const footboard = new Mesh(new BoxGeometry(0.06, 0.32, W * 0.9), mat(0x4b5563, 0.5, 0.22));
  footboard.name = `${root.name}.footboard`;
  footboard.position.set(L * 0.48, deckTop + 0.08, 0);

  const pillow = new Mesh(new BoxGeometry(0.32, 0.1, 0.48), mat(0xf8fafc, 0.85, 0));
  pillow.name = `${root.name}.pillow`;
  pillow.position.set(-L * 0.32, deckTop + 0.04, 0);

  root.add(frame, mattress, headboard, footboard, pillow);
  root.userData.deckTopYMeters = deckTop;
  root.userData.seatHeightMeters = deckTop;
  root.userData.openClinXrEquipmentFamily = "hospital_bed";
  return tagEquipmentRoot(root, equipmentId, "parametric");
}

/** Transport stretcher — wheeled narrow deck with dual rails (not a bed clone). */
export const STRETCHER_EQ_LENGTH_M = 2.0;
export const STRETCHER_EQ_WIDTH_M = 0.72;
export const STRETCHER_EQ_DECK_TOP_M = 0.72;

/**
 * Stretcher: thin frame + mattress + four casters + dual side rails + head push-bar.
 * Wheels (cylinders) and height profile deliberately differ from hospital_bed.
 */
export function buildStretcherEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const L = STRETCHER_EQ_LENGTH_M;
  const W = STRETCHER_EQ_WIDTH_M;
  const deckTop = STRETCHER_EQ_DECK_TOP_M;

  const frame = new Mesh(new BoxGeometry(L * 0.98, 0.05, W * 0.95), mat(0x9ca3af, 0.4, 0.45));
  frame.name = `${root.name}.frame`;
  frame.position.set(0, deckTop - 0.12, 0);

  const mattress = new Mesh(new BoxGeometry(L * 0.92, 0.08, W * 0.88), mat(0xc7d2fe, 0.72, 0.02));
  mattress.name = `${root.name}.mattress_deck`;
  mattress.position.set(0, deckTop - 0.04, 0);

  const wheelGeo = new CylinderGeometry(0.055, 0.055, 0.04, 12);
  const wheelMat = mat(0x111827, 0.55, 0.15);
  const wheelOffsets: Array<[number, number]> = [
    [-L * 0.4, -W * 0.42],
    [L * 0.4, -W * 0.42],
    [-L * 0.4, W * 0.42],
    [L * 0.4, W * 0.42],
  ];
  for (let i = 0; i < wheelOffsets.length; i += 1) {
    const [wx, wz] = wheelOffsets[i]!;
    const wheel = new Mesh(wheelGeo, wheelMat);
    wheel.name = `${root.name}.caster_${i}`;
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.055, wz);
    root.add(wheel);
  }

  const railMat = mat(0x64748b, 0.4, 0.4);
  const leftRail = new Mesh(new BoxGeometry(L * 0.75, 0.22, 0.03), railMat);
  leftRail.name = `${root.name}.rail_left`;
  leftRail.position.set(0, deckTop + 0.08, -W * 0.48);

  const rightRail = new Mesh(new BoxGeometry(L * 0.75, 0.22, 0.03), railMat);
  rightRail.name = `${root.name}.rail_right`;
  rightRail.position.set(0, deckTop + 0.08, W * 0.48);

  const pushBar = new Mesh(new BoxGeometry(0.04, 0.35, W * 0.7), mat(0x475569, 0.45, 0.35));
  pushBar.name = `${root.name}.push_bar`;
  pushBar.position.set(-L * 0.48, deckTop + 0.12, 0);

  // Vertical column posts under the frame (stretcher gurney silhouette).
  const col = new Mesh(new BoxGeometry(0.06, deckTop - 0.14, 0.06), mat(0x94a3b8, 0.45, 0.4));
  col.name = `${root.name}.column`;
  col.position.set(0, (deckTop - 0.14) / 2, 0);

  root.add(frame, mattress, leftRail, rightRail, pushBar, col);
  root.userData.deckTopYMeters = deckTop;
  root.userData.seatHeightMeters = deckTop;
  root.userData.openClinXrEquipmentFamily = "stretcher";
  return tagEquipmentRoot(root, equipmentId, "parametric");
}

/**
 * Side rails as a standalone declared equipment id: two rail assemblies only
 * (no deck/mattress). Distinct narrow silhouette vs bed/stretcher.
 */
export function buildSideRailsEquipment(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const railLen = 1.45;
  const railH = 0.38;
  const spanW = 0.88;
  const railY = 0.72;

  const metal = mat(0x94a3b8, 0.4, 0.5);
  const postGeo = new CylinderGeometry(0.015, 0.015, railH, 8);
  const barGeo = new BoxGeometry(railLen, 0.02, 0.02);

  // Left assembly: 2 posts + 2 horizontal bars
  const lp0 = new Mesh(postGeo, metal);
  lp0.name = `${root.name}.left_post_0`;
  lp0.position.set(-railLen / 2, railY, -spanW / 2);
  const lp1 = new Mesh(postGeo, metal);
  lp1.name = `${root.name}.left_post_1`;
  lp1.position.set(railLen / 2, railY, -spanW / 2);
  const lb0 = new Mesh(barGeo, metal);
  lb0.name = `${root.name}.left_bar_top`;
  lb0.position.set(0, railY + railH / 2 - 0.02, -spanW / 2);
  const lb1 = new Mesh(barGeo, metal);
  lb1.name = `${root.name}.left_bar_mid`;
  lb1.position.set(0, railY, -spanW / 2);

  // Right assembly
  const rp0 = new Mesh(postGeo, metal);
  rp0.name = `${root.name}.right_post_0`;
  rp0.position.set(-railLen / 2, railY, spanW / 2);
  const rp1 = new Mesh(postGeo, metal);
  rp1.name = `${root.name}.right_post_1`;
  rp1.position.set(railLen / 2, railY, spanW / 2);
  const rb0 = new Mesh(barGeo, metal);
  rb0.name = `${root.name}.right_bar_top`;
  rb0.position.set(0, railY + railH / 2 - 0.02, spanW / 2);
  const rb1 = new Mesh(barGeo, metal);
  rb1.name = `${root.name}.right_bar_mid`;
  rb1.position.set(0, railY, spanW / 2);

  // Cross-tie at foot end so the pair is one connected clinical object.
  const cross = new Mesh(new BoxGeometry(0.02, 0.02, spanW), metal);
  cross.name = `${root.name}.cross_tie`;
  cross.position.set(railLen / 2, railY - railH / 4, 0);

  root.add(lp0, lp1, lb0, lb1, rp0, rp1, rb0, rb1, cross);
  root.userData.openClinXrEquipmentFamily = "support_surface";
  return tagEquipmentRoot(root, equipmentId, "parametric");
}
