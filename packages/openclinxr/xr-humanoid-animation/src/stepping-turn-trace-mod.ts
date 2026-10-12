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
  /** Mixer walk-clip + leg-weight snapshot (turn-leg-snaps stage 1b); null when untraced. */
  mixer: SteppingTurnMixerState | null;
  /** Hip-write stacks recorded while the solve was muted (stage 1c instrument). */
  hipWrites: string[];
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

/** Instrument-only hip-write trap (turn-leg-snaps stage 1c, reverted after use). */
let hipTrapMuted = false;
let hipTrapArmed = false;
const hipTrapStacks: string[] = [];
export function setHipWriteTrapMuted(muted: boolean): void {
  hipTrapMuted = muted;
}
/** Hook the hips' quaternion change callbacks; stacks recorded while unmuted. */
export function armHipWriteTrap(hipLeft: Object3D, hipRight: Object3D): void {
  if (hipTrapArmed) return;
  hipTrapArmed = true;
  for (const hip of [hipLeft, hipRight]) {
    const q = hip.quaternion as unknown as { _onChangeCallback?: () => void };
    const prev = q._onChangeCallback;
    q._onChangeCallback = () => {
      try {
        prev?.();
      } catch {
        /* keep prior behaviour */
      }
      if (hipTrapMuted) return;
      if (hipTrapStacks.length >= 24) return;
      hipTrapStacks.push(`${hip.name} quat :: ${(new Error().stack ?? "").split("\n").slice(1, 6).join(" <- ")}`);
    };
    // Euler-direct writes sync the quaternion with update=false, bypassing the
    // trap above — but they DO fire the Euler callback (quaternion-synced writes
    // pass update=false the other way, so this fires only on direct Euler writes).
    const e = hip.rotation as unknown as { _onChangeCallback?: () => void };
    const prevE = e._onChangeCallback;
    e._onChangeCallback = () => {
      try {
        prevE?.();
      } catch {
        /* keep prior behaviour */
      }
      if (hipTrapMuted) return;
      if (hipTrapStacks.length >= 24) return;
      hipTrapStacks.push(`${hip.name} EULER :: ${(new Error().stack ?? "").split("\n").slice(1, 6).join(" <- ")}`);
    };
  }
}
/** Drain recorded stacks (clears the buffer). */
export function drainHipWriteStacks(): string[] {
  return hipTrapStacks.splice(0, hipTrapStacks.length);
}

const boneIds = new WeakMap<object, number>();
let nextBoneId = 1;
function boneIdOf(bone: object): number {
  let id = boneIds.get(bone);
  if (id === undefined) {
    id = nextBoneId;
    nextBoneId += 1;
    boneIds.set(bone, id);
  }
  return id;
}
/**
 * Per-frame rig census (stage-1e instrument): every sanitised thigh/shin match
 * under the slot with identity ids, plus the ids the chain resolver would take
 * ([0] per bone). Detects duplicate-rig name-resolution flips.
 */
export function censusSteppingLegs(actorSlot: Object3D, frame: number): string {
  const flat = (name: string): string => name.replaceAll(".", "");
  const matches = (want: string): Object3D[] => {
    const found: Object3D[] = [];
    actorSlot.traverse((o) => {
      if (o.name && flat(o.name) === want) found.push(o);
    });
    // Mirror findBonesBySanitisedName's second pass (skeleton arrays can hold
    // bones the graph walk never visits).
    actorSlot.traverse((o) => {
      const skinned = o as Object3D & { isSkinnedMesh?: boolean; skeleton?: { bones: Object3D[] } };
      if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
      for (const bone of skinned.skeleton.bones) {
        if (bone.name && flat(bone.name) === want) found.push(bone);
      }
    });
    return found;
  };
  const ids = (want: string): string => matches(want).map((o) => `#${boneIdOf(o)}`).join(",") || "-";
  const parts: string[] = [];
  for (const base of ["upperleg01", "upperleg02", "lowerleg01", "lowerleg02"]) {
    for (const side of ["L", "R"]) {
      parts.push(`${base}${side}:[${ids(`${base}${side}`)}]`);
    }
  }
  return `census f${frame} ${parts.join(" ")}`;
}

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

export type SteppingTurnMixerState = {
  clipName: string | null;
  playing: boolean | null;
  timeSeconds: number | null;
  legWeight: number | null;
};

/** Read-only mixer snapshot (walk clip + leg weight) off the slot root chain. */
export function readSteppingTurnMixerState(actorSlot: Object3D): SteppingTurnMixerState {
  let node: Object3D | null = actorSlot;
  while (node !== null) {
    const ud = (node.userData ?? {}) as Record<string, unknown>;
    const playback = ud["openClinXrLocomotionClipPlayback"] as
      | { clipName?: unknown; playing?: unknown; timeSeconds?: unknown }
      | undefined;
    const weight = ud["openClinXrLocomotionLegWeight"] as { current?: unknown } | undefined;
    if (playback !== undefined || weight !== undefined) {
      return {
        clipName: typeof playback?.clipName === "string" ? playback.clipName : null,
        playing: typeof playback?.playing === "boolean" ? playback.playing : null,
        timeSeconds: typeof playback?.timeSeconds === "number" ? playback.timeSeconds : null,
        legWeight: typeof weight?.current === "number" ? weight.current : null,
      };
    }
    node = node.parent;
  }
  return { clipName: null, playing: null, timeSeconds: null, legWeight: null };
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
