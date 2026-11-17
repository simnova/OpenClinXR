import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { selectStationSubset } from "../evidence/station-subset.js";
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
 * CI-SAMPLE-WIRE (C3): per-push we sweep a seeded SAMPLE=2, nightly we sweep everything.
 *
 * YAML parser: `yaml` (package `yaml@2.9.0`, root dev dep, same as
 * run-tools-tests.test.ts `import { parse as parseYaml } from "yaml"`).
 *
 * Expression evaluator below supports exactly the forms used in ci.yml Test-step env:
 * single-quoted string literals, `github.event_name`, `github.sha`, `==`, `!=`,
 * `!`, `&&`, `||`, parentheses. `&&`/`||` return values (JS-like truthiness:
 * false/null/undefined/"" are falsy, non-empty strings truthy).
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CI_YML_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");

// CI-SPLIT-READERS: ci.yml verify now runs "Test tools" + "Test packages"
// (CI-SPLIT-TEST 6040386d7 split the old "Test" step). Step resolution and
// the per-var turbo derivation live in ./ci-split-steps.js; only the G-series
// policy assertion and its counterweights remain here. Each asserted var
// derives its own NON-EMPTY step set and its YAML value is asserted on that
// var's own derived steps (never a union across variables).
const SAMPLE_VAR = "OPENCLINXR_STATION_SAMPLE";
const SEED_VAR = "OPENCLINXR_STATION_SAMPLE_SEED";

function loadCi(
  yamlText: string = readFileSync(CI_YML_PATH, "utf8"),
  declarations: TurboDeclarations = loadTurboDeclarations(),
): {
  on: Record<string, unknown>;
  group: string;
  cancel: unknown;
  sampleSteps: string[];
  seedSteps: string[];
  stepEnvs: Record<string, Record<string, string>>;
} {
  const doc = parseYaml(yamlText) as Record<string, unknown>;
  const on = doc["on"] as Record<string, unknown>;
  const concurrency = doc["concurrency"] as { group: string; "cancel-in-progress": unknown };
  const steps = readCiSplitVerifySteps(yamlText);
  // Resolve by exact name (C1): a renamed/missing step throws naming the step.
  const toolsStep = findCiSplitStep(steps, CI_SPLIT_TOOL_STEP);
  const packagesStep = findCiSplitStep(steps, CI_SPLIT_PACKAGES_STEP);
  if (!(toolsStep.env as Record<string, string> | undefined)) {
    throw new Error(`ci.yml verify step "${CI_SPLIT_TOOL_STEP}" has no env`);
  }
  if (!(packagesStep.env as Record<string, string> | undefined)) {
    throw new Error(`ci.yml verify step "${CI_SPLIT_PACKAGES_STEP}" has no env`);
  }
  return {
    on,
    group: concurrency.group,
    cancel: concurrency["cancel-in-progress"],
    sampleSteps: expectedStepsForVar(SAMPLE_VAR, yamlText, declarations),
    seedSteps: expectedStepsForVar(SEED_VAR, yamlText, declarations),
    stepEnvs: {
      [CI_SPLIT_TOOL_STEP]: toolsStep.env as Record<string, string>,
      [CI_SPLIT_PACKAGES_STEP]: packagesStep.env as Record<string, string>,
    },
  };
}

/**
 * Assert the sample/seed expressions on EACH var's own derived steps
 * (existing evaluateCiEnvExpression semantics, unchanged). An empty derived
 * set fails naming the var; otherwise the thrown Error names the offending
 * step.
 */
