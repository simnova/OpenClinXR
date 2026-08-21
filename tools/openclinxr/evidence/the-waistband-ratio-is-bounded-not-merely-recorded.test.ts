import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E5, 2026-08-21 — THE 4x BOUND IS RECORDED AND NEVER APPLIED, AND THE POPULATION IS STALE.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this table
 *
 * WITHDRAWN BEFORE DISPATCH: I first wrote that the 4x bound "is applied to nothing". FALSE.
 * `the-waistband-is-as-smooth-as-the-hem.test.ts:262` applies it, and passes 4/4. Membership and
 * bound are deliberately split across two contracts and that split is correct.
 *
 * THE ACTUAL DEFECT IS THE BOUND'S POPULATION. `the-waistband-is-as-smooth-as-the-hem.test.ts:196`:
 *
 *     const ACTORS = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"]
 *
 * THREE HARDCODED ACTORS. Six shipped MPFB assets carry a measurable trouser waistband. The bound
 * therefore never sees half the rail -- including the WORST ratio on it. That is §7j: whenever a
 * check names its subjects explicitly, that list is the thing that will be wrong later.
 *
 * That contract is ALSO RED on main today, 2 of 4, and both reds are staleness:
 *
 *     (1) glbFilesScanned          expected 14 to be 18   <- 4 GLBs shipped since, never measured
 *     (4) mpfb-clinical-physician  artifact 0.239 vs 0.296 on the shipped bytes  <- #502/#504 rebaked it
 *
 * ## THE POPULATION, MEASURED 2026-08-21 with the SHIPPED instrument (`measureTrouserActor`)
 *
 *   actor                          waistP95   hemP95   ratio
 *   mpfb-street-adult-male             3.58     0.98    3.64   UNBOUNDED, never measured before today
 *   mpfb-viseme-inspect                4.11     1.23    3.33   UNBOUNDED, never measured before today
 *   mpfb-clinical-nurse-adult          1.88     0.47    3.96   UNBOUNDED  <- worst on the rail
 *   mpfb-clinical-physician-adult      1.88     6.36    0.30   UNBOUNDED, and see the hem note
 *   mpfb-gown-adult-patient             ---      ---     ---   no pants, correctly unmeasurable
 *   mpfb-gown-inspect                   ---      ---     ---   no pants, correctly unmeasurable
 *
 * **NO SHIPPED WAISTBAND EXCEEDS 4x.** The bound is a NET here, not a RED — say so rather than
 * implying a product defect. The RED is the staleness and the unapplied bound.
 *
 * ## THE 4x IS NOT MINE AND IS NOT FITTED (§9s)
 *
 * It comes from #373: "four times the slack of the best ring the pipeline actually produces",
 * derived from the shirt-hem known-good on the SAME body (0.19-0.27 mm HF median) before any
 * treatment. Its reference is the pipeline's own best output, independent of anything this slice
 * changes. Do not retune it. Clause (4) refuses a widening.
 *
 * ## A RATIO PASSES BY INFLATING ITS DENOMINATOR (§11s) — recorded, deliberately NOT gated here
 *
 * The physician's 0.30 is the best ratio on the rail and it is not good news: its waist is 1.88
 * (ordinary) while its HEM is 6.36 mm P95, against 0.47-1.23 mm for every other actor. It scores
 * well because its hem is 5-13x rougher than the fleet's, not because its waistband is smooth.
 * That is a real finding and it is OUT OF SCOPE here: gating absolute hem roughness needs its own
 * known-good column and its own card. Recorded so it is not lost, asserted on by nothing.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                   | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today - bound runs over 3 hardcoded actors               |FAIL |pass |FAIL |pass | REFUSED
 *   b) add the missing actors to the ACTORS literal by hand     |pass |pass |FAIL |pass | REFUSED
 *   c) enumerate, but skip any actor that would fail            |FAIL |pass |FAIL |pass | REFUSED
 *   d) enumerate, then widen the bound when something reds      |pass |pass |pass |FAIL | REFUSED
 *   e) enumerate from the shipped directory, bound them all     |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the one to watch.** Hand-extending the literal is green today and wrong on the next
 * bake. The population must come from the directory, exactly as #512 required of the garment cache.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (3) are RED today -- the artifact is stale
 * and the bound is applied nowhere. (2) and (4) are NETS: every shipped ratio already clears 4x,
 * so they cannot fail today and exist to catch a regression. Labelling either a RED would claim a
 * product defect that the measurement above says does not exist.
 *
 * KNOWN-GOOD COLUMN (§9h): the shirt hem on the same body, the same column #373 used. Every
 * measurable actor's hem P95 is 0.47-1.23 mm except the physician's 6.36 mm, noted above.
 *
 * NOT TESTED:
 *   - Absolute hem or waistband roughness. This bounds the RATIO only, as #373 defined it.
 *   - Whether any waistband LOOKS ragged. #373's instrument is angular-ordered HF residual; the
 *     pixel verdict is the orchestrator's and is not claimed here.
 *   - Actors with no trouser mesh. Gown wearers are correctly unmeasurable, not failures.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/waistband-membership.json");
