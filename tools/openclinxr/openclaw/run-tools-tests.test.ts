/**
 * run-tools-tests.test.ts — classifier adversaries, routing parity, and
 * fail-loud regressions (missing/malformed shared config, empty manifest).
 * Plus the CI-only ECG archive skip (option B): trigger planner, fail-closed
 * local preflight, list-drift oracle, discovery parity, cache keys, ci.yml.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  CI_SPLIT_PACKAGES_STEP,
  CI_SPLIT_TOOL_STEP,
  ciSplitYmlPath,
  expectedStepsForVar,
  findCiSplitStep,
  loadTurboDeclarations,
  type TurboDeclarations,
} from "./ci-split-steps.js";
import {
  buildDiscoveryArgs,
  buildNodeTestArgs,
  buildTurboChildEnv,
  buildVitestRunArgs,
  classifySource,
  ECG_ARCHIVE_DEPENDENT_TESTS,
  ECG_ARCHIVE_INDEPENDENT_ALLOWLIST,
  ECG_ARCHIVE_SKIP_ENV_VAR,
  ecgArchiveSkipLines,
  loadSharedExcludes,
  MANUAL_EXCLUDES,
  MixedFrameworkError,
  maybeLogEcgArchiveSkip,
  PROJECT_ARCHIVE_EXCLUDES,
  parseVitestFilesOnly,
  partitionManifest,
  planEcgArchive,
  ROOT_CONFIG_EXCLUDES,
  requireNonEmptyManifest,
  runEcgInputPreflight,
  SHARED_EXCLUDES_MODULE,
} from "./run-tools-tests";
import { computeFileKey, computeSalt, createKeyContext } from "./tools-file-cache.js";
import { AREA_TURBO_DEPENDS_ON, areaTurboInputs, assignAreas, turboTaskName } from "./tools-test-areas.js";

function withFixtures(files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "tools-router-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withFixturesAsync(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tools-router-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return fn(dir).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

describe("classifySource", () => {
  it("routes static node:test imports to node", () => {
    expect(classifySource(`import test from "node:test";\ntest("a", () => {});`)).toBe("node");
    expect(classifySource(`import { describe, it } from "node:test";`)).toBe("node");
    expect(classifySource(`import "node:test";`)).toBe("node");
  });

  it("routes node:test subpaths to node", () => {
    expect(classifySource(`import { spec } from "node:test/reporters";`)).toBe("node");
    expect(classifySource(`import { mock } from 'node:test';`)).toBe("node");
  });

  it("routes require() and import-equals of node:test to node", () => {
    expect(classifySource(`const test = require("node:test");`)).toBe("node");
    expect(classifySource(`import test = require("node:test");`)).toBe("node");
  });

  it("routes dynamic import() of node:test to node", () => {
    expect(classifySource(`const { test } = await import("node:test");`)).toBe("node");
  });

  it("routes static/dynamic vitest imports to vitest", () => {
    expect(classifySource(`import { describe, expect, it } from "vitest";`)).toBe("vitest");
    expect(classifySource(`export { expect } from "vitest";`)).toBe("vitest");
    expect(classifySource(`const v = await import('vitest');`)).toBe("vitest");
    expect(classifySource(`const { it } = require("vitest");`)).toBe("vitest");
  });

  it("ignores node:test/vitest mentions in comments", () => {
    const src = [
      `// import test from "node:test"; // legacy, do not re-add`,
      `/* import { it } from "vitest"; */`,
      `/** See node:test docs. const x = require("node:test"); */`,
      `import assert from "node:assert/strict";`,
      `assert.ok(true);`,
    ].join("\n");
    expect(classifySource(src)).toBe("vitest");
  });

  it("ignores framework names inside string literals", () => {
    const src = [
      `const msg = "import test from 'node:test' is banned here";`,
      `const tpl = \`dynamic import("node:test") example\`;`,
      `console.log(msg, tpl);`,
    ].join("\n");
    expect(classifySource(src)).toBe("vitest");
  });

  it("fails loud on mixed frameworks, never silently routes", () => {
    const src = `import test from "node:test";\nimport { expect } from "vitest";\n`;
    expect(() => classifySource(src, "mixed.test.mjs")).toThrow(MixedFrameworkError);
    expect(() => classifySource(src, "mixed.test.mjs")).toThrow(/mixed\.test\.mjs/);
  });

  it("treats static-node + dynamic-vitest as mixed", () => {
    expect(() => classifySource(`import test from "node:test";\nconst v = await import("vitest");\n`, "m2.test.ts")).toThrow(
      MixedFrameworkError,
    );
  });

  it("defaults files with neither framework to vitest", () => {
    expect(classifySource(`import assert from "node:assert/strict";\nassert.ok(true);`)).toBe("vitest");
    expect(classifySource(`import { foo } from "./helper.js";\nfoo();`)).toBe("vitest");
  });

  it("does not confuse node:assert / node:fs with node:test", () => {
    expect(classifySource(`import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";`)).toBe("vitest");
  });
});

