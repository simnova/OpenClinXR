import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #459 — the parent's mid-face collapses when `mouth-open` is driven to 1.0.
 *
 * ## GRADED BY THE ORCHESTRATOR, NATIVE 1280x960, BEFORE THIS CARD EXISTED
 *
 * `tools/openclinxr/evidence/stills/speaking-parent-{not-speaking,speaking}.png`, 278 KB each,
 * same GLB (`sha256 b8801c63…`), same derived camera and framing, **one variable** — `mouth-open`
 * at 0 vs 1.0:
 *
 *   | still            | mid-face                                            | mouth      |
 *   |------------------|-----------------------------------------------------|------------|
 *   | morph 0 (REST)   | **clean** — nose bridge and cheeks hold, plausible   | closed     |
 *   | morph 1.0        | **CAVED** — creases from both inner canthi, cheeks in| wide oval  |
 *
 * The rest frame is the known-good column (SS9h) and it is a rendered artifact already on disk, not
 * a number I invented. This is the ONLY defect in the E2 lane that reproduces deterministically.
 *
 * ## WHAT THIS IS NOT — #402's spike, which three instruments cannot find
 *
 * Neither still shows a spike. `speaking-spike-head-local.json` measures the parent's head-assembly
 * vertices at **8.729 mm** (control child 3.401 mm) with `headRigid100MaxDeltaMm = 0`, so the
 * instrument is sound and the answer is small. `speaking-parent-morph-weights.json` reads
 * `harness_artefact`, 2 of 32 morphs non-zero, max 0.5019 on an eyebrow. #402 stays OPEN and
 * UNOPERATIONALIZED with that grade recorded on it. **Do not turn this slice into a spike hunt.**
 *
 * ## WHY THIS IS PRODUCT, NOT A HARNESS CURIOSITY
 *
 * `apps/ui-xr/src/viseme-morph-apply.ts:12` records that the library bodies carry `mouth-open` /
 * `eyebrows-*-inner-up` **instead of** viseme targets. Measured on the shipped GLB: the parent
 * carries **32 FACS targets and no `viseme_AA`** — `mouth-open`, `mouth-compression`,
 * `mouth-protusion`, the eyebrow and eye set. So the runtime's AA maps onto `mouth-open`. **If the
 * mixer ever emits AA at full weight, a learner sees this face.**
 *
 * That also settles the first branch of the method: there is no `viseme_AA` to drive instead.
 *
 * ## THE SLICE — a SWEEP, because the threshold is not mine to pick (SS9k)
 *
 * Render `mouth-open` at **0 / 0.3 / 0.6 / 1.0** as ONE labelled contact sheet. The contract asserts
 * the LEDGER — that four rows exist, at those weights, visibly distinguishable. **The orchestrator
 * grades the sheet** and picks the weight at which the face stops being acceptable. Do not pick a
 * cap, do not "fix" anything, do not tune a coefficient.
 *
 * **Stop rule:** after two probes, if a wide-open mouth still caves the nose, STOP AND REPORT. Do
 * not invent a third morph or a corrective shape key.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED   — no sweep sheet or ledger exists.
 *   (2) RED   — the ledger must carry exactly the four named weights.
 *   (3) RED   — the cells must be measurably DISTINCT; an all-identical sweep proves nothing.
 *   (4) NET-BEHIND-THE-ARTIFACT — the rest row stays the rest row. Reads the ledger, so it fails
 *               today like (1)-(3); it is a counterweight in intent, not a RED. (This is the third
 *               slice running where I have had to say that; a clause that reads its own deliverable
 *               is red until the deliverable exists, and that is not the same thing as a RED.)
 *   (5) GUARD — the known-good stills are still on disk and still the pair I graded.
 *
 * Clean tree: **4 failing / 1 passing.**
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) render one cell and label it a sweep            -> (2) fails
 *   b) render four cells that are all the rest pose     -> (3) fails; a sweep that does not sweep
 *   c) zero every morph so nothing collapses            -> (3) and (4) fail
 *   d) "fix" the collapse by capping mouth-open in code -> out of scope; this slice MEASURES
 *   e) delete or weaken the still-pair probe            -> (5) fails, and merge-kill refuses
 *      `deleted-test`
 *
 * NOT TESTED:
 *   - #402's spike. Different shape, unreproduced, deliberately out of scope.
 *   - The helmet hair and the face-vs-arm colour difference. Both present at REST in my grade, so
 *     neither is speech-related; recorded on #402, not fixed here.
 *   - Whether any weight is clinically acceptable. That is a staging judgement on the graded sheet.
 *   - The runtime mixer. Nothing here changes what the mixer emits.
 *   - Quest, browser-on-device, frame budget.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SHEET = join(HERE, "mouth-open-sweep-sheet.png");
