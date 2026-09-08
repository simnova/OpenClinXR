import { describe, expect, it } from "vitest";
import {
  CONTEXT_FIELD_BUDGET,
  checkContextFieldBudgets,
  countContextFields,
  generateCeilings,
  measureContexts,
  readPackageCeiling,
} from "../checks/context-field-budgets.ts";

/**
 * A package that takes a 93-field context has retyped the app rather than decoupled from it.
 * See checks/context-field-budgets.ts for the budget's two in-tree provenances and for why
 * the ceilings are generated per-package rather than held in one shared table.
 *
 * Clause (3) is a POSITIVE CONTROL. The CellixJs reference this repo copies ships
 * packages/cellix/archunit-tests/src/checks/code-metrics.ts, whose checkCodeMetrics returns
 * [] unconditionally against five configured thresholds, and a naming suite that calls its
 * check and never asserts on the result. Both are green about nothing. A rule asserting only
 * `toEqual([])` cannot tell a clean tree from a deleted check, so clause (3) fails if the
 * checker stops reporting a violation it must report.
 */
describe("packages take a narrow context", () => {
  it("(1) no context exceeds its generated ceiling, and none over budget lacks one", () => {
    const violations = checkContextFieldBudgets();
    expect(violations.map((v) => v.detail), violations.map((v) => v.detail).join("\n")).toEqual([]);
  });

  it("(2) the ceilings on disk equal what the tree measures — run pnpm arch:ceilings", () => {
    const expected = generateCeilings();
    for (const [pkg, ceiling] of Object.entries(expected)) {
      expect(readPackageCeiling(pkg), `packages/openclinxr/${pkg}/arch-ceiling.json is missing`).toEqual(
        ceiling,
      );
    }
    for (const pkg of new Set(measureContexts().map((m) => m.pkg))) {
      if (expected[pkg] !== undefined) continue;
      expect(
        readPackageCeiling(pkg),
        `packages/openclinxr/${pkg} is under budget but still carries a ceiling`,
      ).toBeNull();
    }
  });

  it("(3) POSITIVE CONTROL: a context over budget with no ceiling IS reported", () => {
    const violations = checkContextFieldBudgets(
      [{ pkg: "invented", file: "packages/openclinxr/invented/src/types.ts", type: "WideContext", fields: 40 }],
      () => null,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("40 fields > budget 12");
  });

  it("(4) COUNTERWEIGHT: a context ABOVE its ceiling is reported even though a ceiling exists", () => {
    const violations = checkContextFieldBudgets(
      [{ pkg: "p", file: "p/src/types.ts", type: "C", fields: 30 }],
      () => ({ contexts: { C: 20 } }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("grew to 30 fields > its ceiling 20");
  });

  it("(5) COUNTERWEIGHT: a stale ceiling on a now-compliant context is reported", () => {
    const violations = checkContextFieldBudgets(
      [{ pkg: "p", file: "p/src/types.ts", type: "C", fields: 8 }],
      () => ({ contexts: { C: 30 } }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("still carries a ceiling of 30");
  });

  it("(6) COUNTERWEIGHT: a context at the budget is NOT reported", () => {
    expect(
      checkContextFieldBudgets(
        [{ pkg: "p", file: "p/src/types.ts", type: "C", fields: CONTEXT_FIELD_BUDGET }],
        () => null,
      ),
    ).toEqual([]);
  });

  it("(7) the field counter reads a brace-balanced body, not a line count", () => {
    const source = "export type C = {\n  a: string;\n  b: { nested: number };\n  c(): void;\n};\n";
    expect(countContextFields(source, source.indexOf("{"))).toBe(2);
  });

  it("(8) the measurement comes from the tree and finds the known offenders", () => {
    const byType = new Map(measureContexts().map((m) => [m.type, m.fields]));
    expect(byType.get("AssetLoadingContext")).toBeGreaterThan(CONTEXT_FIELD_BUDGET);
    expect(byType.get("StationRoomContext")).toBeGreaterThan(CONTEXT_FIELD_BUDGET);
    // xr-scene-cues is the extraction that produced a controlled surface; it must stay clean.
    expect(byType.get("SceneCueRoomPropContext")).toBeLessThanOrEqual(CONTEXT_FIELD_BUDGET);
  });
});
