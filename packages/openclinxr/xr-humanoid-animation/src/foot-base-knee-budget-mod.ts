import type { Object3D } from "three";

/**
 * Swing-knee budget (knee-budget slice, DENSE_v1 slice 2; split out of
 * `./foot-base-stride-retarget-mod.js` to hold that file's 500-line zone
 * budget; behaviour is unchanged): ONE mechanism that caps swing knee
 * flexion at a speed-dependent K_max without touching the stance leg, the
 * slot advance, or the row tables.
 *
 * Healthy peak swing knee is speed-dependent (~52 deg at 0.4 m/s, 57 at 0.8,
 * 61 at 1.2 m/s: Clin Biomech 2025, doi 10.1016/j.clinbiomech.2025.106587);
 * K_max(v) interpolates those anchors and adds a 5 deg margin, with v the
 * plan's walking speed clamped into [0.4, 1.2]. When the hinge solve for the
 * current swing target would exceed K_max, the swing target's Y (never its
 * XZ) is lowered to the height at which the hinge gives exactly K_max —
 * found by bisection (<= 8 steps) on the closed-form flexion-vs-reach curve —
 * and never below the clearance floor (toe Y >= the swing foot's plant-toe
 * datum + 0.008 m, the Winter 1992 minimum mid-swing clearance). If K_max is
 * unreachable without breaking the floor, the floor is kept and the knee
 * reported (floorLimitedSubsteps). Stance legs and pinned feet are untouched;
 * the caller runs this inside `applyFootBaseStep` for the swing side only,
 * hence behind `footBaseStepIsActive`. Nothing here is package-public.
 */

const KNEE_BUDGET_MARGIN_DEG = 5;
const KNEE_BUDGET_CLEARANCE_FLOOR_M = 0.008;
const KNEE_BUDGET_BISECT_STEPS = 8;

export type KneeBudgetRecord = {
  kMaxDeg: number;
  clampedSubsteps: number;
  floorLimitedSubsteps: number;
};

type KneeBudgetAnchor = { speedMps: number; peakDeg: number };
const KNEE_BUDGET_ANCHORS: readonly KneeBudgetAnchor[] = [
  { speedMps: 0.4, peakDeg: 52 },
  { speedMps: 0.8, peakDeg: 57 },
  { speedMps: 1.2, peakDeg: 61 },
];

/** Speed-dependent swing-knee cap in degrees (anchors + margin). */
export function kneeBudgetKMaxDeg(walkSpeedMps: number): number {
  const raw = Number.isFinite(walkSpeedMps) && walkSpeedMps > 0 ? walkSpeedMps : 0.8;
  const first = KNEE_BUDGET_ANCHORS[0];
  const last = KNEE_BUDGET_ANCHORS[KNEE_BUDGET_ANCHORS.length - 1];
  const loSpeed = first?.speedMps ?? 0.4;
  const loPeak = first?.peakDeg ?? 52;
  const hiSpeed = last?.speedMps ?? 1.2;
  const hiPeak = last?.peakDeg ?? 61;
  const clamped = Math.min(Math.max(raw, loSpeed), hiSpeed);
  let base = clamped <= loSpeed ? loPeak : hiPeak;
  for (let i = 0; i + 1 < KNEE_BUDGET_ANCHORS.length; i += 1) {
    const a = KNEE_BUDGET_ANCHORS[i];
    const b = KNEE_BUDGET_ANCHORS[i + 1];
    if (a === undefined || b === undefined) continue;
    if (clamped >= a.speedMps && clamped <= b.speedMps) {
      const span = b.speedMps - a.speedMps;
      const frac = span > 0 ? (clamped - a.speedMps) / span : 0;
      base = a.peakDeg + (b.peakDeg - a.peakDeg) * frac;
    }
  }
  return base + KNEE_BUDGET_MARGIN_DEG;
}

/**
 * Knee flexion in degrees for a hip-to-heel reach over thigh/shin lengths:
 * the law-of-cosines interior angle at the knee, as flexion (0 = straight).
 * The hinge solve is the same triangle, so this predicts its flexion.
 */
function kneeFlexionForReachDeg(thighLenM: number, shinLenM: number, reachM: number): number {
  const denom = 2 * thighLenM * shinLenM;
  if (!(denom > 0)) return 0;
  const cosInterior = (thighLenM * thighLenM + shinLenM * shinLenM - reachM * reachM) / denom;
  const interior = Math.acos(Math.min(1, Math.max(-1, cosInterior)));
  return 180 - (interior * 180) / Math.PI;
}

