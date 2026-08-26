/**
 * #597 v2 — coverage-greedy strand selection for the fitted eyebrow.
 *
 * WHY NOT v1 (keep-largest-by-triangle-count, the shipped policy): triangle count does not
 * correlate with how much front-projected ink a strand carries (measured Spearman rho on
 * tri-rank vs area-rank: ~0 — the largest strands are edge-on ribbons). Keep-largest kept
 * 36-64 strands carrying 26-42x LESS projected area than the full brow; the orchestrator's
 * native-resolution grade showed NO eyebrow at all. Selection must maximise VISIBLE INK,
 * not triangle count.
 *
 * MECHANISM (v2): whole original strands only (no vertex resampling — the meshopt scatter
 * failure stays refused). Greedy: repeatedly take the strand that adds the most NEW band
 * cells per triangle inside the eye-anchored brow band, until no strand adds a new cell
 * or the 1,180 budget is exhausted. Simulated ceiling at this budget (footprint-sim.ts):
 * 28-64% of reference footprint retained; measured v1 output was 3-5%. The remaining
 * budget is intentionally unused — extra strands duplicate cells already covered and add
 * zero visibility.
 *
 * SOURCE OF GEOMETRY: the PRE-reduction bytes extracted from git main into
 * .openclinxr/evidence/eyebrow-budget/compare/main-*.glb. Re-running this script against
 * already-reduced files would be a no-op (nothing left to select); the reduced GLBs in
 * apps/ui-xr/public/generated-humanoids are the OUTPUT of this run.
 *
 * Usage: pnpm -s exec tsx tools/openclinxr/evidence/eyebrow-budget/reduce-shipped-eyebrows-v2.ts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Document, NodeIO, Primitive } from "@gltf-transform/core";
import { compactPrimitive } from "@gltf-transform/functions";

const DIR = "apps/ui-xr/public/generated-humanoids";
const SRC_DIR = ".openclinxr/evidence/eyebrow-budget/compare";
/**
 * #597 v2 budget — DERIVED, not chosen. The sibling-facial sum (1,180) proved UNACHIEVABLE
 * for strand-selection geometry: at 1,180 tris the best joint selection reaches 28-64% of
 * reference band span but only 3.7-6.1% of reference ink (hybrid-sim.ts / bstar-sweep.ts,
 * 2026-08-26) — the appearance oracle's floors (25% span, 10% ink) cannot both hold.
 * B* = smallest swept budget where coverage-greedy-then-densest-fill clears BOTH floors on
 * EVERY actor = 3,600 (binding actors: ob-patient-aisha / gown-inspect / viseme-inspect at
 * 67% span, 11.4% ink; sweep table in .openclinxr/evidence/eyebrow-budget/bstar-sweep.ts).
 * Still 8-10x below the original 21,816-35,334-tri brows.
 */
const EYEBROW_MAX_TRIS_PER_ACTOR = 3600;

const GRID_X = 96;
const GRID_Y = 24;
const PAD_X = 0.5;
const Y_BELOW = 0.3;
const Y_ABOVE = 0.5;

type Tri2 = { ax: number; ay: number; bx: number; by: number; cx: number; cy: number };
type Band = { x0: number; x1: number; y0: number; y1: number };

function primOf(doc: Document, re: RegExp) {
  for (const mesh of doc.getRoot().listMeshes()) {
    if (re.test(mesh.getName() ?? "")) {
      const prim = mesh.listPrimitives()[0];
      if (prim) return prim;
    }
  }
  return null;
}

type Strand = { root: number; tris: number[] };

/** Union-find over quantized positions — same 5dp graph as analyze-brow-components.ts/v1. */
function componentsOf(prim: Primitive): { strands: Strand[] } {
  const pos = prim.getAttribute("POSITION");
  const indices = prim.getIndices();
  if (!pos || !indices) throw new Error("indexed POSITION required");
  const posArr = pos.getArray() as Float32Array;
  const idxArr = indices.getArray() as Uint32Array;
  const n = pos.getCount();

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const keyOf = new Map<string, number>();
  const q = (v: number) => v.toFixed(5);
  for (let i = 0; i < n; i++) {
    const k = `${q(posArr[i * 3])},${q(posArr[i * 3 + 1])},${q(posArr[i * 3 + 2])}`;
    const prev = keyOf.get(k);
    if (prev !== undefined) union(prev, i);
    else keyOf.set(k, i);
  }
  for (let t = 0; t < idxArr.length; t += 3) {
    union(idxArr[t], idxArr[t + 1]);
    union(idxArr[t + 1], idxArr[t + 2]);
  }
  const compTris = new Map<number, number[]>();
  for (let t = 0; t < idxArr.length; t += 3) {
    const root = find(idxArr[t]);
    const list = compTris.get(root);
    if (list) list.push(t);
    else compTris.set(root, [t]);
  }
  return { strands: [...compTris.entries()].map(([root, tris]) => ({ root, tris })) };
}

