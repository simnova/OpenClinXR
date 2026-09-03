import type { CompiledMotionFragment, CompiledMotionTrack, PrimitiveRequest } from "./canonical-motion-contract.js";

import { axisAngleQuaternion, minimumJerkSample, seededScale } from "./trajectory.js";
import { isLeftSideBone, requestedEffector } from "./requested-effector.js";

/**
 * `imposed_limb_arc` — the limb is CARRIED through an out-and-back arc by an examiner's grasp.
 *
 * Registered for the `passive_rom` response kind (BothyBoard issue #0). Before this primitive
 * existed, passive_rom resolved to `guard_body_region`, so a patient resisting an examiner-imposed
 * movement compiled to the same tracks as a patient guarding spontaneously. The physics-touch
 * contract models passive ROM as a GRASPED ARC — `scenarios/passive-rom.ts` phases approach,
 * grasp, controlled rotation through the arc, release — and this primitive compiles the patient
 * side of that: the limb is not withdrawn by its owner, it is moved BY the examiner and yielded to.
 *
 * BEHAVIOUR: the whole arm chain swings as one carried unit. The examiner's grasp holds the elbow
 * nearly extended, so the shoulder carries the sweep while the forearm and hand contribute only a
 * small in-phase give (joint play under the grasp), never an independent elbow-driven extension.
 * The displacement is a single minimum-jerk OUT-AND-BACK sweep — 0 to full arc amplitude at the
 * midpoint and back to rest — with no hold plateau: an imposed arc is a traversal, not a posture
 * held at its end. This is the deliberate contrast with `reach_target` (an elbow-dominant
 * extension that HOLDS late and returns) and with `guard_body_region` (a self-initiated
 * withdraw-to-site with a retained settle).
 *
 * The examined side comes from the request's effector (`action.effector`, the profile's legacy
 * `effectorBone`, then `handR`), so a left-side passive-ROM step drives the left chain. Amplitude
 * per bone is scaled by the request seed through separate variation streams.
 *
 * notEvidenceFor: that this arc is the clinically correct passive-ROM manoeuvre for any joint or
 * direction (a faculty question; the physics contract names shoulder/elbow/wrist and six
 * directions and this primitive is one arc shape), anatomical plausibility, runtime IK, or
 * apps/ui-xr.
 */

const SAMPLES = 64;
const DEFAULT_DURATION_MS = 900;
const JITTER = 0.12;
/** The carried sweep peaks at the clip midpoint: out to the arc end, then back to rest. */
const SWEEP_PEAK = 0.5;

/** Arc amplitudes in radians: the shoulder carries the limb; the grasp keeps elbow and wrist quiet. */
const CARRY = [
  { role: "shoulder", base: 0.85, salt: 1 },
  { role: "forearm", base: 0.1, salt: 2 },
  { role: "hand", base: 0.06, salt: 3 },
] as const;

const CHAIN_BONES = {
  L: { shoulder: "upper_armL", forearm: "forearmL", hand: "handL" },
  R: { shoulder: "upper_armR", forearm: "forearmR", hand: "handR" },
} as const;

/**
 * The carried-arc shape on [0, 1]: 0 → 1 by minimum jerk over `[0, SWEEP_PEAK]` (the examiner
 * lifts the limb out to the arc end), then 1 → 0 by minimum jerk over `[SWEEP_PEAK, 1]` (the limb
 * is brought back down). Both segments join with zero velocity, so the traversal is smooth and the
 * limb is at rest again when the clip ends.
 */
function carriedArcDisplacement(u: number): number {
  if (u <= SWEEP_PEAK) {
    return SWEEP_PEAK <= 0 ? 0 : minimumJerkSample(u / SWEEP_PEAK);
  }
  const span = 1 - SWEEP_PEAK;
  return span <= 0 ? 0 : 1 - minimumJerkSample((u - SWEEP_PEAK) / span);
}

function readActionId(request: PrimitiveRequest): string {
  const actionId = (request.action as { actionId?: unknown }).actionId;
  if (typeof actionId !== "string") {
    throw new Error("imposed_limb_arc requires a request whose action carries a string actionId");
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

  const effector = requestedEffector(request);
  const side = isLeftSideBone(effector) ? "L" : "R";
  const chain = CHAIN_BONES[side];

  // TRACK TIMES ARE SECONDS: the clip's `durationSeconds` is the maximum final track time, so the
  // samples a primitive emits must be seconds, not the authored milliseconds (compiler-surface
  // clause 4 — a 900 ms action used to report durationSeconds 900).
  const durationSeconds = durationMs / 1000;

  const times = new Array<number>(SAMPLES);
  const trackValues = CARRY.map(() => new Array<[number, number, number, number]>(SAMPLES));
  for (let i = 0; i < SAMPLES; i += 1) {
    times[i] = (i * durationSeconds) / (SAMPLES - 1);
    const u = i / (SAMPLES - 1);
    const shape = carriedArcDisplacement(u);
    for (let c = 0; c < CARRY.length; c += 1) {
      const link = CARRY[c]!;
      const angle = link.base * seededScale(seed, link.salt, JITTER) * shape;
      // The whole chain swings about the coronal-plane axis: the examiner's grasp abducts the limb
      // and carries forearm and hand with it rather than flexing them independently.
      trackValues[c]![i] = axisAngleQuaternion([0, 0, 1], angle);
    }
  }

  const target = (request.action as { target?: { kind?: unknown; id?: unknown } }).target;
  const landmark =
    target?.kind === "body_region" && typeof target.id === "string" ? target.id : "imposed_limb_arc_target";

  const tracks: CompiledMotionTrack[] = CARRY.map((entry, c) => ({
    property: "rotationAbsoluteNodeLocal",
    boneName: chain[entry.role],
    canonicalLandmark: landmark,
    interpolation: "LINEAR",
    times,
    values: trackValues[c]!,
  }));

  return { actionId, tracks };
}