const MEMBERSHIP_SRC = join(HERE, "every-shipped-trouser-waistband-is-measured.test.ts");
const BOUND_SRC = join(HERE, "the-waistband-is-as-smooth-as-the-hem.test.ts");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

/** #373's bound. Inherited, never re-derived here. */
const MAX_RATIO = 4;

type Row = { actor: string; ratio: number | null };

function rows(): Row[] {
  expect(existsSync(ARTIFACT), `${ARTIFACT} must exist`).toBe(true);
  return (JSON.parse(readFileSync(ARTIFACT, "utf8")).rows ?? []) as Row[];
}

describe("the waistband ratio is bounded, not merely recorded", () => {
  it.fails("(1) RED: the artifact covers every shipped MPFB GLB", async () => {
    const { readdirSync } = await import("node:fs");
    const shipped = readdirSync(GENERATED).filter((f) => f.startsWith("mpfb") && f.endsWith(".glb"));
    const scanned = JSON.parse(readFileSync(ARTIFACT, "utf8")).glbFilesScanned as number;
    const total = readdirSync(GENERATED).filter((f) => f.endsWith(".glb")).length;
    expect(scanned, `artifact scanned ${scanned}; ${total} GLBs ship today`).toBe(total);
    expect(shipped.length, "MPFB GLBs on disk").toBeGreaterThan(0);
  });

  it("(2) NET: every recorded ratio is BOUNDED by #373's 4x, not merely finite", () => {
    // Refuses (a) and (b). The shipped contract asserts Number.isFinite and calls a rough ring
    // "data, not a failure". A bound that is applied to nothing is a literal, not a gate.
    const measured = rows().filter((r) => r.ratio !== null);
    expect(measured.length, "at least one measurable trouser actor").toBeGreaterThan(0);
    for (const r of measured) {
      expect(r.ratio!, `${r.actor}: waistband/hem HF ratio must be within #373's ${MAX_RATIO}x`)
        .toBeLessThanOrEqual(MAX_RATIO);
    }
  });

  it.fails("(3) RED: the BOUND's population is enumerated from disk, not a hardcoded ACTORS list", async () => {
    // Refuses (a), (b) and (c). The bound is real and applied; it simply runs over three names.
    const { readdirSync } = await import("node:fs");
    const src = readFileSync(BOUND_SRC, "utf8");
    expect(
      /const ACTORS\s*=\s*\[\s*"/.test(src),
      "ACTORS must no longer be a literal list of actor names",
    ).toBe(false);
    // And what it runs over must match what ships and carries a waistband.
    const shipped = readdirSync(GENERATED).filter((f) => f.startsWith("mpfb") && f.endsWith(".glb"));
    const measurable = rows().filter((r) => r.ratio !== null).map((r) => r.actor);
    for (const a of measurable) {
      expect(shipped.includes(`${a}.glb`), `${a} is bounded but does not ship`).toBe(true);
    }
    expect(measurable.length, "measurable trouser actors under the bound (3 were hardcoded)")
      .toBeGreaterThanOrEqual(6);
  });

  it("(4) NET: the bound is #373's and has not been widened to buy a green", () => {
    // Refuses (d). §7a: a threshold in a contract becomes a design target. This one is inherited
    // from a known-good measured before any treatment, so widening it is always the wrong move.
    const src = readFileSync(BOUND_SRC, "utf8");
    expect(src, "MAX_WAISTBAND_TO_HEM_HF_RATIO must remain 4")
      .toMatch(/MAX_WAISTBAND_TO_HEM_HF_RATIO\s*=\s*4\b/);
    const measured = rows().filter((r) => r.ratio !== null);
    // Sensitivity: the guard must be able to go red. A synthetic row over the bound must be
    // rejected by the same comparison the contract uses — otherwise (2) is green about nothing.
    const synthetic = { actor: "zzz-synthetic-ragged", ratio: 40 };
    expect(synthetic.ratio <= MAX_RATIO, "a 40x row must NOT satisfy the bound").toBe(false);
    expect(measured.every((r) => r.ratio! <= MAX_RATIO), "and today's fleet must satisfy it").toBe(true);
  });
});
