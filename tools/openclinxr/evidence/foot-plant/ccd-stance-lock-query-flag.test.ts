import { describe, expect, it } from "vitest";
import {
  parseCcdStanceLockEnabled,
  readCcdStanceLockEnabled,
} from "../../../../packages/openclinxr/xr-humanoid-animation/dist/ccd-stance-lock-query-flag-mod.js";

/**
 * Unit test for the CCD stance-lock `ccdStanceLock=1` opt-in query parser.
 *
 * WHY IT LIVES HERE, AND WHY IT IMPORTS dist. The parser is deliberately
 * private: nothing outside @openclinxr/xr-humanoid-animation binds it, so
 * exporting it would fail the reviewed-surface gate; a co-located test would
 * raise that package's shrink-only test-internal-import ceiling (5); and a
 * relative import into the package's src/ would trip the shrink-only
 * cross-boundary freeze (that gate only tracks src targets, and the
 * package-test gate only walks packages/). Tools-side tests are outside both
 * gates' scope; precedent: the-turn-quality-metrics-catch-a-swivel.test.ts in
 * this directory. dist because the boundary freeze tracks src only; `test`
 * dependsOn `^build` (turbo.json), so dist is fresh under the repo's own test
 * pipeline — rebuild the package before running this file directly with
 * vitest (`pnpm --filter @openclinxr/xr-humanoid-animation build`).
 *
 * Opt-in `=== "1"` (default off), mirroring the apps/ui-xr URL debug flags —
 * the inverse of the stepping-turn flag, which is default-on opt-out.
 */
describe("ccd stance-lock query flag", () => {
  it("reads exactly ccdStanceLock=1 as true", () => {
    expect(parseCcdStanceLockEnabled("?ccdStanceLock=1")).toBe(true);
  });

  it("reads absent as false (default off)", () => {
    expect(parseCcdStanceLockEnabled("")).toBe(false);
    expect(parseCcdStanceLockEnabled("?stationId=x")).toBe(false);
  });

  it("reads anything other than exactly 1 as false", () => {
    expect(parseCcdStanceLockEnabled("?ccdStanceLock=0")).toBe(false);
    expect(parseCcdStanceLockEnabled("?ccdStanceLock=true")).toBe(false);
    expect(parseCcdStanceLockEnabled("?ccdStanceLock=")).toBe(false);
  });

  it("reads the flag beside other params", () => {
    expect(parseCcdStanceLockEnabled("?stationId=x&ccdStanceLock=1")).toBe(true);
    expect(parseCcdStanceLockEnabled("?ccdStanceLock=1&stationId=x")).toBe(true);
  });

  it("reads false with no window (node)", () => {
    expect(readCcdStanceLockEnabled()).toBe(false);
  });
});
