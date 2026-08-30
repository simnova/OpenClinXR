import type { CompiledMotionFragment, CompiledMotionTrack, PrimitiveRequest } from "./canonical-motion-contract.js";

import { approachHoldRelease, axisAngleQuaternion, seededScale } from "./trajectory.js";

/**
 * `look_at` — the head and neck ORIENT toward a gaze target and hold the look.
 *
 * Owned by M4 (tsk_ccc9fb8c7f0def8b); the registry seam (tsk_51ffcc3e1a8fdea8) resolved this id to
 * this module's `compile`, and this body replaces the seam's empty-tracks placeholder.
 *
 * BEHAVIOUR: a gaze is a HEAD/neck orientation, so this primitive drives exactly two bones —
 * neck yaw about Y and head pitch about X — on a minimum-jerk approach, a LONG hold (a gaze is
 * held, not tapped), and a minimum-jerk release. It shares no bone with the two arm primitives or
 * the torso recoil, which is the joint-set half of the distinctness clause.
 *
 * Yaw lives on the neck and pitch on the head because the track contract allows ONE rotation
 * track per bone; two axes of one bone would collide on the same bone::property key. Amplitude
 * per bone is scaled by the request seed through separate variation streams.
 */

const SAMPLES = 64;
const DEFAULT_DURATION_MS = 900;
/** A gaze is held: the approach is short and the release is late. */
const HOLD = { holdStart: 0.35, holdEnd: 0.9 };
const JITTER = 0.15;

const GAZE = [
  { boneName: "neck", axis: [0, 1, 0] as const, base: 0.45, salt: 1 },
  { boneName: "head", axis: [1, 0, 0] as const, base: 0.22, salt: 2 },
] as const;

function readActionId(request: PrimitiveRequest): string {
  const actionId = (request.action as { actionId?: unknown }).actionId;
  if (typeof actionId !== "string") {
    throw new Error("look_at requires a request whose action carries a string actionId");
  }
  return actionId;
}

function readDurationMs(request: PrimitiveRequest): number {
  const durationMs = (request.action as { timing?: { durationMs?: unknown } }).timing?.durationMs;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : DEFAULT_DURATION_MS;
}

export function compile(request: PrimitiveRequest): CompiledMotionFragment {
  const actionId = readActionId(request);
  const durationMs = readDurationMs(request);
  const seed = request.seed;

  const times = new Array<number>(SAMPLES);
  const trackValues = GAZE.map(() => new Array<[number, number, number, number]>(SAMPLES));
  for (let i = 0; i < SAMPLES; i += 1) {
    times[i] = (i * durationMs) / (SAMPLES - 1);
    const u = i / (SAMPLES - 1);
    const curve = approachHoldRelease(u, HOLD);
    for (let g = 0; g < GAZE.length; g += 1) {
      const bone = GAZE[g]!;
      const angle = bone.base * seededScale(seed, bone.salt, JITTER) * curve;
      trackValues[g]![i] = axisAngleQuaternion(bone.axis, angle);
    }
  }

  const target = (request.action as { target?: { kind?: unknown; id?: unknown } }).target;
  const landmark =
    target?.kind === "body_region" && typeof target.id === "string" ? target.id : "look_at_target";

  const tracks: CompiledMotionTrack[] = GAZE.map((entry, g) => ({
    property: "rotationAbsoluteNodeLocal",
    boneName: entry.boneName,
    canonicalLandmark: landmark,
    interpolation: "LINEAR",
    times,
    values: trackValues[g]!,
  }));

  return { actionId, tracks };
}
