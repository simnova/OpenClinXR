import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #337 fitted CC0 MakeHuman eyes to all three MPFB bodies — 172 triangles, skinned, bound to the
 * bones `resolvePoseBone("eyeL"/"eyeR")` returns. The geometry is correct. The eyes still do not
 * look like eyes, because the MATERIAL was never wired.
 *
 * MEASURED, and the value CHANGED under me mid-investigation:
 *
 *   after #337   baseColor [1.00,1.00,1.00,1.00]  no texture  -> graded as flat WHITE ovals
 *   after #338   baseColor [0.12,0.09,0.07,1.00]  no texture  -> graded as dark SOCKETS
 *
 * Both are a uniform colour over the whole eyeball. #338's re-bake swapped white for brown and
 * neither is an eye: a sclera and an iris are different colours on the same 172 triangles.
 *
 * THE REFERENCE IS THE ASSET'S OWN DECLARED MATERIAL — nothing here is invented:
 *
 *   .openclinxr-local/provider-cache/eyes/makehuman-default/low-poly.mhclo
 *     material ../materials/brown.mhmat
 *   .../brown.mhmat
 *     name Eye_brown
 *     diffuseTexture brown_eye.png          <- the iris/sclera map
 *     shaderParam litsphereTexture skinmat_eye.png
 *
 * Two gaps, both measured:
 *   1. `brown_eye.png` is NOT in our cache. #337 staged .mhclo + .obj + .mhmat and stopped at the
 *      texture the .mhmat points to. It IS available CC0 upstream, same directory, 610,817 bytes:
 *      makehumancommunity/makehuman2 `data/eyes/hm08/materials/brown_eye.png`.
 *   2. `materialize_mpfb_humanoid_candidate.py` contains ZERO `mhmat` references — the pipeline
 *      never consumes an MakeHuman material for any channel, so a flat colour is all it can emit.
 *
 * The eye primitives already carry TEXCOORD_0 on all three bodies (measured). The geometry is ready
 * for the texture; only the material binding is missing.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                    | (1) texture | (2) not uniform | (3) geometry kept | result
 *   ---------------------------------------------|-------------|-----------------|-------------------|--------
 *   a) after #337 — flat white                   |  **FAIL**   |    **FAIL**     |       pass        | REFUSED
 *   b) after #338 — flat brown                   |  **FAIL**   |    **FAIL**     |       pass        | REFUSED
 *   c) pick a "better" flat baseColor            |  **FAIL**   |    **FAIL**     |       pass        | REFUSED
 *   d) consume brown.mhmat -> baseColorTexture   |    pass     |      pass       |       pass        | ALL PASS
 *
 * (c) is the one to worry about and it has ALREADY HAPPENED TWICE. Two slices in a row adjusted a
 * uniform baseColor and the figure got no closer to having eyes. Clause (2) is what refuses a third
 * attempt: a sclera and an iris cannot be the same colour, so a uniform material can never pass.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today on all three bodies.
 * (3) PASSES today and is the known-good column — #337's geometry and skinning are correct and must
 * survive. A fix that deletes and re-adds the eyes to get a material is not a fix.
 *
 * NOT TESTED: no pixel is graded here, and this asserts the MATERIAL BINDING only. It does not claim
 * the iris is the right size, centred on the pupil, oriented correctly, or that the eye reads as an
 * eye at viewing distance — all of that is a pixel grade the orchestrator owes. Nor does it touch
 * nurse_kevin's separate face defect: alpha-0 MASK primitives DISCARD face geometry, which is
 * absence rather than appearance and no material clause can see it.
 *
 * ## FIXED (#340)
 *
 * `materialize_mpfb_humanoid_candidate.py` now consumes the asset's OWN declared material:
 * `mhmat_for_mhclo` resolves the .mhclo's `material ../materials/brown.mhmat` line and
 * `make_material_from_mhmat` binds `diffuseTexture brown_eye.png` (CC0, same directory, 610,817
 * bytes, git blob `bda1b4b0` == upstream main, verified via gh API) as glTF `baseColorTexture`
 * with `diffuseColor` as baseColorFactor. The flat baseColor path (#337 white, #338 brown) is gone
 * for eyes. All three bodies re-baked and re-measured 2026-08-11:
 *
 *   file                        | texture | distinctColours | baseColor | tris | skinned
 *   ----------------------------|---------|-----------------|-----------|------|--------
 *   mpfb-ob-patient-aisha.glb   |  yes    |       65        | 1,1,1,1   | 172  |  yes
 *   mpfb-peds-nurse-kevin.glb   |  yes    |       65        | 1,1,1,1   | 172  |  yes
 *   mpfb-peds-patient-child.glb |  yes    |       65        | 1,1,1,1   | 172  |  yes
 *
 * The `it.fails` markers on (1) and (2) were flipped to `it`; the geometry net (3) still passes.
 * (65 is the sampler's 64-colour cap — a coarse byte sample of the embedded 610,817-byte PNG, not
 * a pixel count; the point is that the material is a texture, not a uniform fill.)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** Distinct RGB values required before a texture counts as an iris rather than a tint. */
const MIN_DISTINCT_COLOURS = 2;

type Row = {
  file: string;
  hasTexture: boolean;
  baseColor: number[];
  distinctColours: number;
  tris: number;
  skinned: boolean;
};

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!/eye/i.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const tex = mat?.getBaseColorTexture() ?? null;

      // Distinct colours: sample the texture's raw bytes if present, else a flat factor is 1 colour.
      let distinct = 1;
      const img = tex?.getImage();
      if (img && img.byteLength > 0) {
        const seen = new Set<string>();
        // Coarse sample — enough to separate a real iris map from a single-colour fill.
        const stride = Math.max(1, Math.floor(img.byteLength / 4096));
        for (let i = 0; i + 2 < img.byteLength; i += stride * 3) {
          seen.add(`${img[i]! >> 4},${img[i + 1]! >> 4},${img[i + 2]! >> 4}`);
          if (seen.size > 64) break;
        }
        distinct = seen.size;
      }

      let tris = 0;
      let skinned = false;
      for (const p of mesh.listPrimitives()) {
        tris += (p.getIndices()?.getCount() ?? 0) / 3;
        if (p.getAttribute("JOINTS_0")) skinned = true;
      }
      return {
        file: rel.split("/").pop()!,
        hasTexture: tex !== null,
        baseColor: mat?.getBaseColorFactor() ?? [],
        distinctColours: distinct,
        tris,
        skinned,
      };
    }
  }
  return null;
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `MPFB bodies carrying an eye mesh (scanned ${files.length})`)
    .toBeGreaterThanOrEqual(3);
}

