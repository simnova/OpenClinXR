import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Every MPFB actor has substantially more hair on the LEFT of its scalp than the RIGHT.
 *
 * MEASURED 2026-08-12 on the shipped GLBs. Scalp-dome vertices (skin verts above 0.94 H) split by
 * the sign of X, each sampled from that actor's OWN baked skin texture at its own UV:
 *
 *   actor            LEFT n / %hair-dark    RIGHT n / %hair-dark    asymmetry
 *   ---------------- ---------------------- ----------------------- ---------
 *   aisha            140 / 82.1%            140 / 46.4%             35.7 pts
 *   nurse_kevin      300 / 87.0%            300 / 57.3%             29.7 pts
 *   patient_child    122 / 82.8%            122 / 49.2%             33.6 pts
 *
 * Same direction on all three, 30-36 points, on a region that should be near-symmetric. This is a
 * pipeline fault, not one actor's problem.
 *
 * HOW THIS WAS FOUND, because the route matters more than the number:
 *
 * I graded the child "bald" from a front-lit capture and filed three explanations. All three died:
 *
 *   hypothesis                                  | measurement                              | verdict
 *   --------------------------------------------|------------------------------------------|--------
 *   round 13 removed the child's hair            | it removed 440 texels, all in the eye band; aisha lost 3,013 in the same band | dead
 *   the child has less hair paint                | child 100,201 vs aisha 105,139 texels    | dead
 *   the paint misses the child's crown in UV     | child crown samples 69.1% hair-dark, aisha 66.2% | dead
 *   the fault is child-specific                  | all three actors show it, 29.7-35.7 pts  | dead
 *
 * The fourth死 came from looking at the THREE-QUARTER view: the child has dense hair on one side and
 * bare skin on the other, with a hard front-to-back boundary over the skull. The front view showed
 * the bare side, so "bald" was a one-angle verdict. §11l warns a thumbnail cannot support a negative
 * verdict; this is the same failure at full resolution — one angle is not the object.
 *
 * It also corrects a grade I published: I called aisha's face "good". She carries the same 35.7-point
 * deficit; her front view hides it. 0 of 3 was always the honest count.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                | (1) symmetric | (2) hair remains | (3) hairline survives | result
 *   -----------------------------------------|---------------|------------------|-----------------------|--------
 *   a) today                                 |   **FAIL**    |      pass        |        pass           | REFUSED
 *   b) drop the hair region entirely         |     pass      |    **FAIL**      |      **FAIL**         | REFUSED
 *   c) paint the whole dome                  |     pass      |      pass        |      **FAIL**         | REFUSED
 *   d) fix the directional bias in the region|     pass      |      pass        |        pass           | ALL PASS
 *
 * (b) and (c) are the two ways to make a ratio symmetric without fixing anything: remove the numerator
 * or saturate it. Clause (2) bounds coverage below and clause (3) bounds it above by requiring the
 * hairline band to still separate hair from face — a fully-painted dome has no hairline.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails on all three. (2) and (3) PASS
 * today and are regression nets — round 11 retired the per-polygon scalp (`scalpPrims=0`) and round 13
 * recovered the eye sockets; neither may be spent to buy symmetry.
 *
 * NOT TESTED: this asserts LEFT/RIGHT BALANCE of the baked hair region only. It says nothing about
 * whether the hairline is at the right height, whether the hair looks like hair, or about the nurse's
 * mottled mouth region. It samples one texel per vertex, so it measures coverage, not appearance. And
 * it does not diagnose the cause — a directional bias could come from the region classifier, the UV
 * splat, or the bake, and nothing here distinguishes them.
 *
 * ## SUPERSEDED (#359) — the subject moved from the baked texture to the region primitive
 *
 * #358's head-framed comparison settled the direction: the texture-mask hairline was graded as
 * damage and the per-polygon scalp material region (the Anny mechanism) wins. #359 removes the
 * texture route, so the baked skin texture no longer carries hair pixels — the hair IS the
 * `openclinxr_mesh_native_scalp_hair_surface` primitive on the body mesh. The subject of the
 * original asymmetry defect (the #341 round-14 stage census measured the per-polygon region
 * SYMMETRIC at 105/105 while the BAKE mis-assigned 464/256) therefore moves to the region
 * primitive itself: its dome verts per side. The clauses are unchanged in intent — (1) balance,
 * (2) hair not removed from one side, (3) the head not saturated (the face band stays clear) —
 * but the sampled subject is now the shipped region, not a texture that no longer exists.
 */

