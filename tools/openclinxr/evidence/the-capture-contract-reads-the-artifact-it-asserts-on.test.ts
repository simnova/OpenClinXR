import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #466 — a vitest test boots a dev server, runs a 37-second live capture, and rewrites two OTHER
 * slices' tracked deliverables on every run.
 *
 * ## MEASURED
 *
 * `the-capture-records-what-it-framed.test.ts:69` calls `runVisemeCapture()`. Timed on main:
 * **37.0 s**, because it boots a portless dev server and drives a live encounter.
 *
 * Ran each of the three viseme contracts from a clean tree and diffed:
 *
 *   the-capture-records-what-it-framed         writes: parent-drives-a-real-viseme.json
 *                                                      reframe-subject-in-frame.json
 *   the-reframe-proves-the-subject-is-in-frame writes: none
 *   the-parent-drives-a-real-viseme-at-runtime writes: none
 *
 * Those two files are #464's and #465's **landed tracked deliverables**. One test rewrites both.
 *
 * ## IT ALREADY COST A FALSE MEASUREMENT
 *
 * Earlier today I measured that test as `2 failed | 2 passed`, then immediately as `4 passed` on
 * the same commit. The difference was that the first run had rewritten the artifact the second run
 * asserted on. **A test whose green depends on a file it wrote itself is not evidence** — it is the
 * SS7s stale/self-fulfilling class, and I nearly acted on the flip.
 *
 * ## WHAT IS *NOT* THE DEFECT
 *
 * The capture module writing tracked summaries (`ui-xr-viseme-drive-capture.ts:30,32`) is
 * **correct and deliberate** — I required tracked paths because `.openclinxr/**` is gitignored and
 * has no land path (#396). Do not "fix" it there. `pnpm asset:ui-xr:viseme-drive-capture` is the
 * step that produces evidence; a *test* is the step that reads it (SS7b: measure once into an
 * artifact, assert against the artifact).
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED — the contract must not invoke the capture.
 *   (2) RED — running it must leave the tracked deliverables untouched, measured with git.
 *   (3) NET — its four original clause titles survive. Passes today; this is a rewiring, not a
 *             weakening, and gutting the assertions is the cheap way to stop the writes.
 *   (4) NET — the capture module still writes both tracked summaries. Passes today and must keep
 *             passing: that is the land path, not the bug.
 *   (5) GUARD — the two artifacts are tracked, so "leaves them untouched" is a real claim.
 *
 * All five read the TREE, so unlike my last five contracts (3) (4) (5) are genuine nets that hold
 * on a clean checkout, and only (1) and (2) are red.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) delete the four assertions so nothing runs the capture -> (3) fails; merge-kill also refuses
 *      `deleted-test`
 *   b) stop the capture writing the tracked summaries          -> (4) fails; that removes the land
 *      path #396 forced
 *   c) point the contract at a copy in /tmp                     -> (2) still measures git; a copy is
 *      fine, but the tracked files must not change
 *   d) mark the test skipped                                    -> (3) fails
 *
 * NOT TESTED:
 *   - Whether 37 s is inherently wrong for a capture SCRIPT. It is not — `pnpm
 *     asset:ui-xr:viseme-drive-capture` may take as long as it needs. This is about a *test* doing it.
 *   - The other 40-odd evidence modules that boot a dev server (#170 measured 46 of them). Only the
 *     three viseme contracts were diffed here; the rest are unaudited.
 *   - Whether the assertions in that contract are the RIGHT ones. This slice moves where its input
 *     comes from, not what it checks.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const TARGET = join(HERE, "the-capture-records-what-it-framed.test.ts");
const CAPTURE = join(HERE, "ui-xr-viseme-drive-capture.ts");
const TRACKED = [
  "tools/openclinxr/evidence/parent-drives-a-real-viseme.json",
  "tools/openclinxr/evidence/reframe-subject-in-frame.json",
];

const git = (...args: string[]): string =>
  execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

describe("the capture contract reads the artifact it asserts on", () => {
  it("(1) RED: the contract does not invoke the live capture", () => {
    const src = readFileSync(TARGET, "utf8");
    expect(
      /runVisemeCapture\s*(?:as|\()/u.test(src),
      `the-capture-records-what-it-framed.test.ts:69 calls runVisemeCapture() — 37.0 s and a dev `
        + `server boot inside a unit test. Read the artifact the capture script produces instead `
        + `(SS7b: measure once, assert against the artifact).`,
    ).toBe(false);
  });

  it("(2) RED: running it leaves the tracked deliverables untouched", () => {
    // The real invariant, measured with git rather than inferred from source.
    for (const p of TRACKED) {
      expect(git("status", "--porcelain", "--", p).trim(), `${p} is dirty before the run`).toBe("");
    }
    execFileSync("pnpm", ["exec", "vitest", "run", TARGET], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: "pipe",
    });
    for (const p of TRACKED) {
      expect(
        git("status", "--porcelain", "--", p).trim(),
        `${p} was rewritten by running the contract — it is #464's/#465's landed deliverable, and a `
          + `test whose green depends on a file it wrote itself is not evidence`,
      ).toBe("");
    }
  }, 180_000);

  it("(3) COUNTERWEIGHT: the original four assertions survive", () => {
    // Refuses (a) and (d). Deleting or skipping the clauses stops the writes and proves nothing.
    const src = readFileSync(TARGET, "utf8");
    for (const clause of ["(1)", "(2)", "(3)", "(4)"]) {
      expect(src, `clause ${clause} must still exist — rewire the input, do not gut the checks`).toContain(
        clause,
      );
    }
    expect(/\bit\.skip\b|\bdescribe\.skip\b/u.test(src), "skipping is not fixing").toBe(false);
  });

  it("(4) COUNTERWEIGHT: the capture still writes both tracked summaries", () => {
    // Refuses (b). Those tracked paths ARE the land path — .openclinxr/** is gitignored (#396).
    // NOT bare `toContain`: the capture's own header comment names both files, so containment is
    // satisfied by prose. Probed 2026-08-20 — renaming the write target left this clause green.
    // Assert the PATH CONSTANT is assigned, which a comment cannot fake.
    const src = readFileSync(CAPTURE, "utf8");
    expect(
      /SUMMARY_PATH\s*=[^;]*"parent-drives-a-real-viseme\.json"/su.test(src),
      "the capture must still ASSIGN the parent-drive summary path, not merely mention it",
    ).toBe(true);
    expect(
      /REFRAME_SUMMARY_PATH\s*=[^;]*"reframe-subject-in-frame\.json"/su.test(src),
      "the capture must still ASSIGN the reframe summary path, not merely mention it",
    ).toBe(true);
  });

  it("(5) VACUITY GUARD: both artifacts really are tracked", () => {
    const tracked = git("ls-files", "--", ...TRACKED).trim().split("\n").filter(Boolean);
    expect(tracked.length, `"leaves them untouched" only means something if git tracks them`).toBe(
      TRACKED.length,
    );
  });
});
