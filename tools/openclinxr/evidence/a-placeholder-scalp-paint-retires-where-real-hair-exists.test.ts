import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **`openclinxr_mesh_native_scalp_hair_surface` is a self-declared placeholder, and it now ships on
 * three graded figures — including the one that has real fitted hair on top of it.**
 *
 * Its own docstring (`automate_blender.py:4245`) says what it is:
 *
 *   > "only assigns a material to scalp-like polygons so isolated review can evaluate whether
 *   > removing the bald mannequin read is useful **before a real groom/hair-card source stage
 *   > exists**"
 *
 * That stage now exists. #381 fitted `toigo_blunt_bob_with_bangs` to aisha from the MakeClothes
 * library rail — 4,976 tris, top at 101.3% of stature. **The placeholder was not retired when its
 * replacement landed**, so aisha carries both.
 *
 * ## MEASURED 2026-08-14, per primitive on the shipped bytes
 *
 *   figure  | textured head verts | placeholder scalp verts | placeholder share | fitted hair
 *   --------|--------------------:|------------------------:|------------------:|------------
 *   nurse   |               2,886 |                   1,506 |               34% | none
 *   child   |               2,503 |                   1,234 |               33% | none
 *   **aisha** |             2,220 |               **1,373** |           **38%** | **YES**
 *
 * Luminance either side of the boundary: skin atlas 27.7 / 36.8 / 32.5%, placeholder a flat 2.8%
 * with no texture — a **9.9x / 13.1x / 11.6x** step, painted per-polygon with no blend. At a 4096
 * grade that reads as a hard stair-stepped edge across the fringe, the cheeks and the jaw.
 *
 * ## WHY AISHA IS THE ONLY FIGURE THIS CONTRACT TOUCHES
 *
 * She is the only one whose replacement is already on disk. Removing the placeholder from the nurse
 * or the child would leave a bald skin head with no hair signal at all — a different regression that
 * needs a hair asset acquired and chosen per character, which is appearance and not an implementer's
 * decision (SS8d / SS8y). Clause (3) pins that boundary so this slice cannot quietly grow into it.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                            | (1) retired | (2) hair kept | (3) scoped | result
 *   ------------------------------------------------------|-------------|---------------|------------|--------
 *   a) today — aisha carries both                        |  **FAIL**   |     pass      |    pass    | REFUSED
 *   b) delete aisha's fitted hair instead of the paint   |    pass     |   **FAIL**    |    pass    | REFUSED
 *   c) strip the paint from every figure                 |    pass     |     pass      |  **FAIL**  | REFUSED
 *   d) drop the paint only where fitted hair exists      |    pass     |     pass      |    pass    | ALL PASS
 *
 * **(b) is the one to watch and it is why clause (2) exists.** Both meshes are "hair"; deleting the
 * 4,976-tri library asset satisfies (1) as cheaply as deleting the paint, and throws away the proven
 * tool D1 exists to protect.
 *
 * **(c) is why clause (3) exists.** Stripping the placeholder everywhere greens (1) and makes two
 * figures worse — bald skin heads — while looking like a tidier fix.
 *
 * **The vacated polygons must render as SKIN, not as a hole** (SS6p: a contract that removes something
 * says what takes over). Clause (1) asserts that too, so "delete the material and leave the polygons
 * unassigned" cannot pass.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the sole RED and fails today on aisha. (2) and (3)
 * pass today. They are independent of what (1) measures — retiring a paint region cannot delete a
 * fitted garment mesh or reach figures it does not name unless done by (b) or (c).
 *
 * NOT TESTED:
 *   - **That removing the paint smooths aisha's boundary.** The 4096 grade shows the step; nobody has
 *     re-graded her without the placeholder, and the skin/hair edge may simply move rather than soften.
 *   - **The nurse and the child.** They keep the placeholder by construction here. Their fix needs a
 *     hair asset per character and a licence check; `makehuman-hair01` is already recorded MIXED.
 *   - **Whether the placeholder helps at all on a bald figure.** Its own docstring frames that as an
 *     open review question and it has never been answered.
 *   - **The Anny rail.** Only the three MPFB bodies are read; `automate_blender.py` paints Anny figures
 *     through the same function and nothing here speaks to them.
 *
 * ## FIXED (#399) — the child's placeholder retires with her fitted hair
 *
 * #399 is the MADR 0052 P3 advancement hour: the child (`mpfb-peds-patient-child`) now wears her
 * OWN licence-clean fitted style, `toigo_curled_under_bob_with_bangs` (CC0, zero helper-vertex
 * refs), through the SAME `ClothesService` fit path #381 proved. Her placeholder scalp paint is
 * therefore retired via `body_param_stage.scalp_placeholder_retired_for` — exactly this contract's
 * own rule (the placeholder retires where a real fitted replacement is on disk). The nurse is
 * untouched: he has no licence-clean hair asset (every usable style is a feminine bob), so his
 * placeholder stays. Measured post-bake: child placeholder scalp verts 0 (was 1,234) with 4,976
 * tris of fitted hair; kevin 1,506 placeholder verts, 0 hair tris (unchanged).
 *
 * ## FIXED (kevin-mhair02) — the nurse's placeholder retires with mhair02
 *
 * Kevin now wears the named page-CC0 / header-AGPL3 override (`mhair02`, uuid
 * `f81a4e9a-e3d7-4ecb-bdf0-16d7fd9070a4`). Clause (3) flips: there is no remaining
 * MPFB cast figure without a hair asset, so the placeholder retires on kevin too
 * (same `scalp_placeholder_retired_for` registry). hair01's usable subset is still
 * mostly toigo bobs plus culturalibre_hair_06; that is not why kevin was skipped.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const HUMANOIDS = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
