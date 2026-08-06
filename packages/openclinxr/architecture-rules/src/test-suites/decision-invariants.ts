import { describe, expect, it } from "vitest";
import {
  checkBuildEmittingPackagesTypecheckTests,
  checkConfigPackagesStaySourceFirst,
  checkDispatchChokepointWired,
  checkNoDuplicateLspExtensionClaims,
} from "../checks/decision-invariants.js";

/**
 * These rules lock in DECISIONS. Each failure message explains the reasoning and points at the
 * record, so whoever trips it can either comply knowingly or revisit the decision deliberately —
 * rather than working around a rule whose purpose is invisible.
 */
export function describeDecisionInvariantTests(): void {
  describe("decision invariants", () => {
    it("keeps build-emitting packages typechecking their tests (MADR 0033)", () => {
      const violations = checkBuildEmittingPackagesTypecheckTests();
      expect(violations, violations.join("\n")).toEqual([]);
    });

    it("keeps config packages source-first (bootstrapping cycle)", () => {
      const violations = checkConfigPackagesStaySourceFirst();
      expect(violations, violations.join("\n")).toEqual([]);
    });

    it("keeps at most one language server per file extension (shadowing)", () => {
      const violations = checkNoDuplicateLspExtensionClaims();
      expect(violations, violations.join("\n")).toEqual([]);
    });

    it("keeps the dispatch chokepoint wired (raw grok -p refuse + named escape)", () => {
      const violations = checkDispatchChokepointWired();
      expect(violations, violations.join("\n")).toEqual([]);
    });
  });
}
