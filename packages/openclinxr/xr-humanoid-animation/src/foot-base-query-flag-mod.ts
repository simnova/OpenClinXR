/**
 * Foot-base stride-retarget flag for the case-owned bedside approach.
 *
 * Default ON: only exactly `footBase=0` reads false; absent or any other
 * value reads true. Opt-out `!== "0"` shape (mirrors stepping-turn): the
 * foot-base stride retarget ships enabled and only `?footBase=0` disables it.
 * Same `globalThis`-window discipline as the neighbouring flag mods.
 */

/** Pure parser, unit-tested without a DOM. */
export function parseFootBaseEnabled(search: string): boolean {
  return new URLSearchParams(search).get("footBase") !== "0";
}

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readFootBaseEnabled(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parseFootBaseEnabled(search);
}
