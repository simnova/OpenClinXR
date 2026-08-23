import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";

/**
 * MEASURED ON HEAD 8519ebce7efb0267585687c70a6c1fb0844d2f14, 2026-08-23, by reading the shipped
 * bytes in `apps/ui-xr/public/generated-humanoids/*.glb` with NodeIO. Every number below is from
 * that read, not from a pack page and not from the source `.obj`.
 *
 * ## THE DEFECT — the eyebrow is the most expensive thing on the actor's face by two orders
 *
 * #542 landed eyebrows on all 11 MPFB actors through `EYEBROW_STYLE_BY_REFERENCE`
 * (`materialize_mpfb_humanoid_candidate.py:92`) and the feature is real and working. What it
 * shipped is Mindfront's TRUE GEOMETRIC HAIR — individual triangular strands, one mesh per pair:
 *
 *   asset                             total    eyebrow   brow%   body     lash  teeth  tongue  eyes
 *   ----------------------------------------------------------------------------------------------
 *   mpfb-clinical-nurse-adult        132,450   31,968    24.1%   26,756   368   192    448     172
 *   mpfb-clinical-physician-adult    135,082   31,968    23.7%   26,756   368   192    448     172
 *   mpfb-family-partner-adult         72,341   35,028    48.4%   26,756   368   192    448     172
 *   mpfb-gown-adult-patient          134,375   35,334    26.3%   26,756   368   192    448     172
 *   mpfb-gown-inspect                134,375   35,334    26.3%   26,756   368   192    448     172
 *   mpfb-ob-patient-aisha            131,238   35,334    26.9%   26,756   368   192    448     172
 *   mpfb-peds-nurse-kevin            102,968   28,716    27.9%   26,756   368   192    448     172
 *   mpfb-peds-parent-aisha           131,328   35,334    26.9%   26,756   368   192    448     172
 *   mpfb-peds-patient-child           61,068   21,816    35.7%   26,756   368   192    448     172
 *   mpfb-street-adult-male            96,400   28,716    29.8%   26,756   368   192    448     172
 *   mpfb-viseme-inspect              131,328   35,334    26.9%   26,756   368   192    448     172
 *
 * **On 10 of 11 actors the eyebrow pair costs MORE THAN THE ENTIRE BODY** (26,756). On the family
 * partner it is 48.4% of the whole character. The 7 Anny-rail assets carry no eyebrow at all and
 * are not in scope here.
 *
 * ## THE MECHANISM, measured — quads double on export, so the source figure understates by 2x
 *
 * The operator's brief cited `mind_eyebrows_14.obj` at 28,440 verts / 21,150 faces. VERIFIED on
 * disk. But every face in these OBJs is a QUAD — `awk '/^f /{print NF-1}'` on
 * `mind_eyebrows_05.obj` returns 17,667 lines, all arity 4, zero triangles. Triangulation on
 * export doubles them, exactly:
 *
 *   style                 source quad faces   shipped tris   ratio
 *   mindfront_eyebrows_03      10,908           21,816       2.000
 *   mindfront_eyebrows_05      17,667           35,334       2.000
 *   mindfront_eyebrows_06      15,984           31,968       2.000
 *   mindfront_eyebrows_08      14,358           28,716       2.000
 *   mindfront_eyebrows_10      17,514           35,028       2.000
 *
 * Two consequences. **The shipped mesh is NOT decimated** — `grep -ci decimate` on
 * `materialize_mpfb_humanoid_candidate.py` returns 0, there is no reduction step anywhere in the
 * bake. And **a face count from a MakeClothes OBJ is half the runtime cost**; the earlier
 * ~35,334 reading was correct and is not in conflict with the 21,150 source figure.
 *
 * ## THE THRESHOLD IS A RELATIONSHIP, DERIVED FROM THE TREE — no invented magnitude
 *
 * Standing direction: no output gated on a bare triangle ceiling. This contract asserts a
 * RELATIONSHIP instead, and the reference is the strongest one available (SS9h): **the sibling
 * facial accessories on the SAME actor, fitted by the SAME rail.**
 *
 *   eyes_low_poly 172 + teeth 192 + eyelash 368 + tongue 448  =  1,180 tris, all four combined
 *
 * Those four are what a correctly-budgeted facial feature costs on this pipeline today. Clause (1)
 * requires the eyebrow to cost no more than all four of them put together. Today it costs 18.5x to
 * 29.9x that sum.
 *
 * I did NOT use the operator's 500-1,000 tri guidance as the threshold — that is guidance, not a
 * repo constant. It is worth recording that the tree-derived bar of 1,180 lands just above that
 * band, so the two agree; that is corroboration, not the source.
 *
 * The registry's `quest3AssetBudget.maxTriangles = 60000` and the per-character manifests'
 * `maxTriangles: 18000` (`packages/openclinxr/asset-registry/src/index.ts:592,2436`) are both
 * exceeded by every MPFB asset today (61,068 - 135,082). Clause (1) deliberately does NOT assert
 * against them: fixing the eyebrow alone would not clear either, and a bare ceiling on a generated
 * asset is the gate shape we are told not to build.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                   | (1) budget | (2) siblings | (3) feature | result
 *   --------------------------------------------|------------|--------------|-------------|--------
 *   a) today                                    |  **FAIL**  |     pass     |    pass     | REFUSED
 *   b) delete the eyebrow meshes                |    pass    |     pass     |  **FAIL**   | REFUSED - this is #542 undone
 *   c) collapse all 11 actors onto one cheap    |    pass    |     pass     |  **FAIL**   | REFUSED - loses per-actor identity
 *      shared brow                              |            |              |             |
 *   d) paint brows into the skin atlas, drop    |    pass    |     pass     |  **FAIL**   | REFUSED - #542 clause (c) already
 *      the mesh                                 |            |              |             |   refused paint; mesh was ordered
 *   e) inflate lash/teeth/tongue so the sum     |    pass    |  **FAIL**    |    pass     | REFUSED - moves the reference
 *      clears the brow                          |            |              |             |   instead of the subject
 *   f) hair-card bake or retopo per style,      |    pass    |     pass     |    pass     | ALL PASS
 *      5 styles retained, mesh stays separate   |            |              |             |
 *
 * (b) is the one to watch. Deleting the eyebrows passes any budget assertion instantly and returns
 * the cast to the state #542 was filed to fix — 11 actors with no brows. Clause (3) exists so that
 * the cheapest pass is also the loudest failure.
 *
 * (e) is the subtler one. Clause (1) compares the brow against a SUM that the same worker could
 * raise. Clause (2) pins that sum's four members at the values measured here, so the reference
 * cannot drift under the assertion.
 *
 * ## OUT OF SCOPE, SEEN WHILE MEASURING — footwear is a bigger instance of this same class
 *
 * `makeclothes_library_footwear_toigo_flats_*` ships at **57,600 tris** on 5 of the 11 actors -
 * larger than any eyebrow, larger than the body, the single most expensive mesh in those files.
 * `makeclothes_library_footwear_culturalibre_male_boots_*` is 30,768 on 2 more. That is a separate
 * acquisition path (MakeClothes library, not the facial rail) and is NOT gated here. Naming it so
 * it is not lost: fixing eyebrows alone leaves the larger offender in place.
 *
 * claimScope: the triangle cost of the fitted eyebrow mesh on the 11 shipped MPFB actors, relative
 *   to the other facial accessories on the same actor; and that the eyebrow feature, its per-actor
 *   style distinction, and its separate-mesh form survive whatever reduces it.
 * notEvidenceFor: whether the reduced brows LOOK right (the orchestrator grades pixels); the
 *   footwear meshes; the total character budget against Quest hardware (never measured on device);
 *   the Anny-rail assets, which carry no eyebrow; texture memory; draw calls.
 *
 * NOT TESTED: frame time or draw-call cost on Quest hardware; whether a hair-card bake preserves
 *   the brow's appearance at learner viewing distance; whether the 2x quad->tri doubling also
 *   applies to the MakeClothes garment and footwear meshes (not measured).
 */

