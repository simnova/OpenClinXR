/**
 * Deterministic solver for the lower-teeth forward gap (MADR 0060 solver half).
 *
 * Mechanism (a): per-target teeth morph scales k_v in [0, 1.5], keyed by mesh
 * target name and applied by the runtime's own prepared path through the
 * internal teeth-scale table (no export change, identity by default).
 * Coordinate descent over a fixed token order and fixed grids — no randomness.
 * viseme_PP is never scaled (closure invariant). DD/nn/sil are not teeth
 * targets so they carry no lever; I/U have no cues in this track.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createActorAudioRuntime } from "@openclinxr/xr-dialogue/actor-audio-runtime";
import { evaluate, type EvaluatorTrack } from "./mouth-evaluator.js";
import type { EvaluateParams, EvaluatorOutput } from "./solver-types.js";

export const TARGET_GAP_MM = 3.75;
export const SOLVER_ID = "mouth-solver-coordinate-descent-v1";
export const SOLVER_VERSION = "1";
/** Fixed search order (mesh target names); viseme_PP excluded, closure invariant. */
export const SEARCH_TOKENS = ["viseme_aa", "viseme_E", "viseme_O", "viseme_FF"] as const;
export const SCALE_MIN = 0;
export const SCALE_MAX = 1.5;
export const UPPER_EPS_MM = 1e-9;

/**
 * Evaluate through the runtime with teeth scales set on the shared internal
 * table. The table is module-global, so the evaluator's own runtime instance
 * sees it; reset in finally so sequential runs never leak scales.
 */
export async function evaluateWithTeethScales(
  glbPath: string,
  track: EvaluatorTrack,
  scales: Record<string, number>,
  extra: EvaluateParams = {},
): Promise<Awaited<ReturnType<typeof evaluate>>> {
  const runtime = createActorAudioRuntime({
    developmentFixture: true,
    fixtureSearch: "?openclinxrSpeakFixture=1",
  });
  runtime.diagnostics.setTeethVisemeScales(scales);
  try {
    return await evaluate(glbPath, track, extra);
  } finally {
    runtime.diagnostics.resetTeethVisemeScales();
  }
}

export type GapObjective = {
  feasible: boolean;
  rms: number;
  max: number;
  minGapMm: number;
  penetrationFrames: number;
  verticalRangeMm: [number, number];
  smoothnessMm: number;
  ppGapDeltaMm: number;
};

export type ObjectiveBaseline = {
  upperByViseme: Record<string, number>;
  ppGaps: number[];
};

/** Lexicographic objective: min RMS to the target, tie-break min max. Constraints veto. */
export function scoreOutput(output: EvaluatorOutput, baseline: ObjectiveBaseline): GapObjective {
  const gaps = output.records.map((record) => record.forwardGapHeadLocalMm);
  const devs = gaps.map((gap) => gap - TARGET_GAP_MM);
  const rms = Math.sqrt(devs.reduce((sum, dev) => sum + dev * dev, 0) / devs.length);
  const max = Math.max(...devs.map(Math.abs));
  const minGapMm = Math.min(...gaps);
  const penetrationFrames = output.summary.penetrationFrames;
  const verts = output.records.map((record) => record.verticalGapHeadLocalMm);
  const steps = output.records
    .slice(1)
    .map(
      (record, i) => Math.abs(record.forwardGapHeadLocalMm - (output.records[i]?.forwardGapHeadLocalMm ?? 0)),
    );
  const solvedUpper = output.summary.upperDisplacementByVisemeMaxHeadLocalMm;
  const upperOk = Object.entries(solvedUpper).every(
    ([viseme, value]) => value <= (baseline.upperByViseme[viseme] ?? 0) + UPPER_EPS_MM,
  );
  const solvedPp = output.records
    .filter((record) => record.viseme?.toLowerCase() === "viseme_pp")
    .map((record) => record.forwardGapHeadLocalMm);
  const ppGapDeltaMm =
    solvedPp.length === 0 || baseline.ppGaps.length === 0
      ? NaN
      : Math.max(...solvedPp.map((gap, i) => Math.abs(gap - (baseline.ppGaps[i] ?? gap))));
  return {
    feasible: penetrationFrames === 0 && minGapMm > 0 && upperOk,
    rms,
    max,
    minGapMm,
    penetrationFrames,
    verticalRangeMm: [Math.min(...verts), Math.max(...verts)],
    smoothnessMm: steps.length === 0 ? 0 : Math.max(...steps),
    ppGapDeltaMm,
  };
}

