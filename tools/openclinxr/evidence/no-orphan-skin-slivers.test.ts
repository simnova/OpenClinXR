import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Every MPFB actor's visible skin ships as 34–39 disconnected components. Twenty-two to twenty-four of
 * them are orphan slivers at the garment boundaries, and they are what draws the jagged hem edges
 * visible at every shirt hem, sleeve end, trouser cuff and boot top.
 *
 * ## THE MEASUREMENT THAT MADE THIS FILEABLE, AND THE ONE THAT ALMOST KILLED IT
 *
 * These components carry **four unique vertices each**, which is the #121 signature: SOLIDIFY rim
 * geometry re-splitting during glTF export so Blender reports one component and the file reports
 * several (§6t). On that basis I filed #350 and wrote an explicit NOT TESTED: *"a 4-vertex island may
 * be too small to draw the spikes I see."* Four vertices sounds like a speck.
 *
 * **It is not.** Measured 2026-08-12 on `mpfb-peds-nurse-kevin`, bounding box per orphan component:
 *
 *   25 x 15 mm  @ 0.78 H      19 x 21 mm  @ 0.78 H
 *   30 x 10 mm  @ 0.85 H      16 x 26 mm  @ 0.73 H
 *   20 x 26 mm  @ 0.76 H       3 x  2 mm  @ 0.00 H   (the only genuinely small one, at the foot)
 *
 * A full-body capture of this figure is ~1,150 px for 1.760 m, so **1 px ≈ 1.53 mm** and these span
 * **10–20 pixels**. Vertex count and screen size are independent: four vertices describe a quad of any
 * size, and these are long thin quads spanning one to three centimetres along a garment edge. Had I
 * trusted "4 vertices ⇒ invisible" this would have been closed as cosmetic noise.
 *
 * The heights are the tell: 0.73–0.85 H is the shirt hem and sleeve band, which is exactly where the
 * jagged edges appear in the round-17 and #351 captures.
 *
 * ## THE KNOWN-GOOD IS THE GARMENTS, ON THE SAME BODY, THROUGH THE SAME EXPORT
 *
 * On the same actor and the same export path, the garment primitives are clean: `t_shirt` is a SINGLE
 * component, `cargo_pants` is 3 with zero small ones. So this is not "glTF export fragments meshes" in
 * general — it is specific to the skin primitive, whose faces are the ones the hide masks delete
 * around. Deleting faces from a mesh orphans the quads left behind at the boundary.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                    | (1) no slivers | (2) garments whole | (3) skin kept | (4) rim kept | result
 *   ---------------------------------------------|----------------|--------------------|---------------|--------------|--------
 *   a) today                                     |   **FAIL**     |        pass        |     pass      |     pass     | REFUSED
 *   b) hide the whole boundary band              |     pass       |        pass        |   **FAIL**    |     pass     | REFUSED
 *   c) hide everything the garments overlap      |     pass       |        pass        |   **FAIL**    |   **FAIL**   | REFUSED
 *   d) extend the hide mask to the orphaned quads|     pass       |        pass        |     pass      |     pass     | ALL PASS
 *
 * **Removing these quads is a legitimate fix and this contract does not forbid it** — they are skin
 * that a garment already covers, and hiding them is what the mask was for. What (2) and (3) refuse is
 * paying for it with something larger: fragmenting a garment, or hiding whole swathes of skin (an arm,
 * a shin) to make the sliver count zero. The 22 quads are ~0.3% of the skin's triangles, so a fix that
 * costs meaningfully more than that has taken something it should not have.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 3/3. (2), (3) and (4) pass today
 * and are regression nets — (4) in particular guards the shirt/trouser overlap that #341 round 17 and
 * #351 each spent a slice establishing is healthy.
 *
 * NOT TESTED:
 *   - **That removing the slivers removes the jagged look.** The bands coincide and the sizes are
 *     visible, which is a much stronger case than when #350 was filed — but it is still an inference
 *     until a capture is graded. Garment rim geometry at the same edges is an untested alternative
 *     contributor with the same signature.
 *   - **The cause.** #121 diagnosed SOLIDIFY rim re-splitting for a garment shell; nobody has shown
 *     that is what happens to the skin here, and hide-mask face deletion orphaning boundary quads is a
 *     different mechanism with the same fingerprint. The fix depends on which, and this contract does
 *     not decide it.
 *   - **Sliver SHAPE.** A bounding box bounds extent, not raggedness. Slivers below the threshold that
 *     still zigzag would pass (§11s).
 *
 * ## FIXED (#350)
 *
 * MECHANISM, measured 2026-08-12 (pre-fix.json + the Blender probe in this slice): the islands are
 * **hide-mask boundary orphaning (mechanism B), not SOLIDIFY rim re-split (mechanism A).**
 *
 *   - 19/22, 19/22, 18/24 orphan components are FULLY position-coincident with the alpha-0
 *     `openclinxr_hidden_*` primitive vertices (the rest are mostly coincident, e.g. 5/6, 8/9,
 *     5/8+5/8 across two hidden prims).
 *   - The Blender probe (`blender_pre_export_probe.py`, same topology chain) reports ONE connected
 *     component pre-export (13,380 unique verts) and **no SOLIDIFY anywhere** in the modifier stack
 *     (only the stripped MASK "Hide helpers"); the mask-free exported probe has no 4-vertex islands.
 *   - The orphaning therefore happens at the mask boundary: a visible skin quad whose four
 *     edge-neighbours are all hidden-material quads (the per-polygon sawtooth + the round-7/9
 *     unhide/rehide toggles) becomes a lone 4-vertex island when the exporter splits the mesh by
 *     material and duplicates boundary vertices.
 *
 * FIX (treatment (d) in the header table): `materialize_mpfb_humanoid_candidate.py` extends the hide
 * mask to the orphaned quads — after every mask slot (upper/lower/foot + render-truth rehide), a
 * position-merged union-find over the skin-material region paints every component of <=12 unique
 * vertices with a fresh `openclinxr_hidden_orphan_*` material (33/42/53 polygons on aisha/nurse/
 * child, all at the garment boundaries). Geometry, rig, shape keys and the garment meshes are
 * untouched; only polygon material indices change, exactly like every other mask slot.
 *
 * MEASURED after the fix (same discriminator, same merge):
 *
 *   actor            skin tris   slivers(>8mm)   garment orphans   overlap
 *   ---------------- ---------   -------------   ---------------   -------
 *   aisha            19,632      0               0                 19.6 mm
 *   nurse_kevin      19,440      0               0                 17.8 mm
 *   patient_child    19,648      0               0                 13.4 mm
 *
 * The 22/22/24 orphans are gone; skinTris lost only the 33-53 hidden quads (~0.3%); the garments
 * stayed whole and the shirt/trouser overlap is unchanged. Clause (1) flipped; (2)/(3)/(4) hold.
 * NOT TESTED: that the grade capture shows clean hems (the orchestrator grades captures; the bands
 * and sizes now match the slivers seen in round-15, but that remains an inference until a capture
 * is graded), and which specific unhide/rehide toggle produced each enclosed quad.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** 1 px is ~1.53 mm in a full-body capture. 8 mm is ~5 px — below any reasonable "visible" bar. */
