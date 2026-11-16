/**
 * Tools cruft gate tests (card CRUFT-GATE).
 *
 * Every case that needs a repo runs in a standalone `git init` fixture under
 * os.tmpdir() (never `git worktree add`); every child git call uses
 * gitEnvWithoutInheritedRepoVars. The gate under test is spawned as
 * `node <tsx/cli.mjs> tools-cruft-gate.ts <cmd>` with OPENCLINXR_CRUFT_ROOT
 * pointed at the fixture, so reaching behavior is observed through the real
 * CLI (exit codes + output), not internals — except T6 (import-chain unit
 * level) and the T7 vacuity guard (recompute vs committed baseline).
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  analyzePyFileImports,
  CruftExit,
  computeReachability,
  loadManifest,
  runVultureOnce,
} from "./tools-cruft-gate.js";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-roots.js";

function workspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"), "utf8");
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const ROOT = workspaceRoot();
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const GATE = join(ROOT, "tools", "openclinxr", "openclaw", "tools-cruft-gate.ts");

function fixtureGitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...gitEnvWithoutInheritedRepoVars(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "cruft-test",
    GIT_AUTHOR_EMAIL: "cruft-test@example.test",
    GIT_COMMITTER_NAME: "cruft-test",
    GIT_COMMITTER_EMAIL: "cruft-test@example.test",
    ...extra,
  };
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: fixtureGitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
}

function initRepo(files: Record<string, string>): string {
  const now = Date.now();
  const dir = join(tmpdir(), `cruft-gate-${process.pid}-${now}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-b", "main"]);
  writeFiles(dir, files);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "base"]);
  return dir;
}

function commitAll(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", message]);
}

function headSha(dir: string): string {
  return git(dir, ["rev-parse", "HEAD"]);
}

function baselineJson(dir: string, extra: { ts?: string[]; py?: string[] } = {}): string {
  return `${JSON.stringify(
    {
      baseSha: headSha(dir),
      unreferencedTs: extra.ts ?? [],
      unreferencedPy: extra.py ?? [],
      vultureFindings: 0,
    },
    null,
    2,
  )}\n`;
}

function realGitPath(): string {
  return execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
}

function expectHermeticGitLookup(pathEnv: string, gitPath: string): void {
  const binDir = pathEnv.split(delimiter)[0];
  expect(binDir).toBeDefined();
  const hermeticGitEntry = join(binDir as string, "git");
  const hermeticGitPath = execFileSync("sh", ["-c", "command -v git"], {
    encoding: "utf8",
    env: { ...process.env, PATH: pathEnv },
  }).trim();
  expect(hermeticGitPath).toBe(hermeticGitEntry);
  expect(realpathSync(hermeticGitEntry)).toBe(realpathSync(gitPath));
}

/**
 * Hermetic bin dir with a symlink to the working git (the scrubbed PATH
 * used to simulate absence would otherwise resolve Apple's /usr/bin/git,
 * which fails on the Xcode license). No vulture stub here: round 2 always
 * exercises the real mise-resolved vulture, and T8 asserts its absence.
 */