describe("partitionManifest", () => {
  it("partitions node and vitest fixtures disjointly and exhaustively", () => {
    withFixtures(
      {
        "a.test.mjs": `import test from "node:test";\ntest("a", () => {});`,
        "b.test.ts": `import { it, expect } from "vitest";\nit("b", () => expect(1).toBe(1));`,
        "c.test.mjs": `import assert from "node:assert/strict";\nassert.ok(true);`,
      },
      (dir) => {
        const p = partitionManifest(["a.test.mjs", "b.test.ts", "c.test.mjs"], dir);
        expect(p.node).toEqual(["a.test.mjs"]);
        expect([...p.vitest].sort()).toEqual(["b.test.ts", "c.test.mjs"]);
        expect([...p.node, ...p.vitest].sort()).toEqual(["a.test.mjs", "b.test.ts", "c.test.mjs"]);
      },
    );
  });

  it("collapses duplicate manifest entries so no file runs twice", () => {
    withFixtures({ "a.test.mjs": `import test from "node:test";` }, (dir) => {
      const p = partitionManifest(["a.test.mjs", "a.test.mjs"], dir);
      expect(p.node).toEqual(["a.test.mjs"]);
      expect(p.vitest).toEqual([]);
    });
  });

  it("throws on mixed-framework files instead of dropping them", () => {
    withFixtures({ "m.test.mjs": `import test from "node:test";\nimport { it } from "vitest";` }, (dir) => {
      expect(() => partitionManifest(["m.test.mjs"], dir)).toThrow(MixedFrameworkError);
    });
  });

  it("throws (not silently vitest-routes) on unreadable files", () => {
    withFixtures({}, (dir) => {
      expect(() => partitionManifest(["missing.test.mjs"], dir)).toThrow(/Cannot read test file/);
    });
  });
});

describe("loadSharedExcludes (fail loud, exact exports)", () => {
  const modPath = SHARED_EXCLUDES_MODULE;

  it("fails loud when the shared module is missing", async () => {
    await withFixturesAsync({}, async (dir) => {
      await expect(loadSharedExcludes(dir)).rejects.toThrow(/cannot import shared excludes/);
    });
  });

  it("fails loud when worktreeExcludePatterns is missing or malformed", async () => {
    await withFixturesAsync({ [modPath]: `export const worktreeExcludePatterns = "nope";` }, async (dir) => {
      await expect(loadSharedExcludes(dir)).rejects.toThrow(/must export string\[\] worktreeExcludePatterns/);
    });
    await withFixturesAsync({ [modPath]: `export const somethingElse = ["a"];` }, async (dir) => {
      await expect(loadSharedExcludes(dir)).rejects.toThrow(/must export string\[\] worktreeExcludePatterns/);
    });
  });

  it("returns exact worktree patterns and ignores stale archival exports (router owns archives)", async () => {
    await withFixturesAsync(
      { [modPath]: `export const worktreeExcludePatterns = ["**/.claude/worktrees/**"];` },
      async (dir) => {
        await expect(loadSharedExcludes(dir)).resolves.toEqual(["**/.claude/worktrees/**"]);
      },
    );
    await withFixturesAsync(
      {
        [modPath]: `export const worktreeExcludePatterns = ["w"]; export const archivalExcludePatterns = ["a1", "a2"];`,
      },
      async (dir) => {
        await expect(loadSharedExcludes(dir)).resolves.toEqual(["w"]);
      },
    );
  });

  it("never harvests arbitrary array exports", async () => {
    await withFixturesAsync(
      { [modPath]: `export const worktreeExcludePatterns = ["w"]; export const otherStuff = ["IGNORED"];` },
      async (dir) => {
        await expect(loadSharedExcludes(dir)).resolves.toEqual(["w"]);
      },
    );
  });
});

describe("projectArchiveExcludes (authoritative project router patterns)", () => {
  it("declares the exact root-relative project archive patterns", () => {
    expect([...PROJECT_ARCHIVE_EXCLUDES]).toEqual([".openclinxr/**", ".openclinxr-local/**"]);
  });

  it("excludes repo-root archival snapshots while keeping live and managed-worktree files", () => {
    const matchesAny = (file: string) => PROJECT_ARCHIVE_EXCLUDES.some((pattern) => matchesGlob(file, pattern));
    // Archived snapshot copies and provider caches are excluded.
    expect(
      matchesAny(
        ".openclinxr/slices/quest3-stage1-duplex-immersive-baseline/evidence/controller-shell/implementation/collector-tools-test-03-source/tools/openclinxr/evidence/quest-capacity/controller/collector.test.ts",
      ),
    ).toBe(true);
    expect(
      matchesAny(
        ".openclinxr-local/provider-cache/some-provider/snapshot/tools/openclinxr/evidence/quest-capacity/controller/collector.test.ts",
      ),
    ).toBe(true);
    // Live root tools files are kept.
    expect(matchesAny("tools/openclinxr/evidence/quest-capacity/controller/collector.test.ts")).toBe(false);
    // Patterns stay root-anchored: a nested ".openclinxr" segment below the root
    // (as in a managed-worktree path) is not matched by a root-relative glob.
    for (const pattern of PROJECT_ARCHIVE_EXCLUDES) {
      expect(pattern.startsWith("**/")).toBe(false);
    }
    expect(
      matchesAny("some/nested/.openclinxr/tools/openclinxr/evidence/quest-capacity/controller/collector.test.ts"),
    ).toBe(false);
  });

  it("discovery args carry manual, root, shared worktree, and project archive excludes", () => {
    const shared = ["**/.claude/worktrees/**", "**/.grok/worktrees/**"];
    const all = [...MANUAL_EXCLUDES, ...ROOT_CONFIG_EXCLUDES, ...shared, ...PROJECT_ARCHIVE_EXCLUDES];
    expect(all).toHaveLength(7 + 3 + 2 + 2);
    const args = buildDiscoveryArgs(all);
    expect(args.slice(0, 3)).toEqual(["list", "tools", "--filesOnly"]);
    for (const e of all) expect(args).toContain(e);
    expect(args).toHaveLength(3 + 2 * all.length);
  });

  it("vitest run args keep all router excludes AND add exact node-file excludes", () => {
    const shared = ["**/.claude/worktrees/**", "**/.grok/worktrees/**"];
    const all = [...MANUAL_EXCLUDES, ...ROOT_CONFIG_EXCLUDES, ...shared, ...PROJECT_ARCHIVE_EXCLUDES];
    const nodeFiles = ["tools/a/x.test.mjs", "tools/b/y.test.mjs"];
    const args = buildVitestRunArgs(nodeFiles, all, []);
    expect(args.slice(0, 2)).toEqual(["run", "tools"]);
    for (const e of all) expect(args).toContain(e);
    for (const f of nodeFiles) expect(args).toContain(f);
  });
});

