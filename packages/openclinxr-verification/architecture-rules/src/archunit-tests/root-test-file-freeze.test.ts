import { describe, expect, it } from "vitest";
import {
  checkRootTestFileFreeze,
  checkRootTestFileFreezeIsHonest,
  countRootTestFiles,
  ROOT_TEST_FILE_FREEZE,
} from "../checks/test-file-root-freeze.ts";

/**
 * tools/openclinxr/evidence/ holds 560 .test.ts files in ONE flat directory, and the
 * repo's own delegation protocol tells every worker to plant a RED there. Seven of the
 * seventeen conflict-resolving merges in 1,500 commits were test files. Shared test files
 * are the largest serialization class in this repo at 33.1% of excess-writer events, ahead
 * of source modules at 23.9%.
 *
 * The rule freezes the root-level count at 560; it may only fall. A new root-level test
 * file raises the count and fails the gate. The fix is to plant the RED in a subdirectory
 * named for its subject. A test file in a SUBDIRECTORY is never counted, so the escape
 * route is always open. The existing 560 files are NOT moved — the ratchet exists so the
 * count comes down as REDs are retired and new ones land in subdirectories.
 */
describe("tools/openclinxr/evidence/ root test file freeze", () => {
  it("(1) root-level .test.ts count does not exceed the frozen ceiling", () => {
    const violations = checkRootTestFileFreeze();
    expect(violations.map((v) => v.detail), violations.map((v) => v.detail).join("\n")).toEqual([]);
  });

  it("(2) the freeze is the measured ceiling — a count that has shrunk must be lowered", () => {
    const violations = checkRootTestFileFreezeIsHonest();
    expect(violations.map((v) => v.detail), violations.map((v) => v.detail).join("\n")).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the freeze is measured from the tree, not asserted against itself", () => {
    const measured = countRootTestFiles();
    expect(measured).toBeGreaterThan(0);
    expect(measured).toBe(ROOT_TEST_FILE_FREEZE);
  });

  it("(4) COUNTERWEIGHT: a new root-level test file is reported", () => {
    const violations = checkRootTestFileFreeze(ROOT_TEST_FILE_FREEZE, ROOT_TEST_FILE_FREEZE + 1);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("33.1%");
    expect(violations[0]?.detail).toContain("subdirectory");
  });

  it("(5) COUNTERWEIGHT: a freeze above the measurement is reported", () => {
    const violations = checkRootTestFileFreezeIsHonest(ROOT_TEST_FILE_FREEZE + 5, ROOT_TEST_FILE_FREEZE);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("frozen at");
    expect(violations[0]?.detail).toContain("Lower the freeze");
  });

  it("(6) COUNTERWEIGHT: a measurement below the freeze is reported honestly", () => {
    const violations = checkRootTestFileFreezeIsHonest(565, 560);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain("frozen at 565 but now measures 560");
  });
});