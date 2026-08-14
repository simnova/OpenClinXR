#!/usr/bin/env tsx
/**
 * factory:case — one scenario id → inventory of existing factory stations.
 *
 * Resolves the cast via resolveScenarioActorCast (no second resolver). Records
 * each actor's GLB path, exists?, bytes. --dry-run never starts Blender / GPU /
 * Imagine. Live --motion-bind invokes the existing motion-bind CLI (no second
 * bind implementation). Live --viseme may invoke the existing viseme capture.
 * --hatch stays recorded-not-invoked (factory:trellis:hatch requires Imagine).
 *
 *   pnpm factory:case -- --scenario peds_asthma_parent_anxiety_v1 --dry-run
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveScenarioActorCast } from "../../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { findScenarioFixtureById } from "../../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

export const HATCH_CLI = "tools/openclinxr/asset-pipeline/trellis/trellis-hatch-cli.ts";
export const MOTION_BIND_CLI = "tools/openclinxr/asset-pipeline/makeclothes/motion-bind-cli.ts";
export const VISEME_CLI = "tools/openclinxr/evidence/ui-xr-viseme-drive-capture.ts";
/** Same clip as motion-bind-cli DEFAULT_CLIP — do not invent a second bind path. */
export const MOTION_BIND_CLIP =
  "tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_07_01_walk.bvh";
const MOTION_BIND_OUT_DIR = "apps/ui-xr/public/xr-assets/humanoids/candidates";

/** Scenarios this station must accept (bank + explicit MPFB casts). */
export const FACTORY_CASE_SCENARIO_IDS = [
  "peds_asthma_parent_anxiety_v1",
  "ob_headache_preeclampsia_triage_v1",
  "psych_suicidal_ideation_safety_v1",
] as const;

export type FactoryCaseScenarioId = (typeof FACTORY_CASE_SCENARIO_IDS)[number];

export type FactoryCaseArgs = {
  scenario: string | null;
  dryRun: boolean;
  hatch: boolean;
  motionBind: boolean;
  viseme: boolean;
  help: boolean;
  invalid: string[];
};

export type FactoryCaseActorRow = {
  actorId: string;
  role: string;
  declaredAgeBand: string;
  assetPath: string;
  resolvedGlbPath: string;
  runtimeAssetPath: string;
  exists: boolean;
  bytes: number | null;
};

export type FactoryCaseStationId = "cast_inventory" | "trellis_hatch" | "motion_bind" | "viseme";

export type FactoryCaseStationStatus =
  | "planned"
  | "skipped_default_off"
  | "ran"
  | "failed"
  | "skipped";

export type FactoryCaseInvocation = {
  command: string;
  args: string[];
  status: "ran" | "failed" | "skipped";
  exitCode: number | null;
};

export type FactoryCaseStationRow = {
  id: FactoryCaseStationId;
  enabled: boolean;
  command: string;
  status: FactoryCaseStationStatus;
  invocations?: FactoryCaseInvocation[];
  note?: string;
};

export type FactoryCaseExecResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export type FactoryCaseExec = (
  command: string,
  args: readonly string[],
  opts: { cwd: string },
) => FactoryCaseExecResult;

export type FactoryCasePlan = {
  schemaVersion: "openclinxr.factory-case-plan.v1";
  scenarioId: string;
  mode: "dry-run" | "run";
  flags: { hatch: boolean; motionBind: boolean; viseme: boolean };
  stations: FactoryCaseStationRow[];
  actors: FactoryCaseActorRow[];
  missingGlbs: string[];
};

export type FactoryCaseReport = {
  schemaVersion: "openclinxr.factory-case-report.v1";
  scenarioId: string;
  mode: "dry-run" | "run";
  status: "ok" | "missing_cast_glb" | "unknown_scenario" | "usage";
  actors: FactoryCaseActorRow[];
  stations: FactoryCaseStationRow[];
  missingGlbs: string[];
  reportPath: string;
  measuredAt: string;
  claimScope: string[];
  notEvidenceFor: string[];
};

export type FactoryCaseResult = {
  exitCode: number;
  plan: FactoryCasePlan | null;
  report: FactoryCaseReport | null;
  stdout: string;
  stderr: string;
};

