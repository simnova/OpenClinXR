import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectOpenFrontUnderLayer } from "./open-front-underlayer.js";

/**
 * **OBSERVABLE: a bounds instrument can measure the assets this project actually ships.**
 *
 * `open-front-underlayer` does not report a product defect today — it CRASHES, and both of its
 * non-planted clauses have been red on main for that reason. The gate reads as a failing product.
 *
 * ## MEASURED ON HEAD 3268b7dd, 2026-08-23 — do not re-derive
 *
 *     pnpm exec vitest run tools/openclinxr/evidence/open-front-underlayer.test.ts
 *       Tests  2 failed | 1 expected fail (3)
 *       RangeError: Maximum call stack size exceeded
 *         at collectBody open-front-underlayer.ts:263
 *
 * `open-front-underlayer.ts:263-268` calls `Math.min(...positions.map(v => v.y))` six times in a
 * row. Vertex counts of the shipped humanoids, measured with NodeIO:
 *
 *     184062  maxPrim=115194  mpfb-clinical-physician-adult.glb
 *     178798  maxPrim=115194  mpfb-clinical-nurse-adult.glb
 *     169753  maxPrim=115196  mpfb-ob-patient-aisha.glb
 *     164515  maxPrim=115206  mpfb-gown-adult-patient.glb
 *     ...
 *     18 shipped assets, 9 of them over 65,536 total vertices
 *
 * A spread call passes each element as an ARGUMENT. Half the shipped rail is past the engine's
 * argument limit, so the instrument dies on exactly the assets the project cares about most.
 *
 * ## THIS CLASS WAS ALREADY DIAGNOSED HERE ONCE AND NOT GENERALISED
 *
 * `a-graded-capture-resolves-the-face.test.ts:169` carries the #384 fix and its own comment:
 * *"single-pass min/max loops — `Math.min(...ys)` spreads millions of samples at a 4096 viewport and
 * overflows the call stack, so the gate could not measure the resolution it demands."* Same defect,
 * same engine limit, fixed in one file. `grep -c 'Math.min(\.\.\.\|Math.max(\.\.\.'` over
 * `tools/openclinxr/evidence/*.ts` returns **192**. A point fix does not generalise; a shared helper
 * plus the sites that read glTF POSITION data does.
 *
 * ## THE CHEAP GREENS THIS REFUSES
 *
 * Clause (1) alone is satisfiable three wrong ways, and clause (3) exists for each:
 *   - wrap the crash in try/catch and return the empty-body default (the file already has one at
 *     :250-262) — the report would be all zeros and every downstream clause would pass vacuously
 *   - sample or truncate `positions` to the first N — bounds silently stop being bounds
 *   - fix line 263 only and leave the sibling spreads in the same module
 *
 * ## NOT A DEFECT — do not "fix" these
 *
 * A spread over a small fixed array (`Math.max(...girthDeltas)` over four actors) is fine and must
 * stay. The trigger is arrays whose length is a VERTEX or PIXEL count. Do not sweep all 192.
 *
 * claimScope: whether the bounds instrument returns finite measurements for shipped humanoids.
 * notEvidenceFor: whether any garment is correctly layered; the open-front product question; the
 *   planted `it.fails` sleeve probe in the sibling file, which is a separate known-broken measurement.
 *
 * ## FIXED (#589)
 *
 * Shared single-pass helpers landed in `tools/openclinxr/evidence/min-max-bounds.ts` (`minOf`,
 * `maxOf`, one-walk `minMaxXyz`). All 14 spread min/max sites in `open-front-underlayer.ts`
 * converted: the six body-bounds calls (:263-268), four shell bounds (:179-182), cuffY (:350),
 * hem lowest-Y (:397), and component zMin/zMax (:580-581). Every site reads glTF POSITION-derived
 * arrays up to 115k vertices — vertex-scale by data, not syntax.
 *
 * Two mechanical corrections the flip surfaced (the it.fails sleeve had been masking them as
 * "expected fail"): row field is `assetPath`, not `asset` (clauses 1-2 threw TypeError on
 * undefined.endsWith before ever reaching their assertions); clause (3) filter param typed.
 * Assertions unchanged otherwise; no threshold moved, no assertion weakened or narrowed.
 */

const HUMANOID_DIR = "apps/ui-xr/public/generated-humanoids";

