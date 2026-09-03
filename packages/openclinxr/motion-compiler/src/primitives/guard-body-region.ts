import type { CompiledMotionFragment, CompiledMotionTrack, PrimitiveRequest } from "../canonical-motion-contract.js";
import { REGION_ANCHOR_SPACE } from "../plant-motion-regions.js";
import { resolvePoseBone } from "../../../asset-registry/src/pose-bone-resolver.js";
import { requestedEffector } from "../requested-effector.js";
import { solveArmChain, type ChainJoint, type Quat } from "../ik/solve-chain.js";
import {
  orientWristToSurfaceNormal,
  resolveSurfaceContactTargets,
} from "../contact.js";
import {
  planContactWindowKeys,
  type ContactKey,
  type ContactPoint,
  type ContactWindowInput,
} from "../contact/contact-window-schedule.js";

/**
 * `guard_body_region` — the arm chain drives the effector hand to a MOTION REGION anchor and
 * holds the guarded posture there.
 *
 * Owned by M2 (tsk_744eea9a35614caf). The registry seam (tsk_51ffcc3e1a8fdea8) resolves
 * `guard_body_region` to this module's `compile` through the ownership slot at
 * `src/guard-body-region.ts`, which redirects here — the slot's body is replaced, never the
 * registry.
 *
 * BEHAVIOUR: a guard is a GEOMETRY solve, not a pose table. The request's target is a MOTION
 * REGION id (`{ kind: "body_region", id }`); the primitive resolves it to a bind-world anchor on
 * THIS rig (`profile.regionAnchors`), resolves the chain of the REQUESTED effector — the action's
 * `effector` (handL/handR), falling back to the profile's legacy `effectorBone` — through
 * `resolvePoseBone` (identity-then-alias across the 23-bone / MPFB2 / mixamorig families,
 * ancestor-verified and side-checked against the rig's own canonical wrists), and asks the
 * `src/ik/solve-chain.ts` seam for shoulder + elbow rotations that put the wrist on the anchor
 * plus a rig-derived wrist pronation. Without contact constraints the clip is the 3-keyframe
 * neutral -> peak -> settle shape whose PEAK is the solved pose, so the fragment's FK reaches the
 * anchor at the frame the guard plant measures.
 *
 * CONTACT WINDOWS (issue #0): when the action declares `kind: "contact"` constraints, the contact
 * windows override that shape. The schedule in `src/contact/contact-window-schedule.ts` decides
 * which contact point the effector holds at which fraction of the clip — a preserved contact is a
 * hard hold across its whole window (identical pose keys bracket the window, so the interpolated
 * effector never drifts off it), a releasable contact yields to a preserved one, and a program no
 * single pose can satisfy is refused. The guard resolves each contact's region anchor on this rig
 * and supplies the solved pose per scheduled point.
 *
 * REFUSALS — never a silent default:
 *   - a profile that DECLARES an anchor space this module does not implement throws (the plant's
 *     clause (0b): a misread frame solves cleanly and puts the hand somewhere else on the body);
 *   - a target id with no anchor on this rig throws (the anchor map is the data, there is no
 *     per-target pose table);
 *   - an arm chain the alias map cannot resolve or that disagrees with the rig's own parent links
 *     throws.
 *
 * A profile that carries NO anchor space at all predates the anchor contract (the registry seam's
 * own fixture) and cannot express a reach; it gets the canonical EMPTY fragment the seam's contract
 * blesses, so the registry-level tests stay live.
 *
 * notEvidenceFor: clinical_validity, biomechanical_validity, production_animation_quality,
 * exam_equivalence, scoring, learner_readiness. Whether the pose LOOKS like guarding is a pixel
 * grade, deliberately outside this module.
 */

type Vec3 = { x: number; y: number; z: number };

const DEFAULT_DURATION_MS = 900;
const DEFAULT_INTENSITY = 0.6;
/** The peak keyframe sits here, as a fraction of the clip duration. */
const PEAK_FRACTION = 0.45;
/** How much of the peak rotation the settle keyframe retains (tied to the action intensity). */
const SETTLE_RETENTION = { min: 0.1, max: 0.4, perIntensity: 0.3 };

type ProfileView = {
  rigFingerprint?: unknown;
  effectorBone?: unknown;
  joints?: unknown;
  regionAnchorSpace?: unknown;
  regionAnchors?: unknown;
  regionSurfaces?: unknown;
};