/**
 * ## RE-PREMISED (#393) — the measurable-scalp population is the figures WITHOUT fitted hair
 *
 * #387 retired aisha's placeholder scalp paint where #381's fitted hair replaced it
 * (`body_param_stage.scalp_placeholder_retired_for`): measured on the shipped bytes she now
 * carries 4,976 tris of weighted fitted hair and NO scalp region. This file's enumeration
 * scans every shipped `mpfb-*.glb`, so `measure()` returns null for aisha — and the old
 * vacuity guard ("at least 3 measurable scalps of 3 scanned") fired on every clause, which
 * is why all three failed through the guard rather than on their own measurements.
 *
 * The re-premise matches the shape #387 already applied in `mpfb-scalp-hair-region.test.ts`
 * and `hairline-is-a-line-not-a-sawtooth.test.ts`:
 *
 * - The population this contract governs is the figures that STILL carry the region: the
 *   nurse and the child (no fitted hair). Both must remain measurable by name, so the guard
 *   cannot pass on an empty enumeration.
 * - The retired figure (aisha) gains an explicit assertion: her body must NOT carry a
 *   measurable scalp region, so the placeholder cannot silently come back under the fitted
 *   hair.
 * - No threshold changed. The old count floor (3 of 3) encoded "every MPFB actor carries
 *   the region", which #387 re-premised; the balance bound, the side-removal floor, and the
 *   face-band exclusion below are unchanged and asserted on every measurable row.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** Measured ambient (texture era) was 29.7–35.7 points. The region predicate is X-symmetric by
 * construction (|x| bands), so a balanced region sits in single digits. */
const MAX_ASYMMETRY_POINTS = 12;

/** Below this many scalp dome verts on a side, hair has been removed from that side. */
const MIN_SIDE_DOME_VERTS = 50;

type Row = { file: string; leftPct: number; rightPct: number; asym: number; n: number; faceBandVerts: number };

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const meshes = doc.getRoot().listMeshes();
  const body = meshes.find((m) => m.listPrimitives().some((p) => /scalp_hair/i.test(p.getMaterial()?.getName() ?? "")))
    ?? meshes.find((m) => /_body$/.test(m.getName() ?? ""));
  if (!body) return null;
  const scalp = body.listPrimitives().find((p) => /scalp_hair/i.test(p.getMaterial()?.getName() ?? ""));
  const pos = scalp?.getAttribute("POSITION");
  if (!pos) return null;

  // Body bounds for the face band: the contract's own geometry (front-32% depth line).
  let lo = Infinity;
  let hi = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mat?.getAlphaMode() === "MASK" && (mat?.getBaseColorFactor()?.[3] ?? 1) === 0) continue;
      const q = prim.getAttribute("POSITION");
      if (!q) continue;
      for (let i = 0; i < q.getCount(); i++) {
        const v = q.getElement(i, [0, 0, 0]) as number[];
        if (v[1]! < lo) lo = v[1]!;
        if (v[1]! > hi) hi = v[1]!;
        if (v[2]! < zMin) zMin = v[2]!;
        if (v[2]! > zMax) zMax = v[2]!;
      }
    }
  }
  const H = hi - lo;
  const faceBandFrontZ = (zMin + zMax) / 2 + 0.18 * (zMax - zMin);

  let left = 0;
  let right = 0;
  let faceBandVerts = 0;
  for (let i = 0; i < pos.getCount(); i++) {
    const p = pos.getElement(i, [0, 0, 0]) as number[];
    const heightFraction = (p[1]! - lo) / H;
    if (heightFraction < 0.94) continue;
    if (p[2]! >= faceBandFrontZ && heightFraction >= 0.82 && heightFraction <= 0.93) faceBandVerts++;
    if (Math.abs(p[0]!) <= 0.005) continue;
    if (p[0]! < 0) left++;
    else right++;
  }
  if (left + right < 40) return null;
  const leftPct = (left / (left + right)) * 100;
  const rightPct = 100 - leftPct;
  return {
    file: rel.split("/").pop()!,
    leftPct,
    rightPct,
    asym: Math.abs(leftPct - rightPct),
    n: left + right,
    faceBandVerts,
  };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** No remaining painted-scalp MPFB figure after kevin-mhair02. */
const REGION_FIGURES = [] as const;

/** #393/#399/kevin-mhair02 — shipped base ids whose placeholder scalp paint is retired. */
const RETIRED_FIGURES = new Set([
  "mpfb-ob-patient-aisha.glb",
  "mpfb-peds-patient-child.glb",
  "mpfb-peds-parent-aisha.glb",
  "mpfb-peds-nurse-kevin.glb",
]);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  // #393 re-premise (#387's shape): aisha's placeholder is retired where #381's fitted hair
  // replaced it, so `measure` returns null for her and she is absent from `rows`. #399 retires
  // the child's paint with her fitted hair (toigo_curled_under_bob_with_bangs, CC0). The guard
  // still refuses an empty enumeration — every remaining region-carrying figure is required by
  // name, and the retired figures must NOT be measurable.
  const measured = new Set(rows.map((r) => r.file));
  expect(
    REGION_FIGURES.length,
    "no remaining painted-scalp MPFB figure after kevin-mhair02",
  ).toBe(0);
  const leftover = [...measured].filter((f) => !RETIRED_FIGURES.has(f));
  expect(leftover, "unclassified MPFB figure still carrying a measurable scalp region").toEqual([]);
  const stale = [...RETIRED_FIGURES].filter((f) => measured.has(f));
  expect(stale, `placeholder not retired: ${[...RETIRED_FIGURES].join(", ")}`).toEqual([]);
}

