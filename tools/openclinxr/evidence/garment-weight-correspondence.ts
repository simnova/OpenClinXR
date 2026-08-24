import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";

/**
 * Does a garment vertex deform like the body vertex it sits on?
 *
 * A garment shell derived from the body surface should inherit that body's skin weights. When the
 * weights are painted from POSITION thresholds instead, the garment and the skin under it are driven
 * by different bone mixes, and the cloth lags or tears the moment the skeleton moves. The defect is
 * invisible in a still at bind pose, which is why it needs a file-level instrument rather than a grade.
 *
 * The metric is a normalised L1 distance between two dense per-bone weight vectors:
 *   0.0 = the garment vertex is skinned exactly like the nearest body vertex
 *   1.0 = they share no bone at all
 * Half the L1 sum, because two normalised distributions that are disjoint differ by 2.
 *
 * WHAT THIS METRIC CANNOT SEE (it shares its blind spot with any nearest-vertex proxy): it assumes
 * the nearest body vertex is the correspondence. A garment that legitimately spans a joint may draw a
 * neighbour from the wrong side of it. That is why the band control exists - restricting to vertices
 * within a few millimetres of the skin removes the cases where "nearest" is arguable, and a real
 * defect survives the restriction while a proxy artifact does not.
 */

export interface WeightCorrespondence {
  readonly garmentVertices: number;
  readonly comparedVertices: number;
  readonly medianDisagreement: number;
  readonly meanDisagreement: number;
  readonly meanNearestMeters: number;
  readonly meanInfluencesPerVertex: number;
}

interface Skinned { readonly pos: Float32Array; readonly weights: Float32Array; readonly joints: Uint32Array; readonly count: number }

function collect(doc: ReturnType<NodeIO["readBinary"]> extends Promise<infer D> ? D : never, match: (name: string) => boolean): Skinned[] {
  const out: Skinned[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!match(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const w = prim.getAttribute("WEIGHTS_0"); const j = prim.getAttribute("JOINTS_0"); const p = prim.getAttribute("POSITION");
      if (!w || !j || !p) continue;
      out.push({
        pos: p.getArray() as Float32Array,
        weights: Float32Array.from(w.getArray() as ArrayLike<number>),
        joints: Uint32Array.from(j.getArray() as ArrayLike<number>),
        count: p.getCount(),
      });
    }
  }
  return out;
}

/** Dense, normalised per-bone weight vector for one vertex, written into `into`. */
function densify(s: Skinned, v: number, boneCount: number, into: Float64Array): void {
  into.fill(0);
  let total = 0;
  for (let k = 0; k < 4; k += 1) {
    const wt = s.weights[v * 4 + k] ?? 0;
    if (wt <= 0) continue;
    into[s.joints[v * 4 + k] ?? 0] += wt;
    total += wt;
  }
  if (total > 0) for (let b = 0; b < boneCount; b += 1) into[b] /= total;
}

/**
 * Compare every garment vertex against its nearest body vertex.
 * `bandMeters` restricts the comparison to vertices that close to the skin, so geometric offset
 * cannot be mistaken for a weighting defect. Pass Infinity to compare all of them.
 */
export function measureGarmentWeightCorrespondence(
  glbPath: string, bodyName: (n: string) => boolean, garmentName: (n: string) => boolean, bandMeters = Infinity,
): Promise<WeightCorrespondence> {
  return new NodeIO().readBinary(readFileSync(glbPath)).then((doc) => {
    const boneCount = Math.max(1, ...doc.getRoot().listSkins().map((s) => s.listJoints().length));
    const bodies = collect(doc, bodyName); const garments = collect(doc, garmentName);
    if (bodies.length === 0) throw new Error(`no skinned body primitive matched in ${glbPath}`);
    if (garments.length === 0) throw new Error(`no skinned garment primitive matched in ${glbPath}`);

    // Uniform grid over the body so the nearest-vertex search is not quadratic.
    const CELL = 0.02;
    const key = (x: number, y: number, z: number): string =>
      `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
    const grid = new Map<string, Array<[Skinned, number]>>();
    for (const b of bodies) {
      for (let v = 0; v < b.count; v += 1) {
        const k = key(b.pos[v * 3] ?? 0, b.pos[v * 3 + 1] ?? 0, b.pos[v * 3 + 2] ?? 0);
        (grid.get(k) ?? grid.set(k, []).get(k)!).push([b, v]);
      }
    }

    const gv = new Float64Array(boneCount); const bv = new Float64Array(boneCount);
    const disagreements: number[] = []; let nearestSum = 0; let nearestN = 0;
    let influenceSum = 0; let garmentVertices = 0;

    for (const g of garments) {
      for (let v = 0; v < g.count; v += 1) {
        garmentVertices += 1;
        for (let k = 0; k < 4; k += 1) if ((g.weights[v * 4 + k] ?? 0) > 0.01) influenceSum += 1;
        const x = g.pos[v * 3] ?? 0; const y = g.pos[v * 3 + 1] ?? 0; const z = g.pos[v * 3 + 2] ?? 0;
        let best: [Skinned, number] | null = null; let bestD = Infinity;
        for (let r = 1; r <= 4 && best === null; r += 1) {          // widen the ring until something is found
          for (let dx = -r; dx <= r; dx += 1) for (let dy = -r; dy <= r; dy += 1) for (let dz = -r; dz <= r; dz += 1) {
            for (const cand of grid.get(key(x + dx * CELL, y + dy * CELL, z + dz * CELL)) ?? []) {
              const [cb, ci] = cand;
              const d = (cb.pos[ci * 3]! - x) ** 2 + (cb.pos[ci * 3 + 1]! - y) ** 2 + (cb.pos[ci * 3 + 2]! - z) ** 2;
              if (d < bestD) { bestD = d; best = cand; }
            }
          }
        }
        if (best === null) continue;
        const dist = Math.sqrt(bestD);
        nearestSum += dist; nearestN += 1;
        if (dist > bandMeters) continue;
        densify(g, v, boneCount, gv); densify(best[0], best[1], boneCount, bv);
        let l1 = 0; for (let b = 0; b < boneCount; b += 1) l1 += Math.abs(gv[b]! - bv[b]!);
        disagreements.push(l1 / 2);
      }
    }

    disagreements.sort((a, b) => a - b);
    const median = disagreements.length === 0 ? Number.NaN
      : disagreements[Math.floor(disagreements.length / 2)]!;
    return {
      garmentVertices,
      comparedVertices: disagreements.length,
      medianDisagreement: median,
      meanDisagreement: disagreements.reduce((a, b) => a + b, 0) / Math.max(1, disagreements.length),
      meanNearestMeters: nearestSum / Math.max(1, nearestN),
      meanInfluencesPerVertex: influenceSum / Math.max(1, garmentVertices),
    };
  });
}
