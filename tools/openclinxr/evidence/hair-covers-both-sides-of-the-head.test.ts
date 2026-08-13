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
  return {
    file: rel.split("/").pop()!,
    leftPct,
    rightPct: 100 - leftPct,
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

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `MPFB bodies with a measurable baked scalp (scanned ${files.length})`)
    .toBeGreaterThanOrEqual(3);
}

const show = (r: Row): string =>
  `${r.file}: left=${r.leftPct.toFixed(1)}% right=${r.rightPct.toFixed(1)}% asym=${r.asym.toFixed(1)}pts n=${r.n}`;

describe("the scalp region covers both sides of the head", () => {
  it("(1) RED: left/right scalp dome coverage is balanced", () => {
    // The region predicate is X-symmetric (|x| bands, symmetric depth lines), so the shipped
    // region must sit in single digits — the #341 round-14 asymmetry was a BAKE artifact, not the
    // region; with the texture route gone, the region primitive is the whole subject.
    requireRows();
    expect(
      rows.filter((r) => r.asym > MAX_ASYMMETRY_POINTS).map(show),
      `scalps whose sides differ by more than ${MAX_ASYMMETRY_POINTS} points`,
    ).toEqual([]);
  });

  it("(2) NET known-good: hair is not REMOVED from one side to make the ratio symmetric", () => {
    requireRows();
    // The smaller side's scalp dome vert count must stay above the floor: a "fix" that
    // clears (1) by deleting one side's region would sink it.
    const thin = rows
      .filter((r) => (Math.min(r.leftPct, 100 - r.leftPct) / 100) * r.n < MIN_SIDE_DOME_VERTS)
      .map(show);
    expect(thin, `sides below ${MIN_SIDE_DOME_VERTS} scalp dome verts`).toEqual([]);
  });

  it("(3) NET known-good: the head is not SATURATED — the face band stays clear", () => {
    // A region that covers the whole head has no hairline and reaches the face. The #282 face
    // band (0.82-0.93 H at the front-32% depth line) must contain zero scalp verts.
    requireRows();
    const saturated = rows
      .filter((r) => r.faceBandVerts > 0)
      .map((r) => `${r.file}: faceBandVerts=${r.faceBandVerts}`);
    expect(saturated, `scalps reaching the front mid-face band`).toEqual([]);
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
 */

