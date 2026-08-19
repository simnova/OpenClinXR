/**
 * #452 — the offline Rapier gate actually steps, on the evidence rail.
 *
 * The runtime advertises an "offline rapier gate" in a mode string
 * (`runtime_proxy_cues_with_offline_rapier_gate` at apps/ui-xr/src/main.ts:1735
 * and packages/openclinxr/scenario-runtime/src/runtime-state.ts:1046) but no
 * world, no step, no import existed to back the claim. This module is the
 * cagematch proof that the engine steps in-process, offline, in Node — it is
 * NOT a production step and must not be imported into `apps/ui-xr` (the
 * physics-touch pre-production fence at static-assets.test.ts:1192 stays up).
 *
 * Reference (external floor, not fitted to the measurement): a body released
 * from rest under gravity falls ½·g·t². Rapier's default timestep is 1/60 s,
 * so 60 steps is exactly 1 s and 0.5 × 9.81 × 1² = 4.905 m. The semi-implicit
 * Euler integrator overshoots by half a step (g·dt²/2 per step), measured at
 * 4.9254 m — residual 0.0204 m, inside the contract's 0.05 m band.
 *
 * NOT TESTED here: collisions/contacts/joints, determinism across platforms,
 * the Quest budget, or whether Rapier should ever enter the runtime.
 */

import RAPIER from "@dimforge/rapier3d-compat";

/** Number of world steps the gate runs — 1 s of Rapier's default 1/60 s timestep. */
export const RAPIER_GATE_STEPS = 60 as const;

/** Release height of the free-fall probe body. */
export const RAPIER_GATE_START_Y = 10 as const;

export type RapierFreeFallGateResult = {
  /** Engine version reported by the runtime, e.g. "0.19.3". */
  engineVersion: string;
  /** Number of `world.step()` calls executed. */
  steps: number;
  /** Measured vertical drop in metres: start Y minus body Y after stepping. */
  dropMeters: number;
};

/**
 * Create a Rapier world with earth gravity, drop one dynamic ball from
 * `RAPIER_GATE_START_Y`, step `RAPIER_GATE_STEPS` times, and report the drop.
 *
 * A world that is created but never stepped falls 0.0000 m; a stub returning a
 * constant cannot land inside the 5 cm band around 4.905 m by accident.
 */
export async function runFreeFallGate(): Promise<RapierFreeFallGateResult> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0.0, RAPIER_GATE_START_Y, 0.0),
  );
  world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
  for (let i = 0; i < RAPIER_GATE_STEPS; i += 1) {
    world.step();
  }
  const dropMeters = RAPIER_GATE_START_Y - body.translation().y;
  return { engineVersion: RAPIER.version(), steps: RAPIER_GATE_STEPS, dropMeters };
}