describe("requireNonEmptyManifest", () => {
  it("fails loud on empty discovery", () => {
    expect(() => requireNonEmptyManifest([])).toThrow(/empty discovery manifest/);
  });

  it("passes non-empty manifests through", () => {
    expect(requireNonEmptyManifest(["a.test.mjs"])).toEqual(["a.test.mjs"]);
  });
});

describe("parity with current CI", () => {
  it("preserves all 7 manual //#test:tools excludes verbatim", () => {
    expect([...MANUAL_EXCLUDES]).toEqual([
      "tools/openclinxr/evidence/exam-pipeline/blueprint-voice-simulation-spike.test.ts",
      "tools/openclinxr/evidence/iwsdk/iwsdk-evidence-contract-check.test.ts",
      "tools/openclinxr/evidence/exam-pipeline/model-vetting-actor-player-runtime-evidence.test.ts",
      "tools/openclinxr/evidence/model-vetting-snapshots/model-vetting-capture-manifest.test.ts",
      "tools/openclinxr/evidence/model-vetting-snapshots/model-vetting-runtime-hook-bindings.test.ts",
      "tools/openclinxr/evidence/model-vetting-snapshots/model-vetting-runtime-mapping-evidence.test.ts",
      "tools/openclinxr/openclaw/agentic-hook-runner.test.ts",
    ]);
  });

  it("preserves all 3 root vitest.config.ts excludes verbatim", () => {
    expect([...ROOT_CONFIG_EXCLUDES]).toEqual([
      "**/audible-lip-sync-proof/capture.test.mjs",
      "**/audible-lip-sync-proof/source-wiring.test.mjs",
      "**/actor-audio-package-subpath-integration/historical-test-compatibility.test.ts",
    ]);
  });

  it("does not exclude the github-pages site fixture test from the tools run", () => {
    expect(MANUAL_EXCLUDES).not.toContain("tools/openclinxr/evidence/iwsdk/check-github-pages-site.test.ts");
  });

  it("discovery args carry every exclude", () => {
    const all = [...MANUAL_EXCLUDES, ...ROOT_CONFIG_EXCLUDES, "**/x/**"];
    const args = buildDiscoveryArgs(all);
    expect(args.slice(0, 3)).toEqual(["list", "tools", "--filesOnly"]);
    for (const e of all) expect(args).toContain(e);
    expect(args).toHaveLength(3 + 2 * all.length);
  });

  it("vitest run args keep original excludes AND add exact node-file excludes", () => {
    const nodeFiles = ["tools/a/x.test.mjs", "tools/b/y.test.mjs"];
    const args = buildVitestRunArgs(nodeFiles, [...MANUAL_EXCLUDES, ...ROOT_CONFIG_EXCLUDES], []);
    expect(args.slice(0, 2)).toEqual(["run", "tools"]);
    for (const e of MANUAL_EXCLUDES) expect(args).toContain(e);
    for (const f of nodeFiles) expect(args).toContain(f);
  });

  it("node group keeps authored budgets: --test-concurrency=2, no --test-force-exit", () => {
    const args = buildNodeTestArgs(["/root/tools/a.test.mjs"]);
    expect(args).toContain("--test");
    expect(args).toContain("--test-concurrency=2");
    expect(args).toContain("tsx");
    expect(args.join(" ")).not.toMatch(/test-force-exit/);
  });

  it("parses filesOnly output to repo-relative paths, skipping noise", () => {
    withFixtures({ "a.test.mjs": "x", "sub/b.test.ts": "y" }, (dir) => {
      const stdout = ["", `${dir}/a.test.mjs`, "some log line", `${dir}/sub/b.test.ts`, "helper.ts", ""].join("\n");
      expect(parseVitestFilesOnly(stdout, dir)).toEqual(["a.test.mjs", "sub/b.test.ts"]);
    });
  });
});

