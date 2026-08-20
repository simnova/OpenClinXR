/**
 * #457 — treatment instrument for the standing-grounding cagematch.
 *
 * ONE fixed configuration (D3/D4): a single Rapier world, one kinematic
 * capsule (halfHeight 0.60 + radius 0.25, so the standing centre is
 * REST = 0.85 above a floor whose top is y = 0), one kinematic character
 * controller with snap-to-ground. The caller integrates gravity into a
 * desired translation each step — KCC is move-and-slide, not drop-and-land
 * (hazard 1 in the planted header).
 *
 * ## THE MEASURED CONFIGURATION BOUNDARY (2026-08-19, rapier3d-compat 0.19.3)
 *
 * offset 0.01 + snap-to-ground + proper gravity integration SINKS the
 * capsule through a static floor cuboid at half-thickness ≤ 0.75 m — the
 * docs' own recommended floor range ("cuboid of height 0.5–1.0"). The sink
 * is deterministic (identical final depth across runs) and aperiodic in
 * floor half-extent (fh 10 and 13 sink at offset 0.1; 8/9/11/12/14/15 hold).
 * It holds at half-thickness 1.0 m (2.0 m total) — foot +0.0092,
 * grounded=true, inside the control band. This treatment therefore measures
 * the controller at its WORKING envelope (2.0 m floor); the sink rows are
 * recorded in the cagematch artifact's `hazards` block, not hidden.
 *
 * claimScope: settled foot height (centre.y − REST) and the controller's
 * computedGrounded flag for a standing capsule, offline in Node.
 * notEvidenceFor: seated/supine (KCC is translation-only), browser/WebXR/
 * Quest, frame budget, slopes/stairs/autostep, runtime promotion.
 */

import RAPIER from "@dimforge/rapier3d-compat";

/** Half height of the standing capsule. */
export const STANDING_CAPSULE_HALF_HEIGHT = 0.6;
/** Radius of the standing capsule. */
export const STANDING_CAPSULE_RADIUS = 0.25;
/** Standing centre above a floor whose top is y = 0. */
export const STANDING_REST_CENTRE =
  STANDING_CAPSULE_HALF_HEIGHT + STANDING_CAPSULE_RADIUS;
/** Earth gravity, Rapier default. */
export const GRAVITY = 9.81;
/** Rapier default timestep. */
export const DT = 1 / 60;
/** 4 s of stepping — a 0.40 m drop from rest takes ~0.29 s. */
export const MAX_SETTLE_STEPS = 240;
/**
 * Snap-to-ground threshold. The docs recommend 0.1–0.2; all distances in
 * 0.02–0.5 land identically at the working floor thickness (measured).
 */
export const SNAP_TO_GROUND_DISTANCE = 0.1;
/** Controller offset; the operator's probe implied 0.01 (foot +0.0101). */
export const CONTROLLER_OFFSET = 0.01;
/**
 * Floor half-thickness. Below this the controller sinks through a static
 * floor at offset 0.01 (measured; see module header). 1.0 m half-thickness
 * (2.0 m total) is the thinnest measured configuration that holds.
 */
export const FLOOR_HALF_THICKNESS = 1.0;

export type StandingSettleRow = {
  /** Where the capsule started, relative to REST (m). Negative = penetrating. */
  startOffsetMeters: number;
  /** Settled foot height above the floor: centre.y − REST (m). */
  settledFootMeters: number;
  /** `computedGrounded()` after the last controller step. */
  grounded: boolean;
  /** Steps actually run before the settle criterion fired (or the cap). */
  steps: number;
};

/**
 * Settle ONE standing capsule from `startOffsetMeters` above REST, under a
 * single fixed controller configuration, and record the settled foot height
 * and grounded flag.
 *
 * Gravity is integrated by the caller (v += g·dt; desired = v·dt) — that is
 * the price of move-and-slide. Settle criterion: a controller step that
 * reports grounded and moves < 1e-6 m in all axes.
 */
export async function settleStandingCapsule(
  startOffsetMeters: number,
): Promise<StandingSettleRow> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0.0, y: -GRAVITY, z: 0.0 });

  // Floor: fixed cuboid, top surface at y = 0.
  const floor = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0.0, -FLOOR_HALF_THICKNESS, 0.0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(10.0, FLOOR_HALF_THICKNESS, 10.0),
    floor,
  );

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      0.0,
      STANDING_REST_CENTRE + startOffsetMeters,
      0.0,
    ),
  );
  const capsule = world.createCollider(
    RAPIER.ColliderDesc.capsule(STANDING_CAPSULE_HALF_HEIGHT, STANDING_CAPSULE_RADIUS),
    body,
  );

  const controller = world.createCharacterController(CONTROLLER_OFFSET);
  controller.setUp({ x: 0.0, y: 1.0, z: 0.0 });
  controller.enableSnapToGround(SNAP_TO_GROUND_DISTANCE);
  // Flat floor only — 40° is the default Rapier example value and never binds.
  controller.setMaxSlopeClimbAngle((40 * Math.PI) / 180);

  let verticalSpeed = 0;
  let grounded = false;
  let steps = MAX_SETTLE_STEPS;
  for (let i = 0; i < MAX_SETTLE_STEPS; i += 1) {
    verticalSpeed -= GRAVITY * DT;
    const desired = { x: 0.0, y: verticalSpeed * DT, z: 0.0 };
    // Canonical KCC order: compute the corrected movement FIRST, then step.
    controller.computeColliderMovement(capsule, desired);
    const movement = controller.computedMovement();
    const at = body.translation();
    body.setNextKinematicTranslation({
      x: at.x + movement.x,
      y: at.y + movement.y,
      z: at.z + movement.z,
    });
    world.step();
    grounded = controller.computedGrounded();
    steps = i + 1;
    const moved =
      Math.abs(movement.x) + Math.abs(movement.y) + Math.abs(movement.z);
    if (moved < 1e-6 && grounded) break;
  }

  const settledFootMeters = body.translation().y - STANDING_REST_CENTRE;
  return { startOffsetMeters, settledFootMeters, grounded, steps };
}
