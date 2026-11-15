#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  declaredHiddenFacts,
  SCANNED_EXTENSIONS,
  SCANNED_ROOTS,
  scanFileForHiddenFacts,
} from "../evidence/licence/hidden-case-facts.js";

export type CommandSpec = {
  command: string;
  args: string[];
  cwd: string;
  input?: string;
};

export type CommandResult = {
  rc: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (spec: CommandSpec) => CommandResult;

export type StageResult = {
  id: string;
  selected: boolean;
  reason: string;
  command: string | null;
  rc: number | null;
  pass: boolean;
};

export type CheckConfig = {
  tree: string;
  base?: string;
  browser?: boolean;
  port?: number;
  json?: string;
  commandRunner?: CommandRunner;
  diagnosticOutput?: string;
  log?: (line: string) => void;
};

export type CheckResult = {
  base: string;
  touched: string[];
  stages: StageResult[];
  rc: number;
};

type ToolsStrictModule = {
  TOOLS_STRICT_ERROR_CEILING: number;
  checkToolsStrictBaseline: (config?: {
    workspaceRoot?: string;
    diagnosticOutput?: string;
  }) => string[];
};

let toolsStrictModulePromise: Promise<ToolsStrictModule> | undefined;

async function loadToolsStrictModule(): Promise<ToolsStrictModule> {
  toolsStrictModulePromise ??= import(
    pathToFileURL(
      path.join(
        findToolWorkspaceRoot(),
        "packages/openclinxr-verification/architecture-rules/src/checks/typecheck-baseline.ts",
      ),
    ).href
  ) as Promise<ToolsStrictModule>;
  return toolsStrictModulePromise;
}

export async function toolsStrictErrorCeiling(): Promise<number> {
  return (await loadToolsStrictModule()).TOOLS_STRICT_ERROR_CEILING;
}

const BIOME_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc"]);
const FOLLOWUP_RE = /^followup.*\.txt$/iu;
const REVIEW_RE = /^REVIEW.*\.md$/u;
const KIND_RE = /^\s*KIND\s*::\s*(review|gate)\b/iu;
const RULING_RE = /RULING:[\w./-]+/u;

function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
}

