import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #467 — the second instance of #466, named by #466's own NOT TESTED.
 *
 * #466 fixed `the-capture-records-what-it-framed.test.ts` (37.0 s -> 0.68 s, 2 tracked writes -> 0)
 * and its close said plainly: *"the other ~43 evidence modules that boot a dev server are
 * unaudited — I would not assume this is the only one."* It was not.
 *
 * ## MEASURED
 *
 * `viseme-capture-produces-distinct-shapes.test.ts:75` —
 * `const run = mod.runVisemeCapture as (() => Promise<unknown>) | undefined;`
 *
 *     wall              36.77 s and 36.21 s on two runs (boots a portless dev server)
 *     tracked writes    parent-drives-a-real-viseme.json, reframe-subject-in-frame.json
 *     result            1 failed | 3 passed, BOTH runs
 *
 * Same two files as #466 — #464's and #465's landed deliverables — rewritten by a third slice's
 * test.
 *
 * ## A STATIC AUDIT WOULD HAVE MISSED THIS, AND NEARLY DID
 *
 * `grep -l runVisemeCapture` over the evidence tests returns seven files. Six are **prose only** —
 * `browser-boot-inventory.ts:24` warns about exactly that trap, and the repo already paid for it
 * once by defining a population from `git grep -l` on a symbol name.
 *
 * So I wrote a stricter regex requiring a call at line start. **It reported this file as prose
 * only.** The call is `const run = mod.runVisemeCapture as …` — the very pattern #466 just fixed,
 * which my regex could not see. Only running it and diffing the tree found it. **The behavioural
 * check is the instrument; source greps are a shortlist at best.**
 *
 * ## WHAT THIS SLICE DOES NOT TOUCH
 *
 * The test also carries a genuinely unsatisfied RED: *"the dominant viseme takes ≥5 distinct
 * values"*, and the capture yields **four** (`viseme_sil`, `viseme_aa`, `viseme_TH`, `viseme_E` —
 * #465's ledger). That is the "twelve of fifteen targets unobserved at runtime" question I recorded
 * two ticks ago: the mock dialogue simply does not exercise more shapes.
 *
 * **Do not change that assertion, do not lower ≥5, do not extend the dialogue here.** Rewire where
 * the input comes from and leave the bar exactly where it is. It is legitimate for this contract to
 * stay red after the slice — clause (4) requires it to still be there and still say five.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED — the contract must not invoke the live capture.
 *   (2) RED — running it must leave the tracked deliverables untouched, measured with git.
 *   (3) NET — its assertions survive unskipped. Passes today.
 *   (4) NET — the ≥5-distinct bar is still there and still five. Passes today; lowering it is the
 *             cheapest way to turn this file green and it is not sanctioned.
 *   (5) NET — the capture still writes both tracked summaries (the land path, #396). Passes today.
 *
 * All five read the tree, so (3)(4)(5) genuinely hold on a clean checkout.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) lower ≥5 to ≥4 so the file goes green      -> (4) fails
 *   b) skip or delete the failing assertion        -> (3) fails; merge-kill refuses `deleted-test`
 *   c) stop the capture writing tracked summaries  -> (5) fails; that is the land path
 *   d) extend the mock dialogue to manufacture 5   -> out of scope; say so and stop
 *
 * NOT TESTED:
 *   - **Why only four shapes appear.** Coverage is a real open question and this slice is not it.
 *   - The other ~41 evidence modules. Two of 46 are now known; the rest are unaudited, and the
 *     lesson above is that only running them settles it.
 *   - Whether ≥5 is the right bar. Not mine to move either way.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const TARGET = join(HERE, "viseme-capture-produces-distinct-shapes.test.ts");
const CAPTURE = join(HERE, "ui-xr-viseme-drive-capture.ts");
const TRACKED = [
  "tools/openclinxr/evidence/parent-drives-a-real-viseme.json",
  "tools/openclinxr/evidence/reframe-subject-in-frame.json",
];

const git = (...a: string[]): string =>
  execFileSync("git", ["-C", REPO_ROOT, ...a], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

describe("the distinct-shapes contract reads its input", () => {
  it("(1) RED: the contract does not invoke the live capture", () => {
    const src = readFileSync(TARGET, "utf8");
    expect(
      /runVisemeCapture\s*(?:as\b|\()/u.test(src),
      `:75 does \`const run = mod.runVisemeCapture as …\` — 36.2 s and a dev-server boot inside a `
        + `unit test. Read the tracked summary the capture script produces (SS7b).`,
    ).toBe(false);
  });

  it("(2) RED: running it leaves the tracked deliverables untouched", () => {
    for (const p of TRACKED) {
      expect(git("status", "--porcelain", "--", p).trim(), `${p} dirty before the run`).toBe("");
    }
    try {
      execFileSync("pnpm", ["exec", "vitest", "run", TARGET], {
        cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: "pipe",
      });
    } catch {
      // The target is legitimately RED on its >=5 bar. Its exit code is not this clause's subject —
      // the tree state after the run is.
    }
    for (const p of TRACKED) {
      expect(
        git("status", "--porcelain", "--", p).trim(),
        `${p} was rewritten — it is another slice's landed deliverable`,
      ).toBe("");
    }
  }, 180_000);

  it("(3) COUNTERWEIGHT: the assertions survive unskipped", () => {
    const src = readFileSync(TARGET, "utf8");
    expect(/\bit\.skip\b|\bdescribe\.skip\b/u.test(src), "skipping is not fixing").toBe(false);
    expect((src.match(/\bit\(/gu) ?? []).length, "the four assertions remain").toBeGreaterThanOrEqual(4);
  });

  it("(4) COUNTERWEIGHT: the >=5 distinct-shape bar is unchanged", () => {
    // Refuses (a). The capture yields four; lowering the bar is the cheapest green and it would
    // erase the coverage question instead of answering it.
    const src = readFileSync(TARGET, "utf8");
    expect(src, "the bar stays at five distinct dominant visemes").toMatch(/≥\s*5|>=\s*5|\b5\b/u);
    expect(
      /≥\s*4\b|>=\s*4\b/u.test(src),
      "a >=4 bar would be the observed value dressed as a threshold",
    ).toBe(false);
  });

  it("(5) COUNTERWEIGHT: the capture still writes both tracked summaries", () => {
    // Refuses (c). Those paths are the land path — .openclinxr/** is gitignored (#396).
    const src = readFileSync(CAPTURE, "utf8");
    expect(
      /SUMMARY_PATH\s*=[^;]*"parent-drives-a-real-viseme\.json"/su.test(src),
      "the capture must still ASSIGN the parent-drive summary path",
    ).toBe(true);
    expect(
      /REFRAME_SUMMARY_PATH\s*=[^;]*"reframe-subject-in-frame\.json"/su.test(src),
      "the capture must still ASSIGN the reframe summary path",
    ).toBe(true);
  });
});
