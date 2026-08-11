import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #295 graded "hands are blue mittens" from the pixels and could not say why. This locates it.
 *
 * Attributing every vertex to the bone that dominates its skin weight, then to the material that
 * owns it, measured 2026-08-11 on the assets `humanoid-runtime-asset-url.ts` actually resolves:
 *
 *   rail                          | hand verts: skin | garment | hidden | reading
 *   ------------------------------|------------------|---------|--------|-------------------------
 *   body-param-adult_lean_female  |            1,274 |  17,345 | 11,528 | MITTEN
 *   body-param-adult_heavy_male   |            7,648 |   3,450 |  5,160 | MITTEN, less severe
 *   mpfb-ob-patient-aisha         |            3,978 |       0 |      0 | hands are skin
 *   peds_patient_child (Anny)     |                0 |       0 |      0 | see below
 *   peds_anxious_parent (Anny)    |                0 |       0 |      0 | see below
 *
 * THE MECHANISM. `mat_makeclothes_library_civilian_shirt` owns 17,345 vertices whose dominant bone is
 * a hand or finger joint — half the shirt's 34,568. The MakeClothes shell does not terminate at the
 * wrist; it continues over the hand. Underneath, `openclinxr_hidden_upper_hm08_basemesh`
 * (baseColorFactor `[0,0,0]`) owns another 11,528 hand-dominant vertices, so the body's own hand is
 * hidden by the body-part-hiding mask. Blue shell over a hidden hand is exactly a mitten, and only
 * 1,274 hand vertices are left carrying `skin_adult_lean_female`.
 *
 * The two library bodies share that shirt and diverge sharply — 17,345 vs 3,450 garment-owned hand
 * vertices — so this is a FIT outcome per body, not a constant property of the garment. A fix must
 * hold on both.
 *
 * WHY THE ANNY ROWS ARE NOT A KNOWN-GOOD COLUMN, and I nearly wrote that they were. Their zeros do
 * not mean "clean hands". Both carry hand bones (`hand.L`, `index_finger_base.L`, `hand.R`,
 * `index_finger_base.R` — 4 of 23 joints), and **no vertex on either mesh is dominantly weighted to
 * any of them**. That is the #307 class (the arm rides one bone) showing up on the Anny rail, a
 * different defect that this contract deliberately does not assert on (D4). Reading those zeros as
 * "ok" would have been my fourth measurement error of the day; the joint-name dump is what caught it.
 *
 * THE KNOWN-GOOD COLUMN IS AISHA, AND IT IS WEAK — say so rather than let it read as strong (§9h).
 * She has 3,978 hand-dominant vertices, all in `skin`, none in a garment or hide mask. That proves
 * the predicate is SATISFIABLE and that hand vertices can be correctly attributed. It does NOT prove
 * a clothed body can pass, because she wears nothing. **No clothed rail in this repo currently has
 * clean hands** — that absence is itself the finding, and it means clause (3) is carrying the weight
 * a second good column normally would.
 *
 * WHERE THE THRESHOLDS COME FROM (§9s):
 *
 *   0 garment-owned hand vertices.   Not a tuned bound — a sleeve that ends at the wrist owns none
 *                                    by construction. Zero is the only defensible value.
 *   0 hidden-owned hand vertices.    Same: the hide mask exists to remove body under CLOTH. A hand
 *                                    with no cloth on it must not be hidden.
 *   >= 1,000 skin-owned hand verts.  Derived from the observed floor of a correctly-attributed hand
 *                                    (aisha 3,978; heavy_male already 7,648) and set well below both
 *                                    so it bounds DELETION, not fit quality. It is the counterweight,
 *                                    not a quality bar.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                          | (1) | (2) | (3) | result
 *   ---------------------------------------------------|-----|-----|-----|--------
 *   a) today                                           |FAIL |FAIL | pass| REFUSED
 *   b) delete the shirt's hand-region faces            | pass| FAIL| pass| REFUSED
 *   c) delete the shirt entirely                       | pass| FAIL| pass| REFUSED
 *   d) stop hiding ANY body (drop the mask)            |FAIL | pass| pass| REFUSED
 *   e) delete the body's hand geometry                 | pass| pass|FAIL | REFUSED
 *   f) terminate the sleeve at the wrist AND scope the
 *      hide mask to the covered region                 | pass| pass| pass| ALL PASS
 *
 * (b) and (c) are refused by (2) because deleting cloth does not un-hide the body beneath — the hand
 * geometry is still discarded by the alpha-MASK material, so removing the sleeve leaves a STUMP. (d) is refused by (1) because un-hiding the body does not stop the sleeve covering it
 * — the hand stays blue. **The two clauses must be satisfied together and neither deletion reaches
 * both**, which is the point: this is a fit defect on both sides of the same surface. (e) is the
 * degenerate escape and (3) exists for it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today on both library
 * bodies. (3) PASSES today (1,274 and 7,648) and is the counterweight a fix must not trade away.
 *
 * NOT TESTED: nothing is rendered. This attributes vertices to bones and materials in the shipped
 * files; it does not prove the resulting hand LOOKS like a hand, that the cuff is well placed, or
 * that the sleeve does not now poke through. The waist sawtooth #295 also grades is a separate
 * mechanism — measured, 382 skin vertices against 66 hidden in the Y[0.88,0.96] band — and is
 * deliberately out of scope here (D4). The Anny rail's zero-weight hands are #307's class and are not
 * asserted on. Nothing here claims the garment fit is good, only that it stops at the wrist.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PUBLIC = `${REPO_ROOT}/apps/ui-xr/public`;

