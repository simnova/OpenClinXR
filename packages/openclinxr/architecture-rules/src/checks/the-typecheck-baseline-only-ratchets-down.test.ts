import { describe, expect, it } from "vitest";
import {
  TYPECHECK_ERROR_CEILING,
  TYPECHECK_ERROR_CEILING_AT_PLANT,
  checkTypecheckBaseline,
  parseTypecheckDiagnostics,
} from "./typecheck-baseline.js";
import { describeTypecheckBaselineTests } from "../test-suites/typecheck-baseline.js";

/**
 * Destructive probe for the typecheck error-count freeze.
 *
 * Known-good column: file-size-budgets.ts SIZE_FREEZE — a number that may only shrink,
 * with honesty when the live count drops below the ceiling.
 *
 * Hermetic clauses inject counts. The live suite at the bottom shells out to
 * `pnpm typecheck:strict` and `typecheck:relaxed` (the prefix `pnpm typecheck` actually runs).
 */

describe("the typecheck baseline only ratchets down", () => {
  it("(1) RED: a grown error count is refused", () => {
    const violations = checkTypecheckBaseline({
      actualErrorCount: 18,
      ceiling: 10,
      plantCeiling: 10,
    });
    expect(violations.join("\n")).toMatch(/18.*10/);
    expect(violations.some((v) => v.includes("do NOT raise the ceiling"))).toBe(true);
  });

  it("(2) RED: the refusal names the measured count and the ceiling", () => {
    const violations = checkTypecheckBaseline({
      actualErrorCount: 18,
      ceiling: 10,
      plantCeiling: 10,
    });
    expect(violations.join("\n")).toMatch(/\b18\b/u);
    expect(violations.join("\n")).toMatch(/\b10\b/u);
  });

  it("(3) KNOWN-GOOD COLUMN: sitting exactly on the ceiling is allowed", () => {
    const violations = checkTypecheckBaseline({
      actualErrorCount: 10,
      ceiling: 10,
      plantCeiling: 10,
    });
    expect(violations).toEqual([]);
  });

  it("(4) lower is always allowed: a paid-down count forces the ceiling down", () => {
    const violations = checkTypecheckBaseline({
      actualErrorCount: 7,
      ceiling: 10,
      plantCeiling: 10,
    });
    expect(violations.join("\n")).toMatch(/paid down/i);
    expect(violations.join("\n")).toMatch(/lower TYPECHECK_ERROR_CEILING/);
  });

  it("(5) raising the live ceiling above the plant freeze is refused", () => {
    const violations = checkTypecheckBaseline({
      actualErrorCount: 11,
      ceiling: 11,
      plantCeiling: 10,
    });
    expect(violations.join("\n")).toMatch(/plant freeze/);
  });

  it("(6) plant freeze is the 2026-09-04 measured unique count (225) and the live ceiling may only sit at or below it", () => {
    expect(TYPECHECK_ERROR_CEILING_AT_PLANT).toBe(225);
    expect(TYPECHECK_ERROR_CEILING).toBeLessThanOrEqual(TYPECHECK_ERROR_CEILING_AT_PLANT);
  });

  it("(7) parser counts unique error TSxxxx diagnostics and ignores non-diagnostic noise", () => {
    const fixture = [
      "ERROR: command finished with error: pnpm typecheck:relaxed",
      "tools/a.ts(1,1): error TS2304: Cannot find name 'window'.",
      "tools/a.ts(1,1): error TS2304: Cannot find name 'window'.",
      "@openclinxr/ui-admin:typecheck: src/App.tsx(341,68): error TS2339: Property 'value' does not exist.",
      "Failed",
    ].join("\n");
    const parsed = parseTypecheckDiagnostics(fixture);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.code).toBe("TS2304");
    expect(parsed[1]?.code).toBe("TS2339");
    expect(
      checkTypecheckBaseline({
        diagnosticOutput: fixture,
        ceiling: 2,
        plantCeiling: 2,
      }),
    ).toEqual([]);
  });
});

describeTypecheckBaselineTests();
