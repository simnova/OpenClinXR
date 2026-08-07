/**
 * Procedural patient chair for station fixture slots (#81).
 *
 * Real geometry with a stated seat height — not the 0.18×0.06×0.18 marker cube.
 * Procedural (consistent with the parametric shell); no authored GLB / MADR 0016 path.
 *
 * claimScope: fixture geometry + seat height metadata for seating placement.
 * notEvidenceFor: furniture realism, clinical room fidelity, Quest readiness.
 */

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
} from "three";

/** Seat height of the procedural patient chair (meters above floor). */
export const PATIENT_CHAIR_SEAT_HEIGHT_METERS = 0.45;

export type BuildPatientChairInput = {
  slotId: string;
  purpose?: string;
  position: { x: number; y: number; z: number };
  trimColor: ColorRepresentation;
};

/**
 * Build a simple chair: legs + seat + back. Seat top sits at PATIENT_CHAIR_SEAT_HEIGHT_METERS.
 * userData carries seatHeightMeters and isMarkerCube=false for evidence/wiring.
 */
export function buildPatientChair(input: BuildPatientChairInput): Group {
  const chair = new Group();
  chair.name = `openclinxr.station-environment.fixture-slot.${input.slotId}`;
  chair.position.set(input.position.x, 0, input.position.z);

  const wood = new MeshStandardMaterial({
    color: input.trimColor,
    roughness: 0.65,
    metalness: 0.05,
  });
  const seatMat = wood.clone();
  seatMat.emissiveIntensity = 0.04;
  seatMat.emissive = seatMat.color;

  const seatThickness = 0.05;
  const seatY = PATIENT_CHAIR_SEAT_HEIGHT_METERS - seatThickness / 2;
  const seat = new Mesh(new BoxGeometry(0.48, seatThickness, 0.48), seatMat);
  seat.name = `${chair.name}.seat`;
  seat.position.set(0, seatY, 0);
  chair.add(seat);

  const back = new Mesh(new BoxGeometry(0.48, 0.52, 0.06), wood.clone());
  back.name = `${chair.name}.back`;
  back.position.set(0, PATIENT_CHAIR_SEAT_HEIGHT_METERS + 0.22, -0.21);
  chair.add(back);

  const legGeo = new BoxGeometry(0.05, PATIENT_CHAIR_SEAT_HEIGHT_METERS - seatThickness, 0.05);
  const legY = (PATIENT_CHAIR_SEAT_HEIGHT_METERS - seatThickness) / 2;
  const legOffsets: Array<[number, number]> = [
    [-0.18, -0.18],
    [0.18, -0.18],
    [-0.18, 0.18],
    [0.18, 0.18],
  ];
  for (let i = 0; i < legOffsets.length; i += 1) {
    const [lx, lz] = legOffsets[i]!;
    const leg = new Mesh(legGeo, wood.clone());
    leg.name = `${chair.name}.leg.${i}`;
    leg.position.set(lx, legY, lz);
    chair.add(leg);
  }

  chair.userData.fixtureSlotId = input.slotId;
  chair.userData.fixtureSlotPurpose = input.purpose ?? "patient seating";
  chair.userData.seatHeightMeters = PATIENT_CHAIR_SEAT_HEIGHT_METERS;
  chair.userData.isMarkerCube = false;
  chair.userData.openClinXrChairKind = "procedural_patient_chair";
  chair.userData.openClinXrDynamicScenePolicy = "patient_chair_real_geometry_with_seat_height";

  return chair;
}

export function isPatientChairSlotId(slotId: string): boolean {
  const id = slotId.toLowerCase();
  return id === "patient_chair" || id.includes("patient_chair") || id.endsWith("_chair");
}