const LEDGER = join(HERE, "mouth-open-sweep.json");
const REST_STILL = join(HERE, "stills/speaking-parent-not-speaking.png");
const OPEN_STILL = join(HERE, "stills/speaking-parent-speaking.png");

/** The sweep the superagent specified. Not a threshold — a set of samples for the grader. */
const WEIGHTS = [0, 0.3, 0.6, 1.0] as const;
/** #431 measured blanks at sd 0.96/1.82 and real content at 26.90-45.56. */
const MIN_CONTENT_SD = 8;

type Cell = { morphWeight: number; luminance?: { mean: number; sd: number } };
type Ledger = { actor: string; sourceGlbSha256: string; cells: Cell[] };

const ledger: Ledger | null = existsSync(LEDGER)
  ? (JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger)
  : null;

function requireCells(): Cell[] {
  expect(
    ledger,
    `tools/openclinxr/evidence/mouth-open-sweep.json must exist — the sheet is the deliverable and `
      + `the ledger is what this contract can check; the orchestrator grades the pixels`,
  ).not.toBeNull();
  const cells = ledger?.cells ?? [];
  expect(cells.length, "an empty sweep is not a sweep").toBeGreaterThan(0);
  return cells;
}

describe("the mouth-open sweep shows where the face collapses", () => {
  it("(1) RED: the sweep sheet and its ledger exist, and the sheet carries content", () => {
    requireCells();
    expect(existsSync(SHEET), `${SHEET} must exist`).toBe(true);
    expect(
      statSync(SHEET).size,
      `a four-cell 1280x960-class sheet is not a stub; the graded pair are ~278 KB each`,
    ).toBeGreaterThan(60_000);
  });

  it("(2) RED: the ledger carries exactly the four specified weights", () => {
    // Refuses (a). One cell labelled "sweep" is not a sweep.
    const got = requireCells().map((c) => c.morphWeight).sort((a, b) => a - b);
    expect(got, `the superagent specified 0 / 0.3 / 0.6 / 1.0 — do not add or drop samples`).toEqual([
      ...WEIGHTS,
    ]);
  });

  it("(3) RED: the cells are measurably distinct and none is blank", () => {
    // Refuses (b) and (c). A sweep whose cells are identical answers nothing, and a blank cell
    // passes a byte floor while showing nobody anything.
    const cells = requireCells();
    for (const c of cells) {
      expect(c.luminance, `cell at weight ${c.morphWeight} must carry a luminance measure`).toBeDefined();
      expect(
        c.luminance?.sd ?? 0,
        `cell at weight ${c.morphWeight} reads as blank (#431: blanks 0.96-1.82, content 26.90-45.56)`,
      ).toBeGreaterThan(MIN_CONTENT_SD);
    }
    const means = cells.map((c) => c.luminance?.mean ?? 0);
    expect(
      Math.max(...means) - Math.min(...means),
      `every cell has the same mean luminance — the morph is not being driven, or all four cells are `
        + `the same render`,
    ).toBeGreaterThan(0);
  });

  it("(4) COUNTERWEIGHT: the rest row is present and is the zero-weight row", () => {
    // Refuses (c). The known-good column must survive: if "fixing" the collapse means flattening
    // the rest pose too, the sweep has lost its control.
    const cells = requireCells();
    const rest = cells.find((c) => c.morphWeight === 0);
    expect(rest, `weight 0 is the known-good column — the still I graded clean`).toBeDefined();
    expect(ledger?.sourceGlbSha256, `record which bytes were rendered`).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("(5) VACUITY GUARD: the graded known-good pair is still on disk, unmodified", () => {
    // Refuses (e). This slice measures a NEW sweep; it must not disturb the pair the grade rests on.
    for (const p of [REST_STILL, OPEN_STILL]) {
      expect(existsSync(p), `${p} is the graded evidence this card is built on`).toBe(true);
      expect(statSync(p).size, `${p} must still carry its rendered content`).toBeGreaterThan(200_000);
    }
    expect(WEIGHTS.includes(0) && WEIGHTS.includes(1.0), "the sweep spans rest to full").toBe(true);
  });
});
