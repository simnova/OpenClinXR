/**
 * Shared single-pass min/max bounds helpers (#384, #589).
 *
 * `Math.min`/`Math.max` applied via argument spread pass EVERY element as an argument; past the
 * engine's ~65k argument limit they throw RangeError: Maximum call stack size exceeded. Shipped
 * humanoid POSITION arrays reach 115,206 vertices per primitive and glb-grade pixel scans reach
 * millions of samples, so bounds over VERTEX- or PIXEL-scale data must loop in a single pass.
 * A spread over a small fixed array (e.g. four actor girth deltas) is fine and stays.
 *
 * claimScope: numeric bounds over arbitrarily large ArrayLike inputs, O(n), zero intermediate
 * allocation for the xyz form. notEvidenceFor: nothing about product geometry — measurement
 * plumbing only.
 */

/** Single-pass minimum; +Infinity for an empty input (matches Math.min semantics). */
export function minOf(values: ArrayLike<number>): number {
  let m = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (v < m) m = v;
  }
  return m;
}

/** Single-pass maximum; -Infinity for an empty input (matches Math.max semantics). */
export function maxOf(values: ArrayLike<number>): number {
  let m = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (v > m) m = v;
  }
  return m;
}

export type XyzBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

/** One walk over position-like objects producing all six axis bounds. */
export function minMaxXyz(
  positions: ReadonlyArray<{ x: number; y: number; z: number }>,
): XyzBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of positions) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}