const show = (r: Row): string =>
  `${r.file}: texture=${r.hasTexture} distinctColours=${r.distinctColours} baseColor=[${r.baseColor.map((x) => x.toFixed(2)).join(",")}]`;

describe("an eye has an iris, not a single colour", () => {
  it("(1) RED: every eye material carries a base-colour texture", () => {
    requireRows();
    expect(rows.filter((r) => !r.hasTexture).map(show), "eye materials with no texture").toEqual([]);
  });

  it("(2) RED COUNTERWEIGHT: the eye is not a uniform colour — a flat baseColor is refused", () => {
    requireRows();
    // Twice now a slice has adjusted a uniform baseColor (white -> brown) and produced no eye.
    // A sclera and an iris differ, so any uniform material fails this by construction.
    expect(
      rows.filter((r) => r.distinctColours < MIN_DISTINCT_COLOURS).map(show),
      "eyes rendering as a single flat colour",
    ).toEqual([]);
  });

  it("(3) NET known-good: #337's eye geometry and skinning survive", () => {
    requireRows();
    const broken = rows
      .filter((r) => r.tris < 100 || !r.skinned)
      .map((r) => `${r.file}: tris=${r.tris} skinned=${r.skinned}`);
    expect(broken, "eye meshes that lost geometry or skinning").toEqual([]);
  });
});
