import type { Object3D } from "three";
import { Quaternion, Vector3 } from "three";
import { resolveRigFootGeometry } from "./foot-rig-geometry-mod.js";
import { worldXyz } from "./stance-lock-ik.js";
import type { StanceFoot } from "./stance-lock-mod.js";
import {
  findSteppingLegChain,
  type SteppingLegChain,
  solveSteppingLegHinge,
} from "./stepping-turn-leg-ik-mod.js";

/**
 * Foot-flatten pass for the STANDING phases (DENSE_v1 flat-stance slice).
 *
 * DEFECT (standing-pitch slice, 9/9 SC-05 runs): at arrival the true
 * heel-sole contact rides 29-95 mm above the floor at 12-52 deg of pitch
 * while the toes sit within 1 cm of the floor. The settling-turn final leg
 * pose sets the pitch and the arrival close/hold freezes it (slot XZ only,
 * no bone rotations). Mid-stance pitch is near flat, so the walk is fine.
 *
 * MECHANISM (one): from the moment each foot's last turn plant lands
 * (settling end) and through arrived, rotate that foot's ankle (foot bone)
 * so the heel-sole contact point and the toe both lie on the floor (pitch
 * -> 0 about the slot-lateral axis), keeping the TOE where it is (pivot
 * about the toe contact) and letting the leg follow by re-solving the knee
 * with the existing hinge solver (`solveSteppingLegHinge`), so the shin
 * stays connected. Ease in over 0.3 s from landing (smoothstep), hold
 * afterwards. Every quaternion written is normalised. Applies on ALL
 * configs including the shipped default; every change is confined to
 * settling-end/arrived frames (the callers gate; this module never runs on
 * walk frames).
 *
 * ORDER (rigid-foot exactness): the foot is rigid, so rotating about the toe
 * contact determines BOTH the new ankle position and the new foot
 * orientation. The hinge runs first to place the ankle (hip/knee only, never
 * the foot), then the foot orientation is written about its own origin
 * (ankle position preserved): toe_before == toe_after up to the hinge miss,
 * which is sub-mm on these reachable targets.
 *
 * Heel-sole local provenance: the GLB-calibrated constants from
 * tools/openclinxr/evidence/slide-phase/slide-phase-capture.ts
 * (HEEL_LOCAL_L/R: lowest-Y posterior-half vertex with dominant foot-joint
 * skin weight in bind pose, footLocal = inverseBind(foot) * POSITION;
 * L/R mirrored in x). Copied, not retyped from a new measurement.
 *
 * RIG-AWARE (rig-aware slice): `applyFootFlatten` resolves the actor's own
 * heel-contact local via `./foot-rig-geometry-mod.js` (physician heel scaled
 * by the rig's rest foot->toe ratio) and passes it as `heelLocal`; the
 * physician footScale is exactly 1, so the default-constant path runs
 * untouched there. `flattenFootPose`'s own signature is unchanged.
 */

export type FootFlattenSide = StanceFoot;

/** Heel-sole contact in the foot-bone frame (see provenance above). */
const HEEL_LOCAL: Record<FootFlattenSide, { x: number; y: number; z: number }> = {
  left: { x: -0.0022, y: 0.01817, z: 0.06779 },
  right: { x: 0.0022, y: 0.01817, z: 0.06779 },
};

/** Ease-in duration from landing, seconds (smoothstep). */
export const FOOT_FLATTEN_EASE_S = 0.3;
/** Hard rate cap on the foot-bone rotation (F5 bar). */
export const FOOT_FLATTEN_MAX_RATE_DEG_PER_S = 200;
/** Below this residual pitch the foot counts as flat and is left untouched. */
const FLAT_PITCH_RADIANS = (0.5 * Math.PI) / 180;
/** A foot this far above the contact band counts as airborne: never yank a swing foot. */
const AIRBORNE_TOE_M = 0.06;

export function footFlattenEase01(elapsedS: number): number {
  const t = Math.min(Math.max(elapsedS / FOOT_FLATTEN_EASE_S, 0), 1);
  return t * t * (3 - 2 * t);
}

export type FlattenFootResult = {
  /** True when nothing was written (flat, airborne, unreachable chain, or zero step). */
  skipped: boolean;
  /** Signed rotation applied about the slot-lateral axis this call, radians. */
  appliedRadians: number;
};

/**
 * One foot, one frame: rotate the foot bone about the slot-lateral axis
 * through the toe contact by up to the eased residual pitch (rate-capped),
 * pivot the ankle about the toe, re-solve the knee to the new ankle, then
 * write the rotated foot orientation. Pure geometry + the shared hinge;
 * the caller owns gating (settling-end/arrived only) and matrix updates.
 */
