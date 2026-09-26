import { readFile } from "node:fs/promises";

/**
 * Walk-quality metrics over a foot-plant-video.json capture.
 *
 * Five metrics, each with the exact definition the operator graded by:
 *  - groundSpeedMps: toe-midpoint straight displacement / walking time (whole-phase average).
 *  - steadyStateGroundSpeedMps: median of consecutive-frame instantaneous speeds (see below).
 *  - lurch: toe-midpoint path length / straight displacement.
 *  - medianHoldSlideMeters: median holdSlideMeters over windows with pinnedFrames > 0.
 *  - cadencePerMinute: stanceFoot changes between CONSECUTIVE stance windows, per minute of
 *    walking time.
 *
 * MEASURED 2026-09-25, and CORRECTED the same day: the "0.5 s startup transient" reported first is
 * not a runtime dynamic at all — it is `foot-plant-video-capture.ts`'s OWN "sample-growth probe", a
 * deliberate `page.clock.fastForward(500)` run once, before real recording begins, purely to prove
 * the fake clock still produces runtime frames. The runtime's evidence buffer accumulates samples
 * continuously regardless of which harness code advanced the clock, so those probe-produced samples
 * land as `frames[0]`/`frames[1]` in the JSON this file reads: on the physician's own capture,
 * `frames[0].tMs` to `frames[1].tMs` is exactly 500 ms, `frames[1]` to `frames[2]` is 0 ms (a
 * duplicate landing right after), and from `frames[2]` onward every gap is a normal ~33 ms video
 * frame. `groundSpeedMps` used to divide straight-line displacement by the WHOLE walking phase's
 * elapsed time, including that 500 ms in which the recorded toe-midpoint moved only 0.068 m
 * (0.137 m/s) — averaged against the following ~0.8 s of frames that hold EXACTLY the prescribed
 * target (1.374 m/s on the physician, to 4 significant figures, every single frame), the probe's one
 * artifact-laden gap alone produced the reported 0.852 m/s, a false "62% shortfall". It was never a
 * runtime startup ramp.
 *
 * `findSteadyWindowStart` below excludes exactly this: it finds the walking phase's own normal
 * frame-to-frame interval (the MEDIAN of all positive frame-to-frame gaps — robust to one outsized
 * gap among many normal ones) and trims LEADING frames whose gap to the next frame is non-positive
 * (a duplicate landing) or more than `PROBE_GAP_MULTIPLIER`x that normal interval (a harness-forced
 * jump, not a rendered frame), stopping at the first normal-paced consecutive pair. `groundSpeedMps`,
 * `pathMeters`, `straightMeters` and `lurch` are computed over the TRIMMED window; `walkingFrames`,
 * `walkingSeconds` and `cadencePerMinute` are not — they describe the full phase-tagged span, which
 * is the correct denominator for a stance-window alternation count the probe's extra samples do not
 * distort. `excludedLeadingFrames` in the result says how many frames this run trimmed (0 on a
 * capture the probe never touched — the trim only engages when the gap pattern demands it).
 * `steadyStateGroundSpeedMps` (below) already tolerated the artifact by construction (a median over
 * ~25 per-frame speeds is not moved by one bad entry) and is kept, unreplaced, beside the now-
 * corrected `groundSpeedMps` — the two should read close together now; a persistent gap between them
 * on a future capture would mean a REAL transient, not this one.
 *
 * MEASURED 2026-09-25, cadence read 0 on every actor after a leg-length-scaled walk speed (see
 * `locomotion-clip-playback-mod.ts`'s Froude rule) shortened the walking phase to roughly
 * 1.3-1.5 s at 30 fps: a captured nurse run produced exactly 3 stance windows,
 * `[right pinnedFrames=0, left pinnedFrames=3, right pinnedFrames=0]`. The PREVIOUS rule required
 * `pinnedFrames >= 3` before a window could count toward a step, which qualified only the middle
 * window here — and the alternation loop needs TWO qualified windows to register even one step, so
 * cadence read 0 while the capture's own foot track shows two genuine alternations (right to left,
 * left to right).
 *
 * `pinnedFrames` answers a DIFFERENT question than "did a stance happen": it counts how many
 * frames the stance LOCK actively corrected that foot, which `medianHoldSlideMeters` needs (a
 * window with nothing to correct is not evidence of hold quality). Whether a stance happened at
 * all is already decided by the window's EXISTENCE — the underlying track only opens a new window
 * when a foot enters the floor-contact band, alternates the label by which foot that is, and
 * closes it on release (see the producer this file's `QualityInput.stanceWindows` is built from).
 * A window with `pinnedFrames: 0` still means the lock detected and held that foot in contact for
 * its recorded span; it simply needed no corrective nudge that time. Requiring a pin count before
 * counting the alternation therefore discarded real footfalls, and did so more often as the walk
 * got faster and each stance window shortened. Cadence now counts every recorded stance-window
 * alternation, unfiltered — on the nurse run above: 2 alternations in 1.32 s = 90.9 steps/min, a
 * plausible adult cadence recovered from data that was already there.
 *
 * claimScope: walking-phase runtime toe and slot positions in foot-plant-video.json.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance.
 */