const HELP_TEXT = `factory:case — scenario id → existing-cast inventory (no rebuild)

USAGE
  pnpm factory:case -- --scenario <id> [--dry-run]
  pnpm factory:case -- --scenario peds_asthma_parent_anxiety_v1 --dry-run
  pnpm factory:case -- --help

FLAGS
  --scenario <id>   Required. Bank scenario id.
  --dry-run         Print JSON plan; no GPU, no Blender, no Imagine
  --hatch           Record factory:trellis:hatch in the plan (default OFF, never invoked)
  --motion-bind     Live: invoke motion-bind-cli for each existing MPFB generated-humanoids actor (default OFF). Dry-run records only.
  --viseme          Live: invoke existing viseme capture (default OFF). Dry-run records only.

INVOCABLE
  peds_asthma_parent_anxiety_v1
  ob_headache_preeclampsia_triage_v1
  psych_suicidal_ideation_safety_v1

EXIT
  0  all required cast GLBs present
  1  unknown scenario or usage
  2  a required cast GLB is missing
`;

export function factoryCaseEvidenceRoot(): string {
  return process.env.OPENCLINXR_FACTORY_CASE
    ?? path.join(REPO_ROOT, ".openclinxr", "evidence", "factory-case");
}

export function factoryCaseReportPath(scenarioId: string): string {
  return path.join(factoryCaseEvidenceRoot(), scenarioId, "case-report.json");
}

export function parseFactoryCaseArgs(argv: string[]): FactoryCaseArgs {
  const result: FactoryCaseArgs = {
    scenario: null,
    dryRun: false,
    hatch: false,
    motionBind: false,
    viseme: false,
    help: false,
    invalid: [],
  };
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      result.help = true;
    } else if (a === "--dry-run") {
      result.dryRun = true;
    } else if (a === "--hatch" || a === "--trellis-hatch") {
      result.hatch = true;
    } else if (a === "--motion-bind") {
      result.motionBind = true;
    } else if (a === "--viseme") {
      result.viseme = true;
    } else if (a === "--scenario") {
      const value = args[++i];
      if (value) result.scenario = value;
      else result.invalid.push("--scenario requires a value");
    } else if (a.startsWith("-")) {
      result.invalid.push(`unknown flag: ${a}`);
    }
  }
  return result;
}

function resolveGlbOnDisk(assetPath: string): { resolvedGlbPath: string; exists: boolean; bytes: number | null } {
  const resolvedGlbPath = path.isAbsolute(assetPath) ? assetPath : path.join(REPO_ROOT, assetPath);
  if (!existsSync(resolvedGlbPath)) {
    return { resolvedGlbPath, exists: false, bytes: null };
  }
  try {
    return { resolvedGlbPath, exists: true, bytes: statSync(resolvedGlbPath).size };
  } catch {
    return { resolvedGlbPath, exists: false, bytes: null };
  }
}

function inventoryActors(scenarioId: string): FactoryCaseActorRow[] {
  return resolveScenarioActorCast(scenarioId).map((entry) => {
    const disk = resolveGlbOnDisk(entry.assetPath);
    return {
      actorId: entry.actorId,
      role: entry.role,
      declaredAgeBand: entry.declaredAgeBand,
      assetPath: entry.assetPath,
      resolvedGlbPath: disk.resolvedGlbPath,
      runtimeAssetPath: entry.runtimeAssetPath,
      exists: disk.exists,
      bytes: disk.bytes,
    };
  });
}

function skipOrPlan(enabled: boolean): FactoryCaseStationStatus {
  return enabled ? "planned" : "skipped_default_off";
}

function stationRows(flags: { hatch: boolean; motionBind: boolean; viseme: boolean }): FactoryCaseStationRow[] {
  return [
    {
      id: "cast_inventory",
      enabled: true,
      command: "resolveScenarioActorCast + stat(assetPath)",
      status: "planned",
    },
    {
      id: "trellis_hatch",
      enabled: flags.hatch,
      command: `tsx ${HATCH_CLI}`,
      status: skipOrPlan(flags.hatch),
      note: flags.hatch
        ? "recorded-not-invoked: factory:trellis:hatch requires Imagine"
        : undefined,
    },
    {
      id: "motion_bind",
      enabled: flags.motionBind,
      command: `tsx ${MOTION_BIND_CLI} --actor <mpfb-generated-humanoid.glb> --clip ${MOTION_BIND_CLIP}`,
      status: skipOrPlan(flags.motionBind),
    },
    {
      id: "viseme",
      enabled: flags.viseme,
      command: `tsx ${VISEME_CLI}`,
      status: skipOrPlan(flags.viseme),
    },
  ];
}