function isVec3(v: unknown): v is Vec3 {
  if (typeof v !== "object" || v === null) return false;
  const p = v as { x?: unknown; y?: unknown; z?: unknown };
  return typeof p.x === "number" && Number.isFinite(p.x)
    && typeof p.y === "number" && Number.isFinite(p.y)
    && typeof p.z === "number" && Number.isFinite(p.z);
}

function readActionId(request: PrimitiveRequest): string {
  const actionId = (request.action as { actionId?: unknown }).actionId;
  if (typeof actionId !== "string" || actionId.length === 0) {
    throw new Error("guard_body_region requires a request whose action carries a string actionId");
  }
  return actionId;
}

function readDurationMs(action: unknown): number {
  const durationMs = (action as { timing?: { durationMs?: unknown } }).timing?.durationMs;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : DEFAULT_DURATION_MS;
}

function readIntensity(action: unknown): number {
  const intensity = (action as { intensity?: unknown }).intensity;
  return typeof intensity === "number" && Number.isFinite(intensity) ? intensity : DEFAULT_INTENSITY;
}

function readTarget(action: unknown): { kind: "body_region"; id: string } {
  const target = (action as { target?: unknown }).target as { kind?: unknown; id?: unknown } | undefined;
  if (target?.kind !== "body_region" || typeof target.id !== "string" || target.id.length === 0) {
    throw new Error("guard_body_region requires a target of kind body_region with a string id");
  }
  return { kind: "body_region", id: target.id };
}

/**
 * Resolve the effector's arm chain on this rig: the requested effector (the action's, falling back
 * to the profile's legacy `effectorBone`), alias-resolved to the bone THIS rig carries, then the
 * chain walked parent-first from that wrist. The chain's side is read from the rig itself — which
 * canonical wrist the resolved bone equals — so a LEFT effector drives the left arm and a right
 * effector the right arm, and the alias map must name the SAME chain the rig's own parent links do.
 */
function resolveArmChain(profile: ProfileView, request: PrimitiveRequest): { shoulderName: string; elbowName: string; wristName: string } {
  const joints = profile.joints as readonly ChainJoint[] | undefined;
  if (!Array.isArray(joints) || joints.length === 0) {
    throw new Error("guard_body_region: profile carries no joints — no arm to solve");
  }
  const jointSet = new Set(joints.map((j) => j.boneName));
  const effector = requestedEffector(request);
  if (typeof effector !== "string" || effector.length === 0) {
    throw new Error("guard_body_region: the request names no effector and the profile carries no effectorBone — the wrist cannot be named");
  }

  const wristName = resolvePoseBone(effector, jointSet);
  if (wristName === null) {
    throw new Error(`guard_body_region: effector "${effector}" does not resolve to a bone on this rig`);
  }
  const byName = new Map(joints.map((j) => [j.boneName, j]));
  const wrist = byName.get(wristName);
  const elbow = wrist?.parentBoneName === undefined ? undefined : byName.get(wrist.parentBoneName);
  const shoulder = elbow?.parentBoneName === undefined ? undefined : byName.get(elbow.parentBoneName);
  if (!wrist || !elbow || !shoulder) {
    throw new Error(`guard_body_region: arm chain broken above ${wristName} — a guard needs shoulder -> elbow -> wrist`);
  }

  // CROSS-CHECK against the alias map, on the SIDE the resolved wrist belongs to: the canonical
  // shoulder/elbow landmarks for that side must name the SAME chain the rig's own parent links do.
  // A rig where they disagree is refused, never guessed.
  const canonicalWristL = resolvePoseBone("handL", jointSet);
  const canonicalWristR = resolvePoseBone("handR", jointSet);
  const side = wristName === canonicalWristL ? "L" : wristName === canonicalWristR ? "R" : null;
  if (side === null) {
    throw new Error(
      `guard_body_region: effector "${effector}" resolved to "${wristName}", which is neither canonical wrist of this rig — a guard drives an arm`,
    );
  }
  const aliasShoulder = resolvePoseBone(side === "L" ? "upper_armL" : "upper_armR", jointSet);
  const aliasElbow = resolvePoseBone(side === "L" ? "forearmL" : "forearmR", jointSet);
  if (aliasShoulder !== shoulder.boneName || aliasElbow !== elbow.boneName) {
    throw new Error(
      "guard_body_region: resolved arm chain disagrees with the pose-bone alias map — refused rather than guessed",
    );
  }
  return { shoulderName: shoulder.boneName, elbowName: elbow.boneName, wristName: wrist.boneName };
}