export function flattenFootPose(input: {
  chain: SteppingLegChain;
  side: FootFlattenSide;
  slotYawRadians: number;
  /** 0..1 ease weight this frame (smoothstep of time since landing). */
  ease01: number;
  /** Rate-cap budget this frame, radians (max rate x dt). */
  maxStepRadians: number;
  /**
   * Heel-sole contact in the foot-bone frame. Defaults to the GLB-calibrated
   * production constant; the unit test passes its own rig-consistent point.
   */
  heelLocal?: { x: number; y: number; z: number } | undefined;
  /** Last frame's bend-plane normal (world), for the hinge's degeneracy hysteresis. */
  previousBendNormal?: { x: number; y: number; z: number } | null | undefined;
}): FlattenFootResult & { bendNormal: { x: number; y: number; z: number } | null } {
  const { chain, side } = input;
  const prevNormal = input.previousBendNormal ?? null;
  const idle = (skipped: boolean, appliedRadians: number): FlattenFootResult & {
    bendNormal: { x: number; y: number; z: number } | null;
  } => ({ skipped, appliedRadians, bendNormal: prevNormal });
  const ease = Math.min(Math.max(input.ease01, 0), 1);
  if (ease <= 0 || !(input.maxStepRadians > 0)) return idle(true, 0);
  chain.heel.updateMatrixWorld(true);
  chain.toe.updateMatrixWorld(true);
  const toe = worldXyz(chain.toe);
  const ankle = worldXyz(chain.heel);
  const local = input.heelLocal ?? HEEL_LOCAL[side];
  chain.heel.updateWorldMatrix(true, false);
  const contact = chain.heel.localToWorld(new Vector3(local.x, local.y, local.z));
  const dxz = Math.hypot(contact.x - toe.x, contact.z - toe.z);
  if (!(dxz > 1e-9)) return idle(true, 0);
  const pitch = Math.atan2(contact.y - toe.y, dxz);
  if (Math.abs(pitch) < FLAT_PITCH_RADIANS) return idle(true, 0);
  const desired = -pitch * ease;
  const cap = Math.abs(input.maxStepRadians);
  let step = Math.min(Math.max(desired, -cap), cap);
  if (!(Math.abs(step) > 1e-12)) return idle(true, 0);
  // Slot-lateral axis (world): yaw 0 faces +Z, right is +X.
  const yaw = input.slotYawRadians;
  const axis = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();
  // REACH PRE-CHECK (toe-yank guard): the hinge clamps unreachable targets
  // at full extension, and writing the rotated foot orientation about a
  // missed ankle drags the toe with it (measured 18 mm in one frame on a
  // straight-leg fixture). Halve the step until the rotated ankle sits inside
  // the leg's extension (2 mm margin), so the hinge converges and the rigid
  // toe stays pivoted. The heel then descends only as far as the leg allows;
  // the residual is re-attempted every gated frame.
  chain.hip.updateMatrixWorld(true);
  chain.knee.updateMatrixWorld(true);
  const hipW = chain.hip.getWorldPosition(new Vector3());
  const kneeW = chain.knee.getWorldPosition(new Vector3());
  const thighLen = hipW.distanceTo(kneeW);
  const shinLen = kneeW.distanceTo(new Vector3(ankle.x, ankle.y, ankle.z));
  const reachLimitM = thighLen + shinLen - 0.002;
  const toeV = new Vector3(toe.x, toe.y, toe.z);
  const ankleV = new Vector3(ankle.x, ankle.y, ankle.z);
  const ankleFor = (s: number): Vector3 =>
    toeV.clone().add(ankleV.clone().sub(toeV).applyQuaternion(new Quaternion().setFromAxisAngle(axis, s)));
  if (thighLen > 1e-6 && shinLen > 1e-6) {
    let shrunk = false;
    for (let i = 0; i < 10; i += 1) {
      if (hipW.distanceTo(ankleFor(step)) <= reachLimitM) break;
      step *= 0.5;
      shrunk = true;
      if (!(Math.abs(step) > 1e-9)) break;
    }
    if (!(Math.abs(step) > 1e-9)) return idle(true, 0);
    void shrunk;
  }
  const delta = new Quaternion().setFromAxisAngle(axis, step);
  const ankleTarget = toeV.clone().add(ankleV.clone().sub(toeV).applyQuaternion(delta));
  const parentQ = new Quaternion();
  if (chain.heel.parent) chain.heel.parent.getWorldQuaternion(parentQ);
  else parentQ.identity();
  parentQ.normalize();
  const footQ = new Quaternion();
  chain.heel.getWorldQuaternion(footQ);
  footQ.normalize();
  const wantFootQ = delta.clone().multiply(footQ).normalize();
  // Knee follows: hinge the leg (hip/knee only) onto the rotated ankle, then
  // write the rotated foot orientation about its own origin (ankle preserved,
  // toe preserved up to the hinge miss).
  const pole = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const hinge = solveSteppingLegHinge({
    chain,
    heelTargetWorld: { x: ankleTarget.x, y: ankleTarget.y, z: ankleTarget.z },
    poleWorld: { x: pole.x, y: pole.y, z: pole.z },
    midRestQuats: null,
    previousBendNormal: prevNormal,
  });
  // A skipped or unconverged hinge leaves the ankle off-target; writing the
  // rotated foot orientation about it would drag the toe (see pre-check).
  // Leave the foot for the next gated frame instead.
  if (hinge.diag.skipped || !(hinge.missM <= 0.005)) {
    return { skipped: true, appliedRadians: 0, bendNormal: hinge.bendNormal };
  }
  chain.heel.parent?.updateMatrixWorld(true);
  const parentQ2 = new Quaternion();
  if (chain.heel.parent) chain.heel.parent.getWorldQuaternion(parentQ2);
  else parentQ2.identity();
  parentQ2.normalize();
  chain.heel.quaternion.copy(parentQ2.invert().multiply(wantFootQ)).normalize();
  chain.heel.updateWorldMatrix(true, false);
  return {
    skipped: false,
    appliedRadians: step,
    bendNormal: hinge.bendNormal,
  };
}

