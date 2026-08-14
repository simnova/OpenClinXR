import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **The paediatric patient is the last MPFB actor still wearing the placeholder scalp paint, and she
 * is the only one left whose fix is neither blocked nor already done.**
 *
 * MADR 0052 P3: *"Hair therefore joins P3 rather than becoming its own phase, and lands in an
 * advancement hour after the first garment is fitted to a solved MPFB body."* The first garment was
 * fitted under #199. This is that hour.
 *
 * ## MEASURED 2026-08-14 11:0x, per primitive on the shipped bytes
 *
 *   actor                       fitted hair   placeholder scalp verts
 *   --------------------------  -----------   -----------------------
 *   mpfb-ob-patient-aisha         4,976 tris                        0   <- #381 did this
 *   mpfb-peds-nurse-kevin                 0                     1,506   <- RECORDED LICENCE SKIP
 *   mpfb-peds-patient-child               0                     1,234   <- this slice
 *
 * The placeholder is `openclinxr_mesh_native_scalp_hair_surface`, a flat 2.8%-luminance per-polygon
 * paint against a 27–37% skin atlas — a 10x step with no blend, which #387 measured reading as a hard
 * stair-stepped edge across the fringe, cheeks and jaw. On the 09:2x station capture it reads as
 * facial damage.
 *
 * ## THE LEVER IS ONE MAP ENTRY, AND THE FITTER IS ALREADY PROVEN (D1)
 *
 * `materialize_mpfb_humanoid_candidate.py:44`:
 *
 *   HAIR_STYLE_BY_REFERENCE = {
 *       None: "toigo_blunt_bob_with_bangs",
 *       "peds_nurse_kevin":   None,     # recorded MALE SKIP — licence, see below
 *       "peds_patient_child": None,     # "out of slice-1 scope" — NOT blocked
 *   }
 *
 * Kevin's `None` and the child's `None` mean different things and the comment says so. **Do not
 * collapse them.** The same file already runs the whole path for aisha: `ClothesService` fit before
 * the #318 helper strip, k-NN weight to the standard rig's `head` bone, and a bake-time licence
 * re-read via `read_hair_mhclo_licence` (`:300`) that refuses the bake on AGPL/unspecified.
 *
 * ## THE LICENCE SUBSET IS NOT WHAT MADR 0052 SAYS — READ THIS BEFORE TOUCHING THE PACK
 *
 * MADR 0052 P3 still says *"hair01 — 26 hairstyles, CC0 1.0"*. **That is a pack-page claim and #330
 * corrected it by reading all 25 `.mhclo` headers.** From
 * `.openclinxr/evidence/issue-330/hair-licence-classification.json`:
 *
 *   total 25 | usable 9 | refusedCopyleft 10 | refusedUnlicensed 4 | refusedTopology 2
 *
 * **Ten are AGPL3 — a hard refusal.** `DO NOT GLOB THE PACK.` The attribution-free usable set is the
 * six `toigo_*` bobs (CC0, zero helper-vertex refs); `culturalibre_hair_06` is CC-0 and
 * `elvs_reverse_french_braid_bun` / `o4saken_long01` are CC-BY and carry an attribution obligation
 * that must survive into a shipped build.
 *
 * **Kevin stays skipped and that is a licence fact, not a preference:** every licence-clean style in
 * the usable subset is a feminine bob, so there is no clean masculine style to give him. Clause (3)
 * pins that. A bob on the male nurse would be a realism regression traded for a licence-clean tick.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) child | (2) aisha | (3) kevin | (4) distinct | result
 *   ----------------------------------------------------|-----------|-----------|-----------|--------------|--------
 *   a) today                                           | **FAIL**  |   pass    |   pass    |   **FAIL**   | REFUSED
 *   b) strip the child's paint, add no hair            | **FAIL**  |   pass    |   pass    |   **FAIL**   | REFUSED
 *   c) give the child aisha's exact style              |   pass    |   pass    |   pass    |   **FAIL**   | REFUSED
 *   d) glob the pack / give kevin a bob too            |   pass    |   pass    | **FAIL**  |     pass     | REFUSED
 *   e) one different licence-clean toigo style, child  |   pass    |   pass    |   pass    |     pass     | ALL PASS
 *
 * **(c) is the one to watch and it is why clause (4) exists.** Reusing `toigo_blunt_bob_with_bangs`
 * is the cheapest possible green — the style is already wired as the default — and it puts the child
 * and her own parent side by side in identical hair, which is #388's defect arriving through a new
 * door. The two stand together in `peds_asthma_parent_anxiety_v1`.
 *
 * **(d) is why clause (3) exists.** Globbing the pack ships ten AGPL3 assets on the ledger's own
 * authority, and the only way to give Kevin hair from this pack is to break either the licence gate
 * or the realism call.
 *
 * **§6p — what replaces the paint must render as skin, not as a hole.** Clause (1) asserts the head
 * is still covered by the skin material after the placeholder is retired.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) and (4) are REDs** — the child has no hair today,
 * so both fail. **(2) and (3) are true nets and PASS today**: aisha carries her #381 hair and Kevin
 * carries his placeholder with no hair, and neither reads the surface this slice creates. Verified
 * 2026-08-14 by symlink probe: swapping the child's GLB in for aisha's reds (2), and aisha's in for
 * Kevin's reds (3).
 *
 * NOT TESTED:
 *   - **That the child's hair looks right.** Geometry and licence only. Whether a curled-under bob
 *     suits a school-age asthma patient is a pixel grade the orchestrator owes after the bake.
 *   - **Kevin.** He keeps the placeholder by construction. His fix needs a licence-clean masculine
 *     style that does not exist in this pack — a procurement question, not an implementer's.
 *   - **Whether retiring the paint smooths the child's boundary.** #387 recorded the same residual
 *     for aisha and nobody has re-graded her; the skin/hair edge may move rather than soften.
 *   - **The Anny rail.** Only the three MPFB bodies are read.
 *   - **Attribution plumbing.** If a CC-BY style is chosen instead of a `toigo_*`, nothing here
 *     checks that the attribution reaches a shipped build.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
