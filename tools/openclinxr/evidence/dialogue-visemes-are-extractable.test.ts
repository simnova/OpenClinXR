import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **STEP ONE of #375: get the viseme pipeline out of `main.ts` WITHOUT changing what it does.**
 *
 * #375 measured the real defect: `phonemeSequenceForDialogue` (`apps/ui-xr/src/main.ts:9085`) is
 * letter-by-letter grapheme classification, so every actor's mouth is driven by English SPELLING.
 * 0 of 10 homophone pairs produce matching visemes; `though` and `cough` produce IDENTICAL sequences;
 * `phone` opens with a lip CLOSURE because of the `p` in `ph`.
 *
 * **This contract does not fix any of that.** It exists because the fix cannot be contracted yet:
 * both functions are module-private in `main.ts`, so a behavioural RED planted today fails on a
 * MISSING IMPORT rather than on the defect — and an `it.fails` is satisfied by ANY throw (SS7t).
 * Flipping such a clause later would green for the wrong reason. So: extract first, pin the behaviour
 * exactly as it is TODAY (wrong answers and all), and let #375's real RED be planted against a module
 * that can actually be imported.
 *
 * ## THE PINNED TABLE IS TODAY'S OUTPUT, INCLUDING ITS ERRORS — THAT IS THE POINT
 *
 * Measured 2026-08-13 by replicating `main.ts:9085-9108` exactly. Rows deliberately include the
 * defect, so a "tidy-up while I'm in here" cannot slip past the extraction:
 *
 *   no    -> mid,open              know  -> mid,mid,open,rounded      (homophones, DIFFER — the bug)
 *   two   -> mid,rounded,open      too   -> mid,open,open             (homophones, DIFFER — the bug)
 *   though-> mid,open,mid,mid      cough -> mid,open,mid,mid          (NOT homophones, IDENTICAL — the bug)
 *   phone -> closed,open,mid,wide                                     (opens with a lip closure — the bug)
 *
 * If the extraction changes ANY row, it is not an extraction.
 *
 * ## WHY main.ts MUST SHRINK, NOT MERELY STAY PUT
 *
 * `main.ts` is 9,890 lines against a frozen ceiling of 9,980 — 90 lines of headroom, and it is the
 * repo's #1 god-file paydown target. The cheap non-fix is to COPY the functions into a module and
 * leave the originals in place, which satisfies "a module exists" while making the problem worse.
 * Clause (2) requires main.ts to come DOWN by at least 15 lines. #362 set the precedent: extracting
 * `generatedDriveScalar` took main.ts down 38 lines into a 74-line module.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                         | (1) rows | (2) shrink | (3) fixture | result
 *   --------------------------------------------------|----------|------------|-------------|--------
 *   a) today — nothing extracted                      | **FAIL** |  **FAIL**  |    pass     | REFUSED
 *   b) copy the functions out, leave the originals    |   pass   |  **FAIL**  |    pass     | REFUSED
 *   c) extract AND "fix" the spelling bug in passing  | **FAIL** |    pass    |    pass     | REFUSED
 *   d) pin a sanitised fixture that hides the defect  |   pass   |    pass    |  **FAIL**   | REFUSED
 *   e) extract verbatim, main.ts shrinks              |   pass   |    pass    |    pass     | ALL PASS
 *
 * (c) is worth naming: fixing the defect here is NOT welcome, because it would land a behaviour change
 * with no contract measuring the behaviour. #375 owns that, against the homophone property.
 *
 * (d) is what clause (3) exists for. A characterisation table that quietly pins only easy words would
 * let the hard ones drift during extraction. Clause (3) requires the fixture to CONTAIN the defect:
 * at least three homophone pairs whose pinned outputs differ from each other.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDS and both fail today. (3) passes today
 * and is the counterweight. (3) is independent of what (1) and (2) measure — it asserts a property of
 * the fixture itself, which no amount of extraction changes.
 *
 * NOT TESTED:
 *   - **Anything about whether the visemes are CORRECT.** This pins them as they are. #375 is the fix.
 *   - **The runtime path.** `main.ts` must still call the extracted function; that is `changed:main.ts`
 *     plus the shrink, not something this contract can see directly.
 *   - **`visemeOpenness` and the rest of the mouth chain**, which stay in `main.ts` and are untouched.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const MAIN_TS = join(REPO_ROOT, "apps/ui-xr/src/main.ts");
const MODULE_REL = "apps/ui-xr/src/dialogue-visemes.ts";

/** main.ts measured at 9,890 lines on 2026-08-13; the extraction must take at least 15 out. */
const MAIN_TS_MAX_LINES_AFTER = 9875;

