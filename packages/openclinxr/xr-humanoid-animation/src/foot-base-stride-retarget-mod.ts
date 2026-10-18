import { budgetSwingTarget } from "./foot-base-knee-budget-mod.js";
import type { FootBasePathRow } from "./foot-base-path-data-mod.js";
import {
  FOOT_BASE_HEIGHT_DATUM,
  FOOT_BASE_LIFT_PHASE,
  FOOT_BASE_STANCE_FRACTION,
  type FootBaseSide,
  footBaseBandHoldSides,
  footBaseHalfBounds,
  footBaseHalfIndex,
  footBaseHalfTravelM,
  footBaseRelPhase,
  footBaseRowAt,
  footBaseScheduleStance,
} from "./foot-base-schedule-mod.js";
import { finishSplitStancePin, splitStanceHoldBandM } from "./foot-base-split-stance-mod.js";
import {
  type FootBaseApproachState,
  type FootBaseClipRead,
  type FootBaseStepSummary,
  getOrCreateFootBaseState,
  heelWorldNow,
  noteFirstHandoverPlant,
  toeWorldNow,
} from "./foot-base-state-mod.js";
import { resolveRigFootGeometry } from "./foot-rig-geometry-mod.js";
import { FOOTSTEP_START_PHASE_S, planFootsteps } from "./footstep-plan-schedule.js";
import {
  findSteppingLegChain,
  heelTargetForToeTargetStable,
  solveSteppingLegHinge,
} from "./stepping-turn-leg-ik-mod.js";

/**
 * Schedule/role math lives in `./foot-base-schedule-mod.js` (split out for
 * the 500-line zone budget); the names are re-exported here so existing deep
 * importers keep working. Behaviour is unchanged.
 */
export {
  FOOT_BASE_LIFT_PHASE,
  FOOT_BASE_STANCE_FRACTION,
  type FootBaseSide,
  footBaseHalfBounds,
  footBaseHalfIndex,
  footBaseHalfTravelM,
  footBaseRelPhase,
  footBaseRowAt,
  footBaseScheduleStance,
};

/**
 * Foot-base stride retargeting for the walking phase (foot-base slice, SC-05).
 *
 * Industry practice for variable stride (Johansen 2009, Alyx SIGGRAPH 2021):
 * each foot's toe path stored relative to its foothold segment offline,
 * rebuilt between new footholds as the IK target; stance fixed at foothold.
 * Replaces the amplitude blend plus closed-loop advance per substep: stance
 * toe target = its foothold (XZ pinned by an exact slot translate, height
 * = floor + the plant-toe datum + the stride-scaled row excursion — the
 * rows are plant-relative, not floor-absolute); swing = the foot's own
 * liftoff-to-touchdown segment swept by swing-phase progress (along01 is
 * the documented 0-at-liftoff/1-at-touchdown fraction, heights likewise
 * datum-anchored and stride-scaled), each leg solved with
 * `solveSteppingLegHinge` from a yaw-stable heel target. Pelvis keeps the
 * clip pose. Raw cruise-shape rows applied floor-absolute and
 * stance-relative put targets outside the short-stride reachable envelope
 * (footbase-5: buried stance ~5 cm deep, swing drag 0.6 m behind the hip
 * vs a 0.735 m leg), and the analytic hinge takes the straightest reaching
 * shape — both knees locked straight and the body yanked ahead of the feet.
 *
 * ROLES COME ONLY FROM THE FOOTHOLD SCHEDULE, never from the observe-only
 * stance lock (the lock flaps every 2-4 frames early in the walk; each flap
 * used to freeze the swing foot via the stance pin while the rows marched on,
 * losing ~8 cm of row progress per flap). Each foot's plant-relative phase at
 * the clip time pins it to its foothold over exactly its contact interval
 * (plant-to-lift from physician-walk-contact-phases.json) and lets it follow
 * the swing path otherwise — so in double support BOTH feet pin (each over
 * its own interval; pinning only the most-recent plant dragged the still
 * planted co-stance foot backward ~15 cm per double support). The single
 * crown (most-recent plant, a pure function of phase: one crown change per
 * plant boundary, none between, no hysteresis, no dwell) names the summary
 * stance and orders the slot pin. Footholds are fixed when the plan is built: the
 * entry pair from the physical feet, every later plant one plan step ahead of
 * the other foothold on the planting foot's home side — except the FIRST
 * plant, re-snapped once to the actual touchdown past a 1 mm miss (the first
 * handover fires on a truncated swing; pinning that miss dragged the planted
 * child toe 7.77 mm). The miss is added back at the next plant, so swing-IK
 * miss still cannot accumulate downstream. Targets are absolute rebuilds
 * (no takeoff-relative deltas).
 *
 * The plan datum is anchored to walking entry (halves/body travel count route
 * progress since the first active substep, not clip absolute time). The heel
 * offset is re-read from the pre-solve leg every substep, once per foot
 * before its solve (exogenous clip truth, no feedback, no solve-twice: the
 * second pass was measured not converging the 3-5 cm swing miss).
 *
 * Default OFF behind `?footBase=1`, on every route the footstep plan
 * accepts (planFootsteps refuses nothing here that it accepts there); not
 * re-exported from `./footstep-plan` (no new public symbol, deep import
 * from the tail).
 */

