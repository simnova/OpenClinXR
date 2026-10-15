import { planFootsteps } from "./footstep-plan-schedule.js";
import { readFootBaseEnabled } from "./foot-base-query-flag-mod.js";

/**
 * Foot-base route gate (split out of `./foot-base-stride-retarget-mod.js`
 * for the 500-line zone budget; re-exported there so existing deep
 * importers keep working. Behaviour is unchanged).
 *
 * Gate twin: flag on and the footstep plan accepts this route length. The
 * footholds and schedule are built from the plan's half count for the route
 * (planFootsteps steps + the per-half affine travel in footBaseHalfTravelM
 * at the plan's scale, read off approach.footstep): no route constant
 * enters the geometry, so 1.31 m runs byte-identical while 2.0/3.7/6.0 m
 * take the same branch. A refused plan (out of [0.8, 6.0] or a middle step
 * under 0.7) keeps the legacy path.
 */
export function footBaseStepIsActive(routeLengthMeters: number): boolean {
  if (!readFootBaseEnabled()) return false;
  if (!(routeLengthMeters > 0) || !Number.isFinite(routeLengthMeters)) return false;
  return !("refused" in planFootsteps(routeLengthMeters));
}
