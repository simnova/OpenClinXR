import { type Object3D, Quaternion, Vector3 } from "three";
import { resolveRigFootGeometry } from "./foot-rig-geometry-mod.js";
import { findSteppingLegChain } from "./stepping-turn-leg-ik-mod.js";

function boneWorldOf(bone: Object3D): { x: number; y: number; z: number } {
  bone.updateWorldMatrix(true, false);
  const e = bone.matrixWorld.elements;
  return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
}

/**
 * Heel-strike slice (2026-10-18): swing-only heel-tip pitch CAP. ONE
 * mechanism that limits the swing foot's heel-sole-to-tail-toe pitch to the
 * top of the sourced heel-first band, without touching the stance leg, the
 * slot advance, or the row tables. Split out of
 * `./foot-base-stride-retarget-mod.js` to hold that file's 500-line zone
 * budget; behaviour lives here, call sites stay there.
 *
 * WHY (measured this slice, .openclinxr/evidence/heel-strike/measure.json,
 * brief-literal heel-tip construction): physician/nurse gait landings read
 * 17-23 deg (inside the 15-25 band); the child right foot lands at 29-32 deg
 * (above band on all 3 runs). The source clip carries 29 deg, the bind
 * undershoots to 9-13 deg, the runtime lands between — only the child's
 * longer relative stride overshoots. The cap binds solely where exceeded
 * (child terminal swing in practice), everywhere else it is a no-op.
 *
 * The sensor is the brief's own construction (heel-sole contact to tail toe
 * vs floor), read sim-side with the rig's scaled heel-contact local, so it
 * matches the H1 instrument up to render-probe noise and needs no table.
 * Cap 23 deg = band top (25) minus probe-noise margin; commanded inside the
 * band. Authority: scheduled swing side (schedule ease 0.55->0.85 maxed
 * with a geometric grace: full at/below the contact band, out by 0.2 m toe
 * height) PLUS a stance-side airborne grace. The grace exists because the
 * child lands ~2 frames past its scheduled plant (gate-child run1: schedule
 * swingRel 0.09 at contact, stance already flipped per schedule while the
 * lock still observes the old stance) — without it the landing foot loses
 * the cap exactly at contact (dbg-child: sensor read the pushing-off stance
 * foot at -20 deg while the landing foot sat at +32). The stance side binds
 * only while geometrically airborne (planted feet never touched) and only
 * via the geometric ease. Lower-only (the cap never raises the toe);
 * mid-swing clearance shape untouched (H2's 0.3-0.7 window never exceeds the
 * cap there; verified per run).
 * Stateless per substep — every call re-decides from the natural (reverted)
 * pose, so both substeps of the contact frame agree and nothing accumulates.
 * The write is orientation-only about the foot-bone origin (ankle preserved
 * for the slide meter), premultiplied in the parent frame with both
 * quaternions normalised by construction (H6). A revert bracket at the top
 * of the step restores the exact pre-write bone (bit-for-bit, only if still
 * present) so the solver never sees the cap; only the render and the capture
 * probes do. The H3 cost is a sub-mm toe-xz move on frames outside the
 * foot's slide window (the clip labels still name the other foot there);
 * verified per run.
 */

/** Absolute heel-tip pitch cap, degrees (+ = toe up); inside the 15-25 band. */
export const HEEL_STRIKE_PITCH_CAP_DEG = 23;
/** Swing progress where cap authority starts ramping in (terminal swing). */
const HEEL_STRIKE_CAP_EASE_LO = 0.55;
/** Swing progress at full cap authority (touchdown approach). */
const HEEL_STRIKE_CAP_EASE_HI = 0.85;
/**
 * Geometric authority (toe height above the contact band, metres): full at
 * or below this height — the foot is about to touch or touching.
 */
