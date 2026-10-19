/**
 * Named face regions as pinned MediaPipe FaceLandmarker indices (478-point
 * canonical numbering). Every index below is copied from the face gate's own
 * tables (tools/openclinxr/evidence/face-gate/face_gate.py INDICES and
 * face_gate_v2.py EYE_CONTOUR_A/B, BROW_ALL) so one region table names the
 * same anatomy the gate already measures. The table lives here once; masks are
 * built from the GOLDEN render's landmarks and applied to both images.
 *
 * regions.py mirrors this table for the CLI path (spawned, not copied).
 */
export type Landmark = [number, number];

export const REGION_LANDMARKS: Record<string, number[]> = {
  eye_L: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  eye_R: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
  brow_L: [70, 63, 105, 66, 107, 46, 53, 52, 65, 55],
  brow_R: [336, 296, 334, 293, 300, 276, 283, 282, 295, 285],
  lips: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
  forehead: [10, 67, 69, 104, 108, 151, 9, 8, 337, 299, 333, 297, 338],
  cheek_L: [145, 61, 129, 101, 234, 50, 118, 117, 123, 147, 187, 205, 206],
  cheek_R: [374, 291, 358, 330, 454, 280, 346, 347, 352, 376, 411, 425, 426],
  nose: [168, 6, 197, 195, 5, 4, 1, 2, 98, 327, 129, 358],
  chin: [17, 152, 172, 397],
};

export const REGION_ORDER = Object.keys(REGION_LANDMARKS);

/** Andrew's monotone chain convex hull; returns points in counter-clockwise order. */
export function convexHull(points: Landmark[]): Landmark[] {
  const pts = points.map((p) => [p[0], p[1]] as Landmark).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length <= 2) return pts;
  const cross = (o: Landmark, a: Landmark, b: Landmark): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Landmark[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Landmark[] = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function buildRegionPolygons(landmarks: Landmark[]): Record<string, Landmark[]> {
  const out: Record<string, Landmark[]> = {};
  for (const [region, idxs] of Object.entries(REGION_LANDMARKS)) {
    const pts = idxs.map((i) => landmarks[i]).filter((p): p is Landmark => Array.isArray(p) && p.length === 2);
    out[region] = convexHull(pts);
  }
  return out;
}

/** Even-odd scanline fill of a (convex or simple) polygon into a w*h byte mask. */
export function rasterizePolygon(poly: Landmark[], w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  if (poly.length < 3) return mask;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y += 1) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
        xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.floor(xs[i]! + 0.5));
      const xb = Math.min(w - 1, Math.ceil(xs[i + 1]! - 0.5));
      for (let x = xa; x <= xb; x += 1) mask[y * w + x] = 1;
    }
  }
  return mask;
}

export function regionMasks(landmarks: Landmark[], w: number, h: number): Record<string, Uint8Array> {
  const polys = buildRegionPolygons(landmarks);
  const out: Record<string, Uint8Array> = {};
  for (const [region, poly] of Object.entries(polys)) out[region] = rasterizePolygon(poly, w, h);
  return out;
}