export const SPEED_FRACTION = 0.75;
export const LURCH_MAX = 1.4;
export const HOLD_SLIDE_MAX_METERS = 0.02;
export const CADENCE_MIN_PER_MINUTE = 90;
export const CADENCE_MAX_PER_MINUTE = 125;

type Vec = { x: number; y: number; z: number };

export type QualityInput = {
  frames: Array<{
    tMs: number;
    phase: string;
    left: Vec | null;
    right: Vec | null;
  }>;
  stanceWindows: Array<{ foot: string; pinnedFrames: number; holdSlideMeters: number }>;
  walkDiagnostics?: {
    executorPrescribedMps?: number | null;
    clipStanceAdvanceMetersPerSecond?: number | null;
  } | null;
};

export type WalkQuality = {
  walkingFrames: number;
  walkingSeconds: number;
  /** Leading frames trimmed before computing the displacement metrics — see the file header. */
  excludedLeadingFrames: number;
  straightMeters: number;
  pathMeters: number;
  groundSpeedMps: number;
  /** Median consecutive-frame instantaneous speed — see the file header. Not a pass/fail field. */
  steadyStateGroundSpeedMps: number;
  prescribedMps: number | null;
  speedTargetMps: number | null;
  speedPass: boolean;
  lurch: number;
  lurchPass: boolean;
  medianHoldSlideMeters: number;
  holdPass: boolean;
  cadencePerMinute: number;
  cadenceSteps: number;
  cadencePass: boolean;
  allPass: boolean;
};

