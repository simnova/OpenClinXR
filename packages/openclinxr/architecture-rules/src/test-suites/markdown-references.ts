import { describe, expect, it } from "vitest";
import {
  checkBrokenReferenceFreezeIsHonest,
  checkMarkdownReferencesResolve,
} from "../checks/markdown-references.js";

/**
 * Guards the failure class that green gates missed: content removed, pointers left behind.
 */
export function describeMarkdownReferenceTests(): void {
  describe("markdown references resolve (shrink-only)", () => {
    it("adds no new unresolved references", () => {
      const violations = checkMarkdownReferencesResolve();
      expect(violations, violations.join("\n")).toEqual([]);
    });

    it("keeps the freeze honest — ceilings track actual and only shrink", () => {
      const violations = checkBrokenReferenceFreezeIsHonest();
      expect(violations, violations.join("\n")).toEqual([]);
    });
  });
}
