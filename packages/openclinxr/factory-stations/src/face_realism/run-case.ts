// Face-station case CLI: runs one case into an out dir under the asset
// store (face-station-cases/<caseId>/run<N>/) and rebuilds the tracked
// case-run report from every run dir. Usage:
//   pnpm tsx packages/openclinxr/factory-stations/src/face_realism/run-case.ts <caseId> [runN]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runFaceRealism } from "./run.js";

const STORE_ROOT = "/Volumes/files/openclinxr-assets/store";
const CASES_DIR = "face-station-cases";
const FACE_DIR_REL = "packages/openclinxr/factory-stations/src/face_realism";

function repoRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

function nextRunIndex(caseDir: string): number {
  if (!existsSync(caseDir)) return 1;
  const taken = new Set(
    readdirSync(caseDir)
      .map((entry) => /^run(\d+)$/.exec(entry)?.[1])
      .filter((m): m is string => m !== undefined)
      .map((m) => Number(m)),
  );
  let next = 1;
  while (taken.has(next)) next += 1;
  return next;
}

type StageRecord = {
  stage: number;
  name: string;
  script: string;
  argv: string[];
  inputs: Array<{ path: string; sha256: string }>;
  outputs: Array<{ path: string; sha256: string }>;
  byproducts?: Array<{ path: string; sha256: string }>;
  unchainedInputs: Array<{ path: string; sha256: string; prevStageOutputs: unknown }>;
  ran: boolean;
  blocked: boolean;
  blockReason?: string;
  blocked_by?: string;
  gate: { pass: boolean; detail: string; knownGood?: unknown };
  wallSeconds: number;
  extra?: { knownGoodRows?: Array<Record<string, unknown>>; checks?: Record<string, unknown> };
};

export function rebuildCaseRunReport(): Record<string, unknown> {
  const root = repoRoot();
  const inputsDoc = JSON.parse(
    readFileSync(path.join(root, FACE_DIR_REL, "case-inputs.json"), "utf8"),
  ) as { cases?: Record<string, unknown> };
  const caseIds = Object.keys(inputsDoc.cases ?? {}).sort();
  const cases: Record<string, unknown> = {};
  for (const caseId of caseIds) {
    const caseDir = path.join(STORE_ROOT, CASES_DIR, caseId);
    const runs: Record<string, unknown> = {};
    if (existsSync(caseDir)) {
      const runNames = readdirSync(caseDir)
        .filter((entry) => /^run\d+$/.test(entry))
        .sort();
      for (const runName of runNames) {
        const recordsFile = path.join(caseDir, runName, "stage-records.json");
        if (!existsSync(recordsFile)) continue;
        const records = JSON.parse(readFileSync(recordsFile, "utf8")) as {
          stages?: StageRecord[];
          unchainedInputs?: unknown[];
          wallSeconds?: number;
          status?: string;
        };
        runs[runName] = {
          status: records.status,
          wallSeconds: records.wallSeconds,
          stages: records.stages,
          unchainedInputs: records.unchainedInputs,
        };
      }
    }
    cases[caseId] = { runs };
  }
  const knownGood: Array<Record<string, unknown>> = [];
  const blockedChecks: Array<Record<string, unknown>> = [];
  const unchained: Array<Record<string, unknown>> = [];
  for (const [caseId, caseDoc] of Object.entries(cases)) {
    for (const [runName, runDoc] of Object.entries(
      (caseDoc as { runs: Record<string, { stages?: StageRecord[]; unchainedInputs?: Array<{ path: string; sha256: string }> }> }).runs,
    )) {
      for (const stage of runDoc.stages ?? []) {
        const kg = (stage.gate as { knownGood?: { name: string; expected: string; expectedSource: string; actual: string } })
          .knownGood;
        if (kg !== undefined) {
          knownGood.push({
            case: caseId,
            run: runName,
            stage: stage.stage,
            name: kg.name,
            expected: kg.expected,
            expectedSource: kg.expectedSource,
            actual: kg.actual,
            match: kg.expected === kg.actual,
          });
        }
        for (const row of stage.extra?.knownGoodRows ?? []) {
          knownGood.push({ case: caseId, run: runName, stage: stage.stage, ...(row as Record<string, unknown>) });
        }
        if (stage.blocked) {
          blockedChecks.push({
            case: caseId,
            run: runName,
            stage: stage.stage,
            reason: (stage as { blockReason?: string }).blockReason ?? "",
          });
        }
        if (typeof stage.blocked_by === "string" && stage.blocked_by.length > 0) {
          blockedChecks.push({ case: caseId, run: runName, stage: stage.stage, blocked_by: stage.blocked_by });
        }
        const extra = (stage as { extra?: { checks?: Record<string, unknown> } }).extra;
        if (extra?.checks !== undefined) {
          for (const [check, result] of Object.entries(extra.checks)) {
            if (result === null || typeof result !== "object") continue;
            const typed = result as { blocked?: boolean; pass?: boolean; blocked_by?: unknown; reason?: unknown };
            if (typed.blocked === true) {
              blockedChecks.push({ case: caseId, run: runName, stage: stage.stage, check, ...(result as Record<string, unknown>) });
            } else if (
              typed.pass === false &&
              (typeof typed.blocked_by === "string" || typeof typed.reason === "string")
            ) {
              blockedChecks.push({ case: caseId, run: runName, stage: stage.stage, check, ...(result as Record<string, unknown>) });
            }
          }
        }
      }
      for (const entry of runDoc.unchainedInputs ?? []) {
        unchained.push({ case: caseId, run: runName, ...(entry as Record<string, unknown>) });
      }
    }
  }
  const report = { version: 1, store: path.join(STORE_ROOT, CASES_DIR), cases, knownGood, blockedChecks, unchainedInputs: unchained };
  writeFileSync(path.join(root, FACE_DIR_REL, "case-run-report.json"), `${JSON.stringify(report, null, 1)}\n`);
  return report;
}

async function main(): Promise<void> {
  const caseId = process.argv[2];
  if (typeof caseId !== "string" || caseId.length === 0) {
    throw new Error("usage: run-case.ts <caseId> [runN]");
  }
  const caseDir = path.join(STORE_ROOT, CASES_DIR, caseId);
  const runArg = Number(process.argv[3]);
  const runN = Number.isInteger(runArg) && runArg > 0 ? runArg : nextRunIndex(caseDir);
  const outDir = path.join(caseDir, `run${runN}`);
  mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  const result = runFaceRealism({
    actorId: caseId,
    recordPath: "tools/openclinxr/asset-pipeline/reference-set/manifest.json",
    outDir,
  });
  writeFileSync(
    path.join(outDir, "stage-records.json"),
    `${JSON.stringify(
      {
        case: caseId,
        run: `run${runN}`,
        status: result["status"],
        wallSeconds: (Date.now() - started) / 1000,
        stages: result["stages"],
        unchainedInputs: result["unchainedInputs"],
      },
      null,
      1,
    )}\n`,
  );
  const report = rebuildCaseRunReport();
  const caseRuns = Object.keys(
    ((report["cases"] as Record<string, { runs: Record<string, unknown> }>)[caseId] as { runs: Record<string, unknown> }).runs,
  );
  console.log(`case=${caseId} run=run${runN} status=${String(result["status"])} runs=[${caseRuns.join(",")}]`);
}

void main().then(
  () => undefined,
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