const signCanonical = (q: Quat): Quat => {
  if (q.w !== 0) return q.w > 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  if (q.x !== 0) return q.x > 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  if (q.y !== 0) return q.y > 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  return q.z >= 0 ? q : { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
};

const signMatch = (q: Quat, ref: Quat): Quat => {
  const dot = q.x * ref.x + q.y * ref.y + q.z * ref.z + q.w * ref.w;
  return dot < 0 ? { x: -q.x, y: -q.y, z: -q.z, w: -q.w } : q;
};

/** The rotation `q` scaled to `fraction` of its angle, same axis. */
function scaleRotation(q: Quat, fraction: number): Quat {
  const vn = Math.hypot(q.x, q.y, q.z);
  if (vn < 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  const sign = q.w < 0 ? -1 : 1;
  const angle = 2 * Math.atan2(vn, Math.abs(q.w));
  const axis = { x: (q.x / vn) * sign, y: (q.y / vn) * sign, z: (q.z / vn) * sign };
  const half = (fraction * angle) / 2;
  return { x: axis.x * Math.sin(half), y: axis.y * Math.sin(half), z: axis.z * Math.sin(half), w: Math.cos(half) };
}

type QuatTuple = readonly [number, number, number, number];

/** The 3-keyframe neutral -> peak -> settle values for one bone. */
function keyframes(bindLocalQuaternion: Quat, solved: Quat, retention: number): readonly QuatTuple[] {
  const q0 = signCanonical(bindLocalQuaternion);
  const q1 = signMatch(solved, q0);
  const q2 = signMatch(scaleRotation(q1, retention), q1);
  return [
    [q0.x, q0.y, q0.z, q0.w],
    [q1.x, q1.y, q1.z, q1.w],
    [q2.x, q2.y, q2.z, q2.w],
  ];
}

/**
 * A contact constraint read off the action, resolved far enough to schedule: same driven effector,
 * a bind-frame anchor on THIS rig, and a legal window.
 */
type ResolvedContact = {
  regionId: string;
  positionToleranceMeters: number;
  startFraction: number;
  endFraction: number;
  preserveWhileActive: boolean;
  point: ContactPoint;
  order: number;
};

/** Read + resolve every contact constraint an action carries. A contact this guard cannot honour is refused. */
function resolveContacts(
  action: unknown,
  anchors: Readonly<Record<string, unknown>>,
  wristName: string,
  jointSet: ReadonlySet<string>,
): ResolvedContact[] {
  const rawConstraints = (action as { constraints?: unknown }).constraints;
  if (!Array.isArray(rawConstraints)) return [];
  const out: ResolvedContact[] = [];
  for (const [index, raw] of rawConstraints.entries()) {
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`guard_body_region: constraint ${index} is not an object`);
    }
    const constraint = raw as {
      kind?: unknown;
      effector?: unknown;
      target?: unknown;
      positionToleranceMeters?: unknown;
      startFraction?: unknown;
      endFraction?: unknown;
      preserveWhileActive?: unknown;
    };
    if (constraint.kind !== "contact") {
      throw new Error(`guard_body_region: constraint ${index} has unknown kind ${JSON.stringify(constraint.kind)} — the constraint union is closed over "contact"`);
    }
    if (typeof constraint.effector !== "string" || constraint.effector.length === 0) {
      throw new Error(`guard_body_region: contact ${index} carries no effector`);
    }
    const contactWrist = resolvePoseBone(constraint.effector, jointSet);
    if (contactWrist === null) {
      throw new Error(`guard_body_region: contact ${index} effector "${constraint.effector}" does not resolve to a bone on this rig`);
    }
    if (contactWrist !== wristName) {
      throw new Error(
        `guard_body_region: contact ${index} drives "${contactWrist}" but the action's effector resolves to "${wristName}" — a guard cannot honour a contact on another effector`,
      );
    }
    const target = constraint.target as { kind?: unknown; id?: unknown } | undefined;
    if (target?.kind !== "body_region" || typeof target.id !== "string" || target.id.length === 0) {
      throw new Error(`guard_body_region: contact ${index} requires a target of kind body_region with a string id`);
    }
    const anchor = anchors[target.id];
    if (!isVec3(anchor)) {
      throw new Error(`guard_body_region: contact ${index} region "${target.id}" has no anchor on this rig — a contact this guard cannot resolve is refused`);
    }
    const tolerance = constraint.positionToleranceMeters;
    const start = constraint.startFraction;
    const end = constraint.endFraction;
    if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) {
      throw new Error(`guard_body_region: contact ${index} positionToleranceMeters must be a non-negative finite number`);
    }
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`guard_body_region: contact ${index} carries a non-finite window fraction`);
    }
    const preserve = constraint.preserveWhileActive;
    if (preserve !== undefined && typeof preserve !== "boolean") {
      throw new Error(`guard_body_region: contact ${index} preserveWhileActive must be a boolean`);
    }
    out.push({
      regionId: target.id,
      positionToleranceMeters: tolerance,
      startFraction: start,
      endFraction: end,
      preserveWhileActive: preserve === true,
      point: anchor,
      order: index,
    });
  }
  return out;
}

