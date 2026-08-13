import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Every MPFB actor has a jagged black sawtooth across the forehead. It survives seven #341 rounds,
 * it is on 3 of 3 actors, and it is on the most-looked-at part of a clinical figure.
 *
 * It is NOT the seam-fringe class #341 round 7 fixed. That was discarded alpha-0 hide polygons
 * showing background where no garment covered them (`f1880fe1`). The scalp is not hidden and not a
 * garment: it is a rendering primitive of the body mesh carrying its own material, and the hairline
 * is the boundary between that primitive and the skin primitive.
 *
 * MEASURED 2026-08-12 on the landed GLBs, and the FIRST metric I tried was the wrong one — recorded
 * because the next person will reach for it too:
 *
 *   forehead seam Y      aisha            kevin            child
 *   -----------------    -------------    -------------    -------------
 *   mean                 0.9319 H         0.9397 H         0.9289 H
 *   sd                   30.9 mm          39.3 mm          28.0 mm
 *   span                 147.6 mm         156.4 mm         113.0 mm
 *
 * Span and sd CANNOT distinguish a ragged hairline from a smoothly curved one — a hairline that
 * sweeps up at the temples legitimately spans centimetres. Bounding the spread would have been the
 * §11s error a third time this week: bounding a QUANTITY when the defect lives in the SHAPE.
 *
 * The signature of a sawtooth is ALTERNATION. Sorting the central-forehead seam vertices by X and
 * counting sign changes in successive dY:
 *
 *   central forehead     aisha            kevin            child
 *   -----------------    -------------    -------------    -------------
 *   seam vertices        57               37               59
 *   direction flips      37 / 55 steps    21 / 35 steps    31 / 57 steps
 *   FLIP RATE            67%              60%              54%
 *   median |dY| step     27.3 mm          6.9 mm           14.9 mm
 *
 * A smooth arc flips direction 0–10% of steps (once or twice, at its extrema). 54–67% is a boundary
 * alternating up and down almost every polygon — the per-polygon material assignment following
 * triangle edges, which is what the pixels show.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                    | (1) not ragged | (2) hairline stays put | (3) scalp survives | result
 *   ---------------------------------------------|----------------|------------------------|--------------------|--------
 *   a) today — per-polygon assignment            |   **FAIL**     |         pass           |       pass         | REFUSED
 *   b) raise every seam vertex to the max         |     pass       |       **FAIL**         |       pass         | REFUSED
 *   c) shrink the scalp above the visible brow    |     pass       |       **FAIL**         |       pass         | REFUSED
 *   d) drop the scalp region entirely             |     pass       |       **FAIL**         |     **FAIL**       | REFUSED
 *   e) a boundary that follows a smooth curve     |     pass       |         pass           |       pass         | ALL PASS
 *
 * (b) and (c) are the two to worry about: both flatten the flip rate to ~0 and both do it by MOVING
 * the hairline, which #341 round 5 derived from the body's own surface ("the highest face-front
 * vertex still at or ahead of the forehead plane") after establishing that the shipped anatomy has
 * no hairline reference at all. That derivation is the known-good column and must survive; a fix
 * that smooths the line by relocating it has thrown away the only anatomy we have.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails on all three today. (2) and (3)
 * PASS today and are regression nets, not evidence of a defect.
 *
 * NOT TESTED, and this is the scope statement:
 *   - No pixel is graded here. This asserts the SEAM GEOMETRY only. A hairline can be numerically
 *     smooth and still read wrong — wrong shape, wrong height for the face, wrong for a child.
 *   - Nothing is claimed about the OTHER open defects on these figures: mitten shards on the hands,
 *     the ragged waistband and trouser hems, or the child wearing its shirt on adult bands (#332).
 *     They are not shown to share this cause.
 *   - The flip-rate threshold bounds ALTERNATION, not amplitude. A finer zigzag with the same flip
 *     rate still fails, which is intended; a smooth curve with large amplitude passes, which is also
 *     intended, because that is a hairline shape question and not this contract's.
 *
 * ## SUPERSEDED 2026-08-13 — THE SUBJECT OF THIS CONTRACT NO LONGER EXISTS
 *
 * Everything above is a true record of a defect that was real when measured. It is retained because
 * the flip-rate METHOD it introduced is still in use (#355 applied it to the garment-boundary
 * frontier), and because the numbers are the only calibration anyone has for "what a per-polygon
 * sawtooth measures".
 *
 * **But #341 rounds 11-16 retired the scalp primitive.** The hairline moved into the baked skin
 * texture, so `scalpPrims = 0` on all three shipped actors and there is no scalp/skin seam left to
 * walk. Measured 2026-08-13: 0 scalp primitives, 0 hair meshes, 0 hair triangles; hair exists only as
 * dark pixels in the 615-648 KB skin texture (#296).
 *
 * **THE STATE THIS LEFT WAS WORSE THAN A RED.** `measure()` returned null for every actor, `rows` was
 * empty, and the vacuity guard threw — so clauses (2) and (3) failed on main (for an unknown number of
 * cycles), while clause (1), being `it.fails`, **"passed" by throwing**. An `it.fails` test is
 * satisfied when the body fails for ANY reason, including measuring nothing at all. A RED that is
 * green because its subject was deleted is the most misleading artifact this repo can hold: it reads
 * as a defect still being watched.
 *
 * It also made every `done_when` that referenced this file unpassable. That cost a real slice — #355's
 * contract gated on it and was refused at integrate, and the work had to be cherry-picked.
 *
 * ## WHAT REPLACES IT (§6p: a contract that removes something must say what takes over)
 *
 * The clauses below now gate the design that actually shipped: the scalp is retired and the hairline
 * is baked into the skin texture. That is a NET over the current mechanism, not a weakening — the old
 * clauses could not fail meaningfully, and these can.
 *
 * What is NOT covered, and is the honest gap: **nothing here measures whether the painted hairline
 * looks right.** It does not. Graded on #354's 1024 px eye crops, the mask is a hard, pixel-stair-
 * stepped boundary that clips aisha's brow and runs onto Kevin's cheek. Quantifying that needs a
 * texture-space measurement (the render-space attempts failed twice — in a lit render "dark" is also
 * pupils, lashes and shadow), and it belongs to #296.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** The baked hairline lives in the skin texture; below this it is not a real bake. */
const MIN_SKIN_TEXTURE_KB = 200;

type Row = { file: string; scalpPrims: number; hairMeshes: number; skinTextureKb: number };

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  let scalpPrims = 0;
  let hairMeshes = 0;
  let skinTextureKb = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = `${mesh.getName()}/${prim.getMaterial()?.getName() ?? ""}`;
      if (/scalp/i.test(name)) scalpPrims++;
      if (/hair/i.test(name)) hairMeshes++;
      if (/skin/i.test(name)) {
        const img = prim.getMaterial()?.getBaseColorTexture()?.getImage();
        if (img) skinTextureKb = Math.max(skinTextureKb, img.length / 1024);
      }
    }
  }
  return { file: rel.split("/").pop()!, scalpPrims, hairMeshes, skinTextureKb };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t) — the trap this file just fell into. */
