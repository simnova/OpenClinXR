/**
 * Run every tools/ test under its authored framework.
 * Manifest: live `vitest list tools --filesOnly` minus the 9 manual, 3 root,
 * 2 shared worktree, and 2 project archive excludes. `node:test` files run
 * under `node --test`; the rest run under Vitest with exact node-file
 * excludes. Both groups always run; combined exit is nonzero if either
 * fails. `--list` prints the manifest.
 *
 * Areas (see tools-test-areas.ts): with no `--area`, the runner hands the
 * manifest to turbo as one cached task per area (`//#test:tools:<area>`), so an
 * unchanged area is a cache hit. `--area <name>` runs one area: files that reach
 * a shared browser/Blender slot run serially in the `serial` area, everything
 * else runs with Vitest's default workers. `--direct` runs every area in this
 * process without turbo; vitest passthrough args imply `--direct`.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";
import {
  assignAreas,
  checkTurboInputs,
  isToolsTestArea,
  syncTurboInputs,
  TOOLS_TEST_AREAS,
  type ToolsTestArea,
  turboTaskName,
} from "./tools-test-areas.js";

export const MANUAL_EXCLUDES: readonly string[] = [
  "tools/openclinxr/evidence/blueprint-voice-simulation-spike.test.ts",
  "tools/openclinxr/evidence/check-github-pages-site.test.ts",
  "tools/openclinxr/evidence/iwsdk-evidence-contract-check.test.ts",
  "tools/openclinxr/evidence/iwsdk-workspace-posture-check.test.ts",
  "tools/openclinxr/evidence/model-vetting-actor-player-runtime-evidence.test.ts",
  "tools/openclinxr/evidence/model-vetting-capture-manifest.test.ts",
  "tools/openclinxr/evidence/model-vetting-runtime-hook-bindings.test.ts",
  "tools/openclinxr/evidence/model-vetting-runtime-mapping-evidence.test.ts",
  "tools/openclinxr/openclaw/agentic-hook-runner.test.ts",
];

export const ROOT_CONFIG_EXCLUDES: readonly string[] = [
  "**/audible-lip-sync-proof/capture.test.mjs",
  "**/audible-lip-sync-proof/source-wiring.test.mjs",
  "**/actor-audio-package-subpath-integration/historical-test-compatibility.test.ts",
];

/**
 * Authoritative project archive excludes live here for history; the runtime
 * value is owned by project-test-scope.ts and re-exported unchanged.
 */
import { PROJECT_ARCHIVE_EXCLUDES } from "./project-test-scope.js";

export { PROJECT_ARCHIVE_EXCLUDES };

/** Known shared module. Its import must succeed — no stale embedded copy. */
export const SHARED_EXCLUDES_MODULE = "packages/cellix/config-vitest/src/worktree-excludes.ts";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((e): e is string => typeof e === "string");
}

export async function loadSharedExcludes(root: string): Promise<string[]> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(resolve(root, SHARED_EXCLUDES_MODULE)).href)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`[run-tools-tests] cannot import shared excludes from ${SHARED_EXCLUDES_MODULE}: ${String(err)}`);
  }
  const { worktreeExcludePatterns } = mod;
  if (!isStringArray(worktreeExcludePatterns)) {
    throw new Error(`[run-tools-tests] ${SHARED_EXCLUDES_MODULE} must export string[] worktreeExcludePatterns`);
  }
  return [...worktreeExcludePatterns];
}

export type Framework = "node" | "vitest";

export class MixedFrameworkError extends Error {
  readonly file: string;
  constructor(file: string) {
    super(
      `Mixed test frameworks in ${file}: imports both node:test and vitest. ` +
        `Split the file or convert it to one framework; refusing to route silently.`,
    );
    this.name = "MixedFrameworkError";
    this.file = file;
  }
}

