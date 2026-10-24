import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Cold CI task-graph regression: package tests that self-import their own
// dist (exports -> ./dist/*.js) fail on a cold checkout when Turbo runs `test`
// without building the same package first (`dependsOn: ["^build"]` only builds
// workspace *dependencies*). Hosted CI bootstraps workspace builds before
// checks that need exports.
//
// Unlike a hardcoded graph, the fixed fixture below READS the real workspace
// turbo.json task definition at runtime: reverting the repo fix to
// `["^build"]` turns this suite red. The negative fixture derives the old
// `^build`-only graph from the same definition and must fail on missing dist.
// Self-import goes through the declared package name (`pkg-a`, resolved via
// the fixture's own `exports` map by Node self-reference), and cache restore
// asserts an actual Turbo cache HIT, not merely equal bytes.
//
// These tests execute the real installed Turbo binary against throwaway
// single-package monorepo fixtures with a genuine generated pnpm lockfile.
// No network, no repo dist copying: every fixture/cache/temp path is
// job-unique under short /tmp prefixes, and fixtures are removed in `finally`
// (runner receipts persist in the job output directory).

interface RunResult {
  exit: number;
  stdout: string;
  stderr: string;
  ms: number;
}

interface WorkspaceGraph {
  testDependsOn: string[];
  buildDependsOn: string[];
  buildOutputs: string[];
}

function childEnv(cacheDir: string, childTmp: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "RUST_LOG" || key === "GROK_DEBUG_FILE" || key.startsWith("GIT_")) {
      delete env[key];
    }
  }
  env["OPENCLINXR_WORKER"] = "1";
  env["TURBO_CONCURRENCY"] = "2";
  env["TURBO_TELEMETRY_DISABLED"] = "1";
  env["DO_NOT_TRACK"] = "1";
  env["TURBO_CACHE_DIR"] = cacheDir;
  env["TMPDIR"] = childTmp;
  env["TMP"] = childTmp;
  env["TEMP"] = childTmp;
  return env;
}

function resolveRepoBinary(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, "node_modules", ".bin", name);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return name;
}

function runBin(
  bin: string,
  args: string[],
  cwd: string,
  cacheDir: string,
  childTmp: string,
): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { cwd, env: childEnv(cacheDir, childTmp), timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ exit: exitOf(error), stdout: String(stdout), stderr: String(stderr), ms: Date.now() - started });
      },
    );
  });
}

function exitOf(error: unknown): number {
  if (error === null || error === undefined) {
    return 0;
  }
  if (typeof error === "object" && "code" in error) {
    const code: unknown = (error as { code: unknown }).code;
    if (typeof code === "number") {
      return code;
    }
  }
  return 1;
}

function stringArray(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return [...(value as string[])];
  }
  return null;
}

