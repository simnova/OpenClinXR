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

/**
 * A bedside standing target beside `patientPosition`, facing it.
 *
 * `approachSide` picks which side; the standoff is along world X because every shipped station
 * lays the patient along Z, and a side chosen along the patient's own axis would put the clinician
 * at the head or the feet. That assumption is stated rather than hidden: a station that lays a
 * patient along X needs this to take the patient's own heading, and it does not today.
 */
export function bedsideTargetForClinician(input: {
  patientPosition: Vector3;
  approachSide?: "patient_left" | "patient_right";
  standoffMeters?: number;
}): BedsideTarget {
  const side = input.approachSide ?? "patient_right";
  const standoff = input.standoffMeters ?? BEDSIDE_STANDOFF_METERS;
  const position: Vector3 = {
    x: input.patientPosition.x + (side === "patient_right" ? standoff : -standoff),
    y: input.patientPosition.y,
    z: input.patientPosition.z,
  };
  return {
    position,
    headingRadians: headingRadiansToward(position, input.patientPosition),
    approachSide: side,
  };
}

/**
 * The bedside target expressed as a runtime actor placement for the `additional_cast` slot.
 *
 * The patient anchor is the shipped station's own supine position. It is a CONSTANT here and that
 * is a limit worth naming: a case that moves its patient moves the clinician with it only once the
 * manifest resolves the patient's position first, which it does not do today.
 */
export function bedsideClinicianPlacement(posture: "standing" | "seated" | "supine") {
  const target = bedsideTargetForClinician({ patientPosition: { x: -0.9, y: 0, z: -0.1 } });
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
