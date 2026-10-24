#!/usr/bin/env tsx
/**
 * test:touched — run only the tests related to files changed vs HEAD.
 *
 * Worker iteration loop: `pnpm test:touched` after each edit; `git commit`
 * runs the affected suites via the pre-commit hook and is the full gate.
 *
 * Changed set = staged + unstaged + untracked `.ts`/`.tsx` files vs HEAD.
 * Execution uses vitest's `related` mode (vitest 4.1.5 installed:
 * `vitest related [...filters]` runs test files that import the given
 * source files), so unrelated suites never run. When nothing changed it
 * prints "no related tests" and exits 0.
 *
 * Partition: files under `tools/` run under the root vitest config
 * (`vitest.config.ts`); files under a workspace package run under that
 * package's own config via `pnpm --filter <name> exec vitest related`,
 * because per-package aliases/setup live in the package config and the
 * root config cannot provide them. Files under `src/archunit-tests/` in a
 * package that carries `vitest.arch.config.ts` run under that config instead:
 * the default package config excludes `src/archunit-tests/**`, so without the
 * override the filter would match no files and `--passWithNoTests` would
 * silently skip the gate.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";
import {
  realGroupExec,
  routeRelatedGroup,
  type KnownRedEntry,
  type RouteRequest,
} from "./test-framework-routing.js";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "../../.."));

function gitLines(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string[] {
  try {
    const out = execFileSync("git", args, {
      cwd: opts.cwd ?? REPO_ROOT,
      encoding: "utf8",
      env: opts.env ?? gitEnvWithoutInheritedRepoVars(),
    });
    return out.split("\n").map((l: string) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Repo-relative .ts/.tsx paths changed vs HEAD: staged + unstaged + untracked. */
export function touchedSourceFiles(opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string[] {
  const staged = gitLines(["diff", "--name-only", "--cached", "HEAD"], opts);
  const unstaged = gitLines(["diff", "--name-only"], opts);
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"], opts);
  const seen = new Set<string>();
  for (const f of [...staged, ...unstaged, ...untracked]) {
    if ((f.endsWith(".ts") || f.endsWith(".tsx")) && !seen.has(f)) seen.add(f);
  }
  return [...seen].sort();
}

/**
 * Explicit commit file set (ph114): the pre-commit hook resolves the staged set
 * once — under the caller's commit index — and passes it here as a structured
 * CLI arg (`--commit-files-b64 <base64(JSON string[])>`). Commit mode consumes
 * that list EXCLUSIVELY: it never re-queries staged/unstaged/untracked/real
 * index, so unrelated working changes cannot leak into the commit gate.
 * Default interactive behavior (no flag) is unchanged.
 */
export const COMMIT_FILES_B64_FLAG = "--commit-files-b64";

/** Base64(JSON string[]) encoding shared with agentic-hook-runner.ts. */
export function encodeCommitFileSet(files: string[]): string {
  return Buffer.from(JSON.stringify([...files]), "utf8").toString("base64");
}

/**
 * Decode + validate an explicit commit file set. THROWS on malformed input
 * (fail closed: the caller must refuse the gate, never fall back to a
 * re-queried working set).
 */
export function decodeCommitFileSet(b64: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    throw new Error("test:touched: malformed --commit-files-b64 payload (not base64 JSON)");
  }
  if (!Array.isArray(parsed) || parsed.some((f) => typeof f !== "string" || f.length === 0)) {
    throw new Error("test:touched: malformed --commit-files-b64 payload (expected JSON array of non-empty strings)");
  }
  for (const f of parsed as string[]) {
    if (f.startsWith("/") || f.includes("\\") || f.split("/").includes("..") || f.includes("\0")) {
      throw new Error(`test:touched: malformed --commit-files-b64 payload (unsafe path: ${f})`);
    }
  }
  return [...new Set(parsed as string[])].sort();
}

/**
 * Returns the explicit commit file set when `--commit-files-b64` is present,
 * or null for default interactive mode (staged+unstaged+untracked vs HEAD).
 * THROWS on malformed payload (fail closed).
 */
