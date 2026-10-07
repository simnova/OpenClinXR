import tuningJson from "./tuning.json" with { type: "json" };

/**
 * Committed d7 tuning file shape (MADR 0060 d7): schemaVersion, solverId,
 * solverVersion and inputHash travel with the tuned values, and the loader
 * refuses the file when any of them mismatches the running solver or problem.
 */
export type TuningFile = {
  schemaVersion: 1;
  solverId: string;
  solverVersion: string;
  inputHash: string;
  tuning: TuningValues;
};

/** Knobs the closed-form solve was derived for; the producer argv pins them. */
export type TuningValues = {
  targetGapMm: number;
  restDropMm: number;
  downGain: number;
  ffLipContact: boolean;
  honestRestGapMm: number;
  ffContactGapMm: number;
  faceSafetyMm: number;
  pullbackPasses: number;
  ffPressRings: number;
};

const tuning = tuningJson as TuningFile;

/** Running solver identity the tuning file must name (MADR 0061 d3). */
export const SOLVER_ID = "mouth-closedform";

/** Running solver version the tuning file must name. */
export const SOLVER_VERSION = "0.1.0";

/** Committed tuning values solve() predicts from. */
export function tuningValues(): TuningValues {
  return tuning.tuning;
}

/**
 * Refuse a tuning file that does not belong to this solver and problem.
 * Throws when schemaVersion, solverId, solverVersion or inputHash mismatches.
 */
export function assertTuningForProblem(problemInputHash: string): TuningValues {
  if (tuning.schemaVersion !== 1) {
    throw new Error(`tuning file refused: schemaVersion ${String(tuning.schemaVersion)} is not 1`);
  }
  if (tuning.solverId !== SOLVER_ID) {
    throw new Error(`tuning file refused: solverId ${tuning.solverId} is not ${SOLVER_ID}`);
  }
  if (tuning.solverVersion !== SOLVER_VERSION) {
    throw new Error(
      `tuning file refused: solverVersion ${tuning.solverVersion} is not ${SOLVER_VERSION}`,
    );
  }
  if (tuning.inputHash !== problemInputHash) {
    throw new Error(
      `tuning file refused: inputHash ${tuning.inputHash} does not match problem ${problemInputHash}`,
    );
  }
  return tuning.tuning;
}