// ---------------------------------------------------------------------------
// CI-only ECG archive skip (option B). The frozen archive is local-store by
// design, so CI sets the trigger and skips the preflight + dependent files;
// local runs keep failing closed. NOTE for the T3 self-scan: this file must
// never contain a needle value literally (entry parent dirs, the frozen
// manifest/archive names, the two control manifest names) — every such
// string below is parsed out of the collector/manifest at runtime.
// ---------------------------------------------------------------------------

/** Repo root by walking up from this test file. */
function repoRootFromTestFile(): string {
  let cur = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(cur, "package.json")) && existsSync(join(cur, "tools"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error("[ecg-skip-test] cannot discover repo root from test file location");
}

/** Child env without repo-location overrides (so `git ls-files` targets this tree). */
function strippedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return env;
}

/** Tracked tools test files, via the pathspec form (no shell globbing). */
function listToolsTestFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "--", "tools/**/*.test.ts", "tools/**/*.test.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: strippedGitEnv(),
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Repo-relative path of the real ECG collector (a needle-safe literal: the .py, not the data names). */
const ECG_COLLECTOR_REL = "tools/openclinxr/evidence/fixtures/ecg-controls/ecg-input-bootstrap.py";

/** Read a "... = \"...\"" string constant out of the collector source. */
function ecgCollectorConstant(pySrc: string, name: string): string {
  const m = pySrc.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, "m"));
  if (m?.[1] === undefined) throw new Error(`[ecg-skip-test] constant ${name} not found in collector`);
  return m[1];
}

/** Pinned raw set: every tools test whose source references the frozen paths (owner grep: 5). */
const PINNED_ECG_GRADE_FILES: readonly string[] = [
  "tools/openclinxr/evidence/ecg-cart-grades/the-ecg-cart-c1-density-falsifier-has-been-graded.test.ts",
  "tools/openclinxr/evidence/ecg-cart-grades/the-ecg-cart-frozen-raw-viewcount-has-been-read.test.ts",
  "tools/openclinxr/evidence/ecg-cart-grades/the-ecg-cart-g1-4view-bake-has-been-graded.test.ts",
  "tools/openclinxr/evidence/ecg-cart-grades/the-ecg-cart-m1-direct-80k-has-been-graded.test.ts",
];
const PINNED_ECG_BOOTSTRAP_TEST = "tools/openclinxr/evidence/fixtures/ecg-controls/ecg-input-bootstrap.test.ts";
const PINNED_ECG_RAW_SET: readonly string[] = [...PINNED_ECG_GRADE_FILES, PINNED_ECG_BOOTSTRAP_TEST];

/** The derivation needles: entry parent dirs + frozen names + the two control manifests. */
function ecgNeedles(root: string): string[] {
  const pySrc = readFileSync(join(root, ECG_COLLECTOR_REL), "utf8");
  const fixtureDir = ecgCollectorConstant(pySrc, "FIXTURE_DIR");
  const manifestName = ecgCollectorConstant(pySrc, "MANIFEST_NAME");
  const manifest = JSON.parse(readFileSync(join(root, fixtureDir, manifestName), "utf8")) as {
    entries?: { targetRepoPath?: unknown }[];
  };
  if (!Array.isArray(manifest.entries)) throw new Error("[ecg-skip-test] frozen manifest has no entries array");
  const dirs = manifest.entries.map((e) => String(e?.targetRepoPath).split("/").slice(0, -1).join("/"));
  const needles = [
    ...dirs,
    ecgCollectorConstant(pySrc, "ARCHIVE_NAME"),
    manifestName,
    ecgCollectorConstant(pySrc, "MANIFEST_C0_C1"),
    ecgCollectorConstant(pySrc, "MANIFEST_PACK_A"),
  ];
  return [...new Set(needles)];
}

/** Test-owned oracle: raw set of tools tests referencing any needle (never imports a production helper). */
function rawEcgReferencingFiles(root: string): string[] {
  const needles = ecgNeedles(root);
  expect(needles.length).toBeGreaterThan(0);
  return listToolsTestFiles(root)
    .filter((f) => needles.some((n) => readFileSync(join(root, f), "utf8").includes(n)))
    .sort();
}

/** Env with both archive vars removed (save/restore handled by the caller when needed). */
function withoutEcgArchiveEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["OPENCLINXR_ECG_FIXTURE_ARCHIVE"];
  delete env[ECG_ARCHIVE_SKIP_ENV_VAR];
  return env;
}