/**
 * TODAY'S OUTPUT, measured by replicating `main.ts:9085-9108`. Wrong answers are deliberate — see the
 * header. An extraction that changes any value here is a behaviour change, not an extraction.
 */
const PINNED: Readonly<Record<string, string>> = {
  no: "mid,open",
  know: "mid,mid,open,rounded",
  two: "mid,rounded,open",
  too: "mid,open,open",
  sea: "mid,wide,open",
  see: "mid,wide,wide",
  right: "mid,wide,mid,mid",
  write: "rounded,mid,wide,mid,wide",
  one: "open,mid,wide",
  won: "rounded,open,mid",
  phone: "closed,open,mid,wide",
  though: "mid,open,mid,mid",
  cough: "mid,open,mid,mid",
  chest: "mid,wide,mid,mid",
  breathing: "closed,mid,wide,open,mid,wide,mid,mid",
  wheeze: "rounded,wide,wide,mid,wide",
  hurts: "mid,mid,mid,mid",
  "pain.": "closed,open,wide,mid,rest",
  "I feel dizzy.": "wide,teeth,wide,wide,mid,mid,wide,mid,mid,rounded,rest",
  "It hurts when I move.":
    "wide,mid,mid,mid,mid,mid,rounded,wide,mid,wide,closed,open,teeth,wide,rest",
};

/** Homophone pairs whose pinned outputs MUST differ — the defect, captured in the fixture. */
const HOMOPHONE_PAIRS: readonly (readonly [string, string])[] = [
  ["no", "know"],
  ["two", "too"],
  ["sea", "see"],
  ["right", "write"],
  ["one", "won"],
];

/** The seven names the runtime morph resolver knows. Anything else is a silent skip. */
const KNOWN_VISEMES = new Set(["rest", "closed", "teeth", "rounded", "open", "wide", "mid"]);

type Extracted = { visemesForText?: (text: string) => string[] };

async function loadModule(): Promise<Extracted | null> {
  try {
    return (await import(pathResolve(REPO_ROOT, MODULE_REL))) as Extracted;
  } catch {
    return null;
  }
}

const mod = await loadModule();
const mainLines = readFileSync(MAIN_TS, "utf8").split(/\r?\n/).length;

describe("the dialogue viseme pipeline is extractable from main.ts without changing what it does", () => {
  it(`(1) RED: ${MODULE_REL} exports visemesForText and reproduces every pinned row exactly`, () => {
    expect(mod, `${MODULE_REL} does not exist or failed to import — extraction is step one`).not.toBeNull();
    const fn = mod?.visemesForText;
    expect(typeof fn, `${MODULE_REL} must export visemesForText(text: string): string[]`).toBe("function");
    const drifted: string[] = [];
    for (const [input, expected] of Object.entries(PINNED)) {
      const actual = fn!(input).join(",");
      if (actual !== expected) drifted.push(`${JSON.stringify(input)}: got [${actual}] want [${expected}]`);
    }
    expect(drifted, "extraction changed behaviour — that is a rewrite, not an extraction").toEqual([]);
  });

  it(`(2) RED: main.ts shrinks to at most ${MAIN_TS_MAX_LINES_AFTER} lines`, () => {
    // Refuses (b): copying the functions into a module and leaving the originals in place, which
    // satisfies "a module exists" while making the god-file worse.
    expect(
      mainLines,
      `main.ts is ${mainLines} lines; the extraction must remove at least 15 (it was 9890)`,
    ).toBeLessThanOrEqual(MAIN_TS_MAX_LINES_AFTER);
  });

  it("(3) COUNTERWEIGHT: the pinned fixture actually contains the defect", () => {
    // Refuses (d): a sanitised characterisation that pins only easy words would let the hard ones
    // drift during extraction. This asserts a property of the FIXTURE, so no extraction can change it.
    const rows = Object.keys(PINNED).length;
    expect(rows, "pinned rows").toBeGreaterThanOrEqual(20);

    const used = new Set(Object.values(PINNED).flatMap((v) => v.split(",")));
    expect([...used].filter((v) => !KNOWN_VISEMES.has(v)), "pinned visemes outside the resolver's set").toEqual([]);
    expect(used.size, "distinct viseme names exercised").toBeGreaterThanOrEqual(7);

    const differing = HOMOPHONE_PAIRS.filter(([a, b]) => PINNED[a] !== PINNED[b]);
    expect(
      differing.length,
      `homophone pairs whose pinned outputs differ (the defect #375 will fix): ${HOMOPHONE_PAIRS.map(
        ([a, b]) => `${a}/${b}`,
      ).join(" ")}`,
    ).toBeGreaterThanOrEqual(3);

    expect(
      PINNED["though"] === PINNED["cough"],
      "though/cough must be pinned IDENTICAL — that inverse error is part of the defect",
    ).toBe(true);
  });
});