export function isMpfbGeneratedHumanoid(assetPath: string): boolean {
  const normalized = assetPath.replace(/\\/g, "/");
  return normalized.includes("generated-humanoids/mpfb-") && normalized.endsWith(".glb");
}

export function mpfbGeneratedHumanoidsOnDisk(actors: FactoryCaseActorRow[]): FactoryCaseActorRow[] {
  return actors.filter((actor) => actor.exists && isMpfbGeneratedHumanoid(actor.assetPath));
}

function motionBindOutputs(actor: FactoryCaseActorRow): { output: string; report: string } {
  const stem = path.basename(actor.assetPath, ".glb");
  return {
    output: `${MOTION_BIND_OUT_DIR}/${stem}.motion-bind.glb`,
    report: `${MOTION_BIND_OUT_DIR}/${stem}.motion-bind-report.json`,
  };
}

function findTsx(): string {
  const local = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  return existsSync(local) ? local : "tsx";
}

export function defaultFactoryCaseExec(
  command: string,
  args: readonly string[],
  opts: { cwd: string },
): FactoryCaseExecResult {
  const result = spawnSync(command, [...args], {
    cwd: opts.cwd,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? result.error.message : ""),
  };
}

function invokeExec(
  exec: FactoryCaseExec,
  command: string,
  args: readonly string[],
): FactoryCaseInvocation {
  try {
    const result = exec(command, args, { cwd: REPO_ROOT });
    const exitCode = result.status ?? 1;
    return {
      command,
      args: [...args],
      status: exitCode === 0 ? "ran" : "failed",
      exitCode,
    };
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return {
      command,
      args: [...args],
      status: "failed",
      exitCode: e.status ?? 1,
    };
  }
}

function rollupInvocations(invocations: FactoryCaseInvocation[]): FactoryCaseStationStatus {
  if (invocations.length === 0) return "skipped";
  return invocations.every((row) => row.status === "ran") ? "ran" : "failed";
}

function runMotionBindStation(
  actors: FactoryCaseActorRow[],
  exec: FactoryCaseExec,
): FactoryCaseStationRow {
  const eligible = mpfbGeneratedHumanoidsOnDisk(actors);
  const command = `tsx ${MOTION_BIND_CLI} --actor <mpfb-generated-humanoid.glb> --clip ${MOTION_BIND_CLIP}`;
  if (eligible.length === 0) {
    return {
      id: "motion_bind",
      enabled: true,
      command,
      status: "skipped",
      invocations: [],
      note: "no existing MPFB generated-humanoids actor on disk",
    };
  }
  const tsx = findTsx();
  const invocations = eligible.map((actor) => {
    const { output, report } = motionBindOutputs(actor);
    return invokeExec(exec, tsx, [
      MOTION_BIND_CLI,
      "--actor",
      actor.assetPath,
      "--clip",
      MOTION_BIND_CLIP,
      "--output",
      output,
      "--report",
      report,
    ]);
  });
  return {
    id: "motion_bind",
    enabled: true,
    command,
    status: rollupInvocations(invocations),
    invocations,
  };
}

function runVisemeStation(
  actors: FactoryCaseActorRow[],
  exec: FactoryCaseExec,
): FactoryCaseStationRow {
  const eligible = mpfbGeneratedHumanoidsOnDisk(actors);
  const command = `tsx ${VISEME_CLI}`;
  if (eligible.length === 0) {
    return {
      id: "viseme",
      enabled: true,
      command,
      status: "skipped",
      invocations: [],
      note: "no existing MPFB generated-humanoids GLB for viseme capture",
    };
  }
  const invocation = invokeExec(exec, findTsx(), [VISEME_CLI]);
  return {
    id: "viseme",
    enabled: true,
    command,
    status: rollupInvocations([invocation]),
    invocations: [invocation],
    note: `existing viseme capture; subject=${eligible[0]?.assetPath ?? ""}`,
  };
}

function scenarioKnown(scenarioId: string): boolean {
  if (findScenarioFixtureById(scenarioId)) return true;
  return resolveScenarioActorCast(scenarioId).length > 0;
}

