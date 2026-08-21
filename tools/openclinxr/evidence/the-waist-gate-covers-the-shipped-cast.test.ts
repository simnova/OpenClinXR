import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **`garments-meet-at-the-waist` passes 4/4 on main and measures ZERO of the nine shipped actors.**
 * Found while grading `#542`. Measured, do not re-derive.
 *
 * Its entire population is two hardcoded ids at `garments-meet-at-the-waist.test.ts:170-171`:
 *
 *   const female = await measureWaist("body-param-adult_lean_female-library");
 *   const male   = await measureWaist("body-param-adult_heavy_male-library");
 *
 * read from `apps/ui-xr/public/xr-assets/humanoids/candidates` (`:103`) — a 13-GLB experiment
 * directory of `*-candidate` and `*-library` assets. The live cast is **9 assets: 8 from
 * `generated-humanoids/`, 1 from `candidates/`**, and neither hardcoded subject is among them.
 *
 * Same class as `#528`: a hand-typed population on the rail nobody ships. `live-scenario-actor-cast.ts`
 * is the proven helper `#528` landed for exactly this (D1) — wire it, do not hand-author a third.
 *
 * ## THE CAST IS FINE, WHICH IS THE POINT
 *
 * Measured world-space upper-hem vs lower-waistband on the live cast:
 *
 *   ob-patient-aisha      +30.9 mm      street-adult-male     +33.3 mm
 *   peds-patient-child    +22.4 mm      family-partner-adult  +16.8 mm
 *
 * **All overlap. There is no waist defect to fix.** This contract is about the gate being green
 * over the wrong population — a passing extension is the expected outcome, and that is fine. A
 * contract that only has value when it finds a defect is a contract that will manufacture one.
 *
 * (My `#542` pixel grade first reported a "waist discontinuity" on aisha. **Withdrawn** — measured
 * +30.9 mm overlap. What is visible is a seam between two same-coloured garments, not a gap.)
 *
 * ## THE TRAP — fix the regexes FIRST or the extension measures garbage
 *
 * `garments-meet-at-the-waist.test.ts:105-106`:
 *
 *   const UPPER = /shirt|top|scrub|gown|tshirt/i;
 *   const LOWER = /pants|trouser|short/i;
 *
 * **`makeclothes_library_scrub_pants` matches BOTH.** Confirmed on three cast actors —
 * `clinical-nurse-adult`, `clinical-physician-adult`, `peds-nurse-kevin`.
 *
 * Inert on the two library subjects. The moment the population extends to the cast, a scrub-trouser
 * mesh is read as an upper garment and its BOTTOM hem becomes the "upper hem". **My own probe hit
 * this and produced a nonsensical 938.6 mm overlap for those three actors before I spotted it** —
 * and it looked like a comfortable pass. Clause (2) exists for this alone.
 *
 * ## `mpfb-gown-adult-patient` HAS NO LOWER GARMENT
 *
 * It is gowned. An extension must treat it as a **declared skip with a reason**, never a failure and
 * never a silent pass (§7c — the escape value is where the real finding hides).
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                      | (1) cast | (2) no dual | (3) library kept | (4) bounds | result
 *   -----------------------------------------------|----------|-------------|------------------|------------|--------
 *   a) today — 2 library ids, 0 cast               | **FAIL** |  **FAIL**   |      pass        |    pass    | REFUSED
 *   b) swap the population to the cast, drop library| pass    |    pass     |    **FAIL**      |    pass    | REFUSED — loses the known-good
 *   c) extend without fixing the regexes           |   pass   |  **FAIL**   |      pass        |    pass    | REFUSED — 938.6 mm garbage
 *   d) widen MIN/MAX so the cast passes            |   pass   |    pass     |      pass        |  **FAIL**  | REFUSED — nothing needs widening
 *   e) fix regexes, add the cast, keep the library |   pass   |    pass     |      pass        |    pass    | ALL PASS
 *
 * (d) is the one to watch and it is pre-refused by measurement: the cast already overlaps by
 * +16.8 to +33.3 mm against a `MIN_OVERLAP_M` of 0, so **any widening is unmotivated by construction.**
 *
 * claimScope: whether the waist gate's measured population includes the shipped cast, and whether
 *   its garment classification is unambiguous.
 * notEvidenceFor: whether any actor's waist LOOKS right (the seam is ungraded); RIM_FRACTION or the
 *   overlap bounds being correct; the other garment gates.
 *
 * ## FIXED (#549)
 *
 * `garments-meet-at-the-waist.test.ts` now classifies via `isUpperGarmentName` / `isPantsName` (scrub_pants
 * is lower-only), keeps non-overlapping UPPER/LOWER patterns for this contract's source parse, enumerates
 * the live cast through `live-scenario-actor-cast.ts`, publishes `waist-fit-coverage.json`, and declares
 * `mpfb-gown-adult-patient` a skip with reason. Library known-good ids retained; MIN/MAX/RIM untouched.
 * `it.fails` on (1) and (2) flipped to `it`.
 */

