/**
 * #597 — budget ladder for mpfb-ob-patient-aisha. Finds N = the smallest eyebrow budget
 * at which a whole-strand selection READS as a brow, by re-running the same selection
 * policy family (coverage-greedy then densest-ink-per-tri fill — the in-bake station's
 * policy, bstar-sweep select()) on the PRE-reduction main bytes at each budget, writing
 * each step's reduced GLB into a distinct scratch dir with the oracle's cov/ink numbers.
 *
 * The shipped cast was reduced by the greedy-only variant (reduce-shipped-eyebrows-v2.ts,
 * exact triangle-set match on all 11 actors); this ladder uses greedy+densest because the
 * greedy phase alone flatlines at 6,366 tris above a ~6,500 budget (no strand adds a new
 * band cell) and cannot spend 10,000/20,000 — see the probe in the slice evidence.
 *
 * Usage: pnpm -s exec tsx tools/openclinxr/evidence/eyebrow-budget/ladder-rebake.ts <budget> <outGlb>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Document, NodeIO, type Primitive } from "@gltf-transform/core";
import { compactPrimitive } from "@gltf-transform/functions";

const PRE = ".openclinxr/evidence/eyebrow-budget/compare/main-mpfb-ob-patient-aisha.glb";
const GRID_X = 96, GRID_Y = 24, PAD_X = 0.5, Y_BELOW = 0.3, Y_ABOVE = 0.5;
/** oracle reference pins for aisha (the-reduced-eyebrow-still-spans-and-darkens-the-brow-band.test.ts) */
const REF = { covFrac: 0.122, inkPerEye: 1.24 };

function primOf(doc: Document, re: RegExp) {
  for (const mesh of doc.getRoot().listMeshes()) {
    if (re.test(mesh.getName() ?? "")) {
      const prim = mesh.listPrimitives()[0];
      if (prim) return prim;
    }
  }
  return null;
}

function componentsOf(prim: Primitive) {
  const pos = prim.getAttribute("POSITION")!;
  const indices = prim.getIndices()!;
  const posArr = pos.getArray() as Float32Array;
  const idxArr = indices.getArray() as Uint32Array;
  const n = pos.getCount();
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const keyOf = new Map<string, number>();
  const q = (v: number) => v.toFixed(5);
  for (let i = 0; i < n; i++) {
    const k = `${q(posArr[i*3])},${q(posArr[i*3+1])},${q(posArr[i*3+2])}`;
    const p = keyOf.get(k); if (p !== undefined) union(p, i); else keyOf.set(k, i);
  }
  for (let t = 0; t < idxArr.length; t += 3) { union(idxArr[t], idxArr[t+1]); union(idxArr[t+1], idxArr[t+2]); }
  const compTris = new Map<number, number[]>();
  for (let t = 0; t < idxArr.length; t += 3) {
    const r = find(idxArr[t]); const l = compTris.get(r); if (l) l.push(t); else compTris.set(r, [t]);
  }
  return { strands: [...compTris.entries()].map(([root, tris]) => ({ root, tris, nTris: tris.length })), idxArr, posArr };
}

function eyeBand(doc: Document) {
  const eyes = primOf(doc, /eyes_low_poly/i)!;
  const pos = eyes.getAttribute("POSITION")!;
  const arr = pos.getArray() as Float32Array;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.getCount(); i++) {
    x0 = Math.min(x0, arr[i*3]); x1 = Math.max(x1, arr[i*3]);
    y0 = Math.min(y0, arr[i*3+1]); y1 = Math.max(y1, arr[i*3+1]);
  }
  const w = x1 - x0, h = y1 - y0;
  return { x0: x0 - PAD_X*w, x1: x1 + PAD_X*w, y0: y1 - Y_BELOW*h, y1: y1 + Y_ABOVE*h };
}

function cellsOfTriOffsets(prim: Primitive, offsets: number[], band: ReturnType<typeof eyeBand>): Uint8Array {
  const pos = prim.getAttribute("POSITION")!;
  const arr = pos.getArray() as Float32Array;
  const idxArr = (prim.getIndices()!.getArray()) as Uint32Array;
  const cw = (band.x1 - band.x0) / GRID_X, ch = (band.y1 - band.y0) / GRID_Y;
  const hit = new Uint8Array(GRID_X * GRID_Y);
  for (const t of offsets) {
    const i0 = idxArr[t], i1 = idxArr[t+1], i2 = idxArr[t+2];
    const ax = arr[i0*3], ay = arr[i0*3+1], bx = arr[i1*3], by = arr[i1*3+1], cx = arr[i2*3], cy = arr[i2*3+1];
    const d = (bx-ax)*(cy-ay) - (cx-ax)*(by-ay);
    if (Math.abs(d) < 1e-12) continue;
    const gx0 = Math.max(0, Math.floor((Math.min(ax,bx,cx) - band.x0) / cw));
    const gx1 = Math.min(GRID_X-1, Math.ceil((Math.max(ax,bx,cx) - band.x0) / cw));
    const gy0 = Math.max(0, Math.floor((Math.min(ay,by,cy) - band.y0) / ch));
    const gy1 = Math.min(GRID_Y-1, Math.ceil((Math.max(ay,by,cy) - band.y0) / ch));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      if (hit[gy*GRID_X+gx]) continue;
      const px = band.x0 + (gx+0.5)*cw, py = band.y0 + (gy+0.5)*ch;
      const w0 = ((bx-px)*(cy-py) - (cx-px)*(by-py)) / d;
      const w1 = ((cx-px)*(ay-py) - (ax-px)*(cy-py)) / d;
      if (w0 >= -1e-6 && w1 >= -1e-6 && 1-w0-w1 >= -1e-6) hit[gy*GRID_X+gx] = 1;
    }
  }
  return hit;
}

