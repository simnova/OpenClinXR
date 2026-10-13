/**
 * Walk-exit contact-window query flag for the case-owned bedside approach.
 *
 * Default OFF (handback fallback, 2026-10-13): only exactly
 * `walkExitWindow=1` reads true. Two fix attempts (legacy-width band, then
 * legacy-cadence band evaluation) left the both-on arrival at
 * (-0.0301, +0.0384) vs the main control (-0.0231, +0.0153): the exit clip
 * phase steers the clip-driven turn chaotically and no band formulation lands
 * the legacy phase back. The window stays available opt-in for the
 * determinism work; the default path is fixed clock + legacy immediate exit
 * (cell-2 config, measured -0.0301 / +0.0385, sd <= 0.0002).
 */

/** Pure parser, unit-tested without a DOM. */
export function parseWalkExitWindowEnabled(search: string): boolean {
  return new URLSearchParams(search).get("walkExitWindow") === "1";
}

/**
 * Read here (not threaded through `StationBedsideApproachContext`): that
 * context is at its 12-field ceiling. `globalThis` (never a bare `window`)
 * because this module also reaches node tests with no DOM lib — same
 * discipline as `stepping-turn-query-flag-mod.ts`.
 */

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readWalkExitWindowEnabled(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parseWalkExitWindowEnabled(search);
}
