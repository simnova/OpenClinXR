import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { stepsForProfile } from "./agentic-hook-runner.js";
import {
  CI_SPLIT_PACKAGES_STEP,
  CI_SPLIT_TOOL_STEP,
  expectedStepsForVar,
  findCiSplitStep,
  loadTurboDeclarations,
  readCiSplitVerifySteps,
  type TurboDeclarations,
} from "./ci-split-steps.js";

/**
 * CI-SAMPLE-WIRE (C3, THIN-C2 split): fast-ci runs no station suites; the
 * nightly slow-suites sweep runs everything (full sweep by omission: no
 * SAMPLE/SEED env). Per-push sampling survives only in the pre-push hook
 * profile (G2 below, stepsForProfile). The CI-side SAMPLE expression
 * evaluator is deleted with the old ci.yml Test steps; what remains asserts
 * the split: triggers live in the right file, the slow steps live in
 * nightly, and nothing reintroduces sampling into the nightly sweep.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CI_YML_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const NIGHTLY_YML_PATH = join(REPO_ROOT, ".github", "workflows", "nightly.yml");

// CI-SPLIT-READERS: nightly.yml slow-suites now runs "Test tools" + "Test packages"
// (THIN-C2 moved the suites out of ci.yml fast-ci; CI-SPLIT-TEST 6040386d7 had
// split the old "Test" step). Step resolution and the per-var turbo derivation
// live in ./ci-split-steps.js; only the split-layout policy assertion and its
// counterweights remain here. Each asserted var derives its own NON-EMPTY step
// set from the nightly runs (never a union across variables).
const SAMPLE_VAR = "OPENCLINXR_STATION_SAMPLE";
const SEED_VAR = "OPENCLINXR_STATION_SAMPLE_SEED";

function loadSplit(
  nightlyText: string = readFileSync(NIGHTLY_YML_PATH, "utf8"),
  declarations: TurboDeclarations = loadTurboDeclarations(),
): {
  ciOn: Record<string, unknown>;
  ciSteps: string[];
  nightlyOn: Record<string, unknown>;
  group: string;
  cancel: unknown;
  sampleSteps: string[];
  seedSteps: string[];
  stepEnvs: Record<string, Record<string, string>>;
} {
  const ci = parseYaml(readFileSync(CI_YML_PATH, "utf8")) as {
    on: Record<string, unknown>;
    jobs?: Record<string, { steps?: { name?: unknown }[] }>;
  };
  const nightly = parseYaml(nightlyText) as {
    on: Record<string, unknown>;
    concurrency: { group: string; "cancel-in-progress": unknown };
  };
  // F4 fail-closed: a missing/renamed/empty fast-ci must throw here, before any
  // "contains no slow tests" assertion below can pass vacuously on [].
  const fastCi = ci.jobs?.["fast-ci"];
  if (!fastCi || !Array.isArray(fastCi.steps) || fastCi.steps.length === 0) {
    throw new Error('ci.yml has no fast-ci job with >= 1 step (expected the fast-ci gate job)');
  }
  const ciSteps = (fastCi.steps as { name?: unknown }[]).map((s) => String(s.name));
  const steps = readCiSplitVerifySteps(nightlyText);
  // Resolve by exact name (C1): a renamed/missing step throws naming the step.
  const toolsStep = findCiSplitStep(steps, CI_SPLIT_TOOL_STEP);
  const packagesStep = findCiSplitStep(steps, CI_SPLIT_PACKAGES_STEP);
  return {
    ciOn: ci.on,
    ciSteps,
    nightlyOn: nightly.on,
    group: nightly.concurrency.group,
    cancel: nightly.concurrency["cancel-in-progress"],
    sampleSteps: expectedStepsForVar(SAMPLE_VAR, nightlyText, declarations),
    seedSteps: expectedStepsForVar(SEED_VAR, nightlyText, declarations),
    stepEnvs: {
      [CI_SPLIT_TOOL_STEP]: (toolsStep.env ?? {}) as Record<string, string>,
      [CI_SPLIT_PACKAGES_STEP]: (packagesStep.env ?? {}) as Record<string, string>,
    },
  };
}

/**
 * Assert the THIN-C2 split on each var's own derived steps (semantics
 * unchanged from the old per-event check, except the nightly sweep is
 * unconditional): each asserted var derives a NON-EMPTY step set from the
 * nightly turbo runs, and no nightly Test step sets SAMPLE/SEED (full sweep
 * by omission). An empty derived set fails naming the var; otherwise the
 * thrown Error names the offending step.
 */