const ARTIFACT = "tools/openclinxr/evidence/waist-fit-coverage.json";
const SIBLING = "tools/openclinxr/evidence/garments-meet-at-the-waist.test.ts";

/** The two library subjects on main. They must SURVIVE, not be replaced (§9h — known-good column). */
const LIBRARY = ["body-param-adult_lean_female-library", "body-param-adult_heavy_male-library"] as const;
/** Measured on the shipped cast 2026-08-21. Nothing here needs a widened bound. */
const CAST_OVERLAP_MM = { "mpfb-ob-patient-aisha": 30.9, "mpfb-street-adult-male": 33.3 } as const;
/** Unchanged from the sibling. Clause (4) pins them. */
const BOUNDS = { MIN_OVERLAP_M: 0, MAX_OVERLAP_M: 0.1, RIM_FRACTION: 0.12 } as const;

type Row = { id: string; source?: string; overlapMm?: number; skipped?: boolean; skipReason?: string };
type Cov = { subjects?: Row[] };
const cov = (): Cov => (existsSync(ARTIFACT) ? JSON.parse(readFileSync(ARTIFACT, "utf8")) as Cov : {});

async function liveCastBasenames(): Promise<string[]> {
  const m = await import("./live-scenario-actor-cast.js") as
    { listUniqueLiveCastMpfbAssetPaths: () => string[] };
  return m.listUniqueLiveCastMpfbAssetPaths().map((p) => p.split("/").pop()!.replace(/\.glb$/, ""));
}

describe("the waist gate covers the shipped cast", () => {
  it("(1) RED→GREEN: every live-cast actor appears in the waist gate's measured population", async () => {
    const rows = cov().subjects ?? [];
    expect(rows.length, `${ARTIFACT} missing — the gate publishes no coverage`).toBeGreaterThan(0);
    const seen = new Set(rows.map((r) => r.id));
    const missing = (await liveCastBasenames()).filter((b) => !seen.has(b)).sort();
    expect(missing, "shipped cast actors the waist gate does not measure").toEqual([]);
  });

  it("(2) RED→GREEN: no mesh is classified as BOTH upper and lower", () => {
    // scrub_pants matched UPPER and LOWER on main. Read the sibling's own patterns rather than
    // restating them, so a fix there is what flips this rather than a copy here.
    const src = readFileSync(SIBLING, "utf8");
    const up = /const UPPER = \/([^/]+)\/i/.exec(src)?.[1];
    const lo = /const LOWER = \/([^/]+)\/i/.exec(src)?.[1];
    expect(up, "could not read UPPER from the sibling").toBeTypeOf("string");
    expect(lo, "could not read LOWER from the sibling").toBeTypeOf("string");
    const U = new RegExp(up!, "i"), L = new RegExp(lo!, "i");
    const dual = ["makeclothes_library_scrub_pants", "makeclothes_library_scrub_shirt",
      "makeclothes_library_cargo_pants", "makeclothes_library_toigo_t_shirt"]
      .filter((n) => U.test(n) && L.test(n));
    expect(dual, "garment names matching both UPPER and LOWER").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the two library subjects are still measured — widen, do not swap", () => {
    // Refuses (b). They are the known-good column: same instrument, a rail with a known answer.
    const rows = cov().subjects ?? [];
    if (rows.length === 0) return; // clause (1) owns the missing-artifact failure
    const seen = new Set(rows.map((r) => r.id));
    const lost = LIBRARY.filter((l) => !seen.has(l));
    expect(lost, "library subjects dropped from the population").toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the overlap bounds are untouched", () => {
    // Refuses (d), and measurement pre-refuses it: the cast already overlaps +16.8..+33.3 mm
    // against MIN_OVERLAP_M = 0, so nothing needs widening.
    const src = readFileSync(SIBLING, "utf8");
    expect(src, "MIN_OVERLAP_M must stay 0").toMatch(/MIN_OVERLAP_M\s*=\s*0\b/);
    expect(src, "MAX_OVERLAP_M must stay 0.1").toMatch(/MAX_OVERLAP_M\s*=\s*0\.1\b/);
    expect(src, "RIM_FRACTION must stay 0.12").toMatch(/RIM_FRACTION\s*=\s*0\.12\b/);
    void BOUNDS;
  });

  it("(5) VACUITY: a garment-less actor is a DECLARED skip, never a silent pass", () => {
    // mpfb-gown-adult-patient has no lower garment. It must say so.
    const rows = cov().subjects ?? [];
    if (rows.length === 0) return;
    const bad = rows.filter((r) => r.skipped && !(typeof r.skipReason === "string" && r.skipReason.trim().length >= 12))
      .map((r) => r.id);
    expect(bad, "skipped subjects with no substantive reason").toEqual([]);
    const measured = rows.filter((r) => !r.skipped);
    for (const r of measured) {
      expect(r.overlapMm, `${r.id} measured but recorded no overlap`).toBeTypeOf("number");
    }
    void CAST_OVERLAP_MM;
  });
});
