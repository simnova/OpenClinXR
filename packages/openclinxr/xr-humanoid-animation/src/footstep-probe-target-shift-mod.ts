/**
 * Probe flag for the turn-backward slice (G4): shift the footfall anchor along the route
 * axis inside the planner only (`?footstepProbeTargetShiftM=<metres>`).
 *
 * Default 0 (absent/unparseable reads 0): the turn anchors on the stand target exactly as
 * before. Same opt-in shape as the neighbouring flag mods; node-safe (no bare `window`).
 */

/** Pure parser, unit-tested without a DOM. */
export function parseFootstepTargetShiftM(search: string): number {
  const raw = new URLSearchParams(search).get("footstepProbeTargetShiftM");
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/** Browser entry read; 0 anywhere without a location search (node, tools). */
export function readFootstepTargetShiftM(): number {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" ? parseFootstepTargetShiftM(search) : 0;
}