const MAX_ORPHAN_EXTENT_MM = 8;

/** A component this small in vertex count is an orphan, not a legitimate separate body part. */
const ORPHAN_MAX_VERTS = 12;

/** Ambient skin triangles: 19,698 / 19,348 / 19,558. 19,000 is ~2% below the lowest. */
const MIN_SKIN_TRIS = 19_000;

/** The garments are the known-good: t_shirt is 1 component, cargo_pants 3, zero orphans. */
const MAX_GARMENT_ORPHANS = 0;

/** #341 round 17 and #351 both established this overlap is healthy at 13.4-19.6 mm. */
const MIN_OVERLAP_MM = 8;

type Row = {
  file: string;
  skinTris: number;
  orphanSlivers: string[];
  garmentOrphans: number;
  overlapMm: number;
};

const io = new NodeIO();

/** Connected components over position-merged vertices. */
function componentVertexGroups(pos: number[][], idx: number[]): number[][] {
  const key = new Map<string, number>();
  const rep: number[] = [];
  for (let i = 0; i < pos.length; i++) {
    const k = pos[i]!.map((v) => v.toFixed(5)).join(",");
    if (!key.has(k)) key.set(k, key.size);
    rep[i] = key.get(k)!;
  }
  const parent = Array.from({ length: key.size }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(rep[idx[t]!]!);
    const b = find(rep[idx[t + 1]!]!);
    if (a !== b) parent[a] = b;
    const b2 = find(rep[idx[t + 1]!]!);
    const c = find(rep[idx[t + 2]!]!);
    if (b2 !== c) parent[b2] = c;
  }
  const members = new Map<number, number[]>();
  for (let i = 0; i < pos.length; i++) {
    const r = find(rep[i]!);
    const list = members.get(r) ?? [];
    if (list.length === 0) members.set(r, list);
    list.push(i);
  }
  return [...members.values()];
}

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  let skinTris = 0;
  let garmentOrphans = 0;
  const orphanSlivers: string[] = [];
  let pantsTop = -Infinity;
  let shirtBot = Infinity;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mat?.getAlphaMode() === "MASK" && (mat?.getBaseColorFactor()?.[3] ?? 1) === 0) continue;
      const a = prim.getAttribute("POSITION");
      const ix = prim.getIndices();
      if (!a || !ix) continue;
      const name = `${mesh.getName()}/${mat?.getName() ?? ""}`;
      const isSkin = /skin/i.test(name);
      const isPants = /cargo_pants/.test(name);
      // #180: the nurse's upper garment is now `makeclothes_library_scrub_shirt_*` —
      // the overlap clause must keep measuring it.
      const isShirt = /t_shirt|scrub/.test(name);

      const pos: number[][] = [];
      for (let i = 0; i < a.getCount(); i++) pos.push(a.getElement(i, [0, 0, 0]) as number[]);
      for (const v of pos) {
        if (isPants && v[1]! > pantsTop) pantsTop = v[1]!;
        if (isShirt && v[1]! < shirtBot) shirtBot = v[1]!;
      }
      if (!isSkin && !isPants && !isShirt) continue;

      const idx: number[] = [];
      for (let i = 0; i < ix.getCount(); i++) idx.push(ix.getScalar(i));
      if (isSkin) skinTris += idx.length / 3;

      for (const group of componentVertexGroups(pos, idx)) {
        const unique = new Set(group.map((i) => pos[i]!.map((x) => x.toFixed(5)).join(","))).size;
        if (unique > ORPHAN_MAX_VERTS) continue;
        let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
        for (const i of group) {
          const v = pos[i]!;
          mnX = Math.min(mnX, v[0]!); mxX = Math.max(mxX, v[0]!);
          mnY = Math.min(mnY, v[1]!); mxY = Math.max(mxY, v[1]!);
          mnZ = Math.min(mnZ, v[2]!); mxZ = Math.max(mxZ, v[2]!);
        }
        const extentMm = Math.max(mxX - mnX, mxY - mnY, mxZ - mnZ) * 1000;
        if (extentMm <= MAX_ORPHAN_EXTENT_MM) continue;
        if (isSkin) orphanSlivers.push(`${extentMm.toFixed(0)}mm/${unique}v`);
        else garmentOrphans++;
      }
    }
  }
  if (skinTris === 0) return null;
  return {
    file: rel.split("/").pop()!,
    skinTris,
    orphanSlivers,
    garmentOrphans,
    overlapMm: Number.isFinite(pantsTop) && Number.isFinite(shirtBot) ? (pantsTop - shirtBot) * 1000 : 0,
  };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `MPFB bodies with a skin primitive (scanned ${files.length})`).toBeGreaterThanOrEqual(3);
}

