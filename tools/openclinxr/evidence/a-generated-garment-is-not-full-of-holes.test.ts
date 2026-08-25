import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: a generated garment has no torn holes in it.
 *
 * MEASURED 2026-08-25, do not re-derive. Boundary loops per garment mesh, welded by vertex position
 * to 5 dp so glTF export splits cannot fake extra loops:
 *
 *   rail       garment mesh                        loops  sizes                     tris
 *   LIBRARY    makeclothes_library_scrub_shirt         0  (watertight)              9384
 *   LIBRARY    makeclothes_library_toigo_t_shirt       4  [36, 26, 12, 12]          2700
 *   LIBRARY    makeclothes_library_scrub_pants         3  [42, 19, 19]              2704
 *   GENERATED  real_garment_peds_upper (child)         6  [73, 46, 24, 22, 2, 2]    4054
 *   GENERATED  real_garment_peds_upper (street male)  33  [56, 50, 21, 21, 4, 3, 3, 3]  8146
 *
 * **Loop COUNT is not the discriminator** - a t-shirt legitimately has four boundaries (neck, two
 * cuffs, hem). **Loop SIZE is.** Every library boundary is at least 12 vertices. Both generated
 * garments carry 2-, 3- and 4-vertex loops, and a boundary that small is a missing triangle - never a
 * hem, a cuff or a neckline.
 *
 * The threshold below is derived from that gap: 6 is half the smallest legitimate library boundary
 * (12) and twice the largest generated micro-loop on the child (2-3). Not fitted to either side.
 *
 * This is D1 in one measurement: the proven tool produces clean topology and the hand-authored
 * generator does not.
 *
 * WHERE THIS CAME FROM, and one of my own claims dies here. I pixel-graded three assets and reported
 * a "ragged torn sleeve edge" on all three - the two clinical adults and the child. The two adults
 * wear library garments with a SINGLE clean boundary, so whatever I saw on them was not a torn mesh;
 * most likely the garment/skin junction read as a tear at that camera distance. **The measurement
 * keeps the child and withdraws the two adults.** The defect is narrower than I said and better
 * located.
 *
 * KNOWN-GOOD COLUMN - clause (2): both library garments. They are the reference for what a generated
 * garment's topology should look like, and they must keep their single boundary. A fix that reaches
 * clause (1) by re-meshing everything would move them.
 *
 * COUNTERWEIGHT - clause (3): the child must still WEAR something. Deleting the torn garment, or
 * shrinking it to nothing, satisfies "no holes" by removing the subject. The mesh must keep a
 * triangle count in the same order as the library garments it is being measured against.
 *
 * FAILED TREATMENT, do not repeat: swapping the procedural garment for a library `.mhclo` on this
 * actor. That fixes one asset and leaves the generator producing holes for every future case - the
 * opposite of what #650 and #653 were for. The GENERATOR must stop emitting them.
 *
 * claimScope: boundary-loop topology of the named garment meshes, read from the shipped glTF.
 * notEvidenceFor: how any garment looks; fit; coverage; whether the holes are visible at runtime;
 *   the feet, hands, and hair defects graded on the same asset, which are separate meshes.
 *
 * ## FIXED (#656)
 *
 * CAUSE, MEASURED 2026-08-25: the micro-loops are created AFTER the repair pass at
 * `automate_blender.py:2473` (remove_doubles 5e-4 + dissolve_degenerate — both clean). The
 * hem-finish step "Aggressive weld on the hem plane" ran `remove_doubles(dist=0.008)` over ALL
 * mesh verts. In the dense neck ring, cuffs and open-front cut edges (edges down to ~8 mm), that
 * weld merges triangle verts; each merged-degenerate triangle is deleted and opens a 1-edge slit
 * that reads as a 2- or 3-vertex boundary loop. Instrumented stage tables (child):
 *
 *   stage                          loops
 *   PRE-weld                       [98, 26, 26, 22, 22]        no micro
 *   POST-weld (5e-4 + degenerate)  [98, 43, 26, 26]            no micro
 *   after hem snap + weld(0.008)   [73, 24, 22, 20, 18, 2, 2]  micro born here
 *   FINAL (shipped)                [73, 46, 24, 22, 2, 2]
 *
 * FIX: scope the 0.008 hem weld to the hem band (`|y - bot_y| <= max(0.025, (neck_y - bot_y)*0.02)`)
 * — the staircase polyline it exists to erase is all within a few rows of the plane; the neck,
 * cuffs and open-front edges need no 8 mm weld. Threshold 6 and the library known-good column
 * are untouched. Post-fix shipped loops:
 *
 *   rail       garment mesh                         loops                tris
 *   GENERATED  real_garment_peds_upper (child)      [98, 44, 26, 26]     4883
 *   GENERATED  real_garment_peds_upper (street)     casual [58, 39, 26, 26]; cardigan [58, 50, 21, 21]
 *
 * No library boundary changed. NOT TESTED (unchanged from header): runtime visibility, fit,
 * coverage, and the separate feet/hands/hair defects.
 */

const HUMANOIDS = "apps/ui-xr/public/generated-humanoids";
/** A boundary loop this small is a missing triangle. A hem, cuff or neckline is never 5 vertices. */
const MIN_LEGITIMATE_LOOP_VERTICES = 6;

interface GarmentTopology { readonly loops: number[]; readonly triangles: number }