function assertFullSweepOnSteps(
  nightlyText: string = readFileSync(NIGHTLY_YML_PATH, "utf8"),
  declarations: TurboDeclarations = loadTurboDeclarations(),
): void {
  const { sampleSteps, seedSteps, stepEnvs } = loadSplit(nightlyText, declarations);
  const failures: string[] = [];
  if (sampleSteps.length === 0) failures.push(`${SAMPLE_VAR} has no turbo declaration`);
  if (seedSteps.length === 0) failures.push(`${SEED_VAR} has no turbo declaration`);
  for (const name of [CI_SPLIT_TOOL_STEP, CI_SPLIT_PACKAGES_STEP]) {
    const env = stepEnvs[name]!;
    if ((env[SAMPLE_VAR] ?? "") !== "") failures.push(`step "${name}": ${SAMPLE_VAR} is set in nightly (nightly is always a full sweep)`);
    if ((env[SEED_VAR] ?? "") !== "") failures.push(`step "${name}": ${SEED_VAR} is set in nightly (nightly is always a full sweep)`);
    if (!sampleSteps.includes(name)) failures.push(`step "${name}": not in the derived ${SAMPLE_VAR} step set`);
    if (!seedSteps.includes(name)) failures.push(`step "${name}": not in the derived ${SEED_VAR} step set`);
  }
  if (failures.length > 0) throw new Error(`nightly full-sweep mismatch:\n${failures.join("\n")}`);
}


const FIXTURE_SHA = "f00d";