/** Materials that represent cloth. */
const GARMENT_MATERIAL = /garment|clothing|shirt|pants|tshirt|top|scrub|gown|makeclothes/i;
/** The body-part-hiding mask: baseColorFactor [0,0,0], removes body under cloth. */
const HIDDEN_MATERIAL = /hidden/i;
/** Skin across both naming conventions. */
const SKIN_MATERIAL = /skin|anny_generated_pbr/i;
/** Hand and finger joints across the mixamo_unity, MPFB2 and Anny rig conventions. */
const HAND_JOINT = /hand|wrist|finger|thumb/i;

/** Bounds DELETION of the hand, not fit quality. Observed correct hands: 3,978 and 7,648. */
const MIN_SKIN_HAND_VERTS = 1000;

/** Both library bodies share the same MakeClothes shirt and diverge, so a fix must hold on both. */
const CLOTHED_RAILS = [
  { id: "library_lean_female", glb: "xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb" },
  { id: "library_heavy_male", glb: "xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb" },
] as const;

/** Weak but real: proves the predicate is satisfiable and hand vertices can be attributed. */
const SATISFIABLE_REFERENCE = {
  id: "mpfb2_aisha",
  glb: "generated-humanoids/mpfb-ob-patient-aisha.glb",
} as const;

type HandTally = { id: string; skin: number; garment: number; hidden: number; other: number };

const io = new NodeIO();

async function tallyHandVerts(id: string, rel: string): Promise<HandTally> {
  const doc = await io.read(`${PUBLIC}/${rel}`);
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) throw new Error(`${rel}: no skin`);
  const handJoints = new Set(
    skin.listJoints().map((j, i) => ({ i, name: j.getName() })).filter((j) => HAND_JOINT.test(j.name)).map((j) => j.i),
  );
  const out: HandTally = { id, skin: 0, garment: 0, hidden: 0, other: 0 };

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const joints = prim.getAttribute("JOINTS_0");
      const weights = prim.getAttribute("WEIGHTS_0");
      if (!joints || !weights) continue;
      const material = prim.getMaterial()?.getName() ?? "";
      const bucket: keyof HandTally = GARMENT_MATERIAL.test(material)
        ? "garment"
        : HIDDEN_MATERIAL.test(material)
          ? "hidden"
          : SKIN_MATERIAL.test(material)
            ? "skin"
            : "other";

      const je: [number, number, number, number] = [0, 0, 0, 0];
      const we: [number, number, number, number] = [0, 0, 0, 0];
      for (let i = 0; i < joints.getCount(); i += 1) {
        joints.getElement(i, je);
        weights.getElement(i, we);
        let dominant = -1;
        let best = 0;
        for (let k = 0; k < 4; k += 1) {
          if (we[k]! > best) {
            best = we[k]!;
            dominant = je[k]!;
          }
        }
        if (dominant >= 0 && handJoints.has(dominant)) out[bucket] += 1;
      }
    }
  }
  return out;
}

const clothed = await Promise.all(CLOTHED_RAILS.map((r) => tallyHandVerts(r.id, r.glb)));
const reference = await tallyHandVerts(SATISFIABLE_REFERENCE.id, SATISFIABLE_REFERENCE.glb);

/** An unmeasured population must FAIL every clause, never pass vacuously (§7t). */
function requireMeasured(): void {
  expect(clothed.map((c) => c.id).sort(), "both clothed library rails measured").toEqual(
    [...CLOTHED_RAILS].map((r) => r.id).sort(),
  );
  for (const c of clothed) {
    const total = c.skin + c.garment + c.hidden + c.other;
    // A rail with no hand-dominant vertices at all is the #307 zero-weight case, not a clean hand.
    expect(total, `${c.id}: hand-dominant vertices found at all`).toBeGreaterThan(0);
  }
}

describe("a garment shell stops at the wrist, and the hide mask does not hide a bare hand", () => {
  it.fails("(1) RED: no hand-dominant vertex belongs to a GARMENT material", () => {
    requireMeasured();
    const mittens = clothed
      .filter((c) => c.garment > 0)
      .map((c) => `${c.id}: ${c.garment} hand vertices owned by cloth (skin=${c.skin}, hidden=${c.hidden})`);
    expect(mittens, "rails whose sleeve continues over the hand").toEqual([]);
  });

  it.fails("(2) RED: no hand-dominant vertex belongs to the HIDDEN body mask", () => {
    requireMeasured();
    const blacked = clothed
      .filter((c) => c.hidden > 0)
      .map((c) => `${c.id}: ${c.hidden} hand vertices hidden by the body mask (skin=${c.skin})`);
    expect(blacked, "rails whose bare hand is removed by the hide mask").toEqual([]);
  });

  it(
    `(3) COUNTERWEIGHT: every rail keeps >= ${MIN_SKIN_HAND_VERTS} skin-owned hand vertices — deleting the hand is refused`,
    () => {
      requireMeasured();
      for (const c of clothed) {
        expect(c.skin, `${c.id} skin-owned hand vertices`).toBeGreaterThanOrEqual(MIN_SKIN_HAND_VERTS);
      }
    },
  );

  it("(4) NET satisfiable reference: an unclothed MPFB2 body attributes every hand vertex to skin", () => {
    expect(reference.skin, "aisha skin-owned hand vertices").toBeGreaterThanOrEqual(1000);
    expect(reference.garment, "aisha garment-owned hand vertices").toBe(0);
    expect(reference.hidden, "aisha hidden-owned hand vertices").toBe(0);
  });
});
