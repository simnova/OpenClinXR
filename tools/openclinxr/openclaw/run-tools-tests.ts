/**
 * Run every tools/ test under its authored framework.
 * Manifest: live `vitest list tools --filesOnly` minus the 9 manual, 3 root,
 * 2 shared worktree, and 2 project archive excludes. `node:test` files run
 * under `node --test`; the rest run under Vitest with exact node-file
 * excludes. Both groups always run; combined exit is nonzero if either
 * fails. `--list` prints the manifest.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";

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

export interface GroupResult {
  group: "node" | "vitest";
  files: number;
  ms: number;
  code: number;
  skipped: boolean;
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

async function runVitestGroup(
  root: string,
  nodeFilesRel: readonly string[],
  allExcludes: readonly string[],
  passthrough: readonly string[],
  vitestFiles: number,
): Promise<GroupResult> {
  const started = Date.now();
  if (vitestFiles === 0) return { group: "vitest", files: 0, ms: 0, code: 0, skipped: true };
  const bin = resolveVitestBin(root);
  const code = await new Promise<number>((resolvePromise) => {
    const child = spawn(bin, buildVitestRunArgs(nodeFilesRel, allExcludes, passthrough), { cwd: root, stdio: "inherit" });
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
}

export function parseCli(argv: string[], cwd: string): CliOptions {
  const opts: CliOptions = { root: cwd, listOnly: false, manifestOut: null, passthrough: [] };
  const rest = [...argv];
  while (rest.length > 0) {
    const a = rest.shift() as string;
    if (a === "--") {
      opts.passthrough.push(...rest);
      break;
    } else if (a === "--list") {
      opts.listOnly = true;
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
  const manifest = {
    root,
    discovered: discovered.length,
    nodeFiles: partition.node,
    vitestFiles: partition.vitest,
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

  console.log(`[run-tools-tests] manifest: ${discovered.length} files → node:test ${partition.node.length}, vitest ${partition.vitest.length}`);

  const nodeResult = await runNodeGroup(root, partition.node);
  const vitestResult = await runVitestGroup(root, partition.node, allExcludes, opts.passthrough, partition.vitest.length);

  const summary = {
    manifest: { discovered: discovered.length, node: partition.node.length, vitest: partition.vitest.length },
    node: nodeResult,
    vitest: vitestResult,
    exit: nodeResult.code !== 0 ? nodeResult.code : vitestResult.code,
  };
  console.log(`[run-tools-tests] summary: ${JSON.stringify(summary)}`);
  return summary.exit;
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
