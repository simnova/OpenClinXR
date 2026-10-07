/**
 * Mouth-station executor: builds the seat problem from GLB bytes and applies
 * a pinned solution to GLB bytes with receipt provenance (MADR 0061 stationRole executor).
 *
 * The station owns running the job; the solver is a plug-in the registry resolves.
 * This entry takes no solver id, no tuning value and no solve callback (d6).
 * Until the registry card lands, the producer counterweight keeps running through
 * the old tools CLI, which re-exports the executor's seat modules.
 */

export { buildProblem, type BuildProblemOptions } from "./problem.js";
export { apply, type ApplyProvenance, type ApplyResult } from "./apply.js";
/** Solver input: the unseated asset and the cue track it must satisfy. */
export type { Problem } from "@openclinxr/station-mouth-objective";
/** Solver output: scored frames plus the provenance the receipt records. */
export type { Solution } from "@openclinxr/station-mouth-objective";
