/**
 * Seat measure for tsk_2a74bbdb3f03cb3e (physician teeth swap, gated on seat-in-mouth).
 *
 * The physician was excluded from the teeth/tongue swap because a body-similarity gate
 * missed on its chin; this module gates the swap on how the fitted teeth seat in the
 * mouth instead. Bind positions, metres in the GLB; clearance reported in mm.
 *
 * M1f (forward escape): count of index-referenced teeth verts whose +z ray
 *   (origin = vertex, dir (0,0,1), t > 1e-9) hits no skin triangle of body
 *   primitive 0 (Moller-Trumbore, det eps 1e-14). Guards wrong-skin fit only
 *   (neg control); blind to a forward shift (+5 mm leaves nurse 30).
 * M2s (surface clearance): min over the incisal set S of the exact
 *   point-to-TRIANGLE distance to the skin surface (no radius cutoff). S = the
 *   ceil(0.05 * |teeth vertices|) teeth vertices with the largest z (ties ->
 *   lower vertex id).
 * Recorded-only (no assertion; superseded, card comment cmt_43acd416b71d3bca):
 *   m1SignedSide = count of teeth verts on the cavity side of their exact nearest
 *   skin triangle (winding side test); vacuous (KG 3107-3114 of 3109-3115).
 *   m2ClearanceMm = min over S of the distance to the nearest skin VERTEX. The
 *   body mesh carries no lip labels, so the vertex clearance uses the nearest skin
 *   vertex of any label and records which vertex it is.
 *
 * Acceleration: M1-signed-side and M2s scan all triangles with bbox-distance
 *   pruning (skip only when lowerBound > best; strict-< replacement in ascending
 *   order => identical to brute force; no radius cutoff). M1f prefilters ray
 *   candidates to triangles whose xy-bbox contains the ray origin (slop 1e-12,
 *   far above float64 rounding at metre scale) with maxZ above the origin, then
 *   runs the same Moller-Trumbore as the reference probe; a skipped triangle is
 *   provably unable to yield t > 1e-9.
 */
import { basename } from "node:path";

import { closestPointTriangle, isBody, isFittedTeeth, isFittedTongue, meshNode, parseGlb, readScalarIndices, readVec3 } from "./teeth-seat-glb.js";

export type TeethSeatResult = {
  actor: string;
  /** Superseded M1 (signed side to nearest skin triangle); recorded only, no assertion. */
  m1SignedSide: number;
  /** Count of teeth verts whose +z ray hits no skin triangle. */
  m1f: number;
  teethVertexCount: number;
  /** Teeth POSITION accessor count minus teethVertexCount (decimation orphans). */
  orphanCount: number;
  skinTriangleCount: number;
  /** Vertex clearance (superseded); recorded only, no assertion. */
  m2ClearanceMm: number;
  /** Surface clearance: min over the incisal set of point-to-triangle distance, mm. */
  m2sMm: number;
  m2SkinVertexId: number;
  m2SkinVertex: [number, number, number];
  incisalCount: number;
};

export type TeethSeatOptions = {
  /** A second GLB whose fitted teeth replace the skin GLB's teeth in memory (positions + indices only). */
  teethFrom?: string;
  /** Metres added to every teeth z (probe for the defect direction). */
  teethOffsetZ?: number;
};

