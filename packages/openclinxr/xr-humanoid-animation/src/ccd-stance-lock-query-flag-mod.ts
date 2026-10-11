/**
 * CCD stance-lock query flag for the case-owned bedside approach.
 *
 * Default OFF: only exactly `ccdStanceLock=1` reads true; absent or any other
 * value reads false.
 * Opt-in `=== "1"` shape (like the apps/ui-xr URL debug flags
 * (`humanoidSourceCleanCapture`, `humanoidComparatorDebugFaceCues`)): the
 * stance-lock hinge solve is off by default and only `?ccdStanceLock=1`
 * enables it. This is the mirror of `stepping-turn-query-flag-mod.ts`, which
 * is default-on opt-out because the stepping arrival turn ships enabled.
 *
 * WHY IT IS READ HERE, not passed through `StationBedsideApproachContext`. That
 * context is at its 12-field ceiling: one more field trips the narrow-context
 * gate. `globalThis` (never a bare `window`) because this module also reaches
 * node tests and the tools-relaxed program with no DOM lib — same discipline as
 * `publishBedsideApproachRuntimeEvidence` in `station-bedside-approach-mod.ts`
 * and `capture-mode.ts`'s `browserLocationSearch`.
 */

/** Pure parser, unit-tested without a DOM. */
export function parseCcdStanceLockEnabled(search: string): boolean {
  return new URLSearchParams(search).get("ccdStanceLock") === "1";
}

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readCcdStanceLockEnabled(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parseCcdStanceLockEnabled(search);
}
