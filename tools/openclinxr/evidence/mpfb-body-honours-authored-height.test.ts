import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The case definition authors a CLINICAL phenotype; the MPFB body generator consumes MACRO floats.
 * Nothing translates between them, so an authored height never reaches an MPFB vertex.
 *
 * MEASURED 2026-08-11 over `buildActorPhenotypeExport()` (scenarioBank + edChestPainScenarioV2):
 *
 *   actors authoring a phenotype                 3
 *   authored keys                               24   height_cm, bmi, build, gender_presentation, …
 *   keys `apply_macros` consumes                 8   gender age muscle weight proportions height cupsize firmness
 *   OVERLAP                                      1   `age` — and it disagrees: authored 8 (years) vs MPFB 0..1
 *
 * `body_param_stage.py:1674-1678` reads macros straight off an authored dict
 * (`body_class.get("height", 0.5)`), so the macros are AUTHORED PER BODY CLASS, not derived from
 * the case, and an unauthored class is the median human at 0.5.
 *
 * THE KNOWN-GOOD COLUMN IS ALREADY IN THE TREE, on the Anny rail (D11: Anny is the reference).
 * `tools/openclinxr/asset-pipeline/anny/generate_mesh.py:341` `_solve_height_macro` bisects the
 * macro against `anny.Anthropometry` — the model measuring the body it just produced — and refuses
 * loudly when the target is outside the reachable band rather than shipping a short body.
 *
 * ITS HEADER SUPPLIES THIS CONTRACT'S COUNTERWEIGHT, measured rather than invented (`:299-310`):
 * the old mapping `(height_cm - 85.0) / 115.0` is wrong by up to 47 cm, and NO formula in height_cm
 * alone can be right — stature is a function of height AND age AND gender. Bisecting gives
 * 166 cm -> 0.7320, 176 cm -> 0.8635, 178 cm -> 0.5093: a TALLER target takes a LOWER macro. A
 * closed-form map is a refused treatment with a number attached, not an untested hypothesis.
 *
 * PREMISE CORRECTED BY THIS CONTRACT'S OWN PROBE, before dispatch. I first asserted that the linear
 * map was retired from the Anny rail entirely, and clause (4) went RED against a rail that is
 * healthy. It is still live at `generate_mesh.py:432` and that is CORRECT: it is the neutral default
 * for the branch where NO height_cm is authored, where there is no target to miss. Solving toward a
 * fabricated 170 cm there would wrongly refuse a valid `{age: 8}` body (#294 contract (3)). So the
 * claim is narrower than I first wrote it — the formula must stay out of the AUTHORED path, not out
 * of the file — and clause (4) now pins both halves. DO NOT DELETE the unauthored default to satisfy
 * this contract; that trades one defect for another.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                                   | (1) stature | (2) differs | (3) measured band | result
 *   --------------------------------------------|-------------|-------------|-------------------|--------
 *   a) today — authored macros, 0.5 defaults    |    FAIL     |    FAIL     |       FAIL        | REFUSED
 *   b) copy the Anny macro floats across        |    FAIL     |    pass     |     **FAIL**      | REFUSED
 *   c) linear map from height_cm                |  **FAIL**   |    pass     |     **FAIL**      | REFUSED
 *   d) bisect MPFB's own measured stature       |    pass     |    pass     |       pass        | ALL PASS
 *
 * (b) is the tempting one: the rails are different models, so Anny's 0.7320 does not mean 166 cm on
 * hm08. (3) is what refuses both (b) and (c): a per-actor REACHABLE BAND cannot be produced without
 * measuring the MPFB model twice for that actor, so echoing floats or evaluating a formula cannot
 * satisfy it. It is a substance check, not a marker check (§11k).
 *
 * TOLERANCE IS NOT INVENTED HERE. MADR 0051 §5, already cited at
 * `tools/openclinxr/evidence/anny-mpfb-landmark-compare.ts:797`, fixes it at +/-1 cm of the authored
 * height_cm — "fixed by the input", so the treatment cannot move it (§9s: the reference is
 * independent of the effect being measured).
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1), (2) and (3) are REDs and fail today — the artifact
 * does not exist. (4) PASSES today and is the known-good column: the Anny rail's solve and its
 * loud refusal must survive, because it is the reference the MPFB match is made against.
 *
 * NOT TESTED: no body is rendered and no pixel is graded. This asserts that the MPFB rail's macros
 * are DERIVED from the authored phenotype and measured against MPFB's own body. It does not claim
 * the resulting figure looks like the person the case describes, nor that any macro other than
 * height is correctly solved — the other seven are out of scope here (D4).
 *
 * UNMEASURED, and it must not be papered over: the authored child is 125 cm and Anny's ceiling for
 * that age/gender is ~115.7 cm, so Anny REFUSES it. Whether MPFB's band reaches 125 cm is unknown.
 * If it does not, the refusal path must survive — do NOT widen the band to make a row pass. A
 * recorded refusal with a measured band satisfies (1); a silently short body does not.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(REPO_ROOT, ".openclinxr/evidence/issue-329/phenotype-macro-solve.json");

/** MADR 0051 §5 — fixed by the input, not fitted to the observation. */
const TOLERANCE_CM = 1.0;

type Row = {
  actorId?: string;
  authoredHeightCm?: number;
  solvedMacros?: Record<string, number>;
  measuredStatureCm?: number;
  /** Measured on the MPFB model at macro 0 and 1 for THIS actor's other macros. */
  reachableBandCm?: [number, number];
  refused?: boolean;
  refusalReason?: string | null;
};

