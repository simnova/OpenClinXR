import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { selectStationSubset } from "../evidence/station-subset.js";
import { stepsForProfile } from "./agentic-hook-runner.js";

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

function loadCi(): {
  on: Record<string, unknown>;
  group: string;
  cancel: unknown;
  testEnv: Record<string, string>;
  seedRaw: string;
  sampleRaw: string;
} {
  const doc = parseYaml(readFileSync(CI_YML_PATH, "utf8")) as Record<string, unknown>;
  const on = doc["on"] as Record<string, unknown>;
  const concurrency = doc["concurrency"] as { group: string; "cancel-in-progress": unknown };
  const jobs = doc["jobs"] as Record<string, { steps: Array<{ name?: string; env?: Record<string, string> }> }>;
  const testStep = jobs["verify"].steps.find((s) => s.name === "Test");
  if (!testStep?.env) throw new Error("ci.yml Test step has no env");
  return {
    on,
    group: concurrency.group,
    cancel: concurrency["cancel-in-progress"],
    testEnv: testStep.env,
    seedRaw: testStep.env["OPENCLINXR_STATION_SAMPLE_SEED"] ?? "",
    sampleRaw: testStep.env["OPENCLINXR_STATION_SAMPLE"] ?? "",
  };
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
    const { on, testEnv, seedRaw, sampleRaw } = loadCi();
    // `on` triggers: push to main, PRs, one nightly cron, manual dispatch.
    expect(on["pull_request"]).toBeDefined();
    expect(on["push"]).toBeDefined();
    const schedule = on["schedule"] as Array<{ cron: string }> | undefined;
    expect(Array.isArray(schedule) && schedule.length >= 1).toBe(true);
    expect("workflow_dispatch" in on).toBe(true);
    // SEED is derived from the commit under test, never a literal.
    expect(seedRaw).toContain("github.sha");
    const events = ["push", "pull_request", "schedule", "workflow_dispatch"] as const;
    for (const event_name of events) {
      const sample = evaluateCiEnvExpression(sampleRaw, { event_name, sha: FIXTURE_SHA });
      const seed = evaluateCiEnvExpression(seedRaw, { event_name, sha: FIXTURE_SHA });
      if (event_name === "push" || event_name === "pull_request") {
        expect(sample, `SAMPLE for ${event_name}`).toBe("2");
        expect(seed, `SEED for ${event_name}`).toBe(FIXTURE_SHA);
      } else {
        expect(sample, `SAMPLE for ${event_name}`).toBe("");
        expect(seed, `SEED for ${event_name}`).toBe("");
        // Empty string = unset (station-subset.ts:83,88): the scheduled/manual run is a full sweep.
        const subset = selectStationSubset(["s1", "s2", "s3"], {
          OPENCLINXR_STATION_SAMPLE: sample,
          OPENCLINXR_STATION_SAMPLE_SEED: seed,
        });
        expect(subset.full, `full sweep for ${event_name}`).toBe(true);
      }
    }
    expect(testEnv["OPENCLINXR_STATION_SAMPLE_SEED"]).toContain("github.sha");
    void testEnv;
  });

  it("G1-concurrency: scheduled and dispatch runs are not cancelled by a push", () => {
    const { group, cancel } = loadCi();
    const groupMentionsEvent = group.includes("github.event_name");
    const cancelIsConditional =
      typeof cancel === "string" && cancel.includes("github.event_name");
    // Either partitioning the group by event or conditioning cancel-in-progress
    // on push/pull_request keeps a push to main from cancelling the nightly.
    expect(groupMentionsEvent || cancelIsConditional).toBe(true);
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
