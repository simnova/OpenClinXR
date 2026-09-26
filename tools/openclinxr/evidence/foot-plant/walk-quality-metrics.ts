import { readFile } from "node:fs/promises";

/**
 * Walk-quality metrics over a foot-plant-video.json capture.
 *
 * Four metrics, each with the exact definition the operator graded by:
 *  - groundSpeedMps: toe-midpoint straight displacement / walking time.
 *  - lurch: toe-midpoint path length / straight displacement.
 *  - medianHoldSlideMeters: median holdSlideMeters over windows with pinnedFrames > 0.
 *  - cadencePerMinute: stanceFoot changes between CONSECUTIVE stance windows, per minute of
 *    walking time.
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
  straightMeters: number;
  pathMeters: number;
  groundSpeedMps: number;
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

export function computeWalkQuality(input: QualityInput): WalkQuality {
  const walking = input.frames.filter(
    (f) => f.phase === "walking" && f.left !== null && f.right !== null,
  ) as Array<{ tMs: number; phase: string; left: Vec; right: Vec }>;
  const walkingSeconds =
    walking.length >= 2 ? (walking[walking.length - 1]!.tMs - walking[0]!.tMs) / 1000 : 0;
  const mids = walking.map(toeMid);
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
  const groundSpeedMps = walkingSeconds > 0 ? straightMeters / walkingSeconds : 0;
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
    straightMeters,
    pathMeters,
    groundSpeedMps,
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
    `${quality.groundSpeedMps.toFixed(3)} (target >= ${quality.speedTargetMps?.toFixed(3) ?? "unknown"})`,
    quality.speedPass,
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
