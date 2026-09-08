import { describe, expect, it } from "vitest";
import {
  checkFileSizeBudgets,
  checkFreezeListHonesty,
  type FileSizeBudgetConfig,
} from "../checks/file-size-budgets.js";

/**
 * Test suite wrapper: calls the pure check functions and asserts violations are empty.
 * Keeps the EXACT test names and failure messages from the original file.
 */
export function describeFileSizeBudgetTests(config?: FileSizeBudgetConfig): void {
  describe("file-size budgets (prevent large files)", () => {
    it("keeps every hand-written source file within its zone budget or its (shrink-only) freeze ceiling", () => {
      const violations = checkFileSizeBudgets(config);
      expect(violations, `File-size budget violations:\n${violations.join("\n")}`).toEqual([]);
    });

    it("keeps the freeze list honest — every entry still exists and is still over its zone budget (else remove it)", () => {
      const stale = checkFreezeListHonesty(config);
      expect(stale, `Stale freeze entries:\n${stale.join("\n")}`).toEqual([]);
    });
  });
}
