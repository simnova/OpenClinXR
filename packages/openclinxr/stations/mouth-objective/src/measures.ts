/**
 * Pure mouth-seat measures over head-local geometry (MADR 0061 d2).
 *
 * Moved byte-for-byte out of tools/openclinxr/mouth-solver/mouth-evaluator.ts so the
 * executor, verifier and solver share one score vocabulary without importing each other.
 * Inputs are head-local packed xyz triples (inverse head world matrix); units are
 * millimetres. No scene, no GLB, no runtime needed.
 */

/** Mean of packed xyz triples. */
export function centroidPacked(packed: ArrayLike<number>): [number, number, number] {
  const count = packed.length / 3 || 1;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < packed.length; i += 3) {
    x += packed[i] ?? 0;
    y += packed[i + 1] ?? 0;
    z += packed[i + 2] ?? 0;
  }
  return [x / count, y / count, z / count];
}

/** Mean head-local 3D distance from each lower-shell vertex to its nearest inner-rim vertex, mm. */
export function meanRimGapMm(teethHead: ArrayLike<number>, rimHead: ArrayLike<number>): number {
  let rimGapSum = 0;
  for (let i = 0; i < teethHead.length; i += 3) {
    const tx = teethHead[i] ?? 0;
    const ty = teethHead[i + 1] ?? 0;
    const tz = teethHead[i + 2] ?? 0;
    let best = Infinity;
    for (let j = 0; j < rimHead.length; j += 3) {
      const dx = (rimHead[j] ?? 0) - tx;
      const dy = (rimHead[j + 1] ?? 0) - ty;
      const dz = (rimHead[j + 2] ?? 0) - tz;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < best) best = dist;
    }
    rimGapSum += Math.sqrt(best);
  }
  return (rimGapSum / (teethHead.length / 3 || 1)) * 1000;
}

/** Lower front-shell verts at or in front of the lip landmark's max head-local +Z. */
export function countPenetratingVerts(
  teethHead: ArrayLike<number>,
  lipHead: ArrayLike<number>,
): number {
  let lipMaxZ = -Infinity;
  for (let i = 2; i < lipHead.length; i += 3) lipMaxZ = Math.max(lipMaxZ, lipHead[i] ?? 0);
  let penetrating = 0;
  for (let i = 2; i < teethHead.length; i += 3) {
    if ((teethHead[i] ?? 0) >= lipMaxZ) penetrating += 1;
  }
  return penetrating;
}

/** Upper front-shell centroid displacement from rest, head-local mm. */
export function upperDisplacementMm(
  upperCentroid: readonly [number, number, number],
  restUpperCentroid: readonly [number, number, number],
): number {
  return (
    Math.hypot(
      upperCentroid[0] - restUpperCentroid[0],
      upperCentroid[1] - restUpperCentroid[1],
      upperCentroid[2] - restUpperCentroid[2],
    ) * 1000
  );
}
