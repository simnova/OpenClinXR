/**
 * Mouth-station registry run: build the problem, check the pin, solve, apply.
 *
 * The registry owns running the job against the pinned solver plug-in. It is
 * the only package allowed to import solver packages (solver-importer
 * allowlist); no exported function takes a solver or a solve callback, so a
 * caller cannot substitute a pre-tuned solver while the receipt still names
 * the official one [MADR 0061 d4-d7].
 */
import { apply, buildProblem } from "@openclinxr/station-mouth-executor";
import type {
  Problem,
  Solution,
  SolverModule,
} from "@openclinxr/station-mouth-objective";
import pinJson from "./pin.json" with { type: "json" };
import { mouthSolverModules } from "./solver-map.generated.js";

/** Committed pin: exactly the solver id and version the registry resolves. */
export type RegistryPin = {
  /** Solver id the committed run resolves (MADR 0061 d5). */
  solverId: string;
  /** Solver version the committed run resolves (MADR 0061 d5). */
  solverVersion: string;
};

/** Input for run: the unseated asset bytes plus the one operator-set target. */
export type RunOptions = {
  /** Rest rim-gap target, head-local mm; the committed seat uses 3.743. */
  targetGapMm: number;
};

/** Seated bytes, the receipt note and the pinned solution that produced them. */
export type RunResult = {
  /** Seated GLB bytes. */
  glbBytes: Uint8Array;
  /** One-line provenance note for the receipt (solver, input hash, target, rest gap). */
  receiptNote: string;
  /** Pinned solution solve returned for the built problem. */
  solution: Solution;
};

/** Committed pin the registry resolves before solving. */
export function loadPin(): RegistryPin {
  const pin = pinJson as RegistryPin;
  if (typeof pin.solverId !== "string" || typeof pin.solverVersion !== "string") {
    throw new Error("registry pin refused: pin.json must carry solverId and solverVersion strings");
  }
  return { solverId: pin.solverId, solverVersion: pin.solverVersion };
}

/**
 * Resolve the committed pin against the generated solver map.
 *
 * Fails when no mapped module carries the pinned id, and when the mapped
 * module's version differs from the pinned version. Runs before solve, so a
 * pin mismatch never reaches a solver [MADR 0061 d5].
 */
export function loadPinnedSolver(pin: RegistryPin): SolverModule {
  const module = mouthSolverModules.find((candidate) => candidate.id === pin.solverId);
  if (module === undefined) {
    throw new Error(
      `registry pin refused: solver id ${pin.solverId} is not in the generated map`,
    );
  }
  if (module.version !== pin.solverVersion) {
    throw new Error(
      `registry pin refused: solver ${pin.solverId} is at ${module.version}, pin wants ${pin.solverVersion}`,
    );
  }
  return module;
}

/**
 * Run the mouth station on unseated GLB bytes.
 *
 * Builds the problem with the executor, resolves the committed pin against
 * the generated map, solves with the checked module, and applies the solution
 * with the executor. The receipt provenance copies the solver id and version
 * from the checked module, never from caller input [MADR 0061 d7].
 */
export async function run(glbBytes: Uint8Array, options: RunOptions): Promise<RunResult> {
  const problem: Problem = buildProblem(glbBytes, { targetGapMm: options.targetGapMm });
  const module = loadPinnedSolver(loadPin());
  const solution: Solution = module.solve(problem);
  const applied = await apply(glbBytes, solution, {
    targetGapMm: options.targetGapMm,
    solverId: module.id,
    solverVersion: module.version,
  });
  return { glbBytes: applied.glbBytes, receiptNote: applied.receiptNote, solution };
}

/**
 * Re-run the pinned solver and fail when the persisted solution differs.
 *
 * Catches output produced by calling apply directly with an unpinned
 * solution: the re-run carries the pinned solver id, version and frames, so a
 * foreign solverId, a version skew or edited frames throw [MADR 0061 d7].
 */
export function verifySolution(problem: Problem, solution: Solution): void {
  const module = loadPinnedSolver(loadPin());
  const expected: Solution = module.solve(problem);
  if (solution.solverId !== expected.solverId || solution.solverVersion !== expected.solverVersion) {
    throw new Error(
      `unpinned solution refused: got ${solution.solverId}/${solution.solverVersion}, ` +
        `pinned solver is ${expected.solverId}/${expected.solverVersion}`,
    );
  }
  if (solution.inputHash !== expected.inputHash) {
    throw new Error("unpinned solution refused: inputHash does not match the re-run");
  }
  if (JSON.stringify(solution.frames) !== JSON.stringify(expected.frames)) {
    throw new Error("unpinned solution refused: frames differ from the pinned re-run");
  }
}
