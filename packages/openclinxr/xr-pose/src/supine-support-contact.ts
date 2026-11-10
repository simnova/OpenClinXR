/**
 * Multi-region deformed anatomical-body contact for supine actors.
 *
 * The earlier contact checks reduced a whole body to one lowest vertex. A heel, hand, or garment
 * corner could therefore certify contact while the pelvis and back visibly floated. This module
 * reads the deformed anatomical SkinnedMesh surface and keeps pelvis, lumbar, and thorax measurements separate.
 */
import {
  STRETCHER_LENGTH_METERS,
} from "@openclinxr/xr-station";
import { type Object3D, Matrix4, Vector3 } from "three";
import {
  accumulateSupportGapsFast,
  isMaterialRendered,
  resolveSupportSampleRows,
  selectContactGap,
  type SampleRow,
  type SkinnedLike,
} from "./supine-support-skin-cache.js";

export type SupineSupportRegion = "pelvis" | "lumbar" | "thorax" | "heelL" | "heelR" | "occiput";

export type SupineSupportPlane = {
  origin: Vector3;
  normal: Vector3;
  forward?: Vector3;
  /** Optional finite-footprint predicate in world space. */
  contains?: (world: Vector3) => boolean;
  /** Outside a pillow, skull collision is measured against its underlying mattress. */
  outsideCollisionPlane?: SupineSupportPlane;
};

export function makeSupineSupportPlanes(
  stretcher: Object3D | undefined,
  deckTopWorldY: number,
  provisionalPillow = false,
): Readonly<Record<SupineSupportRegion, SupineSupportPlane>> {
  const seatOrigin = new Vector3(0, deckTopWorldY, 0);
  const seatNormal = new Vector3(0, 1, 0);
  const seatForward = new Vector3(1, 0, 0);
  if (!stretcher) {
    const plane = { origin: seatOrigin, normal: seatNormal };
    return { pelvis: plane, lumbar: plane, thorax: plane, heelL: plane, heelR: plane, occiput: plane };
  }
  stretcher.updateMatrixWorld(true);
  const stretcherInverse = new Matrix4().copy(stretcher.matrixWorld).invert();
  let back: Object3D | null = null;
  let seat: Object3D | null = null;
  stretcher.traverse((object) => {
    if (!back && object.userData?.["openClinXrDeckSection"] === "back") back = object;
    if (!seat && object.userData?.["openClinXrDeckSection"] === "seat") seat = object;
  });
  if (seat) {
    const mesh = (seat as Object3D).children.find((child) => (child as SkinnedLike).geometry);
    if (mesh) {
      const geometry = (mesh as SkinnedLike).geometry!;
      geometry.computeBoundingBox?.();
      const top = geometry.boundingBox?.max.y;
      if (typeof top === "number") seatOrigin.set(0, top, 0).applyMatrix4(mesh.matrixWorld);
      const e = mesh.matrixWorld.elements;
      seatNormal.set(e[4] ?? 0, e[5] ?? 1, e[6] ?? 0).normalize();
      seatForward.set(e[0] ?? 1, e[1] ?? 0, e[2] ?? 0).normalize();
    }
  }
  const seatContains = (world: Vector3): boolean => {
    const local = world.clone().applyMatrix4(stretcherInverse);
    return local.x >= -0.04
      && local.x <= STRETCHER_LENGTH_METERS / 2 + 0.04
      && Math.abs(local.z) <= STRETCHER_HALF_WIDTH_METERS + 0.04;
  };
  const pelvis = { origin: seatOrigin, normal: seatNormal, forward: seatForward, contains: seatContains };
  if (!back) return { pelvis, lumbar: pelvis, thorax: pelvis, heelL: pelvis, heelR: pelvis, occiput: pelvis };
  const backObject: Object3D = back;
  backObject.updateWorldMatrix?.(true, false);
  const backInverse = new Matrix4().copy(backObject.matrixWorld).invert();
  const e = backObject.matrixWorld.elements;
  const backPlane: SupineSupportPlane = {
    origin: new Vector3().setFromMatrixPosition(backObject.matrixWorld),
    normal: new Vector3(e[4]!, e[5]!, e[6]!).normalize(),
    contains: (world) => {
      const local = world.clone().applyMatrix4(backInverse);
      return local.x >= -STRETCHER_LENGTH_METERS / 2 - 0.04
        && local.x <= 0.04
        && Math.abs(local.z) <= STRETCHER_HALF_WIDTH_METERS + 0.04;
    },
  };
  let pillow: Object3D | null = null;
  stretcher.traverse((object) => { if (/\.pillow$/u.test(object.name)) pillow = object; });
  const pillowObject = pillow as Object3D | null;
  if (pillowObject) pillowObject.updateWorldMatrix(true, false);
  const pillowInverse = pillowObject ? new Matrix4().copy(pillowObject.matrixWorld).invert() : null;
  const occiput: SupineSupportPlane = {
    ...backPlane,
    origin: backPlane.origin.clone().addScaledVector(backPlane.normal, 0.08),
    outsideCollisionPlane: backPlane,
    contains: provisionalPillow || !pillowObject ? (world) => backPlane.contains?.(world) ?? true : (world) => {
      const local = world.clone().applyMatrix4(pillowInverse!);
      return Math.abs(local.x) <= 0.14 && Math.abs(local.z) <= 0.21;
    },
  };
  return { pelvis, lumbar: backPlane, thorax: backPlane, heelL: pelvis, heelR: pelvis, occiput };
}