/**
 * Values for one bone across a CONTACT schedule: bind at rest, the solved pose of each scheduled
 * contact point, and a settle scaled from the last held pose. Sign-aligned per key so the emitted
 * track satisfies the canonical sign-continuity rule.
 */
function contactKeyValues(
  keys: readonly ContactKey[],
  bindLocalQuaternion: Quat,
  poseOf: (window: number) => Quat,
  retention: number,
): readonly QuatTuple[] {
  let prev = signCanonical(bindLocalQuaternion);
  let lastHeld: Quat | undefined;
  const values: QuatTuple[] = [];
  for (const key of keys) {
    let raw: Quat;
    if (key.pose.kind === "bind") {
      raw = bindLocalQuaternion;
    } else if (key.pose.kind === "point") {
      raw = poseOf(key.pose.window);
      lastHeld = raw;
    } else {
      raw = lastHeld !== undefined ? scaleRotation(lastHeld, retention) : bindLocalQuaternion;
    }
    const q = signMatch(raw, prev);
    prev = q;
    values.push([q.x, q.y, q.z, q.w]);
  }
  return values;
}

/** The solved pose's rotation for one driven bone of the chain. */
function rotationOfPose(pose: ReturnType<typeof solveArmChain>, boneName: string): Quat {
  switch (boneName) {
    case pose.shoulderBone: return pose.shoulderLocal;
    case pose.elbowBone: return pose.elbowLocal;
    default: return pose.wristLocal;
  }
}