/** Overridable so a destructive probe can point the same logic at doctored assets. */
const ASSET_DIR = process.env.OPENCLINXR_HAIR_PROBE_DIR ?? join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

const PLACEHOLDER = /native_scalp_hair_surface/u;
const SKIN = /^mpfb_skin/u;

const CHILD = "mpfb-peds-patient-child";
const PARENT = "mpfb-ob-patient-aisha";
/** Recorded male licence skip — no licence-clean masculine style exists in makehuman-hair01. */
const NURSE = "mpfb-peds-nurse-kevin";

/** #330's attribution-free usable subset. A style outside this set is a licence refusal. */
const LICENCE_CLEAN_STYLES = [
  "toigo_blunt_bob",
  "toigo_blunt_bob_with_bangs",
  "toigo_curled_under_bob",
  "toigo_curled_under_bob_with_bangs",
  "toigo_inverted_bob",
  "toigo_inverted_bob_with_bangs",
] as const;

/** aisha's #381 hair measures 4,976 tris; a real fitted bob is thousands, a stub is not. */
const MIN_HAIR_TRIS = 1000;
/** aisha's head carries >1500 skin verts above 88% stature; the child is smaller but comparable. */
const MIN_HEAD_SKIN_VERTS = 800;

type Figure = { id: string; hairTris: number; hairStyle: string | null; placeholderVerts: number; headSkinVerts: number };

async function readFigure(id: string): Promise<Figure | null> {
  const path = join(ASSET_DIR, `${id}.glb`);
  if (!existsSync(path)) return null;
  const doc = await new NodeIO().readBinary(readFileSync(path));
  const root = doc.getRoot();
  let bLo = Infinity;
  let bHi = -Infinity;
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      const a = p.getAttribute("POSITION")?.getArray();
      if (!a) continue;
      for (let i = 1; i < a.length; i += 3) {
        if (a[i]! < bLo) bLo = a[i]!;
        if (a[i]! > bHi) bHi = a[i]!;
      }
    }
  }
  const H = bHi - bLo || 1;
  let hairTris = 0;
  let hairStyle: string | null = null;
  let placeholderVerts = 0;
  let headSkinVerts = 0;
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      const matName = p.getMaterial()?.getName() ?? "";
      const meshName = m.getName();
      const pos = p.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      if (PLACEHOLDER.test(matName)) {
        placeholderVerts += pos.length / 3;
        continue;
      }
      if (/hair/iu.test(meshName)) {
        hairTris += Math.round((p.getIndices()?.getCount() ?? 0) / 3);
        const style = /library_hair_(.+?)_mpfb_/u.exec(meshName);
        if (style && !hairStyle) hairStyle = style[1]!;
        continue;
      }
      if (SKIN.test(matName)) {
        for (let i = 0; i < pos.length; i += 3) if ((pos[i + 1]! - bLo) / H > 0.88) headSkinVerts += 1;
      }
    }
  }
  return { id, hairTris, hairStyle, placeholderVerts, headSkinVerts };
}