export type SupineSupportRegionMetric = {
  region: SupineSupportRegion;
  samples: number;
  /** Lower-surface estimate. A quantile prevents one outlier vertex from certifying contact. */
  contactGapMeters: number | null;
  /** Deepest deformed anatomical vertex, retained as the penetration counterweight. */
  minGapMeters: number | null;
  contactPoint?: { x: number; y: number; z: number };
};

const STRETCHER_HALF_WIDTH_METERS = 0.45;

function quantile(sorted: ArrayLike<number>, fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index] ?? null;
}

const scratch = new Vector3();
const scratchUnderlying = new Vector3();

/**
 * Measure the deformed anatomical body underside against finite support surfaces.
 * Clothing masks hide body fragments in pixels but do not remove the body collision envelope.
 * When an MPFB body exists, garment/shoe vertices cannot certify torso/heel contact.
 * The eighth percentile represents a patch of surface rather than the single lowest vertex.
 */
export function measureSupineSupportRegions(
  humanoid: Object3D,
  planes: Readonly<Record<SupineSupportRegion, SupineSupportPlane>>,
): Readonly<Record<SupineSupportRegion, SupineSupportRegionMetric>> {
  return measureCore(humanoid, planes, true);
}

export function measureSupineSupportGaps(
  humanoid: Object3D,
  planes: Readonly<Record<SupineSupportRegion, SupineSupportPlane>>,
): Readonly<Record<SupineSupportRegion, SupineSupportRegionMetric>> {
  return measureCore(humanoid, planes, false);
}

