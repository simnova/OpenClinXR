/**
 * Footstep-plan phase exit (split 2026-10-13, stop-any-route budget split).
 *
 * Moved whole out of `walk-exit-window.ts` under that file's 500-line zone
 * budget (behaviour and comments unchanged, only the module boundary moved).
 * Internal to xr-runtime-state: imported by bedside-approach-execution-mod.ts,
 * never re-exported, so the package's public surface is unchanged. Holds the
 * k-th-passing phase exit plus, from the stop-any-route slice, the passing
 * count, the late two-half correction, the loud safety bound, and the
 * per-passing residual log state (M3/M4/M5).
 */

import type { BedsideApproachExecution } from "./bedside-approach-execution-mod.js";
import { endFootOf, halfDurationS, passingTimeU, stepFootstepToeCrossing } from "./footstep-crossing-exit-mod.js";

/**
 * Footstep-plan S2c M2 exit input. All numbers cross from the frame module
 * (which owns the clip constants and the action read); this module holds no
 * clip data of its own, mirroring contactAtClipTime's no-import discipline
 * (xr-humanoid-animation depends on this package, so the constants cannot be
 * imported here).
 */
export type FootstepPhaseExit = {
  /** Whole half-cycles the plan covers (k). */
  steps: number;
  /** L passing the walk starts at (clip seconds). */
  startPhaseS: number;
  /** R passing (clip seconds, same cycle as the start). */
  rPassingS: number;
  /** Clip cycle (seconds). */
  cycleS: number;
  /** Walk action's current clip time, in seconds (1 substep stale, as read). */
  clipTimeS: number;
  /** Per-foot affine travel coefficients (M1): R-ending half slope. Absent = legacy M2 exit. */
  aEndR?: number;
  /** Per-foot affine travel coefficients (M1): R-ending half intercept. */
  bEndR?: number;
  /** Per-foot affine travel coefficients (M1): L-ending half slope. */
  aEndL?: number;
  /** Per-foot affine travel coefficients (M1): L-ending half intercept. */
  bEndL?: number;
  /** Uniform scale seeding every half (M2 plan scale, updated on correction). */
  planScale?: number;
  /** Unit-sim channel only (G6 off-leg): skip the late correction, keep logging. Never set at runtime. */
  skipLateCorrection?: boolean;
  /** M2: frame-side R-L toe-separation sign flip this substep (route axis). Absent = no toe data. */
  toeCrossed?: boolean;
  /** M2 G4 probe: substeps to hold the exit after a recorded crossing. Absent = 0. */
  exitDelaySubsteps?: number;
};

/**
 * Unwrapped clip seconds of the k-th feet-passing after the walk start
 * (the start itself is passing zero). Passings alternate R/L every half:
 * odd k lands on R (rPassing + j x cycle), even k on L (start + j x cycle).
 * Null when the inputs cannot locate a passing (no exit, band fallback).
 */
export function footstepExitPhaseForSteps(input: {
  steps: number;
  startPhaseS: number;
  rPassingS: number;
  cycleS: number;
}): number | null {
  const { steps, startPhaseS, rPassingS, cycleS } = input;
  if (!Number.isInteger(steps) || steps < 1) return null;
  if (!(cycleS > 0) || !(rPassingS > startPhaseS) || !Number.isFinite(startPhaseS)) return null;
  const fullCycles = Math.floor(steps / 2);
  return steps % 2 === 1
    ? rPassingS + fullCycles * cycleS
    : startPhaseS + fullCycles * cycleS;
}

/**
 * One walking-substep phase test: exit when the unwrapped clip time reaches
 * the k-th passing. Wrap counting is carried in (wraps, lastClipS) across
 * calls; a null lastClipS initialises without firing (the action may read a
 * stale pre-start time on its first substep). Returns null when the exit is
 * not configured, so the caller keeps the legacy band.
 */
export function stepFootstepPhaseExit(input: {
  exit: FootstepPhaseExit;
  wraps: number;
  lastClipS: number | null;
}): { reached: boolean; wraps: number; lastClipS: number } | null {
  const { exit } = input;
  if (!Number.isFinite(exit.clipTimeS) || !(exit.cycleS > 0)) return null;
  const target = footstepExitPhaseForSteps(exit);
  if (target === null) return null;
  if (input.lastClipS === null || !Number.isFinite(input.lastClipS)) {
    return { reached: false, wraps: 0, lastClipS: exit.clipTimeS };
  }
  let wraps = input.wraps;
  // One wrap per call at most: the clip advances far less than half a cycle
  // per substep, so a backward jump past half a cycle is exactly one wrap.
  // Self-healing across calls (a missed wrap is caught on the next one).
  // No rewind ever runs while walking (the M3 rewind is settling-only).
  const lastUnwrapped = input.lastClipS + wraps * exit.cycleS;
  if (exit.clipTimeS + wraps * exit.cycleS < lastUnwrapped - exit.cycleS / 2) {
    wraps += 1;
  }
  return { reached: exit.clipTimeS + wraps * exit.cycleS >= target, wraps, lastClipS: exit.clipTimeS };
}

