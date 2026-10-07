/**
 * Mouth-station solver port types (MADR 0061 d2).
 *
 * Problem, solution and solver-module shapes live in the objective package so the
 * executor builds the problem, the solver solves it and the verifier re-runs it against
 * one vocabulary. Fields are additive: later cards extend, never reinterpret.
 */

/** Solver input: the unseated asset and the cue track it must satisfy. */
export type Problem = {
  /** Hex SHA-256 of the solver input bytes; the receipt echoes it. */
  inputHash: string;
  /** Cue-track identity the solution must satisfy (the step3 fixed-capture line). */
  trackId: string;
  /** Fixed evaluator clock, frames per second. */
  frameRate: number;
  /** Frames to solve. */
  frameCount: number;
};

/** Per-frame scored geometry, head-local mm; deep-comparable for the verifier re-run. */
export type SolutionFrame = {
  /** Zero-based frame index. */
  frame: number;
  /** Mean head-local 3D distance from lower shell to inner lip rim, mm. */
  rimGapHeadLocalMm: number;
  /** Lower-lip surface minus lower-teeth front shell along head-forward, mm. */
  forwardGapHeadLocalMm: number;
  /** Lower front-shell verts at or in front of the lip landmark max +Z. */
  penetratingVerts: number;
  /** Upper front-shell centroid displacement from rest, mm. */
  upperTeethDisplacementHeadLocalMm: number;
};

/** Solver output: scored frames plus the provenance the receipt records. */
export type Solution = {
  /** Solver id that produced this solution. */
  solverId: string;
  /** Solver version that produced this solution. */
  solverVersion: string;
  /** Input hash the solution answers; must equal the Problem inputHash. */
  inputHash: string;
  /** Per-frame scored geometry. */
  frames: SolutionFrame[];
};

/** Pinned solver plug-in: one constant with an id, a version and a pure solve. */
export type SolverModule = {
  /** Solver id, checked against the registry pin before solve runs. */
  id: string;
  /** Solver version, checked against the registry pin before solve runs. */
  version: string;
  /** Pure solve: problem in, solution out, no GLB needed. */
  solve: (problem: Problem) => Solution;
};
