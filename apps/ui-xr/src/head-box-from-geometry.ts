/**
 * Head-box derivation for isolated-subject-lab `focus=head` (#358).
 *
 * The #354 eye-focus station framed the head only on the MPFB rail and silently
 * fell back to whole-subject framing everywhere else: 7 of 7 Anny actors carry
 * eye BONES but zero eye GEOMETRY (no primitive matches eye|cornea|iris|sclera),
 * and the hm08 library bodies carry neither — so the eye box cannot be derived
 * from the eye mesh on those rails. This module derives the head box from
 * geometry EVERY humanoid has: the body mesh itself.
 *
 * Derivation (all from the asset, never from the eye mesh, never from literal
 * camera coordinates — D1):
 *   1. body AABB over all mesh vertices, world space
 *   2. dominant axis = the axis of the body's largest extent (standing = y)
 *   3. the topmost 40% band of the body bounds is the head+neck+shoulders region
 *   4. silhouette width profile: per horizontal slice, the max radius from the
 *      body's vertical centreline
 *   5. the neck is the global minimum radius BELOW the skull's widest slice
 *      (skull widens, neck constricts, shoulders widen again — the profile
 *      minimum below the skull IS the neck)
 *   6. the head box is the AABB of every vertex at/above the neck cut
 *
 * Pure math, no three.js import — the lab (three.js world vertices) and the
 * file-side inspection (gltf-transform bind-pose vertices) call the SAME
 * function, so the derivation cannot drift between the runtime and the
 * measurement.
 *
 * Refusal: returns null when the subject is not a standing humanoid (body too
 * small, no neck constriction, head not a real region) — the caller REFUSES
 * rather than falling back. No silent degradation.
 *
 * Not covered: supine subjects (the head end is ambiguous on the dominant
 * axis) — focus=head targets standing humanoids; see #358's matched-framing
 * comparison.
 */

export type Vec3 = { x: number; y: number; z: number };

export type HeadBoxGeometry = {
  /** World AABB of the head region (skull + a ~1.5 cm neck stub below the cut). */
  box: { min: Vec3; max: Vec3 };
  /** Axis along which the body stands (largest AABB extent). */
  dominantAxis: "x" | "y" | "z";
  /** Coordinate along the dominant axis at the neck cut, metres. */
  neckPosition: number;
  /** Body extent along the dominant axis, metres. */
  bodyExtent: number;
  /** Number of vertices inside the derived head box. */
  vertexCount: number;
  /** Radius profile per slice (diagnostic — what the neck cut was derived from). */
  radiusProfile: number[];
};

/** Focus=head is for humanoids; smaller subjects refuse. */
const MIN_BODY_EXTENT_METERS = 0.4;
/** Candidate region = topmost 40% of the body extent (head + neck + shoulders). */
const BAND_TOP_FRACTION = 0.6;
/** Horizontal slices across the candidate band for the width profile. */
const SLICE_COUNT = 48;
/** A real head is at least ~5 cm tall along the dominant axis. */
const MIN_HEAD_EXTENT_METERS = 0.05;
/** A head is at most half the body (child proportion) — larger means the cut failed. */
const MAX_HEAD_FRACTION_OF_BODY = 0.5;
/** The neck must constrict the silhouette to under 85% of the skull's widest slice. */
const NECK_CONSTRICTION_RATIO = 0.85;
/** Minimum skull silhouette radius before the profile is "no head". */
const MIN_SKULL_RADIUS_METERS = 0.02;

/**
 * Derive the head box from raw mesh vertices. Returns null when the subject has
 * no derivable head (refusal, never silent fallback).
 */