const show = (r: Row): string =>
  `${r.file}: left=${r.leftPct.toFixed(1)}% right=${r.rightPct.toFixed(1)}% asym=${r.asym.toFixed(1)}pts n=${r.n}`;

describe("the scalp region covers both sides of the head", () => {
  it("(1) RED: no remaining painted-scalp MPFB figure (last region retired with mhair02)", () => {
    // The coverage RED's subject was the last painted scalp. After kevin-mhair02 that
    // subject is gone — asserting balance on an empty row set would be vacuous (§7t).
    requireRows();
    expect(rows, "measurable painted-scalp MPFB figures remaining").toEqual([]);
  });

  it("(2) NET: no remaining painted-scalp MPFB figure to thin-out", () => {
    requireRows();
    expect(rows, "measurable painted-scalp MPFB figures remaining").toEqual([]);
  });

  it("(3) NET: no remaining painted-scalp MPFB figure to saturate the face band", () => {
    requireRows();
    expect(rows, "measurable painted-scalp MPFB figures remaining").toEqual([]);
  });
});

/**
 * ## FIXED (#341 round 14)
 *
 * The asymmetry was NOT in the hair region definition — it was in the TEXTURE
 * below it. Measured per stage on the shipped bytes and in-bake:
 *
 *   stage                                   | aisha L/R dome coverage | verdict
 *   ----------------------------------------|------------------------|--------
 *   per-polygon scalp region (census)       | 105/105 scalp polys    | SYMMETRIC
 *   Cycles mask bake (region -> texels)     | 464/256 loops white    | bake mis-assigns the
 *                                           |                        | right crown (basemesh UV
 *                                           |                        | island overlap)
 *   corner splat + UV-scale dilation        | 376/376                | symmetric but leaves
 *                                           |                        | BLACK HOLES: the skin bake
 *                                           |                        | skips the scalp-material
 *                                           |                        | polys, so their UV
 *                                           |                        | triangles are (0,0,0)
 *   rasterized scalp UV triangles + skin    | 328/328 hair,          | SYMMETRIC, no holes
 *   bake covering the scalp polys           | 328/328 dark           |
 *
 * The composite mask is now the scalp region RASTERIZED from the mesh (full
 * UV-triangle coverage, immune to the bake's UV-overlap artifact), and the skin
 * bake temporarily reassigns the scalp polys to the skin material (restored
 * afterwards) so the head bakes skin colour and no black holes remain. The
 * hairline stays the round-5 derived level set in the face band; the per-polygon
 * scalp material is still retired (scalpPrims=0).
 *
 * Measured from the promoted bytes (this contract's sampling): aisha 58.6/58.6
 * (0.0 pts), nurse 67.0/65.7 (1.3 pts), child 61.5/59.0 (2.5 pts) — all under the
 * 12-point bar, both sides above the 25% floor, neither above the 97% cap.
 *
 * ## FIXED (#399) — the child's scalp region retires with her fitted hair
 *
 * #399 opened the child with her OWN licence-clean fitted style
 * (`toigo_curled_under_bob_with_bangs`, CC0, through the SAME `ClothesService` fit
 * path #381 proved), so her placeholder scalp paint is retired via
 * `body_param_stage.scalp_placeholder_retired_for` exactly like aisha's. The nurse
 * remains the only actor without a hair asset (every licence-clean style in the
 * usable makehuman-hair01 subset is a feminine bob), so `REGION_FIGURES` now names
 * him alone and both retired figures must be unmeasurable.
 *
 * ## FIXED (kevin-mhair02) — the last painted-scalp MPFB figure retires
 *
 * Kevin now wears `mhair02` (page CC0 / header AGPL3, this uuid only). The
 * placeholder retires with the rest of the MPFB cast. `REGION_FIGURES` is empty;
 * every shipped `mpfb-*.glb` is in `RETIRED_FIGURES`. The coverage RED becomes
 * "no remaining painted-scalp MPFB figure" rather than an empty-row vacuous pass.
 * hair01's usable subset is still mostly toigo bobs plus culturalibre_hair_06;
 * that is not the kevin skip.
 */