/** Temp root holding the real collector, BOTH control manifests and the frozen manifest — and no archive. */
function withEcgPreflightRoot(fn: (fx: { realRoot: string; expectedArchive: string }) => void): void {
  const repo = repoRootFromTestFile();
  const pySrc = readFileSync(join(repo, ECG_COLLECTOR_REL), "utf8");
  const rels = [
    ECG_COLLECTOR_REL,
    ecgCollectorConstant(pySrc, "MANIFEST_C0_C1"),
    ecgCollectorConstant(pySrc, "MANIFEST_PACK_A"),
    join(ecgCollectorConstant(pySrc, "FIXTURE_DIR"), ecgCollectorConstant(pySrc, "MANIFEST_NAME")),
  ];
  const tmp = mkdtempSync(join(tmpdir(), "ecg-preflight-"));
  try {
    writeFileSync(join(tmp, "package.json"), "{}\n");
    for (const rel of rels) {
      mkdirSync(join(tmp, dirname(rel)), { recursive: true });
      copyFileSync(join(repo, rel), join(tmp, rel));
      expect(existsSync(join(tmp, rel)), `[ecg-skip-test] fixture setup failed: ${rel}`).toBe(true);
    }
    const realRoot = realpathSync(tmp);
    const expectedArchive = join(
      realRoot,
      ecgCollectorConstant(pySrc, "FIXTURE_DIR"),
      ecgCollectorConstant(pySrc, "ARCHIVE_NAME"),
    );
    fn({ realRoot, expectedArchive });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("ECG archive skip trigger planner (T1)", () => {
  it("skips preflight and excludes the dependent list only for exactly \"1\"", () => {
    expect(planEcgArchive({ [ECG_ARCHIVE_SKIP_ENV_VAR]: "1" })).toEqual({
      preflight: false,
      exclude: ECG_ARCHIVE_DEPENDENT_TESTS,
    });
    for (const value of [undefined, "0", "true", "yes", ""] as const) {
      const env: Record<string, string | undefined> = value === undefined ? {} : { [ECG_ARCHIVE_SKIP_ENV_VAR]: value };
      expect(planEcgArchive(env)).toEqual({ preflight: true, exclude: [] });
    }
  });

  it("ignores CI/GITHUB_ACTIONS alone (they must not skip)", () => {
    expect(planEcgArchive({ CI: "true" })).toEqual({ preflight: true, exclude: [] });
    expect(planEcgArchive({ GITHUB_ACTIONS: "true" })).toEqual({ preflight: true, exclude: [] });
    expect(planEcgArchive({ CI: "true", GITHUB_ACTIONS: "true" })).toEqual({ preflight: true, exclude: [] });
  });
});

describe("local still fails closed on the archive branch (T2)", () => {
  it("preflight throws missing-fixture-archive (not a setup error) with both vars unset", () => {
    withEcgPreflightRoot(({ realRoot, expectedArchive }) => {
      const savedArchive = process.env["OPENCLINXR_ECG_FIXTURE_ARCHIVE"];
      const savedSkip = process.env[ECG_ARCHIVE_SKIP_ENV_VAR];
      delete process.env["OPENCLINXR_ECG_FIXTURE_ARCHIVE"];
      delete process.env[ECG_ARCHIVE_SKIP_ENV_VAR];
      try {
        let msg = "";
        try {
          runEcgInputPreflight(realRoot);
        } catch (err) {
          msg = String(err);
        }
        // A setup error (e.g. missing control manifest) must NOT satisfy this:
        // both the failure mode and the exact expected archive path are required.
        expect(msg).toContain("missing fixture archive");
        expect(msg).toContain(expectedArchive);
      } finally {
        if (savedArchive === undefined) delete process.env["OPENCLINXR_ECG_FIXTURE_ARCHIVE"];
        else process.env["OPENCLINXR_ECG_FIXTURE_ARCHIVE"] = savedArchive;
        if (savedSkip === undefined) delete process.env[ECG_ARCHIVE_SKIP_ENV_VAR];
        else process.env[ECG_ARCHIVE_SKIP_ENV_VAR] = savedSkip;
      }
    });
  });

  it("CLI path exits 2 at the ECG preflight (spawned node --import tsx; stated here)", () => {
    withEcgPreflightRoot(({ realRoot }) => {
      const repo = repoRootFromTestFile();
      const probeRel = "tools/cli-probe.test.ts";
      writeFileSync(
        join(realRoot, probeRel),
        'import { describe, expect, it } from "vitest";\n' +
          'describe("cli probe", () => {\n  it("passes", () => {\n    expect(1).toBe(1);\n  });\n});\n',
      );
      const probeAbs = join(realRoot, probeRel);
      const binDir = join(realRoot, "node_modules", ".bin");
      mkdirSync(binDir, { recursive: true });
      const fakeVitest = join(binDir, "vitest");
      writeFileSync(fakeVitest, `#!/bin/sh\nprintf '%s\\n' '${probeAbs}'\n`);
      chmodSync(fakeVitest, 0o755);
      const stubRel = "packages/cellix/config-vitest/src/worktree-excludes.ts";
      mkdirSync(join(realRoot, dirname(stubRel)), { recursive: true });
      writeFileSync(join(realRoot, stubRel), "export const worktreeExcludePatterns: string[] = [];\n");
      const areas = assignAreas([probeRel], realRoot);
      const area = areas.get(probeRel);
      if (area === undefined) throw new Error("[ecg-skip-test] probe file has no area");
      const expected = areaTurboInputs(realRoot, areas);
      writeFileSync(
        join(realRoot, "turbo.json"),
        `${JSON.stringify(
          {
            tasks: {
              [turboTaskName(area)]: {
                inputs: expected.get(area) ?? [],
                dependsOn: [...(AREA_TURBO_DEPENDS_ON[area] ?? [])],
              },
            },
          },
          null,
          2,
        )}\n`,
      );
      const runnerAbs = join(repo, "tools/openclinxr/openclaw/run-tools-tests.ts");
      const child = spawnSync(process.execPath, ["--import", "tsx", runnerAbs, "--root", realRoot, "--area", area], {
        cwd: repo,
        env: withoutEcgArchiveEnv(),
        timeout: 100_000,
        encoding: "utf8",
      });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(2);
      expect(String(child.stderr)).toContain("missing fixture archive");
    });
  }, 120_000);
});

describe("ECG list drift oracle, test-owned (T3)", () => {
  it("derives exactly the pinned raw set (four grade files + bootstrap)", () => {
    const root = repoRootFromTestFile();
    const files = listToolsTestFiles(root);
    expect(files).toContain("tools/openclinxr/openclaw/run-tools-tests.test.ts");
    expect(rawEcgReferencingFiles(root)).toEqual([...PINNED_ECG_RAW_SET].sort());
  });

  it("production list equals raw minus allowlist; allowlist pinned; grades present and non-empty", () => {
    const root = repoRootFromTestFile();
    const raw = rawEcgReferencingFiles(root);
    const allow = new Set<string>(ECG_ARCHIVE_INDEPENDENT_ALLOWLIST);
    // (b) the production list is exactly the raw set minus the allowlist:
    // an empty production list, an all-allowlist, or a new referencing file
    // that did not join the list each fail here.
    expect([...ECG_ARCHIVE_DEPENDENT_TESTS].sort()).toEqual(raw.filter((f) => !allow.has(f)).sort());
    // (c) the allowlist is exactly the self-contained bootstrap test.
    expect([...ECG_ARCHIVE_INDEPENDENT_ALLOWLIST].sort()).toEqual([PINNED_ECG_BOOTSTRAP_TEST]);
    // (d) all four grade files are skipped, and the list is non-empty.
    for (const g of PINNED_ECG_GRADE_FILES) expect(ECG_ARCHIVE_DEPENDENT_TESTS).toContain(g);
    expect(ECG_ARCHIVE_DEPENDENT_TESTS.length).toBeGreaterThan(0);
  });
});

describe("exclusion reaches discovery with no over-skip (T4)", () => {
  function excludesOf(args: readonly string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const prev: string | undefined = args[i - 1];
      const cur: string | undefined = args[i];
      if (prev === "--exclude" && cur !== undefined) out.push(cur);
    }
    return out;
  }

  it("triggered minus untriggered excludes equals ECG_ARCHIVE_DEPENDENT_TESTS as sets", () => {
    const base = [...MANUAL_EXCLUDES, ...ROOT_CONFIG_EXCLUDES, "**/stub-shared/**", ...PROJECT_ARCHIVE_EXCLUDES];
    const untriggered = new Set(excludesOf(buildDiscoveryArgs(base)));
    const triggered = excludesOf(
      buildDiscoveryArgs([...base, ...planEcgArchive({ [ECG_ARCHIVE_SKIP_ENV_VAR]: "1" }).exclude]),
    );
    expect(triggered.filter((e) => !untriggered.has(e)).sort()).toEqual([...ECG_ARCHIVE_DEPENDENT_TESTS].sort());
    // Nothing is removed when triggered: base excludes survive.
    expect(triggered.filter((e) => untriggered.has(e)).sort()).toEqual([...untriggered].sort());
  });

  it("every skipped entry is an exact tracked file, not an area, directory, or glob", () => {
    const root = repoRootFromTestFile();
    const tracked = new Set(listToolsTestFiles(root));
    for (const e of ECG_ARCHIVE_DEPENDENT_TESTS) {
      expect(e).not.toMatch(/[*?[\]{}()!]/);
      expect(e.endsWith(".test.ts")).toBe(true);
      expect(tracked.has(e), `${e} must be a tracked file, not a directory or glob`).toBe(true);
    }
  });

  it("the trigger reaches turbo children env (and PREFLIGHT_DONE stays set)", () => {
    expect(buildTurboChildEnv({ ...process.env, [ECG_ARCHIVE_SKIP_ENV_VAR]: "1" })[ECG_ARCHIVE_SKIP_ENV_VAR]).toBe(
      "1",
    );
    const clean = withoutEcgArchiveEnv();
    expect(buildTurboChildEnv(clean)[ECG_ARCHIVE_SKIP_ENV_VAR]).toBeUndefined();
    expect(buildTurboChildEnv(clean)["OPENCLINXR_TOOLS_TESTS_PREFLIGHT_DONE"]).toBe("1");
  });
});

describe("skip lines print only when triggered (T5)", () => {
  it("prints the S2/S3 lines (header + N paths) when triggered", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(maybeLogEcgArchiveSkip({ [ECG_ARCHIVE_SKIP_ENV_VAR]: "1" })).toBe(true);
      const out = spy.mock.calls.map((c) => c.join(" "));
      expect(out).toContain(`[run-tools-tests] ECG archive skip (${ECG_ARCHIVE_SKIP_ENV_VAR}=1): preflight skipped`);
      const header = `[run-tools-tests] ECG archive skip: ${ECG_ARCHIVE_DEPENDENT_TESTS.length} files:`;
      expect(out).toContain(header);
      const at = out.indexOf(header);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(out.slice(at + 1, at + 1 + ECG_ARCHIVE_DEPENDENT_TESTS.length)).toEqual([
        ...ECG_ARCHIVE_DEPENDENT_TESTS,
      ]);
      expect(ecgArchiveSkipLines().length).toBe(2 + ECG_ARCHIVE_DEPENDENT_TESTS.length);
    } finally {
      spy.mockRestore();
    }
  });

  it("prints nothing when not triggered", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const cases: Record<string, string | undefined>[] = [
        {},
        { [ECG_ARCHIVE_SKIP_ENV_VAR]: "0" },
        { [ECG_ARCHIVE_SKIP_ENV_VAR]: "true" },
        { CI: "true" },
      ];
      for (const env of cases) expect(maybeLogEcgArchiveSkip(env)).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("cache keys carry the trigger (T6)", () => {
  it("turbo.json: trigger in globalEnv (or every //#test:tools:* task env), not only passThrough", () => {
    const root = repoRootFromTestFile();
    const turbo = JSON.parse(readFileSync(join(root, "turbo.json"), "utf8")) as {
      globalEnv?: unknown;
      globalPassThroughEnv?: unknown;
      tasks?: Record<string, { env?: unknown }>;
    };
    const strings = (v: unknown): string[] =>
      Array.isArray(v) && v.every((e): e is string => typeof e === "string") ? [...v] : [];
    const taskNames = Object.keys(turbo.tasks ?? {}).filter((n) => n.startsWith("//#test:tools:"));
    expect(taskNames.length).toBeGreaterThan(0);
    const inGlobal = strings(turbo.globalEnv).includes(ECG_ARCHIVE_SKIP_ENV_VAR);
    const inAllTasks =
      taskNames.length > 0 && taskNames.every((n) => strings(turbo.tasks?.[n]?.env).includes(ECG_ARCHIVE_SKIP_ENV_VAR));
    expect(inGlobal || inAllTasks).toBe(true);
    const onlyPassThrough =
      strings(turbo.globalPassThroughEnv).includes(ECG_ARCHIVE_SKIP_ENV_VAR) && !inGlobal && !inAllTasks;
    expect(onlyPassThrough).toBe(false);
  });

  it("runArea file-cache key differs between trigger \"1\" and unset for the same inputs", () => {
    // runArea builds its context via createKeyContext(root) -> computeSalt(root,
    // process.env); the K3 salt hashes every OPENCLINXR_* value, so the
    // trigger rides the production key with no bypass needed.
    const root = repoRootFromTestFile();
    const file = join(root, "tools/openclinxr/openclaw/run-tools-tests.test.ts");
    const withTrigger: NodeJS.ProcessEnv = { ...withoutEcgArchiveEnv(), [ECG_ARCHIVE_SKIP_ENV_VAR]: "1" };
    const without: NodeJS.ProcessEnv = withoutEcgArchiveEnv();
    expect(computeSalt(root, withTrigger)).not.toBe(computeSalt(root, without));
    const keyWith = computeFileKey(file, createKeyContext(root, withTrigger)).key;
    const keyWithout = computeFileKey(file, createKeyContext(root, without)).key;
    expect(keyWith).not.toBe(keyWithout);
  });
});

// ---------------------------------------------------------------------------
// CI-SPLIT-READERS: ci.yml verify now runs "Test tools" + "Test packages"
// (CI-SPLIT-TEST 6040386d7 split the old "Test" step). Step resolution and
// the per-var turbo derivation live in ./ci-split-steps.js; only the T7
// policy assertion and its counterweights remain here.
// ---------------------------------------------------------------------------

const CI_SPLIT_SAMPLE_VAR = "OPENCLINXR_STATION_SAMPLE";
const CI_SPLIT_SEED_VAR = "OPENCLINXR_STATION_SAMPLE_SEED";

/**
 * T7 check. Returns violations (empty = pass). Resolves the split steps by
 * exact name first, so a renamed/missing step throws naming the step instead
 * of crashing on an undefined property. Validates every actual setter step
 * instance in ci.yml order (multiplicity preserved) against the derived
 * expected sequence for the ECG var, and requires a non-empty derived set.
 */
function ecgTriggerViolations(
  yamlText: string = readFileSync(ciSplitYmlPath(), "utf8"),
  declarations: TurboDeclarations = loadTurboDeclarations(),
): string[] {
  const doc = parseYaml(yamlText) as {
    env?: Record<string, unknown>;
    jobs?: Record<string, { env?: Record<string, unknown>; steps?: { name?: unknown; env?: unknown }[] }>;
  };
  const violations: string[] = [];
  if ((doc.env as Record<string, unknown> | undefined)?.[ECG_ARCHIVE_SKIP_ENV_VAR] !== undefined) {
    violations.push(`workflow env sets ${ECG_ARCHIVE_SKIP_ENV_VAR}`);
  }
  const verify = doc?.jobs?.["verify"];
  if (!verify) throw new Error("[ci-split-readers] ci.yml has no verify job");
  if ((verify.env as Record<string, unknown> | undefined)?.[ECG_ARCHIVE_SKIP_ENV_VAR] !== undefined) {
    violations.push(`verify job env sets ${ECG_ARCHIVE_SKIP_ENV_VAR}`);
  }
  const steps = Array.isArray(verify.steps) ? verify.steps : [];
  // Resolve by exact name (C1): throws naming the step when renamed/missing.
  findCiSplitStep(steps, CI_SPLIT_TOOL_STEP);
  findCiSplitStep(steps, CI_SPLIT_PACKAGES_STEP);
  const derived = expectedStepsForVar(ECG_ARCHIVE_SKIP_ENV_VAR, yamlText, declarations);
  // Unique names in ci.yml order: a duplicated same-name setter step is an
  // extra actual instance the derived sequence does not contain, so it fails.
  const expected = [...new Set(derived)];
  if (expected.length === 0) violations.push(`${ECG_ARCHIVE_SKIP_ENV_VAR} has no turbo declaration`);
  // F2: collect every actual setter instance (no first-match lookup); the
  // name sequence must equal the derived expected sequence in ci.yml order,
  // so a duplicate same-name setter fails; each instance must carry "1".
  const setters = steps.filter(
    (s) => (s.env as Record<string, unknown> | undefined)?.[ECG_ARCHIVE_SKIP_ENV_VAR] !== undefined,
  );
  const actualNames = setters.map((s) => String(s.name));
  const quoted = (names: string[]): string => `[${names.map((n) => `"${n}"`).join(", ")}]`;
  if (actualNames.join("") !== expected.join("")) {
    violations.push(`ECG setter steps ${quoted(actualNames)} != expected ${quoted(expected)}`);
  }
  setters.forEach((s, i) => {
    const value = (s.env as Record<string, unknown> | undefined)?.[ECG_ARCHIVE_SKIP_ENV_VAR];
    if (value !== "1") {
      violations.push(
        `step "${String(s.name)}" setter #${i + 1} sets ${ECG_ARCHIVE_SKIP_ENV_VAR} to ${JSON.stringify(value)} (want "1")`,
      );
    }
  });
  return violations;
}

/** Derived per-var step map, printed once by the T7 pass (KNOWN-GOOD line). */
function ciSplitStepMapLine(): string {
  const vars = [ECG_ARCHIVE_SKIP_ENV_VAR, CI_SPLIT_SAMPLE_VAR, CI_SPLIT_SEED_VAR];
  return `ci-split-readers step map: ${vars.map((v) => `${v} -> ${expectedStepsForVar(v).join(", ")}`).join("; ")}`;
}

describe("ci.yml sets the trigger on the Test step only (T7)", () => {
  it("Test step env has \"1\"; no other step, job, or workflow env sets it", () => {
    process.stdout.write(`${ciSplitStepMapLine()}\n`);
    expect(ecgTriggerViolations()).toEqual([]);
    // The other asserted vars derive non-empty step sets too (F1 per-var guard).
    for (const v of [CI_SPLIT_SAMPLE_VAR, CI_SPLIT_SEED_VAR]) {
      expect(expectedStepsForVar(v).length).toBeGreaterThan(0);
    }
  });

  it("CW1: renaming Test tools to Test throws naming \"Test tools\"", () => {
    const real = readFileSync(ciSplitYmlPath(), "utf8");
    const renamed = real.replace("- name: Test tools", "- name: Test");
    expect(renamed).not.toBe(real);
    let msg = "";
    try {
      ecgTriggerViolations(renamed);
    } catch (err) {
      msg = String(err);
    }
    expect(msg).toContain('"Test tools"');
    process.stdout.write(`[CW1 T7] ${msg}\n`);
  });

  it("CW3: workflow env setting the trigger fails T7", () => {
    const real = readFileSync(ciSplitYmlPath(), "utf8");
    const modified = real.replace("name: CI\n", `name: CI\nenv:\n  ${ECG_ARCHIVE_SKIP_ENV_VAR}: "1"\n`);
    expect(modified).not.toBe(real);
    const violations = ecgTriggerViolations(modified);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes("workflow env"))).toBe(true);
    process.stdout.write(`[CW3 T7] ${violations.join(" | ")}\n`);
  });

  it("CW5: ECG var absent from turbo and ci.yml fails T7 (non-empty guard)", () => {
    const real = readFileSync(ciSplitYmlPath(), "utf8");
    const decls = loadTurboDeclarations();
    const strippedRoot = decls.rootTurboJson.replace(',\n    "OPENCLINXR_TOOLS_TESTS_SKIP_ECG_ARCHIVE"', "");
    expect(strippedRoot).not.toBe(decls.rootTurboJson);
    const strippedYml = real.replaceAll(`          ${ECG_ARCHIVE_SKIP_ENV_VAR}: "1"\n`, "");
    expect(strippedYml).not.toBe(real);
    const violations = ecgTriggerViolations(strippedYml, { ...decls, rootTurboJson: strippedRoot });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes("has no turbo declaration"))).toBe(true);
    expect(violations.some((v) => v.includes(ECG_ARCHIVE_SKIP_ENV_VAR))).toBe(true);
    process.stdout.write(`[CW5 T7] ${violations.join(" | ")}\n`);
  });

  it("CW6: duplicate Test tools setter with value \"0\" fails T7", () => {
    const real = readFileSync(ciSplitYmlPath(), "utf8");
    const dup = `\n      - name: Test tools\n        env:\n          ${ECG_ARCHIVE_SKIP_ENV_VAR}: "0"\n        run: pnpm test:tools`;
    const modified = real.replace("        run: pnpm test:tools", `        run: pnpm test:tools${dup}`);
    expect(modified).not.toBe(real);
    const violations = ecgTriggerViolations(modified);
    expect(violations.length).toBeGreaterThan(0);
    const msg = violations.join(" | ");
    expect(msg).toContain('"Test tools"');
    expect(msg).toContain('"0"');
    process.stdout.write(`[CW6 T7] ${msg}\n`);
  });
});