function assertSampleSeedOnSteps(
  yamlText: string = readFileSync(CI_YML_PATH, "utf8"),
  declarations: TurboDeclarations = loadTurboDeclarations(),
): void {
  const { sampleSteps, seedSteps, stepEnvs } = loadCi(yamlText, declarations);
  const failures: string[] = [];
  if (sampleSteps.length === 0) failures.push(`${SAMPLE_VAR} has no turbo declaration`);
  if (seedSteps.length === 0) failures.push(`${SEED_VAR} has no turbo declaration`);
  const events = ["push", "pull_request", "schedule", "workflow_dispatch"] as const;
  for (const name of sampleSteps) {
    const env = stepEnvs[name]!;
    const sampleRaw = env[SAMPLE_VAR] ?? "";
    const seedRaw = env[SEED_VAR] ?? "";
    for (const event_name of events) {
      const sample = evaluateCiEnvExpression(sampleRaw, { event_name, sha: FIXTURE_SHA });
      if (event_name === "push" || event_name === "pull_request") {
        if (sample !== "2") failures.push(`step "${name}": SAMPLE for ${event_name} is ${JSON.stringify(sample)} (want "2")`);
      } else {
        if (sample !== "") failures.push(`step "${name}": SAMPLE for ${event_name} is not empty`);
        // Empty string = unset (station-subset.ts:83,88): the scheduled/manual run is a full sweep.
        const subset = selectStationSubset(["s1", "s2", "s3"], {
          OPENCLINXR_STATION_SAMPLE: sample,
          OPENCLINXR_STATION_SAMPLE_SEED: evaluateCiEnvExpression(seedRaw, { event_name, sha: FIXTURE_SHA }),
        });
        if (!subset.full) failures.push(`step "${name}": full sweep for ${event_name} is not full`);
      }
    }
  }
  for (const name of seedSteps) {
    const seedRaw = stepEnvs[name]![SEED_VAR] ?? "";
    if (!seedRaw.includes("github.sha")) {
      failures.push(`step "${name}": ${SEED_VAR} is not derived from github.sha`);
    }
    for (const event_name of events) {
      const seed = evaluateCiEnvExpression(seedRaw, { event_name, sha: FIXTURE_SHA });
      if (event_name === "push" || event_name === "pull_request") {
        if (seed !== FIXTURE_SHA) failures.push(`step "${name}": SEED for ${event_name} is not the fixture sha`);
      } else if (seed !== "") {
        failures.push(`step "${name}": SEED for ${event_name} is not empty`);
      }
    }
  }
  if (failures.length > 0) throw new Error(`ci.yml sample/seed mismatch:\n${failures.join("\n")}`);
}

type Token =
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "op"; op: "&&" | "||" | "==" | "!=" | "!" }
  | { kind: "str"; value: string }
  | { kind: "ident"; name: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new Error(`unterminated string in ${JSON.stringify(input)}`);
      tokens.push({ kind: "str", value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const three = input.slice(i, i + 3);
    void three;
    if (input.startsWith("&&", i)) {
      tokens.push({ kind: "op", op: "&&" });
      i += 2;
      continue;
    }
    if (input.startsWith("||", i)) {
      tokens.push({ kind: "op", op: "||" });
      i += 2;
      continue;
    }
    if (input.startsWith("==", i)) {
      tokens.push({ kind: "op", op: "==" });
      i += 2;
      continue;
    }
    if (input.startsWith("!=", i)) {
      tokens.push({ kind: "op", op: "!=" });
      i += 2;
      continue;
    }
    if (c === "!") {
      tokens.push({ kind: "op", op: "!" });
      i += 1;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(input.slice(i));
    if (ident) {
      tokens.push({ kind: "ident", name: ident[0] });
      i += ident[0].length;
      continue;
    }
    throw new Error(`unexpected char ${JSON.stringify(c)} in ${JSON.stringify(input)}`);
  }
  return tokens;
}

function isTruthy(v: unknown): boolean {
  if (v === false || v === null || v === undefined || v === "") return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "boolean") return v;
  return true;
}

/** Evaluate a stripped (no ${{ }}) expression against {event_name, sha}. */
function evalStripped(tokens: Token[], ctx: { event_name: string; sha: string }): unknown {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token => {
    const t = tokens[pos];
    if (!t) throw new Error("unexpected end of expression");
    pos += 1;
    return t;
  };
  const parseOr = (): unknown => {
    let left = parseAnd();
    while (peek()?.kind === "op" && (peek() as { op: string }).op === "||") {
      next();
      const right = parseAnd();
      left = isTruthy(left) ? left : right;
    }
    return left;
  };
  const parseAnd = (): unknown => {
    let left = parseEq();
    while (peek()?.kind === "op" && (peek() as { op: string }).op === "&&") {
      next();
      const right = parseEq();
      left = isTruthy(left) ? right : left;
    }
    return left;
  };
  const parseEq = (): unknown => {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t?.kind === "op" && (t.op === "==" || t.op === "!=")) {
        next();
        const right = parseUnary();
        const eq = String(left) === String(right);
        left = t.op === "==" ? eq : !eq;
      } else {
        return left;
      }
    }
  };
  const parseUnary = (): unknown => {
    const t = peek();
    if (t?.kind === "op" && t.op === "!") {
      next();
      return !isTruthy(parseUnary());
    }
    return parsePrimary();
  };
  const parsePrimary = (): unknown => {
    const t = next();
    if (t.kind === "lparen") {
      const v = parseOr();
      const close = next();
      if (close.kind !== "rparen") throw new Error("expected )");
      return v;
    }
    if (t.kind === "str") return t.value;
    if (t.kind === "ident") {
      if (t.name === "github.event_name") return ctx.event_name;
      if (t.name === "github.sha") return ctx.sha;
      if (t.name === "true") return true;
      if (t.name === "false") return false;
      if (t.name === "null") return null;
      throw new Error(`unsupported identifier ${t.name}`);
    }
    throw new Error(`unexpected token ${JSON.stringify(t)}`);
  };
  const result = parseOr();
  if (pos !== tokens.length) throw new Error("trailing tokens in expression");
  return result;
}

