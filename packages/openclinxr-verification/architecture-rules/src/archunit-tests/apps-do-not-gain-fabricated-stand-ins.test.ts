import { describe, expect, it } from "vitest";
import {
  checkStandInFreeze,
  checkStandInFreezeIsHonest,
  countStandInSites,
  measureStandInSites,
  STAND_IN_FREEZE,
} from "../checks/stand-in-freeze.ts";

/**
 * Two slices of the composition-root migration were discarded after a worker moved
 * code into a package and supplied a FAKE dependency at the new call site. Both trees
 * were green on the ui-xr suite, the build, the typecheck and knip, because a no-op is
 * a valid function and `as any` is valid TypeScript. Both were caught by a human
 * reading the diff, which does not scale and did not scale: the second one repeated
 * the first.
 *
 * The rule was validated against the 12 slices of this migration that carry a verdict.
 * It flags 0 of the 7 that passed their contract and BOTH that were discarded.
 * See checks/stand-in-freeze.ts for the per-slice table and the NOT TESTED line.
 */
describe("apps do not gain fabricated stand-ins", () => {
  it("(1) no app file exceeds its frozen stand-in count", () => {
    const violations = checkStandInFreeze();
    expect(violations.map((v) => v.detail), violations.map((v) => v.detail).join("\n")).toEqual([]);
  });

  it("(2) the freeze is the measured ceiling — entries that have shrunk must be lowered", () => {
    const violations = checkStandInFreezeIsHonest();
    expect(violations.map((v) => v.detail), violations.map((v) => v.detail).join("\n")).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the freeze is measured from the tree, not asserted against itself", () => {
    const measured = measureStandInSites();
    expect(Object.keys(measured).length).toBeGreaterThan(0);
    for (const file of Object.keys(measured)) {
      expect(STAND_IN_FREEZE[file], `${file} holds stand-in sites but has no frozen entry`).toBeDefined();
    }
  });

  it("(4) COUNTERWEIGHT: cellix-m18's discarded no-op is reported", () => {
    // Verbatim from wt/cellix-m18-station-fixtures-phase, apps/ui-xr/src/main.ts.
    const m18 = "    registerReactiveProp: (propId: string, group: Group) => { /* no-op in main */ },";
    expect(countStandInSites(m18)).toEqual({ emptyArrows: 1, casts: 0 });
    const violations = checkStandInFreeze(
      { "apps/ui-xr/src/main.ts": { emptyArrows: 1, casts: 23 } },
      { "apps/ui-xr/src/main.ts": { emptyArrows: 2, casts: 23 } },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("registerReactiveProp");
  });

  it("(5) COUNTERWEIGHT: cellix-m16's fabricated cast and emptied loop are reported", () => {
    // Verbatim from the discarded cellix-m16 tree.
    expect(countStandInSites("    shell: shell as unknown as Group,")).toEqual({ emptyArrows: 0, casts: 1 });
    expect(countStandInSites("  input.equipmentPlan.forEach(() => {});")).toEqual({ emptyArrows: 1, casts: 0 });
  });

  it("(6) COUNTERWEIGHT: the window evidence idiom is NOT reported", () => {
    // cellix-m17 passed its contract and landed. Without this exclusion the rule
    // flags it, which would make the gate refuse good work.
    const m17 = "  (window as any).__openClinXrReusableExteriorAnteroom = reusableExteriorAnteroom;";
    expect(countStandInSites(m17)).toEqual({ emptyArrows: 0, casts: 0 });
  });

  it("(7) COUNTERWEIGHT: an ordinary arrow function with a body is NOT reported", () => {
    const real = "    registerReactiveProp: (propId: string, group: Group) => { reactive.set(propId, group); },";
    expect(countStandInSites(real)).toEqual({ emptyArrows: 0, casts: 0 });
  });

  it("(8) COUNTERWEIGHT: a file with sites and no freeze entry is reported", () => {
    const violations = checkStandInFreeze({}, { "apps/ui-xr/src/new-file.ts": { emptyArrows: 1, casts: 0 } });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("no frozen entry");
  });
});
