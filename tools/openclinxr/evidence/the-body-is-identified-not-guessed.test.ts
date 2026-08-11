import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * `mpfb-scalp-hair-region.test.ts:181` states its premise in a comment:
 *
 *   // The body is the largest mesh by triangle count — true on both rails and on any future rail.
 *
 * That is now FALSE and the test reds because of it, with no product defect behind the red.
 *
 * MEASURED 2026-08-11 on the landed GLBs — triangles, morph targets, skinning:
 *
 *   rail          mesh                                     tris   morphs  skinned
 *   ------------- ---------------------------------------- ------ ------- -------
 *   lean_female   hm08_basemesh_adult_lean_female           26756      32   true    <- the body
 *                 openclinxr_footwear_flats_L_mesh          28800       0   true    <- picked as "body"
 *                 openclinxr_footwear_flats_R_mesh          28800       0   true
 *                 makeclothes_library_cargo_pants_...        2855       0   true
 *                 makeclothes_library_toigo_..._t_shirt      2700       0   true
 *   heavy_male    hm08_basemesh_adult_heavy_male            26756      32   true    <- the body
 *                 openclinxr_footwear_male_boots_L/R_mesh   15384       0   true
 *   aisha         mpfb_ob_patient_aisha_body                26756      40   true    <- the body, IS largest
 *
 * #324 fitted real CC0 footwear (`toigo_flats`, 28,808 source verts) to replace 86-vertex procedural
 * shells. Real shoes are dense. Three slices later nothing had noticed that the body stopped being
 * the largest mesh.
 *
 * THIRD INSTANCE OF THIS CLASS IN ONE DAY: a "largest primitive" pick chose a 34,568-vert shirt over
 * a 34,112-vert body; this one picks a 28,800-tri shoe over a 26,756-tri body; and
 * `mpfb-peds-patient-child.provenance.json` reports the largest non-hidden primitive as "stature",
 * which produced a wrong diagnosis on #328 until a per-mesh measurement disproved it. SIZE IS NOT
 * IDENTITY.
 *
 * THE POSITIVE SIGNAL, measured above: the body is the ONLY mesh carrying morph targets (32/32/40)
 * and every garment carries ZERO. Skinning does not discriminate — everything is skinned. This is
 * not invented: `face-morph-census.ts:18` already qualifies its selector as "the largest primitive
 * that CARRIES MORPH TARGETS, not the largest primitive", and #313 landed the same lesson one level
 * up (`isRuntimeHumanoidAssetPath` — recognise a humanoid by what it is, not the folder it sits in).
 * This slice is D1 reuse of a pattern already proven in the tree.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                                   | (1) real rails | (2) size-blind | (3) name-blind | result
 *   --------------------------------------------|----------------|----------------|----------------|--------
 *   a) today — largest by triangle count        |    **FAIL**    |     FAIL       |      pass      | REFUSED
 *   b) raise/relax a triangle threshold         |      pass      |   **FAIL**     |      pass      | REFUSED
 *   c) denylist garment name substrings         |      pass      |     pass       |    **FAIL**    | REFUSED
 *   d) resolve by morph-target identity         |      pass      |     pass       |      pass      | ALL PASS
 *
 * (b) and (c) are the two a worker reaches for first, and each passes the clause the other fails.
 * (c) is the subtle one: a denylist of `footwear|garment|makeclothes` greens every shipped rail
 * TODAY and breaks silently the first time an asset is renamed or a new garment family lands — which
 * is exactly how this defect arrived.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1), (2), (3) are REDs — the helper does not exist.
 * (4) PASSES today and is the known-good column: aisha, where the body genuinely IS the largest mesh,
 * must keep resolving. A fix that only handles the inverted case is not a fix.
 *
 * NOT TESTED: this asserts BODY IDENTIFICATION only. It does not re-point any of the existing
 * consumers at the helper — `mpfb-scalp-hair-region.test.ts:181`,
 * `body-param-reaches-vertices.ts:111` and `humanoid-body-signature.test.ts:93` are the three
 * unqualified size-based picks found, and migrating them is the slice's product work, gated by
 * `changed:` rather than by this contract. Nothing here claims the scalp-hair assertions themselves
 * are correct once they are pointed at the right mesh — that is a separate question and may surface
 * a real product defect that the shoe has been masking.
 *
 * ## FIXED (#331)
 *
 * 2026-08-11: `packages/openclinxr/asset-registry/src/humanoid-body-mesh.ts` landed
 * `resolveHumanoidBodyMesh(meshes)` — identity by morph-target presence first (the body is the
 * only morph-carrying mesh on the library lean_female / heavy_male / MPFB aisha rails, 32/32/40
 * targets), with the fullest morph stack and then the largest among identity-qualified carriers as
 * the tiebreak for the Anny rail, where garments clone the body's 25 morph targets (the pattern
 * `face-morph-census.ts:18` blesses). A mesh set with no morph-carrying mesh returns null — no
 * guess. The three REDs above flipped to green on the live rails and both synthetic counterweights;
 * their `it.fails` markers are flipped to `it`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** The minimal shape a body resolver needs — deliberately not a glTF type, so it is unit-testable. */
type MeshLike = {
  name: string;
  triangleCount: number;
  morphTargetCount: number;
  skinned: boolean;
};

/** Measured ground truth 2026-08-11 — the body each rail must resolve to. */
const RAILS = [
  {
    id: "library_lean_female",
    glb: "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
    body: "hm08_basemesh_adult_lean_female",
    bodyIsLargest: false, // footwear is 28,800 vs the body's 26,756
  },
  {
    id: "library_heavy_male",
    glb: "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb",
    body: "hm08_basemesh_adult_heavy_male",
    bodyIsLargest: true,
  },
  {
    id: "mpfb2_aisha",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    body: "mpfb_ob_patient_aisha_body",
    bodyIsLargest: true,
  },
] as const;

