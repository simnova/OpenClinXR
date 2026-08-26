/**
 * #597 — reduce the fitted eyebrow primitives in the SHIPPED MPFB humanoid GLBs to the
 * sibling-facial budget (eyes+lashes+teeth+tongue = 1,180 tris on this rail).
 *
 * MECHANISM: a Mindfront brow is ~1,264 INDEPENDENT strand ribbons in one primitive
 * (measured: components are quad strips of ~30-60 faces). The reduction keeps the LARGEST
 * original strands (greedy, by triangle count) until the budget is reached and drops the
 * rest. Every kept vertex is an original — no resampling, no collapse, no scatter.
 *
 * FAILED TREATMENT, measured 2026-08-26 (do not retry): @gltf-transform simplifyPrimitive
 * with MeshoptSimplifier at error=1 scattered degenerate collapsed strands across the whole
 * body — the brow bbox grew from x[-0.064,0.062]/y[1.551,1.566]/z[0.117,0.149] to
 * x[-0.603,1.564]/y[-1.000,1.564]/z[-0.947,1.564] on mpfb-ob-patient-aisha. Unconstrained
 * meshopt simplification is not safe on a many-tiny-component mesh.
 *
 * The in-bake station in materialize_mpfb_humanoid_candidate.py implements the same
 * keep-largest-strands rule for future bakes. The shipped GLBs are reduced in place rather
 * than re-baked because the exact historical bake flags for the gown/inspect/parent variant
 * assets are not recoverable from the tree and a guessed rebake would silently rewrite
 * their garment story beyond brows.
 *
 * Usage: pnpm -s exec tsx tools/openclinxr/evidence/eyebrow-budget/reduce-shipped-eyebrows.ts
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { Document, NodeIO, Primitive } from "@gltf-transform/core";
import { compactPrimitive } from "@gltf-transform/functions";

const DIR = "apps/ui-xr/public/generated-humanoids";
/** #597 budget: the measured sibling-facial sum on this rail. */
const EYEBROW_MAX_TRIS_PER_ACTOR = 1180;

type Result = {
  asset: string;
  meshName: string;
  style: string | null;
  beforeTris: number;
  afterTris: number;
  keptComponents: number;
  droppedComponents: number;
  bboxWithinOriginal: boolean;
};

/** Union-find over quantized positions, then per-component triangle sets (same 5dp graph the
 * component analysis used, so the numbers here match analyze-brow-components.ts). */
