/**
 * Procedural ED stretcher for station fixture slots (#97).
 *
 * Real horizontal bed geometry with a stated deck height — not the 0.18×0.06×0.18
 * marker cube, and not the axis-broken shell slab (Z-up authored, Y-up read).
 * Follows #81 buildPatientChair: procedural, fixture-slot driven, no authored GLB.
 *
 * claimScope: fixture geometry + deck height metadata for bedside layout.
 * notEvidenceFor: furniture realism, clinical stretcher fidelity, Quest readiness,
 * supine patient placement (out of scope for #97).
 */

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
  type Object3D,
} from "three";

/** Top of the mattress deck (meters above floor) — body rest height. */
export const STRETCHER_DECK_TOP_METERS = 0.55;

/** Overall mattress length (long horizontal axis, meters). */
export const STRETCHER_LENGTH_METERS = 2.2;

/** Mattress width (short horizontal axis, meters). */
export const STRETCHER_WIDTH_METERS = 0.9;

export type BuildPatientStretcherInput = {
  slotId: string;
  purpose?: string;
  position: { x: number; y: number; z: number };
  trimColor: ColorRepresentation;
};

/**
 * Build a simple stretcher: base frame + mattress + side rails.
 * Deck top sits at STRETCHER_DECK_TOP_METERS. Length exceeds height.
 */
export function buildPatientStretcher(input: BuildPatientStretcherInput): Group {
  const stretcher = new Group();
  stretcher.name = `openclinxr.station-environment.fixture-slot.${input.slotId}`;
  stretcher.position.set(input.position.x, 0, input.position.z);

  const metal = new MeshStandardMaterial({
    color: 0x9aa3ad,
    roughness: 0.55,
    metalness: 0.35,
  });
  const mattressMat = new MeshStandardMaterial({
    color: 0xd9dde3,
    roughness: 0.72,
    metalness: 0.02,
  });
  const railMat = metal.clone();
  railMat.color.set(input.trimColor);

  const mattressThickness = 0.14;
  const mattressY = STRETCHER_DECK_TOP_METERS - mattressThickness / 2;
  const mattress = new Mesh(
    new BoxGeometry(STRETCHER_LENGTH_METERS, mattressThickness, STRETCHER_WIDTH_METERS),
    mattressMat,
  );
  mattress.name = `${stretcher.name}.mattress`;
  mattress.position.set(0, mattressY, 0);
  stretcher.add(mattress);

  const baseHeight = 0.1;
  const baseY = 0.22;
  const base = new Mesh(
    new BoxGeometry(STRETCHER_LENGTH_METERS * 0.92, baseHeight, STRETCHER_WIDTH_METERS * 0.88),
    metal,
  );
  base.name = `${stretcher.name}.base`;
  base.position.set(0, baseY, 0);
  stretcher.add(base);

  // Four legs under the base
  const legH = baseY - baseHeight / 2;
  const legGeo = new BoxGeometry(0.06, Math.max(0.08, legH), 0.06);
  const legY = legH / 2;
  const halfL = STRETCHER_LENGTH_METERS * 0.4;
  const halfW = STRETCHER_WIDTH_METERS * 0.38;
  const legOffsets: Array<[number, number]> = [
    [-halfL, -halfW],
    [halfL, -halfW],
    [-halfL, halfW],
    [halfL, halfW],
  ];
  for (let i = 0; i < legOffsets.length; i += 1) {
    const [lx, lz] = legOffsets[i]!;
    const leg = new Mesh(legGeo, metal.clone());
    leg.name = `${stretcher.name}.leg.${i}`;
    leg.position.set(lx, legY, lz);
    stretcher.add(leg);
  }

  // Side rails — low translucent bars along length
  const railH = 0.12;
  const railY = STRETCHER_DECK_TOP_METERS + railH / 2;
  for (const side of [-1, 1] as const) {
    const rail = new Mesh(
      new BoxGeometry(STRETCHER_LENGTH_METERS * 0.85, railH, 0.04),
      railMat.clone(),
    );
    rail.name = `${stretcher.name}.rail.${side < 0 ? "left" : "right"}`;
    rail.position.set(0, railY, side * (STRETCHER_WIDTH_METERS / 2 + 0.02));
    stretcher.add(rail);
  }

  // Small pillow at head end (negative X) — deck-level, not underground
  const pillow = new Mesh(new BoxGeometry(0.28, 0.08, 0.42), mattressMat.clone());
  pillow.name = `${stretcher.name}.pillow`;
  pillow.position.set(-STRETCHER_LENGTH_METERS * 0.38, STRETCHER_DECK_TOP_METERS + 0.04, 0);
  stretcher.add(pillow);

  stretcher.userData.fixtureSlotId = input.slotId;
  stretcher.userData.fixtureSlotPurpose = input.purpose ?? "ED stretcher / bedside";
  stretcher.userData.deckTopYMeters = STRETCHER_DECK_TOP_METERS;
  stretcher.userData.seatHeightMeters = STRETCHER_DECK_TOP_METERS;
  stretcher.userData.isMarkerCube = false;
  stretcher.userData.openClinXrStretcherKind = "procedural_patient_stretcher";
  stretcher.userData.openClinXrDynamicScenePolicy =
    "stretcher_real_geometry_with_deck_height_suppresses_shell_slab";

  return stretcher;
}

export function isStretcherSlotId(slotId: string): boolean {
  const id = slotId.toLowerCase();
  return (
    id === "stretcher" ||
    id.includes("stretcher") ||
    id === "patient_bed" ||
    id.endsWith("_bed") ||
    id === "bed"
  );
}

/**
 * Hide shell stretcher / bed nodes (and any leftover vertical slab) so the
 * procedural stretcher is the only visible bed. Name match + Cube.018–023.
 */
export function suppressShellStretcherNodes(root: Object3D): number {
  let hidden = 0;
  root.traverse((obj) => {
    if (obj === root) return;
    const name = (obj.name ?? "").toLowerCase();
    const hit =
      name.includes("stretcher") ||
      name.includes("bed_pillow") ||
      name.includes("bed_blanket") ||
      name.includes("bed_wheel") ||
      name.includes("mattress") ||
      /cube\.0(1[89]|2[0-3])/i.test(name);
    if (!hit) return;
    obj.visible = false;
    obj.userData.openClinXrStretcherPolicy =
      "hidden_axis_broken_shell_stretcher_procedural_slot_owns_bed";
    hidden += 1;
  });
  return hidden;
}

/**
 * Load-time prep for ed-exam-bay-shell.glb (#97).
 * Entire authored shell is axis-scrambled (Z-up export of Y-up-intent Blender).
 * Parametric station shell already draws walls/floor; procedural stretcher owns the bed.
 * Hide the whole loaded GLB so no vertical floor/mattress slab occludes the nurse.
 */
export function prepareLoadedEnvironmentShell(root: Object3D): {
  repaired: number;
  stretcherNodesHidden: number;
} {
  const stretcherNodesHidden = suppressShellStretcherNodes(root);
  root.visible = false;
  root.userData.openClinXrShellPolicy =
    "hidden_axis_broken_shell_glb_parametric_shell_and_procedural_stretcher_own_room";
  return { repaired: 0, stretcherNodesHidden };
}