/**
 * Progress-only backstop for the phase exit, in walking substeps: a walk
 * that never reaches its passing (stalled clip, lost action) must still end.
 * Never steers the exit phase — the count is an order of magnitude past any
 * planned walk (SC-05 ~95, 2.0 m ~150) — it only rescues a stranded run.
 */
export const FOOTSTEP_EXIT_MAX_WAIT_SUBSTEPS = 600;

/**
 * One per-passing log entry (M5): the frame module drains these into the
 * capture record's passing log. k counts passings from the walk start
 * (1-based); r_k is remaining minus predicted travel for the halves left.
 */
export type FootstepPassingEntry = {
  k: number;
  endFoot: "L" | "R";
  scaleUsed: number;
  predictedHalfM: number;
  measuredHalfM: number;
  remainingM: number;
  residualM: number;
};

/** Late-correction request (M3): the frame module applies it to the plan state. */
export type FootstepCorrection = {
  scale: number;
  steps: number;
  recounted: boolean;
  /** True when the solve missed the range by quantization noise and was clamped (deadband). */
  clamped: boolean;
};

/**
 * Cross-step footstep runtime state (M3/M4/M5). Lives in one optional
 * `footstep` field on the execution (single-field budget rule); the
 * executor rebuilds it every armed step, the frame consumes `correct` /
 * `lastPassing` / `safetyTrip` after each step.
 */
export type FootstepPhaseState = {
  passings: number;
  lastPassingRemainingM: number;
  /** Remaining at the previous substep (interpolation datum for crossings). */
  lastStepRemainingM: number;
  recounts: number;
  correctedAtPassing: number | null;
  recountBaselineU: number | null;
  recountBaselinePassing: number;
  recountSteps: number;
  correct: FootstepCorrection | null;
  lastPassing: FootstepPassingEntry | null;
  /** M2: walking-call index of the recorded last-half toe crossing; null until one is seen. */
  crossedAtSubstep: number | null;
  safetyTrip: { reason: string; travelledM: number; boundM: number; drained?: boolean } | null;
};

/** Minimum uniform scale, mirroring the planner's S2 STOP rule (literal, no import up). */
const FOOTSTEP_MIN_SCALE = 0.7;

/**
 * Deadband around the solve range (measured fix, M3 reland): a solve that
 * misses [0.7, 1.0] by at most this much is clamped, not recounted. The
 * 1.31 m plan scale (0.7038) leaves 0.3 mm of travel margin above the
 * floor while substep/datum noise runs ~12 mm (measured: 0.70706 solved as
 * 0.697, recount cascade, arrival 0.150); recounting on quantization noise
 * destabilizes, clamping costs millimetres. Genuine misses recount as briefed.
 */
const FOOTSTEP_SOLVE_DEADBAND = 0.02;

/** Remaining distance at or below which the walk ends at the passing (stranded rescue, feet together). */
const FOOTSTEP_EXIT_NOW_REMAINING_M = 0.35;

function modelComplete(exit: FootstepPhaseExit): boolean {
  return typeof exit.aEndR === "number"
    && typeof exit.bEndR === "number"
    && typeof exit.aEndL === "number"
    && typeof exit.bEndL === "number"
    && typeof exit.planScale === "number";
}

function predictedHalfM(exit: FootstepPhaseExit, scale: number, endFoot: "L" | "R"): number {
  const a = endFoot === "R" ? exit.aEndR ?? 0 : exit.aEndL ?? 0;
  const b = endFoot === "R" ? exit.bEndR ?? 0 : exit.bEndL ?? 0;
  return a * scale + b;
}

/**
 * Late two-half correction (M3): at the antepenultimate passing, solve ONE
 * scale for the last two halves from the per-foot model against the
 * executor's measured remaining (slot projection, never a toe reading). The
 * scale applies from this passing onward, never inside a half-cycle.
 * Returns the correction, or a recount when the solved scale leaves
 * [0.7, 1.0] (re-counted from the current passing, never from the start).
 */