describe("no orphan skin slivers at the garment edges", () => {
  it("(1) RED (FIXED #350): the skin carries no visible orphan slivers", () => {
    requireRows();
    expect(
      rows
        .filter((r) => r.orphanSlivers.length > 0)
        .map((r) => `${r.file}: ${r.orphanSlivers.length} slivers over ${MAX_ORPHAN_EXTENT_MM}mm [${r.orphanSlivers.slice(0, 5).join(", ")}]`),
      `orphan skin components wider than ${MAX_ORPHAN_EXTENT_MM} mm`,
    ).toEqual([]);
  });

  it("(2) NET known-good: the garments stay whole", () => {
    // The garments are clean today through the same export path. A fix must not fragment them.
    requireRows();
    const frag = rows
      .filter((r) => r.garmentOrphans > MAX_GARMENT_ORPHANS)
      .map((r) => `${r.file}: ${r.garmentOrphans} garment orphans`);
    expect(frag, "garments fragmented into orphan pieces").toEqual([]);
  });

  it("(3) NET known-good: the skin is not gutted to clear the slivers", () => {
    // The 22 quads are ~0.3% of the skin. Refuses hiding an arm or a shin to make (1) green.
    requireRows();
    const gutted = rows
      .filter((r) => r.skinTris < MIN_SKIN_TRIS)
      .map((r) => `${r.file}: skinTris=${r.skinTris}`);
    expect(gutted, `skin below ${MIN_SKIN_TRIS} triangles`).toEqual([]);
  });

  it("(4) NET known-good: the shirt/trouser overlap survives", () => {
    requireRows();
    const bare = rows
      .filter((r) => r.overlapMm < MIN_OVERLAP_MM)
      .map((r) => `${r.file}: overlap=${r.overlapMm.toFixed(1)}mm`);
    expect(bare, `overlap below ${MIN_OVERLAP_MM} mm`).toEqual([]);
  });
});
