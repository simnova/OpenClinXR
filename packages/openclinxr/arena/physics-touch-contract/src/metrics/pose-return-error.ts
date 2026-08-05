/**
 * Pose return error measurement using a spring-damper system.
 *
 * A dynamic body is connected to a fixed anchor via a spring joint.
 * An impulse displaces the body; after settle time, we measure how far
 * the body remains from the rest position. The positional error is
 * converted to angular error (°) using a reference arm length of 0.5 m.
 *
 * The measurement uses Rapier's deterministic spring solver with
 * moderate clinical-tissue-like stiffness and damping.
 */

import type { RapierModule } from "../adapters/rapier-real.js";

/**
 * Measure pose return error using a spring-damper system.
 *
 * A dynamic body is connected to a fixed anchor via a spring joint.
 * An impulse displaces the body; after settle time, we measure how far
 * the body remains from the rest position. The positional error is
 * converted to angular error (°) using a reference arm length of 0.5 m.
 *
 * The measurement uses Rapier's deterministic spring solver with
 * moderate clinical-tissue-like stiffness and damping.
 */
export function measurePoseReturnError(
  RAPIER: RapierModule,
  _seed: number,
): number {
  // Zero-gravity world for clean return measurement
  const gravity = { x: 0.0, y: 0.0, z: 0.0 };
  const world = new RAPIER.World(gravity);
  world.timestep = 1 / 60;

  // Fixed anchor at origin
  const anchorDesc = RAPIER.RigidBodyDesc.fixed();
  anchorDesc.translation = { x: 0, y: 1.0, z: 0 };
  const anchorRb = world.createRigidBody(anchorDesc);

  // Dynamic body (the "limb") with moderate damping
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic();
  bodyDesc.translation = { x: 0, y: 1.0, z: 0 };
  bodyDesc.setLinearDamping(0.5);
  const bodyRb = world.createRigidBody(bodyDesc);

  // Collider for the body
  const collDesc = RAPIER.ColliderDesc.ball(0.05);
  collDesc.density = 1.0;
  world.createCollider(collDesc, bodyRb);

  // Spring joint: rest length 0, moderate stiffness (tissue-like)
  const springJoint = RAPIER.JointData.spring(
    0.0,       // rest_length — returns to anchor
    500.0,     // stiffness — moderate clinical-tissue level
    1.0,       // damping_ratio
    { x: 0, y: 0, z: 0 }, // anchor1 (in anchorRb local space)
    { x: 0, y: 0, z: 0 }, // anchor2 (in bodyRb local space)
  );
  world.createImpulseJoint(springJoint, anchorRb, bodyRb, true);

  // Apply an impulse to simulate palpation displacement (~5 N·s)
  bodyRb.applyImpulse({ x: 2.0, y: 0, z: 2.0 }, true);

  // Step for 120 ticks (2 seconds at 60 Hz) to let the system settle
  for (let i = 0; i < 120; i++) {
    world.step();
  }

  // Measure final position error (mm) from the rest position
  const final = bodyRb.translation();
  const dx = final.x - 0;
  const dy = final.y - 1.0;
  const dz = final.z - 0;
  const distM = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Convert linear return error to angular error (°)
  // Reference arm length: 0.5 m (typical shoulder-to-elbow)
  const referenceArmM = 0.5;
  const errorDeg = Math.atan2(distM, referenceArmM) * (180 / Math.PI);

  world.free();

  return errorDeg;
}