function gitOnlyPathEnv(gitPath = realGitPath()): string {
  const dir = join(tmpdir(), `cruft-bin-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(dir, { recursive: true });
  symlinkSync(gitPath, join(dir, "git"));
  return [dir, "/usr/bin", "/bin"].join(delimiter);
}

function runGate(dir: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): {
  rc: number;
  out: string;
} {
  const proc = spawnSync(process.execPath, [TSX_CLI, GATE, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...fixtureGitEnv(), OPENCLINXR_CRUFT_ROOT: dir, ...extraEnv },
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdoutText = typeof proc.stdout === "string" ? proc.stdout : "";
  const stderrText = typeof proc.stderr === "string" ? proc.stderr : "";
  return { rc: proc.status ?? 99, out: `${stdoutText}\n${stderrText}` };
}

const MINIMAL_PKG = `${JSON.stringify({ name: "cruft-fixture", private: true, scripts: {} }, null, 2)}\n`;

describe("tools-cruft-gate RED columns", () => {
  it("T1 RED ts: unreferenced tools/x/new-tool.ts fails naming it", () => {
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "tsx tools/x/used.ts" } },
        null,
        2,
      )}\n`,
      "tools/x/used.ts": "export const used = 1;\n",
      "tools/x/new-tool.ts": "export const fresh = 1;\n",
    });
    writeFiles(dir, { "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir) });
    commitAll(dir, "baseline");
    const base = headSha(dir);
    const { rc, out } = runGate(dir, ["check"], {
      OPENCLINXR_CRUFT_BASE: base,
    });
    expect(rc).toBe(1);
    expect(out).toContain("new unreferenced tools file: tools/x/new-tool.ts");
  }, 60_000);

  it("T2 RED py: unreferenced tools/x/new_tool.py fails naming it", () => {
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "tsx tools/x/used.ts" } },
        null,
        2,
      )}\n`,
      "tools/x/used.ts": "export const used = 1;\n",
      "tools/x/new_tool.py": "VALUE = 1\n",
    });
    writeFiles(dir, { "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir) });
    commitAll(dir, "baseline");
    const base = headSha(dir);
    const { rc, out } = runGate(dir, ["check"], {
      OPENCLINXR_CRUFT_BASE: base,
    });
    expect(rc).toBe(1);
    expect(out).toContain("new unreferenced tools file: tools/x/new_tool.py");
  }, 60_000);

  it("T3 KNOWN-GOOD: package.json-script .ts and path.join-referenced .py pass", () => {
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "tsx tools/a/used.ts" } },
        null,
        2,
      )}\n`,
      "tools/a/used.ts": "export const used = 1;\n",
      "tools/a/caller.test.ts":
        'import { join } from "node:path";\nimport { expect, it } from "vitest";\nconst HERE = ".";\nit("pins", () => {\n  expect(join(HERE, "new_tool.py")).toContain("new_tool.py");\n});\n',
      "tools/a/new_tool.py": "VALUE = 1\n",
    });
    writeFiles(dir, { "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir) });
    commitAll(dir, "baseline");
    const base = headSha(dir);
    const { rc, out } = runGate(dir, ["check"], {
      OPENCLINXR_CRUFT_BASE: base,
    });
    expect(out).toContain("check PASS");
    expect(rc).toBe(0);
  }, 60_000);
});

describe("tools-cruft-gate manifest counterweights", () => {
  const CASES: Array<{ name: string; referencedBy: string; extraFiles: Record<string, string> }> = [
    {
      name: "T4a tracked file not containing the name",
      referencedBy: "tools/x/other.ts",
      extraFiles: { "tools/x/other.ts": "export const other = 1;\n" },
    },
    {
      name: "T4b untracked file",
      referencedBy: "tools/x/notes.txt",
      extraFiles: {},
    },
    {
      name: "T4c tools-entrypoints.json itself",
      referencedBy: "tools/openclinxr/openclaw/tools-entrypoints.json",
      extraFiles: {},
    },
    {
      name: "T4d tools-cruft-baseline.json",
      referencedBy: "tools/openclinxr/openclaw/tools-cruft-baseline.json",
      extraFiles: {},
    },
    {
      name: "T4e tools-cruft-gate.test.ts",
      referencedBy: "tools/openclinxr/openclaw/tools-cruft-gate.test.ts",
      extraFiles: {},
    },
    {
      name: "T4f non-runbook .md containing the name",
      referencedBy: "docs/guide.md",
      extraFiles: { "docs/guide.md": "# guide\n\nRun tools/x/new_tool.py for details.\n" },
    },
  ];

  for (const c of CASES) {
    it(`${c.name} fails naming the entry`, () => {
      const dir = initRepo({
        "package.json": MINIMAL_PKG,
        "tools/x/new_tool.py": "VALUE = 1\n",
        "tools/openclinxr/openclaw/tools-entrypoints.json": "[]\n",
        ...c.extraFiles,
      });
      if (c.name.startsWith("T4b")) {
        writeFiles(dir, { "tools/x/notes.txt": "see new_tool.py here\n" });
      }
      const manifest = [
        {
          path: "tools/x/new_tool.py",
          reason: "counterweight probe",
          referencedBy: c.referencedBy,
        },
      ];
      writeFiles(dir, {
        "tools/openclinxr/openclaw/tools-entrypoints.json": `${JSON.stringify(manifest, null, 2)}\n`,
      });
      const { rc, out } = runGate(dir, ["check"]);
      expect(rc).toBe(1);
      expect(out).toContain("manifest entry for tools/x/new_tool.py rejected");
    }, 60_000);
  }
});

