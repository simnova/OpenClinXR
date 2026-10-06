/**
 * Rim-to-arch transfer (operator direction, 2026-10-06).
 *
 * Correspondence: nearest inner-rim triangle per lower-arch tooth vertex
 * with barycentric coordinates (deterministic closest-point, no iteration).
 * Skin transfer blends rim joint weights (top-4 renormalized); morph
 * transfer blends rim deltas per target, falling back to the rigid arch
 * mean when the per-vertex field distorts crowns past 0.3 mm.
 */
import { frontShellIndices } from "./couple-fitted-teeth-to-lip-viseme.js";

const DISTORTION_LIMIT_M = 0.0003;

export type Bary = { index: number; alpha: number; beta: number; gamma: number };

/** Closest point on triangle (Ericson 5.1.5), with barycentric coords. Degenerate falls back to nearest vertex. */
export function closestOnTriangle(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): { distance2: number; alpha: number; beta: number; gamma: number } {
  const abx = bx - ax; const aby = by - ay; const abz = bz - az;
  const acx = cx - ax; const acy = cy - ay; const acz = cz - az;
  const apx = px - ax; const apy = py - ay; const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return { distance2: apx * apx + apy * apy + apz * apz, alpha: 1, beta: 0, gamma: 0 };
  const bpx = px - bx; const bpy = py - by; const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return { distance2: bpx * bpx + bpy * bpy + bpz * bpz, alpha: 0, beta: 1, gamma: 0 };
  const cpx = px - cx; const cpy = py - cy; const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return { distance2: cpx * cpx + cpy * cpy + cpz * cpz, alpha: 0, beta: 0, gamma: 1 };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const qx = ax + v * abx - px; const qy = ay + v * aby - py; const qz = az + v * abz - pz;
    return { distance2: qx * qx + qy * qy + qz * qz, alpha: 1 - v, beta: v, gamma: 0 };
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = ax + w * acx - px; const qy = ay + w * acy - py; const qz = az + w * acz - pz;
    return { distance2: qx * qx + qy * qy + qz * qz, alpha: 1 - w, beta: 0, gamma: w };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const qx = bx + w * (cx - bx) - px; const qy = by + w * (cy - by) - py; const qz = bz + w * (cz - bz) - pz;
    return { distance2: qx * qx + qy * qy + qz * qz, alpha: 0, beta: 1 - w, gamma: w };
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const qx = ax + abx * v + acx * w - px; const qy = ay + aby * v + acy * w - py; const qz = az + abz * v + acz * w - pz;
  return { distance2: qx * qx + qy * qy + qz * qz, alpha: 1 - v - w, beta: v, gamma: w };
}

export type ArchTransfer = {
  newJoints: number[];
  newWeights: number[];
  newDeltas: Record<string, Float32Array>;
  distortionMm: Record<string, number>;
  rigid: boolean;
  jawMaxVerts: number;
};

