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
import { type Material, type Object3D, Vector3 } from "three";

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
  let back: Object3D | null = null;
  let seat: Object3D | null = null;
  stretcher.traverse((object) => {
    if (!back && object.userData?.openClinXrDeckSection === "back") back = object;
    if (!seat && object.userData?.openClinXrDeckSection === "seat") seat = object;
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
    const local = stretcher.worldToLocal(world.clone());
    return local.x >= -0.04
      && local.x <= STRETCHER_LENGTH_METERS / 2 + 0.04
      && Math.abs(local.z) <= STRETCHER_HALF_WIDTH_METERS + 0.04;
  };
  const pelvis = { origin: seatOrigin, normal: seatNormal, forward: seatForward, contains: seatContains };
  if (!back) return { pelvis, lumbar: pelvis, thorax: pelvis, heelL: pelvis, heelR: pelvis, occiput: pelvis };
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
  let pillow: Object3D | null = null;
  stretcher.traverse((object) => { if (/\.pillow$/u.test(object.name)) pillow = object; });
  const pillowObject = pillow as Object3D | null;
  const occiput: SupineSupportPlane = {
    ...backPlane,
    origin: backPlane.origin.clone().addScaledVector(backPlane.normal, 0.08),
    outsideCollisionPlane: backPlane,
    contains: provisionalPillow || !pillowObject ? (world) => backPlane.contains?.(world) ?? true : (world) => {
      const local = pillowObject.worldToLocal(world.clone());
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

type Attribute = {
  count: number;
  getX: (index: number) => number;
  getY: (index: number) => number;
  getZ: (index: number) => number;
  getW?: (index: number) => number;
};

type SkinnedLike = Object3D & {
  isSkinnedMesh?: boolean;
  material?: Material | Material[];
  geometry?: { computeBoundingBox?: () => void; boundingBox?: { max: Vector3 }; index?: Attribute; groups?: Array<{ start: number; count: number; materialIndex?: number }>; attributes?: { position?: Attribute; normal?: Attribute; skinIndex?: Attribute; skinWeight?: Attribute } };
  skeleton?: { bones: Object3D[]; update?: () => void };
  getVertexPosition?: (index: number, target: Vector3) => Vector3;
};

const PELVIS = /pelvis|hips/iu;
const LUMBAR = /spine0?[2-5]|spine1$|spine$|abdomen|lumbar/iu;
const THORAX = /spine01$|spine2$|chest|breast|clavicle|shoulder/iu;
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
  bestName = bestName.replace(/\./gu, "");
  if (/^head$/iu.test(bestName)) return "occiput";
  if (/foot|heel/iu.test(bestName)) return /L$|left/iu.test(bestName) ? "heelL" : "heelR";
  if (bestName === "root" || PELVIS.test(bestName)) return "pelvis";
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
 * Measure the deformed anatomical body underside against finite support surfaces.
 * Clothing masks hide body fragments in pixels but do not remove the body collision envelope.
 * When an MPFB body exists, garment/shoe vertices cannot certify torso/heel contact.
 * The eighth percentile represents a patch of surface rather than the single lowest vertex.
 */
export function measureSupineSupportRegions(
  humanoid: Object3D,
  planes: Readonly<Record<SupineSupportRegion, SupineSupportPlane>>,
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
    const rendered = (material: Material | undefined) => material && material.visible
      && !(material.opacity <= material.alphaTest || (material.transparent && material.opacity <= 0));
    if (!anatomicalBody && materials.every((material) => !rendered(material))) return;
    const visibleIndices = new Set<number>();
    const groups = mesh.geometry?.groups;
    if (groups?.length) for (const group of groups) {
      if (!anatomicalBody && !rendered(materials[group.materialIndex ?? 0])) continue;
      for (let i = group.start; i < group.start + group.count; i += 1) visibleIndices.add(mesh.geometry?.index?.getX(i) ?? i);
    }
    mesh.skeleton.update?.();
    const stride = Math.max(1, Math.floor(position.count / 6000));
    for (let index = 0; index < position.count; index += stride) {
      if (groups?.length && !visibleIndices.has(index)) continue;
      const region = regionForVertex(mesh, index);
      if (!region) continue;
      mesh.getVertexPosition(index, local);
      world.copy(local).applyMatrix4(mesh.matrixWorld);
      const plane = planes[region];
      if (plane.contains && !plane.contains(world)) {
        const underlying = plane.outsideCollisionPlane;
        if (underlying && (!underlying.contains || underlying.contains(world))) {
          minimum[region] = Math.min(minimum[region], underlying.normal.dot(world.clone().sub(underlying.origin)));
        }
        continue;
      }
      const gap = plane.normal.dot(world.clone().sub(plane.origin));
      minimum[region] = Math.min(minimum[region], gap);
      // Contact belongs to the posterior skull. The minimum retains the head-weighted
      // anatomical envelope, including its face-side points; jaw/neck-weighted vertices are
      // outside this metric and must also be checked in rendered acceptance.
      const normal = mesh.geometry?.attributes?.normal;
      if (region === "occiput" && normal && normal.getZ(index) >= 0) continue;
      gaps[region].push(gap);
      points[region].push(world.clone());
    }
  });
  const result = {} as Record<SupineSupportRegion, SupineSupportRegionMetric>;
  for (const region of ["pelvis", "lumbar", "thorax", "heelL", "heelR", "occiput"] as const) {
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
  humanoid.userData.openClinXrSupineRegionalSettleMeters = delta;
  return delta;
}