function specifierFramework(spec: string): Framework | null {
  if (spec === "vitest") return "vitest";
  if (spec === "node:test" || spec.startsWith("node:test/")) return "node";
  return null;
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?jsx?$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function classifySource(sourceText: string, fileName = "test-file.ts"): Framework {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  let hasNode = false;
  let hasVitest = false;
  const note = (f: Framework | null): void => {
    if (f === "node") hasNode = true;
    else if (f === "vitest") hasVitest = true;
  };
  const literal = (expr: ts.Expression | undefined): string | null =>
    expr !== undefined && ts.isStringLiteralLike(expr) ? expr.text : null;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      note(specifierFramework(literal(node.moduleSpecifier) ?? ""));
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
        note(specifierFramework(node.moduleSpecifier.text));
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ref.expression !== undefined) {
        note(specifierFramework(literal(ref.expression) ?? ""));
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        note(specifierFramework(literal(node.arguments[0]) ?? ""));
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        note(specifierFramework(literal(node.arguments[0]) ?? ""));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (hasNode && hasVitest) throw new MixedFrameworkError(fileName);
  return hasNode ? "node" : "vitest";
}

export function classifyFile(absPath: string, root?: string): Framework {
  let text: string;
  try {
    text = readFileSync(absPath, "utf8");
  } catch (err) {
    throw new Error(`Cannot read test file for routing ${(root ? relative(root, absPath) : absPath)}: ${String(err)}`);
  }
  return classifySource(text, absPath);
}

export interface Partition {
  node: string[];
  vitest: string[];
}

export function partitionManifest(manifestRel: readonly string[], root: string): Partition {
  const node: string[] = [];
  const vitest: string[] = [];
  const seen = new Set<string>();
  for (const rel of manifestRel) {
    const key = normalize(rel);
    if (seen.has(key)) continue;
    seen.add(key);
    const abs = isAbsolute(rel) ? rel : resolve(root, rel);
    if (classifyFile(abs, root) === "node") node.push(rel);
    else vitest.push(rel);
  }
  return { node, vitest };
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const TEST_FILE_RE = /(^|[./])(test|spec)\.[cm]?[jt]sx?$/;

export function parseVitestFilesOnly(stdout: string, root: string): string[] {
  const out: string[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(ANSI_RE, "").trim();
    if (line.length === 0 || !TEST_FILE_RE.test(line)) continue;
    const abs = isAbsolute(line) ? line : resolve(root, line);
    if (!existsSync(abs)) continue;
    out.push(relative(root, abs).split(sep).join("/"));
  }
  return out;
}

/** An empty discovery manifest means routing is blind — fail, never run zero files as success. */
export function requireNonEmptyManifest(files: string[]): string[] {
  if (files.length === 0) {
    throw new Error("[run-tools-tests] empty discovery manifest: vitest list found no tools/ test files; refusing to report success on zero files");
  }
  return files;
}

function resolveVitestBin(root: string): string {
  const local = resolve(root, "node_modules/.bin/vitest");
  if (existsSync(local)) return local;
  if (process.platform === "win32" && existsSync(`${local}.cmd`)) return `${local}.cmd`;
  try {
    const req = createRequire(pathToFileURL(resolve(root, "package.json")).href);
    return req.resolve("vitest/vitest.mjs");
  } catch {
    return "vitest";
  }
}

export function buildDiscoveryArgs(allExcludes: readonly string[]): string[] {
  const args = ["list", "tools", "--filesOnly"];
  for (const e of allExcludes) args.push("--exclude", e);
  return args;
}

export async function discoverViaVitestList(root: string, allExcludes: readonly string[]): Promise<string[]> {
  const bin = resolveVitestBin(root);
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolvePromise) => {
    const child = spawn(bin, buildDiscoveryArgs(allExcludes), { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      resolvePromise({ code: 127, stdout, stderr: `${stderr}\nspawn error: ${String(err)}` });
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
  if (result.code !== 0) {
    throw new Error(`vitest list discovery failed (code ${result.code}):\n${result.stderr.slice(-4000)}`);
  }
  return requireNonEmptyManifest(parseVitestFilesOnly(result.stdout, root));
}

export function buildNodeTestArgs(nodeFilesAbs: readonly string[]): string[] {
  return ["--import", "tsx", "--test", "--test-concurrency=2", ...nodeFilesAbs];
}

export function buildVitestRunArgs(
  nodeFilesRel: readonly string[],
  allExcludes: readonly string[],
  passthrough: readonly string[],
): string[] {
  const args = ["run", "tools"];
  for (const e of allExcludes) args.push("--exclude", e);
  for (const f of nodeFilesRel) args.push("--exclude", f);
  args.push(...passthrough);
  return args;
}

/** Vitest args for one area: exact file filters plus the router excludes. */
/** Workers for the non-slot areas; half the cores leaves room for concurrent sessions. */
export const PARALLEL_AREA_WORKERS = "50%";

export function buildAreaVitestArgs(
  mode: "run" | "list",
  areaFilesRel: readonly string[],
  allExcludes: readonly string[],
  serial: boolean,
  passthrough: readonly string[],
): string[] {
  const args = mode === "list" ? ["list", "--filesOnly", ...areaFilesRel] : ["run", ...areaFilesRel];
  for (const e of allExcludes) args.push("--exclude", e);
  // vitest.config.ts stays serial so direct `vitest run` calls (hooks) behave as before;
  // the non-slot areas opt into parallel files here.
  args.push(...(serial ? ["--maxWorkers=1", "--no-file-parallelism"] : ["--file-parallelism", `--maxWorkers=${PARALLEL_AREA_WORKERS}`]));
  if (mode === "run") args.push(...passthrough);
  return args;
}

export interface GroupResult {
  group: "node" | "vitest";
  files: number;
  ms: number;
  code: number;
  skipped: boolean;
}

export function runEcgInputPreflight(root: string): void {
  const collector = resolve(root, "tools/openclinxr/evidence/fixtures/ecg-controls/ecg-input-bootstrap.py");
  if (!existsSync(collector)) {
    throw new Error(`[run-tools-tests] ECG preflight: missing collector at ${collector}`);
  }
  const python = process.env["PYTHON"] ?? "python3";
  const script =
    "import importlib.util, json, sys\n" +
    "p = " + JSON.stringify(collector) + "\n" +
    "spec = importlib.util.spec_from_file_location('ecg_input_bootstrap', p)\n" +
    "m = importlib.util.module_from_spec(spec)\n" +
    "sys.modules[spec.name] = m\n" +
    "spec.loader.exec_module(m)\n" +
    "r = m.materialize(" + JSON.stringify(root) + ")\n" +
    "print('restored=' + str(len(r['restored'])) + ' reused=' + str(len(r['reused'])))\n";
  try {
    execFileSync(python, ["-c", script], { cwd: root, stdio: "inherit" });
  } catch (err) {
    throw new Error(`[run-tools-tests] ECG preflight failed: ${String(err)}`);
  }
}

function runNodeGroup(root: string, nodeFilesRel: readonly string[]): Promise<GroupResult> {
  const started = Date.now();
  if (nodeFilesRel.length === 0) return Promise.resolve({ group: "node", files: 0, ms: 0, code: 0, skipped: true });
  const abs = nodeFilesRel.map((f) => (isAbsolute(f) ? f : resolve(root, f)));
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, buildNodeTestArgs(abs), { cwd: root, stdio: "inherit" });
    child.on("error", (err) => {
      console.error(`[run-tools-tests] node:test group spawn error: ${String(err)}`);
      resolvePromise({ group: "node", files: nodeFilesRel.length, ms: Date.now() - started, code: 1, skipped: false });
    });
    child.on("close", (code) => {
      resolvePromise({ group: "node", files: nodeFilesRel.length, ms: Date.now() - started, code: code ?? 1, skipped: false });
    });
  });
}

async function runVitestGroup(root: string, args: readonly string[], vitestFiles: number): Promise<GroupResult> {
  const started = Date.now();
  if (vitestFiles === 0) return { group: "vitest", files: 0, ms: 0, code: 0, skipped: true };
  const bin = resolveVitestBin(root);
  const code = await new Promise<number>((resolvePromise) => {
    const child = spawn(bin, [...args], { cwd: root, stdio: "inherit" });
    child.on("error", (err) => {
      console.error(`[run-tools-tests] vitest group spawn error: ${String(err)}`);
      resolvePromise(1);
    });
    child.on("close", (c) => {
      resolvePromise(c ?? 1);
    });
  });
  return { group: "vitest", files: vitestFiles, ms: Date.now() - started, code, skipped: false };
}

export interface CliOptions {
  root: string;
  listOnly: boolean;
  manifestOut: string | null;
  passthrough: string[];
  area: ToolsTestArea | null;
  direct: boolean;
  syncTurboInputs: boolean;
}

export function parseCli(argv: string[], cwd: string): CliOptions {
  const opts: CliOptions = {
    root: cwd,
    listOnly: false,
    manifestOut: null,
    passthrough: [],
    area: null,
    direct: false,
    syncTurboInputs: false,
  };
  const rest = [...argv];
  while (rest.length > 0) {
    const a = rest.shift() as string;
    if (a === "--") {
      opts.passthrough.push(...rest);
      break;
    } else if (a === "--list") {
      opts.listOnly = true;
    } else if (a === "--direct") {
      opts.direct = true;
    } else if (a === "--sync-turbo-inputs") {
      opts.syncTurboInputs = true;
    } else if (a === "--area") {
      const v = rest.shift();
      if (!v || !isToolsTestArea(v)) throw new Error(`--area requires one of ${TOOLS_TEST_AREAS.join(", ")}`);
      opts.area = v;
    } else if (a === "--root") {
      const v = rest.shift();
      if (!v) throw new Error("--root requires a value");
      opts.root = resolve(cwd, v);
    } else if (a === "--manifest-out") {
      const v = rest.shift();
      if (!v) throw new Error("--manifest-out requires a value");
      opts.manifestOut = resolve(cwd, v);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

async function listAreaFiles(root: string, args: readonly string[]): Promise<string[]> {
  const bin = resolveVitestBin(root);
  return await new Promise<string[]>((resolvePromise, reject) => {
    const child = spawn(bin, [...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`vitest list for area failed (code ${code}):\n${stderr.slice(-4000)}`));
      else resolvePromise(parseVitestFilesOnly(stdout, root));
    });
  });
}

/** Fail unless the area's vitest filters select exactly the area's files. */
export function assertSameFiles(area: string, expected: readonly string[], listed: readonly string[]): void {
  const want = new Set(expected);
  const got = new Set(listed);
  const missing = [...want].filter((f) => !got.has(f));
  const extra = [...got].filter((f) => !want.has(f));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `[run-tools-tests] area ${area}: vitest filters select a different file set ` +
        `(missing ${missing.length}: ${missing.slice(0, 5).join(", ")}; extra ${extra.length}: ${extra.slice(0, 5).join(", ")})`,
    );
  }
}

