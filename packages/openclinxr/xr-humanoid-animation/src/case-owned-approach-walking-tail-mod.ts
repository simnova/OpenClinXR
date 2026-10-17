import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";
import { applyClosedLoopWalkStep } from "./closed-loop-root-advance-mod.js";
import { applyFootBaseStep } from "./foot-base-stride-retarget-mod.js";
import {
  applyFootstepPlanStep,
  pushFootstepTapRecord,
  snapshotFootstepTapStage,
} from "./footstep-plan-amplitude-mod.js";
import { readLocoGroundNoStanceLock } from "./loco-ground-tap-mod.js";
import { footBaseActiveFor, footstepPlanActiveFor } from "./rig-capability-gate-mod.js";
import { applyStanceLockedGroundAdvance } from "./stance-lock-mod.js";
import {
  resolveClipStanceForFrame,
  resolveStopStanceForFrame,
} from "./stop-clip-playback-mod.js";

/**
 * Walking-phase lock tail of `applyCaseOwnedStanceLock`: the stance lock,
 * the footstep-plan amplitude blend, and the closed-loop advance, in that
 * order. Moved verbatim out of `case-owned-approach-frame-mod.ts` to hold
 * that file's 500-line zone budget; behaviour is unchanged except the M1
 * per-stage tap and the closed-loop summary return, both default-off behind
 * `?footstepPlan=1` (flag absent = the tap snapshots never run and the
 * summary is ignored).
 *
 * THE ORDER IS THE MECHANISM (see `applyCaseOwnedStanceLock`'s header):
 * the lock reads the mixer's own pose for this frame (observe-only under
 * the plan flag, so it writes nothing), the blend reshapes the walking
 * legs, and the closed loop advances the slot on the scaled planted foot.
 */
export function applyWalkingPhaseLocks(
  approach: CaseOwnedBedsideApproach,
  deltaSeconds: number,
): void {
  // The route the executor walks, as a unit direction: the stance rule reads clip-space toe
  // travel along it, and the no-backward clamp holds the slot against it. The executor steps
  // start-to-target, so this is its own axis, not a second opinion about the route.
  const routeDx = approach.target.x - approach.start.x;
  const routeDz = approach.target.z - approach.start.z;
  const routeLength = Math.hypot(routeDx, routeDz);
  // The clip labels stance once per bound clip; the action time is this frame's. The slot is set
  // by the station resolve (browser), the offline harness, or stays null (rigs with no clip) —
  // `resolveClipStanceForFrame` resolves and caches `approach.stanceLabels` lazily either way.
  // While stopping, the lock reads the STOP take's labels at the stop elapsed time instead.
  const clipStance =
    approach.execution.phase === "stopping" ? resolveStopStanceForFrame(approach) : resolveClipStanceForFrame(approach);
  approach.lock = applyStanceLockedGroundAdvance({
    actorSlot: approach.actorSlot,
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
    floorOriginY: approach.floorOriginY,
    contactBandMeters: approach.contactBandMeters,
    state: approach.lock,
    ccdStanceLockEnabled: approach.ccdStanceLockEnabled,
    // LOCO-GROUND lock-disabled row: the SAME code path computes production
    // labels and the would-be correction, but nothing is written — the
    // rendered walk isolates clip + root. Settling/arrived writers above are
    // unaffected, so the run still terminates.
    observeOnly: readLocoGroundNoStanceLock() || footstepPlanActiveFor(approach.actorSlot),
    recordHeelMiss: (missM: number | null): void => { approach.lastHeelMissM = missM; },
    ...(routeLength > 0
      ? { travelUnit: { x: routeDx / routeLength, z: routeDz / routeLength }, routeStart: approach.start }
      : {}),
    ...(clipStance ? { clipStance } : {}),
  });
  // FOOTSTEP-PLAN S2 (default OFF): stride-amplitude blend on the walking
  // pose first; the closed loop below then advances on the scaled planted foot.
  // M1 tap (creep slice, same flag): snapshot the toe worlds at each stage —
  // reads only, and the whole block is skipped with the flag off.
  const footstepTapOn = footstepPlanActiveFor(approach.actorSlot);
  const tapMixer = footstepTapOn
    ? snapshotFootstepTapStage({
        actorSlot: approach.actorSlot,
        leftToe: approach.leftToe,
        rightToe: approach.rightToe,
      })
    : null;
  // FOOT-BASE (default OFF, `?footBase=1` on any plan-accepted route): stride
  // retargeting replaces BOTH the amplitude blend and the closed-loop advance
  // below; a refused route or a missing flag keeps the legacy path.
  const footBaseActive = footBaseActiveFor(approach.actorSlot, routeLength);
  if (footBaseActive) {
    applyFootBaseStep({
      approach,
      routeDx,
      routeDz,
      routeLength,
      clip: clipStance
        ? { labels: clipStance.labels, actionTimeSeconds: clipStance.actionTimeSeconds }
        : null,
    });
  } else {
    applyFootstepPlanStep({ approach, routeDx, routeDz, routeLength });
  }
  const tapBlend = footstepTapOn
    ? snapshotFootstepTapStage({
        actorSlot: approach.actorSlot,
        leftToe: approach.leftToe,
        rightToe: approach.rightToe,
      })
    : null;
  // FOOTSTEP-PLAN S1 (default OFF): opt-in closed-loop root advance; no flag, no effect.
  // Skipped under foot-base: the stride retarget above owns the slot advance.
  const closedSummary = footBaseActive
    ? null
    : applyClosedLoopWalkStep({ approach, routeDx, routeDz, routeLength, deltaSeconds });
  if (footstepTapOn && tapMixer !== null && tapBlend !== null) {
    pushFootstepTapRecord({
      sub: approach.execution.walkSimSubsteps ?? -1,
      scale: approach.footstep?.scale ?? null,
      stanceLabel: approach.lock.stanceFoot,
      plantedFoot: closedSummary?.plantedFoot ?? null,
      carried: closedSummary?.carried ?? null,
      advanceMeters: closedSummary?.advanceMeters ?? null,
      appliedDeltaMeters: closedSummary?.appliedDeltaMeters ?? null,
      mixer: tapMixer,
      blend: tapBlend,
      post: snapshotFootstepTapStage({
        actorSlot: approach.actorSlot,
        leftToe: approach.leftToe,
        rightToe: approach.rightToe,
      }),
    });
  }
}
