/**
 * Shared mouth-station objective: pure lip-seat measures, gate thresholds and solver port types.
 *
 * One score vocabulary shared by the executor, the verifier and the solver without
 * importing each other [inv:R1][MADR 0060 d4, 0061 d2]. Gates stay independent scalars;
 * no combined score exists at this base.
 */

export { centroidPacked, countPenetratingVerts, meanRimGapMm, upperDisplacementMm } from "./measures.js";
export {
  DY_GATE_BIAS_PX,
  DY_GATE_DETRENDED_MEDIAN_PX,
  DY_GATE_MAX_PX,
  PENETRATION_FRAMES_MAX,
  RIM_BAND_MM,
  RIM_TARGET_MM,
  UPPER_DISPLACEMENT_BOUND_MM,
} from "./thresholds.js";
export type { Problem, Solution, SolutionFrame, SolverModule } from "./types.js";
