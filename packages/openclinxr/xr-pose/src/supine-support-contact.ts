/**
 * Multi-region rendered-surface contact for supine actors.
 *
 * The earlier contact checks reduced a whole body to one lowest vertex. A heel, hand, or garment
 * corner could therefore certify contact while the pelvis and back visibly floated. This module
 * reads the deformed SkinnedMesh surface and keeps pelvis, lumbar, and thorax measurements separate.
 */
import {
  STRETCHER_LENGTH_METERS,
} from "@openclinxr/xr-station";
import { type Object3D, Vector3 } from "three";

export type SupineSupportRegion = "pelvis" | "lumbar" | "thorax";

export type SupineSupportPlane = {
  origin: Vector3;
  normal: Vector3;
  /** Optional finite-footprint predicate in world space. */
  contains?: (world: Vector3) => boolean;
};

export function makeSupineSupportPlanes(
  stretcher: Object3D | undefined,
  deckTopWorldY: number,
): Readonly<Record<SupineSupportRegion, SupineSupportPlane>> {
  const seatOrigin = new Vector3(0, deckTopWorldY, 0);
  const seatNormal = new Vector3(0, 1, 0);
  if (!stretcher) {
    const plane = { origin: seatOrigin, normal: seatNormal };
    return { pelvis: plane, lumbar: plane, thorax: plane };
  }
  stretcher.updateMatrixWorld(true);
  let back: Object3D | null = null;
  stretcher.traverse((object) => {
    if (!back && object.userData?.openClinXrDeckSection === "back") back = object;
  });
  const seatContains = (world: Vector3): boolean => {
    const local = stretcher.worldToLocal(world.clone());
    return local.x >= -0.04
      && local.x <= STRETCHER_LENGTH_METERS / 2 + 0.04
      && Math.abs(local.z) <= STRETCHER_HALF_WIDTH_METERS + 0.04;
  };
  const pelvis = { origin: seatOrigin, normal: seatNormal, contains: seatContains };
  if (!back) return { pelvis, lumbar: pelvis, thorax: pelvis };
  const backObject: Object3D = back;
  backObject.updateWorldMatrix?.(true, false);
  const e = backObject.matrixWorld.elements;
  const backPlane: SupineSupportPlane = {
    origin: new Vector3().setFromMatrixPosition(backObject.matrixWorld),
    normal: new Vector3(e[4]!, e[5]!, e[6]!).normalize(),
    contains: (world) => {
      const local = backObject.worldToLocal(world.clone());
      return local.x >= -STRETCHER_LENGTH_METERS / 2 - 0.04
        && local.x <= 0.04
        && Math.abs(local.z) <= STRETCHER_HALF_WIDTH_METERS + 0.04;
    },
  };
  return { pelvis, lumbar: backPlane, thorax: backPlane };
}

export type SupineSupportRegionMetric = {
  region: SupineSupportRegion;
  samples: number;
  /** Lower-surface estimate. A quantile prevents one outlier vertex from certifying contact. */
  contactGapMeters: number | null;
  /** Deepest rendered vertex, retained as the penetration counterweight. */
  minGapMeters: number | null;
};

type Attribute = {
  count: number;
  getX: (index: number) => number;
  getY: (index: number) => number;
  getZ: (index: number) => number;
  getW?: (index: number) => number;
};

type SkinnedLike = Object3D & {
  isSkinnedMesh?: boolean;
  geometry?: { attributes?: { position?: Attribute; skinIndex?: Attribute; skinWeight?: Attribute } };
  skeleton?: { bones: Object3D[]; update?: () => void };
  getVertexPosition?: (index: number, target: Vector3) => Vector3;
};

const PELVIS = /pelvis|hips|upperleg|thigh/iu;
const LUMBAR = /spine0?[1-2]|spine$|abdomen|lumbar/iu;
const THORAX = /spine0?[3-6]|chest|breast|clavicle|shoulder/iu;
const STRETCHER_HALF_WIDTH_METERS = 0.45;

function regionForVertex(mesh: SkinnedLike, index: number): SupineSupportRegion | null {
  const indices = mesh.geometry?.attributes?.skinIndex;
  const weights = mesh.geometry?.attributes?.skinWeight;
  if (!indices || !weights || !mesh.skeleton?.bones) return null;
  let bestWeight = 0;
  let bestName = "";
  for (let lane = 0; lane < 4; lane += 1) {
    const weight = lane === 0 ? weights.getX(index)
      : lane === 1 ? weights.getY(index)
        : lane === 2 ? weights.getZ(index)
          : (weights.getW?.(index) ?? 0);
    if (weight <= bestWeight) continue;
    const boneIndex = lane === 0 ? indices.getX(index)
      : lane === 1 ? indices.getY(index)
        : lane === 2 ? indices.getZ(index)
          : (indices.getW?.(index) ?? 0);
    bestWeight = weight;
    bestName = mesh.skeleton.bones[boneIndex]?.name ?? "";
  }
  if (PELVIS.test(bestName)) return "pelvis";
  if (THORAX.test(bestName)) return "thorax";
  if (LUMBAR.test(bestName)) return "lumbar";
  return null;
}

function quantile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index] ?? null;
}

/**
 * Measure the rendered (morphed + skinned) underside against finite support surfaces.
 * The eighth percentile represents a patch of surface rather than the single lowest vertex.
 */
export function measureSupineSupportRegions(
  humanoid: Object3D,
  planes: Readonly<Record<SupineSupportRegion, SupineSupportPlane>>,
): Readonly<Record<SupineSupportRegion, SupineSupportRegionMetric>> {
  humanoid.updateMatrixWorld?.(true);
  const gaps: Record<SupineSupportRegion, number[]> = { pelvis: [], lumbar: [], thorax: [] };
  const local = new Vector3();
  const world = new Vector3();
  humanoid.traverse((object) => {
    const mesh = object as SkinnedLike;
    const position = mesh.geometry?.attributes?.position;
    if (!mesh.isSkinnedMesh || !position || !mesh.getVertexPosition || !mesh.skeleton) return;
    mesh.skeleton.update?.();
    const stride = Math.max(1, Math.floor(position.count / 6000));
    for (let index = 0; index < position.count; index += stride) {
      const region = regionForVertex(mesh, index);
      if (!region) continue;
      mesh.getVertexPosition(index, local);
      world.copy(local).applyMatrix4(mesh.matrixWorld);
      const plane = planes[region];
      if (plane.contains && !plane.contains(world)) continue;
      gaps[region].push(plane.normal.dot(world.clone().sub(plane.origin)));
    }
  });
  const result = {} as Record<SupineSupportRegion, SupineSupportRegionMetric>;
  for (const region of ["pelvis", "lumbar", "thorax"] as const) {
    const values = gaps[region].sort((a, b) => a - b);
    result[region] = {
      region,
      samples: values.length,
      contactGapMeters: quantile(values, 0.08),
      minGapMeters: values[0] ?? null,
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
  humanoid.userData.openClinXrSupineRegionalSettleMeters = delta;
  return delta;
}