function toeMid(frame: { left: Vec; right: Vec }): { x: number; z: number } {
  return { x: (frame.left.x + frame.right.x) / 2, z: (frame.left.z + frame.right.z) / 2 };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A gap this many times the phase's own normal frame interval is a harness jump, not a frame. */
export const PROBE_GAP_MULTIPLIER = 3;

/**
 * The index into `walking` where normal, video-frame-paced samples begin — see the file header.
 * Walks forward from 0, dropping a leading frame whenever its gap to the NEXT frame is non-positive
 * (a duplicate landing) or exceeds `PROBE_GAP_MULTIPLIER` times the phase's own median positive gap,
 * and stops at the first normal-paced pair. Returns 0 (no trim) when there are too few frames to
 * find a stable interval, or the phase already carries no anomalous leading gap.
 */
export function findSteadyWindowStart(walking: ReadonlyArray<{ tMs: number }>): number {
  if (walking.length < 3) return 0;
  const positiveGaps: number[] = [];
  for (let i = 1; i < walking.length; i += 1) {
    const gap = walking[i]!.tMs - walking[i - 1]!.tMs;
    if (gap > 0) positiveGaps.push(gap);
  }
  if (positiveGaps.length === 0) return 0;
  const normalGapMs = median(positiveGaps);
  let start = 0;
  while (start + 1 < walking.length) {
    const gap = walking[start + 1]!.tMs - walking[start]!.tMs;
    if (gap > 0 && gap <= normalGapMs * PROBE_GAP_MULTIPLIER) break;
    start += 1;
  }
  return start;
}

export function computeWalkQuality(input: QualityInput): WalkQuality {
  const walking = input.frames.filter(
    (f) => f.phase === "walking" && f.left !== null && f.right !== null,
  ) as Array<{ tMs: number; phase: string; left: Vec; right: Vec }>;
  // Full phase span — cadence's own denominator, deliberately NOT trimmed (see file header).
  const walkingSeconds =
    walking.length >= 2 ? (walking[walking.length - 1]!.tMs - walking[0]!.tMs) / 1000 : 0;
  // Trimmed span for the toe-midpoint displacement metrics — see `findSteadyWindowStart`.
  const excludedLeadingFrames = findSteadyWindowStart(walking);
  const steady = walking.slice(excludedLeadingFrames);
  const mids = steady.map(toeMid);
  let pathMeters = 0;
  for (let i = 1; i < mids.length; i += 1) {
    pathMeters += Math.hypot(mids[i]!.x - mids[i - 1]!.x, mids[i]!.z - mids[i - 1]!.z);
  }
  const straightMeters =
    mids.length >= 2
      ? Math.hypot(
          mids[mids.length - 1]!.x - mids[0]!.x,
          mids[mids.length - 1]!.z - mids[0]!.z,
        )
      : 0;
  const steadyWindowSeconds =
    steady.length >= 2 ? (steady[steady.length - 1]!.tMs - steady[0]!.tMs) / 1000 : 0;
  const groundSpeedMps = steadyWindowSeconds > 0 ? straightMeters / steadyWindowSeconds : 0;
  const frameSpeeds: number[] = [];
  for (let i = 1; i < steady.length; i += 1) {
    const dtSeconds = (steady[i]!.tMs - steady[i - 1]!.tMs) / 1000;
    if (dtSeconds <= 0) continue;
    const a = mids[i - 1]!;
    const b = mids[i]!;
    frameSpeeds.push(Math.hypot(b.x - a.x, b.z - a.z) / dtSeconds);
  }
  const steadyStateGroundSpeedMps = median(frameSpeeds);
  const lurch = straightMeters > 0 ? pathMeters / straightMeters : 0;
  const prescribedMps =
    input.walkDiagnostics?.executorPrescribedMps
    ?? input.walkDiagnostics?.clipStanceAdvanceMetersPerSecond
    ?? null;
  const speedTargetMps = prescribedMps !== null ? SPEED_FRACTION * prescribedMps : null;
  const holds = input.stanceWindows
    .filter((w) => w.pinnedFrames > 0)
    .map((w) => w.holdSlideMeters);
  let steps = 0;
  for (let i = 1; i < input.stanceWindows.length; i += 1) {
    if (input.stanceWindows[i]!.foot !== input.stanceWindows[i - 1]!.foot) steps += 1;
  }
  const cadencePerMinute = walkingSeconds > 0 ? (steps / walkingSeconds) * 60 : 0;
  const speedPass = speedTargetMps !== null && groundSpeedMps >= speedTargetMps;
  const lurchPass = straightMeters > 0 && lurch <= LURCH_MAX;
  const holdPass = holds.length > 0 && median(holds) <= HOLD_SLIDE_MAX_METERS;
  const cadencePass =
    cadencePerMinute >= CADENCE_MIN_PER_MINUTE && cadencePerMinute <= CADENCE_MAX_PER_MINUTE;
  return {
    walkingFrames: walking.length,
    walkingSeconds,
    excludedLeadingFrames,
    straightMeters,
    pathMeters,
    groundSpeedMps,
    steadyStateGroundSpeedMps,
    prescribedMps,
    speedTargetMps,
    speedPass,
    lurch,
    lurchPass,
    medianHoldSlideMeters: median(holds),
    holdPass,
    cadencePerMinute,
    cadenceSteps: steps,
    cadencePass,
    allPass: speedPass && lurchPass && holdPass && cadencePass,
  };
}

function printReport(quality: WalkQuality): void {
  const line = (name: string, value: string, pass: boolean): void => {
    process.stdout.write(`${pass ? "PASS" : "FAIL"} ${name}: ${value}\n`);
  };
  line(
    "groundSpeedMps",
    `${quality.groundSpeedMps.toFixed(3)} (target >= ${quality.speedTargetMps?.toFixed(3) ?? "unknown"}; ${quality.excludedLeadingFrames} leading frame(s) excluded as a capture-probe artifact)`,
    quality.speedPass,
  );
  process.stdout.write(
    `INFO steadyStateGroundSpeedMps: ${quality.steadyStateGroundSpeedMps.toFixed(3)} (median consecutive-frame speed, not a pass/fail field; prescribed ${quality.prescribedMps?.toFixed(3) ?? "unknown"})\n`,
  );
  line("lurch", `${quality.lurch.toFixed(3)} (target <= ${LURCH_MAX})`, quality.lurchPass);
  line(
    "medianHoldSlideMeters",
    `${quality.medianHoldSlideMeters.toFixed(4)} (target <= ${HOLD_SLIDE_MAX_METERS})`,
    quality.holdPass,
  );
  line(
    "cadencePerMinute",
    `${quality.cadencePerMinute.toFixed(1)} from ${quality.cadenceSteps} steps in ${quality.walkingSeconds.toFixed(2)} s (target ${CADENCE_MIN_PER_MINUTE}-${CADENCE_MAX_PER_MINUTE})`,
    quality.cadencePass,
  );
  process.stdout.write(`prescribedMps: ${quality.prescribedMps?.toFixed(3) ?? "missing"}\n`);
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("walk-quality-metrics.ts");

if (invokedAsScript) {
  const inputPath = process.argv[2] ?? "";
  if (!inputPath) {
    process.stderr.write("usage: walk-quality-metrics.ts <foot-plant-video.json>\n");
    process.exit(2);
  }
  const raw = JSON.parse(await readFile(inputPath, "utf8")) as QualityInput;
  const quality = computeWalkQuality(raw);
  printReport(quality);
  process.exit(quality.allPass ? 0 : 1);
}
