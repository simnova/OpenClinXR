/**
 * DeterministicScenarioMotionPlanner — the zero-provider baseline planner.
 * (M1 deliverable.)
 *
 * Brief §17: the deterministic planner MUST be the zero-provider baseline; the
 * LLM planner is an optional semantic accelerator, never the default. This
 * module is that baseline: `planMotionProgram` is a pure function of its input
 * — authored touch responses and an optional placement — with no LLM, no
 * network, no randomness, and no SkeletonProfile ownership anywhere in the
 * path.
 *
 * The name says what it validates: the emitted program is passed through the
 * closed IR validator before it leaves, so a program that its own validator
 * would refuse cannot escape the planner. Determinism across calls is a
 * property of `compileScenarioMotion` (pure function + derived seed), not of
 * caching or memoisation.
 */

import { compileScenarioMotion, type ScenarioMotionCompileInput } from "./program/compile-scenario-motion.js";
import { validateMotionProgram, type MotionProgram } from "./motion-program.js";

export type { ScenarioMotionCompileInput } from "./program/compile-scenario-motion.js";

/**
 * Plan a validated semantic MotionProgram from authored scenario data.
 *
 * Throws on malformed input (unknown responseKind, unknown supportSurface,
 * region the mapper does not know) and on an internally invalid program — the
 * planner fails closed rather than emitting a plan it cannot stand behind.
 */
export function planMotionProgram(input: ScenarioMotionCompileInput): MotionProgram {
  const program = compileScenarioMotion(input);
  const verdict = validateMotionProgram(program);
  if (!verdict.ok) {
    throw new Error(`deterministic planner emitted a program its own validator refuses: ${verdict.errors.join("; ")}`);
  }
  return program;
}
