import { describe, expect, it } from "vitest";
import { checkTypecheckBaseline, type TypecheckBaselineConfig } from "../checks/typecheck-baseline.js";

/**
 * Live suite: the unique typecheck diagnostic count must sit exactly on the
 * shrink-only ceiling (same honesty rule as file-size freeze-list).
 */
export function describeTypecheckBaselineTests(config?: TypecheckBaselineConfig): void {
  describe("typecheck error-count freeze (ratchet down only)", () => {
    it(
      "keeps the live unique error TSxxxx count at the shrink-only ceiling",
      () => {
        const violations = checkTypecheckBaseline(config);
        expect(violations, `Typecheck baseline violations:\n${violations.join("\n")}`).toEqual([]);
      },
      120_000,
    );
  });
}
