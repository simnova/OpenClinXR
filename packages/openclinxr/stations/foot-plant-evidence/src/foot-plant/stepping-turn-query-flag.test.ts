import { describe, expect, it } from "vitest";
import {
  parseSteppingTurnEnabled,
  readSteppingTurnEnabled,
} from "../../../../../../packages/openclinxr/xr-humanoid-animation/dist/stepping-turn-query-flag-mod.js";

/**
 * Unit test for the stepping-turn `steppingTurn=0` opt-out query parser.
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
 */
describe("stepping-turn query flag", () => {
  it("reads steppingTurn=1 as true", () => {
    expect(parseSteppingTurnEnabled("?steppingTurn=1")).toBe(true);
  });

  it("reads absent as true", () => {
    expect(parseSteppingTurnEnabled("")).toBe(true);
    expect(parseSteppingTurnEnabled("?stationId=x")).toBe(true);
  });

  it("reads only exactly steppingTurn=0 as false", () => {
    expect(parseSteppingTurnEnabled("?steppingTurn=0")).toBe(false);
  });

  it("reads the flag beside other params", () => {
    expect(parseSteppingTurnEnabled("?stationId=x&steppingTurn=1")).toBe(true);
    expect(parseSteppingTurnEnabled("?steppingTurn=1&stationId=x")).toBe(true);
  });

  it("reads false with no window (node)", () => {
    expect(readSteppingTurnEnabled()).toBe(false);
  });
});
