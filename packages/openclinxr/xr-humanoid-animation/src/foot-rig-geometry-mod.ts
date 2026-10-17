import type { Object3D } from "three";
import { findSteppingLegChain } from "./stepping-turn-leg-ik-mod.js";

/**
 * Rig-aware foot geometry (DENSE_v1 slice).
 *
 * DEFECT (actors-readiness, child-cand 3/3): arrival pitch 12.2-12.6 deg with
 * heels 17-26 mm lifted, plus a marginal slide run0 0.0123 m/m. The walk is
 * fine (mid-stance pitch flat), so the defect is the arrival writer running
 * PHYSICIAN constants on a 0.674x foot: production foot-flatten HEEL_LOCAL,
 * FOOT_BASE_HEIGHT_DATUM, and the row height/lateral excursions have no
 * per-rig scaling (nurse foot 0.984x, child foot 0.674x rest foot->toe).
 *
 * MECHANISM (one): at first use, derive per-rig constants from the rig's own
 * skeleton rest pose and cache them on the actor slot:
 * - heel-contact local for foot-flatten: the physician heel local scaled by
 *   the rig's rest foot->toe ratio (same definition as the capture's per-rig
 *   heel local);
 * - length scale k = rig leg length / physician leg length, applied by the
 *   callers to the foot-base row heights/excursions and the height datum
 *   (horizontal footholds already come from the plan; timing phases stay
 *   as-is in this slice).
 *
 * POSE-INVARIANCE: the measures read bone LOCAL offsets. The walk clip's
 * translation tracks are constant (verified: they carry the bind values, span
 * 0 on every leg/foot/toe bone of the shipped physician GLB), so the lengths
 * below read rest geometry at any time, including mid-walk. Leg length sums
 * segment locals (hip->ankle) rather than a world distance so knee bend never
 * enters. Slot scale cancels in the ratios.
 *
 * PHYSICIAN IDENTITY: the reference values are the shipped physician GLB
 * node translations verbatim; a rig measuring within 1e-9 relative snaps to
 * exactly 1, so the physician callers take their legacy (k === 1 /
 * footScale === 1) branches and emit byte-identical outputs. Anything without
 * leg chains (headless markers) falls back to identity.
 *
 * Nothing here is package-public: deep imports only, no index/foot-base
 * re-export (no new public exports).
 */

export type RigFootSide = "left" | "right";

/** Rest foot->toe length off the shipped physician GLB (toe1-1.L translation). */
export const PHYSICIAN_FOOT_TOE_REST_M = 0.1402248740196228;

/**
 * Rest hip->ankle length off the shipped physician GLB (sum of the
 * upperleg02 + lowerleg01 + lowerleg02 + foot local lengths, left side).
 */
export const PHYSICIAN_LEG_REST_M = 0.8497691452503204;

/**
 * Physician heel-sole contact in the foot-bone frame. Keep in sync with
 * foot-flatten-mod.ts HEEL_LOCAL (same GLB calibration, same values).
 */
export const PHYSICIAN_HEEL_LOCAL: Record<RigFootSide, { x: number; y: number; z: number }> = {
  left: { x: -0.0022, y: 0.01817, z: 0.06779 },
  right: { x: 0.0022, y: 0.01817, z: 0.06779 },
};

/** Relative snap epsilon for the physician identity (far below any real inter-rig gap). */
const IDENTITY_SNAP_REL = 1e-9;

export type RigFootGeometry = {
  /** Rig rest foot->toe over the physician's (1 on physician; ~0.674 child). */
  footScale: number;
  /** Rig rest leg over the physician's (1 on physician; ~0.705 child). */
  lengthScale: number;
  /** Per-side heel-contact local (physician literal on physician). */
  heelLocal: Record<RigFootSide, { x: number; y: number; z: number }>;
  /** Mean measured rest foot->toe in metres, null when no chain resolved. */
  footToeRestM: number | null;
  /** Mean measured rest hip->ankle in metres, null when no chain resolved. */
  legRestM: number | null;
  /** True only when both leg chains resolved. */
  complete: boolean;
};

const cache = new WeakMap<Object3D, RigFootGeometry>();

function snapIdentity(value: number): number {
  return Math.abs(value - 1) < IDENTITY_SNAP_REL ? 1 : value;
}

function localLength(bone: Object3D): number {
  const p = bone.position;
  return Math.hypot(p.x, p.y, p.z);
}

function identityGeometry(): RigFootGeometry {
  return {
    footScale: 1,
    lengthScale: 1,
    heelLocal: {
      left: { ...PHYSICIAN_HEEL_LOCAL.left },
      right: { ...PHYSICIAN_HEEL_LOCAL.right },
    },
    footToeRestM: null,
    legRestM: null,
    complete: false,
  };
}

function measureRigFootGeometry(actorSlot: Object3D): RigFootGeometry {
  const footToes: number[] = [];
  const legs: number[] = [];
  for (const side of ["left", "right"] as const) {
    const chain = findSteppingLegChain(actorSlot, side);
    if (chain === null) continue;
    const footToe = localLength(chain.toe);
    const leg =
      localLength(chain.upperMid) + localLength(chain.knee) + localLength(chain.lowerMid) + localLength(chain.heel);
    if (!(footToe > 1e-6 && leg > 1e-6)) continue;
    footToes.push(footToe);
    legs.push(leg);
  }
  if (footToes.length === 0 || legs.length === 0) return identityGeometry();
  const footToeMean = footToes.reduce((a, b) => a + b, 0) / footToes.length;
  const legMean = legs.reduce((a, b) => a + b, 0) / legs.length;
  const footScale = snapIdentity(footToeMean / PHYSICIAN_FOOT_TOE_REST_M);
  const lengthScale = snapIdentity(legMean / PHYSICIAN_LEG_REST_M);
  const scaled = (base: { x: number; y: number; z: number }): { x: number; y: number; z: number } =>
    footScale === 1
      ? { ...base }
      : { x: base.x * footScale, y: base.y * footScale, z: base.z * footScale };
  return {
    footScale,
    lengthScale,
    heelLocal: { left: scaled(PHYSICIAN_HEEL_LOCAL.left), right: scaled(PHYSICIAN_HEEL_LOCAL.right) },
    footToeRestM: footToeMean,
    legRestM: legMean,
    complete: footToes.length === 2,
  };
}

/**
 * This actor slot's rig foot geometry, derived once from its own skeleton
 * rest pose and cached. Physician (and chain-less) slots yield identity.
 */
export function resolveRigFootGeometry(actorSlot: Object3D): RigFootGeometry {
  const hit = cache.get(actorSlot);
  if (hit !== undefined) return hit;
  const built = measureRigFootGeometry(actorSlot);
  cache.set(actorSlot, built);
  return built;
}

/** Drop a slot's cached geometry (tests). */
export function clearRigFootGeometryCache(actorSlot?: Object3D): void {
  if (actorSlot !== undefined) cache.delete(actorSlot);
}
