/**
 * THE SURFACE-AWARE CONTACT GEOMETRY — what a contact region's surface record adds to a point.
 *
 * Card tsk_ba168fa10b064fa3. The contact-window schedule (`src/contact/contact-window-schedule.ts`)
 * decides WHEN the effector holds WHICH contact point; this module is the surface half of the
 * geometry: it reads a profile's per-region `regionSurfaces` records — a surface point `S` and an
 * outward normal in `REGION_ANCHOR_SPACE` — and turns a contact that used to aim at the buried
 * region anchor into a contact the guard can HOLD against the surface: bounded penetration, the
 * effector ON the surface point, and the effector's own axis oriented to the outward normal.
 *
 * WHY A SURFACE AND NOT A POINT. The guard's arm solve reaches whatever point it is handed, and
 * the region anchor is a bind-frame proxy at the body's reference depth. Contact is made at the
 * SURFACE POINT; the depth between anchor and surface is exactly the penetration a point clamp
 * hides — the wrist rests on the buried proxy and nobody can tell it crossed the surface plane.
 * The surface record is what makes depth and facing checkable relationships instead of caller
 * summaries: `penetrationToleranceMeters` bounds the effector past the plane through `S`, and
 * `orientationToleranceRadians` bounds the effector's own axis against the outward normal.
 *
 * WHAT THIS MODULE OWNS:
 *   - refusing a contact whose region carries a wrong-facing or malformed surface record — a
 *     compile-time throw, never a silent clip that touches the far side of the surface;
 *   - the contact TARGET for each contact: the surface point when the region names a surface,
 *     the anchor otherwise (every pre-surface profile passes through untouched, so the guard
 *     plant and all earlier contracts keep their behaviour);
 *   - the free single-joint wrist rotation that maps the effector's own axis onto the outward
 *     normal. A rotation about the wrist cannot move the wrist position — shoulder and elbow set
 *     position, wrist orientation is the decoupled remainder — which is the arithmetic the
 *     planted contract freezes ("solve the arm to S ... then choose the wrist rotation so the
 *     wrist-local +Z maps onto outwardNormal in world space").
 *
 * A profile that carries NO `regionSurfaces` at all (every profile before this card) is passed
 * through unchanged: the anchor clamp remains the behaviour for regions with no surface record.
 * Surfaces are consulted ONLY for the region a contact names; a record for another region cannot
 * change this contact.
 *
 * notEvidenceFor: clinical_validity, biomechanical_validity, production_animation_quality,
 * exam_equivalence, scoring, learner_readiness. Whether surface records are right for non-torso
 * contacts, how they are DERIVED from shipped rig/mesh geometry (the producer, upstream of this
 * consumer), and per-surface tolerance values are deliberately outside this module.
 */

import { REGION_ANCHOR_SPACE } from "./plant-motion-regions.js";
import type { ChainJoint, Quat, SolvedArmPose, Vec3 } from "./ik/solve-chain.js";

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
/** The effector's own axis in its local frame at bind — the axis the fixture orients to the normal. */
const EFFECTOR_AXIS: Vec3 = { x: 0, y: 0, z: 1 };

function qMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function qConj(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

function isFiniteVec3(v: unknown): v is Vec3 {
  if (typeof v !== "object" || v === null) return false;
  const p = v as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof p.x === "number" && Number.isFinite(p.x) &&
    typeof p.y === "number" && Number.isFinite(p.y) &&
    typeof p.z === "number" && Number.isFinite(p.z)
  );
}

/** Unit vector along `v`, or undefined when `v` has no direction. */
function unitOrUndefined(v: Vec3): Vec3 | undefined {
  const n = norm3(v);
  return n > 1e-9 ? { x: v.x / n, y: v.y / n, z: v.z / n } : undefined;
}

function axisAngleQuat(axis: Vec3, angle: number): Quat {
  const half = angle / 2;
  const s = Math.sin(half);
  const c = Math.cos(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: c };
}

