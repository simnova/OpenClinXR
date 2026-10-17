import type { Object3D } from "three";
import { footBaseStepIsActive } from "./foot-base-route-gate-mod.js";
import { readFootstepPlanEnabled } from "./footstep-plan-query-flag-mod.js";
import { findSteppingLegChain } from "./stepping-turn-leg-ik-mod.js";

/**
 * Rig-capability gate for the default-on locomotion stack (default-flip round 3).
 *
 * ONE concept: a rig can only carry the foot-base stride retarget and the
 * footstep-plan closed loop when it has a *solvable stance leg chain* — the
 * exact chain `solveSteppingLegHinge` needs (`findSteppingLegChain`: hip +
 * upperleg02 + lowerleg01 + lowerleg02 + foot + toe, per side). The SC-05
 * node harness stages a toe-only synthetic humanoid with a `footBase`/`plan`
 * flag ON but NO leg chain, so `legSolveFrames` was structurally 0: the
 * foot-base step still SET the slot along its foothold polyline while its IK
 * pin could not solve, and the planted clip toe slid at the body-advance rate
 * (measured 0.010115 m worst frame against the 0.005 perceptual floor).
 *
 * The gate makes a chainless rig take EXACTLY the path of
 * `?footstepPlan=0&footBase=0`: both layer reads below go false, the footstep
 * plan never captures, the foot-base step never runs, the closed loop and the
 * observe-only stance lock never engage, and the stance lock writes the walk
 * as it did before the flip. The fixed clock stays on regardless — it is
 * rig-independent and is not one of these reads.
 *
 * The capability costs one chain resolution per actor slot, cached for the
 * life of that slot object (a rig does not grow a skeleton mid-run). Real rigs
 * (physician, nurse, child) have both chains, so every gated read returns the
 * flag's own value and their byte-identical path is unchanged.
 */
const rigChainCache = new WeakMap<object, boolean>();

/**
 * True when the actor rig carries a full stance leg chain on BOTH sides. A
 * chain on one side only is not enough: the foot-base step solves every leg it
 * pins, so a half-chain rig would still leave one foot unpinned. Computed once
 * per actor slot and cached.
 */
export function rigHasStanceLegChain(actorSlot: Object3D): boolean {
  const cached = rigChainCache.get(actorSlot);
  if (cached !== undefined) return cached;
  const has =
    findSteppingLegChain(actorSlot, "left") !== null &&
    findSteppingLegChain(actorSlot, "right") !== null;
  rigChainCache.set(actorSlot, has);
  return has;
}

/**
 * Foot-base layer active for this rig and route: the route gate (flag on AND
 * route in [0.8, 6.0] AND the plan accepts it) AND a solvable stance chain.
 * Chainless reads false however the query is set.
 */
export function footBaseActiveFor(actorSlot: Object3D, routeLengthMeters: number): boolean {
  return footBaseStepIsActive(routeLengthMeters) && rigHasStanceLegChain(actorSlot);
}

/**
 * Footstep-plan layer active for this rig: `?footstepPlan` on AND a solvable
 * stance chain. Chainless reads false, so every slot-ownership read of the
 * plan layer falls back to the legacy path.
 */
export function footstepPlanActiveFor(actorSlot: Object3D): boolean {
  return readFootstepPlanEnabled() && rigHasStanceLegChain(actorSlot);
}