export function transferArch(input: {
  teethBase: Float32Array;
  bodyBase: Float32Array;
  bodyDeltas: Float32Array[];
  bodyTargets: string[];
  teethNames: string[];
  bodyJoints: ArrayLike<number>;
  bodyWeights: Float32Array;
  lowerArch: number[];
  rimTris: Array<readonly [number, number, number]>;
  newBase: Float32Array;
  forceRigid: boolean;
  teethSkinJoints: (string | undefined)[];
  teethCount: number;
  jointArray: ArrayLike<number>;
  weightArray: Float32Array;
}): ArchTransfer {
  const {
    teethBase, bodyBase, bodyDeltas, bodyTargets, teethNames, bodyJoints, bodyWeights,
    lowerArch, rimTris, newBase, forceRigid, teethSkinJoints, teethCount, jointArray, weightArray,
  } = input;
  const newShells = frontShellIndices(newBase);
  if (newShells.lower.some((vertex) => !lowerArch.includes(vertex))) {
    throw new Error("lower shell escapes the lower arch: cannot seat unmapped verts");
  }
  const donors: Bary[] = [];
  for (const vertex of lowerArch) {
    const px = newBase[vertex * 3] ?? 0;
    const py = newBase[vertex * 3 + 1] ?? 0;
    const pz = newBase[vertex * 3 + 2] ?? 0;
    let best = Infinity;
    let bestBary: Bary = { index: 0, alpha: 1, beta: 0, gamma: 0 };
    for (let tri = 0; tri < rimTris.length; tri += 1) {
      const corners = rimTris[tri];
      if (!corners) throw new Error("rim triangle missing");
      const [a, b, c] = corners;
      const hit = closestOnTriangle(
        px, py, pz,
        bodyBase[a * 3] ?? 0, bodyBase[a * 3 + 1] ?? 0, bodyBase[a * 3 + 2] ?? 0,
        bodyBase[b * 3] ?? 0, bodyBase[b * 3 + 1] ?? 0, bodyBase[b * 3 + 2] ?? 0,
        bodyBase[c * 3] ?? 0, bodyBase[c * 3 + 1] ?? 0, bodyBase[c * 3 + 2] ?? 0,
      );
      if (hit.distance2 < best) {
        best = hit.distance2;
        bestBary = { index: tri, alpha: hit.alpha, beta: hit.beta, gamma: hit.gamma };
      }
    }
    donors.push(bestBary);
  }

  const jointOf = (vertex: number, slot: number): number => bodyJoints[vertex * 4 + slot] ?? 0;
  const weightOf = (vertex: number, slot: number): number => bodyWeights[vertex * 4 + slot] ?? 0;
  const newJoints: number[] = Array.from(jointArray as ArrayLike<number>);
  const newWeights: number[] = Array.from(weightArray);
  for (let i = 0; i < lowerArch.length; i += 1) {
    const vertex = lowerArch[i];
    const donor = donors[i];
    if (vertex === undefined || donor === undefined) throw new Error("donor mismatch");
    const tri = rimTris[donor.index];
    if (!tri) throw new Error("donor triangle missing");
    const [a, b, c] = tri;
    const mix = new Map<number, number>();
    const add = (rimVert: number, factor: number): void => {
      for (let slot = 0; slot < 4; slot += 1) {
        const joint = jointOf(rimVert, slot);
        mix.set(joint, (mix.get(joint) ?? 0) + factor * weightOf(rimVert, slot));
      }
    };
    add(a, donor.alpha);
    add(b, donor.beta);
    add(c, donor.gamma);
    const ranked = [...mix.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, 4);
    const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
    if (!(total > 0)) throw new Error(`rim donor weights vanish at teeth vertex ${vertex}`);
    for (let slot = 0; slot < 4; slot += 1) {
      newJoints[vertex * 4 + slot] = ranked[slot]?.[0] ?? 0;
      newWeights[vertex * 4 + slot] = (ranked[slot]?.[1] ?? 0) / total;
    }
  }

  const newDeltas: Record<string, Float32Array> = {};
  const distortionMm: Record<string, number> = {};
  let rigid = forceRigid;
  const perTarget = new Map<string, Float32Array>();
  for (const targetName of teethNames) {
    const field = new Float32Array(teethBase.length);
    const morphIndex = bodyTargets.indexOf(targetName);
    if (morphIndex < 0) throw new Error(`body has no ${targetName} target`);
    const bodyDelta = bodyDeltas[morphIndex] ?? new Float32Array(bodyBase.length);
    for (let i = 0; i < lowerArch.length; i += 1) {
      const vertex = lowerArch[i];
      const donor = donors[i];
      if (vertex === undefined || donor === undefined) throw new Error("donor mismatch");
      const tri = rimTris[donor.index];
      if (!tri) throw new Error("donor triangle missing");
      const [a, b, c] = tri;
      for (let axis = 0; axis < 3; axis += 1) {
        field[vertex * 3 + axis] =
          donor.alpha * (bodyDelta[a * 3 + axis] ?? 0) +
          donor.beta * (bodyDelta[b * 3 + axis] ?? 0) +
          donor.gamma * (bodyDelta[c * 3 + axis] ?? 0);
      }
    }
    perTarget.set(targetName, field);
  }
  for (const [name, field] of perTarget) {
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (const vertex of lowerArch) {
      mx += field[vertex * 3] ?? 0;
      my += field[vertex * 3 + 1] ?? 0;
      mz += field[vertex * 3 + 2] ?? 0;
    }
    const count = lowerArch.length || 1;
    const mean: [number, number, number] = [mx / count, my / count, mz / count];
    let worst = 0;
    for (const vertex of lowerArch) {
      worst = Math.max(
        worst,
        Math.abs((field[vertex * 3] ?? 0) - mean[0]),
        Math.abs((field[vertex * 3 + 1] ?? 0) - mean[1]),
        Math.abs((field[vertex * 3 + 2] ?? 0) - mean[2]),
      );
    }
    distortionMm[name] = Math.round(worst * 1e6) / 1e3;
    if (worst > DISTORTION_LIMIT_M) rigid = true;
  }
  for (const [name, field] of perTarget) {
    const out = new Float32Array(teethBase.length);
    if (!rigid) {
      out.set(field);
    } else {
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (const vertex of lowerArch) {
        mx += field[vertex * 3] ?? 0;
        my += field[vertex * 3 + 1] ?? 0;
        mz += field[vertex * 3 + 2] ?? 0;
      }
      const count = lowerArch.length || 1;
      for (const vertex of lowerArch) {
        out[vertex * 3] = mx / count;
        out[vertex * 3 + 1] = my / count;
        out[vertex * 3 + 2] = mz / count;
      }
    }
    newDeltas[name] = out;
  }

  const dominantOf = (vertex: number): number => {
    let joint = newJoints[vertex * 4] ?? 0;
    let best = newWeights[vertex * 4] ?? 0;
    for (let slot = 1; slot < 4; slot += 1) {
      const next = newWeights[vertex * 4 + slot] ?? 0;
      if (next > best) {
        best = next;
        joint = newJoints[vertex * 4 + slot] ?? joint;
      }
    }
    return joint;
  };
  let jawMaxVerts = 0;
  for (let vertex = 0; vertex < teethCount; vertex += 1) {
    if (/^jaw$/i.test(teethSkinJoints[dominantOf(vertex)] ?? "")) jawMaxVerts += 1;
  }
  if (jawMaxVerts === 0) {
    throw new Error("transferred weights leave no jaw-maximum teeth vertex: the lab rebind would fire");
  }
  return { newJoints, newWeights, newDeltas, distortionMm, rigid, jawMaxVerts };
}
