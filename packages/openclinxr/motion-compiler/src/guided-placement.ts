import type { CompiledMotionFragment, CompiledMotionTrack, PrimitiveRequest } from "./canonical-motion-contract.js";

import { minimumJerkSample, seededScale } from "./trajectory.js";
import { effectorBoneOnRig, isLeftSideBone, requestedEffector } from "./requested-effector.js";

/**
 * `guided_placement` — the effector is GUIDED to a placed position, dwells there, and releases
 * with the placement retained.
 *
 * Registered for the `positioning` response kind (BothyBoard issue #0). Before this primitive
 * existed, positioning resolved to `reach_target`, so a guided repositioning compiled to the same
 * tracks as a palpation-driven protective reach. The physics-touch contract models positioning as
 * GUIDED CONTACT WITH A DWELL AND A RELEASE — `scenarios/positioning.ts` phases approach, gentle
 * contact, guided translation from start to end position, dwell at the end, release — and this
 * primitive compiles the patient side of that: a small, low-force placement that ENDS with the
 * limb somewhere it was not before.
 *
 * BEHAVIOUR: a placement is a POSITIONAL guide, so this primitive writes one NODE-LOCAL
 * TRANSLATION track on the effector. The displacement is a three-segment minimum-jerk shape —
 * guide to the placed offset (0 → 1), dwell while the contact is held (plateau), then release —
 * and the release does NOT return to rest: it settles at a retained fraction of the placed offset,
 * because repositioning is not a tap. The limb is left placed. That end state is the deliberate
 * contrast with `clutch_body_region` (a positional clamp that returns fully to rest) and with
 * `reach_target` (an articulated extension with a mid-motion hold), and the translation channel
 * contrasts with the rotation-only `guard_body_region`, `look_at`, `cough_recoil` and
 * `imposed_limb_arc`.
 *
 * The effector is the request's (`action.effector`, the profile's legacy `effectorBone`, then
 * `handR`), resolved against the profile's own joint table when it carries one; a left-hand guide
 * mirrors the laterality of the travel. The placed offset is a BASE guided displacement — a few
 * centimetres in the effector's node-local frame — not a per-region vector table: which placed
 * positions each region needs is an authoring/faculty concern, not asserted here. Amplitude is
 * scaled by the request seed.
 *
 * notEvidenceFor: that the placed offsets are the clinically correct repositioned postures (a
 * faculty question; no per-region vectors are claimed), anatomical plausibility, runtime IK, or
 * apps/ui-xr.
 */

const SAMPLES = 64;
const DEFAULT_DURATION_MS = 900;
const JITTER = 0.12;
/** The guide phase ends here (fraction of the clip); the effector is at the placed offset. */
const GUIDE_END = 0.55;
/** The dwell phase ends here; the contact then releases. */
const DWELL_END = 0.85;
/** The fraction of the placed offset the release settles at — the limb stays placed, not tapped. */
const RELEASE_RETAIN = 0.25;
/** The base guided displacement in metres, effector-node-local: slightly down and forward into the supported placement. */
const PLACED_DELTA = { x: 0, y: -0.05, z: 0.07 } as const;
/** The default bind local position the fixtures rest on when a profile carries no joint table. */
const DEFAULT_REST = { x: 0, y: -0.26, z: 0 } as const;

type Vec3 = { x: number; y: number; z: number };

/**
 * The guide/dwell/release shape on [0, 1]: 0 → 1 by minimum jerk over `[0, GUIDE_END]`, a flat
 * dwell at 1 over `[GUIDE_END, DWELL_END]`, then a minimum-jerk fall to `RELEASE_RETAIN` over
 * `[DWELL_END, 1]`. Velocity is zero at the guide peak, at the dwell edges and at the end, so the
 * three phases join smoothly and the clip ends at rest in the retained placed offset.
 */
function guideDwellReleaseDisplacement(u: number): number {
  if (u <= GUIDE_END) {
    return GUIDE_END <= 0 ? 0 : minimumJerkSample(u / GUIDE_END);
  }
  if (u <= DWELL_END) return 1;
  const span = 1 - DWELL_END;
  if (span <= 0) return 0;
  return 1 - (1 - RELEASE_RETAIN) * minimumJerkSample((u - DWELL_END) / span);
}

function readActionId(request: PrimitiveRequest): string {
  const actionId = (request.action as { actionId?: unknown }).actionId;
  if (typeof actionId !== "string") {
    throw new Error("guided_placement requires a request whose action carries a string actionId");
  }
  return actionId;
}

function readDurationMs(request: PrimitiveRequest): number {
  const durationMs = (request.action as { timing?: { durationMs?: unknown } }).timing?.durationMs;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : DEFAULT_DURATION_MS;
}

/** The effector's bind local position from the profile's joint table, when the profile carries one. */
function readBindPosition(request: PrimitiveRequest, effectorBone: string): Vec3 {
  const joints = (request.skeletonProfile as { joints?: { boneName?: unknown; bindLocalPosition?: unknown }[] }).joints;
  if (Array.isArray(joints)) {
    for (const joint of joints) {
      if (joint.boneName !== effectorBone) continue;
      const p = joint.bindLocalPosition as { x?: unknown; y?: unknown; z?: unknown } | undefined;
      if (p && typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number") {
        return { x: p.x, y: p.y, z: p.z };
      }
    }
  }
  // The fixture profiles keep the hand at its bind rest when the joint table does not carry it.
  return { x: DEFAULT_REST.x, y: DEFAULT_REST.y, z: DEFAULT_REST.z };
}

export function compile(request: PrimitiveRequest): CompiledMotionFragment {
  const actionId = readActionId(request);
  const durationMs = readDurationMs(request);
  const seed = request.seed;

  const requested = requestedEffector(request);
  const effector = effectorBoneOnRig(request, requested);
  const rest = readBindPosition(request, effector);
  // A left-hand guide mirrors the right-hand travel across the body mid-plane, so the effector's
  // own local x is negated for the left side.
  const lateralSign = isLeftSideBone(effector) || isLeftSideBone(requested) ? -1 : 1;

  const amp = seededScale(seed, 1, JITTER);

  // TRACK TIMES ARE SECONDS: the clip's `durationSeconds` is the maximum final track time, so the
  // samples a primitive emits must be seconds, not the authored milliseconds (compiler-surface
  // clause 4 — a 900 ms action used to report durationSeconds 900).
  const durationSeconds = durationMs / 1000;

  const times = new Array<number>(SAMPLES);
  const values: [number, number, number][] = new Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i += 1) {
    times[i] = (i * durationSeconds) / (SAMPLES - 1);
    const u = i / (SAMPLES - 1);
    const curve = guideDwellReleaseDisplacement(u);
    values[i] = [
      rest.x + PLACED_DELTA.x * lateralSign * amp * curve,
      rest.y + PLACED_DELTA.y * amp * curve,
      rest.z + PLACED_DELTA.z * amp * curve,
    ];
  }

  const target = (request.action as { target?: { kind?: unknown; id?: unknown } }).target;
  const landmark =
    target?.kind === "body_region" && typeof target.id === "string" ? target.id : "guided_placement_target";

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