export function commitFileSetFromArgs(argv: string[]): string[] | null {
  const at = argv.indexOf(COMMIT_FILES_B64_FLAG);
  if (at === -1) return null;
  const b64 = argv[at + 1];
  if (b64 === undefined) {
    throw new Error("test:touched: --commit-files-b64 requires a value");
  }
  return decodeCommitFileSet(b64);
}

export type TestPlan =
  | { kind: "none" }
  | { kind: "run"; rootFiles: string[]; byPackage: Map<string, { dir: string; files: string[] }> };

function packageNameFor(dir: string, root: string = REPO_ROOT): string | null {
  const pkgJson = join(root, dir, "package.json");
  if (!existsSync(pkgJson)) return null;
  try {
    const name = (JSON.parse(readFileSync(pkgJson, "utf8")) as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/**
 * Split touched files into root-config files (tools/, repo root) and
 * per-package groups (packages/<p>/..., apps/<a>/... with a package.json).
 * Files under a directory with no package.json fall back to the root config.
 */
export function planTests(files: string[], root: string = REPO_ROOT): TestPlan {
  const rootFiles: string[] = [];
  const byPackage = new Map<string, { dir: string; files: string[] }>();
  for (const f of files) {
    if (/^(packages|apps)\//u.test(f)) {
      // Longest owner dir that carries a package.json (nested packages exist).
      let owner: string | null = null;
      const parts = dirname(f).split("/").filter(Boolean);
      for (let i = parts.length; i >= 1; i--) {
        const dir = parts.slice(0, i).join("/");
        if (packageNameFor(dir, root)) { owner = dir; break; }
      }
      const pkg = owner ? packageNameFor(owner, root) : null;
      if (owner && pkg) {
        const rel = relative(owner, f);
        let group = byPackage.get(pkg);
        if (!group) { group = { dir: owner, files: [] }; byPackage.set(pkg, group); }
        group.files.push(rel);
        continue;
      }
    }
    rootFiles.push(f);
  }
  if (rootFiles.length === 0 && byPackage.size === 0) return { kind: "none" };
  return { kind: "run", rootFiles, byPackage };
}

function redCardFor(red: readonly KnownRedEntry[], path: string): string {
  return red.find((t) => t.path === path)?.card ?? "unknown";
}

function logRoutedOutcome(label: string, outcome: {
  candidates: { vitest: string[]; node: string[]; playwright: string[] };
  selectedNode: string[];
  selectedPlaywright: string[];
  redExcludedFromRouted: string[];
  ranVitest: boolean;
  ranNode: boolean;
  ranPlaywright: boolean;
  vitestCode: number;
  nodeCode: number;
  playwrightCode: number;
}, red: readonly KnownRedEntry[]): void {
  const total = outcome.candidates.vitest.length + outcome.candidates.node.length + outcome.candidates.playwright.length;
  console.log(
    `test:touched: routing ${label}: ${total} candidate(s) ` +
    `(vitest ${outcome.candidates.vitest.length}, node ${outcome.candidates.node.length}, ` +
    `playwright ${outcome.candidates.playwright.length}); selected node ${outcome.selectedNode.length}, ` +
    `playwright ${outcome.selectedPlaywright.length}; ran vitest=${outcome.ranVitest ? "yes" : "no"} ` +
    `(exit ${outcome.vitestCode}) node=${outcome.ranNode ? "yes" : "no"} (exit ${outcome.nodeCode}) ` +
    `playwright=${outcome.ranPlaywright ? "yes" : "no"} (exit ${outcome.playwrightCode})`,
  );
  for (const f of outcome.redExcludedFromRouted) {
    console.log(`test:touched: excluding known RED ${f} from routed runner (${redCardFor(red, f)})`);
  }
}

/**
 * Planted REDs (tests committed failing ahead of the slice that makes them pass)
 * would block every commit whose related set reaches them. They are listed in
 * known-red-tests.json with the reason and the card that turns them green, and
 * are excluded here; the list is printed so the exclusion is never silent.
 * The same JSON entries filter node/playwright selection verbatim (no
 * additions, no removals) via the framework router.
 */
export function knownRedTests(): { path: string; reason: string; card: string }[] {
  const file = join(REPO_ROOT, "tools/openclinxr/openclaw/known-red-tests.json");
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, "utf8")) as { tests: { path: string; reason: string; card: string }[] }).tests;
}

