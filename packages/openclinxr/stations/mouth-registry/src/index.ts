/**
 * Mouth-station registry: generated solver map, committed pin and run.
 *
 * The registry has no stationRole; it declares the station with the registry
 * marker the role check recognises. It is the only package allowed to import
 * solver packages. run takes no solver id and no tuning value [MADR 0061 d4-d7].
 */

export { loadPin, loadPinnedSolver, run, verifySolution } from "./run.js";
/** Committed pin: exactly the solver id and version the registry resolves. */
export type { RegistryPin } from "./run.js";
/** Input for run: the unseated asset bytes plus the one operator-set target. */
export type { RunOptions } from "./run.js";
/** Seated bytes, the receipt note and the pinned solution that produced them. */
export type { RunResult } from "./run.js";
/** Solver input: the unseated asset and the cue track it must satisfy. */
export type { Problem } from "@openclinxr/station-mouth-objective";
/** Solver output: scored frames plus the provenance the receipt records. */
export type { Solution } from "@openclinxr/station-mouth-objective";