describe("nightly sweeps everything; fast-ci runs no station suites", () => {
  it("G1: fast-ci triggers push/PR only with no station tests; nightly carries the full-sweep suites", () => {
    const { ciOn, ciSteps, nightlyOn, sampleSteps, seedSteps } = loadSplit();
    // fast-ci: push to main + PRs only; no schedule, no dispatch, no Test steps.
    expect(ciOn["pull_request"]).toBeDefined();
    expect(ciOn["push"]).toBeDefined();
    expect("schedule" in ciOn).toBe(false);
    expect("workflow_dispatch" in ciOn).toBe(false);
    expect(ciSteps).not.toContain(CI_SPLIT_TOOL_STEP);
    expect(ciSteps).not.toContain(CI_SPLIT_PACKAGES_STEP);
    expect(ciSteps.join("\n")).not.toContain("OPENCLINXR_STATION_SAMPLE");
    // nightly: one cron + manual dispatch; never on push/PR.
    const schedule = nightlyOn["schedule"] as Array<{ cron: string }> | undefined;
    expect(Array.isArray(schedule) && schedule.length >= 1).toBe(true);
    expect("workflow_dispatch" in nightlyOn).toBe(true);
    expect("push" in nightlyOn).toBe(false);
    expect("pull_request" in nightlyOn).toBe(false);
    // Each asserted var derives its own non-empty step set (never a union).
    for (const steps of [sampleSteps, seedSteps]) {
      expect(steps).toContain(CI_SPLIT_TOOL_STEP);
      expect(steps).toContain(CI_SPLIT_PACKAGES_STEP);
    }
    assertFullSweepOnSteps();
  });

  it("G1-concurrency: the nightly sweep is never cancelled by a push", () => {
    const { group, cancel } = loadSplit();
    // Separate workflow + partitioned group + unconditional cancel-in-progress:false:
    // a push to main (different workflow, different group) cannot cancel the sweep.
    expect(group).toContain("nightly-");
    expect(cancel).toBe(false);
    // The split steps resolve by name and each sweeps fully (no sampling).
    assertFullSweepOnSteps();
  });

  it("CW1: renaming Test tools to Test throws naming \"Test tools\"", () => {
    const real = readFileSync(NIGHTLY_YML_PATH, "utf8");
    const renamed = real.replace("- name: Test tools", "- name: Test");
    expect(renamed).not.toBe(real);
    let msg = "";
    try {
      loadSplit(renamed);
    } catch (err) {
      msg = String(err);
    }
    expect(msg).toContain('"Test tools"');
    process.stdout.write(`[CW1 G1] ${msg}\n`);
  });

  it("CW2: removing the packages turbo entrypoint fails naming \"Test packages\"", () => {
    const real = readFileSync(NIGHTLY_YML_PATH, "utf8");
    const marker = "pnpm packages:test";
    expect(real).toContain(marker);
    const modified = real.replaceAll(marker, "echo no-packages-tests");
    expect(modified).not.toBe(real);
    let msg = "";
    try {
      assertFullSweepOnSteps(modified);
    } catch (err) {
      msg = String(err);
    }
    expect(msg).toContain('"Test packages"');
    process.stdout.write(`[CW2 G1] ${msg}\n`);
  });

  it("CW4: SAMPLE with no turbo declaration fails naming the var", () => {
    const decls = loadTurboDeclarations(REPO_ROOT);
    const stripSample = (text: string): string => text.replaceAll('"OPENCLINXR_STATION_SAMPLE", ', "");
    const stripped: TurboDeclarations = {
      rootTurboJson: stripSample(decls.rootTurboJson),
      packageTurboJsons: decls.packageTurboJsons.map(stripSample),
    };
    expect(stripped.rootTurboJson).not.toBe(decls.rootTurboJson);
    let msg = "";
    try {
      assertFullSweepOnSteps(readFileSync(NIGHTLY_YML_PATH, "utf8"), stripped);
    } catch (err) {
      msg = String(err);
    }
    expect(msg).toContain("OPENCLINXR_STATION_SAMPLE has no turbo declaration");
    process.stdout.write(`[CW4 G1] ${msg}\n`);
  });

  it("G2: pre-push affected tests carry SAMPLE=2 + HEAD seed; strict carries neither", () => {
    const product = ["packages/openclinxr/domain/src/claim-language.ts"];
    const prePush = stepsForProfile("pre-push", product, undefined, FIXTURE_SHA);
    const sweep = prePush.find((s) => s.label === "Affected package tests");
    expect(sweep).toBeDefined();
    expect(sweep?.env?.["OPENCLINXR_STATION_SAMPLE"]).toBe("2");
    expect(sweep?.env?.["OPENCLINXR_STATION_SAMPLE_SEED"]).toBe(FIXTURE_SHA);
    const strictSteps = stepsForProfile("strict", product);
    for (const step of strictSteps) {
      expect(step.env?.["OPENCLINXR_STATION_SAMPLE"]).toBeUndefined();
      expect(step.env?.["OPENCLINXR_STATION_SAMPLE_SEED"]).toBeUndefined();
    }
  });

  it("G6: turbo delivers and hashes the sample env for staging-evidence and serial-browser", () => {
    const turboBin = join(REPO_ROOT, "node_modules", ".bin", "turbo");
    const NEED = ["OPENCLINXR_STATION_SAMPLE", "OPENCLINXR_STATION_SAMPLE_SEED"];
    const sampledEnv: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCLINXR_STATION_SAMPLE: "2",
      OPENCLINXR_STATION_SAMPLE_SEED: FIXTURE_SHA,
    };
    const unsetEnv: NodeJS.ProcessEnv = { ...process.env };
    delete unsetEnv["OPENCLINXR_STATION_SAMPLE"];
    delete unsetEnv["OPENCLINXR_STATION_SAMPLE_SEED"];
    const dry = (
      args: string[],
      env: NodeJS.ProcessEnv,
    ): { doc: {
      tasks: Array<{
        taskId: string;
        hash: string;
        environmentVariables: { specified: { env: string[] } };
      }>;
    }; ms: number } => {
      const started = Date.now();
      const out = execFileSync(turboBin, args, {
        encoding: "utf8",
        cwd: REPO_ROOT,
        env,
        maxBuffer: 8 * 1024 * 1024,
      });
      const ms = Date.now() - started;
      if (ms > 60_000) throw new Error(`turbo dry too slow for a unit test: ${ms} ms`);
      return { doc: JSON.parse(out as string), ms };
    };
    const findTask = (
      doc: { tasks: Array<{
        taskId: string;
        hash: string;
        environmentVariables: { specified: { env: string[] } };
      }> },
      taskId: string,
    ): { hash: string; specifiedEnv: string[] } => {
      const task = doc.tasks.find((t) => t.taskId === taskId);
      if (!task) throw new Error(`dry=json missing task ${taskId}`);
      return { hash: task.hash, specifiedEnv: task.environmentVariables.specified.env };
    };
    // FIX1: strict-mode package task delivers + hashes the vars.
    const sampledPkg = dry(["run", "test", "--filter=@openclinxr/staging-evidence", "--dry=json"], sampledEnv);
    const unsetPkg = dry(["run", "test", "--filter=@openclinxr/staging-evidence", "--dry=json"], unsetEnv);
    const sampledPkgTask = findTask(sampledPkg.doc, "@openclinxr/staging-evidence#test");
    const unsetPkgTask = findTask(unsetPkg.doc, "@openclinxr/staging-evidence#test");
    for (const name of NEED) {
      expect(sampledPkgTask.specifiedEnv, `staging-evidence specified.env`).toContain(name);
      expect(unsetPkgTask.specifiedEnv, `staging-evidence specified.env (unset arm)`).toContain(name);
    }
    expect(sampledPkgTask.hash, "staging-evidence hash sampled vs unset").not.toBe(unsetPkgTask.hash);
    // FIX2: serial-browser area task (sole area with env-dependent tests) same contract.
    const sampledArea = dry(["run", "//#test:tools:serial-browser", "--dry=json"], sampledEnv);
    const unsetArea = dry(["run", "//#test:tools:serial-browser", "--dry=json"], unsetEnv);
    const sampledAreaTask = findTask(sampledArea.doc, "//#test:tools:serial-browser");
    const unsetAreaTask = findTask(unsetArea.doc, "//#test:tools:serial-browser");
    for (const name of NEED) {
      expect(sampledAreaTask.specifiedEnv, `serial-browser specified.env`).toContain(name);
      expect(unsetAreaTask.specifiedEnv, `serial-browser specified.env (unset arm)`).toContain(name);
    }
    expect(sampledAreaTask.hash, "serial-browser hash sampled vs unset").not.toBe(unsetAreaTask.hash);
    process.stdout.write(
      `G6 hashes staging-evidence sampled=${sampledPkgTask.hash} unset=${unsetPkgTask.hash} ` +
        `serial-browser sampled=${sampledAreaTask.hash} unset=${unsetAreaTask.hash}\n`,
    );
    // Four turbo --dry runs, each guarded at 60 s; under the pre-commit suite this test took 14.4 s.
  }, 240_000);
});
