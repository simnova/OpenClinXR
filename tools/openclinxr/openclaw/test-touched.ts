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

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "../../.."));

function gitLines(args: string[]): string[] {
  try {
    const out = execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
    return out.split("\n").map((l: string) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Repo-relative .ts/.tsx paths changed vs HEAD: staged + unstaged + untracked. */
export function touchedSourceFiles(): string[] {
  const staged = gitLines(["diff", "--name-only", "--cached", "HEAD"]);
  const unstaged = gitLines(["diff", "--name-only"]);
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"]);
  const seen = new Set<string>();
  for (const f of [...staged, ...unstaged, ...untracked]) {
    if ((f.endsWith(".ts") || f.endsWith(".tsx")) && !seen.has(f)) seen.add(f);
  }
  return [...seen].sort();
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

function run(cmd: string[], opts: { cwd?: string } = {}): number {
  const r = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd: opts.cwd ?? REPO_ROOT,
    stdio: "inherit",
    shell: false,
  });
  return r.status ?? 1;
}

/**
 * Planted REDs (tests committed failing ahead of the slice that makes them pass)
 * would block every commit whose related set reaches them. They are listed in
 * known-red-tests.json with the reason and the card that turns them green, and
 * are excluded here; the list is printed so the exclusion is never silent.
 */
export function knownRedTests(): { path: string; reason: string; card: string }[] {
  const file = join(REPO_ROOT, "tools/openclinxr/openclaw/known-red-tests.json");
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, "utf8")) as { tests: { path: string; reason: string; card: string }[] }).tests;
}

function main(): void {
  const start = Date.now();
  const files = touchedSourceFiles();
  const plan = planTests(files);
  if (plan.kind === "none") {
    console.log("no related tests");
    return;
  }
  let code = 0;
  const red = knownRedTests();
  for (const t of red) console.log(`test:touched: excluding known RED ${t.path} (${t.card})`);
  const redExcludes = red.flatMap((t) => ["--exclude", t.path]);
  if (plan.rootFiles.length > 0) {
    code = run(["pnpm", "exec", "vitest", "related", "--run", "--passWithNoTests", ...redExcludes, ...plan.rootFiles]) || code;
  }
  for (const [pkg, group] of plan.byPackage) {
    // Known-RED paths are repo-relative; only those under this owner apply here.
    const redArgs = red
      .filter((t) => t.path === group.dir || t.path.startsWith(`${group.dir}/`))
      .flatMap((t) => ["--exclude", relative(group.dir, t.path)]);
    const unitFiles = group.files.filter((f) => !f.startsWith("src/archunit-tests/"));
    const archFiles = group.files.filter((f) => f.startsWith("src/archunit-tests/"));
    if (unitFiles.length > 0) {
      code = run(["pnpm", "--filter", pkg, "exec", "vitest", "related", "--run", "--passWithNoTests", ...redArgs, ...unitFiles]) || code;
    }
    if (archFiles.length > 0) {
      // The default package config excludes src/archunit-tests/** (nodeConfig);
      // those suites run under vitest.arch.config.ts (archConfig: globals, node
      // env, include src/archunit-tests/**). Without this the filter matches no
      // files and --passWithNoTests would silently skip the gate.
      const archConfigArgs = existsSync(join(REPO_ROOT, group.dir, "vitest.arch.config.ts"))
        ? ["--config", "vitest.arch.config.ts"]
        : [];
      code = run(["pnpm", "--filter", pkg, "exec", "vitest", ...archConfigArgs, "related", "--run", "--passWithNoTests", ...redArgs, ...archFiles]) || code;
    }
  }
  console.log(`test:touched: ${files.length} touched file(s) in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  process.exit(code);
}

const isMain =
  Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) main();
