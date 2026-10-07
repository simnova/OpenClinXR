/**
 * Mouth-station default solver: the closed-form seat behind the registry pin.
 *
 * Predicts the rest scored geometry the closed-form guarantees (rim seat plus
 * face pullback plus rest drop plus FF contact) without opening a GLB, so the
 * registry can swap alternative solvers behind the pin [MADR 0061 d1, d3].
 * Cue dynamics are runtime: every frame carries the same rest solution.
 */

import type {
  Problem,
  Solution,
  SolverModule,
} from "@openclinxr/station-mouth-objective";
import { pressGapAcceptedM } from "./closedform.js";
import {
  assertTuningForProblem,
  SOLVER_ID,
  SOLVER_VERSION,
} from "./tuning.js";

/** Pinned default solver module: id, version and pure closed-form solve. */
export const mouthClosedformSolver: SolverModule = {
  id: SOLVER_ID,
  version: SOLVER_VERSION,
  solve: (problem: Problem): Solution => {
    const tuning = assertTuningForProblem(problem.inputHash);
    if (!Number.isInteger(problem.frameCount) || problem.frameCount < 0) {
      throw new Error(`solve refused: frameCount ${String(problem.frameCount)} is not a count`);
    }
    if (!(problem.frameRate > 0)) {
      throw new Error(`solve refused: frameRate ${String(problem.frameRate)} is not positive`);
    }
    if (!pressGapAcceptedM(tuning.ffContactGapMm / 1000)) {
      throw new Error(
        `tuning file refused: ffContactGapMm ${String(tuning.ffContactGapMm)} misses the contact band`,
      );
    }
    return {
      solverId: SOLVER_ID,
      solverVersion: SOLVER_VERSION,
      inputHash: problem.inputHash,
      frames: Array.from({ length: problem.frameCount }, (_, frame) => ({
        frame,
        rimGapHeadLocalMm: tuning.honestRestGapMm,
        forwardGapHeadLocalMm: tuning.faceSafetyMm,
        penetratingVerts: 0,
        upperTeethDisplacementHeadLocalMm: 0,
      })),
    };
  },
};
