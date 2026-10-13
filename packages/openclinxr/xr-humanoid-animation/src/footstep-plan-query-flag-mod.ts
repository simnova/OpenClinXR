/**
 * Footstep-plan query flags for the case-owned bedside approach.
 *
 * Default OFF: only exactly `footstepPlan=1` reads true; absent or any other
 * value reads false. Same opt-in `=== "1"` shape as the neighbouring flag
 * mods; this module also reaches node tests with no DOM lib, so no bare
 * `window` reference.
 */

/** Pure parser, unit-tested without a DOM. */
export function parseFootstepPlanEnabled(search: string): boolean {
  return new URLSearchParams(search).get("footstepPlan") === "1";
}

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readFootstepPlanEnabled(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parseFootstepPlanEnabled(search);
}

/**
 * Second-route length for the plan, in metres. Any number in [0.8, 6.0]
 * is honored (the M2 exit-phase cell exercises 2.0; the orchestrator's
 * unseen route lands in this range); absent or anything else reads null
 * and the walk keeps its scene route. Pure parser, unit-tested.
 */
export function parseFootstepRouteMeters(search: string): number | null {
  const raw = new URLSearchParams(search).get("footstepRouteM");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0.8 && value <= 6 ? value : null;
}

/** Browser entry read; null anywhere without a location search (node, tools). */
export function readFootstepRouteMeters(): number | null {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" ? parseFootstepRouteMeters(search) : null;
}

/**
 * G4 probe: hold the M2 crossing exit N substeps past the recorded
 * crossing (?footstepProbeExitDelay=N). Module export for the frame
 * module's struct fill. Default 0: integers in [0, 30] only, anything
 * else reads 0.
 */
export function readFootstepExitDelaySubsteps(): number {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  if (typeof search !== "string") return 0;
  const raw = new URLSearchParams(search).get("footstepProbeExitDelay");
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 30 ? value : 0;
}

/**
 * G6 probe: per-foot model scale override (?footstepProbeModel=1.2 seeds
 * +20%). Module export for the frame module's struct fill, deliberately NOT
 * re-exported from `./footstep-plan` (no new public symbol, no orchestrator
 * admission row); the G6 capture tables cover it. Default 1: finite positive
 * numbers only, anything else reads 1.
 */
export function readFootstepProbeModelScale(): number {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  if (typeof search !== "string") return 1;
  const raw = new URLSearchParams(search).get("footstepProbeModel");
  if (raw === null) return 1;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
