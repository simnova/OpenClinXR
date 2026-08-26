import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #458 — main is RED because the nurse's wardrobe changed and the baseline did not follow.
 *
 * `garments-are-flat-shaded-and-the-body-is-not.test.ts` clause (3) fails on main:
 *
 *     mpfb-peds-nurse-kevin/mat_makeclothes_library_scrub_pants: not in the measured baseline
 *     mpfb-peds-nurse-kevin/mat_makeclothes_library_scrub_shirt: not in the measured baseline
 *
 * ## WHAT I MEASURED, AND IT KILLED THE PREMISE I WAS GIVEN
 *
 * I was about to plant "consume the cached scrubs onto the nurse — `Scrub_Shirt` and
 * `Scrub_Pants` are cached, classed and reach no actor." **That is false.** Read off the shipped
 * bytes of `apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb`:
 *
 *     makeclothes_library_scrub_shirt_mpfb_peds_nurse_kevin_mesh    9384 tris
 *     makeclothes_library_scrub_pants_mpfb_peds_nurse_kevin_mesh    2704 tris
 *     makeclothes_library_hair_mhair02_...                          3460 tris
 *     makeclothes_library_footwear_culturalibre_male_boots_...     30768 tris
 *
 * **No fisherman sweater. No cargo pants.** Kevin already wears the full clinical kit; #403 wired
 * `LONG_SLEEVE_UPPER_BY_REFERENCE["peds_nurse_kevin"] = None` so the clinician branch selects the
 * WojackOWL CC-BY scrub shirt, and the clinician lower path fits `Scrub_Pants` pre-strip
 * (`materialize_mpfb_humanoid_candidate.py:3104-3106`). The consume already happened.
 *
 * My false premise came from the 2026-08-14 wardrobe handoff, which predates #403. It is the
 * eleventh of mine this session and it propagated into an order before a measurement caught it.
 *
 * ## THE REAL DEFECT — the tree still believes the old wardrobe in two places
 *
 * 1. **A RED contract baseline.** `garments-are-flat-shaded-and-the-body-is-not.test.ts:128-129`
 *    still carries `mat_makeclothes_library_cargo_pants.001` and
 *    `mat_makeclothes_library_fisherman_sweater` for kevin. Neither ships. The two garments that
 *    DO ship have no row, so clause (3) reds.
 * 2. **A stale inspector table.** `garment-texture-inspection.ts:222` maps
 *    `peds_nurse_kevin -> "toigo_fisherman_sweater"`, directly contradicting the materializer.
 *
 * ## KNOWN-GOOD COLUMN — the replacement numbers are NOT the bake's word for itself (SS9h)
 *
 * Both counts are independently recorded by OTHER contracts, written for OTHER reasons, before
 * this slice existed. That is what makes a baseline update safe rather than a rubber stamp:
 *
 *   | garment      | tris | independently recorded at |
 *   |--------------|-----:|---------------------------|
 *   | scrub_shirt  | 9384 | `makeclothes-library-consumed.test.ts:22` (`garmentTriangles 9384`) and `:115`; `garment-covers-its-region.ts:12` ("9,384 tris, closed shell") |
 *   | scrub_pants  | 2704 | `the-garment-gate-measures-every-dressed-actor.test.ts:26`; `the-waistband-is-as-smooth-as-the-hem.test.ts:103` ("cover shell at 2,704 tris") |
 *
 * The red file's OWN header (`:18`) also already records `kevin scrub_shirt 4310 coplanar`.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED   — the baseline must carry a row for every garment the nurse actually ships.
 *   (2) RED   — those rows' tri counts must equal the independently recorded library counts.
 *   (3) RED   — an inverted guard: the nurse must ship NO cargo pants and NO fisherman sweater.
 *   (4) RED   — the inspector table must not claim kevin wears the sweater.
 *   (5) NET   — the other two actors' baseline rows are untouched. Passes today, must keep passing.
 *   (6) GUARD — reads the shipped GLB, so the fixture is the product, not a copy of the baseline.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) paste whatever the current bake emits into the baseline  -> (2) fails; the numbers must
 *      match the independent records, not the bake's own output. This is the one to watch: a
 *      baseline rubber-stamped from the thing it is supposed to police accepts a real remesh too.
 *   b) DELETE the two stale rows and stop                       -> (1) fails; the shipping
 *      garments still need rows
 *   c) delete the whole red clause                              -> merge-kill refuses
 *      `deleted-test`; rewrite as an inverted guard, never remove
 *   d) revert kevin to the sweater to match the old baseline    -> (3) fails
 *   e) edit the other actors' rows to make something line up    -> (5) fails
 *
 * NOT TESTED:
 *   - **Whether the scrub kit LOOKS right on kevin.** This is a numbers-vs-bytes reconciliation.
 *     No pixel claim is made or implied; the orchestrator has not graded a fitted nurse render.
 *   - `coplanar` and `sharpSplit` for the new rows. Only `tris` has an independent record, so only
 *     `tris` is asserted here; the other two are recorded by the worker and pinned by the red
 *     file's own clause once its baseline has rows.
 *   - The other three clauses of the red file, which pass today and are not this slice's subject.
 *   - Any other actor. `mpfb-clinical-nurse-adult` and `mpfb-clinical-physician-adult` also read
 *     2704 in the garment-gate table but are not in this contract's ACTORS list.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const KEVIN_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb");
const RED_FILE = join(HERE, "garments-are-flat-shaded-and-the-body-is-not.test.ts");
const INSPECTOR = join(HERE, "garment-texture-inspection.ts");