/** This slice's original route length in metres (kept for the 1.31 m record). */
export const FOOT_BASE_ROUTE_LENGTH_M = 1.31;

/** Legacy route match tolerance in metres (kept; the gate no longer uses it). */
export const FOOT_BASE_ROUTE_TOLERANCE_M = 0.005;

/**
 * Solved 1.31 m plan scale (planFootsteps: 3 halves, (1.31 - 0.4156) / 1.265):
 * the foothold spacing when no live plan state is captured (flag without plan).
 */
export const FOOT_BASE_DEFAULT_SCALE = 0.707;

/** State lives in `./foot-base-state-mod.js` and the route gate in
 * `./foot-base-route-gate-mod.js` (both split out for the 500-line zone
 * budget); the gate is re-exported here so existing deep importers keep
 * working. Behaviour is unchanged. */
import { footBaseStepIsActive } from "./foot-base-route-gate-mod.js";
import { footBaseActiveFor } from "./rig-capability-gate-mod.js";

export { footBaseStepIsActive };

/**
 * One walking substep of foot-base stride retargeting (swing-knee budget in
 * `./foot-base-knee-budget-mod.js`, called for the swing side only). Null unless the flag
 * is on, the route is this slice's, the phase is walking, and a clip read is
 * supplied: every other case runs the legacy path untouched.
 *
 * The slot advance follows the foothold polyline: the body travels completed
 * halves plus the current half's share by action time (SET, not incremented —
 * the executor prescribed its own advance pre-lock). After solving the stance
 * leg, the slot is translated XZ so the stance toe coincides with its
 * foothold exactly, and the swing leg is solved after the pin — so the swing
 * lands on its rebuilt target while the stance stays exact. The executor's
 * own travelled/arrival bookkeeping is untouched, so exit and arrival behave
 * as before.
 */
