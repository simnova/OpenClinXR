/**
 * Named ?script= sets for the sync probe page (data only, no validators).
 *
 * Lives apart from probe-query.ts because the architecture gate forbids an
 * apps/ module from exporting a validator (parse…/validate…/assert…/is…)
 * alongside any other export (export const counts): probe-query.ts stays
 * validator-only, and every sync-probe.ts call site that used to repeat a
 * `query.script === "cN" || ...` list now reads one set, so adding a script
 * touches one line here instead of every list.
 */

export type ProbeScript =
  | "c2"
  | "c3"
  | "c6"
  | "c7"
  | "c8"
  | "c10"
  | "c11"
  | "c12"
  | "c13"
  | "c14"
  | "c15"
  | "c16"
  | "c17"
  | "c18"
  | "c19"
  | "c20"
  | "c21"
  | "c22";

/** Scripts that join the review lobby (select-station flow, never the encounter roster). */
export const LOBBY_SCRIPTS: ReadonlySet<ProbeScript> = new Set(["c12", "c13", "c14", "c20", "c21"]);
/** Scripts that need a ?rubric= parameter (faculty-score tiles). */
export const RUBRIC_SCRIPTS: ReadonlySet<ProbeScript> = new Set(["c13", "c14"]);
/** Scripts that watch a recorded replay room. */
export const REPLAY_SCRIPTS: ReadonlySet<ProbeScript> = new Set(["c10", "c18"]);
/** Scripts that run the doorway pre-encounter select probe at connect. */
export const PRE_ENCOUNTER_PROBE_SCRIPTS: ReadonlySet<ProbeScript> = new Set(["c6", "c7", "c8", "c15", "c16", "c17", "c19"]);
/** Scripts whose pose stream starts off (deterministic select attribution; pose proven elsewhere). */
export const POSE_OFF_SCRIPTS: ReadonlySet<ProbeScript> = new Set(["c10", "c12", "c13", "c14", "c15", "c16", "c17", "c18", "c19", "c20", "c21", "c22"]);
/** Scripts whose trigger sends select-actor only (utterances come from the scripted turn sequence). */
export const SELECT_ONLY_TRIGGER_SCRIPTS: ReadonlySet<ProbeScript> = new Set(["c3", "c6", "c7", "c8", "c15"]);
/** Scripts that discover actors from SERVER state (cast/replay rooms have no a1/a2). */
export const DYNAMIC_ACTOR_SCRIPTS: ReadonlySet<ProbeScript> = new Set(["c10", "c16", "c17", "c18", "c19", "c22"]);
/** Scripts that run the head-yaw sweep (pose evidence; every other script skips it for timing). */
export const HEAD_SWEEP_SCRIPTS: ReadonlySet<ProbeScript> = new Set(["c2", "c3", "c6"]);
/** Scripts that skip the learner catch-up drain (replay/lobby rooms reject every intent). */
export const NO_LEARNER_CATCH_UP_SCRIPTS: ReadonlySet<ProbeScript> = new Set(["c10", "c12", "c13", "c14", "c18", "c19", "c20", "c21", "c22"]);
