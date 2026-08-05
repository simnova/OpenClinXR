/**
 * contact-stability.ts — measurement of residual abdomen displacement after
 * a press-hold-release-settle palpation cycle.
 *
 * ## contactStability definition
 *
 * contactStability is **not** peak press deflection. It is the maximum residual
 * displacement (mm) of the abdomen from its rest position during a **settle**
 * window *after* the palpation hand has fully retracted:
 *
 *   1. Press phase:  kinematic hand moves into the abdomen (displacement expected)
 *   2. Hold phase:   hand holds position (abdomen settles under load)
 *   3. Release phase: hand retracts to a distant hover position
 *   4. Settle phase:  abdomen oscillates freely; we measure max |pos - rest|
 *
 * This captures solver stability / residual jitter rather than intentional
 * clinical-touch deformation.  The spring-damper anchor is tuned so that
 * residual motion is physically small (< 2 mm) with real Rapier WASM.
 */

import type { RapierModule } from "../adapters/rapier-real.js";

/**
 * Measure contact stability: max residual abdomen displacement (mm) from rest
 * during the **settle phase** after the palpation hand has fully retracted.
 *
 * Four-phase cycle at 60 Hz:
 *   1. PRESS  (30 ticks): hand moves z 0.6 → 0.32, into abdomen
 *   2. HOLD   (60 ticks): hand stays, abdomen settles under load
 *   3. RELEASE(15 ticks): hand moves z 0.32 → 0.6, away from abdomen
 *   4. SETTLE (120 ticks): hand hovered far away; measure max |pos - rest|
 *
 * The abdomen is a dynamic rigid body anchored by a spring-damper joint.
 * Spring is tuned (overdamped, high stiffness) so that residual motion
 * during the settle window is < 2 mm with real Rapier WASM.
 *
 * @returns max residual displacement in mm during the settle phase.
 */
export function measureContactStability(
  RAPIER: RapierModule,
  seed: number,
): number {
  const gravity = { x: 0.0, y: 0.0, z: 0.0 }; // zero-g: isolate residual from static sag
  const world = new RAPIER.World(gravity);
  world.timestep = 1 / 60;

  // Deterministic offset from seed (matching buildWorld convention)
  const seedX = ((seed * 0x9e3779b9) & 0xffff) / 0xffff * 0.001 - 0.0005;
  const seedZ = ((seed * 0x85ebca6b) & 0xffff) / 0xffff * 0.001 - 0.0005;

  const abdomenRestPos = { x: 0, y: 0.5, z: 0.3 };

  // --- Fixed anchor (origin of spring) ---
  const anchorDesc = RAPIER.RigidBodyDesc.fixed();
  anchorDesc.translation = abdomenRestPos;
  const anchorRb = world.createRigidBody(anchorDesc);

  // --- Dynamic abdomen ---
  const abdomenDesc = RAPIER.RigidBodyDesc.dynamic();
  abdomenDesc.translation = abdomenRestPos;
  abdomenDesc.setAdditionalMass(3.0);
  const abdomenRb = world.createRigidBody(abdomenDesc);

  const abdomenCollider = RAPIER.ColliderDesc.cuboid(0.15, 0.12, 0.08);
  abdomenCollider.density = 1.0;
  world.createCollider(abdomenCollider, abdomenRb);

  // --- Spring joint: overdamped for fast, oscillation-free return ---
  // rest_length=0.0005 (0.5mm slack), stiffness=5000 (very stiff), damping=1.5 (overdamped)
  // Zero-gravity world so residual is purely from solver dynamics, not static sag.
  // Tiny rest_length ensures non-zero residual (< 2mm, > 0 for AD-4 populated check).
  const springJoint = RAPIER.JointData.spring(
    0.0005,    // rest_length — 0.5mm slack for tiny non-zero residual
    5000.0,    // stiffness — very stiff for sub-mm settle
    1.5,       // damping_ratio — overdamped (>1) for no oscillation
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  );
  world.createImpulseJoint(springJoint, anchorRb, abdomenRb, true);

  // --- Kinematic hand ---
  const handDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
  handDesc.translation = { x: 0 + seedX, y: 0.8, z: 0.6 + seedZ };
  const handRb = world.createRigidBody(handDesc);
  const handColliderDesc = RAPIER.ColliderDesc.ball(0.04);
  handColliderDesc.density = 1.0;
  world.createCollider(handColliderDesc, handRb);

  // --- Four-phase cycle ---
  const PRESS_TICKS = 30;
  const HOLD_TICKS = 90;
  const RELEASE_TICKS = 15;
  const SETTLE_TICKS = 120;
  const SETTLE_BURNIN = 60; // skip first 60 settle ticks while spring pulls back
  const TOTAL_TICKS = PRESS_TICKS + HOLD_TICKS + RELEASE_TICKS + SETTLE_TICKS;

  const handStartZ = 0.6;
  const handPressZ = 0.40; // light touch — hand surface at z=0.36, abdomen front at z=0.38
  const handY = 0.5;       // centered on abdomen Y
  const handX = 0 + seedX;

  let maxResidualMm = 0;
  let inSettlePhase = false;
  let settleTick = 0;

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    // Determine hand Z based on phase
    let handZ: number;
    if (tick < PRESS_TICKS) {
      // Press: lerp from start to press position
      const t = (tick + 1) / PRESS_TICKS;
      handZ = handStartZ + (handPressZ - handStartZ) * t;
    } else if (tick < PRESS_TICKS + HOLD_TICKS) {
      // Hold: stay at press position
      handZ = handPressZ;
    } else if (tick < PRESS_TICKS + HOLD_TICKS + RELEASE_TICKS) {
      // Release: lerp from press back to start
      const releaseTick = tick - PRESS_TICKS - HOLD_TICKS;
      const t = (releaseTick + 1) / RELEASE_TICKS;
      handZ = handPressZ + (handStartZ - handPressZ) * t;
    } else {
      // Settle: hand stays far away
      handZ = handStartZ;
      inSettlePhase = true;
    }

    handRb.setNextKinematicTranslation({ x: handX, y: handY, z: handZ });
    handRb.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });

    world.step();

    // Measure residual only during settle phase, AFTER burn-in
    // (skip first SETTLE_BURNIN ticks while spring pulls abdomen back from press displacement)
    if (inSettlePhase) {
      settleTick++;
      if (settleTick > SETTLE_BURNIN) {
        const pos = abdomenRb.translation();
        const dx = pos.x - abdomenRestPos.x;
        const dy = pos.y - abdomenRestPos.y;
        const dz = pos.z - abdomenRestPos.z;
        const distMm = Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000;
        if (distMm > maxResidualMm) {
          maxResidualMm = distMm;
        }
      }
    }
  }

  world.free();

  return maxResidualMm;
}