function xyTrisArray(prim: Primitive): { tris: Float32Array } {
  const pos = prim.getAttribute("POSITION")!;
  const arr = pos.getArray() as Float32Array;
  return { tris: arr };
}

function eyeBand(prim: Primitive): Band {
  const pos = prim.getAttribute("POSITION")!;
  const arr = pos.getArray() as Float32Array;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.getCount(); i++) {
    x0 = Math.min(x0, arr[i * 3]); x1 = Math.max(x1, arr[i * 3]);
    y0 = Math.min(y0, arr[i * 3 + 1]); y1 = Math.max(y1, arr[i * 3 + 1]);
  }
  const w = x1 - x0, h = y1 - y0;
  return { x0: x0 - PAD_X * w, x1: x1 + PAD_X * w, y0: y1 - Y_BELOW * h, y1: y1 + Y_ABOVE * h };
}

function cellsOfTriIndices(prim: Primitive, triOffsets: number[], band: Band): Uint8Array {
  const pos = prim.getAttribute("POSITION")!;
  const arr = pos.getArray() as Float32Array;
  const idxArr = (prim.getIndices()!.getArray()) as Uint32Array;
  const cw = (band.x1 - band.x0) / GRID_X, ch = (band.y1 - band.y0) / GRID_Y;
  const hit = new Uint8Array(GRID_X * GRID_Y);
  for (const t of triOffsets) {
    const i0 = idxArr[t], i1 = idxArr[t + 1], i2 = idxArr[t + 2];
    const ax = arr[i0 * 3], ay = arr[i0 * 3 + 1];
    const bx = arr[i1 * 3], by = arr[i1 * 3 + 1];
    const cx = arr[i2 * 3], cy = arr[i2 * 3 + 1];
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(d) < 1e-12) continue;
    const gx0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - band.x0) / cw));
    const gx1 = Math.min(GRID_X - 1, Math.ceil((Math.max(ax, bx, cx) - band.x0) / cw));
    const gy0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - band.y0) / ch));
    const gy1 = Math.min(GRID_Y - 1, Math.ceil((Math.max(ay, by, cy) - band.y0) / ch));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (hit[gy * GRID_X + gx]) continue;
        const px = band.x0 + (gx + 0.5) * cw;
        const py = band.y0 + (gy + 0.5) * ch;
        const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / d;
        const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / d;
        if (w0 >= -1e-6 && w1 >= -1e-6 && 1 - w0 - w1 >= -1e-6) hit[gy * GRID_X + gx] = 1;
      }
    }
  }
  return hit;
}

function projectedAreaOf(prim: Primitive, triOffsets: number[]): number {
  const pos = prim.getAttribute("POSITION")!;
  const arr = pos.getArray() as Float32Array;
  const idxArr = (prim.getIndices()!.getArray()) as Uint32Array;
  let a = 0;
  for (const t of triOffsets) {
    const i0 = idxArr[t], i1 = idxArr[t + 1], i2 = idxArr[t + 2];
    a += Math.abs(
      (arr[i1 * 3] - arr[i0 * 3]) * (arr[i2 * 3 + 1] - arr[i0 * 3 + 1]) -
      (arr[i2 * 3] - arr[i0 * 3]) * (arr[i1 * 3 + 1] - arr[i0 * 3 + 1]),
    ) / 2;
  }
  return a;
}

