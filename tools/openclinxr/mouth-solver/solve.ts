/**
 * CLI: deterministic coordinate-descent search for per-viseme teeth scales.
 *
 * Run: pnpm exec tsx tools/openclinxr/mouth-solver/solve.ts
 *   --glb <path> --track <metrics.json> --out <solved-teeth-gap.json>
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SCHEDULE,
  SOLVER_ID,
  SOLVER_VERSION,
  TARGET_GAP_MM,
  baselineOf,
  scoreOutput,
  searchTeethScales,
  trackSha256,
} from "./solve-teeth-gap.js";
import { evaluate, readEvaluatorTrack } from "./mouth-evaluator.js";

function flag(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`missing ${name} <value>`);
  return value;
}

function commit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function dialogueVersion(): string {
  const pkgPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../packages/openclinxr/xr-dialogue/package.json",
  );
  const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "unknown";
}

async function main(): Promise<void> {
  const glbPath = flag("--glb");
  const trackPath = flag("--track");
  const outPath = flag("--out");
  const track = readEvaluatorTrack(trackPath);
  console.log("baseline (identity scales)...");
  const { output: baselineOutput } = await evaluate(glbPath, track);
  const baseline = baselineOf(baselineOutput);
  const before = scoreOutput(baselineOutput, baseline);
  console.log(`  rms ${before.rms.toFixed(3)} max ${before.max.toFixed(3)} feasible ${before.feasible}`);
  const result = await searchTeethScales(glbPath, track, baseline, DEFAULT_SCHEDULE, (step) => {
    console.log(`  ${step.token} k=${step.k.toFixed(3)} rms=${step.rms.toFixed(3)} feasible=${step.feasible}`);
  });
  console.log(`evals: ${result.evalCount}`);
  console.log(
    `after: rms ${result.objective.rms.toFixed(3)} max ${result.objective.max.toFixed(3)} ` +
      `minGap ${result.objective.minGapMm.toFixed(3)} feasible ${result.objective.feasible}`,
  );
  console.log(`scales: ${JSON.stringify(result.scales)}`);
  const solved = {
    schemaVersion: "openclinxr.mouth-solver.solved-teeth-gap.v1",
    solverId: SOLVER_ID,
    solverVersion: SOLVER_VERSION,
    targetGapMm: TARGET_GAP_MM,
    inputs: {
      glbPath,
      glbSha256: baselineOutput.glbSha256,
      trackPath,
      trackSha256: trackSha256(trackPath),
      dialogueVersion: dialogueVersion(),
      evaluatedCommit: commit(),
    },
    searchSchedule: {
      order: [...DEFAULT_SCHEDULE.order],
      coarseStep: DEFAULT_SCHEDULE.coarseStep,
      fineRadius: DEFAULT_SCHEDULE.fineRadius,
      fineStep: DEFAULT_SCHEDULE.fineStep,
    },
    evalCount: result.evalCount,
    scales: result.scales,
    objectiveBefore: before,
    objectiveAfter: result.objective,
  };
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(solved, null, 2)}\n`);
  console.log(`wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