export function baselineOf(output: EvaluatorOutput): ObjectiveBaseline {
  return {
    upperByViseme: output.summary.upperDisplacementByVisemeMaxHeadLocalMm,
    ppGaps: output.records
      .filter((record) => record.viseme?.toLowerCase() === "viseme_pp")
      .map((record) => record.forwardGapHeadLocalMm),
  };
}

export type SearchSchedule = {
  order: readonly string[];
  coarseStep: number;
  fineRadius: number;
  fineStep: number;
};

export const DEFAULT_SCHEDULE: SearchSchedule = {
  order: SEARCH_TOKENS,
  coarseStep: 0.1,
  fineRadius: 0.15,
  fineStep: 0.025,
};

function coarseGrid(step: number): number[] {
  const points: number[] = [];
  for (let k = SCALE_MIN; k <= SCALE_MAX + 1e-12; k += step) {
    points.push(Math.round(Math.min(SCALE_MAX, k) * 1e12) / 1e12);
  }
  return [...new Set(points)];
}

export type SearchResult = {
  scales: Record<string, number>;
  evalCount: number;
  output: EvaluatorOutput;
  objective: GapObjective;
};

/**
 * Coordinate descent: cycle the fixed token order, exhaustive line search on
 * the fixed grids, keep the lexicographically best feasible point. One coarse
 * sweep, then one fine sweep around the coarse best. Fully deterministic:
 * fixed order, fixed grids, no randomness.
 */
export async function searchTeethScales(
  glbPath: string,
  track: EvaluatorTrack,
  baseline: ObjectiveBaseline,
  schedule: SearchSchedule = DEFAULT_SCHEDULE,
  onStep?: (info: { token: string; k: number; rms: number; feasible: boolean }) => void,
): Promise<SearchResult> {
  const scales: Record<string, number> = {};
  let evalCount = 0;
  const run = async (candidate: Record<string, number>): Promise<SearchResult> => {
    evalCount += 1;
    const { output } = await evaluateWithTeethScales(glbPath, track, candidate);
    return { scales: { ...candidate }, evalCount, output, objective: scoreOutput(output, baseline) };
  };
  let best = await run({});
  const better = (next: GapObjective, current: GapObjective): boolean => {
    if (next.feasible && !current.feasible) return true;
    if (!next.feasible || !current.feasible) return false;
    if (next.rms < current.rms - 1e-9) return true;
    if (current.rms < next.rms - 1e-9) return false;
    return next.max < current.max;
  };
  const sweep = async (pointsFor: (token: string) => number[]): Promise<void> => {
    for (const token of schedule.order) {
      for (const k of pointsFor(token)) {
        const result = await run({ ...scales, [token]: k });
        onStep?.({ token, k, rms: result.objective.rms, feasible: result.objective.feasible });
        if (better(result.objective, best.objective)) {
          best = result;
          scales[token] = k;
        }
      }
    }
  };
  await sweep(() => coarseGrid(schedule.coarseStep));
  await sweep((token) => {
    const center = scales[token] ?? 1;
    const points: number[] = [];
    for (let k = center - schedule.fineRadius; k <= center + schedule.fineRadius + 1e-12; k += schedule.fineStep) {
      points.push(Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, k)) * 1e12) / 1e12);
    }
    return [...new Set(points)];
  });
  return { ...best, evalCount };
}

export function trackSha256(trackPath: string): string {
  return createHash("sha256").update(readFileSync(trackPath)).digest("hex");
}
