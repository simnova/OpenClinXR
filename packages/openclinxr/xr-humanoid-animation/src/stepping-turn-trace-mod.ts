/**
 * Default-off per-frame trace of the stepping-turn slot update (settle-entry
 * slice, stage 1). Records every term that changes actorSlot position or yaw
 * in a settling frame, with its inputs. Pure observation: recording never
 * writes the scene, the slot, or the plan.
 *
 * Enabled only by `?steppingTurnTrace=1` (browser capture); node/tests read
 * false. Internal module, not a public entrypoint export.
 */
import type { Object3D } from "three";

export type SteppingTurnTracePass = {
  pass: number;
  /** Slot XZ translate applied by this pass's pin (the feedback term). */
  dx: number;
  dz: number;
  /** Plan stance-toe world target this pass pinned toward. */
  targetX: number;
  targetZ: number;
  targetY: number;
  /** Stance-toe world actually read this pass (post-solve, child of the slot). */
  toeWorldX: number;
  toeWorldZ: number;
  toeWorldY: number;
  /** True when the entry offset / foot freeze was captured (not held) this pass. */
  offsetCapturedThisFrame: boolean;
  footQuatCapturedThisFrame: boolean;
};

export type SteppingLegQuat = { x: number; y: number; z: number; w: number };

/**
 * Per-frame per-leg hinge-solve record (turn-leg-snaps slice, stage 1). Pure
 * observation: the execution module fills it from the solver's diagnostics and
 * the bones' own quaternions; nothing here writes the scene. `quatsBefore` is
 * read before the first solve pass, `quatsAfter` after the last; keys are the
 * four leg joints (hip, upperMid, knee, lowerMid). Diagnostics mirror the
 * solver's own return (stepping-turn-leg-ik-mod.ts): planeSource names which
 * branch produced the bend plane (computed = raw, reused = previous-plane
 * projection, held = no-op/early hold, none = degenerate with no previous).
 */
export type SteppingTurnLegSolveTrace = {
  side: "left" | "right";
  toeTarget: { x: number; y: number; z: number };
  heelTarget: { x: number; y: number; z: number };
  hipWorld: { x: number; y: number; z: number };
  reachRatio: number;
  plane: { x: number; y: number; z: number } | null;
  planeSource: "computed" | "reused" | "held" | "none";
  planeAngleDeg: number | null;
  kneeSideSign: number;
  iterations: number;
  residualM: number;
  skipped: boolean;
  quatsBefore: Record<string, SteppingLegQuat | null>;
  quatsAfter: Record<string, SteppingLegQuat | null>;
  stance: boolean;
  stepIndex: number;
  planDone: boolean;
};

export type SteppingTurnTraceFrame = {
  frame: number;
  elapsedS: number;
  stepIndex: number;
  u: number;
  stanceFoot: string;
  swingFoot: string;
  yawPrev: number;
  yawNew: number;
  dipY: number;
  slotBeforeX: number;
  slotBeforeZ: number;
  slotAfterX: number;
  slotAfterZ: number;
  passes: SteppingTurnTracePass[];
  toeLeftY: number | null;
  toeRightY: number | null;
  floorOriginY: number | null;
  /** Per-leg hinge-solve records (turn-leg-snaps stage 1); empty when untraced. */
  legs: SteppingTurnLegSolveTrace[];
  /** Stage-2 held-anchor pivot term (null on legacy-pin frames). */
  pivot: {
    dx: number;
    dz: number;
    anchorX: number | null;
    anchorZ: number | null;
    anchorWindow: string | null;
    pendingWindow: string | null;
    legacy: boolean;
  } | null;
};

const TRACE_KEY = "__openClinXrSteppingTurnTrace";

/** Snapshot the four leg-joint local quats (keys hip/upperMid/knee/lowerMid). */
export function snapshotLegQuats(input: {
  hip: Object3D;
  upperMid: Object3D;
  knee: Object3D;
  lowerMid: Object3D;
}): Record<string, SteppingLegQuat | null> {
  const snap = (bone: Object3D): SteppingLegQuat => ({
    x: bone.quaternion.x,
    y: bone.quaternion.y,
    z: bone.quaternion.z,
    w: bone.quaternion.w,
  });
  return { hip: snap(input.hip), upperMid: snap(input.upperMid), knee: snap(input.knee), lowerMid: snap(input.lowerMid) };
}

/** Default off: only exactly `steppingTurnTrace=1` records. */
export function isSteppingTurnTraceEnabled(): boolean {
  const search = (
    globalThis as unknown as { window?: { location?: { search?: string } } }
  ).window?.location?.search;
  if (typeof search !== "string") return false;
  try {
    return new URLSearchParams(search).get("steppingTurnTrace") === "1";
  } catch {
    return false;
  }
}

export function recordSteppingTurnTraceFrame(frame: SteppingTurnTraceFrame): void {
  if (!isSteppingTurnTraceEnabled()) return;
  const host = globalThis as unknown as Record<string, unknown>;
  const arr = host[TRACE_KEY];
  if (Array.isArray(arr)) arr.push(frame);
  else host[TRACE_KEY] = [frame];
}

export function readSteppingTurnTrace(): SteppingTurnTraceFrame[] {
  const host = globalThis as unknown as Record<string, unknown>;
  const arr = host[TRACE_KEY];
  return Array.isArray(arr) ? (arr as SteppingTurnTraceFrame[]) : [];
}

export function clearSteppingTurnTrace(): void {
  (globalThis as unknown as Record<string, unknown>)[TRACE_KEY] = [];
}