function requireRows(): void {
  expect(rows.length, `MPFB bodies scanned (of ${files.length})`).toBeGreaterThanOrEqual(3);
}

describe("the hairline is baked into the skin texture (scalp retired)", () => {
  it("(1) the scalp primitive stays retired", () => {
    // #341 rounds 11-16 replaced the scalp/skin seam with a texture hairline. A scalp reappearing
    // means a re-bake regressed to the old mechanism, and the sawtooth measured above comes back.
    requireRows();
    const back = rows
      .filter((r) => r.scalpPrims > 0)
      .map((r) => `${r.file}: scalpPrims=${r.scalpPrims}`);
    expect(back, "bodies where the scalp primitive returned").toEqual([]);
  });

  it("(2) the skin texture that carries the hairline is present and non-trivial", () => {
    // With the scalp gone this texture is the ONLY thing drawing hair. If it vanishes the actors go
    // bald, and no other contract would notice.
    requireRows();
    const missing = rows
      .filter((r) => r.skinTextureKb < MIN_SKIN_TEXTURE_KB)
      .map((r) => `${r.file}: skinTexture=${r.skinTextureKb.toFixed(0)}KB`);
    expect(missing, `bodies whose skin texture is under ${MIN_SKIN_TEXTURE_KB} KB`).toEqual([]);
  });

  it("(3) no hair GEOMETRY has appeared without updating this contract", () => {
    // Not a defect either way — #296 tracks acquiring real hair assets. This is a tripwire: if hair
    // geometry lands, the texture-hairline assumption above stops being the mechanism and these
    // clauses must be rewritten rather than silently continuing to pass.
    requireRows();
    const geo = rows.filter((r) => r.hairMeshes > 0).map((r) => `${r.file}: hairMeshes=${r.hairMeshes}`);
    expect(geo, "bodies carrying hair geometry (see #296 — rewrite this contract if so)").toEqual([]);
  });
});
