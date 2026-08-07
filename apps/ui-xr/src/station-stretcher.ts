/**
 * Procedural ED stretcher for station fixture slots (#97 / #159).
 *
 * Real horizontal bed geometry with a stated deck height — not the 0.18×0.06×0.18
 * marker cube, and not the axis-broken shell slab (Z-up authored, Y-up read).
 * Follows #81 buildPatientChair: procedural, fixture-slot driven, no authored GLB.
 *
 * #159: single head-of-bed hinge at the hip line. Seat stays flat; back section
 * raises with one inclineDeg SSOT on userData. Rails split (seat fixed, back
 * follows pivot); pillow parents to the back so it rides the HOB.
 *
 * claimScope: fixture geometry + deck height + staging incline articulation.
 * notEvidenceFor: trained-eye hospital-bed fidelity, multi-joint (Gatch) articulation,
 * clinical positioning correctness, Quest readiness.
 * Supine plant that follows the live back plane is #159 (supine-pose), not this module alone.
 */

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
  type Object3D,
} from "three";

/** Top of the mattress deck (meters above floor) — seat surface height when flat. */
export const STRETCHER_DECK_TOP_METERS = 0.55;

/** Overall mattress length (long horizontal axis, meters). */
export const STRETCHER_LENGTH_METERS = 2.2;

/** Mattress width (short horizontal axis, meters). */
export const STRETCHER_WIDTH_METERS = 0.9;

/**
 * Local X of the single HOB hinge (hip line). Head is −X, feet +X.
 * One hinge only — not a three-section Gatch bed.
 */
export const STRETCHER_HOB_HINGE_LOCAL_X = 0;

const MATTRESS_THICKNESS = 0.14;
const BACK_SECTION_NAME = "back";
const SEAT_SECTION_NAME = "seat";

export type BuildPatientStretcherInput = {
  slotId: string;
  purpose?: string;
  position: { x: number; y: number; z: number };
  trimColor: ColorRepresentation;
  /**
   * Head-of-bed incline degrees from horizontal. Default 0 = today's flat deck
   * (counterweight for #150/#153). Range intended [0, 45]; not a product target —
   * the #159 contact sheet chooses the ship angle.
   */
  inclineDegrees?: number;
};

function clampIncline(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return Math.max(0, Math.min(45, degrees));
}

/**
 * Build a stretcher: base frame + articulating mattress (seat + back) + rails + pillow.
 * Deck top (seat) sits at STRETCHER_DECK_TOP_METERS. Length exceeds height.
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

  const halfLen = STRETCHER_LENGTH_METERS / 2;
  const seatLen = halfLen - STRETCHER_HOB_HINGE_LOCAL_X; // hinge at 0 → seat length halfLen
  const backLen = halfLen + STRETCHER_HOB_HINGE_LOCAL_X; // back length halfLen
  const mattressY = STRETCHER_DECK_TOP_METERS - MATTRESS_THICKNESS / 2;

  // --- Seat section (flat, foot end +X) ---
  const seat = new Group();
  seat.name = `${stretcher.name}.deck.${SEAT_SECTION_NAME}`;
  seat.userData.openClinXrDeckSection = SEAT_SECTION_NAME;
  const seatMesh = new Mesh(
    new BoxGeometry(seatLen, MATTRESS_THICKNESS, STRETCHER_WIDTH_METERS),
    mattressMat,
  );
  seatMesh.name = `${seat.name}.mesh`;
  // Seat top at deck top: center at hingeX + seatLen/2
  seatMesh.position.set(STRETCHER_HOB_HINGE_LOCAL_X + seatLen / 2, mattressY, 0);
  seat.add(seatMesh);
  stretcher.add(seat);

  // --- Back section pivot at hip line / deck top (single HOB hinge) ---
  const backPivot = new Group();
  backPivot.name = `${stretcher.name}.deck.${BACK_SECTION_NAME}`;
  backPivot.userData.openClinXrDeckSection = BACK_SECTION_NAME;
  backPivot.userData.openClinXrHobHinge = true;
  // Pivot origin on the top surface at the hinge so rotation raises the head end.
  backPivot.position.set(STRETCHER_HOB_HINGE_LOCAL_X, STRETCHER_DECK_TOP_METERS, 0);
  const backMesh = new Mesh(
    new BoxGeometry(backLen, MATTRESS_THICKNESS, STRETCHER_WIDTH_METERS),
    mattressMat.clone(),
  );
  backMesh.name = `${backPivot.name}.mesh`;
  // Local: head end −X; top face on pivot y=0 when flat.
  backMesh.position.set(-backLen / 2, -MATTRESS_THICKNESS / 2, 0);
  backPivot.add(backMesh);

  // Pillow rides the back section (was fixed at deck top — wrong at 45°).
  const pillow = new Mesh(new BoxGeometry(0.28, 0.08, 0.42), mattressMat.clone());
  pillow.name = `${stretcher.name}.pillow`;
  // Near head end of back section, slightly above the mattress top.
  pillow.position.set(-backLen * 0.76, 0.04, 0);
  backPivot.add(pillow);

  // Back-side rails follow the HOB so full-length fixed rails do not clip a raised torso.
  const railH = 0.12;
  const railHalfLen = backLen * 0.85;
  for (const side of [-1, 1] as const) {
    const rail = new Mesh(
      new BoxGeometry(railHalfLen, railH, 0.04),
      railMat.clone(),
    );
    rail.name = `${stretcher.name}.rail.back.${side < 0 ? "left" : "right"}`;
    // Local to back pivot: along back length, above deck surface.
    rail.position.set(-backLen / 2, railH / 2, side * (STRETCHER_WIDTH_METERS / 2 + 0.02));
    backPivot.add(rail);
  }
  stretcher.add(backPivot);

  // Seat-side rails stay flat (do not span the raised torso zone).
  const seatRailLen = seatLen * 0.85;
  for (const side of [-1, 1] as const) {
    const rail = new Mesh(
      new BoxGeometry(seatRailLen, railH, 0.04),
      railMat.clone(),
    );
    rail.name = `${stretcher.name}.rail.seat.${side < 0 ? "left" : "right"}`;
    rail.position.set(
      STRETCHER_HOB_HINGE_LOCAL_X + seatLen / 2,
      STRETCHER_DECK_TOP_METERS + railH / 2,
      side * (STRETCHER_WIDTH_METERS / 2 + 0.02),
    );
    stretcher.add(rail);
  }

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

  stretcher.userData.fixtureSlotId = input.slotId;
  stretcher.userData.fixtureSlotPurpose = input.purpose ?? "ED stretcher / bedside";
  stretcher.userData.deckTopYMeters = STRETCHER_DECK_TOP_METERS;
  stretcher.userData.seatHeightMeters = STRETCHER_DECK_TOP_METERS;
  stretcher.userData.isMarkerCube = false;
  stretcher.userData.openClinXrStretcherKind = "procedural_patient_stretcher";
  stretcher.userData.openClinXrDynamicScenePolicy =
    "stretcher_real_geometry_with_deck_height_suppresses_shell_slab";
  stretcher.userData.openClinXrDeckSections = [SEAT_SECTION_NAME, BACK_SECTION_NAME];
  stretcher.userData.openClinXrHobHingeLocalX = STRETCHER_HOB_HINGE_LOCAL_X;
  stretcher.userData.openClinXrHobModel = "single_hinge_head_of_bed";
  // Incline SSOT lives on the stretcher; pose must read it (deck leads).
  setStretcherInclineDegrees(stretcher, input.inclineDegrees ?? 0);

  return stretcher;
}

function findBackPivot(stretcher: Object3D): Object3D | null {
  let found: Object3D | null = null;
  stretcher.traverse((obj) => {
    if (found) return;
    if (obj.userData?.openClinXrDeckSection === BACK_SECTION_NAME) found = obj;
  });
  return found;
}

/**
 * Set head-of-bed incline. Deck leads — one inclineDeg SSOT on stretcher userData.
 * Positive degrees raise the head (−X) end via −Z rotation on the back pivot.
 */
