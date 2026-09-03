import type { CompiledMotionFragment, CompiledMotionTrack, PrimitiveRequest } from "./canonical-motion-contract.js";

import { approachHoldRelease, axisAngleQuaternion, seededScale } from "./trajectory.js";

/**
 * `reach_target` — the arm chain EXTENDS toward a target and holds the reach.
 *
 * Owned by M4 (tsk_ccc9fb8c7f0def8b); the registry seam (tsk_51ffcc3e1a8fdea8) resolved this id to
 * this module's `compile`, and this body replaces the seam's empty-tracks placeholder.
 *
 * BEHAVIOUR: a reach is a JOINT-SPACE extension, so this primitive drives the shoulder, elbow and
 * wrist as rotation tracks — shoulder flexion (upper_armR about X), elbow flexion (forearmR about
 * X) and a small wrist roll (handR about Z) — on a minimum-jerk reach-and-hold envelope whose hold
 * window sits later than the clutch's (the hand stays extended while the reach is presented).
 *
 * This is the deliberate contrast with `clutch_body_region`: that primitive is a positional clamp
 * (a translation track on the effector), this one is an articulated extension (three rotation
 * tracks on the chain). Both animate the same arm bones — the plant's joint-set clause explicitly
 * tolerates that one coincidence — but the channel content, the axes and the hold windows differ,
 * which is what the pairwise-distinctness clause measures. Amplitude per track is scaled by the
 * request seed through separate variation streams (seededScale with a distinct salt per bone).
 */

const SAMPLES = 64;
const DEFAULT_DURATION_MS = 900;
const HOLD = { holdStart: 0.45, holdEnd: 0.8 };
const JITTER = 0.12;

/** Base flex amplitudes in radians, before seed scaling: shoulder < elbow, wrist small. */
const CHAIN = [
  { boneName: "upper_armR", axis: [1, 0, 0] as const, base: 0.55, salt: 1 },
  { boneName: "forearmR", axis: [1, 0, 0] as const, base: 0.7, salt: 2 },
  { boneName: "handR", axis: [0, 0, 1] as const, base: 0.15, salt: 3 },
] as const;

function readActionId(request: PrimitiveRequest): string {
  const actionId = (request.action as { actionId?: unknown }).actionId;
  if (typeof actionId !== "string") {
    throw new Error("reach_target requires a request whose action carries a string actionId");
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

  // TRACK TIMES ARE SECONDS: the clip's `durationSeconds` is the maximum final track time, so the
  // samples a primitive emits must be seconds, not the authored milliseconds (compiler-surface
  // clause 4 — a 900 ms action used to report durationSeconds 900).
  const durationSeconds = durationMs / 1000;

  const times = new Array<number>(SAMPLES);
  const trackValues = CHAIN.map(() => new Array<[number, number, number, number]>(SAMPLES));
  for (let i = 0; i < SAMPLES; i += 1) {
    times[i] = (i * durationSeconds) / (SAMPLES - 1);
    const u = i / (SAMPLES - 1);
    const curve = approachHoldRelease(u, HOLD);
    for (let c = 0; c < CHAIN.length; c += 1) {
      const link = CHAIN[c]!;
      const angle = link.base * seededScale(seed, link.salt, JITTER) * curve;
      trackValues[c]![i] = axisAngleQuaternion(link.axis, angle);
    }
  }

  const target = (request.action as { target?: { kind?: unknown; id?: unknown } }).target;
  const landmark =
    target?.kind === "body_region" && typeof target.id === "string" ? target.id : "reach_target_target";

  const tracks: CompiledMotionTrack[] = CHAIN.map((entry, c) => ({
    property: "rotationAbsoluteNodeLocal",
    boneName: entry.boneName,
    canonicalLandmark: landmark,
    interpolation: "LINEAR",
    times,
    values: trackValues[c]!,
  }));

  return { actionId, tracks };
}