function rows(): Row[] {
  if (!existsSync(ARTIFACT)) return [];
  const parsed = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { rows?: Row[] };
  return Array.isArray(parsed.rows) ? parsed.rows : [];
}

/** Every clause guards on this: an empty artifact must FAIL, never pass vacuously (§7t). */
function requireRows(rs: Row[]): void {
  expect(rs.length, "actors with an authored height_cm in the solve artifact").toBeGreaterThanOrEqual(
    3,
  );
}

const solved = rows();

describe("an MPFB body honours the height its case authored", () => {
  it.fails(
    "(1) RED: every actor's measured stature is within 1 cm of its authored height_cm, or refuses with a measured band",
    () => {
      requireRows(solved);
      const bad: string[] = [];
      for (const r of solved) {
        const id = r.actorId ?? "?";
        if (r.refused) {
          // A refusal is an acceptable outcome ONLY if it carries the measured band and a reason.
          if (!r.reachableBandCm || !r.refusalReason) {
            bad.push(`${id}: refused with no measured band/reason`);
          }
          continue;
        }
        if (typeof r.authoredHeightCm !== "number" || typeof r.measuredStatureCm !== "number") {
          bad.push(`${id}: missing authoredHeightCm or measuredStatureCm`);
          continue;
        }
        const err = Math.abs(r.measuredStatureCm - r.authoredHeightCm);
        if (err > TOLERANCE_CM) {
          bad.push(
            `${id}: authored ${r.authoredHeightCm} cm, measured ${r.measuredStatureCm.toFixed(1)} cm (off by ${err.toFixed(1)} cm)`,
          );
        }
      }
      expect(bad, "actors whose MPFB body does not honour the authored height").toEqual([]);
    },
  );

  it.fails(
    "(2) RED COUNTERWEIGHT: actors authoring DIFFERENT heights get different height macros — a 0.5 default is refused",
    () => {
      requireRows(solved);
      const byHeight = new Map<number, Set<number>>();
      for (const r of solved) {
        const h = r.authoredHeightCm;
        const m = r.solvedMacros?.height;
        expect(typeof m, `${r.actorId ?? "?"}: solvedMacros.height recorded`).toBe("number");
        if (typeof h === "number" && typeof m === "number") {
          if (!byHeight.has(h)) byHeight.set(h, new Set());
          byHeight.get(h)!.add(Number(m.toFixed(6)));
        }
      }
      // Distinct authored heights must not collapse onto one macro value.
      const macrosByHeight = [...byHeight.entries()].map(([h, ms]) => ({ h, ms: [...ms] }));
      const allMacros = macrosByHeight.flatMap((e) => e.ms);
      expect(
        new Set(allMacros).size,
        `distinct height macros across ${macrosByHeight.length} distinct authored heights: ${allMacros.join(", ")}`,
      ).toBeGreaterThanOrEqual(Math.min(2, macrosByHeight.length));
    },
  );

  it.fails(
    "(3) RED COUNTERWEIGHT: each row carries a PER-ACTOR reachable band measured on the MPFB model — a formula or a copied float is refused",
    () => {
      requireRows(solved);
      const bad: string[] = [];
      const bands: string[] = [];
      for (const r of solved) {
        const id = r.actorId ?? "?";
        const band = r.reachableBandCm;
        if (!Array.isArray(band) || band.length !== 2 || !band.every((n) => typeof n === "number")) {
          bad.push(`${id}: no measured reachableBandCm`);
          continue;
        }
        const [floor, ceiling] = band as [number, number];
        if (!(ceiling > floor)) bad.push(`${id}: degenerate band [${floor}, ${ceiling}]`);
        bands.push(`${floor.toFixed(1)}-${ceiling.toFixed(1)}`);
      }
      expect(bad, "rows with no measured reachable band").toEqual([]);
      // A constant band across actors of different age/gender means the model was measured once
      // (or not at all) and the value copied — the (b)/(c) treatments.
      expect(
        new Set(bands).size,
        `distinct reachable bands across ${bands.length} actors: ${bands.join(" | ")}`,
      ).toBeGreaterThanOrEqual(2);
    },
  );

  it("(4) NET known-good: the Anny reference solve and its loud refusal survive", () => {
    const src = readFileSync(
      join(REPO_ROOT, "tools/openclinxr/asset-pipeline/anny/generate_mesh.py"),
      "utf8",
    );
    expect(src.includes("def _solve_height_macro("), "Anny height solve present").toBe(true);
    expect(src.includes("anny.Anthropometry"), "solve measures via anny.Anthropometry").toBe(true);
    expect(
      src.includes("REFUSE (issue-302)"),
      "Anny refuses an unreachable height rather than shipping a short body",
    ).toBe(true);

    // The closed-form map must stay OUT OF THE AUTHORED PATH — not out of the file. It remains the
    // legitimate neutral default when nothing is authored (see the header's corrected premise).
    const heightBlock = /if "height" in values:([\s\S]*?)\n\n/.exec(src)?.[1] ?? "";
    expect(heightBlock.length, "the height branch was located in generate_mesh.py").toBeGreaterThan(
      0,
    );
    const [authoredBranch, unauthoredBranch] = heightBlock.split(/\n\s*else:\s*\n/);
    expect(
      authoredBranch?.includes("_solve_height_macro(values, height_cm)"),
      "an AUTHORED height_cm is solved against the model, never mapped by formula",
    ).toBe(true);
    expect(
      /max\(0\.08/.test(authoredBranch ?? ""),
      "the linear map must not appear in the authored-height branch",
    ).toBe(false);
    expect(
      /max\(0\.08/.test(unauthoredBranch ?? ""),
      "the neutral default survives for the unauthored case (#294 contract (3))",
    ).toBe(true);
  });
});