export function deriveHeadBoxFromPoints(points: ReadonlyArray<Vec3>): HeadBoxGeometry | null {
  if (points.length < 200) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  const extentX = maxX - minX;
  const extentY = maxY - minY;
  const extentZ = maxZ - minZ;
  const dominantAxis: "x" | "y" | "z" =
    extentY >= extentX && extentY >= extentZ ? "y" : extentX >= extentZ ? "x" : "z";
  const di = dominantAxis === "x" ? 0 : dominantAxis === "y" ? 1 : 2;
  const bodyExtent = di === 0 ? extentX : di === 1 ? extentY : extentZ;
  if (!Number.isFinite(bodyExtent) || bodyExtent < MIN_BODY_EXTENT_METERS) return null;

  // Horizontal axes + centreline centroid (the body's vertical axis).
  const h0 = di === 0 ? 1 : 0;
  const h1 = di === 2 ? 1 : 2;
  let c0 = 0;
  let c1 = 0;
  for (const p of points) {
    c0 += h0 === 0 ? p.x : p.y;
    c1 += h1 === 1 ? p.y : p.z;
  }
  c0 /= points.length;
  c1 /= points.length;

  // Candidate band: the topmost 40% of the body extent.
  const bandLo = (di === 0 ? minX : di === 1 ? minY : minZ) + BAND_TOP_FRACTION * bodyExtent;
  const bandHi = (di === 0 ? maxX : di === 1 ? maxY : maxZ);
  const sliceH = (bandHi - bandLo) / SLICE_COUNT;
  if (!Number.isFinite(sliceH) || sliceH <= 0) return null;

  const radiusProfile = new Array<number>(SLICE_COUNT).fill(0);
  const coordOf = (p: Vec3): number => (di === 0 ? p.x : di === 1 ? p.y : p.z);
  const horizOf = (p: Vec3, axis: 0 | 1 | 2): number => (axis === 0 ? p.x : axis === 1 ? p.y : p.z);
  for (const p of points) {
    const d = coordOf(p);
    if (d < bandLo || d > bandHi) continue;
    const idx = Math.min(SLICE_COUNT - 1, Math.max(0, Math.floor((d - bandLo) / sliceH)));
    const dx = horizOf(p, h0) - c0;
    const dy = horizOf(p, h1) - c1;
    const r = Math.hypot(dx, dy);
    if (r > radiusProfile[idx]!) radiusProfile[idx] = r;
  }

  // Skull widest slice: the max radius within the top quarter of the band.
  const skullStart = Math.floor(0.75 * SLICE_COUNT);
  let skullMax = 0;
  let skullSlice = -1;
  for (let i = skullStart; i < SLICE_COUNT; i += 1) {
    if (radiusProfile[i]! > skullMax) {
      skullMax = radiusProfile[i]!;
      skullSlice = i;
    }
  }
  if (skullSlice < 0 || skullMax < MIN_SKULL_RADIUS_METERS) return null;

  // Neck: the global minimum radius BELOW the skull's widest slice. Skull widens,
  // neck constricts, shoulders widen again — so the profile minimum below the
  // skull is the neck, not the shoulders and not the hands (which sit below the
  // band at mid-thigh and are still wider than the neck).
  let neckSlice = -1;
  let neckMin = Infinity;
  for (let i = 0; i < skullSlice; i += 1) {
    if (radiusProfile[i]! < neckMin) {
      neckMin = radiusProfile[i]!;
      neckSlice = i;
    }
  }
  if (neckSlice < 0 || neckMin >= NECK_CONSTRICTION_RATIO * skullMax) return null;

  // Cut at the BOTTOM of the neck slice: includes a ~1.5 cm neck stub.
  const neckPosition = bandLo + neckSlice * sliceH;

  // Head box = AABB of every vertex at/above the neck cut.
  let hMinX = Infinity;
  let hMinY = Infinity;
  let hMinZ = Infinity;
  let hMaxX = -Infinity;
  let hMaxY = -Infinity;
  let hMaxZ = -Infinity;
  let vertexCount = 0;
  for (const p of points) {
    if (coordOf(p) < neckPosition) continue;
    vertexCount += 1;
    if (p.x < hMinX) hMinX = p.x;
    if (p.y < hMinY) hMinY = p.y;
    if (p.z < hMinZ) hMinZ = p.z;
    if (p.x > hMaxX) hMaxX = p.x;
    if (p.y > hMaxY) hMaxY = p.y;
    if (p.z > hMaxZ) hMaxZ = p.z;
  }
  const headExtent = di === 0 ? hMaxX - hMinX : di === 1 ? hMaxY - hMinY : hMaxZ - hMinZ;
  if (
    !Number.isFinite(headExtent)
    || headExtent < MIN_HEAD_EXTENT_METERS
    || headExtent > MAX_HEAD_FRACTION_OF_BODY * bodyExtent
  ) {
    return null;
  }

  return {
    box: {
      min: { x: hMinX, y: hMinY, z: hMinZ },
      max: { x: hMaxX, y: hMaxY, z: hMaxZ },
    },
    dominantAxis,
    neckPosition,
    bodyExtent,
    vertexCount,
    radiusProfile,
  };
}