export function measureTeethSeat(glbPath: string, opts?: TeethSeatOptions): TeethSeatResult {
  const actor = basename(glbPath);
  const glb = parseGlb(glbPath);
  const body = meshNode(glb, actor, isBody, "body");
  const teeth = meshNode(glb, actor, isFittedTeeth, "fitted teeth");
  const tongue = meshNode(glb, actor, isFittedTongue, "fitted tongue");
  for (const [what, node] of [
    ["body", body.node],
    ["teeth", teeth.node],
    ["tongue", tongue.node],
  ] as const) {
    if (node.translation ?? node.rotation ?? node.scale ?? node.matrix) {
      throw new Error(`${actor}: ${what} node carries a transform; shared bind space required`);
    }
    if (node.skin === undefined) throw new Error(`${actor}: ${what} node is not skinned`);
  }
  if (body.node.skin !== teeth.node.skin || body.node.skin !== tongue.node.skin) {
    throw new Error(`${actor}: body/teeth/tongue skins differ; shared bind space required`);
  }

  const skinPrim = body.mesh.primitives?.[0];
  if (!skinPrim || skinPrim.indices === undefined || skinPrim.attributes?.["POSITION"] === undefined) {
    throw new Error(`${actor}: body primitive 0 carries no indexed POSITION`);
  }
  const skinMaterial = glb.document.materials?.[skinPrim.material ?? -1]?.name ?? "";
  if (!skinMaterial.startsWith("mpfb_skin_")) {
    throw new Error(`${actor}: body primitive 0 material ${skinMaterial} is not skin`);
  }
  const skinPositions = readVec3(glb, skinPrim.attributes["POSITION"]);
  const skinIndices = readScalarIndices(glb, skinPrim.indices);
  if (skinIndices.length % 3 !== 0) throw new Error(`${actor}: skin index count is not a triangle list`);
  const skinTriangleCount = skinIndices.length / 3;

  let teethPositions: Float64Array;
  let teethIndices: Uint32Array;
  if (opts?.teethFrom) {
    const donor = parseGlb(opts.teethFrom);
    const donorTeeth = meshNode(donor, basename(opts.teethFrom), isFittedTeeth, "fitted teeth");
    const prim = donorTeeth.mesh.primitives?.[0];
    if (!prim || prim.indices === undefined || prim.attributes?.["POSITION"] === undefined) {
      throw new Error(`${actor}: donor teeth primitive carries no indexed POSITION`);
    }
    teethPositions = readVec3(donor, prim.attributes["POSITION"]);
    teethIndices = readScalarIndices(donor, prim.indices);
  } else {
    const prim = teeth.mesh.primitives?.[0];
    if (!prim || prim.indices === undefined || prim.attributes?.["POSITION"] === undefined) {
      throw new Error(`${actor}: teeth primitive carries no indexed POSITION`);
    }
    if ((teeth.mesh.primitives?.length ?? 0) !== 1) {
      throw new Error(`${actor}: expected exactly one teeth primitive`);
    }
    teethPositions = readVec3(glb, prim.attributes["POSITION"]);
    teethIndices = readScalarIndices(glb, prim.indices);
  }

  // Teeth were decimated in place (indices rewritten, vertex buffer kept), so the
  // buffer holds orphans: teeth vertices are the distinct ids referenced by indices.
  const teethPositionCount = teethPositions.length / 3;
  const teethIdSet = new Set<number>();
  for (const id of teethIndices) teethIdSet.add(id);
  const teethIds = [...teethIdSet].sort((a, b) => a - b);
  const teethVertexCount = teethIds.length;
  const dz = opts?.teethOffsetZ ?? 0;
  const tx = new Float64Array(teethVertexCount);
  const ty = new Float64Array(teethVertexCount);
  const tz = new Float64Array(teethVertexCount);
  for (let i = 0; i < teethVertexCount; i += 1) {
    const id = teethIds[i]!;
    tx[i] = teethPositions[id * 3]!;
    ty[i] = teethPositions[id * 3 + 1]!;
    tz[i] = teethPositions[id * 3 + 2]! + dz;
  }

  // Skin vertices are the distinct ids referenced by primitive 0 indices.
  const skinIdSet = new Set<number>();
  for (const id of skinIndices) skinIdSet.add(id);
  const skinIds = [...skinIdSet].sort((a, b) => a - b);
  const skinCount = skinIds.length;
  const sx = new Float64Array(skinCount);
  const sy = new Float64Array(skinCount);
  const sz = new Float64Array(skinCount);
  for (let i = 0; i < skinCount; i += 1) {
    const id = skinIds[i]!;
    sx[i] = skinPositions[id * 3]!;
    sy[i] = skinPositions[id * 3 + 1]!;
    sz[i] = skinPositions[id * 3 + 2]!;
  }

  // Per-triangle bboxes for pruning.
  const triA = skinIndices;
  const bbMinX = new Float64Array(skinTriangleCount);
  const bbMinY = new Float64Array(skinTriangleCount);
  const bbMinZ = new Float64Array(skinTriangleCount);
  const bbMaxX = new Float64Array(skinTriangleCount);
  const bbMaxY = new Float64Array(skinTriangleCount);
  const bbMaxZ = new Float64Array(skinTriangleCount);
  for (let t = 0; t < skinTriangleCount; t += 1) {
    const a = triA[t * 3]! * 3;
    const b = triA[t * 3 + 1]! * 3;
    const c = triA[t * 3 + 2]! * 3;
    const ax = skinPositions[a]!;
    const ay = skinPositions[a + 1]!;
    const az = skinPositions[a + 2]!;
    const bx = skinPositions[b]!;
    const by = skinPositions[b + 1]!;
    const bz = skinPositions[b + 2]!;
    const cx = skinPositions[c]!;
    const cy = skinPositions[c + 1]!;
    const cz = skinPositions[c + 2]!;
    bbMinX[t] = Math.min(ax, bx, cx);
    bbMinY[t] = Math.min(ay, by, cy);
    bbMinZ[t] = Math.min(az, bz, cz);
    bbMaxX[t] = Math.max(ax, bx, cx);
    bbMaxY[t] = Math.max(ay, by, cy);
    bbMaxZ[t] = Math.max(az, bz, cz);
  }

  const q: number[] = [0, 0, 0];
  const exact = (t: number, px: number, py: number, pz: number): number => {
    const a = triA[t * 3]! * 3;
    const b = triA[t * 3 + 1]! * 3;
    const c = triA[t * 3 + 2]! * 3;
    return closestPointTriangle(
      px, py, pz,
      skinPositions[a]!, skinPositions[a + 1]!, skinPositions[a + 2]!,
      skinPositions[b]!, skinPositions[b + 1]!, skinPositions[b + 2]!,
      skinPositions[c]!, skinPositions[c + 1]!, skinPositions[c + 2]!,
      q,
    );
  };

  // M1 (superseded, recorded only). Teeth ids sorted by z for pruning coherence;
  // the count is order-independent.
  const order = teethIds.map((_id, i) => i).sort((a, b) => tz[a]! - tz[b]! || teethIds[a]! - teethIds[b]!);
  const SAMPLE = 64;
  let m1SignedSide = 0;
  let prevBestTri = -1;
  for (const i of order) {
    const px = tx[i]!;
    const py = ty[i]!;
    const pz = tz[i]!;
    let best = Number.POSITIVE_INFINITY;
    let bestTri = -1;
    for (let t = 0; t < skinTriangleCount; t += SAMPLE) {
      const d2 = exact(t, px, py, pz);
      if (d2 < best) {
        best = d2;
        bestTri = t;
      }
    }
    if (prevBestTri >= 0) {
      const d2 = exact(prevBestTri, px, py, pz);
      if (d2 < best) {
        best = d2;
        bestTri = prevBestTri;
      }
    }
    for (let t = 0; t < skinTriangleCount; t += 1) {
      const dx = px < bbMinX[t]! ? bbMinX[t]! - px : px > bbMaxX[t]! ? px - bbMaxX[t]! : 0;
      const dy = py < bbMinY[t]! ? bbMinY[t]! - py : py > bbMaxY[t]! ? py - bbMaxY[t]! : 0;
      const dzb = pz < bbMinZ[t]! ? bbMinZ[t]! - pz : pz > bbMaxZ[t]! ? pz - bbMaxZ[t]! : 0;
      if (dx * dx + dy * dy + dzb * dzb > best) continue;
      const d2 = exact(t, px, py, pz);
      if (d2 < best) {
        best = d2;
        bestTri = t;
      }
    }
    prevBestTri = bestTri;
    const a = triA[bestTri * 3]! * 3;
    const b = triA[bestTri * 3 + 1]! * 3;
    const c = triA[bestTri * 3 + 2]! * 3;
    const abx = skinPositions[b]! - skinPositions[a]!;
    const aby = skinPositions[b + 1]! - skinPositions[a + 1]!;
    const abz = skinPositions[b + 2]! - skinPositions[a + 2]!;
    const acx = skinPositions[c]! - skinPositions[a]!;
    const acy = skinPositions[c + 1]! - skinPositions[a + 1]!;
    const acz = skinPositions[c + 2]! - skinPositions[a + 2]!;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-20) continue; // Degenerate triangle: no defined side, cannot count as penetration.
    nx /= len;
    ny /= len;
    nz /= len;
    // Recompute q for the winner (exact() left q at the last evaluated triangle).
    exact(bestTri, px, py, pz);
    const side = (px - q[0]!) * nx + (py - q[1]!) * ny + (pz - q[2]!) * nz;
    if (side > 0) m1SignedSide += 1;
  }

  // M2. Incisal set: ceil(5%) of teeth vertices with the largest z, ties -> lower id.
  const incisalCount = Math.ceil(0.05 * teethVertexCount);
  const byZ = teethIds.map((_id, i) => i).sort((a, b) => tz[b]! - tz[a]! || teethIds[a]! - teethIds[b]!);
  const incisal = byZ.slice(0, incisalCount);
  let minD2 = Number.POSITIVE_INFINITY;
  let minSkinSlot = -1;
  for (const i of incisal) {
    const px = tx[i]!;
    const py = ty[i]!;
    const pz = tz[i]!;
    for (let s = 0; s < skinCount; s += 1) {
      const dx = px - sx[s]!;
      const dy = py - sy[s]!;
      const dzv = pz - sz[s]!;
      const d2 = dx * dx + dy * dy + dzv * dzv;
      if (d2 < minD2) {
        minD2 = d2;
        minSkinSlot = s;
      }
    }
  }
  const m2SkinVertexId = skinIds[minSkinSlot]!;
  const m2ClearanceMm = Math.sqrt(minD2) * 1000;

  // M2s. Min over the same incisal set of the exact point-to-TRIANGLE distance
  // to the skin surface (no radius cutoff). Same provable pruning as M1.
  let m2sBest = Number.POSITIVE_INFINITY;
  for (const i of incisal) {
    const px = tx[i]!;
    const py = ty[i]!;
    const pz = tz[i]!;
    let best = Number.POSITIVE_INFINITY;
    for (let t = 0; t < skinTriangleCount; t += SAMPLE) {
      const d2 = exact(t, px, py, pz);
      if (d2 < best) best = d2;
    }
    for (let t = 0; t < skinTriangleCount; t += 1) {
      const dx = px < bbMinX[t]! ? bbMinX[t]! - px : px > bbMaxX[t]! ? px - bbMaxX[t]! : 0;
      const dy = py < bbMinY[t]! ? bbMinY[t]! - py : py > bbMaxY[t]! ? py - bbMaxY[t]! : 0;
      const dzb = pz < bbMinZ[t]! ? bbMinZ[t]! - pz : pz > bbMaxZ[t]! ? pz - bbMaxZ[t]! : 0;
      if (dx * dx + dy * dy + dzb * dzb > best) continue;
      const d2 = exact(t, px, py, pz);
      if (d2 < best) best = d2;
    }
    if (best < m2sBest) m2sBest = best;
  }
  const m2sMm = Math.sqrt(m2sBest) * 1000;

  // M1f. Teeth verts whose +z ray (dir (0,0,1), t > 1e-9) hits no skin triangle
  // (Moller-Trumbore, det eps 1e-14; same logic as the orchestrator alt probe).
  // Candidates prefiltered to triangles whose xy-bbox contains the ray origin
  // (slop 1e-12, far above float64 rounding at metre scale) with maxZ above the
  // origin; a skipped triangle provably cannot yield t > 1e-9.
  const XY_SLOP = 1e-12;
  const rayHitsZ = (ox: number, oy: number, oz: number): boolean => {
    for (let t = 0; t < skinTriangleCount; t += 1) {
      if (
        ox < bbMinX[t]! - XY_SLOP ||
        ox > bbMaxX[t]! + XY_SLOP ||
        oy < bbMinY[t]! - XY_SLOP ||
        oy > bbMaxY[t]! + XY_SLOP ||
        bbMaxZ[t]! <= oz
      ) {
        continue;
      }
      const a = triA[t * 3]! * 3;
      const b = triA[t * 3 + 1]! * 3;
      const c = triA[t * 3 + 2]! * 3;
      const e1x = skinPositions[b]! - skinPositions[a]!;
      const e1y = skinPositions[b + 1]! - skinPositions[a + 1]!;
      const e1z = skinPositions[b + 2]! - skinPositions[a + 2]!;
      const e2x = skinPositions[c]! - skinPositions[a]!;
      const e2y = skinPositions[c + 1]! - skinPositions[a + 1]!;
      const e2z = skinPositions[c + 2]! - skinPositions[a + 2]!;
      // h = dir x e2 with dir = (0,0,1).
      const hx = -e2y;
      const hy = e2x;
      const det = e1x * hx + e1y * hy;
      if (Math.abs(det) < 1e-14) continue;
      const sx0 = ox - skinPositions[a]!;
      const sy0 = oy - skinPositions[a + 1]!;
      const sz0 = oz - skinPositions[a + 2]!;
      const u = (sx0 * hx + sy0 * hy) / det;
      if (u < 0 || u > 1) continue;
      const qx = sy0 * e1z - sz0 * e1y;
      const qy = sz0 * e1x - sx0 * e1z;
      const qz = sx0 * e1y - sy0 * e1x;
      const v = qz / det;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (tt > 1e-9) return true;
    }
    return false;
  };
  let m1f = 0;
  for (let i = 0; i < teethVertexCount; i += 1) {
    if (!rayHitsZ(tx[i]!, ty[i]!, tz[i]!)) m1f += 1;
  }

  return {
    actor,
    m1SignedSide,
    m1f,
    teethVertexCount,
    orphanCount: teethPositionCount - teethVertexCount,
    skinTriangleCount,
    m2ClearanceMm,
    m2sMm,
    m2SkinVertexId,
    m2SkinVertex: [sx[minSkinSlot]!, sy[minSkinSlot]!, sz[minSkinSlot]!],
    incisalCount,
  };
}