function projectedAreaOf(prim: Primitive, offsets: number[]): number {
  const pos = prim.getAttribute("POSITION")!;
  const arr = pos.getArray() as Float32Array;
  const idxArr = (prim.getIndices()!.getArray()) as Uint32Array;
  let a = 0;
  for (const t of offsets) {
    const i0 = idxArr[t], i1 = idxArr[t+1], i2 = idxArr[t+2];
    a += Math.abs((arr[i1*3]-arr[i0*3])*(arr[i2*3+1]-arr[i0*3+1]) - (arr[i2*3]-arr[i0*3])*(arr[i1*3+1]-arr[i0*3+1])) / 2;
  }
  return a;
}

async function main() {
  const budget = Number(process.argv[2]);
  const outGlb = process.argv[3];
  if (!budget || !outGlb) throw new Error("usage: ladder-rebake.ts <budget> <outGlb>");
  const srcBytes = readFileSync(PRE);
  const doc = await new NodeIO().readBinary(srcBytes);
  const brow = primOf(doc, /fitted_eyebrow/i)!;
  const band = eyeBand(doc);
  const { strands, idxArr } = componentsOf(brow);

  // bstar-sweep select(): phase 1 coverage-greedy, phase 2 densest-ink-per-tri fill
  const pool = [...strands];
  const kept: number[] = [];
  let used = 0;
  const globalHit = new Uint8Array(GRID_X * GRID_Y);
  while (pool.length) {
    let bestIdx = -1, bestGpt = 0;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      if (used + s.nTris > budget) continue;
      const h = cellsOfTriOffsets(brow, s.tris, band);
      let gain = 0;
      for (let c = 0; c < h.length; c++) if (h[c] && !globalHit[c]) gain++;
      const gpt = gain / s.nTris;
      if (gain > 0 && gpt > bestGpt) { bestGpt = gpt; bestIdx = i; }
    }
    if (bestIdx < 0 || bestGpt <= 0) break;
    const s = pool[bestIdx];
    const h = cellsOfTriOffsets(brow, s.tris, band);
    for (let c = 0; c < h.length; c++) if (h[c]) globalHit[c] = 1;
    kept.push(...s.tris); used += s.nTris; pool.splice(bestIdx, 1);
  }
  const posArr = brow.getAttribute("POSITION")!.getArray() as Float32Array;
  const areaOf = (t: number) => {
    const i0 = idxArr[t], i1 = idxArr[t+1], i2 = idxArr[t+2];
    return Math.abs((posArr[i1*3]-posArr[i0*3])*(posArr[i2*3+1]-posArr[i0*3+1]) - (posArr[i2*3]-posArr[i0*3])*(posArr[i1*3+1]-posArr[i0*3+1]))/2;
  };
  const rest = pool.sort((a, b) => {
    const ia = a.tris.reduce((n, t) => n + areaOf(t), 0) / a.nTris;
    const ib = b.tris.reduce((n, t) => n + areaOf(t), 0) / b.nTris;
    return ib - ia;
  });
  for (const s of rest) {
    if (used + s.nTris > budget) continue;
    kept.push(...s.tris); used += s.nTris;
  }

  // rebuild the brow index from kept strands
  const indices = brow.getIndices()!;
  const idxArrOrig = indices.getArray() as Uint32Array;
  const newIdx = new Uint32Array(kept.length * 3);
  let w = 0;
  for (const t of kept) {
    newIdx[w++] = idxArrOrig[t];
    newIdx[w++] = idxArrOrig[t + 1];
    newIdx[w++] = idxArrOrig[t + 2];
  }
  const doc2 = Document.fromGraph(brow.getGraph())!;
  brow.setIndices(
    doc2.createAccessor("fitted_eyebrow_indices").setArray(newIdx).setType(indices.getType()),
  );
  compactPrimitive(brow);

  // oracle metrics on the reduced brow
  const keptOffsets: number[] = [];
  const newIdxArr = brow.getIndices()!.getArray() as Uint32Array;
  for (let t = 0; t < newIdxArr.length; t += 3) keptOffsets.push(t);
  const covHit = cellsOfTriOffsets(brow, keptOffsets, band);
  let covN = 0;
  for (const h of covHit) if (h) covN++;
  const cov = covN / (GRID_X * GRID_Y);
  const browInk = projectedAreaOf(brow, keptOffsets);
  const eyes = primOf(doc, /eyes_low_poly/i)!;
  const eyeOffsets: number[] = [];
  const eIdx = eyes.getIndices()!.getArray() as Uint32Array;
  for (let t = 0; t < eIdx.length; t += 3) eyeOffsets.push(t);
  const eyeInk = projectedAreaOf(eyes, eyeOffsets);
  const inkPerEye = browInk / Math.max(eyeInk, 1e-12);

  // write the reduced GLB
  const io = new NodeIO();
  io.write(outGlb, doc);

  const row = {
    budget,
    outTris: kept.length,
    covFrac: Number(cov.toFixed(4)),
    covPctOfRef: Number(((cov / REF.covFrac) * 100).toFixed(1)),
    inkPerEye: Number(inkPerEye.toFixed(4)),
    inkPctOfRef: Number(((inkPerEye / REF.inkPerEye) * 100).toFixed(1)),
    floors: {
      covFloorPctOfRef: 25,
      inkFloorPctOfRef: 10,
      covClears: cov / REF.covFrac >= 0.25,
      inkClears: inkPerEye / REF.inkPerEye >= 0.1,
    },
    outGlb,
  };
  writeFileSync(
    `.openclinxr/evidence/eyebrow-budget/ladder/b${budget}/row.json`,
    JSON.stringify(row, null, 2) + "\n",
  );
  console.log(JSON.stringify(row, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