function distXyz(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function boneWorldOf(bone: Object3D): { x: number; y: number; z: number } {
  bone.updateWorldMatrix(true, false);
  const e = bone.matrixWorld.elements;
  return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
}

/**
 * Budget one swing toe target: unchanged when its hinge flexion is already
 * at or under K_max, otherwise lowered in Y to the K_max height, floored at
 * the clearance floor. Returns the target to solve plus the updated budget
 * record (null record in, null record out until the first clamp) and whether
 * this substep clamped (the caller's hold-exemption signal).
 */
export function budgetSwingTarget(input: {
  chain: { hip: Object3D; knee: Object3D; heel: Object3D };
  toeTargetWorld: { x: number; y: number; z: number };
  slotYawRadians: number;
  offsetEntry: { x: number; y: number; z: number };
  offsetYawRadians: number;
  floorY: number;
  heightDatumM: number;
  walkSpeedMpsRaw: unknown;
  prevRecord: KneeBudgetRecord | null;
}): { target: { x: number; y: number; z: number }; record: KneeBudgetRecord | null; clamped: boolean } {
  const kMaxDeg = kneeBudgetKMaxDeg(
    typeof input.walkSpeedMpsRaw === "number" ? input.walkSpeedMpsRaw : Number.NaN,
  );
  const record = input.prevRecord ?? { kMaxDeg, clampedSubsteps: 0, floorLimitedSubsteps: 0 };
  record.kMaxDeg = kMaxDeg;
  const settled = (
    target: { x: number; y: number; z: number },
    clamped: boolean,
    floorLimited: boolean,
  ): { target: { x: number; y: number; z: number }; record: KneeBudgetRecord | null; clamped: boolean } => {
    if (clamped) record.clampedSubsteps += 1;
    if (floorLimited) record.floorLimitedSubsteps += 1;
    return { target, record: clamped || floorLimited ? record : input.prevRecord, clamped };
  };
  // The yaw-stable heel construction the solve itself uses, so the
  // prediction sees the exact heel target the hinge will solve for.
  const heelForToeY = (toeY: number): { x: number; y: number; z: number } => {
    const dyaw = input.slotYawRadians - input.offsetYawRadians;
    const cos = Math.cos(dyaw);
    const sin = Math.sin(dyaw);
    return {
      x: input.toeTargetWorld.x - (input.offsetEntry.x * cos + input.offsetEntry.z * sin),
      y: toeY - input.offsetEntry.y,
      z: input.toeTargetWorld.z - (-input.offsetEntry.x * sin + input.offsetEntry.z * cos),
    };
  };
  // NOTE: no hold-shortcut here. The hinge holds a heel already on its
  // target — but the budget's whole job is to move a bent hold: a heel on a
  // high target keeps its high flexion unless the target is lowered first.
  const hipW = boneWorldOf(input.chain.hip);
  const kneeW = boneWorldOf(input.chain.knee);
  const heelW = boneWorldOf(input.chain.heel);
  const thighLen = distXyz(hipW, kneeW);
  const shinLen = distXyz(kneeW, heelW);
  if (!(thighLen > 1e-6 && shinLen > 1e-6)) return settled(input.toeTargetWorld, false, false);
  const flexAt = (toeY: number): number =>
    kneeFlexionForReachDeg(thighLen, shinLen, distXyz(hipW, heelForToeY(toeY)));
  if (flexAt(input.toeTargetWorld.y) <= kMaxDeg) return settled(input.toeTargetWorld, false, false);
  const floorY = input.floorY + input.heightDatumM + KNEE_BUDGET_CLEARANCE_FLOOR_M;
  // Below the floor already: K_max is unreachable by lowering, so the floor
  // is the answer (it also lifts a dragging natural target to clearance).
  if (input.toeTargetWorld.y <= floorY) {
    return settled({ ...input.toeTargetWorld, y: floorY }, true, true);
  }
  if (flexAt(floorY) > kMaxDeg) {
    return settled({ ...input.toeTargetWorld, y: floorY }, true, true);
  }
  // Bisection on toe Y (flexion falls as the heel drops away from the hip):
  // lo feasible (the floor), hi infeasible (the original target).
  let feasibleY = floorY;
  let infeasibleY = input.toeTargetWorld.y;
  for (let step = 0; step < KNEE_BUDGET_BISECT_STEPS; step += 1) {
    const midY = (feasibleY + infeasibleY) / 2;
    if (flexAt(midY) <= kMaxDeg) feasibleY = midY;
    else infeasibleY = midY;
  }
  return settled({ ...input.toeTargetWorld, y: feasibleY }, true, false);
}
