import { planFootsteps } from "./footstep-plan-schedule.js";
import { FOOTSTEP_ROUTE_RANGE_M } from "./footstep-plan-query-flag-mod.js";
import { readFootBaseEnabled } from "./foot-base-query-flag-mod.js";

/**
 * Foot-base route gate (split out of `./foot-base-stride-retarget-mod.js`
 * for the 500-line zone budget; re-exported there so existing deep
 * importers keep working. Behaviour is unchanged).
 *
 * Gate triple: flag on AND route in [0.8, 6.0] AND the footstep plan
 * accepts this route length. The bounds are the parser's own
 * FOOTSTEP_ROUTE_RANGE_M (ONE shared constant, deep import, deliberately
 * NOT re-exported from `./footstep-plan` so no new public symbol): the
 * planner alone accepts 0.5 m (s=0.891) and 10 m (s=0.977) while refusing
 * 0.8 m, so plan-acceptance without the bounds does not enforce the range.
 * The footholds and schedule are built from the plan's half count for the
 * route (planFootsteps steps + the per-half affine travel in
 * footBaseHalfTravelM at the plan's scale, read off approach.footstep):
 * no route constant enters the geometry, so 1.31 m runs byte-identical
 * while 2.0/3.7/6.0 m take the same branch. A refused plan (a middle step
 * under 0.7) or a route outside [0.8, 6.0] keeps the legacy path.
 */
export function footBaseStepIsActive(routeLengthMeters: number): boolean {
  if (!readFootBaseEnabled()) return false;
  if (!(routeLengthMeters > 0) || !Number.isFinite(routeLengthMeters)) return false;
  if (routeLengthMeters < FOOTSTEP_ROUTE_RANGE_M.min || routeLengthMeters > FOOTSTEP_ROUTE_RANGE_M.max) return false;
  return !("refused" in planFootsteps(routeLengthMeters));
}