/** Evaluate a full `${{ ... }}` env value; non-expression values pass through. */
export function evaluateCiEnvExpression(raw: string, ctx: { event_name: string; sha: string }): string {
  const m = /^\s*\$\{\{\s*([\s\S]*?)\s*\}\}\s*$/.exec(raw);
  if (!m?.[1]) return raw;
  const value = evalStripped(tokenize(m[1]), ctx);
  if (value === null || value === undefined || value === false) return "";
  return String(value);
}

const FIXTURE_SHA = "f00d";

describe("per-push runs a seeded sample of two stations", () => {
  it("G1: ci Test env samples push/PR and unsets schedule/dispatch; schedule + dispatch triggers exist", () => {
    const { on, sampleSteps, seedSteps } = loadCi();
    // `on` triggers: push to main, PRs, one nightly cron, manual dispatch.
    expect(on["pull_request"]).toBeDefined();
    expect(on["push"]).toBeDefined();
    const schedule = on["schedule"] as Array<{ cron: string }> | undefined;
    expect(Array.isArray(schedule) && schedule.length >= 1).toBe(true);
    expect("workflow_dispatch" in on).toBe(true);
    // Each asserted var derives its own non-empty step set (never a union).
    for (const steps of [sampleSteps, seedSteps]) {
      expect(steps).toContain(CI_SPLIT_TOOL_STEP);
      expect(steps).toContain(CI_SPLIT_PACKAGES_STEP);
    }
    assertSampleSeedOnSteps();
  });

  it("G1-concurrency: scheduled and dispatch runs are not cancelled by a push", () => {
    const { group, cancel } = loadCi();
    const groupMentionsEvent = group.includes("github.event_name");
    const cancelIsConditional =
      typeof cancel === "string" && cancel.includes("github.event_name");
    // Either partitioning the group by event or conditioning cancel-in-progress
    // on push/pull_request keeps a push to main from cancelling the nightly.
    expect(groupMentionsEvent || cancelIsConditional).toBe(true);
    // The split steps resolve by name and each carries the sample wiring.
    assertSampleSeedOnSteps();
  });

  it("CW1: renaming Test tools to Test throws naming \"Test tools\"", () => {
    const real = readFileSync(CI_YML_PATH, "utf8");
    const renamed = real.replace("- name: Test tools", "- name: Test");
    expect(renamed).not.toBe(real);
    let msg = "";
    try {
      loadCi(renamed);
    } catch (err) {
      msg = String(err);
    }
    expect(msg).toContain('"Test tools"');
    process.stdout.write(`[CW1 G1] ${msg}\n`);
  });

  it("CW2: removing SAMPLE from the Test packages env block fails naming \"Test packages\"", () => {    const real = readFileSync(CI_YML_PATH, "utf8");
    const marker = "- name: Test packages";
    const at = real.indexOf(marker);
    expect(at).toBeGreaterThanOrEqual(0);
    const key = "OPENCLINXR_STATION_SAMPLE:";
    const keyAt = real.indexOf(key, at);
    expect(keyAt).toBeGreaterThanOrEqual(0);
    const lineStart = real.lastIndexOf("\n", keyAt) + 1;
    const lineEnd = real.indexOf("\n", keyAt);
    const modified = real.slice(0, lineStart) + real.slice(lineEnd + 1);
    let msg = "";
    try {
      assertSampleSeedOnSteps(modified);
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
      assertSampleSeedOnSteps(readFileSync(CI_YML_PATH, "utf8"), stripped);
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