/** Any unit vector perpendicular to `v`. */
function anyPerpendicular(v: Vec3): Vec3 {
  const ref = Math.abs(v.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const axis = cross3(v, ref);
  const n = norm3(axis);
  return n > 1e-9 ? { x: axis.x / n, y: axis.y / n, z: axis.z / n } : { x: 1, y: 0, z: 0 };
}

/**
 * The MINIMAL rotation sending `from` onto `to` (both unit). Identity when they already coincide;
 * a half-turn about an arbitrary perpendicular when they oppose.
 */
function quatFromTo(from: Vec3, to: Vec3): Quat {
  const axis = cross3(from, to);
  const axisNorm = norm3(axis);
  if (axisNorm > 1e-9) {
    const angle = Math.acos(Math.min(1, Math.max(-1, dot3(from, to))));
    return axisAngleQuat({ x: axis.x / axisNorm, y: axis.y / axisNorm, z: axis.z / axisNorm }, angle);
  }
  return dot3(from, to) >= 0 ? { ...IDENTITY } : axisAngleQuat(anyPerpendicular(from), Math.PI);
}

/** The shape a profile's `regionSurfaces[region]` record must have. */
export type RegionSurfaceRecord = { point: Vec3; outwardNormal: Vec3 };

/**
 * The resolved contact target for one contact: the point the arm solve must reach, plus the
 * outward normal the effector's own axis must be oriented to when the region names a surface.
 */
export type SurfaceContactTarget = { point: Vec3; outwardNormal?: Vec3 };

export type SurfaceContactInput = {
  /** The profile's `regionSurfaces` map, when the profile carries one at all. */
  regionSurfaces: Readonly<Record<string, unknown>> | undefined;
  /** Per contact: the contacted region and the bind-frame anchor it already resolved to. */
  contacts: readonly { regionId: string; anchor: Vec3 }[];
};

/**
 * Resolve each contact to the point a surface-aware solve must reach.
 *
 * A region WITHOUT a surface record keeps its anchor — the point clamp is the pre-surface
 * contract, and every profile that predates this card passes through unchanged. A region WITH a
 * record is refused when the record is malformed or when the outward normal does not point from
 * the anchor toward the surface point: a wrong-facing surface would make the effector cross the
 * surface to touch its outside face, and a solver that compiled that has never read the surface.
 */
export function resolveSurfaceContactTargets(input: SurfaceContactInput): SurfaceContactTarget[] {
  const surfaces = input.regionSurfaces;
  return input.contacts.map((contact) => {
    const raw = surfaces?.[contact.regionId];
    if (raw === undefined) return { point: contact.anchor };
    if (typeof raw !== "object" || raw === null) {
      throw new Error(
        `contact surface: region "${contact.regionId}" carries a non-object surface record — a surface is a point plus an outward normal`,
      );
    }
    const record = raw as { point?: unknown; outwardNormal?: unknown };
    if (!isFiniteVec3(record.point)) {
      throw new Error(
        `contact surface: region "${contact.regionId}" carries a surface whose point is not a finite ${REGION_ANCHOR_SPACE} position`,
      );
    }
    if (!isFiniteVec3(record.outwardNormal)) {
      throw new Error(
        `contact surface: region "${contact.regionId}" carries a surface whose outward normal is not a finite vector`,
      );
    }
    const normal = unitOrUndefined(record.outwardNormal);
    if (normal === undefined) {
      throw new Error(
        `contact surface: region "${contact.regionId}" carries a zero outward normal — no face is declared`,
      );
    }
    // The outward normal must point from the buried anchor TOWARD the surface point (out of the
    // body). A normal pointing the other way faces INTO the body: the effector would have to
    // cross the surface to touch its outside face, so the compile is refused, never resolved.
    const toSurface = {
      x: record.point.x - contact.anchor.x,
      y: record.point.y - contact.anchor.y,
      z: record.point.z - contact.anchor.z,
    };
    if (dot3(normal, toSurface) <= 0) {
      throw new Error(
        `contact surface: region "${contact.regionId}" is wrong-facing — its outward normal does not point from the region anchor toward the surface point, so a clip could only touch it from the inside`,
      );
    }
    return { point: record.point, outwardNormal: normal };
  });
}

/**
 * Add the surface orientation to a solved arm pose: replace the wrist rotation with the free
 * single-joint rotation that maps the effector's own axis (wrist-local +Z) onto `outwardNormal`
 * in world space.
 *
 * Position was fixed by shoulder + elbow before this call and a wrist rotation cannot move the
 * wrist, so the replacement never disturbs the reach. The world frame the wrist completes is the
 * accumulation a clip consumer walks: the bind rotations of the shoulder's ancestors, then the
 * emitted ABSOLUTE node-local rotations at shoulder and elbow (which replace those bones' bind
 * rotations per `rotationAbsoluteNodeLocal`), then the wrist.
 */
export function orientWristToSurfaceNormal(
  pose: SolvedArmPose,
  joints: readonly ChainJoint[],
  outwardNormal: Vec3,
): SolvedArmPose {
  const normal = unitOrUndefined(outwardNormal);
  if (normal === undefined) {
    throw new Error("contact surface: cannot orient an effector to a zero outward normal");
  }
  const byName = new Map(joints.map((j) => [j.boneName, j]));
  const shoulder = byName.get(pose.shoulderBone);
  if (shoulder === undefined) {
    throw new Error(`contact surface: solved pose names shoulder "${pose.shoulderBone}" but the rig has no such joint`);
  }

  // Bind rotations of the shoulder's ancestors, root-first — the frame ABOVE the driven chain.
  const ancestors: Quat[] = [];
  let parentName = shoulder.parentBoneName;
  while (parentName !== undefined) {
    const parent = byName.get(parentName);
    if (parent === undefined) {
      throw new Error(`contact surface: the rig chain breaks above "${pose.shoulderBone}" at "${parentName}"`);
    }
    ancestors.unshift(parent.bindLocalQuaternion);
    parentName = parent.parentBoneName;
  }
  let worldQ: Quat = IDENTITY;
  for (const bind of ancestors) worldQ = qMul(worldQ, bind);

  // The wrist's parent frame at the SOLVED pose: ancestor binds + absolute shoulder/elbow locals.
  worldQ = qMul(qMul(worldQ, pose.shoulderLocal), pose.elbowLocal);

  // Choose the wrist rotation that completes the chain to the minimal rotation sending the
  // effector's own +Z axis onto the outward normal in world space.
  const desired = quatFromTo(EFFECTOR_AXIS, normal);
  const wristLocal = qMul(qConj(worldQ), desired);
  return { ...pose, wristLocal };
}