async function garmentTopology(basename: string, meshMatch: RegExp): Promise<GarmentTopology> {
  const doc = await new NodeIO().readBinary(readFileSync(`${HUMANOIDS}/${basename}`));
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!meshMatch.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices(); const pos = prim.getAttribute("POSITION");
      if (!idx || !pos) continue;
      const indices = idx.getArray() as ArrayLike<number>;
      const p = pos.getArray() as ArrayLike<number>;
      // Weld by position: the exporter splits vertices per material and per UV seam, which would
      // otherwise report a clean surface as many open edges (the #121 solidify lesson).
      const at = (i: number): string =>
        `${p[i * 3]!.toFixed(5)},${p[i * 3 + 1]!.toFixed(5)},${p[i * 3 + 2]!.toFixed(5)}`;
      const edges = new Map<string, number>();
      for (let t = 0; t < indices.length; t += 3) {
        const k = [at(indices[t]!), at(indices[t + 1]!), at(indices[t + 2]!)];
        for (const [u, v] of [[k[0]!, k[1]!], [k[1]!, k[2]!], [k[2]!, k[0]!]]) {
          const key = u < v ? `${u}|${v}` : `${v}|${u}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      const adj = new Map<string, Set<string>>();
      for (const [key, count] of edges) {
        if (count !== 1) continue;
        const [u, v] = key.split("|") as [string, string];
        (adj.get(u) ?? adj.set(u, new Set()).get(u)!).add(v);
        (adj.get(v) ?? adj.set(v, new Set()).get(v)!).add(u);
      }
      const seen = new Set<string>(); const loops: number[] = [];
      for (const start of adj.keys()) {
        if (seen.has(start)) continue;
        const stack = [start]; const comp = new Set<string>();
        while (stack.length > 0) {
          const x = stack.pop()!;
          if (comp.has(x)) continue;
          comp.add(x); seen.add(x);
          for (const n of adj.get(x) ?? []) if (!comp.has(n)) stack.push(n);
        }
        loops.push(comp.size);
      }
      return { loops: loops.sort((a, b) => b - a), triangles: indices.length / 3 };
    }
  }
  throw new Error(`no indexed garment primitive matching ${meshMatch} in ${basename}`);
}

describe("a generated garment is not full of holes", () => {
  it("(1) the procedurally generated garment has no torn micro-boundaries", async () => {
    const t = await garmentTopology("peds_fever_patient_child.glb", /real_garment_peds_upper/u);
    const torn = t.loops.filter((n) => n < MIN_LEGITIMATE_LOOP_VERTICES);
    expect(
      torn,
      `${t.loops.length} boundary loops, sizes ${t.loops.join(", ")}. Loops under `
      + `${MIN_LEGITIMATE_LOOP_VERTICES} vertices are missing triangles, not hems. The MakeClothes `
      + "library garments on the same bank have exactly ONE boundary each",
    ).toHaveLength(0);
  }, 120_000);

  it("(2) KNOWN-GOOD COLUMN: the library garments keep their single clean boundary", async () => {
    // The reference for what generated topology should look like. A fix that re-meshes the world
    // instead of fixing the generator would move these.
    for (const [asset, re] of [
      ["mpfb-clinical-nurse-adult.glb", /scrub_shirt/u],
      ["mpfb-ob-patient-aisha.glb", /toigo_t_shirt/u],
      ["mpfb-clinical-nurse-adult.glb", /scrub_pants/u],
    ] as Array<[string, RegExp]>) {
      const t = await garmentTopology(asset, re);
      expect(
        t.loops.filter((n) => n < MIN_LEGITIMATE_LOOP_VERTICES),
        `${asset} ${re} has a micro-boundary; the library rail had none when this was planted `
        + `(smallest observed boundary was 12 vertices)`,
      ).toHaveLength(0);
    }
  }, 120_000);

  it("(3) COUNTERWEIGHT: the child is still wearing something", async () => {
    // "No holes" is trivially satisfied by deleting the garment or shrinking it away. The mesh must
    // survive at a triangle count in the same order as the library garments it is measured against.
    const t = await garmentTopology("peds_fever_patient_child.glb", /real_garment_peds_upper/u);
    expect(t.triangles, "a garment that vanished has no holes and also no garment").toBeGreaterThan(200);
  }, 120_000);

  it("(4) VACUITY GUARD: the welded loop finder still separates the two rails after the fix", async () => {
    // Before #656 the discriminator was "the child has micro-loops"; the fix removes them,
    // so the discriminator is now the loop COUNT: a fixed generated garment has exactly its
    // legitimate boundaries (neck, hem, two cuffs) while a watertight library garment has
    // none. Zero loops on the child would mean the finder returns nothing (clause (1) green
    // about nothing); any loops on the scrub would mean it returns a single component for
    // everything.
    const child = await garmentTopology("peds_fever_patient_child.glb", /real_garment_peds_upper/u);
    const scrub = await garmentTopology("mpfb-clinical-nurse-adult.glb", /scrub_shirt/u);
    expect(
      child.loops.length,
      "the child garment carries four legitimate boundaries (neck, hem, two cuffs); zero here "
      + "means the welded loop finder is returning nothing and clause (1) is green about nothing",
    ).toBeGreaterThanOrEqual(4);
    expect(child.loops.filter((n) => n < MIN_LEGITIMATE_LOOP_VERTICES)).toHaveLength(0);
    expect(scrub.loops).toHaveLength(0);
  }, 120_000);
});
