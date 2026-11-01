import { describe, expect, it } from "vitest";
import {
  checkRootTestFileFreeze,
  checkRootTestFileFreezeIsHonest,
  countRootTestFiles,
  ROOT_TEST_FILE_FREEZE,
} from "../checks/test-file-root-freeze.ts";

/**
 * tools/openclinxr/evidence/ holds 113 .test.ts files in ONE flat directory, and the
 * repo's own delegation protocol tells every worker to plant a RED there. Seven of the
 * seventeen conflict-resolving merges in 1,500 commits were test files. Shared test files
 * are the largest serialization class in this repo at 33.1% of excess-writer events, ahead
 * of source modules at 23.9%.
 *
 * The rule freezes the root-level count at 113; it may only fall. A new root-level test
 * file raises the count and fails the gate. The fix is to plant the RED in a subdirectory
 * named for its subject. A test file in a SUBDIRECTORY is never counted, so the escape
 * route is always open. The existing 113 files are NOT moved — the ratchet exists so the
 * count comes down as REDs are retired and new ones land in subdirectories.
 * (2026-10-30 station-trellis sidecar, operator-approved 2026-10-30, moved 4 trellis
 * evidence-root tests to @openclinxr/trellis-evidence: 560 -> 556.)
 * (2026-10-31 root batch root-trellis, operator-approved 2026-10-31: 10 root tests moved
 * to @openclinxr/trellis-evidence, lowering the freeze 556 -> 546.)
 * (2026-10-31 root batch room-generate, operator-approved 2026-10-31: 17 root tests
 * moved to @openclinxr/room-generate-evidence: 546 -> 529.)
 * (2026-10-31 root batch lip-sync, operator-approved 2026-10-31: 14 root lip-sync
 * evidence tests moved to @openclinxr/lip-sync-evidence: 529 -> 515.)
 * (2026-10-31 root batch runtime-scene, operator-approved 2026-10-31: 21 root tests moved
 * to @openclinxr/runtime-scene-evidence, lowering the freeze 515 -> 494.)
 * (2026-10-31 root batch motion-bakeoff, operator-approved 2026-10-31: 9 root tests
 * moved to @openclinxr/rig-fit-evidence: 494 -> 485.)
 * (2026-10-31 root batch anny-phenotype, operator-approved 2026-10-31: 14 root tests
 * moved to @openclinxr/anny-phenotype-evidence: 485 -> 471.)
 * (2026-10-31 root batch model-vetting, operator-approved 2026-10-31: 19 root tests moved,
 * 14 to @openclinxr/model-vetting-evidence and 5 to the model-vetting-snapshots/ and
 * model-vetting-tools/ subdirectories, lowering the freeze 471 -> 452.)
 * (2026-10-31 root batch garment-cache, operator-approved 2026-10-31: 2 root tests
 * moved to @openclinxr/makeclothes-evidence and 7 to
 * tools/openclinxr/evidence/garment-cache/: 452 -> 443.)
 * (2026-10-31 root batch local-runtime, operator-approved 2026-10-31: 38 root tests
 * moved out: 443 -> 405; 36 to @openclinxr/local-runtime-evidence and 2 host-dependent
 * files to tools/openclinxr/evidence/local-runtime/ (review fix 2026-10-31).)
 * (2026-10-31 root batch iwsdk, operator-approved 2026-10-31: 24 root tests left the
 * root — 20 to @openclinxr/iwsdk-evidence, 3 known-red/manual to
 * tools/openclinxr/evidence/iwsdk/, 1 (browser-boot-inventory) returned to the root
 * after independent review (sidecar must stay fully green); freeze 405 -> 382.)
 * (2026-10-31 root batch rig-fit, operator-approved 2026-10-31: 33 root tests moved,
 * 28 to @openclinxr/rig-fit-evidence and 5 to
 * tools/openclinxr/evidence/rig-fit/: 382 -> 349.)
 * (2026-10-31 root batch openclaw-evidence, operator-approved 2026-10-31: 39 root tests
 * moved, 37 to tools/openclinxr/openclaw/contracts/ and 2 red-gated (drain-loop,
 * fixture-git) to tools/openclinxr/evidence/drain-loop/ and
 * tools/openclinxr/evidence/fixture-git/: 349 -> 310.)
 * (2026-10-31 root batch cast-readiness, operator-approved 2026-10-31: 33 root tests
 * moved, 30 to @openclinxr/cast-readiness-evidence and 3 red-on-main to
 * tools/openclinxr/evidence/cast-readiness-stale/: 310 -> 277.)
 * (2026-10-31 root batch humanoid-bake, operator-approved 2026-10-31: 37 root tests
 * moved to @openclinxr/humanoid-bake-evidence and 3 to
 * tools/openclinxr/evidence/humanoid-bake/: 277 -> 237.)
 * (2026-10-31 root batch body-param, operator-approved 2026-10-31: 21 root tests moved,
 * 15 to @openclinxr/body-param-evidence and 6 to root subdirectories (dark-factory/,
 * cue-props/, body-param/, wardrobe/, environment-artifacts/): known-red, pre-existing-red
 * and gitignored-cache files stay out of the sidecar per T12/T6/T7: 237 -> 216.)
 * (2026-10-31 root batch humanoid-probe, operator-approved 2026-10-31: 21 root tests
 * moved out — 18 to @openclinxr/humanoid-probe-evidence and 3 known-red/gitignored-gated
 * (material-region, upright-guard, cagematch-bind) to
 * tools/openclinxr/evidence/humanoid-probe/: 216 -> 195.)
 * (2026-10-31 root batch exam-pipeline, operator-approved 2026-10-31: 26 root tests
 * moved, 16 to @openclinxr/exam-pipeline-evidence and 10 known-red/manual/host-dependent to
 * tools/openclinxr/evidence/exam-pipeline/: 195 -> 169.)
 * (2026-10-31 root batch gown-phenotype, operator-approved 2026-10-31: 19 root tests
 * moved, 18 to @openclinxr/gown-phenotype-evidence and 1 known-red
 * (garment-hem-boundary) to tools/openclinxr/evidence/gown-phenotype/: 169 -> 150.)
 * (2026-10-31 root batch garment-surface, operator-approved 2026-10-31: 37 root tests
 * moved, 27 to @openclinxr/garment-surface-evidence, 9 red-on-main to
 * tools/openclinxr/evidence/garment-surface-stale/ and the room-frame consumer to
 * tools/openclinxr/evidence/room-frames/: 150 -> 113.)
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