function main(): void {
  const start = Date.now();
  let files: string[];
  let commitMode = false;
  try {
    const explicit = commitFileSetFromArgs(process.argv.slice(2));
    if (explicit !== null) {
      // Commit mode: the hook's exact staged list. Same .ts/.tsx filter as the
      // interactive set, but NEVER re-query git (no staged/unstaged/untracked
      // merge, no real-index read under a commit temp index).
      commitMode = true;
      files = explicit.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    } else {
      files = touchedSourceFiles();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const plan = planTests(files);
  if (plan.kind === "none") {
    console.log("no related tests");
    return;
  }
  let code = 0;
  const red = knownRedTests();
  for (const t of red) console.log(`test:touched: excluding known RED ${t.path} (${t.card})`);
  const redExcludes = red.map((t) => t.path);
  const exec = realGroupExec(gitEnvWithoutInheritedRepoVars());
  const route = (req: RouteRequest): void => {
    const outcome = routeRelatedGroup(req, exec);
    logRoutedOutcome(req.label, outcome, red);
    code = outcome.code || code;
  };
  try {
    if (plan.rootFiles.length > 0) {
      // Root group: `vitest related` keeps its exact flags; non-Vitest
      // candidates are excluded from it and run under their own runner.
      // touchedRel carries the FULL touched set so cross-boundary static
      // edges (e.g. a test importing a tools/ file) still select.
      route({
        root: REPO_ROOT,
        cwd: REPO_ROOT,
        label: "root",
        vitestPrefix: ["pnpm", "exec", "vitest"],
        sources: plan.rootFiles,
        redExcludes,
        redEntries: red,
        touchedRel: files,
        ownerDir: null,
      });
    }
    for (const [pkg, group] of plan.byPackage) {
      // Known-RED paths are repo-relative; only those under this owner apply here.
      const ownerReds = red.filter((t) => t.path === group.dir || t.path.startsWith(`${group.dir}/`));
      const redArgs = ownerReds.map((t) => relative(group.dir, t.path));
      const unitFiles = group.files.filter((f) => !f.startsWith("src/archunit-tests/"));
      const archFiles = group.files.filter((f) => f.startsWith("src/archunit-tests/"));
      if (unitFiles.length > 0) {
        route({
          root: REPO_ROOT,
          cwd: REPO_ROOT,
          label: pkg,
          vitestPrefix: ["pnpm", "--filter", pkg, "exec", "vitest"],
          sources: unitFiles,
          redExcludes: redArgs,
          redEntries: ownerReds,
          touchedRel: files,
          ownerDir: group.dir,
        });
      }
      if (archFiles.length > 0) {
        // The default package config excludes src/archunit-tests/** (nodeConfig);
        // those suites run under vitest.arch.config.ts (archConfig: globals, node
        // env, include src/archunit-tests/**). Without this the filter matches no
        // files and --passWithNoTests would silently skip the gate.
        const archConfigArgs = existsSync(join(REPO_ROOT, group.dir, "vitest.arch.config.ts"))
          ? ["--config", "vitest.arch.config.ts"]
          : [];
        route({
          root: REPO_ROOT,
          cwd: REPO_ROOT,
          label: `${pkg}[arch]`,
          vitestPrefix: ["pnpm", "--filter", pkg, "exec", "vitest", ...archConfigArgs],
          sources: archFiles,
          redExcludes: redArgs,
          redEntries: ownerReds,
          touchedRel: files,
          ownerDir: group.dir,
        });
      }
    }
  } catch (error) {
    // Discovery failure is fail closed: never fall back to an unrouted run
    // that would execute Playwright specs under Vitest.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  console.log(
    `test:touched: ${files.length} touched file(s) in ${((Date.now() - start) / 1000).toFixed(1)}s${commitMode ? " (explicit commit file set)" : ""}`,
  );
  process.exit(code);
}

const isMain =
  Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) main();
