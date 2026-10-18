import type { Object3D } from "three";
import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import type { FootBaseSide } from "./foot-base-schedule-mod.js";
import type { KneeBudgetRecord } from "./foot-base-knee-budget-mod.js";
import type { LocomotionStanceLabels } from "./locomotion-stance-labels.js";

/**
 * Foot-base stride-retarget state (split out of
 * `./foot-base-stride-retarget-mod.js` to hold that file's 500-line zone
 * budget; behaviour is unchanged). This module owns the per-approach walk
 * state: its types, the test read/clear pair, and the pre-solve world
 * readers. The stateful step (`applyFootBaseStep`) stays in the
 * stride-retarget module. Nothing here is package-public: the index
 * re-exports only the test pair beside the step.
 */

export type FootBaseApproachState = Pick<
  CaseOwnedBedsideApproach,
  "actorSlot" | "leftToe" | "rightToe" | "floorOriginY" | "contactBandMeters" | "footstep" | "execution" | "lockArmed" | "start" | "lock" | "walkSpeedMetersPerSecond"
>;

export type FootBaseClipRead = {
  labels: LocomotionStanceLabels;
  actionTimeSeconds: number;
};

export type FootBaseState = {
  stance: FootBaseSide;
  foothold: Record<FootBaseSide, { x: number; y: number; z: number }>;
  placed: Record<FootBaseSide, boolean>;
  /**
   * Home side coordinate per foot (side-unit projection at entry), so a
   * plan-built plant lands on the planting foot's own side of the route.
   */
  sideHome: Record<FootBaseSide, number>;
  offsetEntry: Record<FootBaseSide, { offset: { x: number; y: number; z: number }; yaw: number } | null>;
  hingeNormal: Record<FootBaseSide, { x: number; y: number; z: number } | null>;
  wraps: number;
  lastActionTimeS: number | null;
  /**
   * Walking-entry anchor for the plan datum (unwrapped action seconds at the
   * first active substep). Halves, body travel and handover footholds measure
   * route progress since entry, not clip absolute time: the first captured
   * walking frame already carries played action, and absolute-time travel led
   * the feet by centimetres from substep one. Null until the first step.
   */
  entryUnwrappedS: number | null;
  /** Post-solve toe world Y per foot, previous substep (footbase-6 band-hold signal). Null until the first solve. */
  lastToeY: Record<FootBaseSide, number | null>;
  worst: { missM: number; side: FootBaseSide; sub: number } | null;
  /**
   * Swing-knee budget record (knee-budget slice): the K_max applied plus how
   * many swing substeps it lowered and how many hit the clearance floor.
   * Null until the first budgeted solve.
   */
  kneeBudget: KneeBudgetRecord | null;
  /**
   * Swing-knee budget hold exemption (knee-budget slice): per foot, whether
   * the PREVIOUS substep budget-clamped its swing target. A clamped foot
   * flies low by construction, so without this its floor-riding toe would
   * read as toe-roll and the band-hold would pin it past lift — and the
   * held pin's slot translate drags the stance foot off its foothold
   * (measured 1-3.6 mm stance drift in the stride-retarget fixture). A
   * budgeted foot is in controlled low flight, not rolling, so the hold
   * skips it for exactly one substep after each clamp.
   */
  prevClamped: Record<FootBaseSide, boolean>;
  /**
   * Rig-aware length scale (rig-aware slice): rig leg / physician leg from
   * the actor's own skeleton rest pose (1 on the physician). Stored on the
   * approach state at the first step; callers scale row heights/excursions
   * and the height datum by it. Null until the first step.
   */
  rigLengthScale: number | null;
  /**
   * First-handover pin-snap guard (handover slice): the first schedule
   * handover fires 1-3 substeps after arming on a truncated first swing, so
   * the plan-built plant can sit centimetres past the planting foot's reach.
   * Seen flips at the first handover; pendingSide/gridAlong arm the touchdown
   * seed (cleared at seeding or abandon); deltaAlong carries the signed
   * along-route miss the next plant adds back (exact grid re-anchor).
   */
  firstHandoverSeen: boolean;
  firstPlantPendingSide: FootBaseSide | null;
  firstPlantGridAlong: number | null;
  firstPlantDeltaAlong: number | null;
};

export type FootBaseStepSummary = {
  stanceFoot: FootBaseSide;
  phase01: number;
  halfIndex: number;
  stanceMissM: number | null;
  swingMissM: number | null;
};

const states = new WeakMap<object, FootBaseState>();

/** Read this approach's foot-base state (tests); null before the first step. */
export function readFootBaseState(approach: object): FootBaseState | null {
  return states.get(approach) ?? null;
}

/** Drop this approach's foot-base state (tests). */
export function clearFootBaseState(approach: object): void {
  states.delete(approach);
}