async function runArea(
  root: string,
  area: ToolsTestArea,
  partition: Partition,
  areas: Map<string, ToolsTestArea>,
  allExcludes: readonly string[],
  passthrough: readonly string[],
): Promise<{ area: ToolsTestArea; node: GroupResult; vitest: GroupResult }> {
  const nodeFiles = partition.node.filter((f) => areas.get(f) === area);
  const vitestFiles = partition.vitest.filter((f) => areas.get(f) === area);
  const serial = area === "serial";
  console.log(
    `[run-tools-tests] area ${area}: node:test ${nodeFiles.length}, vitest ${vitestFiles.length}${serial ? " (serial)" : ""}`,
  );
  if (vitestFiles.length > 0) {
    const listed = await listAreaFiles(root, buildAreaVitestArgs("list", vitestFiles, allExcludes, serial, []));
    assertSameFiles(area, vitestFiles, listed);
  }
  const node = await runNodeGroup(root, nodeFiles);
  const vitest = await runVitestGroup(
    root,
    buildAreaVitestArgs("run", vitestFiles, allExcludes, serial, passthrough),
    vitestFiles.length,
  );
  return { area, node, vitest };
}

function runTurbo(root: string): Promise<number> {
  const local = resolve(root, "node_modules/.bin/turbo");
  const bin = existsSync(local) ? local : "turbo";
  // Loose env mode: the tests read machine env (BLENDER, OPENCLINXR_*) that strict mode would strip.
  // --continue: one red area must not cancel the others.
  const args = ["run", ...TOOLS_TEST_AREAS.map(turboTaskName), "--env-mode=loose", "--continue"];
  console.log(`[run-tools-tests] turbo ${args.join(" ")}`);
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, {
      cwd: root,
      stdio: "inherit",
      // Same cache dir as the packages:* scripts, so every worktree shares one cache.
      env: {
        ...process.env,
        TURBO_CACHE_DIR: process.env["TURBO_CACHE_DIR"] ?? resolve(homedir(), ".cache/openclinxr/turbo"),
        TURBO_TELEMETRY_DISABLED: "1",
        DO_NOT_TRACK: "1",
        OPENCLINXR_TOOLS_TESTS_PREFLIGHT_DONE: "1",
      },
    });
    child.on("error", (err) => {
      console.error(`[run-tools-tests] turbo spawn error: ${String(err)}`);
      resolvePromise(1);
    });
    child.on("close", (code) => {
      resolvePromise(code ?? 1);
    });
  });
}

