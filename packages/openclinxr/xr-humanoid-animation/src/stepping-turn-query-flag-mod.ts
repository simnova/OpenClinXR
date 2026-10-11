/**
 * Stepping-turn query flag for the case-owned bedside approach.
 *
 * Default ON: only exactly `steppingTurn=0` reads false; absent or any other
 * value reads true.
 * Opt-out `!== "0"` shape (unlike the apps/ui-xr URL debug flags
 * (`humanoidSourceCleanCapture`, `humanoidComparatorDebugFaceCues`), which stay
 * opt-in `=== "1"`): the stepping arrival turn is on by default and only
 * `?steppingTurn=0` disables it.
 *
 * WHY IT IS READ HERE, not passed through `StationBedsideApproachContext`. That
 * context is at its 12-field ceiling: one more field trips the narrow-context
 * gate. `globalThis` (never a bare `window`) because this module also reaches
 * node tests and the tools-relaxed program with no DOM lib — same discipline as
 * `publishBedsideApproachRuntimeEvidence` below and `capture-mode.ts`'s
 * `browserLocationSearch`.
 */

/** Pure parser, unit-tested without a DOM. */
export function parseSteppingTurnEnabled(search: string): boolean {
  return new URLSearchParams(search).get("steppingTurn") !== "0";
}

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readSteppingTurnEnabled(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parseSteppingTurnEnabled(search);
}