function measureCore(
  humanoid: Object3D,
  planes: Readonly<Record<SupineSupportRegion, SupineSupportPlane>>,
  withPoints: boolean,
): Readonly<Record<SupineSupportRegion, SupineSupportRegionMetric>> {
  humanoid.updateMatrixWorld?.(true);
  const gaps: Record<SupineSupportRegion, number[]> = { pelvis: [], lumbar: [], thorax: [], heelL: [], heelR: [], occiput: [] };
  const points: Record<SupineSupportRegion, Vector3[]> = { pelvis: [], lumbar: [], thorax: [], heelL: [], heelR: [], occiput: [] };
  const minimum: Record<SupineSupportRegion, number> = { pelvis: Infinity, lumbar: Infinity, thorax: Infinity, heelL: Infinity, heelR: Infinity, occiput: Infinity };
  const local = new Vector3();
  const world = new Vector3();
  let hasAnatomicalBody = false;
  humanoid.traverse((object) => {
    if ((object as SkinnedLike).isSkinnedMesh && /mpfb.*body|reference_body/iu.test(object.name)) hasAnatomicalBody = true;
  });
  humanoid.traverse((object) => {
    const mesh = object as SkinnedLike;
    const anatomicalBody = /mpfb.*body|reference_body/iu.test(mesh.name);
    if (hasAnatomicalBody && !anatomicalBody) return;
    const position = mesh.geometry?.attributes?.position;
    if (!mesh.isSkinnedMesh || !position || !mesh.getVertexPosition || !mesh.skeleton) return;
    if (!mesh.visible) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!anatomicalBody && materials.every((material) => !isMaterialRendered(material))) return;
    if (!withPoints) {
      accumulateSupportGapsFast(mesh, anatomicalBody, materials, planes, gaps, minimum);
      return;
    }
    const rows: SampleRow[] = resolveSupportSampleRows(mesh, anatomicalBody, materials);
    for (const row of rows) {
      const index = row.index;
      const region = row.region;
      mesh.getVertexPosition(index, local);
      world.copy(local).applyMatrix4(mesh.matrixWorld);
      const plane = planes[region];
      if (plane.contains && !plane.contains(world)) {
        const underlying = plane.outsideCollisionPlane;
        if (underlying && (!underlying.contains || underlying.contains(world))) {
          minimum[region] = Math.min(minimum[region], underlying.normal.dot(scratchUnderlying.copy(world).sub(underlying.origin)));
        }
        continue;
      }
      const gap = plane.normal.dot(scratch.copy(world).sub(plane.origin));
      minimum[region] = Math.min(minimum[region], gap);
      // Contact belongs to the posterior skull. The minimum retains the head-weighted
      // anatomical envelope, including its face-side points; jaw/neck-weighted vertices are
      // outside this metric and must also be checked in rendered acceptance.
      if (row.skipContact) continue;
      gaps[region].push(gap);
      if (withPoints) points[region].push(world.clone());
    }
  });
  const result = {} as Record<SupineSupportRegion, SupineSupportRegionMetric>;
  for (const region of ["pelvis", "lumbar", "thorax", "heelL", "heelR", "occiput"] as const) {
    if (!withPoints) {
      result[region] = {
        region,
        samples: gaps[region].length,
        contactGapMeters: selectContactGap(gaps[region]),
        minGapMeters: Number.isFinite(minimum[region]) ? minimum[region] : null,
      };
      continue;
    }
    const ordered = gaps[region].map((gap, i) => ({ gap, point: points[region][i]! })).sort((a, b) => a.gap - b.gap);
    const values = ordered.map((row) => row.gap);
    const patch = ordered.slice(0, Math.max(1, Math.ceil(ordered.length * 0.08)));
    const point = patch.length ? patch.reduce((sum, row) => sum.add(row.point), new Vector3()).divideScalar(patch.length) : null;
    result[region] = {
      region,
      samples: values.length,
      contactGapMeters: quantile(values, 0.08),
      minGapMeters: Number.isFinite(minimum[region]) ? minimum[region] : null,
      ...(point ? { contactPoint: { x: point.x, y: point.y, z: point.z } } : {}),
    };
  }
  return result;
}

/** Lower the root until every required region reaches the contact band; never hides penetration. */
export function settleSupineSupportRegions(
  humanoid: Object3D,
  planes: Readonly<Record<SupineSupportRegion, SupineSupportPlane>>,
  targetGapMeters = 0.025,
  maxTranslationMeters = 0.25,
): number {
  const measured = measureSupineSupportRegions(humanoid, planes);
  const required = [measured.pelvis, measured.lumbar, measured.thorax]
    .filter((row) => row.samples >= 8 && row.contactGapMeters !== null);
  if (required.length < 2) return 0;
  const worstGap = Math.max(...required.map((row) => row.contactGapMeters!));
  const excess = worstGap - targetGapMeters;
  if (!Number.isFinite(excess) || excess <= 1e-4) return 0;
  // Root translation is the conservative first rung, not a ragdoll: do not close one floating
  // region by driving another rendered patch through the mattress. Residual regional mismatch is
  // left visible for a later bounded spine/limb solve.
  const penetrationAllowance = 0.02;
  const nonPenetratingLimit = Math.min(...required.map((row) =>
    Math.max(0, (row.minGapMeters ?? 0) + penetrationAllowance)));
  const delta = Math.min(excess, maxTranslationMeters, nonPenetratingLimit);
  if (delta <= 1e-4) return 0;
  humanoid.position.y -= delta;
  humanoid.updateMatrixWorld?.(true);
  humanoid.userData["openClinXrSupineRegionalSettleMeters"] = delta;
  return delta;
}
