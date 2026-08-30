import type { CompiledMotionFragment, CompiledMotionTrack, PrimitiveRequest } from "./canonical-motion-contract.js";

import { approachHoldRelease, seededScale } from "./trajectory.js";

/**
 * `clutch_body_region` — the effector hand clamps onto a body region and HOLDS contact there.
 *
 * Owned by M4 (tsk_ccc9fb8c7f0def8b); the registry seam (tsk_51ffcc3e1a8fdea8) resolved this id to
 * this module's `compile`, and this body replaces the seam's empty-tracks placeholder.
 *
 * BEHAVIOUR: a clutch is a positional contact, so this primitive drives the effector's NODE-LOCAL
 * TRANSLATION — the hand leaves its bind rest position, travels to the region on a minimum-jerk
 * approach, holds for the exact window the action's contact constraint declares
 * (startFraction/endFraction), and releases back to rest on a minimum-jerk fall. It is the only
 * one of the four primitives that writes translation tracks; the other three are rotations.
 *
 * The direction of travel is a delta from the effector's bind position, not an anchor: the region
 * anchor producer (upstream of M2) does not exist yet, so no profile in this package carries
 * regionAnchors. Amplitude is scaled by the request seed (seededScale), which is what makes the
 * clip reproducible under a seed and sensitive to it. Anatomical plausibility is NOT claimed here
 * — the plant's own NOT TESTED line records that no clause grades a pose.
 */

const SAMPLES = 64;
const DEFAULT_DURATION_MS = 900;
const DEFAULT_HOLD = { holdStart: 0.4, holdEnd: 0.72 };
/** Direction the hand travels from its bind rest pose: up toward the abdomen, slightly inward. */
const TARGET_DELTA = { x: 0.05, y: 0.2, z: -0.08 } as const;
const JITTER = 0.12;

type Vec3 = { x: number; y: number; z: number };

function readActionId(request: PrimitiveRequest): string {
  const actionId = (request.action as { actionId?: unknown }).actionId;
  if (typeof actionId !== "string") {
    throw new Error("clutch_body_region requires a request whose action carries a string actionId");
  }
  return actionId;
}

function readDurationMs(action: unknown): number {
  const durationMs = (action as { timing?: { durationMs?: unknown } }).timing?.durationMs;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : DEFAULT_DURATION_MS;
}

/** The contact window the action declares, when it declares one. */
function readContactWindow(action: unknown): { holdStart: number; holdEnd: number } | null {
  const constraints = (action as { constraints?: unknown }).constraints;
  if (!Array.isArray(constraints)) return null;
  for (const raw of constraints) {
    const c = raw as { kind?: unknown; startFraction?: unknown; endFraction?: unknown };
    if (c.kind !== "contact") continue;
    const startFraction = c.startFraction;
    const endFraction = c.endFraction;
    if (
      typeof startFraction === "number" && Number.isFinite(startFraction) && startFraction >= 0
      && typeof endFraction === "number" && Number.isFinite(endFraction) && endFraction <= 1
      && endFraction > startFraction
    ) {
      return { holdStart: startFraction, holdEnd: endFraction };
    }
  }
  return null;
}

function readEffectorBone(request: PrimitiveRequest, fallback: string): string {
  const effectorBone = (request.skeletonProfile as { effectorBone?: unknown }).effectorBone;
  return typeof effectorBone === "string" && effectorBone.length > 0 ? effectorBone : fallback;
}

/** The effector's bind local position from the profile's joint table, when the profile carries one. */
function readBindPosition(request: PrimitiveRequest, effectorBone: string): Vec3 {
  const joints = (request.skeletonProfile as { joints?: { boneName?: unknown; bindLocalPosition?: unknown }[] }).joints;
  if (Array.isArray(joints)) {
    for (const joint of joints) {
      if (joint.boneName !== effectorBone) continue;
      const p = joint.bindLocalPosition as { x?: unknown; y?: unknown; z?: unknown } | undefined;
      if (
        p && typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number"
      ) {
        return { x: p.x, y: p.y, z: p.z };
      }
    }
  }
  // The fixture profile's handR bind position; a profile without a joint table keeps the hand at rest.
  return { x: 0, y: -0.26, z: 0 };
}

function sampleTimes(durationMs: number): number[] {
  const out = new Array<number>(SAMPLES);
  for (let i = 0; i < SAMPLES; i += 1) {
    out[i] = (i * durationMs) / (SAMPLES - 1);
  }
  return out;
}

export function compile(request: PrimitiveRequest): CompiledMotionFragment {
  const actionId = readActionId(request);
  const action = request.action as { timing?: unknown; constraints?: unknown; target?: unknown };
  const durationMs = readDurationMs(action);
  const hold = readContactWindow(action) ?? DEFAULT_HOLD;
  const effector = readEffectorBone(request, "handR");
  const rest = readBindPosition(request, effector);

  const amp = seededScale(request.seed, 1, JITTER);

  const times = sampleTimes(durationMs);
  const values: [number, number, number][] = new Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i += 1) {
    const u = i / (SAMPLES - 1);
    const curve = approachHoldRelease(u, hold);
    values[i] = [
      rest.x + TARGET_DELTA.x * amp * curve,
      rest.y + TARGET_DELTA.y * amp * curve,
      rest.z + TARGET_DELTA.z * amp * curve,
    ];
  }

  const target = action.target as { kind?: unknown; id?: unknown } | undefined;
  const landmark =
    target?.kind === "body_region" && typeof target.id === "string" ? target.id : "clutch_body_region_target";

  const track: CompiledMotionTrack = {
    property: "translationAbsoluteNodeLocal",
    boneName: effector,
    canonicalLandmark: landmark,
    interpolation: "LINEAR",
    times,
    values,
  };

  return { actionId, tracks: [track] };
}
