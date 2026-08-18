import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measureTrouserActor } from "./waistband-ring.ts";

/**
 * **The visible sawtooth at the shirt/trouser junction is the CARGO-PANTS WAISTBAND ring.** Graded in
 * pixels on every MPFB capture and located 2026-08-13 after two wrong attributions of mine — see the
 * withdrawal note below. Measured on the shipped bytes with the instrument in this file:
 *
 *   actor   ring                      verts   HF median   HF p95    ring span
 *   ------  ------------------------  -----   ---------   -------   ---------
 *   aisha   PANTS waistband (top)      132      3.50 mm   18.96 mm   26.2 mm
 *   aisha   shirt hem (bottom)         114      0.26 mm    2.01 mm   12.7 mm   <- known-good
 *   kevin   PANTS waistband (top)       59      1.80 mm   10.79 mm   27.0 mm
 *   kevin   shirt hem (bottom)         448      0.27 mm    0.47 mm    7.5 mm   <- known-good
 *   child   PANTS waistband (top)      144      2.46 mm   12.28 mm   18.3 mm
 *   child   shirt hem (bottom)         124      0.19 mm    1.47 mm   10.0 mm   <- known-good
 *
 * Ratios today: 9.4x / 23.0x / 8.4x. The bound is 4x, so this fails 3/3 with 2.1-5.8x of margin.
 *
 * ## WHY HIGH-FREQUENCY RESIDUAL AND NOT SPREAD OR AN EXTREME (SS11s)
 *
 * A waistband legitimately follows the body contour, so total Y-spread cannot separate natural drape
 * from raggedness -- and `min`/`max` are satisfied by a saw whose teeth all clear the line. The defect
 * is alternation between NEIGHBOURING vertices around the ring. So: order the ring by angle about the
 * body axis, subtract a 7-neighbour circular moving average (which removes the contour), and measure
 * what is left. That is the raggedness and nothing else.
 *
 * An earlier pass of mine ordered ring vertices by X. That is an INVALID traversal of a curve that
 * wraps the body -- adjacent in X can be opposite hips -- and it produced numbers 4-6x larger. Angular
 * ordering is not a detail here; it is the difference between measuring the defect and measuring the
 * parameterisation.
 *
 * ## THE KNOWN-GOOD COLUMN IS ON THE SAME BODY, SO NO NUMBER IS INVENTED (SS9h)
 *
 * The shirt hem is a garment boundary ring on the same actor, from the same MakeClothes library,
 * fitted by the same pipeline, measured in the same run by the same function. It lands at 0.47-2.01 mm.
 * That is proof this pipeline CAN produce a smooth ring on this body -- so the waistband's 10.79-18.96
 * mm is a defect and not a property of the medium. The 4x multiplier is my choice and I state it as
 * one: it grants four times the slack of the best ring the pipeline actually produces, and still fails
 * every actor today.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) ratio | (2) verts | (3) geometry | (4) hem | result
 *   -------------------------------------------------|-----------|-----------|--------------|---------|--------
 *   a) today                                         | **FAIL**  |   pass    |     pass     |  pass   | REFUSED
 *   b) ROUGHEN THE HEM to inflate the denominator    |   pass    |   pass    |     pass     | **FAIL**| REFUSED
 *   c) decimate the waistband ring until it is smooth|   pass    | **FAIL**  |     pass     |  pass   | REFUSED
 *   d) remesh / flatten the waistband                |   pass    |   pass    |   **FAIL**   |  pass   | REFUSED
 *   e) re-fit or re-tessellate so the ring follows   |   pass    |   pass    |     pass     |  pass   | ALL PASS
 *
 * **(b) is the load-bearing one and it is why clause (4) exists.** Clause (1) is a RATIO, and every
 * ratio can be satisfied from its denominator. Degrading the shirt hem from 1.47 mm to 4 mm would green
 * clause (1) on the child while making the product visibly worse in a second place. Clause (4) pins the
 * hem ABSOLUTELY, against its own measured value, so the denominator cannot move.
 *
 * (c) is the SS6t class: smoothness bought by deleting the vertices that carry the boundary. Clause (2)
 * floors the ring population -- a genuine re-tessellation raises it, decimation lowers it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 3/3. (2), (3) and (4) pass today
 * and are counterweights. Each is independent of the quantity (1) measures -- smoothing the waistband
 * moves neither the ring population, nor the triangle count, nor the hem -- so none can be satisfied by
 * the same edit that greens the RED.
 *
 * ## WITHDRAWN, and recorded because both wrong answers are plausible and someone will re-reach them
 *
 *   - **"It is the hide-mask boundary" (#364) is FALSE.** Every `openclinxr_hidden_*` material ships
 *     `alphaMode=MASK`, `alphaCutoff=0.5`, `baseColorFactor=[0,0,0,0]`. glTF discards any fragment below
 *     the cutoff and three.js maps `baseColorFactor[3]` to `opacity`, so `diffuseColor.a = 0 < 0.5`:
 *     the mask renders NOTHING. If it drew, it would be a black band, and no capture shows one.
 *   - **"It is the shirt hem" is FALSE.** In the 13.4 mm band where the child's hem and waist overlap,
 *     all 20 shared angular buckets have the pants OUTSIDE the shirt by 9.6-16.3 mm, and none within
 *     2 mm. The hem is tucked in and hidden; the pants rim is the visible edge against it.
 *
 * NOT TESTED:
 *   - **That fixing this removes the graded sawtooth.** This bounds ring geometry in the file. Only a
 *     pixel grade after a re-bake settles appearance, and that grade is the orchestrator's.
 *   - **The other rings.** Only the pants TOP and the shirt BOTTOM are measured. Trouser cuffs, sleeve
 *     cuffs, collars and the footwear rings are excluded, not asserted on.
 *   - **The hairline**, which is the same visual family (a boundary only as smooth as the ring carrying
 *     it) but is a MATERIAL REGION on the body mesh rather than a garment rim, and is not measured here.
 */

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#427) — kevin's pants rename blinded the matcher; the population guard is now the E5 artifact
 *
 * Kevin's wardrobe moved after the #389 rebase (WojackOWL scrubs: scrub_shirt + scrub_pants), and the
 * pants matcher here was /cargo_pants/ — "scrub_pants" does not match, so kevin measured as waist=n
 * and all four clauses failed on the vacuity guard: main was red in this contract without anyone
 * noticing, which is exactly the membership defect E5 (#422) exists to catch.
 *
 * Three changes, none touching the 4x bound:
 *
 *   1. **Matcher.** The pants test is now the shared `isPantsName` (pants|trousers|cargo) from
 *      waistband-ring.ts — the same enumeration E5 uses, so a future rename cannot blind only this
 *      contract. The ring measurement itself is unchanged, and it now lives in waistband-ring.ts
 *      (one instrument for this contract, the E5 membership contract, and the artifact generator).
 *   2. **Baseline re-keyed** to the measured shipped bytes: kevin's trousers are the scrub_pants
 *      cover shell at 2,704 tris with a 222-vert waistband ring (26.6 mm span), hem 0.475 mm. The
 *      previous row (2,498 tris / sweater hem 4.31 mm) described bytes that no longer ship.
 *   3. **The vacuity guard is inverted.** It asserted `rows.length === ACTORS.length` — the list
 *      checked against itself, satisfied by any hardcoded list. It now checks this contract's
 *      actors against the E5 membership artifact (waistband-membership.json), which is checked
 *      against the shipped directory; a rename or a missing artifact fails closed instead of
 *      passing silently.
 *
 * Measured 2026-08-18 on the shipped bytes with the shared instrument:
 *
 *   actor   ring                      verts   HF p95    ratio vs hem
 *   ------  ------------------------  -----   -------   ------------
 *   aisha   PANTS waistband (top)      476      4.106      3.327x
 *   aisha   toigo_t_shirt hem           124      1.234     (denominator)
 *   kevin   PANTS waistband (top)      222      1.880      3.958x
 *   kevin   scrub_shirt hem            448      0.475     (denominator)
 *   child   PANTS waistband (top)      430      2.500      1.700x
 *   child   toigo_t_shirt hem          124      1.471     (denominator)
 *
 * All three measure under the 4x bound; the four other trouser-carrying actors are measured and
 * recorded by the E5 membership contract, not asserted here.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#373) — appended; the planted header above is immutable
 *
 * Root cause, measured on the shipped bytes before this slice: the shipped lower garment is the
 * BODY-DERIVED COVER SHELL, not the authored cargo-pants .mhclo. The LOWER GATE replaces the sparse
 * library fit (392 tris / 211 verts, 32 open boundary edges — documented #220) with
 * `build_cover_shell`, and the shell's TOP rim is the band cut through body triangles: faces are
 * selected by CENTROID between the ankle and the shirt hem, so the rim alternates between "tooth"
 * vertices (one triangle's top, up to a triangle-height above the cut) and "valley" vertices (the
 * next triangle's top, below it) at every angle. Measured: adjacent welded rim vertices differ by up
 * to 24-40 mm (child/aisha/kevin), and the shipped waistband ring's high-frequency residual was
 * 8.4-23x the same body's shirt hem. The source .mhclo is NOT what ships (211-vert sparse trouser vs
 * the 7,892-vert shell — a byte-level identity difference), so the raggedness is pipeline-generated,
 * not authored; the issue's first-measurement stop condition (authored raggedness) does not apply.
 *
 * Fix: `materialize_mpfb_humanoid_candidate.py` now runs `regularize_waistband_rim` after the LOWER
 * GATE: the rim's own triangle ring is snapped onto the rim's angular ENVELOPE — the local maximum
 * rim height within a window (child 6 deg keeps the front contour dip the span floor requires;
 * adults 10 deg bridges their sparser front teeth) — interpolated per vertex, and the triangle ring
 * below is half-raised so the transition into the untouched shell is gradual. Triangle count,
 * vertex count and the ring's legitimate contour (the teeth envelope follows the body's waistline)
 * are unchanged, so the counterweights (no decimation, no remesh, no flattening, no hem roughening)
 * cannot be satisfied by this edit. The #371 post-export auto-smooth and #372 texture verify run
 * unchanged on the new geometry.
 *
 * Measured post-fix on the rebaked shipped bytes (this file's instrument):
 *
 *   actor   ring                       verts   HF median   HF p95    ring span   ratio vs hem
 *   ------  ------------------------   -----   ---------   -------   ---------   ------------
 *   aisha   PANTS waistband (top)       462      0.10 mm    1.51 mm   24.8 mm     0.75x
 *   aisha   shirt hem (bottom)          114      0.26 mm    2.01 mm   12.7 mm     (unchanged)
 *   kevin   PANTS waistband (top)       447      0.05 mm    1.63 mm   27.0 mm     3.47x
 *   kevin   scrub hem (bottom)          448      0.27 mm    0.47 mm    7.5 mm     (unchanged)
 *   child   PANTS waistband (top)       426      0.15 mm    1.32 mm   17.3 mm     0.90x
 *   child   shirt hem (bottom)          124      0.19 mm    1.47 mm   10.0 mm     (unchanged)
 *
 * All four clauses green: (1) ratios 0.75-3.47x under the 4x bound, (2) ring populations 426-462
 * above every baseline floor, (3) pants tris byte-identical to the baseline (2782/2628/2636) with
 * ring spans 17.3-27.0 mm above the 0.8x floors, (4) hems unchanged. Pre-fix residuals were
 * 12.28/18.96/10.79 mm (ratios 8.4x/9.4x/23.0x) — the header's immutable table.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#389) — appended; the planted header above is immutable
 *
 * #199 swapped kevin's scrub for the CC0 `toigo_fisherman_sweater`. The hem locator keyed on
 * garment NAMES (`/t_shirt|scrub_shirt/`), so the nurse dropped out of this enumeration and all
 * four clauses failed the vacuity guard — the subject existed, the matcher could not see it.
 * The fix is a shared SLOT-DERIVED predicate (`isUpperGarmentName` in garment-slot.ts): any
 * makeclothes library garment that is not the lower (pants/trousers), not the foot slot
 * (footwear/shoes/boots) and not the eye slot is an upper garment, whatever it is called. A
 * future wardrobe change (sweater, gown, cardigan) matches with no list edit — the list going
 * stale in three copies is what caused this regression in the first place.
 *
 * The rebake also re-cut kevin's pants (2,628 -> 2,498 tris — the cover shell's top follows the
 * upper garment's hem; #199 documented this in garments-are-flat-shaded, same class as #378) and
 * the departed scrub's hem baseline (0.47) is meaningless for an actor who now wears the sweater,
 * so the BASELINE row above is re-keyed to the measured shipped bytes (2,498 tris / 4.31 mm).
 * The clauses still bind: (3) refuses further pants changes, (4) refuses roughening the CURRENT
 * sweater hem beyond 1.5x its own measured value.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

const ACTORS = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"] as const;

/** The waistband may be at most this many times rougher than the same body's own shirt hem. */
const MAX_WAISTBAND_TO_HEM_HF_RATIO = 4;
/** The hem is the denominator of clause (1); this pins it absolutely so it cannot be inflated. */
const HEM_DEGRADATION_ALLOWANCE = 1.5;

/**
 * MEASURED 2026-08-13 on the shipped bytes. Floors refuse (b) hem degradation, (c) ring decimation and
 * (d) remesh. An actor absent from this table fails the enumeration guard rather than passing silently.
 */
const BASELINE: Record<
  string,
  { waistVerts: number; waistSpan: number; pantsTris: number; hemHfP95: number }
> = {
  "mpfb-ob-patient-aisha": { waistVerts: 132, waistSpan: 26.2, pantsTris: 2782, hemHfP95: 2.01 },
  // #389 REBASED 2026-08-14: kevin's pants 2,628 -> 2,498 tris (the cover shell's top
  // follows the upper garment's hem — #199 swapped the scrub for the longer
  // toigo_fisherman_sweater; same class as #378) and the hem baseline re-keyed from the
  // departed scrub (0.47) to the sweater's own measured value (4.31) — the scrub no
  // longer ships on this actor, so pinning the OLD garment's hem would be vacuous.
  //
  // #427 REBASED 2026-08-18: kevin's wardrobe moved again (WojackOWL scrubs: scrub_shirt +
  // scrub_pants), and the pants matcher below was blind to the rename — "scrub_pants" does not
  // match /cargo_pants/, so this actor measured as waist=n and all four clauses failed on the
  // vacuity guard. The matcher is now the shared isPantsName (pants|trouser|cargo) and the
  // baseline is re-keyed to the measured shipped bytes: 2,704 tris, scrub hem 0.475 mm,
  // waistband 222 verts / 26.6 mm span. The 4x bound is untouched; kevin measures 3.958x.
  "mpfb-peds-nurse-kevin": { waistVerts: 222, waistSpan: 26.6, pantsTris: 2704, hemHfP95: 0.475 },
  "mpfb-peds-patient-child": { waistVerts: 144, waistSpan: 18.3, pantsTris: 2636, hemHfP95: 1.47 },
};

const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/waistband-membership.json");

const rows = await Promise.all(ACTORS.map((actor) => measureTrouserActor(actor)));

/**
 * #427 INVERTED GUARD. This used to assert `usable.length === ACTORS.length` — the list checked
 * against itself, satisfied by any hardcoded list including a list of one (the E5 vacuity #422
 * names). The population is now owned by the E5 membership artifact, which is checked against the
 * shipped directory; this contract's own list is checked against THAT, so a wardrobe rename that
 * blinds this matcher can no longer pass silently and the artifact's absence fails closed.
 */
function requireMeasured(): void {
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { rows: { actor: string }[] };
  const measured = new Set(artifact.rows.map((r) => r.actor));
  const missing = ACTORS.filter((a) => !measured.has(a));
  expect(
    missing,
    `measured by #373 but absent from the E5 membership artifact (${ARTIFACT}): ${missing.join(", ")}`,
  ).toEqual([]);
  const usable = rows.filter((r) => r.waist !== null && r.hem !== null);
  expect(
    usable.length,
    `actors with both a waistband ring and a hem ring: ${rows
      .map((r) => `${r.actor} waist=${r.waist ? "y" : "n"} hem=${r.hem ? "y" : "n"}`)
      .join("; ")}`,
  ).toBe(ACTORS.length);
}

describe("the cargo-pants waistband is as smooth as the hem on the same body", () => {
  it(
    `(1) RED: waistband high-frequency residual is within ${MAX_WAISTBAND_TO_HEM_HF_RATIO}x the same body's shirt hem`,
    () => {
      requireMeasured();
      const ragged = rows
        .filter((r) => r.waist && r.hem && r.waist.hfP95 > r.hem.hfP95 * MAX_WAISTBAND_TO_HEM_HF_RATIO)
        .map(
          (r) =>
            `${r.actor}: waistband HF p95 ${r.waist!.hfP95.toFixed(2)}mm vs hem ${r.hem!.hfP95.toFixed(
              2,
            )}mm = ${(r.waist!.hfP95 / Math.max(r.hem!.hfP95, 0.01)).toFixed(1)}x (bound ${MAX_WAISTBAND_TO_HEM_HF_RATIO}x)`,
        );
      expect(ragged, "waistbands rougher than the same body's own garment hem").toEqual([]);
    },
  );

  it("(2) COUNTERWEIGHT: the waistband ring is not smoothed by decimation", () => {
    // Refuses buying smoothness by deleting the vertices that carry the boundary (SS6t).
    // A genuine re-tessellation RAISES this count; decimation lowers it.
    requireMeasured();
    const thinned = rows
      .filter((r) => r.waist && r.waist.verts < (BASELINE[r.actor]?.waistVerts ?? 0))
      .map((r) => `${r.actor}: waistband ring ${r.waist!.verts} verts < floor ${BASELINE[r.actor]?.waistVerts}`);
    expect(thinned, "waistband rings decimated rather than re-tessellated").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the trousers are not remeshed and the waistband is not flattened", () => {
    // Refuses changing the geometry instead of its smoothness — a remesh, or collapsing the ring's
    // contour so there is nothing left to be ragged.
    requireMeasured();
    const changed = rows
      .filter((r) => {
        const b = BASELINE[r.actor];
        return !b || r.pantsTris !== b.pantsTris || (r.waist?.span ?? 0) < b.waistSpan * 0.8;
      })
      .map((r) => {
        const b = BASELINE[r.actor];
        return b
          ? `${r.actor}: pants tris ${r.pantsTris} (was ${b.pantsTris}), waist span ${(r.waist?.span ?? 0).toFixed(1)}mm (was ${b.waistSpan}mm)`
          : `${r.actor}: not in the measured baseline`;
      });
    expect(changed, "trouser geometry changed rather than its ring smoothness").toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the shirt hem — clause (1)'s denominator — is not degraded", () => {
    // THE LOAD-BEARING ONE. Clause (1) is a ratio and every ratio can be satisfied from below.
    // Roughening the hem would green it while making the product visibly worse in a second place,
    // so the hem is pinned ABSOLUTELY against its own measured value, not relatively.
    requireMeasured();
    const degraded = rows
      .filter((r) => r.hem && r.hem.hfP95 > (BASELINE[r.actor]?.hemHfP95 ?? 0) * HEM_DEGRADATION_ALLOWANCE)
      .map(
        (r) =>
          `${r.actor}: hem HF p95 ${r.hem!.hfP95.toFixed(2)}mm exceeds ${HEM_DEGRADATION_ALLOWANCE}x measured ${BASELINE[r.actor]?.hemHfP95}mm — the ratio was satisfied from its denominator`,
      );
    expect(degraded, "shirt hem roughened to inflate clause (1)'s denominator").toEqual([]);
  });
});
