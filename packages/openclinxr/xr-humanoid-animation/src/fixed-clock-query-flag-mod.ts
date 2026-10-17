/**
 * Fixed-clock query flag for the case-owned bedside approach.
 *
 * Default ON: only exactly `fixedClock=0` reads false; absent or any other
 * value reads true. Opt-out `!== "0"` shape (mirrors stepping-turn): the
 * fixed timestep clock ships enabled and only `?fixedClock=0` disables it.
 * `globalThis` (never a bare `window`) because this module also reaches node
 * tests with no DOM lib.
 */

/** Pure parser, unit-tested without a DOM. */
export function parseFixedClockEnabled(search: string): boolean {
  return new URLSearchParams(search).get("fixedClock") !== "0";
}

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readFixedClockEnabled(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parseFixedClockEnabled(search);
}