export function applyFootBaseStep(input: {
  approach: FootBaseApproachState;
  routeDx: number;
  routeDz: number;
  routeLength: number;
  clip: FootBaseClipRead | null;
}): FootBaseStepSummary | null {
  const { approach, routeLength } = input;
  if (!footBaseActiveFor(approach.actorSlot, routeLength)) return null;
  if (approach.execution.phase !== "walking" || routeLength <= 0) return null;
  // The first walking frame still holds the idle pose (the lock skips it and
  // anchors on the next one): recording footholds off it would plant them up
  // to half a metre from the clip's own feet.
  if (!approach.lockArmed) return null;
  const clip = input.clip;
  if (clip === null || !(clip.labels.cycleSeconds > 0) || !Number.isFinite(clip.actionTimeSeconds)) return null;
  const leftToeW = toeWorldNow(approach.leftToe);
  const rightToeW = toeWorldNow(approach.rightToe);
  if (leftToeW === null || rightToeW === null) return null;

  const cycleS = clip.labels.cycleSeconds;
  const actionTimeS = clip.actionTimeSeconds;
  const phase01 = ((((actionTimeS % cycleS) + cycleS) % cycleS) + cycleS) % cycleS / cycleS;
  // ROLES FROM THE SCHEDULE ONLY. The observe-only stance lock is not read
  // here at all: it flaps every 2-4 frames early in the walk, and each flap
  // used to freeze the swing foot via the stance pin while the rows marched
  // on (~8 cm of row progress lost per flap). footBaseScheduleStance is a pure
  // function of clip phase: one role change per plant boundary, none between.
  const scheduled: FootBaseSide = footBaseScheduleStance(phase01);
  const state = getOrCreateFootBaseState(approach, scheduled);
  // LoopRepeat wraps the action time at the clip duration; unwrap for the
  // half index so mid-walk wraps keep counting halves forward.
  if (state.lastActionTimeS !== null && actionTimeS < state.lastActionTimeS - cycleS / 2) state.wraps += 1;
  state.lastActionTimeS = actionTimeS;
  const unwrappedS = actionTimeS + state.wraps * cycleS;

  // Plan datum, anchored to walking entry. Halves and body travel measure
  // route progress since the walk started: planS = 0 at entry maps onto the
  // plan's walk-start passing (FOOTSTEP_START_PHASE_S), so bodyTravelM opens
  // at 0 under the physical feet instead of ~9 cm ahead of them. Clip phase
  // (phase01/rows above) keeps absolute action time: rows follow the clip.
  if (state.entryUnwrappedS === null) state.entryUnwrappedS = unwrappedS;
  const planShiftedS = unwrappedS - state.entryUnwrappedS + FOOTSTEP_START_PHASE_S;
  const halfIndex = footBaseHalfIndex(planShiftedS, cycleS);
  const scale = approach.footstep?.scale ?? FOOT_BASE_DEFAULT_SCALE;
  const routeLen = Math.hypot(input.routeDx, input.routeDz);
  if (!(routeLen > 0)) return null;
  // Symmetric foothold spacing (step-asym slice): ONE half-travel per
  // half-cycle, the mean of the route's planned halves (route length over the
  // plan's half count, the plan in force when present, else a fresh solve
  // which the route gate guarantees to accept). The foothold polyline then
  // totals exactly the route length; the per-foot affines stay the
  // planner/M3 model (planFootsteps, FOOTSTEP_TRAVEL_COEFFS untouched), so
  // plan-only and flag-absent paths never reach this branch and read
  // byte-identical geometry.
  const stepsInForce = approach.footstep?.steps;
  const freshPlan = typeof stepsInForce === "number" ? null : planFootsteps(routeLen);
  const steps =
    typeof stepsInForce === "number"
      ? stepsInForce
      : freshPlan !== null && !("refused" in freshPlan)
        ? freshPlan.steps
        : 0;
  const halfTravel = footBaseHalfTravelM(routeLen, steps, scale);
  const unitX = input.routeDx / routeLen;
  const unitZ = input.routeDz / routeLen;
  const floorY = approach.floorOriginY;

  const slot = approach.actorSlot;
  // RIG-AWARE (rig-aware slice): per-rig length scale from the actor's own
  // skeleton rest pose (1 on the physician). Row heights/excursions and the
  // height datum below scale by it; horizontal footholds already come from
  // the plan and timing phases stay as-is. Stored on the approach state.
  const rigK = resolveRigFootGeometry(slot).lengthScale;
  state.rigLengthScale = rigK;
  const rigDatum = (side: FootBaseSide): number =>
    rigK === 1 ? FOOT_BASE_HEIGHT_DATUM[side] : rigK * FOOT_BASE_HEIGHT_DATUM[side];
  const rigScaledHeight = (heightM: number): number =>
    rigK === 1 ? scale * heightM : scale * rigK * heightM;
  const rigScaledLateral = (lateralM: number): number =>
    rigK === 1 ? lateralM : rigK * lateralM;
  const segX = unitX * halfTravel;
  const segZ = unitZ * halfTravel;
  const segLen = Math.abs(halfTravel);
  const sideX = segLen > 1e-9 ? -segZ / segLen : 0;
  const sideZ = segLen > 1e-9 ? segX / segLen : 0;

  // THE SLOT ADVANCE: the body travels the foothold polyline (completed
  // halves plus the current half's share). Pinning against the executor's
  // own advance cancels the stride and the walk thrashes (measured root
  // 1.39 m for 0.28 m travel); the pin below is then a mm correction.
  // Halves are symmetric now (halfTravel identical every half), so the sum is
  // arithmetic, not a loop.
  const bounds = footBaseHalfBounds(halfIndex, cycleS);
  const halfSpan = bounds.end - bounds.start;
  const halfFrac = halfSpan > 0
    ? Math.min(Math.max((planShiftedS - bounds.start) / halfSpan, 0), 1)
    : 0;
  const bodyTravelM = (halfIndex - 1 + halfFrac) * halfTravel;

  const rowNow = (foot: FootBaseSide): FootBasePathRow =>
    footBaseRowAt(foot, footBaseRelPhase(foot, phase01));
  const sideCoord = (p: { x: number; z: number }): number =>
    (p.x - approach.start.x) * sideX + (p.z - approach.start.z) * sideZ;

  if (!state.placed.left || !state.placed.right) {
    // Plan build: the entry pair comes from the physical feet (the only
    // physical read footholds ever take); every later plant is plan geometry.
    state.foothold.left = { ...leftToeW };
    state.foothold.right = { ...rightToeW };
    state.sideHome.left = sideCoord(leftToeW);
    state.sideHome.right = sideCoord(rightToeW);
    state.placed.left = true;
    state.placed.right = true;
    state.stance = scheduled;
  } else if (scheduled !== state.stance) {
    // Schedule handover, immediate, plan-built: the planting foot lands one
    // plan step ahead of the other foothold on its own home side. No
    // physical re-snap (landing error used to bake into the next foothold),
    // no dwell, no hysteresis: the handover fires exactly at the schedule's
    // plant boundary whatever the lock says.
    const other: FootBaseSide = scheduled === "left" ? "right" : "left";
    const otherAlong = (state.foothold[other].x - approach.start.x) * unitX
      + (state.foothold[other].z - approach.start.z) * unitZ;
    // First-handover guard (handover slice): provisional grid plant, seeded
    // from the actual touchdown at band entry; the next plant re-anchors.
    const plantAlong = noteFirstHandoverPlant({ state, scheduled, plantAlong: otherAlong + halfTravel });
    state.foothold[scheduled] = {
      x: approach.start.x + unitX * plantAlong + sideX * state.sideHome[scheduled],
      y: floorY,
      z: approach.start.z + unitZ * plantAlong + sideZ * state.sideHome[scheduled],
    };
    state.stance = scheduled;
  }

  // Roles derive from post-handover state. The crown (most-recent plant)
  // names the summary stance; the PIN SET is every foot inside its own
  // contact interval — in double support both feet pin, each to its own
  // foothold. The empty set (absent from the shipped clip) falls back to the
  // crown so one foot always stays grounded.
  const stance: FootBaseSide = state.stance;
  const swing: FootBaseSide = stance === "left" ? "right" : "left";
  const leftIn = footBaseRelPhase("left", phase01) < FOOT_BASE_STANCE_FRACTION.left;
  const rightIn = footBaseRelPhase("right", phase01) < FOOT_BASE_STANCE_FRACTION.right;
  const scheduledPin: FootBaseSide[] =
    leftIn || rightIn
      ? (["left", "right"] as const).filter((side) => (side === "left" ? leftIn : rightIn))
      : [stance];
  // BAND-HOLD (footbase-6): a foot past its schedule lift stays pinned
  // while its last solved toe sits inside the contact band, so the first
  // swing motion happens out of band and no window spans liftoff motion.
  const held = footBaseBandHoldSides({
    phase01,
    lastToeY: state.lastToeY,
    floorY,
    bandM: splitStanceHoldBandM(approach.contactBandMeters, steps),
  })
    .filter((side) => !scheduledPin.includes(side))
    // Knee-budget hold exemption (see `prevClamped`): a foot the budget
    // held low last substep is flying, not rolling — pinning it would both
    // freeze budgeted motion and drag the stance pin off its foothold.
    .filter((side) => !state.prevClamped[side]);
  const pinned: FootBaseSide[] = [...scheduledPin, ...held];
  const ordered: FootBaseSide[] = [
    ...pinned.filter((side) => side === stance),
    ...pinned.filter((side) => side !== stance),
    ...((["left", "right"] as const).filter((side) => !pinned.includes(side))),
  ];
  const swingRow = rowNow(swing);

  const stanceFoothold = state.foothold[stance];
  // The slot advance follows the entry-anchored foothold polyline
  // (bodyTravelM above); the pin below is then a mm correction.
  slot.position.x = approach.start.x + unitX * bodyTravelM;
  slot.position.z = approach.start.z + unitZ * bodyTravelM;
  slot.updateMatrixWorld(true);

  // Absolute targets, rebuilt per the rows' documented contract (footbase-5).
  // Heights are plant-relative ("toe Y minus this stance's plant toe Y"), so
  // the absolute target is floorY + the plant-toe datum + the stride-scaled
  // excursion: reading heightM raw above the floor buried stance ~5 cm deep
  // and arced the swing at full cruise height, both outside the short-stride
  // reachable envelope (analytic hinge = straightest reaching shape).
  // Fore-aft, along01 is the documented liftoff-to-touchdown fraction (0 at
  // liftoff, 1 at touchdown), so the swing runs from the foot's own liftoff
  // foothold to its touchdown plant by swing-phase progress — never as
  // (along01 x 2 - 1) about the stance foothold, which both jumped ~9 cm at
  // liftoff when consecutive halves travel differently and replayed the
  // cruise toe-off drag 0.6 m behind the hip (unreachable: leg 0.735 m).
  // Touchdown uses the half travel of the half containing the plant (exact
  // coincidence with the handover plant even when the half index advances
  // mid-swing), so touchdown and handover still coincide with no snap.
  const pinTargetFor = (side: FootBaseSide): { x: number; y: number; z: number } => ({
    x: state.foothold[side].x,
    y: floorY + rigDatum(side) + rigScaledHeight(rowNow(side).heightM),
    z: state.foothold[side].z,
  });
  const stanceAlong = (stanceFoothold.x - approach.start.x) * unitX
    + (stanceFoothold.z - approach.start.z) * unitZ;
  const swingRel = footBaseRelPhase(swing, phase01);
  const swingLiftRel = FOOT_BASE_STANCE_FRACTION[swing];
  // Swing-phase progress with zero end velocities (raised-cosine ease,
  // footbase-5): the foot rolls off the toe at liftoff and settles onto the
  // heel at touchdown instead of launching/stomping at full segment speed (a
  // linear sweep moves ~7 cm on its first frame, which reads as a kick and
  // trips the slide meter's stance-window boundary). Endpoints are exact
  // either way: liftoff continuity and touchdown/handover coincidence hold.
  // (Footbase-6 tried progress off the row's own along01, which carries the
  // clip's toe-off dwell — but the clip fraction spans the cruise stride
  // while ours spans the truncated short-stride segment: row-timed exit left
  // L 0.26 m behind R (arrival 0.137 m off ref vs 0.059 m on the ease). The
  // ease stays.)
  const swingLinear = Math.min(Math.max((swingRel - swingLiftRel) / (1 - swingLiftRel), 0), 1);
  const swingProgress = 0.5 - 0.5 * Math.cos(Math.PI * swingLinear);
  const liftoffAlong = (state.foothold[swing].x - approach.start.x) * unitX
    + (state.foothold[swing].z - approach.start.z) * unitZ;
  // Touchdown uses the symmetric half travel from the stance foothold (exact
  // coincidence with the handover plant, which is the same foothold plus the
  // same half travel), so touchdown and handover still coincide with no snap.
  const touchdownAlong = stanceAlong + halfTravel;
  // FOOTBASE-6 (with the phase-target exit): the final swing's touchdown
  // half lies past the planned walk, so the raw projection aims at a ghost
  // plant past the route end (L toe 0.32 m past target at exit). Footholds
  // never pass the route end; neither does the swing target. Only the final
  // half reaches this cap, so mid-walk swings are byte-identical.
  const swingTouchdownAlong = Math.min(touchdownAlong, routeLength);
  const swingAlong = liftoffAlong + swingProgress * (swingTouchdownAlong - liftoffAlong);
  const swingTarget = {
    x: approach.start.x + unitX * swingAlong
      + sideX * (state.sideHome[swing] + rigScaledLateral(swingRow.lateralM)),
    y: floorY + rigDatum(swing) + rigScaledHeight(swingRow.heightM),
    z: approach.start.z + unitZ * swingAlong
      + sideZ * (state.sideHome[swing] + rigScaledLateral(swingRow.lateralM)),
  };

  const sub = (approach.execution as { walkSimSubsteps?: number | null }).walkSimSubsteps ?? -1;
  let stanceMissM: number | null = null;
  let swingMissM: number | null = null;
  // Knee-budget hold exemption resets here (it is read above, before the
  // loop, so last substep's values are consumed before this overwrite).
  state.prevClamped = { left: false, right: false };
  const yawNow = slot.rotation.y;
  const poleWorld = { x: Math.sin(yawNow), y: 0, z: Math.cos(yawNow) };

  // Solve pass: every leg is solved from the same slot position (the body
  // advance just SET above), so no leg's pin perturbs another leg's solve.
  // Pins apply afterwards in miss order (below): the recorded toe of the
  // last-pinned foot is exact and every other foot is off by that last
  // correction, so pinning smallest-miss-last minimises the residual.
  const pinQueue: Array<{ side: FootBaseSide; missM: number }> = [];
  for (const side of ordered) {
    const chain = findSteppingLegChain(slot, side);
    if (chain === null) continue;
    // Fresh offset EVERY substep from the mixer-posed leg (pre-solve): the
    // mixer overwrites local rotations each substep regardless of our
    // writes, so this read is exogenous clip truth — no feedback loop is
    // possible (contrast the stepping-turn warning, which re-read from the
    // solved leg). A once-captured entry offset goes stale as the ankle
    // articulates through the walk and was measured injecting ~15 cm swing
    // errors at handovers; the frozen-foot workaround for it levers the toe
    // on heel rotation by a similar amount. (A solve-twice re-read was
    // tried: the second pass does not converge the 3-5 cm swing miss, so it
    // was removed — one solve, miss from that solve.)
    const ends = heelWorldNow(chain);
    const captured = {
      offset: {
        x: ends.toe.x - ends.heel.x,
        y: ends.toe.y - ends.heel.y,
        z: ends.toe.z - ends.heel.z,
      },
      yaw: yawNow,
    };
    state.offsetEntry[side] = captured;
    const isPin = pinned.includes(side);
    let toeTarget = isPin ? pinTargetFor(side) : swingTarget;
    if (!isPin) {
      // SWING-KNEE BUDGET: cap this substep's swing flexion at K_max(v);
      // stance legs and pinned feet are never touched.
      const budgeted = budgetSwingTarget({
        chain,
        toeTargetWorld: toeTarget,
        slotYawRadians: yawNow,
        offsetEntry: captured.offset,
        offsetYawRadians: captured.yaw,
        floorY,
        heightDatumM: rigDatum(side),
        walkSpeedMpsRaw: (approach as { walkSpeedMetersPerSecond?: unknown }).walkSpeedMetersPerSecond,
        prevRecord: state.kneeBudget,
      });
      toeTarget = budgeted.target;
      state.kneeBudget = budgeted.record;
      if (budgeted.clamped) state.prevClamped[side] = true;
    }
    const heelTarget = heelTargetForToeTargetStable({
      toeTargetWorld: toeTarget,
      slotYawRadians: yawNow,
      offsetEntry: captured.offset,
      offsetYawRadians: captured.yaw,
    });
    const solved = solveSteppingLegHinge({
      chain,
      heelTargetWorld: heelTarget,
      poleWorld,
      midRestQuats: null,
      previousBendNormal: state.hingeNormal[side],
    });
    if (solved.bendNormal !== null) state.hingeNormal[side] = solved.bendNormal;
    if (isPin) {
      if (side === stance) stanceMissM = solved.missM;
      pinQueue.push({ side, missM: solved.missM });
    } else {
      swingMissM = solved.missM;
    }
    const worst = state.worst;
    if (worst === null || solved.missM > worst.missM) {
      state.worst = { missM: solved.missM, side, sub };
    }
  }
  // PIN PASS (step-asym slice): pin in descending miss order (biggest
  // correction first, smallest last). Sequential exact-pins on one rigid slot
  // leave every earlier pin off by the last correction; the last-pinned foot
  // is exact and the rest carry that last correction as residual. Pinning
  // smallest-miss-last makes the residual the smallest solve miss instead of
  // whichever foot the role order happened to put last (a band-held co-stance
  // foot fighting the mixer's swing pose, or a fresh landing, can carry a cm
  // miss while the settled foot's is mm). Single support is one pin either
  // way; all-single-miss ties keep role order (stable sort).
  // Split-stance pins live in `./foot-base-split-stance-mod.js` (2-half only);
  // the whole post-solve pin-phase tail (pin pass, first-plant seed,
  // band-hold signal, TEMP tap record) lives there too, to hold this file's
  // 500-line zone budget. Order inside is unchanged.
  finishSplitStancePin({
    slot, state, approach, pinQueue, steps,
    pinTargetFor, sub, scheduled, stance, pinned, swingMissM,
    unitX, unitZ, floorY,
  });
  slot.updateMatrixWorld(true);
  return { stanceFoot: stance, phase01, halfIndex, stanceMissM, swingMissM };
}
