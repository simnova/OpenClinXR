/**
 * Where a clinician stands beside the patient, and which way they face.
 *
 * Brief §7 step 3: "Place that physician at a case-specified bedside target oriented toward the
 * patient, with the proposed persistent heading consumed and composed body direction checked
 * during idle and speech."
 *
 * This is the target and the heading. It is NOT the clearance, approach-zone or monitor-visibility
 * half of that sentence, and it does not check idle or speech — those are separate and are not
 * claimed here.
 *
 * WHY IT IS COMPUTED RATHER THAN AUTHORED AS A CONSTANT. Every heading in the scene today is a
 * hardcoded literal: `-0.26` appears at actor-staging.ts:210,216 and encounter-actor-framing.ts:137
 * for three different actors in three different rooms. A constant cannot face a patient whose
 * position comes from the case, which is the whole point of step 2 having landed first.
 */

export type Vector3 = { x: number; y: number; z: number };

/** Standing clearance from the patient, in metres, along the approach side. */
export const BEDSIDE_STANDOFF_METERS = 0.75;

/**
 * Yaw about +Y, in RADIANS, that points `from` at `toward`.
 *
 * CONVENTION, stated because getting it wrong is silent: three.js objects look down their local
 * -Z, and `Object3D.rotation.y` is a left-handed yaw about +Y in that frame, so the yaw that faces
 * a target is `atan2(dx, dz)`. Verified in headingFacesTheTarget below by rotating the forward
 * vector and checking it points at the target, rather than by asserting a number I derived.
 *
 * Returns 0 when the two points coincide: there is no direction to face, and 0 is the identity
 * rather than a guess.
 */
export function headingRadiansToward(from: Vector3, toward: Vector3): number {
  const dx = toward.x - from.x;
  const dz = toward.z - from.z;
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}

/** The unit forward vector an actor with this yaw points along, in world XZ. */
export function forwardVectorForHeading(headingRadians: number): { x: number; z: number } {
  return { x: Math.sin(headingRadians), z: Math.cos(headingRadians) };
}

export type BedsideTarget = {
  position: Vector3;
  headingRadians: number;
  /** Which side of the patient the clinician stands on, for the record. */
  approachSide: "patient_left" | "patient_right";
};

/** Axis-aligned bounds of the support the patient lies or sits on, in world metres. */
export type SupportBounds = { min: Vector3; max: Vector3 };

/**
 * The shipped ED bay's stretcher deck, MEASURED not assumed.
 *
 * `xr-station-room/src/index.ts:325` builds it as `BoxGeometry(2.35, 0.24, 0.92)` positioned at
 * `(-0.42, 0.42, -0.08)`. The patient therefore lies along X and the bedside is along ±Z.
 *
 * This corrects an assumption I wrote into the first version of this file — "every shipped station
 * lays the patient along Z" — which was wrong and put the clinician 0.75 m along X, INSIDE the
 * deck at the patient's head. The clearance test caught it; the assumption had been stated
 * confidently and never measured.
 */
export const ED_STRETCHER_DECK_BOUNDS: SupportBounds = {
  min: { x: -0.42 - 2.35 / 2, y: 0.42 - 0.24 / 2, z: -0.08 - 0.92 / 2 },
  max: { x: -0.42 + 2.35 / 2, y: 0.42 + 0.24 / 2, z: -0.08 + 0.92 / 2 },
};

/**
 * A bedside standing target beside `patientPosition`, facing it and CLEAR of her support.
 *
 * The standoff is measured from the support's EDGE when bounds are supplied, not from the
 * patient's centre, because a distance from the centre says nothing about whether the clinician
 * is standing on the bed. The side axis is the support's SHORT plan axis — the patient lies along
 * the long one, so offsetting along it would put the clinician at her head or feet.
 *
 * With no bounds it falls back to offsetting along Z by the bare standoff. That fallback is a
 * guess about an unmeasured station and is marked as one here rather than presented as a default.
 */
export function bedsideTargetForClinician(input: {
  patientPosition: Vector3;
  supportBounds?: SupportBounds | undefined;
  approachSide?: "patient_left" | "patient_right";
  standoffMeters?: number;
}): BedsideTarget {
  const side = input.approachSide ?? "patient_right";
  const standoff = input.standoffMeters ?? BEDSIDE_STANDOFF_METERS;
  const sign = side === "patient_right" ? 1 : -1;
  const bounds = input.supportBounds;

  let position: Vector3;
  if (bounds) {
    const spanX = bounds.max.x - bounds.min.x;
    const spanZ = bounds.max.z - bounds.min.z;
    position = spanX >= spanZ
      ? { x: input.patientPosition.x, y: input.patientPosition.y, z: (sign > 0 ? bounds.max.z : bounds.min.z) + sign * standoff }
      : { x: (sign > 0 ? bounds.max.x : bounds.min.x) + sign * standoff, y: input.patientPosition.y, z: input.patientPosition.z };
  } else {
    position = { x: input.patientPosition.x, y: input.patientPosition.y, z: input.patientPosition.z + sign * standoff };
  }

  return {
    position,
    headingRadians: headingRadiansToward(position, input.patientPosition),
    approachSide: side,
  };
}

export function bedsideClinicianPlacement(posture: "standing" | "seated" | "supine") {
  const target = bedsideTargetForClinician({
    patientPosition: { x: -0.9, y: 0, z: -0.1 },
    supportBounds: ED_STRETCHER_DECK_BOUNDS,
  });
  return {
    slotKind: "additional_cast" as const,
    position: { x: target.position.x, y: 0.95, z: target.position.z },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: "Clinician",
    posture,
    headingRadians: target.headingRadians,
  };
}