export function compile(request: PrimitiveRequest): CompiledMotionFragment {
  const actionId = readActionId(request);
  const profile = request.skeletonProfile as ProfileView;

  // A profile with NO anchor space predates the anchor contract (the registry seam's own fixture)
  // and cannot express a reach. Emit the canonical empty fragment the seam contract blesses.
  if (profile.regionAnchorSpace === undefined) {
    return { actionId, tracks: [] };
  }
  if (profile.regionAnchorSpace !== REGION_ANCHOR_SPACE) {
    throw new Error(
      `guard_body_region: the guard compiled anchors in a space it does not implement — ` +
        `"${String(profile.regionAnchorSpace)}" is not ${REGION_ANCHOR_SPACE}`,
    );
  }

  const target = readTarget(request.action);
  const anchors = profile.regionAnchors as Readonly<Record<string, unknown>> | undefined;
  if (typeof anchors !== "object" || anchors === null) {
    throw new Error(`guard_body_region: profile declares ${REGION_ANCHOR_SPACE} but carries no regionAnchors`);
  }
  const anchor = anchors[target.id];
  if (!isVec3(anchor)) {
    throw new Error(
      `guard_body_region: region "${target.id}" has no anchor on this rig — the anchor map is the data, there is no per-target pose table`,
    );
  }

  const chain = resolveArmChain(profile, request);
  const durationMs = readDurationMs(request.action);
  const retention = Math.min(
    SETTLE_RETENTION.max,
    Math.max(SETTLE_RETENTION.min, SETTLE_RETENTION.perIntensity * readIntensity(request.action)),
  );

  const joints = profile.joints as readonly ChainJoint[];
  const byName = new Map(joints.map((j) => [j.boneName, j]));
  const jointSet = new Set(joints.map((j) => j.boneName));

  // CONTACT WINDOWS OVERRIDE THE SHAPE. A guard action that declares contact constraints must HOLD
  // each winning contact across its whole window (not reach at a single peak key and drift off in
  // the settle), yield releasable contacts to preserved ones, and refuse programs no pose can
  // satisfy. The window schedule lives in src/contact; this file supplies the geometry per point.
  const contacts = resolveContacts(request.action, anchors, chain.wristName, jointSet);
  if (contacts.length > 0) {
    // CONTACT SURFACES (tsk_ba168fa10b064fa3): when the profile carries a surface record for a
    // contacted region, the guard must hold the SURFACE point (bounded penetration, achieved
    // contact) and orient the effector's own axis to the outward normal — never clamp to the
    // buried anchor. resolveSurfaceContactTargets refuses a wrong-facing or malformed record.
    const surfaceTargets = resolveSurfaceContactTargets({
      regionSurfaces: profile.regionSurfaces as Readonly<Record<string, unknown>> | undefined,
      contacts: contacts.map((c) => ({ regionId: c.regionId, anchor: c.point })),
    });
    const windows: ContactWindowInput[] = contacts.map((c, i) => ({
      startFraction: c.startFraction,
      endFraction: c.endFraction,
      positionToleranceMeters: c.positionToleranceMeters,
      preserveWhileActive: c.preserveWhileActive,
      point: surfaceTargets[i]!.point,
      order: c.order,
    }));
    const keys = planContactWindowKeys(windows);

    // Solve each scheduled point's arm pose once; the schedule references windows by declaration
    // index, and a window is the smallest unit a key names. A surface-bearing window then gets the
    // free single-joint wrist rotation that maps the effector's own axis onto the outward normal.
    const poseByWindow = new Map<number, ReturnType<typeof solveArmChain>>();
    const poseForWindow = (window: number): ReturnType<typeof solveArmChain> => {
      let pose = poseByWindow.get(window);
      if (pose === undefined) {
        pose = solveArmChain({ joints, effectorBone: chain.wristName, target: windows[window]!.point });
        const outwardNormal = surfaceTargets[window]!.outwardNormal;
        if (outwardNormal !== undefined) {
          pose = orientWristToSurfaceNormal(pose, joints, outwardNormal);
        }
        poseByWindow.set(window, pose);
      }
      return pose;
    };

    // TRACK TIMES ARE SECONDS (compiler-surface clause 4); key fractions scale the clip duration.
    const durationSeconds = durationMs / 1000;
    const times = keys.map((key) => key.fraction * durationSeconds);
    const drivenBones = [chain.shoulderName, chain.elbowName, chain.wristName];
    const tracks: CompiledMotionTrack[] = drivenBones.map((boneName) => {
      const bind = byName.get(boneName);
      if (!bind) throw new Error(`guard_body_region: solved bone "${boneName}" vanished from the joint table`);
      return {
        property: "rotationAbsoluteNodeLocal",
        boneName,
        canonicalLandmark: target.id,
        interpolation: "LINEAR",
        times,
        values: contactKeyValues(keys, bind.bindLocalQuaternion, (window) => rotationOfPose(poseForWindow(window), boneName), retention),
      };
    });
    return { actionId, tracks };
  }

  const pose = solveArmChain({ joints, effectorBone: chain.wristName, target: anchor });

  // TRACK TIMES ARE SECONDS: the clip's `durationSeconds` is the maximum final track time, so the
  // keys a primitive emits must be seconds, not the authored milliseconds (compiler-surface clause 4).
  const durationSeconds = durationMs / 1000;
  const times = [0, durationSeconds * PEAK_FRACTION, durationSeconds];
  const tracks: CompiledMotionTrack[] = [pose.shoulderBone, pose.elbowBone, pose.wristBone].map((boneName) => {
    const bind = byName.get(boneName);
    if (!bind) throw new Error(`guard_body_region: solved bone "${boneName}" vanished from the joint table`);
    return {
      property: "rotationAbsoluteNodeLocal",
      boneName,
      canonicalLandmark: target.id,
      interpolation: "LINEAR",
      times,
      values: keyframes(bind.bindLocalQuaternion, rotationOfPose(pose, boneName), retention),
    };
  });

  return { actionId, tracks };
}