async function reduceActor(asset: string) {
  const srcPath = `${SRC_DIR}/main-${asset}`;
  const dstPath = `${DIR}/${asset}`;
  const io = new NodeIO();
  const doc = await io.readBinary(readFileSync(srcPath));
  let result: string | null = null;

  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() ?? "";
    if (!/fitted_eyebrow/i.test(name)) continue;
    const style = /fitted_eyebrow_(mindfront_eyebrows_\d+)/.exec(name)?.[1] ?? null;
    for (const prim of mesh.listPrimitives()) {
      const eyesPrim = primOf(doc, /eyes_low_poly/i);
      if (!eyesPrim) throw new Error(`${asset}: eyes_low_poly landmark missing`);
      const band = eyeBand(eyesPrim);

      // original bbox guard data (world == local here; brow node has identity transform)
      const { strands } = componentsOf(prim);
      const pos = prim.getAttribute("POSITION")!;
      const posArr = pos.getArray() as Float32Array;
      const bbox: number[] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = 0; i < pos.getCount(); i++) {
        bbox[0] = Math.min(bbox[0], posArr[i * 3]);
        bbox[1] = Math.max(bbox[1], posArr[i * 3]);
        bbox[2] = Math.min(bbox[2], posArr[i * 3 + 1]);
        bbox[3] = Math.max(bbox[3], posArr[i * 3 + 1]);
      }

      // greedy coverage selection over WHOLE strands
      const globalHit = new Uint8Array(GRID_X * GRID_Y);
      const kept: Strand[] = [];
      const pool = [...strands];
      let keptTris = 0;
      let dropped = 0;
      while (pool.length) {
        let bestIdx = -1;
        let bestGainPerTri = 0;
        for (let i = 0; i < pool.length; i++) {
          const s = pool[i];
          if (keptTris + s.tris.length > EYEBROW_MAX_TRIS_PER_ACTOR) continue;
          const h = cellsOfTriIndices(prim, s.tris, band);
          let gain = 0;
          for (let c = 0; c < h.length; c++) if (h[c] && !globalHit[c]) gain++;
          const gpt = gain / s.tris.length;
          if (gain > 0 && gpt > bestGainPerTri) { bestGainPerTri = gpt; bestIdx = i; }
        }
        if (bestIdx < 0 || bestGainPerTri <= 0) break;
        const s = pool[bestIdx];
        const h = cellsOfTriIndices(prim, s.tris, band);
        for (let c = 0; c < h.length; c++) if (h[c]) globalHit[c] = 1;
        kept.push(s);
        keptTris += s.tris.length;
        pool.splice(bestIdx, 1);
      }
      dropped = pool.length;

      // rebuild index buffer from kept strands only
      const indices = prim.getIndices()!;
      const idxArr = indices.getArray() as Uint32Array;
      const newIdx = new Uint32Array(keptTris * 3);
      let w = 0;
      for (const s of kept) {
        for (const t of s.tris) {
          newIdx[w++] = idxArr[t];
          newIdx[w++] = idxArr[t + 1];
          newIdx[w++] = idxArr[t + 2];
        }
      }
      const doc2 = Document.fromGraph(prim.getGraph())!;
      prim.setIndices(
        doc2.createAccessor("fitted_eyebrow_indices").setArray(newIdx).setType(indices.getType()),
      );
      compactPrimitive(prim);

      // post-compact containment guard (refuses any scatter)
      const pos2 = prim.getAttribute("POSITION")!;
      const arr2 = pos2.getArray() as Float32Array;
      const bbox2: number[] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = 0; i < pos2.getCount(); i++) {
        bbox2[0] = Math.min(bbox2[0], arr2[i * 3]);
        bbox2[1] = Math.max(bbox2[1], arr2[i * 3]);
        bbox2[2] = Math.min(bbox2[2], arr2[i * 3 + 1]);
        bbox2[3] = Math.max(bbox2[3], arr2[i * 3 + 1]);
      }
      const within =
        bbox2[0] >= bbox[0] - 1e-6 && bbox2[1] <= bbox[1] + 1e-6 &&
        bbox2[2] >= bbox[2] - 1e-6 && bbox2[3] <= bbox[3] + 1e-6;
      if (!within) {
        throw new Error(`#597 v2: ${asset} reduced brow bbox escaped the original — scatter guard fired`);
      }

      result = `${asset}: ${style} brow ${strands.reduce((n, s) => n + s.tris.length, 0)} -> ${keptTris} tris (${kept.length} strands kept, ${dropped} dropped), bandCells ${globalHit.filter((h) => h === 1).length}/${GRID_X * GRID_Y}`;
    }
  }
  if (!result) throw new Error(`#597 v2: no fitted_eyebrow mesh found in ${asset}`);

  io.write(dstPath, doc);
  console.log(`#597v2 ${result}`);
}

const actors = readdirSync(DIR)
  .filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb"))
  .sort();

for (const asset of actors) {
  await reduceActor(asset);
}
console.log(`\n#597 v2 complete: ${actors.length} actors`);