export function setStretcherInclineDegrees(stretcher: Object3D, degrees: number): void {
  const deg = clampIncline(degrees);
  const back = findBackPivot(stretcher);
  if (back) {
    // Raise head (−X) toward +Y: rotation about +Z by −θ.
    back.rotation.z = (-deg * Math.PI) / 180;
    back.updateMatrixWorld?.(true);
  }
  stretcher.userData.openClinXrStretcherInclineDegrees = deg;
  stretcher.userData.openClinXrInclineSource = "stretcher_userData_ssot";
  stretcher.updateMatrixWorld?.(true);
}

/** Read the incline SSOT from stretcher userData (deck leads). */
export function readStretcherInclineDegrees(stretcher: Object3D): number {
  const raw = stretcher.userData?.openClinXrStretcherInclineDegrees;
  return typeof raw === "number" && Number.isFinite(raw) ? clampIncline(raw) : 0;
}

/**
 * Live world-space angle of the back section top from horizontal (degrees).
 * Measured from the back pivot's rotated +Y, not from a threaded scalar.
 */
export function readStretcherBackSectionWorldDeg(stretcher: Object3D): number {
  const back = findBackPivot(stretcher);
  if (!back) return 0;
  back.updateWorldMatrix?.(true, false);
  // Local +Y of the back pivot is the surface normal when flat.
  const e = back.matrixWorld.elements;
  // Column 1 of matrixWorld is the world-space Y axis of the object.
  const ny = e[5] ?? 1; // m[1][1] → Y component of local Y
  const nx = e[4] ?? 0; // m[0][1] → X component of local Y
  // Angle of the surface from horizontal: atan2 of normal's X vs Y after −Z rot.
  // After rotation.z = −θ, local +Y maps toward world (sinθ, cosθ) in XY.
  const deg = (Math.atan2(nx, ny) * 180) / Math.PI;
  return deg;
}

export function readStretcherDeckSectionNames(stretcher: Object3D): string[] {
  const names = stretcher.userData?.openClinXrDeckSections;
  if (Array.isArray(names) && names.every((n) => typeof n === "string")) {
    return names as string[];
  }
  const found: string[] = [];
  stretcher.traverse((obj) => {
    const s = obj.userData?.openClinXrDeckSection;
    if (typeof s === "string" && !found.includes(s)) found.push(s);
  });
  return found;
}

/** Find the procedural stretcher under a scene/root (userData kind or name). */
export function findProceduralStretcher(root: Object3D): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj.userData?.openClinXrStretcherKind === "procedural_patient_stretcher") {
      found = obj;
    }
  });
  return found;
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