/** Independently recorded elsewhere in the tree, before this slice. Not the bake's own word. */
const LIBRARY_TRIS: Record<string, number> = {
  scrub_shirt: 9384,
  scrub_pants: 2704,
};
/** Superseded by #403. The nurse must not ship these again without a deliberate slice. */
const RETIRED = ["cargo_pants", "fisherman_sweater"] as const;

const io = new NodeIO();
const doc = await io.read(KEVIN_GLB);

/** Garment mesh names the shipped nurse actually carries. */
const shippedGarments: string[] = doc
  .getRoot()
  .listMeshes()
  .map((m) => m.getName())
  .filter((n) => n.startsWith("makeclothes_library_"))
  .filter((n) => !/_hair_|_eyes_|_footwear_/u.test(n));

const baselineSrc = readFileSync(RED_FILE, "utf8");
const kevinBaselineKeys = [
  ...baselineSrc.matchAll(/"mpfb-peds-nurse-kevin::mat_(makeclothes_library_[a-z_0-9.]+)"\s*:\s*\{\s*tris:\s*(\d+)/gu),
].map((m) => ({ material: m[1] as string, tris: Number(m[2]) }));

describe("the nurse wardrobe baseline matches the shipped bytes", () => {
  it("(1) RED: every garment the nurse ships has a baseline row", () => {
    const missing = shippedGarments.filter(
      (mesh) => !kevinBaselineKeys.some((b) => mesh.includes(b.material.replace("makeclothes_library_", ""))),
    );
    expect(
      missing,
      `the shipped nurse carries these garment meshes; each needs a row in `
        + `garments-are-flat-shaded-and-the-body-is-not.test.ts's BASELINE`,
    ).toEqual([]);
  });

  it("(2) RED: the new rows carry the independently recorded library tri counts", () => {
    // Refuses (a). If the baseline is stamped from the bake it is policing, it accepts a real
    // remesh too. These two numbers were recorded by other contracts for other reasons.
    for (const [garment, tris] of Object.entries(LIBRARY_TRIS)) {
      const row = kevinBaselineKeys.find((b) => b.material.includes(garment));
      expect(row, `no baseline row for ${garment}`).toBeDefined();
      expect(
        row?.tris,
        `${garment} must be pinned at the independently recorded ${tris}, not at whatever this `
          + `bake emitted — see the known-good table in this file's header`,
      ).toBe(tris);
    }
  });

  it("(3) RED: inverted guard — the nurse ships no cargo pants and no fisherman sweater", () => {
    // Refuses (c) and (d). The superseded rows become a guard rather than a deletion: merge-kill
    // refuses `deleted-test`, and more importantly a silent revert to street clothes must fail.
    for (const retired of RETIRED) {
      expect(
        shippedGarments.filter((n) => n.includes(retired)),
        `#403 moved the nurse to the clinical kit; ${retired} reappearing means a silent revert`,
      ).toEqual([]);
      expect(
        kevinBaselineKeys.some((b) => b.material.includes(retired)),
        `the stale ${retired} baseline row must go — the nurse does not wear it`,
      ).toBe(false);
    }
  });

  it("(4) RED: the inspector no longer claims the nurse wears the sweater", () => {
    const src = readFileSync(INSPECTOR, "utf8");
    const table = src.slice(src.indexOf("LONG_SLEEVE_BY_REFERENCE"));
    const kevinLine = /peds_nurse_kevin\s*:\s*("([^"]*)"|null)/u.exec(table);
    expect(kevinLine, `garment-texture-inspection.ts must still map peds_nurse_kevin`).not.toBeNull();
    expect(
      kevinLine?.[2] ?? null,
      `the materializer sets LONG_SLEEVE_UPPER_BY_REFERENCE["peds_nurse_kevin"] = None so the `
        + `clinician branch picks the scrub shirt; the inspector must agree`,
    ).toBeNull();
  });

  it("(5) COUNTERWEIGHT: the other two actors' baseline rows are untouched", () => {
    // Refuses (e).
    for (const [actor, material, tris] of [
      ["mpfb-ob-patient-aisha", "toigo_t_shirt", 2700],
      ["mpfb-peds-patient-child", "toigo_t_shirt", 2700],
      // #681 re-pinned 2636 -> 2628: the child's re-bake ran the current pipeline, which includes
      // the #656 hem-weld scoping that her last bake (2026-08-21) predates — the sibling
      // flat-shading contract re-pinned the same row for the same reason. Not treatment (e): the
      // edit records current-code geometry, it does not make a stale nurse baseline line up.
      ["mpfb-peds-patient-child", "cargo_pants.001", 2628],
    ] as const) {
      const re = new RegExp(`"${actor}::mat_makeclothes_library_${material.replace(/\./gu, "\\.")}"\\s*:\\s*\\{\\s*tris:\\s*${tris}`, "u");
      expect(re.test(baselineSrc), `${actor} ${material} must stay at ${tris}`).toBe(true);
    }
  });

  it("(6) VACUITY GUARD: the fixture is the shipped product, not a copy of the baseline", () => {
    expect(shippedGarments.length, "the nurse ships garment meshes").toBeGreaterThan(1);
    expect(
      shippedGarments.some((n) => n.includes("scrub_shirt")) && shippedGarments.some((n) => n.includes("scrub_pants")),
      "read off the GLB, the nurse wears the clinical kit — that is the fact the baseline must match",
    ).toBe(true);
    expect(kevinBaselineKeys.length, "the baseline is parseable and non-empty").toBeGreaterThan(0);
  });
});
