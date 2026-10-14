/**
 * Foot-base stride-retarget opt-in for the case-owned bedside approach.
 *
 * Default OFF: only exactly `footBase=1` reads true; absent or any other
 * value reads false. Same opt-in `=== "1"` shape as the neighbouring flag
 * mods; this module also reaches node tests with no DOM lib, so no bare
 * `window` reference. Deliberately NOT re-exported from `./footstep-plan`
 * (no new public symbol); the walking tail reads it by deep import.
 */

/** Pure parser, unit-tested without a DOM. */
export function parseFootBaseEnabled(search: string): boolean {
  return new URLSearchParams(search).get("footBase") === "1";
}

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readFootBaseEnabled(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parseFootBaseEnabled(search);
}