export const defaultCommandRunner: CommandRunner = ({ command, args, cwd, input }) => {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    env: childEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    rc: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error == null ? "" : `\n${String(result.error)}`}`,
  };
};

function commandText(spec: CommandSpec): string {
  return [spec.command, ...spec.args].map((part) => (/^[A-Za-z0-9_./:=@-]+$/u.test(part) ? part : JSON.stringify(part))).join(" ");
}

function lastLines(text: string, count = 60): string {
  return text.trimEnd().split("\n").slice(-count).join("\n");
}

function runGit(tree: string, args: string[], runner: CommandRunner): CommandResult {
  return runner({ command: "git", args, cwd: tree });
}

function assertGit(result: CommandResult, command: string): string {
  if (result.rc !== 0) throw new Error(`${command} failed rc=${result.rc}\n${lastLines(`${result.stdout}\n${result.stderr}`)}`);
  return result.stdout;
}

export function touchedFiles(tree: string, base: string, runner: CommandRunner = defaultCommandRunner): string[] {
  const diff = assertGit(runGit(tree, ["diff", "--name-only", base, "--"], runner), `git diff --name-only ${base}`);
  const untracked = assertGit(
    runGit(tree, ["ls-files", "--others", "--exclude-standard"], runner),
    "git ls-files --others --exclude-standard",
  );
  return [...new Set(`${diff}\n${untracked}`.split("\n").map((file) => file.trim()).filter(Boolean))].sort();
}

function findToolWorkspaceRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 10; index += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("worker-round-gate workspace root not found");
}

function parseBiomeErrors(output: string, rc: number): number {
  const match = output.match(/Found (\d+) errors?\./u);
  if (match?.[1] != null) return Number(match[1]);
  if (rc === 0) return 0;
  throw new Error(`Biome failed without an error-count summary (rc=${rc})\n${lastLines(output)}`);
}

function biomeCountInTree(
  tree: string,
  file: string,
  biome: string,
  runner: CommandRunner,
): { count: number; command: string; output: string; rc: number } {
  if (!existsSync(path.join(tree, file))) return { count: 0, command: `${biome} check ${file}`, output: "deleted", rc: 0 };
  const spec = {
    command: biome,
    args: ["check", "--diagnostic-level=error", "--max-diagnostics=none", file],
    cwd: tree,
  } satisfies CommandSpec;
  const result = runner(spec);
  const output = `${result.stdout}\n${result.stderr}`;
  return { count: parseBiomeErrors(output, result.rc), command: commandText(spec), output, rc: result.rc };
}

function biomeCountAtBase(
  tree: string,
  base: string,
  file: string,
  biome: string,
  runner: CommandRunner,
): number {
  const shown = runGit(tree, ["show", `${base}:${file}`], runner);
  if (shown.rc !== 0) return 0;
  const scratch = mkdtempSync(path.join(tmpdir(), `worker-round-gate-biome-${process.pid}-`));
  try {
    const config = path.join(tree, "biome.json");
    if (!existsSync(config)) throw new Error(`biome config not found: ${config}`);
    copyFileSync(config, path.join(scratch, "biome.json"));
    const target = path.join(scratch, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, shown.stdout, "utf8");
    const spec = {
      command: biome,
      args: ["check", "--vcs-enabled=false", "--diagnostic-level=error", "--max-diagnostics=none", file],
      cwd: scratch,
    } satisfies CommandSpec;
    const result = runner(spec);
    return parseBiomeErrors(`${result.stdout}\n${result.stderr}`, result.rc);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function packageDirsForTouched(tree: string, touched: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const file of touched) {
    let dir = path.dirname(path.join(tree, file));
    while (dir.startsWith(`${tree}${path.sep}`) || dir === tree) {
      const manifest = path.join(dir, "package.json");
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> };
        if (pkg.scripts?.["typecheck"] != null) dirs.add(dir);
        break;
      }
      if (dir === tree) break;
      dir = path.dirname(dir);
    }
  }
  return [...dirs].sort();
}

function isUnderScannedRoot(file: string): boolean {
  return SCANNED_ROOTS.some((root) => file === root || file.startsWith(`${root}/`));
}

function architectureTriggered(file: string): boolean {
  return (
    path.basename(file) === "package.json" ||
    file.endsWith("/src/index.ts") ||
    path.basename(file).includes("public-api") ||
    file.split("/").includes("admissions")
  );
}

function biomeHandles(file: string): boolean {
  if (!BIOME_EXTENSIONS.has(path.extname(file).toLowerCase())) return false;
  if (!file.includes("/")) return path.extname(file) === ".json" || path.extname(file) === ".jsonc";
  return file.startsWith("apps/") || file.startsWith("packages/") || file.startsWith("tools/");
}

function stageSkipped(id: string, reason: string, log: (line: string) => void): StageResult {
  log(`STAGE ${id} SKIPPED ${reason}`);
  return { id, selected: false, reason, command: null, rc: null, pass: true };
}

function stageSelected(
  id: string,
  reason: string,
  command: string,
  result: CommandResult,
  log: (line: string) => void,
): StageResult {
  const pass = result.rc === 0;
  log(`STAGE ${id} SELECTED ${reason}`);
  if (!pass) {
    log(`STAGE ${id} FAILED command=${command} rc=${result.rc}`);
    const tail = lastLines(`${result.stdout}\n${result.stderr}`);
    if (tail.length > 0) log(tail);
  }
  return { id, selected: true, reason, command, rc: result.rc, pass };
}

function combineResults(results: readonly { spec: CommandSpec; result: CommandResult }[]): CommandResult {
  const failed = results.find(({ result }) => result.rc !== 0);
  return {
    rc: failed?.result.rc ?? 0,
    stdout: results.map(({ spec, result }) => `$ ${commandText(spec)}\n${result.stdout}`).join("\n"),
    stderr: results.map(({ result }) => result.stderr).join("\n"),
  };
}

function summarizeRuns(results: readonly { spec: CommandSpec; result: CommandResult }[]): {
  command: string;
  result: CommandResult;
} {
  const failed = results.find(({ result }) => result.rc !== 0);
  if (failed != null) return { command: commandText(failed.spec), result: failed.result };
  return { command: results.map(({ spec }) => commandText(spec)).join(" && "), result: combineResults(results) };
}

export async function runCheck(config: CheckConfig): Promise<CheckResult> {
  const tree = path.resolve(config.tree);
  const base = config.base ?? "origin/main";
  const runner = config.commandRunner ?? defaultCommandRunner;
  const log = config.log ?? console.log;
  const touched = touchedFiles(tree, base, runner);
  const stages: StageResult[] = [];

  const biomeFiles = touched.filter(biomeHandles);
  if (biomeFiles.length === 0) {
    stages.push(stageSkipped("G1", "no touched Biome-handled files", log));
  } else {
    const biome = path.join(findToolWorkspaceRoot(), "node_modules", ".bin", "biome");
    const failures: string[] = [];
    let failureCommand = `${biome} check`;
    for (const file of biomeFiles) {
      const current = biomeCountInTree(tree, file, biome, runner);
      const baseline = biomeCountAtBase(tree, base, file, biome, runner);
      if (current.count > baseline) {
        failureCommand = current.command;
        failures.push(`${file}: error-level diagnostics ${baseline} -> ${current.count}\n${lastLines(current.output)}`);
      }
    }
    stages.push(
      stageSelected(
        "G1",
        `${biomeFiles.length} touched Biome-handled file(s)`,
        failureCommand,
        { rc: failures.length === 0 ? 0 : 1, stdout: failures.join("\n"), stderr: "" },
        log,
      ),
    );
  }

  const packageDirs = packageDirsForTouched(tree, touched);
  const toolsTouched = touched.some((file) => file.startsWith("tools/"));
  if (packageDirs.length === 0 && !toolsTouched) {
    stages.push(stageSkipped("G2", "no touched package with typecheck and no tools/** change", log));
  } else {
    const runs: { spec: CommandSpec; result: CommandResult }[] = packageDirs.map((dir) => {
      const spec = { command: "pnpm", args: ["--dir", dir, "typecheck"], cwd: tree } satisfies CommandSpec;
      return { spec, result: runner(spec) };
    });
    if (toolsTouched) {
      const { checkToolsStrictBaseline } = await loadToolsStrictModule();
      const violations = checkToolsStrictBaseline(
        config.diagnosticOutput === undefined ? { workspaceRoot: tree } : { diagnosticOutput: config.diagnosticOutput },
      );
      runs.push({
        spec: { command: "checkToolsStrictBaseline()", args: [], cwd: tree },
        result: { rc: violations.length === 0 ? 0 : 1, stdout: violations.join("\n"), stderr: "" },
      });
    }
    const summary = summarizeRuns(runs);
    stages.push(
      stageSelected(
        "G2",
        `${packageDirs.length} touched package(s); toolsTouched=${String(toolsTouched)}`,
        summary.command,
        summary.result,
        log,
      ),
    );
  }

  const architectureFiles = touched.filter(architectureTriggered);
  if (architectureFiles.length === 0) {
    stages.push(stageSkipped("G3", "no package.json, src/index.ts, public-api, or admissions change", log));
  } else {
    const specs = [
      { command: "pnpm", args: ["--filter", "@openclinxr/architecture-rules", "test"], cwd: tree },
      { command: "pnpm", args: ["architecture"], cwd: tree },
    ] satisfies CommandSpec[];
    const runs = specs.map((spec) => ({ spec, result: runner(spec) }));
    const summary = summarizeRuns(runs);
    stages.push(stageSelected("G3", architectureFiles.join(", "), summary.command, summary.result, log));
  }

  const leakFiles = touched.filter(
    (file) => isUnderScannedRoot(file) && SCANNED_EXTENSIONS.has(path.extname(file).toLowerCase()),
  );
  if (leakFiles.length === 0) {
    stages.push(stageSkipped("G4", "no touched scanned-root file with a scanned extension", log));
  } else {
    const facts = declaredHiddenFacts(tree);
    const leaks = leakFiles.flatMap((file) =>
      scanFileForHiddenFacts(tree, file, facts).map((leak) => `${file}: hidden fact index ${leak.factIndex}`),
    );
    stages.push(
      stageSelected(
        "G4",
        `${leakFiles.length} touched scanned-root file(s), including untracked`,
        "scanFileForHiddenFacts(touched)",
        { rc: leaks.length === 0 ? 0 : 1, stdout: leaks.join("\n"), stderr: "" },
        log,
      ),
    );
  }

  const pages = touched.filter((file) => /^docs\/[^/]+\.html$/u.test(file) || file.startsWith("docs/site/"));
  if (pages.length === 0) {
    stages.push(stageSkipped("G5", "no touched docs/*.html or docs/site/** file", log));
    stages.push(stageSkipped("G5b", "G5 not selected", log));
  } else {
    const spec = { command: "pnpm", args: ["pages:validate"], cwd: tree } satisfies CommandSpec;
    stages.push(stageSelected("G5", pages.join(", "), commandText(spec), runner(spec), log));
    const htmlPages = pages.filter((file) => /^docs\/[^/]+\.html$/u.test(file));
    if (!config.browser) {
      stages.push(stageSkipped("G5b", "no-browser", log));
    } else if (htmlPages.length === 0) {
      stages.push(stageSkipped("G5b", "no touched docs/*.html page", log));
    } else {
      if (config.port == null) throw new Error("--browser requires --port <n>");
      const script = path.join(tree, "tools/openclinxr/evidence/site/capture/layout-render-gate.mjs");
      const specs = htmlPages.map(
        (page) => ({ command: "node", args: [script, page, String(config.port)], cwd: tree }) satisfies CommandSpec,
      );
      const runs = specs.map((browserSpec) => ({ spec: browserSpec, result: runner(browserSpec) }));
      const summary = summarizeRuns(runs);
      stages.push(stageSelected("G5b", `${htmlPages.length} page(s) at 1280 and 390`, summary.command, summary.result, log));
    }
  }

  const driftFiles = touched.filter(
    (file) => file.endsWith(".md") || /(^|\/)[^/]*registry[^/]*\.json$/iu.test(file) || file.startsWith("agents/rules/"),
  );
  if (driftFiles.length === 0) {
    stages.push(stageSkipped("G6", "no touched .md, *registry*.json, or agents/rules/** file", log));
  } else {
    const spec = { command: "pnpm", args: ["docs:drift-check"], cwd: tree } satisfies CommandSpec;
    stages.push(stageSelected("G6", driftFiles.join(", "), commandText(spec), runner(spec), log));
  }

  const result = { base, touched, stages, rc: stages.every((stage) => stage.pass) ? 0 : 1 } satisfies CheckResult;
  if (config.json != null) {
    mkdirSync(path.dirname(path.resolve(config.json)), { recursive: true });
    writeFileSync(
      path.resolve(config.json),
      `${JSON.stringify({ base, touched, stages }, null, 2)}\n`,
      "utf8",
    );
  }
  return result;
}

function firstLine(file: string): string {
  return readFileSync(file, "utf8").split(/\r?\n/u)[0] ?? "";
}

function followupFiles(job: string): string[] {
  return readdirSync(job).filter((file) => FOLLOWUP_RE.test(file)).sort();
}

export function runFollowupCheck(job: string, followup: string, log: (line: string) => void = console.log): number {
  const target = path.resolve(followup);
  const line = firstLine(target);
  const kind = line.match(KIND_RE)?.[1]?.toLowerCase();
  if (kind == null) {
    log("add KIND::review|KIND::gate");
    return 4;
  }
  if (kind === "gate") return 0;
  const earlierReviews = followupFiles(job).filter((file) => {
    const full = path.resolve(job, file);
    return full !== target && firstLine(full).match(KIND_RE)?.[1]?.toLowerCase() === "review";
  });
  if (earlierReviews.length >= 1 && !RULING_RE.test(readFileSync(target, "utf8"))) {
    log("REFUSED second review-driven follow-up without RULING:<id> (RC1, super-ceo-round-cap-rulings-cap28.txt)");
    return 3;
  }
  return 0;
}

export type Rc5Metrics = {
  card: string;
  review: number;
  gate: number;
  legacy: number;
  reviews: number;
};

export function runClose(job: string, log: (line: string) => void = console.log): Rc5Metrics {
  const counts = { review: 0, gate: 0, legacy: 0 };
  for (const file of followupFiles(job)) {
    const kind = firstLine(path.join(job, file)).match(KIND_RE)?.[1]?.toLowerCase();
    if (kind === "review") counts.review += 1;
    else if (kind === "gate") counts.gate += 1;
    else counts.legacy += 1;
  }
  const metrics = {
    card: path.basename(path.resolve(job)),
    review: counts.review,
    gate: counts.gate,
    legacy: counts.legacy,
    reviews: readdirSync(job).filter((file) => REVIEW_RE.test(file) && statSync(path.join(job, file)).isFile()).length,
  } satisfies Rc5Metrics;
  log(
    `RC5 card=${metrics.card} followups review=${counts.review} gate=${counts.gate} legacy=${counts.legacy} reviews=${metrics.reviews}`,
  );
  writeFileSync(path.join(job, "rc5.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  return metrics;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function usage(message?: string): never {
  if (message != null) console.error(message);
  console.error(
    "usage: worker-round-gate.ts check --tree <worktree> [--base origin/main] [--browser --port <n>] [--json <out>] | followup-check --job <jobdir> --followup <file> | close --job <jobdir>",
  );
  process.exit(2);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const subcommand = args[0];
  try {
    if (subcommand === "check") {
      const tree = option(args, "--tree");
      if (tree == null) usage("check requires --tree <worktree>");
      const browser = args.includes("--browser");
      const portRaw = option(args, "--port");
      const json = option(args, "--json");
      if (browser && portRaw == null) usage("--browser requires --port <n>");
      return (
        await runCheck({
        tree,
        base: option(args, "--base") ?? "origin/main",
        browser,
        ...(portRaw == null ? {} : { port: Number(portRaw) }),
        ...(json == null ? {} : { json }),
        })
      ).rc;
    }
    if (subcommand === "followup-check") {
      const job = option(args, "--job");
      const followup = option(args, "--followup");
      if (job == null || followup == null) usage("followup-check requires --job and --followup");
      return runFollowupCheck(path.resolve(job), path.resolve(followup));
    }
    if (subcommand === "close") {
      const job = option(args, "--job");
      if (job == null) usage("close requires --job <jobdir>");
      runClose(path.resolve(job));
      return 0;
    }
    usage(`unknown subcommand: ${String(subcommand)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