function solveLateCorrection(input: {
  exit: FootstepPhaseExit;
  atPassing: number;
  remainingM: number;
}): { scale: number; steps: number | null; baselineU: number | null; recounts: number; clamped: boolean } | null {
  const { exit, atPassing, remainingM } = input;
  const feet = [endFootOf(atPassing + 1), endFootOf(atPassing + 2)];
  const a1 = feet[0] === "R" ? exit.aEndR ?? 0 : exit.aEndL ?? 0;
  const b1 = feet[0] === "R" ? exit.bEndR ?? 0 : exit.bEndL ?? 0;
  const a2 = feet[1] === "R" ? exit.aEndR ?? 0 : exit.aEndL ?? 0;
  const b2 = feet[1] === "R" ? exit.bEndR ?? 0 : exit.bEndL ?? 0;
  const solved = (remainingM - b1 - b2) / (a1 + a2);
  if (solved >= FOOTSTEP_MIN_SCALE && solved <= 1) {
    return { scale: solved, steps: null, baselineU: null, recounts: 0, clamped: false };
  }
  if (solved >= FOOTSTEP_MIN_SCALE - FOOTSTEP_SOLVE_DEADBAND && solved < FOOTSTEP_MIN_SCALE) {
    return { scale: FOOTSTEP_MIN_SCALE, steps: null, baselineU: null, recounts: 0, clamped: true };
  }
  if (solved > 1 && solved <= 1 + FOOTSTEP_SOLVE_DEADBAND) {
    return { scale: 1, steps: null, baselineU: null, recounts: 0, clamped: true };
  }
  // Re-count from the current passing: smallest k' in 2..8 whose uniform
  // re-solve lands in range; k' = 1 (single closing half) next; exit-now
  // when the walk is already all but there; pathological fallback last.
  for (let recountSteps = 2; recountSteps <= 8; recountSteps += 1) {
    let slope = 0;
    let intercept = 0;
    for (let half = 1; half <= recountSteps; half += 1) {
      const foot = endFootOf(atPassing + half);
      slope += foot === "R" ? exit.aEndR ?? 0 : exit.aEndL ?? 0;
      intercept += foot === "R" ? exit.bEndR ?? 0 : exit.bEndL ?? 0;
    }
    const reSolved = (remainingM - intercept) / slope;
    if (reSolved >= FOOTSTEP_MIN_SCALE && reSolved <= 1) {
      return {
        scale: reSolved,
        steps: recountSteps,
        baselineU: passingTimeU(exit, atPassing),
        recounts: 1,
        clamped: false,
      };
    }
  }
  const firstFoot = endFootOf(atPassing + 1);
  const s1 = (remainingM - (firstFoot === "R" ? exit.bEndR ?? 0 : exit.bEndL ?? 0))
    / (firstFoot === "R" ? exit.aEndR ?? 0 : exit.aEndL ?? 0);
  if (s1 >= FOOTSTEP_MIN_SCALE && s1 <= 1) {
    return {
      scale: s1,
      steps: 1,
      baselineU: passingTimeU(exit, atPassing),
      recounts: 1,
      clamped: false,
    };
  }
  return null;
}

/**
 * One walking-substep dispatch for the S2c M2 phase exit. Armed only with a
 * footstepExit input on a walking execution; anything else reads "off" and
 * the caller keeps the legacy band. While armed ("armed") the caller must
 * skip the band (it fires 1-2 substeps early, D2 again) and persist the
 * carry into its walking continue. On the exit substep ("exited") the
 * prescription mirrors the band's (at most one frame's advance, never past
 * the route end), so arrival is the clamp-pinned spot, not a teleport.
 *
 * M3/M5: with model coefficients in the input, every passing is counted and
 * logged (r_k against the scale in force), and the antepenultimate passing
 * solves the late two-half correction. Without coefficients the legacy
 * target-only path runs byte-for-byte.
 */
export type FootstepExitDispatch =
  | { kind: "exited"; execution: BedsideApproachExecution; footstep: FootstepPhaseState | null }
  | { kind: "armed"; lastClipS: number; wraps: number; footstep: FootstepPhaseState | null }
  | { kind: "off" };