const HEEL_STRIKE_GEOM_FULL_M = 0.02;
/** Geometric authority ramps to zero at this height (mid-swing clearance). */
const HEEL_STRIKE_GEOM_ZERO_M = 0.2;
/**
 * Pre-contact floor (measured 2026-10-18, dbg-child3): fire only while the
 * toe reads more than this above the contact band. The touchdown frame
 * itself (child right td: +8.5 mm, left td: +17.7 mm) still corrects, but a
 * foot already at/below the band edge (child left frame 13: +3.6 mm, which
 * the previous build drove 12 mm into the band and opened a 7.5 mm slide
 * window) never does — post-contact rotation cannot help H1 (which reads
 * the contact frame) and only perturbs slide. Supplants the height gate,
 * which wrongly blocked the +17.7 mm touchdown frame.
 */
const HEEL_STRIKE_PRECONTACT_FLOOR_M = 0.005;

function heelStrikeCapEase01(swingLinear01: number): number {
  const t = Math.min(
    Math.max((swingLinear01 - HEEL_STRIKE_CAP_EASE_LO) / (HEEL_STRIKE_CAP_EASE_HI - HEEL_STRIKE_CAP_EASE_LO), 0),
    1,
  );
  return t * t * (3 - 2 * t);
}

/**
 * Late-landing grace (measured 2026-10-18, gate-child run1): the short
 * child stride lands ~2 frames after its scheduled plant (clipTime 0.89 vs
 * scheduled 0.73), so scheduled swing progress has wrapped to ~0 and the
 * schedule ease reads zero exactly when the cap is needed. Geometric
 * authority covers the touchdown approach directly: full when the swing toe
 * is at/below the contact band, ramping out by mid-swing clearance height.
 * Mid-swing firings are still impossible in practice — the lower-only
 * threshold guard (pitch > cap) never binds there (liftoff pitch ≈ -18
 * deg) — so H2 clearance is untouched.
 *
 * Premature-touchdown guard (measured 2026-10-18, dbg-child2): correcting
 * high above the band (frames 11-12, toe +20-30 mm) drives the toe into the
 * band ~1 frame early and the extra stance window (left 13-14) reads 7.5 mm
 * of landing motion as slide (H3 0.00717). The pre-contact floor below
 * (+5 mm) confines authority to strictly pre-contact frames, so the cap
 * shapes only the touchdown itself and never re-times band entry (a 15 mm
 * height gate was tried first and wrongly blocked the +17.7 mm touchdown
 * frame, delaying correction a frame late).
 */
function heelStrikeGeomEase01(toeAboveBandM: number): number {
  const t = Math.min(
    Math.max(
      (HEEL_STRIKE_GEOM_ZERO_M - toeAboveBandM) /
        (HEEL_STRIKE_GEOM_ZERO_M - HEEL_STRIKE_GEOM_FULL_M),
      0,
    ),
    1,
  );
  return t * t * (3 - 2 * t);
}

/**
 * Pending cap writes awaiting revert, per heel bone: the exact pre-write
 * quaternion plus the post-write quaternion. Revert restores the pre-write
 * value bit-for-bit (no inverse math, no drift), but ONLY if the bone still
 * carries the post-write value — anything else (the mixer's per-substep
 * re-pose in production) rewrote it meanwhile, so reverting would corrupt a
 * fresh pose and the entry is dropped instead.
 */
const pendingCapByHeel = new WeakMap<Object3D, { before: Quaternion; after: Quaternion }>();

function quatsMatch(a: Quaternion, b: Quaternion): boolean {
  // Quaternion double-cover: q and -q are the same rotation; the mixer and
  // continuity-preserving blends can land on either sign.
  const same =
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) + Math.abs(a.w - b.w);
  if (same < 1e-9) return true;
  const flipped =
    Math.abs(a.x + b.x) + Math.abs(a.y + b.y) + Math.abs(a.z + b.z) + Math.abs(a.w + b.w);
  return flipped < 1e-9;
}

/**
 * Revert one heel's pending cap write, if still present (see above).
 * Safe to call every substep for every foot: no-ops without an entry.
 */
export function revertHeelStrikeCap(heel: Object3D): void {
  const pending = pendingCapByHeel.get(heel);
  if (pending === undefined) return;
  pendingCapByHeel.delete(heel);
  if (!quatsMatch(heel.quaternion, pending.after)) return;
  heel.quaternion.copy(pending.before);
  heel.updateMatrixWorld(true);
}