const DIR = "apps/ui-xr/public/generated-humanoids";

const MPFB_ACTORS = readdirSync(DIR)
  .filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb"))
  .sort();

/**
 * Measured on HEAD 8519ebce, per actor. These four are the reference class for clause (1) and are
 * pinned by clause (2) so the reference cannot be inflated to satisfy clause (1).
 */
const SIBLING_FACIAL_TRIS_ON_EVERY_ACTOR = {
  eyes: 172,
  teeth: 192,
  eyelash: 368,
  tongue: 448,
} as const;

const SIBLING_FACIAL_SUM = Object.values(SIBLING_FACIAL_TRIS_ON_EVERY_ACTOR).reduce(
  (a, b) => a + b,
  0,
); // 1,180

/** Distinct eyebrow styles across the shipped cast, measured on HEAD 8519ebce. */
const SHIPPED_EYEBROW_STYLES = [
  "mindfront_eyebrows_03",
  "mindfront_eyebrows_05",
  "mindfront_eyebrows_06",
  "mindfront_eyebrows_08",
  "mindfront_eyebrows_10",
] as const;

type FacialGroup = "eyebrow" | "eyelash" | "teeth" | "tongue" | "eyes";

function classify(meshName: string): FacialGroup | null {
  if (/fitted_eyebrow/i.test(meshName)) return "eyebrow";
  if (/hm08_eyelash/i.test(meshName)) return "eyelash";
  if (/hm08_teeth/i.test(meshName)) return "teeth";
  if (/hm08_tongue/i.test(meshName)) return "tongue";
  if (/eyes_low_poly/i.test(meshName)) return "eyes";
  return null;
}

type ActorFacialMeasure = {
  asset: string;
  totalTris: number;
  bodyTris: number;
  facial: Record<FacialGroup, number>;
  eyebrowStyle: string | null;
};