export function stepFootstepPhaseExitBand(input: {
  execution: BedsideApproachExecution;
  walkSimSubsteps: number;
  footstepExit: FootstepPhaseExit | null;
  frameAdvanceMeters: number;
  travelledMeters: number;
  remainingMeters: number;
  unit: { x: number; z: number };
  observedPositionXz: { x: number; z: number };
  nowMs: number;
  blendedHeadingRadians: number;
}): FootstepExitDispatch {
  if (input.execution.phase !== "walking" || input.footstepExit === null) return { kind: "off" };
  const exit = input.footstepExit;
  const phaseTest = stepFootstepPhaseExit({
    exit,
    wraps: input.execution.footstepWraps ?? 0,
    lastClipS: input.execution.footstepLastClipS ?? null,
  });
  if (phaseTest === null) return { kind: "off" };
  const exitHere = (footstep: FootstepPhaseState | null): FootstepExitDispatch => {
    const exitAdvanceMeters = Math.min(input.frameAdvanceMeters, Math.max(0, input.remainingMeters));
    return {
      kind: "exited",
      execution: {
        ...input.execution,
        walkSimSubsteps: input.walkSimSubsteps,
        phase: "settling",
        travelledMeters: input.travelledMeters,
        drive: { locomotion: 0 },
        headingRadians: input.blendedHeadingRadians,
        prescribedPositionXz: {
          x: input.observedPositionXz.x + input.unit.x * exitAdvanceMeters,
          z: input.observedPositionXz.z + input.unit.z * exitAdvanceMeters,
        },
        arrivedAtMs: input.nowMs,
        stoppedSeconds: 0,
        footstepLastClipS: phaseTest.lastClipS,
        footstepWraps: phaseTest.wraps,
        footstep,
      },
      footstep,
    };
  };
  // Legacy M2 path (no model coefficients): target-only exit, byte-for-byte.
  if (!modelComplete(exit)) {
    if (phaseTest.reached || input.walkSimSubsteps >= FOOTSTEP_EXIT_MAX_WAIT_SUBSTEPS) {
      return exitHere(input.execution.footstep ?? null);
    }
    return { kind: "armed", lastClipS: phaseTest.lastClipS, wraps: phaseTest.wraps, footstep: null };
  }
  const prev: FootstepPhaseState = input.execution.footstep ?? {
    passings: 0,
    lastPassingRemainingM: input.remainingMeters,
    lastStepRemainingM: input.remainingMeters,
    recounts: 0,
    correctedAtPassing: null,
    recountBaselineU: null,
    recountBaselinePassing: 0,
    recountSteps: 0,
    correct: null,
    lastPassing: null,
    safetyTrip: null,
    crossedAtSubstep: null,
  };
  const nowU = exit.clipTimeS + phaseTest.wraps * exit.cycleS;
  // The init step (no lastClipS before this one) sets the datum: remaining
  // at walk start anchors the first half's measured travel. No counting yet.
  const initialized = input.execution.footstepLastClipS !== null
    && Number.isFinite(input.execution.footstepLastClipS);
  let state: FootstepPhaseState = { ...prev, correct: null, lastPassing: null, safetyTrip: prev.safetyTrip };
  const lastU = (input.execution.footstepLastClipS ?? exit.clipTimeS) + (input.execution.footstepWraps ?? 0) * exit.cycleS;
  if (initialized) {
    // Count every passing crossed since the last substep (at most one: a
    // substep spans far less than a half-cycle) and log r_k for each.
    let crossing = state.passings + 1;
    while (passingTimeU(exit, crossing) <= nowU && passingTimeU(exit, crossing) > lastU) {
      const endFoot = endFootOf(crossing);
      const scaleInForce = exit.planScale ?? 1;
      const predicted = predictedHalfM(exit, scaleInForce, endFoot);
      // Crossing-interpolated remaining: the crossing falls inside this
      // substep's clip interval, and the whole substep's travel (up to
      // ~15 mm past the passing) would otherwise bill into the closing
      // half — enough to flip a borderline solve across the 0.7 floor
      // (measured: 12 mm flipped 0.70706 to a recount cascade). Split the
      // substep linearly at the crossing (velocity is smooth at 16 ms),
      // datumed at the substep's own start remaining.
      const crossU = passingTimeU(exit, crossing);
      const frac = nowU > lastU ? (crossU - lastU) / (nowU - lastU) : 1;
      const remainingAtCross = state.lastStepRemainingM
        + (input.remainingMeters - state.lastStepRemainingM) * frac;
      const measured = state.lastPassingRemainingM - remainingAtCross;
      const effectiveSteps = state.recountBaselineU !== null ? state.recountSteps : exit.steps;
      const base = state.recountBaselineU !== null ? state.recountBaselinePassing : 0;
      let predictedLeft = 0;
      for (let half = crossing + 1; half <= base + effectiveSteps; half += 1) {
        predictedLeft += predictedHalfM(exit, scaleInForce, endFootOf(half));
      }
      state = {
        ...state,
        passings: crossing,
        lastPassingRemainingM: remainingAtCross,
        lastPassing: {
          k: crossing,
          endFoot,
          scaleUsed: scaleInForce,
          predictedHalfM: predicted,
          measuredHalfM: measured,
          remainingM: remainingAtCross,
          residualM: remainingAtCross - predictedLeft,
        },
      };
      // Late correction at the antepenultimate passing (k - 2 >= 1, once):
      // one scale for the last two halves against measured remaining.
      const antepenultimate = base + effectiveSteps - 2;
      if (
        crossing === antepenultimate && antepenultimate >= 1
        && state.correctedAtPassing !== crossing && exit.skipLateCorrection !== true
      ) {
        const solved = solveLateCorrection({
          exit,
          atPassing: crossing,
          remainingM: remainingAtCross,
        });
        if (solved !== null) {
          const secondRecount = state.recounts >= 1 && solved.recounts > 0;
          const forwardSteps = solved.baselineU !== null && solved.steps !== null
            ? solved.steps
            : effectiveSteps;
          state = {
            ...state,
            correct: {
              scale: solved.scale,
              steps: forwardSteps,
              recounted: solved.baselineU !== null,
              clamped: solved.clamped,
            },
            correctedAtPassing: crossing,
            recounts: state.recounts + solved.recounts,
            recountBaselineU: solved.baselineU ?? state.recountBaselineU,
            recountBaselinePassing: solved.baselineU !== null ? crossing : state.recountBaselinePassing,
            recountSteps: solved.baselineU !== null ? forwardSteps : state.recountSteps,
            safetyTrip: secondRecount
              ? {
                reason: "second-recount",
                travelledM: input.travelledMeters,
                boundM: Number.NaN,
              }
              : state.safetyTrip,
          };
          // The forward residual is ~zero by construction; the logged r_k
          // keeps its pre-correction value (the measurement that drove the
          // solve: r_1 must show the error, G6).
        } else if (input.remainingMeters <= FOOTSTEP_EXIT_NOW_REMAINING_M) {
          return exitHere({ ...state, correct: null });
        } else {
          // Give-up (measured reland fix): no recount fits, so walk on to
          // the k-th passing uncorrected (feet together, arrival carries
          // the miss) and fail LOUD. The old scale-1 single-half fallback
          // overshot wildly (measured arrival 0.150 on 1.31 m); a no-op
          // keeps the single phase terminator and bounds harm by the miss
          // itself. Not a recount: recounts stay put.
          state = {
            ...state,
            correctedAtPassing: crossing,
            safetyTrip: {
              reason: "correction-gave-up",
              travelledM: input.travelledMeters,
              boundM: Number.NaN,
            },
          };
        }
      }
      crossing += 1;
      if (crossing > base + effectiveSteps + 2) break;
    }
  }
  // Exit at the k-th passing (or the recount target): phase only.
  const activeBase = state.recountBaselineU !== null ? state.recountBaselinePassing : 0;
  const activeSteps = state.recountBaselineU !== null ? state.recountSteps : exit.steps;
  let target: number | null = null;
  if (state.recountBaselineU !== null) {
    let delta = 0;
    for (let half = 1; half <= activeSteps; half += 1) {
      delta += halfDurationS(exit, endFootOf(activeBase + half));
    }
    target = state.recountBaselineU + delta;
  } else {
    target = footstepExitPhaseForSteps(exit);
  }
  // M2: exit at the toe crossing in the planned last half; the phase
  // target below is the backstop until a crossing is recorded (and the G4
  // probe holds a recorded crossing late). One terminator either way.
  const crossing = stepFootstepToeCrossing({
    toeCrossed: exit.toeCrossed === true,
    delaySubsteps: exit.exitDelaySubsteps ?? 0,
    substep: input.walkSimSubsteps,
    crossedAt: state.crossedAtSubstep,
    lastHalf: state.passings === activeBase + activeSteps - 1,
  });
  state = crossing.crossedAt === state.crossedAtSubstep
    ? state
    : { ...state, crossedAtSubstep: crossing.crossedAt };
  if (
    crossing.fire
    || ((target !== null && nowU >= target) && crossing.crossedAt === null)
    || input.walkSimSubsteps >= FOOTSTEP_EXIT_MAX_WAIT_SUBSTEPS
  ) {
    return exitHere({ ...state, correct: null });
  }
  return {
    kind: "armed",
    lastClipS: phaseTest.lastClipS,
    wraps: phaseTest.wraps,
    footstep: { ...state, lastStepRemainingM: input.remainingMeters },
  };
}
