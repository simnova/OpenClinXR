/**
 * Default-off per-frame trace of the stepping-turn slot update (settle-entry
 * slice, stage 1). Records every term that changes actorSlot position or yaw
 * in a settling frame, with its inputs. Pure observation: recording never
 * writes the scene, the slot, or the plan.
 *
 * Enabled only by `?steppingTurnTrace=1` (browser capture); node/tests read
 * false. Internal module, not a public entrypoint export.
 */

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
};

const TRACE_KEY = "__openClinXrSteppingTurnTrace";

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