describe("tools-cruft-gate ratchet counterweights", () => {
  it("T5a HEAD baseline adding a path absent at BASE fails naming it", () => {
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "tsx tools/x/a.ts" } },
        null,
        2,
      )}\n`,
      "tools/x/a.ts": "export const a = 1;\n",
    });
    writeFiles(dir, { "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir) });
    commitAll(dir, "baseline");
    const base = headSha(dir);
    writeFiles(dir, {
      "tools/openclinxr/openclaw/tools-cruft-baseline.json": `${JSON.stringify(
        { baseSha: base, unreferencedTs: ["tools/x/ghost.ts"], unreferencedPy: [], vultureFindings: 0 },
        null,
        2,
      )}\n`,
    });
    commitAll(dir, "add ghost");
    const { rc, out } = runGate(dir, ["check"], {
      OPENCLINXR_CRUFT_BASE: base,
    });
    expect(rc).toBe(1);
    expect(out).toContain("tools/x/ghost.ts");
  }, 60_000);

  it("T5b removing a baseline path passes", () => {
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "tsx tools/x/a.ts" } },
        null,
        2,
      )}\n`,
      "tools/x/a.ts": "export const a = 1;\n",
      "tools/x/gone.ts": "export const gone = 1;\n",
    });
    writeFiles(dir, {
      "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir, {
        ts: ["tools/x/gone.ts"],
      }),
    });
    commitAll(dir, "baseline");
    const base = headSha(dir);
    git(dir, ["rm", "-q", "tools/x/gone.ts"]);
    writeFiles(dir, { "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir) });
    commitAll(dir, "remove gone");
    const { rc, out } = runGate(dir, ["check"], {
      OPENCLINXR_CRUFT_BASE: base,
    });
    expect(out).toContain("check PASS");
    expect(rc).toBe(0);
  }, 60_000);

  it("T5c baseline absent at BASE while the gate exists at BASE fails", () => {
    const gateStub = "export const gateStub = 1;\n";
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "tsx tools/x/a.ts" } },
        null,
        2,
      )}\n`,
      "tools/x/a.ts": "export const a = 1;\n",
      "tools/openclinxr/openclaw/tools-cruft-gate.ts": gateStub,
    });
    const base = headSha(dir);
    writeFiles(dir, {
      "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir, {
        ts: ["tools/openclinxr/openclaw/tools-cruft-gate.ts"],
      }),
    });
    commitAll(dir, "add baseline");
    const { rc, out } = runGate(dir, ["check"], {
      OPENCLINXR_CRUFT_BASE: base,
    });
    expect(rc).toBe(1);
    expect(out).toContain("tools-cruft-baseline.json");
  }, 60_000);

  it("T5d both absent at BASE passes (bootstrap)", () => {
    const gateStub = "export const gateStub = 1;\n";
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "tsx tools/x/a.ts" } },
        null,
        2,
      )}\n`,
      "tools/x/a.ts": "export const a = 1;\n",
    });
    const base = headSha(dir);
    writeFiles(dir, {
      "tools/openclinxr/openclaw/tools-cruft-gate.ts": gateStub,
      "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir, {
        ts: ["tools/openclinxr/openclaw/tools-cruft-gate.ts"],
      }),
    });
    commitAll(dir, "add gate and baseline");
    const { rc, out } = runGate(dir, ["check"], {
      OPENCLINXR_CRUFT_BASE: base,
    });
    expect(out).toContain("bootstrap");
    expect(rc).toBe(0);
  }, 60_000);

  it("T5e OPENCLINXR_CRUFT_BASE naming a missing object exits 2", () => {
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "tsx tools/x/a.ts" } },
        null,
        2,
      )}\n`,
      "tools/x/a.ts": "export const a = 1;\n",
    });
    writeFiles(dir, { "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir) });
    commitAll(dir, "baseline");
    const { rc, out } = runGate(dir, ["check"], {
      OPENCLINXR_CRUFT_BASE: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    expect(rc).toBe(2);
    expect(out).toContain("git cat-file -e");
  }, 60_000);
});

describe("tools-cruft-gate py chains and negatives", () => {
  it("T6 DIRECT: importlib after a Path(__file__)-relative sys.path insert resolves direct", () => {
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "python3 tools/t/r.py" } },
        null,
        2,
      )}\n`,
      "tools/t/r.py": "import m2\nimport m3\n",
      "tools/t/m2.py": "VALUE2 = 1\n",
      "tools/t/m3.py":
        "import importlib\nimport sys\nfrom pathlib import Path\nsys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))\nm4 = importlib.import_module('m4')\n",
      "tools/t/lib/m4.py": "VALUE4 = 1\n",
      "tools/t/u.py": "import m1\n",
      "tools/t/m1.py": "VALUE1 = 1\n",
    });
    const resolutions = analyzePyFileImports(dir, "tools/t/m3.py");
    const m4res = resolutions.find((r) => r.module === "m4");
    expect(m4res?.mode).toBe("direct");
    expect(m4res?.files).toEqual(["tools/t/lib/m4.py"]);
    const reach = computeReachability(dir, []);
    expect(reach.unreferencedPy).toContain("tools/t/u.py");
    expect(reach.unreferencedPy).toContain("tools/t/m1.py");
    expect(reach.reachablePy).toContain("tools/t/m2.py");
    expect(reach.reachablePy).toContain("tools/t/lib/m4.py");
    expect(reach.reachablePy).toContain("tools/t/r.py");
  }, 60_000);

  it("T6 NEGATIVE ARM: without the sys.path insert the same import is not direct", () => {
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "python3 tools/t/r.py" } },
        null,
        2,
      )}\n`,
      "tools/t/r.py": "import m3\n",
      "tools/t/m3.py": "import importlib\nm4 = importlib.import_module('m4')\n",
      "tools/t/lib/m4.py": "VALUE4 = 1\n",
    });
    const resolutions = analyzePyFileImports(dir, "tools/t/m3.py");
    const m4res = resolutions.find((r) => r.module === "m4");
    expect(m4res?.mode).toBe("ambiguous-fallback");
    expect(m4res?.files).toEqual(["tools/t/lib/m4.py"]);
    // The fallback is conservative: the file is still reachable, just not direct.
    const reach = computeReachability(dir, []);
    expect(reach.reachablePy).toContain("tools/t/lib/m4.py");
  }, 60_000);

  it("T9 NEGATIVE MENTION: .py named only in a non-runbook .md and a .json config is unreachable", () => {
    const dir = initRepo({
      "package.json": MINIMAL_PKG,
      "tools/x/new.py": "VALUE = 1\n",
      "docs/notes.md": "# notes\n\nSee tools/x/new.py for the workflow.\n",
      "config.json": `${JSON.stringify({ ref: "tools/x/new.py" }, null, 2)}\n`,
    });
    writeFiles(dir, { "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir) });
    commitAll(dir, "baseline");
    const base = headSha(dir);
    const { rc, out } = runGate(dir, ["check"], {
      OPENCLINXR_CRUFT_BASE: base,
    });
    expect(rc).toBe(1);
    expect(out).toContain("new unreferenced tools file: tools/x/new.py");
  }, 60_000);
});

describe("tools-cruft-gate environment and config", () => {
  it("T8 vulture absent exits 2 with the exact message", () => {
    const dir = initRepo({
      "package.json": `${JSON.stringify(
        { name: "t", private: true, scripts: { x: "tsx tools/a/used.ts", y: "python3 tools/a/tool.py" } },
        null,
        2,
      )}\n`,
      "tools/a/used.ts": "export const used = 1;\n",
      "tools/a/tool.py": "VALUE = 1\n",
    });
    writeFiles(dir, { "tools/openclinxr/openclaw/tools-cruft-baseline.json": baselineJson(dir) });
    commitAll(dir, "baseline");
    const base = headSha(dir);
    const gitPath = realGitPath();
    expect(isAbsolute(gitPath)).toBe(true);
    expect(existsSync(gitPath)).toBe(true);
    const pathEnv = gitOnlyPathEnv(gitPath);
    expectHermeticGitLookup(pathEnv, gitPath);

    const nonExecutableBinDir = join(
      tmpdir(),
      `cruft-nonexec-bin-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    );
    mkdirSync(nonExecutableBinDir, { recursive: true });
    const nonExecutableGit = join(nonExecutableBinDir, "git");
    writeFileSync(nonExecutableGit, "non-executable git counterweight\n", "utf8");
    chmodSync(nonExecutableGit, 0o644);
    const nonExecutablePathEnv = [nonExecutableBinDir, pathEnv].join(delimiter);
    expect(() => expectHermeticGitLookup(nonExecutablePathEnv, gitPath)).toThrow();

    const { rc, out } = runGate(dir, ["check"], {
      PATH: pathEnv,
      OPENCLINXR_CRUFT_BASE: base,
    });
    expect(rc, out).toBe(2);
    expect(out).toContain("vulture not installed: run mise install");
  }, 60_000);

  it("T10 KNIP CONFIG: base vs HEAD differ only in the two entry arrays and the single tools files ignore", () => {
    const baseRef = process.env["OPENCLINXR_CRUFT_BASE"] ?? "HEAD";
    const baseText = execFileSync("git", ["show", `${baseRef}:knip.json`], {
      cwd: ROOT,
      encoding: "utf8",
      env: fixtureGitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const headText = readFileSync(join(ROOT, "knip.json"), "utf8");
    const baseKnip = JSON.parse(baseText) as {
      entry: string[];
      workspaces: Record<string, { entry?: string[] }>;
      ignoreIssues: Record<string, string[]>;
    };
    const headKnip = JSON.parse(headText) as {
      entry: string[];
      workspaces: Record<string, { entry?: string[] }>;
      ignoreIssues: Record<string, string[]>;
    };
    const removedGlob = "tools/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}";
    const baseHasGlob = [baseKnip.entry, baseKnip.workspaces["."]?.entry ?? []].some((arr) =>
      arr.includes(removedGlob),
    );
    if (!baseHasGlob) {
      // Post-migration: the mechanism must simply be stable, not re-migrated.
      expect(headKnip.entry).toEqual(baseKnip.entry);
      expect(headKnip.workspaces["."]?.entry).toEqual(baseKnip.workspaces["."]?.entry);
      expect(headKnip.ignoreIssues).toEqual(baseKnip.ignoreIssues);
      return;
    }
    for (const arr of [baseKnip.entry, baseKnip.workspaces["."]?.entry ?? []]) {
      expect(arr).toContain(removedGlob);
    }
    for (const arr of [headKnip.entry, headKnip.workspaces["."]?.entry ?? []]) {
      expect(arr).not.toContain(removedGlob);
    }
    const expected = JSON.parse(baseText) as Record<string, unknown>;
    expected["entry"] = headKnip.entry;
    const expectedWorkspaces = expected["workspaces"] as Record<string, { entry?: string[] }>;
    const headWorkspaces = headKnip.workspaces["."];
    if (headWorkspaces?.entry !== undefined) {
      expectedWorkspaces["."] = { ...(expectedWorkspaces["."] ?? {}), entry: headWorkspaces.entry };
    }
    expected["ignoreIssues"] = headKnip.ignoreIssues;
    expect(headKnip).toEqual(expected);
    const baseKeys = new Set(Object.keys(baseKnip.ignoreIssues));
    const headKeys = new Set(Object.keys(headKnip.ignoreIssues));
    const addedKeys = [...headKeys].filter((k) => !baseKeys.has(k));
    expect(addedKeys).toEqual(["tools/**"]);
    expect(headKnip.ignoreIssues["tools/**"]).toEqual(["files"]);
    for (const key of baseKeys) {
      expect(headKnip.ignoreIssues[key]).toEqual(baseKnip.ignoreIssues[key]);
    }
  }, 30_000);

  it("T7 REAL-TREE: check passes against the committed baseline (vacuity-guarded)", () => {
    const { rc, out } = runGate(ROOT, ["check"]);
    expect(out).toContain("check PASS");
    expect(rc).toBe(0);
    const manifest = loadManifest(ROOT);
    const reach = computeReachability(ROOT, manifest);
    const baselineText = readFileSync(join(ROOT, "tools/openclinxr/openclaw/tools-cruft-baseline.json"), "utf8");
    const baseline = JSON.parse(baselineText) as {
      unreferencedTs: string[];
      unreferencedPy: string[];
      vultureFindings: number;
    };
    expect(reach.unreferencedTs).toEqual(baseline.unreferencedTs);
    expect(reach.unreferencedPy).toEqual(baseline.unreferencedPy);
    try {
      const fresh = runVultureOnce(ROOT, reach.reachablePy);
      expect(baseline.vultureFindings).toBe(fresh);
    } catch (error) {
      if (error instanceof CruftExit && error.exitCode === 2) {
        console.log(`tools-cruft: T7 vulture comparison skipped: ${error.message}`);
      } else {
        throw error;
      }
    }
  }, 180_000);

  it("T11 REAL CALLERS: motion-bind and body-param .py stages plus the seated finalize are reachable", () => {
    const manifest = loadManifest(ROOT);
    const reach = computeReachability(ROOT, manifest);
    const pinned = [
      "tools/openclinxr/asset-pipeline/makeclothes/motion_bind_stage.py",
      "tools/openclinxr/asset-pipeline/makeclothes/embed_library_footwear.py",
      "tools/openclinxr/asset-pipeline/makeclothes/embed_library_hair.py",
      "tools/openclinxr/asset-pipeline/makeclothes/finished_figure_grade.py",
      "tools/openclinxr/asset-pipeline/skin/factory-finish/finalize.py",
    ];
    for (const p of pinned) {
      expect(reach.reachablePy).toContain(p);
      expect(reach.unreferencedPy).not.toContain(p);
    }
  }, 120_000);

  it("T12 SELF-MENTION never admits a sibling with the same basename", () => {
    const dir = initRepo({
      "package.json": MINIMAL_PKG,
      "tools/x/a/report.ts": 'export const label = "report.ts";\n',
      "tools/x/b/report.ts": "export const b = 1;\n",
      "tools/x/c/unique-thing.ts": "export const u = 1;\n",
      "tools/x/d/other.ts": 'export const w = "unique-thing.ts";\n',
    });
    const reach = computeReachability(dir, []);
    expect(reach.unreferencedTs).toContain("tools/x/b/report.ts");
    expect(reach.reachableTs).not.toContain("tools/x/b/report.ts");
    expect(reach.reachableTs).toContain("tools/x/c/unique-thing.ts");
    expect(reach.unreferencedTs).not.toContain("tools/x/c/unique-thing.ts");
  }, 60_000);
});