/**
 * Revert helper for all walker toes at once (toe's parent is its heel bone
 * in every rig this stack drives). Null-safe; unknown rigs no-op.
 */
export function revertHeelStrikeCapForToes(toes: ReadonlyArray<Object3D | null>): void {
  for (const toe of toes) {
    const heel = toe?.parent ?? null;
    if (heel === null) continue;
    revertHeelStrikeCap(heel);
  }
}

/** Last cap decision, mirrored to globalThis for capture probes (debug). */
export type HeelStrikeCapDbg = {
  calls: number;
  fired: number;
  ease: number | null;
  schedEase: number | null;
  geomEase: number | null;
  pitch: number | null;
  toeAboveBandM: number | null;
};
const capDbg: HeelStrikeCapDbg = {
  calls: 0,
  fired: 0,
  ease: null,
  schedEase: null,
  geomEase: null,
  pitch: null,
  toeAboveBandM: null,
};
function publishCapDbg(): void {
  (globalThis as unknown as Record<string, unknown>)["__heelStrikeCapDbg"] = { ...capDbg };
}

function applySwingHeelStrikeCap(input: {
  heel: Object3D;
  toe: Object3D | null;
  heelLocal: { x: number; y: number; z: number };
  swingLinear01: number;
  /** Floor reference for the geometric grace (late landing past schedule). */
  floorY: number;
  /** Contact-band height above the floor (toe in-band reads planted). */
  contactBandM: number;
  /**
   * Airborne gate (stance-side grace only): proceed only when the toe reads
   * above floor+band by more than this (null = no gate, swing side). A
   * planted stance foot is never touched, so stance exactness and the slide
   * windows hold; a still-airborne late landing (schedule already flipped)
   * still binds. Slightly negative (-0.01) so the contact frame itself —
   * toe just entering the band — still corrects to the band.
   */
  onlyIfAirborneM: number | null;
}): { applied: boolean; currentPitchDeg: number | null; deltaDeg: number } {
  const none = { applied: false, currentPitchDeg: null as number | null, deltaDeg: 0 };
  capDbg.calls += 1;
  if (input.toe === null) {
    publishCapDbg();
    return none;
  }
  const toeW = boneWorldOf(input.toe);
  input.heel.updateWorldMatrix(true, false);
  const contact = new Vector3(input.heelLocal.x, input.heelLocal.y, input.heelLocal.z).applyMatrix4(
    input.heel.matrixWorld,
  );
  if (
    !Number.isFinite(toeW.x + toeW.y + toeW.z) ||
    !Number.isFinite(contact.x + contact.y + contact.z)
  ) {
    return none;
  }
  // Terminal-swing ease (monotonic — no velocity flap): liftoff and
  // mid-swing read zero authority (clearance shape untouched), terminal
  // swing ramps to full. The geometric grace takes the max so a landing
  // past the scheduled plant (schedule wrapped, ease zero) still binds at
  // full authority while the toe is at the band. Stateless per substep:
  // same inputs, same output.
  const schedEase = heelStrikeCapEase01(input.swingLinear01);
  const toeAboveBandM = toeW.y - (input.floorY + input.contactBandM);
  if (input.onlyIfAirborneM !== null && !(toeAboveBandM > input.onlyIfAirborneM)) {
    publishCapDbg();
    return none;
  }
  if (!(toeAboveBandM > HEEL_STRIKE_PRECONTACT_FLOOR_M)) {
    publishCapDbg();
    return none;
  }
  const geomEase = heelStrikeGeomEase01(toeAboveBandM);
  const ease = Math.max(schedEase, geomEase);
  capDbg.ease = ease;
  capDbg.schedEase = schedEase;
  capDbg.geomEase = geomEase;
  capDbg.toeAboveBandM = toeAboveBandM;
  if (!(ease > 0)) {
    publishCapDbg();
    return none;
  }
  const dxz = Math.hypot(toeW.x - contact.x, toeW.z - contact.z);
  if (!(dxz > 1e-9)) {
    publishCapDbg();
    return none;
  }
  // Brief-literal heel-tip pitch (sim-side exact): the H1 instrument itself.
  const currentDeg = (Math.atan2(toeW.y - contact.y, dxz) * 180) / Math.PI;
  capDbg.pitch = currentDeg;
  const deltaDeg = (HEEL_STRIKE_PITCH_CAP_DEG - currentDeg) * ease;
  // Lower-only: the cap never raises the toe. Every measured live swing
  // outside the child overshoot sits under the cap, so nothing fires there.
  if (!(deltaDeg < -1e-9) || !Number.isFinite(deltaDeg)) {
    publishCapDbg();
    return { applied: false, currentPitchDeg: currentDeg, deltaDeg: 0 };
  }
  // World lateral axis: cross(heel->toe horizontal, up) tips the toe down
  // for a negative angle. Rotation about the foot-bone origin (ankle
  // preserved for the slide meter).
  const hx = toeW.x - contact.x;
  const hz = toeW.z - contact.z;
  const hdxz = Math.hypot(hx, hz);
  if (!(hdxz > 1e-9)) {
    publishCapDbg();
    return { applied: false, currentPitchDeg: currentDeg, deltaDeg: 0 };
  }
  const axis = new Vector3(-hz / hdxz, 0, hx / hdxz);
  axis.normalize();
  const parent = input.heel.parent;
  if (parent === null) {
    publishCapDbg();
    return { applied: false, currentPitchDeg: currentDeg, deltaDeg: 0 };
  }
  parent.updateWorldMatrix(true, false);
  const parentQ = new Quaternion();
  parent.getWorldQuaternion(parentQ);
  parentQ.normalize();
  const worldDelta = new Quaternion().setFromAxisAngle(axis, (deltaDeg * Math.PI) / 180);
  worldDelta.normalize();
  const local = parentQ.clone().invert().multiply(worldDelta).multiply(parentQ).normalize();
  const before = input.heel.quaternion.clone();
  input.heel.quaternion.premultiply(local).normalize();
  input.heel.updateMatrixWorld(true);
  pendingCapByHeel.set(input.heel, { before, after: input.heel.quaternion.clone() });
  capDbg.fired += 1;
  publishCapDbg();
  return { applied: true, currentPitchDeg: currentDeg, deltaDeg };
}