/** Read this approach's foot-base state, creating it on the first step. */
export function getOrCreateFootBaseState(approach: object, stance: FootBaseSide): FootBaseState {
  const existing = states.get(approach);
  if (existing !== undefined) return existing;
  const created = createState(stance);
  states.set(approach, created);
  return created;
}

/**
 * First-handover plant bookkeeping (handover slice; called from the handover
 * branch of `applyFootBaseStep`). Returns the effective plant
 * along-coordinate: the grid value on the first handover (the actual seed is
 * taken at band entry by `seedFirstPlantAtTouchdown`), the grid value plus
 * the stored seed delta on the next handover (exact grid re-anchor, so
 * downstream footholds and arrival never move), the grid value after that. A
 * pending first plant that never touches down is abandoned here (no stance
 * window, no slide) without disturbing the grid.
 */
export function noteFirstHandoverPlant(input: {
  state: FootBaseState;
  scheduled: FootBaseSide;
  plantAlong: number;
}): number {
  const { state, scheduled, plantAlong } = input;
  if (!state.firstHandoverSeen) {
    state.firstHandoverSeen = true;
    state.firstPlantPendingSide = scheduled;
    state.firstPlantGridAlong = plantAlong;
    return plantAlong;
  }
  state.firstPlantPendingSide = null;
  state.firstPlantGridAlong = null;
  if (state.firstPlantDeltaAlong === null) return plantAlong;
  const reanchored = plantAlong + state.firstPlantDeltaAlong;
  state.firstPlantDeltaAlong = null;
  return reanchored;
}

/**
 * First-plant seed (handover slice; called after the pin pass while the
 * first-planted foot is still the stance foot). When that foot first touches
 * down (post-pin toe inside the contact band), its provisional grid foothold
 * is snapped to the foot's actual position — but only when the plan misses by
 * more than 1 mm (the pin budget), so plan-accurate rigs keep byte-identical
 * footholds. The signed along-route miss is stored for the next plant's
 * re-anchor. History-free after seeding, abandon, or a stance change.
 */
export function seedFirstPlantAtTouchdown(input: {
  state: FootBaseState;
  stance: FootBaseSide;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  startX: number;
  startZ: number;
  unitX: number;
  unitZ: number;
  floorY: number;
  bandM: number;
}): void {
  const { state, stance } = input;
  const pending = state.firstPlantPendingSide;
  const gridAlong = state.firstPlantGridAlong;
  if (pending === null || gridAlong === null || pending !== stance) return;
  const toe = toeWorldNow(pending === "left" ? input.leftToe : input.rightToe);
  if (toe === null || !(toe.y <= input.bandM)) return;
  const anchor = state.foothold[pending];
  state.firstPlantPendingSide = null;
  state.firstPlantGridAlong = null;
  if (Math.hypot(anchor.x - toe.x, anchor.z - toe.z) <= 0.001) return;
  const seededAlong = (toe.x - input.startX) * input.unitX + (toe.z - input.startZ) * input.unitZ;
  state.foothold[pending] = { x: toe.x, y: input.floorY, z: toe.z };
  state.firstPlantDeltaAlong = gridAlong - seededAlong;
}

export function toeWorldNow(toe: Object3D | null): { x: number; y: number; z: number } | null {
  if (toe === null) return null;
  toe.updateWorldMatrix(true, false);
  const e = toe.matrixWorld.elements;
  return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
}

export function heelWorldNow(chain: { heel: Object3D; toe: Object3D }): {
  heel: { x: number; y: number; z: number };
  toe: { x: number; y: number; z: number };
} {
  chain.heel.updateMatrixWorld(true);
  chain.toe.updateMatrixWorld(true);
  const he = chain.heel.matrixWorld.elements;
  const te = chain.toe.matrixWorld.elements;
  return {
    heel: { x: he[12] ?? 0, y: he[13] ?? 0, z: he[14] ?? 0 },
    toe: { x: te[12] ?? 0, y: te[13] ?? 0, z: te[14] ?? 0 },
  };
}

export function createState(stance: FootBaseSide): FootBaseState {
  const zero = { x: 0, y: 0, z: 0 };
  return {
    stance,
    foothold: { left: { ...zero }, right: { ...zero } },
    placed: { left: false, right: false },
    sideHome: { left: 0, right: 0 },
    offsetEntry: { left: null, right: null },
    hingeNormal: { left: null, right: null },
    wraps: 0,
    lastActionTimeS: null,
    entryUnwrappedS: null,
    lastToeY: { left: null, right: null },
    worst: null,
    kneeBudget: null,
    prevClamped: { left: false, right: false },
    rigLengthScale: null,
    firstHandoverSeen: false,
    firstPlantPendingSide: null,
    firstPlantGridAlong: null,
    firstPlantDeltaAlong: null,
  };
}