/**
 * The deliverable, absent today. Expected at
 * `packages/openclinxr/asset-registry/src/humanoid-body-mesh.ts` exporting
 * `resolveHumanoidBodyMesh(meshes: MeshLike[]): MeshLike | null`, so the scattered size-based picks
 * have one place to converge on — the same shape #313 used for asset paths.
 */
async function loadResolver(): Promise<((m: MeshLike[]) => MeshLike | null) | null> {
  const mod = (await import(
    `${REPO_ROOT}/packages/openclinxr/asset-registry/src/humanoid-body-mesh.ts`
  ).catch(() => null)) as { resolveHumanoidBodyMesh?: unknown } | null;
  return typeof mod?.resolveHumanoidBodyMesh === "function"
    ? (mod.resolveHumanoidBodyMesh as (m: MeshLike[]) => MeshLike | null)
    : null;
}

const io = new NodeIO();
async function meshesOf(rel: string): Promise<MeshLike[]> {
  const doc = await io.read(join(REPO_ROOT, rel));
  return doc.getRoot().listMeshes().map((m) => {
    let triangleCount = 0;
    let morphTargetCount = 0;
    let skinned = false;
    for (const p of m.listPrimitives()) {
      triangleCount += (p.getIndices()?.getCount() ?? 0) / 3;
      morphTargetCount = Math.max(morphTargetCount, p.listTargets().length);
      if (p.getAttribute("JOINTS_0")) skinned = true;
    }
    return { name: m.getName(), triangleCount, morphTargetCount, skinned };
  });
}

const rails = await Promise.all(RAILS.map(async (r) => ({ ...r, meshes: await meshesOf(r.glb) })));

describe("the body mesh is identified by what it is, not by being biggest", () => {
  it("(1) RED: every shipped rail resolves to its real body mesh", async () => {
    const resolve = await loadResolver();
    expect(resolve, "asset-registry must export resolveHumanoidBodyMesh").not.toBeNull();

    const wrong: string[] = [];
    for (const rail of rails) {
      const got = resolve!(rail.meshes)?.name ?? null;
      if (got !== rail.body) wrong.push(`${rail.id}: resolved "${got}", expected "${rail.body}"`);
    }
    expect(wrong, "rails resolving to the wrong mesh").toEqual([]);
  });

  it("(2) RED COUNTERWEIGHT: resolution is SIZE-BLIND — the body may be the smallest mesh", async () => {
    const resolve = await loadResolver();
    expect(resolve).not.toBeNull();

    // The inverted case, constructed: the body is the SMALLEST mesh and a garment is the largest.
    // A size-based selector — or one with a triangle threshold — cannot pass this.
    const inverted: MeshLike[] = [
      { name: "hm08_basemesh_adult_lean_female", triangleCount: 900, morphTargetCount: 32, skinned: true },
      { name: "openclinxr_footwear_flats_L_mesh", triangleCount: 90_000, morphTargetCount: 0, skinned: true },
      { name: "makeclothes_library_cargo_pants_x", triangleCount: 45_000, morphTargetCount: 0, skinned: true },
    ];
    expect(resolve!(inverted)?.name, "body resolved when it is the smallest mesh").toBe(
      "hm08_basemesh_adult_lean_female",
    );

    // and the real inverted rail, which is not synthetic
    const leanFemale = rails.find((r) => r.id === "library_lean_female")!;
    expect(leanFemale.bodyIsLargest, "premise: lean_female's body is NOT the largest mesh").toBe(false);
    expect(resolve!(leanFemale.meshes)?.name).toBe(leanFemale.body);
  });

  it("(3) RED COUNTERWEIGHT: resolution is NAME-BLIND — a garment-name denylist is refused", async () => {
    const resolve = await loadResolver();
    expect(resolve).not.toBeNull();

    // Names swapped against reality: the true body (morphs) wears a footwear-shaped name, and a
    // garment wears a basemesh-shaped name. A substring denylist or allowlist picks the wrong one.
    const swapped: MeshLike[] = [
      { name: "openclinxr_footwear_flats_L_mesh", triangleCount: 26_756, morphTargetCount: 32, skinned: true },
      { name: "hm08_basemesh_adult_lean_female", triangleCount: 28_800, morphTargetCount: 0, skinned: true },
    ];
    expect(
      resolve!(swapped)?.name,
      "identity must beat naming — the morph-carrying mesh is the body",
    ).toBe("openclinxr_footwear_flats_L_mesh");

    // A mesh set with no morph-carrying mesh at all has no body: return null, do not guess the biggest.
    const noBody: MeshLike[] = [
      { name: "some_garment", triangleCount: 50_000, morphTargetCount: 0, skinned: true },
      { name: "another_garment", triangleCount: 10, morphTargetCount: 0, skinned: true },
    ];
    expect(resolve!(noBody), "no morph-carrying mesh means no body, not a guess").toBeNull();
  });

  it("(4) NET known-good: the rails where the body IS largest keep resolving, and the premise holds", () => {
    // This clause needs no resolver — it pins the measured facts a fix must not invalidate.
    for (const rail of rails) {
      const bodies = rail.meshes.filter((m) => m.morphTargetCount > 0);
      expect(bodies.map((b) => b.name), `${rail.id}: exactly one morph-carrying mesh`).toEqual([
        rail.body,
      ]);

      const largest = [...rail.meshes].sort((a, b) => b.triangleCount - a.triangleCount)[0]!;
      expect(
        largest.name === rail.body,
        `${rail.id}: bodyIsLargest recorded as ${rail.bodyIsLargest}, largest is "${largest.name}"`,
      ).toBe(rail.bodyIsLargest);
    }
  });
});
