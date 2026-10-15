/** Public subpath entry: keep-only re-exports for the foot-base stride retarget (`?footBase=1` on any plan-accepted route). Implementation: ./foot-base-path-data-mod.js (path rows), ./foot-base-query-flag-mod.js (flag parser), ./foot-base-schedule-mod.js (schedule roles), ./foot-base-stride-retarget-mod.js (walking substep). */

export { FOOT_BASE_CYCLE_S, FOOT_BASE_PLANT_PHASE, FOOT_BASE_ROWS } from "./foot-base-path-data-mod.js";
export { parseFootBaseEnabled } from "./foot-base-query-flag-mod.js";
export {
  FOOT_BASE_LIFT_PHASE,
  FOOT_BASE_STANCE_FRACTION,
  footBaseHalfIndex,
  footBaseRowAt,
  footBaseScheduleStance,
} from "./foot-base-schedule-mod.js";
export { applyFootBaseStep, clearFootBaseState, readFootBaseState } from "./foot-base-stride-retarget-mod.js";
export type { LocomotionStanceLabels } from "./locomotion-stance-labels.js";
