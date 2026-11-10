import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoRoot } from "@openclinxr/factory-station-core/runner";

process.chdir(repoRoot());

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
 *
 * ## FIXED (#555) — appended; the planted header above is immutable
 *
 *   tool: gltf-transform prune (CLI 4.3.0) — Removed types... Texture (1) per file; no rebake.
 *   mpfb-ob-patient-aisha.glb    24291640 → 16405412  (−7,886,228 B)  orphanBytesAfter=0
 *   mpfb-peds-parent-aisha.glb   24291644 → 16405412  (−7,886,232 B)  orphanBytesAfter=0
 *   Pinned invariants held: boundTextures 4, boundBytes 3168198, meshes 10, materials 17,
 *   tris 131328, joints 137, animations 2. Shoe.png not re-consumed.
 *   Evidence: tools/openclinxr/evidence/unbound-texture-prune.json
 *
 * ## ADAPTED (ci-w11) 2026-10-30 — appended; the planted header and both blocks above are immutable.
 * afe8abced reintroduced orphans (not Shoe: skin-normal maps orphaned by the 2026-10-10
 * normalTexture strips, a T-shirt_basic.png duplicate on tara, and a dead T-shirt material on
 * the gown). Five files, 5144449 B total:
 *
 *   asset                        file      orphan
 *   mpfb-family-partner-adult    10529116  1091596  skin-normal
 *   mpfb-gown-adult-patient      20462500  1063690  image + dead T-shirt material (392852) + 923 dead accessors
 *   mpfb-ob-patient-aisha        10069400  1080156  skin-normal
 *   mpfb-peds-parent-aisha       19888836   744895  T-shirt_basic.png duplicate
 *   mpfb-peds-patient-child      11743228  1164112  skin-normal
 *
 *   tool: gltf-transform prune 4.3.0 (same CLI + flags as #555) — Texture removals 1/2/1/1/1,
 *   orphanBytesAfter 0 on all five. Post-prune bytes: 9277296 / 6763692 / 8828240 / 18441636 /
 *   10418728. Gown freed 13698808: the orphan image + the unreferenced material + ~12 MB of
 *   dead accessors; meshes 10, tris 40277, joints 138, animations 4 unchanged, materials 17->16
 *   (the dead material). All other files: every geometry/rig/animation invariant unchanged.
 *   PINNED re-based to the deliberate pre-prune state (citations on the PINNED block) and the
 *   floor re-derived from measured per-pinned-file orphans (700K under min 744895). Shoe still
 *   refused: bound bytes stay <= pin on both aishas.
 *   Evidence: tools/openclinxr/evidence/unbound-texture-prune-2026-10-30.json
 */

const DIR = "apps/ui-xr/public/generated-humanoids";
/** Pinned from HEAD. A prune must not move any of these. */
// ci-w11 2026-10-30 re-pin: the #598 pins below were superseded by deliberate rebakes
// (tightjeans re-bake 2803b7746, HB-02 42c42140a, walk graft 91aa4b5d3, 7d71273e3/9f2934536,
// 10768617f; tara full-res afe8abced; own D2 grade 5792dd39c and D3 repairs 344853d7d/c35888280).
// Re-pinned to the measured pre-prune deliberate state (rotation: ALSO update these four numbers
// after any future deliberate rebake, citing its commit — never to match a regression).
const PINNED = {
  // ci-w11 re-pin 2026-10-30, measured pre-prune. Old #598: fileBytes 11395580, textures 5,
  // boundTextures 5, boundBytes 4580867, tris 74642, animations 2.
  // mesh-defects re-pin 2026-10-31: gravidGarmentRestore (sidecar) swapped the fp-r0.4 tee and
  // jeans for the full-resolution #581 primitives from 57e277301 (+761132 B, +3879 tris; textures
  // untouched). Pre-prune pin carried forward by the same deltas; was fileBytes 10069400, tris 69067.
  // st-redgarm 2026-11-02: tris 72946 -> 73392 after 1225b8f95 restored the toigo flats (+446).
  // st-vitskin 2026-11-05: d44fafa31 embeds the aisha-curv-cav-1024 RG map (213249 B), bound by the
  // OPENCLINXR_skin_shade material extension; core slots untouched: boundTextures 5 -> 6,
  // boundBytes 4246964 -> 4460213 (+213249 B, exactly that image).
  // st-viteye 2026-11-04: 931343e6b swaps the Vitruvian iris/sclera image into the same eye slot
  // (count unchanged): boundBytes 4460213 -> 4567933 (+107720 B, that image re-encode).
  // st-vitpore r2 2026-11-04: patch_glb_skin_shade embeds the 191439 B periodic pore detail
  // normal; core slots stay untouched, boundTextures 6 -> 7 and boundBytes grows exactly 191439 B.
  // st-vitfamily r1 R4 re-pinned 2026-11-06: fixed8 (D4a exemplar inpaint + D4b
  // temple fill) lossless embed, sha-pinned input 93c00837; fileBytes 19144852 -> 19149460,
  // boundBytes 13690549 -> 13695156 (+4607 B, PNG re-encode of the fixed8 albedo; geometry/rig/animations verbatim).
  // Prior st-vitfamily r1 R3: fixed3 (fixed2 exemplar brow inpaint +
  // D4b temple fill) lossless embed, sha-pinned input e944e07f; fileBytes 19095616 -> 19144852,
  // boundBytes 13641312 -> 13690549 (+49237 B, PNG re-encode of the filled albedo; geometry/rig/animations verbatim).
  // Prior st-vitfamily r1: first albedo embed (fileBytes 10219564 -> 19097100,
  // boundBytes 4765237 -> 13642796);
  // lash-follow r8 2026-11-09 (tsk_381fda384bdda8dc): repack adds upper-lash closure morph targets (accessors only);
  // fileBytes 19149460 -> 19549552 (+400092 B); images, boundBytes, meshes, materials, tris, joints, animations verbatim.
  // Teeth swap tsk_27e0cec12cab410d (fitted CC0 teeth/tongue replace hm08, byte-preserving retreat):
  // fileBytes 19549552 -> 22269564; textures/boundTextures 7 -> 9 and boundBytes 13695156 -> 16120505
  // (+2425349 B = teeth.png 1799930 + tongue01_diffuse.png 625419); materials 17 -> 19; tris 73392 -> 80320.
  "mpfb-ob-patient-aisha.glb":  { fileBytes: 22269564, textures: 9, boundTextures: 9, boundBytes: 16120505, meshes: 10, materials: 19, tris: 80320, joints: 137, animations: 3 },
  // ci-w11 re-pin 2026-10-30, measured pre-prune (post-afe8abced full-res hair + D2 grade).
  // Old #598: fileBytes 11456228, textures 5, boundTextures 5, boundBytes 4598965, tris 74732.
  // st-palette 2026-11-04: 3969ae031 re-encoded the toigo t-shirt texture (sRGB palette renorm,
  // same texture slot, count unchanged): boundBytes 10641749 -> 10646616 (+4867 B, PNG re-encode).
  // lash-follow r8 2026-11-09 (tsk_381fda384bdda8dc): repack adds upper-lash closure morph targets (accessors only);
  // fileBytes 18883952 -> 19283980 (+400028 B); images, boundBytes, meshes, materials, tris, joints, animations verbatim.
  "mpfb-peds-parent-aisha.glb": { fileBytes: 19283980, textures: 13, boundTextures: 13, boundBytes: 11083161, meshes: 10, materials: 17, tris: 73012, joints: 137, animations: 2 },
} as const;
/** Re-derived 2026-10-30 from measurement, not chosen: pre-prune per-pinned-file orphans are
 * ob 1080156 / pp 744895, so each PINNED file must lose at least 700 KB. The old 7M floor died
 * with the 7.41 MB Shoe orphans (deliberate rebake chain above + #555 prune). */
const MIN_BYTES_FREED = 700_000;

type Shape = { textures: number; boundTextures: number; boundBytes: number; orphanBytes: number; meshes: number; materials: number; tris: number; joints: number; animations: number };

type GltfJson = { textures?: { source?: number }[]; materials?: { extensions?: Record<string, unknown> }[] };

function extensionBoundImageIndices(glb: Buffer): number[] {
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as GltfJson;
  const out: number[] = [];
  for (const material of json.materials ?? [])
    for (const extension of Object.values(material.extensions ?? {}))
      for (const slot of Object.values((extension ?? {}) as Record<string, unknown>)) {
        const index = (slot as { index?: unknown } | null)?.index;
        const source = typeof index === "number" ? json.textures?.[index]?.source : undefined;
        if (typeof source === "number") out.push(source);
      }
  return out;
}

async function shapeOf(file: string): Promise<Shape> {
  const { NodeIO } = await import("@gltf-transform/core");
  const doc = await new NodeIO().read(`${DIR}/${file}`);
  const r = doc.getRoot();
  const bound = new Set<unknown>();
  for (const m of r.listMaterials())
    for (const g of [m.getBaseColorTexture(), m.getNormalTexture(), m.getEmissiveTexture(), m.getOcclusionTexture(), m.getMetallicRoughnessTexture()])
      if (g) bound.add(g);
  // st-vitskin 2026-11-05: a material EXTENSION textureInfo (OPENCLINXR_skin_shade.curvatureTexture)
  // binds an image too. gltf-transform drops unregistered extensions on read, so follow the raw
  // JSON: materials[].extensions.*.<slot>.index -> textures[index].source -> image (listTextures order).
  for (const source of extensionBoundImageIndices(readFileSync(`${DIR}/${file}`))) {
    const t = r.listTextures()[source];
    if (t) bound.add(t);
  }
  let total = 0; for (const t of r.listTextures()) total += t.getImage()?.byteLength ?? 0;
  let boundBytes = 0; for (const t of bound) boundBytes += (t as { getImage(): Uint8Array | null }).getImage()?.byteLength ?? 0;
  let tris = 0; for (const m of r.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  return { textures: r.listTextures().length, boundTextures: bound.size, boundBytes, orphanBytes: total - boundBytes,
    meshes: r.listMeshes().length, materials: r.listMaterials().length, tris, joints: r.listSkins()[0]?.listJoints().length ?? 0,
    animations: r.listAnimations().length };
}

describe("no shipped humanoid carries an unbound texture", () => {
  it("(1) FIXED (#555): every shipped humanoid GLB has zero orphaned image bytes", async () => {
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
      if (now === pin.fileBytes) continue; // pre-fix state for THIS file; clause (1) owns that failure
      expect(pin.fileBytes - now, `${file}: expected the prune to free >= ${MIN_BYTES_FREED} B`)
        .toBeGreaterThanOrEqual(MIN_BYTES_FREED);
    }
  });
});
