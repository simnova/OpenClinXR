/**
 * Closed-loop-walk query flag for the case-owned bedside approach.
 *
 * Default OFF: only exactly `closedLoopWalk=1` reads true; absent or any
 * other value reads false. Footstep-plan S1 ports the walk-closed-loop
 * closed-loop root advance as an opt-in library: without the flag the
 * executor's planned-speed advance runs untouched.
 *
 * Opt-in `=== "1"` shape (like `acting-stance-lock-query-flag-mod.ts`): this
 * module also reaches node tests and the tools-relaxed program with no DOM
 * lib, so a bare `window` reference would throw in node.
 */

/** Pure parser, unit-tested without a DOM. */
export function parseClosedLoopWalkEnabled(search: string): boolean {
  return new URLSearchParams(search).get("closedLoopWalk") === "1";
}

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readClosedLoopWalkEnabled(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parseClosedLoopWalkEnabled(search);
}
