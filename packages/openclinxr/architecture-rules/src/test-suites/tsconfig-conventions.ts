import { describe, expect, it } from "vitest";
import {
  checkTsconfigConventions,
  type TsconfigConventionConfig,
} from "../checks/tsconfig-conventions.js";

/**
 * Test suite wrapper: calls the pure check function and asserts violations are empty.
 */
export function describeTsconfigConventionTests(
  config?: TsconfigConventionConfig,
): void {
  describe("tsconfig conventions (enforce compiler-option layering)", () => {
    it("ensures no workspace tsconfig.json violates convention rules (baseUrl, ignoreDeprecations, empty types, outDir, rootDir)", () => {
      const violations = checkTsconfigConventions(config);
      expect(
        violations,
        `TsConfig convention violations:\n${violations.join("\n")}`,
      ).toEqual([]);
    });

    it("ensures every exemption entry still targets an existing tsconfig.json (stale entry = removed-package drift)", () => {
      const violations = checkTsconfigConventions(config);
      expect(
        violations,
        `TsConfig convention violations (re-check):\n${violations.join("\n")}`,
      ).toEqual([]);
    });
  });
}