/** Overridable so a destructive probe can point the same logic at doctored assets. */
const ASSET_DIR = process.env.OPENCLINXR_SCALP_PROBE_DIR ?? HUMANOIDS;

const PLACEHOLDER = /native_scalp_hair_surface/u;
const FITTED_HAIR = /fitted_hair|_hair_toigo|hair_.*bob/u;
const SKIN = /skin/u;

/** The figure whose replacement already shipped (#381). */
const HAS_REAL_HAIR = "mpfb-ob-patient-aisha";
/** Kevin now has fitted mhair02 — clause (3) asserts his placeholder retired too. */
const NURSE = "mpfb-peds-nurse-kevin";

type Figure = {
  id: string;
  placeholderVerts: number;
  fittedHairTris: number;
  headSkinVerts: number;
};

async function readFigure(id: string): Promise<Figure | null> {
  const path = join(ASSET_DIR, `${id}.glb`);
  if (!existsSync(path)) return null;
  const doc = await new NodeIO().readBinary(readFileSync(path));
  const root = doc.getRoot();
  let bLo = Infinity, bHi = -Infinity;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const a = p.getAttribute("POSITION")?.getArray(); if (!a) continue;
    for (let i = 1; i < a.length; i += 3) { if (a[i]! < bLo) bLo = a[i]!; if (a[i]! > bHi) bHi = a[i]!; }
  }
  const H = bHi - bLo || 1;
  let placeholderVerts = 0, fittedHairTris = 0, headSkinVerts = 0;
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      const mat = p.getMaterial()?.getName() ?? "";
      const pos = p.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      const verts = pos.length / 3;
      const tris = Math.round((p.getIndices()?.getCount() ?? pos.length / 3) / 3);
      if (PLACEHOLDER.test(mat)) placeholderVerts += verts;
      else if (FITTED_HAIR.test(mat) || FITTED_HAIR.test(m.getName())) fittedHairTris += tris;
      else if (SKIN.test(mat)) {
        for (let i = 0; i < pos.length; i += 3) if ((pos[i + 1]! - bLo) / H > 0.88) headSkinVerts += 1;
      }
    }
  }
  return { id, placeholderVerts, fittedHairTris, headSkinVerts };
}

const aisha = await readFigure(HAS_REAL_HAIR);
const nurse = await readFigure(NURSE);

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(aisha, `${HAS_REAL_HAIR}.glb readable under ${ASSET_DIR}`).not.toBeNull();
  expect(nurse, `${NURSE}.glb readable under ${ASSET_DIR}`).not.toBeNull();
}

describe("a placeholder scalp paint retires where real hair exists", () => {
  it("(1) RED: no figure carries the placeholder paint AND a real fitted hair mesh", () => {
    requireMeasured();
    expect(
      aisha!.fittedHairTris,
      `${HAS_REAL_HAIR} must still carry its #381 library hair for this clause to mean anything`,
    ).toBeGreaterThan(1000);
    expect(
      aisha!.placeholderVerts,
      `${HAS_REAL_HAIR} carries ${aisha!.placeholderVerts} placeholder scalp verts UNDER ${aisha!.fittedHairTris} tris of real fitted hair — the placeholder was not retired when its replacement landed`,
    ).toBe(0);
    // SS6p: what replaces it must render as skin, not as nothing.
    expect(
      aisha!.headSkinVerts,
      `${HAS_REAL_HAIR} head must still be covered by the skin material after the paint is retired`,
    ).toBeGreaterThan(1500);
  });

  it("(2) COUNTERWEIGHT: the real fitted hair is not deleted instead of the paint", () => {
    // Refuses (b): both meshes are "hair". Deleting the 4,976-tri library asset satisfies (1) exactly
    // as cheaply as deleting the paint, and discards the proven tool (D1).
    requireMeasured();
    expect(
      aisha!.fittedHairTris,
      `${HAS_REAL_HAIR} fitted library hair triangles (4,976 measured 2026-08-14, #381)`,
    ).toBeGreaterThan(1000);
  });

  it("(3) the nurse's placeholder retires with mhair02 — no remaining painted-only MPFB cast figure", () => {
    // Flipped from the recorded skip. This contract's own rule: the placeholder retires
    // where a real fitted replacement is on disk. Kevin now has one (mhair02).
    requireMeasured();
    expect(
      nurse!.fittedHairTris,
      `${NURSE} fitted mhair02 geometry (page CC0 / header AGPL3, this uuid only)`,
    ).toBeGreaterThan(1000);
    expect(
      nurse!.placeholderVerts,
      `${NURSE} placeholder scalp paint retired under mhair02`,
    ).toBe(0);
  });
});