function writeReport(report: FactoryCaseReport): void {
  mkdirSync(path.dirname(report.reportPath), { recursive: true });
  writeFileSync(report.reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function baseReport(
  scenarioId: string,
  mode: "dry-run" | "run",
  status: FactoryCaseReport["status"],
  actors: FactoryCaseActorRow[],
  stations: FactoryCaseStationRow[],
  missingGlbs: string[],
): FactoryCaseReport {
  return {
    schemaVersion: "openclinxr.factory-case-report.v1",
    scenarioId,
    mode,
    status,
    actors,
    stations,
    missingGlbs,
    reportPath: factoryCaseReportPath(scenarioId || "_usage"),
    measuredAt: new Date().toISOString(),
    claimScope: [
      "scenario → resolveScenarioActorCast inventory of existing humanoid GLBs",
      mode === "run"
        ? "live run may invoke motion-bind via tsx tools/openclinxr/asset-pipeline/makeclothes/motion-bind-cli.ts"
        : "dry-run never starts Blender, GPU, or Imagine; hatch / motion-bind / viseme recorded only",
      "trellis hatch is recorded only; never invoked (factory:trellis:hatch requires Imagine)",
    ],
    notEvidenceFor: [
      "Quest 3 readiness",
      "clinical accuracy",
      "exam SSOT",
      "canStartLearnerExam / approval",
    ],
  };
}

export function runFactoryCase(
  argv: string[],
  deps?: { exec?: FactoryCaseExec },
): FactoryCaseResult {
  const args = parseFactoryCaseArgs(argv);
  if (args.help) {
    return { exitCode: 0, plan: null, report: null, stdout: HELP_TEXT, stderr: "" };
  }
  if (args.invalid.length > 0) {
    const stderr = `Invalid arguments: ${args.invalid.join(", ")}\n${HELP_TEXT}`;
    return { exitCode: 1, plan: null, report: null, stdout: "", stderr };
  }
  if (!args.scenario) {
    const stderr = `--scenario <id> is required (use --help)\n${HELP_TEXT}`;
    return { exitCode: 1, plan: null, report: null, stdout: "", stderr };
  }

  const scenarioId = args.scenario;
  const mode: "dry-run" | "run" = args.dryRun ? "dry-run" : "run";
  const flags = { hatch: args.hatch, motionBind: args.motionBind, viseme: args.viseme };
  const exec = deps?.exec ?? defaultFactoryCaseExec;
  const stations = stationRows(flags);

  if (!scenarioKnown(scenarioId)) {
    const report = baseReport(scenarioId, mode, "unknown_scenario", [], stations, []);
    writeReport(report);
    const plan: FactoryCasePlan = {
      schemaVersion: "openclinxr.factory-case-plan.v1",
      scenarioId,
      mode,
      flags,
      stations,
      actors: [],
      missingGlbs: [],
    };
    const stdout = args.dryRun ? `${JSON.stringify(plan, null, 2)}\n` : `${JSON.stringify(report, null, 2)}\n`;
    return {
      exitCode: 1,
      plan,
      report,
      stdout,
      stderr: `[factory:case] unknown scenario: ${scenarioId}\n`,
    };
  }

  const actors = inventoryActors(scenarioId);
  const missingGlbs = actors.filter((a) => !a.exists).map((a) => a.assetPath);
  const status = missingGlbs.length > 0 ? "missing_cast_glb" : "ok";
  const inventory = stations.find((row) => row.id === "cast_inventory");
  if (inventory) inventory.status = "ran";
  if (mode === "run" && flags.motionBind) {
    const idx = stations.findIndex((row) => row.id === "motion_bind");
    if (idx >= 0) stations[idx] = runMotionBindStation(actors, exec);
  }
  if (mode === "run" && flags.viseme) {
    const idx = stations.findIndex((row) => row.id === "viseme");
    if (idx >= 0) stations[idx] = runVisemeStation(actors, exec);
  }
  const plan: FactoryCasePlan = {
    schemaVersion: "openclinxr.factory-case-plan.v1",
    scenarioId,
    mode,
    flags,
    stations,
    actors,
    missingGlbs,
  };
  const report = baseReport(scenarioId, mode, status, actors, stations, missingGlbs);
  writeReport(report);

  const stdout = args.dryRun ? `${JSON.stringify(plan, null, 2)}\n` : `${JSON.stringify(report, null, 2)}\n`;
  const exitCode = status === "missing_cast_glb" ? 2 : 0;
  const stderr = exitCode === 2
    ? `[factory:case] ${scenarioId}: missing required cast GLB (${missingGlbs.join(", ")})\n`
    : "";
  return { exitCode, plan, report, stdout, stderr };
}

function main(): void {
  const result = runFactoryCase(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main();
}