type PerFootClock = {
  elapsedS: number;
  bendNormal: { x: number; y: number; z: number } | null;
};

type SlotFlattenState = { left: PerFootClock; right: PerFootClock };

const stateBySlot = new WeakMap<Object3D, SlotFlattenState>();

function freshClock(): PerFootClock {
  return { elapsedS: 0, bendNormal: null };
}

function stateFor(slot: Object3D): SlotFlattenState {
  let state = stateBySlot.get(slot);
  if (!state) {
    state = { left: freshClock(), right: freshClock() };
    stateBySlot.set(slot, state);
  }
  return state;
}

/** Pose-neutral reset for walk frames (clocks restart at the next landing). */
export function resetFootFlatten(actorSlot: Object3D): void {
  stateBySlot.delete(actorSlot);
}

export type FootFlattenFrameResult = {
  left: FlattenFootResult;
  right: FlattenFootResult;
};

/**
 * Frame entry: advance both feet's landing clocks by dt and flatten each
 * planted foot. CALL ONLY ON SETTLING-END/ARRIVED FRAMES — the caller gates;
 * walk frames must call `resetFootFlatten` instead (pose-neutral).
 */
export function applyFootFlatten(input: {
  actorSlot: Object3D;
  deltaSeconds: number;
  floorOriginY: number;
}): FootFlattenFrameResult {
  const { actorSlot } = input;
  actorSlot.updateMatrixWorld(true);
  const dt = Number.isFinite(input.deltaSeconds) && input.deltaSeconds > 0 ? input.deltaSeconds : 0;
  const state = stateFor(actorSlot);
  const yaw = actorSlot.rotation.y;
  const maxStep = ((FOOT_FLATTEN_MAX_RATE_DEG_PER_S * Math.PI) / 180) * dt;
  const out: FootFlattenFrameResult = {
    left: { skipped: true, appliedRadians: 0 },
    right: { skipped: true, appliedRadians: 0 },
  };
  // RIG-AWARE (rig-aware slice): per-rig heel-contact local from the actor's
  // own skeleton rest pose (cached). Physician footScale is exactly 1, so the
  // default production constant path below runs untouched (byte-identical).
  const rigGeometry = resolveRigFootGeometry(actorSlot);
  for (const side of ["left", "right"] as const) {
    const clock = state[side];
    clock.elapsedS += dt;
    if (dt <= 0 || maxStep <= 0) continue;
    const chain = findSteppingLegChain(actorSlot, side);
    if (chain === null) continue;
    chain.toe.updateMatrixWorld(true);
    const toeY = worldXyz(chain.toe).y;
    if (!(Number.isFinite(toeY)) || toeY - input.floorOriginY > AIRBORNE_TOE_M) continue;
    const result = flattenFootPose({
      chain,
      side,
      slotYawRadians: yaw,
      ease01: footFlattenEase01(clock.elapsedS),
      maxStepRadians: maxStep,
      heelLocal: rigGeometry.footScale === 1 ? undefined : rigGeometry.heelLocal[side],
      previousBendNormal: clock.bendNormal,
    });
    clock.bendNormal = result.bendNormal;
    out[side] = { skipped: result.skipped, appliedRadians: result.appliedRadians };
    actorSlot.updateMatrixWorld(true);
  }
  actorSlot.updateMatrixWorld(true);
  return out;
}