export async function main(argv: string[], cwd: string): Promise<number> {
  const opts = parseCli(argv, cwd);
  const root = opts.root;
  if (!existsSync(resolve(root, "package.json")) || !existsSync(resolve(root, "tools"))) {
    throw new Error(`--root ${root} does not look like the repo root (need package.json + tools/)`);
  }
  const shared = await loadSharedExcludes(root);
  const allExcludes = [...MANUAL_EXCLUDES, ...ROOT_CONFIG_EXCLUDES, ...shared, ...PROJECT_ARCHIVE_EXCLUDES];

  const discovered = await discoverViaVitestList(root, allExcludes);
  const partition = partitionManifest(discovered, root);
  const areas = assignAreas(discovered, root);
  const areaCounts = Object.fromEntries(
    TOOLS_TEST_AREAS.map((a) => [a, [...areas.values()].filter((v) => v === a).length]),
  );
  const manifest = {
    root,
    discovered: discovered.length,
    nodeFiles: partition.node,
    vitestFiles: partition.vitest,
    areaCounts,
    areas: Object.fromEntries([...areas].sort(([a], [b]) => a.localeCompare(b))),
    excludes: {
      manual: [...MANUAL_EXCLUDES],
      rootConfig: [...ROOT_CONFIG_EXCLUDES],
      shared,
      projectArchives: [...PROJECT_ARCHIVE_EXCLUDES],
    },
  };

  if (opts.manifestOut) {
    writeFileSync(opts.manifestOut, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`[run-tools-tests] manifest written to ${opts.manifestOut}`);
  }
  if (opts.listOnly) {
    console.log(JSON.stringify(manifest, null, 2));
    return 0;
  }
  if (opts.syncTurboInputs) {
    const changed = syncTurboInputs(root, areas);
    console.log(`[run-tools-tests] turbo.json inputs ${changed ? "updated" : "already current"}`);
    return 0;
  }

  console.log(
    `[run-tools-tests] manifest: ${discovered.length} files → node:test ${partition.node.length}, vitest ${partition.vitest.length}; areas ${JSON.stringify(areaCounts)}`,
  );

  // A stale turbo input list would let an area cache-hit on a changed file it imports.
  const stale = checkTurboInputs(root, areas, opts.area === null ? TOOLS_TEST_AREAS : [opts.area]);
  if (stale.length > 0) {
    throw new Error(
      `[run-tools-tests] turbo.json inputs miss imported files:\n${stale.slice(0, 20).join("\n")}\n` +
        "Run: pnpm exec tsx tools/openclinxr/openclaw/run-tools-tests.ts --sync-turbo-inputs",
    );
  }

  if (process.env["OPENCLINXR_TOOLS_TESTS_PREFLIGHT_DONE"] !== "1") runEcgInputPreflight(root);

  if (opts.area === null && !opts.direct && opts.passthrough.length === 0) {
    return await runTurbo(root);
  }

  const selected = opts.area === null ? TOOLS_TEST_AREAS : [opts.area];
  const results = [];
  for (const area of selected) {
    results.push(await runArea(root, area, partition, areas, allExcludes, opts.passthrough));
  }
  const exit = results.map((r) => (r.node.code !== 0 ? r.node.code : r.vitest.code)).find((c) => c !== 0) ?? 0;
  console.log(`[run-tools-tests] summary: ${JSON.stringify({ areas: results, exit })}`);
  return exit;
}

const invokedAsScript = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return pathToFileURL(resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main(process.argv.slice(2), process.cwd()).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`[run-tools-tests] FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      process.exitCode = 2;
    },
  );
}