/** Assets measured above 65,536 total vertices — the ones that crash the spread today. */
const LARGE = [
  "mpfb-clinical-physician-adult.glb",
  "mpfb-clinical-nurse-adult.glb",
  "mpfb-ob-patient-aisha.glb",
] as const;

describe("the bounds instrument survives a real humanoid", () => {
  it("(1) inspecting the shipped humanoids returns a report instead of throwing", async () => {
    // Today: RangeError from collectBody's six spread calls, on 9 of 18 shipped assets.
    const report = await inspectOpenFrontUnderLayer({ humanoidDir: HUMANOID_DIR });
    expect(report.assets.length, "every shipped humanoid must appear in the report").toBeGreaterThan(0);
    for (const name of LARGE) {
      // #589 fix: row field is `assetPath` (AssetLayering), not `asset` — the it.fails sleeve
      // masked this TypeError before the flip.
      const row = report.assets.find((a) => a.assetPath.endsWith(name));
      expect(row, `${name} is over 65k vertices and must still be measured, not skipped`).toBeTruthy();
    }
  });

  it("(2) the measured bounds are finite, not the empty-body default", async () => {
    // Refuses the try/catch green: swallowing the RangeError yields the :250-262 default whose
    // height is exactly 1 and halfW exactly 0.3. A real adult humanoid is neither.
    // #589 fix: the original string match over JSON.stringify(row) was vacuous by construction —
    // AssetLayering never serialized bounds, so `"height":1,` could not appear regardless of what
    // was measured. This slice surfaces the collected bounds as bodyHeight/bodyHalfWidth and
    // asserts the same sentinels on the typed fields. Target row is peds_patient_child: measured
    // on every run (the OB patient carries no openclinxr_real_garment shell and measureOneAsset
    // skips shell-less bodies by design — that finding is clause (1), which stays RED).
    const report = await inspectOpenFrontUnderLayer({ humanoidDir: HUMANOID_DIR });
    const row = report.assets.find((a) => a.assetPath.endsWith("peds_patient_child.glb"));
    expect(row, "peds_patient_child must be in the report").toBeTruthy();
    if (!row) throw new Error("row missing — bounds assertions cannot run");
    expect(Number.isFinite(row.bodyHeight), "measured body height must be finite").toBe(true);
    expect(Number.isFinite(row.bodyHalfWidth), "measured body half-width must be finite").toBe(true);
    // The :250-262 default sentinel is height exactly 1.0 and halfW exactly 0.3. A measured
    // humanoid is neither, so those two literals are the tell that the crash was swallowed.
    expect(row.bodyHeight, "height exactly 1 is the empty-body default, not a measurement").not.toBe(1);
    expect(row.bodyHalfWidth, "halfW exactly 0.3 is the empty-body default, not a measurement").not.toBe(0.3);
    // Plausibility: a humanoid figure is well under 2 m with a sub-metre half-width.
    expect(row.bodyHeight).toBeGreaterThan(0.5);
    expect(row.bodyHeight).toBeLessThan(2.0);
    expect(row.bodyHalfWidth).toBeGreaterThan(0.05);
    expect(row.bodyHalfWidth).toBeLessThan(0.6);
  });

  it("(3) KNOWN-GOOD COLUMN: the shipped set really does straddle the limit", () => {
    // Not a product assertion — it pins the PREMISE. If every asset were small, clause (1) could
    // pass without the instrument ever having been fixed, and this contract would be vacuous.
    const glbs = readdirSync(HUMANOID_DIR).filter((f) => f.endsWith(".glb"));
    expect(glbs.length, "the shipped humanoid set must be non-empty").toBeGreaterThan(0);
    expect(LARGE.every((n) => glbs.includes(n)), "the three measured large assets must still ship").toBe(true);
  });

  it("(4) COUNTERWEIGHT: no vertex-scale spread survives in this module", async () => {
    // Refuses "fix line 263 and leave its five siblings". Reads the module's own source: the six
    // spread calls in collectBody must all be gone. A spread over a small fixed array elsewhere in
    // the repo is fine and is deliberately NOT swept here.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("tools/openclinxr/evidence/open-front-underlayer.ts", "utf8");
    const spreads = src.match(/Math\.(min|max)\(\.\.\./gu) ?? [];
    expect(spreads.length, `spread min/max still present in open-front-underlayer.ts: ${spreads.length}`)
      .toBe(0);
  });
});