function keepLargestStrands(prim: Primitive, budget: number) {
  const pos = prim.getAttribute("POSITION");
  if (!pos) throw new Error("eyebrow primitive has no POSITION");
  const indices = prim.getIndices();
  if (!indices) throw new Error("eyebrow primitive is not indexed");
  const posArr = pos.getArray() as Float32Array;
  const idxArr = indices.getArray() as Uint32Array;
  const n = pos.getCount();

  const keyOf = new Map<string, number>();
  const parent = new Array<number>(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
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

  // component root -> triangle start offsets
  const compTris = new Map<number, number[]>();
  for (let t = 0; t < idxArr.length; t += 3) {
    const root = find(idxArr[t]);
    const list = compTris.get(root);
    if (list) list.push(t);
    else compTris.set(root, [t]);
  }

  // original bbox (for the scatter guard)
  const bbox: number[] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const v = posArr[i * 3 + a];
      if (v < bbox[a * 2]) bbox[a * 2] = v;
      if (v > bbox[a * 2 + 1]) bbox[a * 2 + 1] = v;
    }
  }

  // greedy: largest strands first, whole strands only, stop at budget
  const comps = [...compTris.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0] - b[0],
  );
  const kept: Array<[number, number[]]> = [];
  let keptTris = 0;
  let dropped = 0;
  for (const [root, tris] of comps) {
    if (keptTris + tris.length <= budget) {
      kept.push([root, tris]);
      keptTris += tris.length;
    } else {
      dropped += 1;
    }
  }

  // rebuild the index buffer from kept strands only
  const newIdx = new Uint32Array(keptTris * 3);
  let w = 0;
  for (const [, tris] of kept) {
    for (const t of tris) {
      newIdx[w++] = idxArr[t];
      newIdx[w++] = idxArr[t + 1];
      newIdx[w++] = idxArr[t + 2];
    }
  }
  const doc = Document.fromGraph(prim.getGraph())!;
  prim.setIndices(
    doc.createAccessor("fitted_eyebrow_indices")
      .setArray(newIdx)
      .setType(indices.getType()),
  );
  compactPrimitive(prim);

  // post-compact bbox must stay inside the original (refuses any scatter)
  const pos2 = prim.getAttribute("POSITION")!;
  const arr2 = pos2.getArray() as Float32Array;
  const bbox2: number[] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < pos2.getCount(); i++) {
    for (let a = 0; a < 3; a++) {
      const v = arr2[i * 3 + a];
      if (v < bbox2[a * 2]) bbox2[a * 2] = v;
      if (v > bbox2[a * 2 + 1]) bbox2[a * 2 + 1] = v;
    }
  }
  // bbox layout is [minX,maxX,minY,maxY,minZ,maxZ]: even entries are minima (must not go
  // below the original), odd entries are maxima (must not exceed the original).
  const within = bbox2.every((v, i) => (i % 2 === 0 ? v >= bbox[i] - 1e-6 : v <= bbox[i] + 1e-6));
  if (!within) {
    console.error(`bbox original ${bbox.map((v) => v.toFixed(4)).join(",")} vs reduced ${bbox2.map((v) => v.toFixed(4)).join(",")}`);
  }

  return {
    beforeTris: idxArr.length / 3,
    afterTris: keptTris,
    keptComponents: kept.length,
    droppedComponents: dropped,
    bboxWithinOriginal: within,
  };
}

async function reduceActor(asset: string): Promise<Result> {
  const path = `${DIR}/${asset}`;
  const beforeBytes = statSync(path).size;
  const io = new NodeIO();
  const doc = await io.read(path);
  let result: Result | null = null;

  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() ?? "";
    if (!/fitted_eyebrow/i.test(name)) continue;
    const style = /fitted_eyebrow_(mindfront_eyebrows_\d+)/.exec(name)?.[1] ?? null;
    for (const prim of mesh.listPrimitives()) {
      const r = keepLargestStrands(prim, EYEBROW_MAX_TRIS_PER_ACTOR);
      if (r.afterTris > EYEBROW_MAX_TRIS_PER_ACTOR) {
        throw new Error(`#597: ${asset} still ${r.afterTris} brow tris (budget ${EYEBROW_MAX_TRIS_PER_ACTOR})`);
      }
      if (!r.bboxWithinOriginal) {
        throw new Error(`#597: ${asset} reduced brow bbox escaped the original — scatter guard fired`);
      }
      result = { asset, meshName: name, style, ...r };
    }
  }
  if (!result) throw new Error(`#597: no fitted_eyebrow mesh found in ${asset}`);

  io.write(path, doc);
  const afterBytes = statSync(path).size;
  console.log(
    `#597 ${asset}: brow ${result.beforeTris} -> ${result.afterTris} tris ` +
      `(${result.keptComponents} strands kept, ${result.droppedComponents} dropped), ` +
      `file ${(beforeBytes / 1048576).toFixed(1)} -> ${(afterBytes / 1048576).toFixed(1)} MB`,
  );
  return result;
}

const actors = readdirSync(DIR)
  .filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb"))
  .sort();

const results: Result[] = [];
for (const actor of actors) results.push(await reduceActor(actor));

writeFileSync(
  ".openclinxr/evidence/eyebrow-budget/reduction-log.json",
  JSON.stringify(
    {
      budget: EYEBROW_MAX_TRIS_PER_ACTOR,
      mechanism: "keep largest original strands (whole components) until budget; no vertex resampling",
      failedTreatment:
        "simplifyPrimitive/MeshoptSimplifier error=1 scattered degenerate strands across the body — see header",
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(`reduced ${results.length} actors; log at .openclinxr/evidence/eyebrow-budget/reduction-log.json`);