/**
 * Post-pin entry point: resolve the swing side's chain and run the cap.
 * Called once per walking substep after the pin pass, so stance-pin
 * corrections (computed from pre-cap toe positions) are unaffected.
 */
/**
 * Late-landing grace: the schedule plants the foot ~2 frames before the
 * short child stride touches down (schedule wraps, swing side flips), so the
 * still-airborne landing foot would lose the cap exactly at contact. The
 * scheduled-stance side therefore also gets the cap, but ONLY while
 * geometrically airborne (planted feet never touched) and only with the
 * geometric ease (no schedule authority off-side). A unified pre-contact
 * floor (+5 mm above the band, checked inside the cap) gates every
 * correction: the touchdown frame corrects (H1) while at/below-band frames
 * never do, so no in-window frame ever rotates for slide (H3) and no
 * correction lands early enough to re-time band entry.
 */
const STANCE_GRACE_AIRBORNE_M = 0.002;

export function applyPostPinHeelStrikeCap(
  slot: Object3D,
  swingSide: "left" | "right",
  swingLinear01: number,
  floorY: number,
  contactBandM: number,
): void {
  const geom = resolveRigFootGeometry(slot);
  const stanceSide = swingSide === "left" ? "right" : "left";
  for (const [side, linear, gate] of [
    [swingSide, swingLinear01, null],
    [stanceSide, 0, STANCE_GRACE_AIRBORNE_M],
  ] as const) {
    const chain = findSteppingLegChain(slot, side);
    if (chain === null) {
      capDbg.calls += 1;
      publishCapDbg();
      continue;
    }
    const heelLocal = side === "left" ? geom.heelLocal.left : geom.heelLocal.right;
    applySwingHeelStrikeCap({
      heel: chain.heel,
      toe: chain.toe,
      heelLocal,
      swingLinear01: linear,
      floorY,
      contactBandM,
      onlyIfAirborneM: gate,
    });
  }
}