const child = await readFigure(CHILD);
const parent = await readFigure(PARENT);
const nurse = await readFigure(NURSE);

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(child, `${CHILD}.glb readable under ${ASSET_DIR}`).not.toBeNull();
  expect(parent, `${PARENT}.glb readable under ${ASSET_DIR}`).not.toBeNull();
  expect(nurse, `${NURSE}.glb readable under ${ASSET_DIR}`).not.toBeNull();
}

describe("the child patient has hair and the nurse keeps his recorded skip", () => {
  it.fails("(1) RED: the child carries a fitted hair mesh and no placeholder scalp paint", () => {
    requireMeasured();
    expect(
      child!.hairTris,
      `${CHILD} carries ${child!.placeholderVerts} placeholder scalp verts and ${child!.hairTris} tris of fitted hair — she is the last MPFB actor on the 2.8%-luminance paint`,
    ).toBeGreaterThan(MIN_HAIR_TRIS);
    expect(child!.placeholderVerts, `${CHILD} placeholder scalp paint retired`).toBe(0);
    // §6p: the vacated polygons must render as skin, not as a hole.
    expect(
      child!.headSkinVerts,
      `${CHILD} head still covered by the skin material after the paint is retired`,
    ).toBeGreaterThan(MIN_HEAD_SKIN_VERTS);
  });

  it("(2) COUNTERWEIGHT known-good: aisha keeps the #381 hair that proved this path", () => {
    // The one working instance in the tree. If a rebake regresses her, the fitter changed under us
    // and clause (1) is green about a path that no longer works where it used to.
    requireMeasured();
    expect(parent!.hairTris, `${PARENT} fitted library hair (4,976 tris measured 2026-08-14)`).toBeGreaterThan(MIN_HAIR_TRIS);
    expect(parent!.placeholderVerts, `${PARENT} placeholder stays retired (#387)`).toBe(0);
  });

  it("(3) COUNTERWEIGHT: the nurse gains no hair — the recorded male licence skip is preserved", () => {
    // Refuses (d). Every licence-clean style in makehuman-hair01's usable subset is a feminine bob,
    // so the only ways to give Kevin hair are to break the licence gate (10 of 25 are AGPL3) or to
    // put a bob on a male nurse. Both are worse than the paint he has.
    requireMeasured();
    expect(
      nurse!.hairTris,
      `${NURSE} is a RECORDED MALE SKIP (materialize_mpfb_humanoid_candidate.py:46) — no licence-clean masculine style exists in this pack`,
    ).toBe(0);
  });

  it.fails("(4) RED: the child's style is licence-clean AND different from her parent's", () => {
    // Refuses (c). Reusing the default toigo_blunt_bob_with_bangs is the cheapest green available and
    // stands the child beside her own parent in identical hair — #388's defect through a new door.
    requireMeasured();
    expect(child!.hairStyle, `${CHILD} hair style parsed from the fitted mesh name`).not.toBeNull();
    expect(
      LICENCE_CLEAN_STYLES as readonly string[],
      `${CHILD} style "${child!.hairStyle}" must be in #330's attribution-free usable subset — 10 of the 25 styles in this pack are AGPL3`,
    ).toContain(child!.hairStyle);
    expect(
      child!.hairStyle,
      `${CHILD} and ${PARENT} stand together in peds_asthma_parent_anxiety_v1 and must not share a hairstyle (parent has "${parent!.hairStyle}")`,
    ).not.toBe(parent!.hairStyle);
  });
});