/**
 * Read through the same loader the runtime uses to parse these files. Triangles are counted from
 * the index accessor where one exists, falling back to POSITION/3 for non-indexed primitives.
 */
async function measureActor(asset: string): Promise<ActorFacialMeasure> {
  const io = new NodeIO();
  const doc = await io.read(`${DIR}/${asset}`);
  const facial: Record<FacialGroup, number> = {
    eyebrow: 0,
    eyelash: 0,
    teeth: 0,
    tongue: 0,
    eyes: 0,
  };
  let totalTris = 0;
  let bodyTris = 0;
  let eyebrowStyle: string | null = null;

  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() ?? "";
    let tris = 0;
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      tris += indices
        ? indices.getCount() / 3
        : (prim.getAttribute("POSITION")?.getCount() ?? 0) / 3;
    }
    totalTris += tris;
    if (/_body$/.test(name)) bodyTris += tris;
    const group = classify(name);
    if (group) {
      facial[group] += tris;
      if (group === "eyebrow") {
        eyebrowStyle = /fitted_eyebrow_(mindfront_eyebrows_\d+)/.exec(name)?.[1] ?? eyebrowStyle;
      }
    }
  }

  return { asset, totalTris, bodyTris, facial, eyebrowStyle };
}

let measured: ActorFacialMeasure[] | null = null;
async function allActors(): Promise<ActorFacialMeasure[]> {
  if (!measured) measured = await Promise.all(MPFB_ACTORS.map(measureActor));
  return measured;
}

describe("the eyebrows cost more than every other facial feature combined", () => {
  /**
   * (1) THE RED. A facial accessory must not cost more than every other facial accessory on the
   * same actor put together. The reference (1,180 tris) is the measured sum of the eyes, teeth,
   * eyelash and tongue that ship on this exact rail today — not a number anyone chose.
   *
   * Fails 11/11 on HEAD 8519ebce at 18.5x to 29.9x the reference.
   */
  it.fails(
    "(1) no actor's eyebrow costs more than its eyes, lashes, teeth and tongue combined",
    async () => {
      const actors = await allActors();
      expect(actors.length).toBeGreaterThan(1);

      const over = actors
        .filter((a) => a.facial.eyebrow > SIBLING_FACIAL_SUM)
        .map((a) => ({
          asset: a.asset,
          eyebrowTris: a.facial.eyebrow,
          siblingSum: SIBLING_FACIAL_SUM,
          ratio: Number((a.facial.eyebrow / SIBLING_FACIAL_SUM).toFixed(1)),
          shareOfCharacter: `${((a.facial.eyebrow / a.totalTris) * 100).toFixed(1)}%`,
        }));

      expect(over, JSON.stringify(over, null, 2)).toEqual([]);
    },
  );

  /**
   * (2) KNOWN-GOOD COLUMN, green today, and it must stay green. These four facial accessories are
   * the reference clause (1) measures against. Pinning them refuses treatment (e): satisfying the
   * budget by inflating the reference rather than reducing the subject.
   */
  it("(2) the sibling facial accessories keep their measured cost on every actor", async () => {
    const actors = await allActors();
    for (const actor of actors) {
      for (const [group, expected] of Object.entries(SIBLING_FACIAL_TRIS_ON_EVERY_ACTOR)) {
        expect(
          actor.facial[group as FacialGroup],
          `${actor.asset} ${group}: reference class must not move`,
        ).toBe(expected);
      }
    }
  });

  /**
   * (3) COUNTERWEIGHT, green today, and it must stay green. The cheapest way to pass clause (1) is
   * to delete the eyebrows — which passes any budget and is #542 undone. This refuses that, and
   * refuses collapsing the cast onto one shared brow, and refuses replacing the mesh with paint.
   */
  it("(3) every actor still carries a distinct, separately-meshed eyebrow", async () => {
    const actors = await allActors();

    const withoutBrow = actors.filter((a) => a.facial.eyebrow <= 0).map((a) => a.asset);
    expect(withoutBrow, "eyebrow mesh deleted — this is #542 undone").toEqual([]);

    const styles = new Set(actors.map((a) => a.eyebrowStyle).filter(Boolean) as string[]);
    expect(
      styles.size,
      `per-actor eyebrow identity collapsed; shipped styles were ${SHIPPED_EYEBROW_STYLES.join(", ")}`,
    ).toBeGreaterThanOrEqual(SHIPPED_EYEBROW_STYLES.length);
  });

  /**
   * (4) The body must not absorb the eyebrow. A "reduction" that merges brow geometry into the
   * body mesh, or bakes it into the skin atlas and drops the mesh, would satisfy (1) and (3)'s
   * presence half while destroying the separate-mesh form the rail depends on.
   */
  it("(4) the body mesh keeps its own measured cost — the eyebrow is not merged into it", async () => {
    const actors = await allActors();
    for (const actor of actors) {
      expect(actor.bodyTris, `${actor.asset} body`).toBe(26756);
    }
  });
});