// Read the REAL workspace task graph so this proof tracks the repo fix.
function readWorkspaceTaskGraph(): WorkspaceGraph {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, "turbo.json");
    if (existsSync(candidate)) {
      const parsed: unknown = JSON.parse(readFileSync(candidate, "utf8"));
      if (typeof parsed === "object" && parsed !== null && "tasks" in parsed) {
        const tasks: unknown = (parsed as { tasks: unknown }).tasks;
        if (typeof tasks === "object" && tasks !== null && "test" in tasks && "build" in tasks) {
          const testTask = (tasks as { test: unknown }).test;
          const buildTask = (tasks as { build: unknown }).build;
          if (typeof testTask === "object" && testTask !== null && typeof buildTask === "object" && buildTask !== null) {
            const testDependsOn = stringArray((testTask as { dependsOn?: unknown }).dependsOn);
            const buildDependsOn = stringArray((buildTask as { dependsOn?: unknown }).dependsOn);
            const buildOutputs = stringArray((buildTask as { outputs?: unknown }).outputs);
            if (testDependsOn !== null && buildDependsOn !== null && buildOutputs !== null) {
              return { testDependsOn, buildDependsOn, buildOutputs };
            }
          }
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error("workspace turbo.json with tasks.test/tasks.build not found");
}

const BUILD_SCRIPT: string =
  "import { mkdirSync, readFileSync, writeFileSync } from \"node:fs\";\n" +
  "const input = readFileSync(new URL(\"./src/input.txt\", import.meta.url), \"utf8\").trim();\n" +
  "mkdirSync(new URL(\"./dist/\", import.meta.url), { recursive: true });\n" +
  "writeFileSync(new URL(\"./dist/output.js\", import.meta.url), \"export const value = \" + JSON.stringify(input) + \";\\n\");\n" +
  "console.log(\"built:\" + input);\n";

// Self-import through the declared package name: Node resolves "pkg-a" via
// this package's own `exports` map (self-reference), so a missing or stale
// dist fails exactly like the real workspace self-export tests.
const TEST_SCRIPT: string =
  "import { readFileSync } from \"node:fs\";\n" +
  "import { value } from \"pkg-a\";\n" +
  "const expected = readFileSync(new URL(\"./src/input.txt\", import.meta.url), \"utf8\").trim();\n" +
  "if (value !== expected) {\n" +
  "  console.error(\"stale dist: got \" + value + \" want \" + expected);\n" +
  "  process.exit(1);\n" +
  "}\n" +
  "console.log(\"self-import ok:\" + value);\n";

async function writeFixture(root: string, testDependsOn: string[], graph: WorkspaceGraph, childTmp: string): Promise<void> {
  mkdirSync(join(root, "pkg-a", "src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ private: true, packageManager: "pnpm@11.18.0", workspaces: ["pkg-a"] }, null, 2) + "\n",
  );
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - \"pkg-a\"\n");
  // Mirror the repo .gitignore (node_modules/, .turbo/, dist/): Turbo excludes
  // gitignored paths from $TURBO_DEFAULT$ inputs. Without this, per-run
  // .turbo logs inside the package poison the hash (perpetual MISS) and
  // deleting dist changes it, so a warm-cache HIT is impossible and any
  // "restore" is really a rebuild.
  writeFileSync(join(root, ".gitignore"), "node_modules/\n.turbo/\ndist/\n*.tsbuildinfo\n");
  // Trim the root-only //#gen prerequisite: the tiny fixture has no generate
  // task, so keeping it would fail resolution; the trimmed set is explicit.
  const fixtureBuildDependsOn = graph.buildDependsOn.filter((dep) => dep !== "//#gen");
  writeFileSync(
    join(root, "turbo.json"),
    JSON.stringify(
      {
        $schema: "https://turborepo.dev/schema.json",
        tasks: {
          build: { dependsOn: fixtureBuildDependsOn, outputs: graph.buildOutputs },
          test: { dependsOn: testDependsOn, outputs: [] },
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(root, "pkg-a", "package.json"),
    JSON.stringify(
      {
        name: "pkg-a",
        version: "0.0.0",
        private: true,
        type: "module",
        exports: { ".": "./dist/output.js" },
        scripts: { build: "node build.mjs", test: "node test.mjs" },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(root, "pkg-a", "build.mjs"), BUILD_SCRIPT);
  writeFileSync(join(root, "pkg-a", "test.mjs"), TEST_SCRIPT);
  writeFileSync(join(root, "pkg-a", "src", "input.txt"), "v1\n");
  // Genuine pnpm lockfile (zero dependencies, offline): removes the
  // missing-lockfile workspace-resolution ambiguity without network installs.
  const pnpmBin = resolveRepoBinary("pnpm");
  const locked = await runBin(pnpmBin, ["install", "--lockfile-only", "--offline"], root, join(root, ".lock-cache"), childTmp);
  if (locked.exit !== 0 || !existsSync(join(root, "pnpm-lock.yaml"))) {
    throw new Error(`fixture lockfile generation failed exit=${locked.exit} err=${locked.stderr.slice(-400)}`);
  }
  // Mirror a pnpm workspace install for bare-name self-imports.
  mkdirSync(join(root, "node_modules"), { recursive: true });
  const link = join(root, "node_modules", "pkg-a");
  if (!existsSync(link)) {
    symlinkSync(join(root, "pkg-a"), link, "junction");
  }
}

function logCase(record: Record<string, string | number | boolean>): void {
  console.log(JSON.stringify(record));
}

describe("cold task graph", () => {
  it("cold old graph fails while fixed graph succeeds", { timeout: 120000 }, async () => {
    const jobRoot = mkdtempSync("/tmp/oc-ci-graph-");
    try {
      const childTmp = mkdtempSync("/tmp/oc-ci-");
      const graph = readWorkspaceTaskGraph();
      // The proof is bound to the repo fix: without own-build it cannot pass.
      expect(graph.testDependsOn).toContain("build");
      const oldDependsOn = graph.testDependsOn.filter((dep) => dep !== "build");
      expect(oldDependsOn).not.toContain("build");

      const oldRoot = join(jobRoot, "old");
      const fixedRoot = join(jobRoot, "fixed");
      await writeFixture(oldRoot, oldDependsOn, graph, childTmp);
      await writeFixture(fixedRoot, graph.testDependsOn, graph, childTmp);
      const turboBin = resolveRepoBinary("turbo");

      const version = await runBin(turboBin, ["--version"], fixedRoot, join(jobRoot, "cache-version"), childTmp);
      logCase({ case: "turbo-version", exit: version.exit, ms: version.ms });
      expect(version.exit).toBe(0);

      const oldRes = await runBin(turboBin, ["run", "test"], oldRoot, join(jobRoot, "cache-old"), childTmp);
      logCase({ case: "cold-old-graph", exit: oldRes.exit, ms: oldRes.ms });
      expect(oldRes.exit).not.toBe(0);
      expect(oldRes.stdout + oldRes.stderr).toMatch(/cannot find|not found|ERR_MODULE/i);
      expect(existsSync(join(oldRoot, "pkg-a", "dist", "output.js"))).toBe(false);

      const fixedRes = await runBin(turboBin, ["run", "test"], fixedRoot, join(jobRoot, "cache-fixed"), childTmp);
      logCase({ case: "cold-fixed-graph", exit: fixedRes.exit, ms: fixedRes.ms });
      expect(fixedRes.exit).toBe(0);
      expect(readFileSync(join(fixedRoot, "pkg-a", "dist", "output.js"), "utf8")).toContain("v1");
      expect(fixedRes.stdout).toContain("self-import ok:v1");
    } finally {
      rmSync(jobRoot, { recursive: true, force: true });
    }
  });

  it("warm cache restores deleted dist and source edit invalidates", { timeout: 120000 }, async () => {
    const jobRoot = mkdtempSync("/tmp/oc-ci-warm-");
    try {
      const childTmp = mkdtempSync("/tmp/oc-ci-");
      const graph = readWorkspaceTaskGraph();
      expect(graph.testDependsOn).toContain("build");
      const root = join(jobRoot, "fixed");
      await writeFixture(root, graph.testDependsOn, graph, childTmp);
      const turboBin = resolveRepoBinary("turbo");
      const cache = join(jobRoot, "cache");

      const first = await runBin(turboBin, ["run", "test"], root, cache, childTmp);
      logCase({ case: "warm-first", exit: first.exit, ms: first.ms });
      expect(first.exit).toBe(0);
      const distFile = join(root, "pkg-a", "dist", "output.js");
      const coldBytes = readFileSync(distFile, "utf8");

      rmSync(join(root, "pkg-a", "dist"), { recursive: true, force: true });
      expect(existsSync(distFile)).toBe(false);
      const restore = await runBin(turboBin, ["run", "build"], root, cache, childTmp);
      logCase({ case: "warm-cache-restore", exit: restore.exit, ms: restore.ms });
      expect(restore.exit).toBe(0);
      expect(existsSync(distFile)).toBe(true);
      expect(readFileSync(distFile, "utf8")).toBe(coldBytes);
      // Equal bytes alone could be a rebuild: require an actual cache HIT.
      expect(restore.stdout).toMatch(/cache hit/i);

      writeFileSync(join(root, "pkg-a", "src", "input.txt"), "v2\n");
      const afterEdit = await runBin(turboBin, ["run", "test"], root, cache, childTmp);
      const newBytes = readFileSync(distFile, "utf8");
      logCase({ case: "source-invalidation", exit: afterEdit.exit, ms: afterEdit.ms, changed: newBytes !== coldBytes });
      expect(afterEdit.exit).toBe(0);
      expect(afterEdit.stdout).toMatch(/cache miss/i);
      expect(newBytes).not.toBe(coldBytes);
      expect(newBytes).toContain("v2");
      expect(afterEdit.stdout).toContain("self-import ok:v2");
    } finally {
      rmSync(jobRoot, { recursive: true, force: true });
    }
  });
});
