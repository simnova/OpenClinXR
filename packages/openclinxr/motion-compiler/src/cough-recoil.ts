import type { CompiledMotionFragment, CompiledMotionTrack, PrimitiveRequest } from "./canonical-motion-contract.js";

import { axisAngleQuaternion, minimumJerkSample, seededScale } from "./trajectory.js";

/**
 * `cough_recoil` — the torso CONVULSES: a sharp forward flex, a recoil past neutral, a settle.
 *
 * Owned by M4 (tsk_ccc9fb8c7f0def8b); the registry seam (tsk_51ffcc3e1a8fdea8) resolved this id to
 * this module's `compile`, and this body replaces the seam's empty-tracks placeholder.
 *
 * BEHAVIOUR: a cough is a torso convulsion, not a hold, so this primitive drives spine and chest
 * flexion (rotation about X) through a THREE-SEGMENT shape built entirely from the minimum-jerk
 * quintic: a forward flex to full amplitude, a return THROUGH neutral to a negative overshoot,
 * and a settle back to neutral. Every segment boundary has zero velocity, so the convulsion is
 * smooth. It is the only one of the four primitives whose displacement changes SIGN — none of the
 * other three ever moves its joints past the neutral pose — and it shares no bone with the arm or
 * gaze primitives.
 *
 * The overshoot factor and per-bone amplitudes are scaled by the request seed, so the same seed
 * reproduces the same convulsion byte-identically and a different seed changes it.
 */

const SAMPLES = 64;
const DEFAULT_DURATION_MS = 900;
const JITTER = 0.15;
const OVERSHOOT = 0.35;

const TORSO = [
  { boneName: "spine", base: 0.3, salt: 1 },
  { boneName: "chest", base: 0.2, salt: 2 },
] as const;

const FLEX_END = 0.3;
const RECOIL_END = 0.62;

/**
 * The recoil shape on [0, 1]: 0 → +1 (minimum-jerk flex), +1 → −overshoot (minimum-jerk return
 * through neutral), −overshoot → 0 (minimum-jerk settle). Velocity is zero at 0, at the flex
 * peak, at the recoil trough and at 1, so all three segments join with zero velocity.
 */
function recoilDisplacement(u: number, overshoot: number): number {
  if (u < FLEX_END) return minimumJerkSample(u / FLEX_END);
  if (u < RECOIL_END) {
    const p = (u - FLEX_END) / (RECOIL_END - FLEX_END);
    return 1 + (-overshoot - 1) * minimumJerkSample(p);
  }
  const p = (u - RECOIL_END) / (1 - RECOIL_END);
  return -overshoot * (1 - minimumJerkSample(p));
}

function readActionId(request: PrimitiveRequest): string {
  const actionId = (request.action as { actionId?: unknown }).actionId;
  if (typeof actionId !== "string") {
    throw new Error("cough_recoil requires a request whose action carries a string actionId");
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

  const overshoot = OVERSHOOT * seededScale(seed, 0, JITTER);

  // TRACK TIMES ARE SECONDS: the clip's `durationSeconds` is the maximum final track time, so the
  // samples a primitive emits must be seconds, not the authored milliseconds (compiler-surface
  // clause 4 — a 900 ms action used to report durationSeconds 900).
  const durationSeconds = durationMs / 1000;

  const times = new Array<number>(SAMPLES);
  const trackValues = TORSO.map(() => new Array<[number, number, number, number]>(SAMPLES));
  for (let i = 0; i < SAMPLES; i += 1) {
    times[i] = (i * durationSeconds) / (SAMPLES - 1);
    const u = i / (SAMPLES - 1);
    const shape = recoilDisplacement(u, overshoot);
    for (let t = 0; t < TORSO.length; t += 1) {
      const bone = TORSO[t]!;
      const angle = bone.base * seededScale(seed, bone.salt, JITTER) * shape;
      trackValues[t]![i] = axisAngleQuaternion([1, 0, 0], angle);
    }
  }

  const target = (request.action as { target?: { kind?: unknown; id?: unknown } }).target;
  const landmark =
    target?.kind === "body_region" && typeof target.id === "string" ? target.id : "cough_recoil_target";

  const tracks: CompiledMotionTrack[] = TORSO.map((entry, t) => ({
    property: "rotationAbsoluteNodeLocal",
    boneName: entry.boneName,
    canonicalLandmark: landmark,
    interpolation: "LINEAR",
    times,
    values: trackValues[t]!,
  }));

  return { actionId, tracks };
}
