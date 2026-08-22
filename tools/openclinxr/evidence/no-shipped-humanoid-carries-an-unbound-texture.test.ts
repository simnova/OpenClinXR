import { statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **OBSERVABLE: a learner does not download 14.82 MB of leopard print that nothing renders.**
 *
 * #553 dropped the leopard `Shoe.png` from two cast actors by removing the MATERIAL REFERENCE. The
 * image stayed in the BIN. The render is fixed; the payload is not — and any texture budget computed
 * from BOUND textures (including #553's own 9.823 MB figure) understates the transfer cost.
 *
 * ## MEASURED ON HEAD — do not re-derive
 *
 *   asset                        file      orphaned   orphan name
 *   mpfb-ob-patient-aisha.glb    23.2 MB   7.41 MB    Shoe
 *   mpfb-peds-parent-aisha.glb   23.2 MB   7.41 MB    Shoe
 *   ---------------------------------------------------------------
 *   TOTAL                                  14.82 MB
 *
 * **KNOWN-GOOD COLUMN (§9h): the other 16 shipped humanoids carry ZERO orphaned bytes.** The pipeline
 * normally produces orphan-free assets, so these two are outliers — not a standard being tightened.
 *
 * ## THE CHEAP GREEN THIS REFUSES
 *
 * Re-running a full character bake would also remove the orphan — and would re-consume `Shoe.png`,
 * re-authoring the very leopard print #553 removed, while silently re-deriving every other material.
 * Clause (2) pins the invariants a PRUNE preserves and a REBAKE would not: bound texture count and
 * exact bound bytes, mesh/material/triangle/joint counts, and animation count. A prune changes the
 * file size and nothing else.
 *
 * claimScope: unbound image payload in shipped humanoid GLBs.
 * notEvidenceFor: how anything looks; whether the bound textures are correct; Quest readiness; the
 *   gown patient's missing t-shirt texture (that is the same card's second proof, not this one).
 */

const DIR = "apps/ui-xr/public/generated-humanoids";
/** Pinned from HEAD. A prune must not move any of these. */
const PINNED = {
  "mpfb-ob-patient-aisha.glb":  { fileBytes: 24291640, textures: 5, boundTextures: 4, boundBytes: 3168198, meshes: 10, materials: 17, tris: 131328, joints: 137, animations: 2 },
  "mpfb-peds-parent-aisha.glb": { fileBytes: 24291644, textures: 5, boundTextures: 4, boundBytes: 3168198, meshes: 10, materials: 17, tris: 131328, joints: 137, animations: 2 },
} as const;
/** Derived from the measurement, not chosen: the orphan is 7.41 MB, so the file must lose most of it. */
const MIN_BYTES_FREED = 7_000_000;

type Shape = { textures: number; boundTextures: number; boundBytes: number; orphanBytes: number; meshes: number; materials: number; tris: number; joints: number; animations: number };

async function shapeOf(file: string): Promise<Shape> {
  const { NodeIO } = await import("@gltf-transform/core");
  const doc = await new NodeIO().read(`${DIR}/${file}`);
  const r = doc.getRoot();
  const bound = new Set<unknown>();
  for (const m of r.listMaterials())
    for (const g of [m.getBaseColorTexture(), m.getNormalTexture(), m.getEmissiveTexture(), m.getOcclusionTexture(), m.getMetallicRoughnessTexture()])
      if (g) bound.add(g);
  let total = 0; for (const t of r.listTextures()) total += t.getImage()?.byteLength ?? 0;
  let boundBytes = 0; for (const t of bound) boundBytes += (t as { getImage(): Uint8Array | null }).getImage()?.byteLength ?? 0;
  let tris = 0; for (const m of r.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  return { textures: r.listTextures().length, boundTextures: bound.size, boundBytes, orphanBytes: total - boundBytes,
    meshes: r.listMeshes().length, materials: r.listMaterials().length, tris, joints: r.listSkins()[0]?.listJoints().length ?? 0,
    animations: r.listAnimations().length };
}

describe("no shipped humanoid carries an unbound texture", () => {
  it.fails("(1) RED: every shipped humanoid GLB has zero orphaned image bytes", async () => {
    const offenders: string[] = [];
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".glb")).sort()) {
      const s = await shapeOf(f);
      if (s.orphanBytes > 0) offenders.push(`${f}: ${(s.orphanBytes / 1048576).toFixed(2)} MB unbound`);
    }
    expect(offenders, "shipped GLBs carrying image bytes nothing references").toEqual([]);
  }, 120_000);

  it("(2) COUNTERWEIGHT: a PRUNE, not a rebake — every other invariant is pinned", async () => {
    // A full character bake would also clear the orphan, and would re-consume Shoe.png (re-authoring
    // the leopard print #553 removed) while re-deriving every other material. These pins make that
    // path fail: only the file size and the orphan may move.
    for (const [file, pin] of Object.entries(PINNED)) {
      const s = await shapeOf(file);
      expect(s.boundTextures, `${file}: bound texture COUNT must not change`).toBe(pin.boundTextures);
      expect(s.boundBytes, `${file}: bound texture BYTES must be identical — a rebake would re-derive them`).toBe(pin.boundBytes);
      expect(s.meshes, `${file}: mesh count`).toBe(pin.meshes);
      expect(s.materials, `${file}: material count`).toBe(pin.materials);
      expect(s.tris, `${file}: triangle count — a prune touches no geometry`).toBe(pin.tris);
      expect(s.joints, `${file}: joint count`).toBe(pin.joints);
      expect(s.animations, `${file}: animation count — the 15 visemes must survive`).toBe(pin.animations);
      // Shoe must NOT come back bound. Re-consuming it is the leopard print returning.
      expect(s.boundBytes, `${file}: bound bytes must not grow — Shoe.png must not be re-consumed`)
        .toBeLessThanOrEqual(pin.boundBytes);
    }
  }, 120_000);

  it("(3) KNOWN-GOOD COLUMN: the other shipped humanoids were already clean", async () => {
    // If this ever fails, the population widened and clause (1) is no longer about two outliers.
    const others = readdirSync(DIR).filter((x) => x.endsWith(".glb") && !(x in PINNED));
    expect(others.length, "there must be other shipped humanoids to compare against").toBeGreaterThan(5);
    const dirty: string[] = [];
    for (const f of others) { const s = await shapeOf(f); if (s.orphanBytes > 0) dirty.push(f); }
    expect(dirty, "the known-good column must stay clean — these were never part of the #553 strip").toEqual([]);
  }, 180_000);

  it("(4) the file must actually shrink — freeing the reference is not freeing the bytes", () => {
    // #553's strip moved the file +4 bytes while claiming a 7.77 MB drop. Size is the honest witness.
    for (const [file, pin] of Object.entries(PINNED)) {
      const now = statSync(`${DIR}/${file}`).size;
      if (now === pin.fileBytes) return; // pre-fix state; clause (1) owns that failure
      expect(pin.fileBytes - now, `${file}: expected the prune to free >= ${MIN_BYTES_FREED} B`)
        .toBeGreaterThanOrEqual(MIN_BYTES_FREED);
    }
  });
});
