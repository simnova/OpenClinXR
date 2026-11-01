/**
 * run-tools-tests.test.ts — classifier adversaries, routing parity, and
 * fail-loud regressions (missing/malformed shared config, empty manifest).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, matchesGlob } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDiscoveryArgs,
  buildNodeTestArgs,
  buildVitestRunArgs,
  classifySource,
  loadSharedExcludes,
  MANUAL_EXCLUDES,
  MixedFrameworkError,
  parseVitestFilesOnly,
  partitionManifest,
  PROJECT_ARCHIVE_EXCLUDES,
  requireNonEmptyManifest,
  ROOT_CONFIG_EXCLUDES,
  SHARED_EXCLUDES_MODULE,
} from "./run-tools-tests";

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
    expect(all).toHaveLength(8 + 3 + 2 + 2);
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
  it("preserves all 8 manual //#test:tools excludes verbatim", () => {
    expect([...MANUAL_EXCLUDES]).toEqual([
      "tools/openclinxr/evidence/blueprint-voice-simulation-spike.test.ts",
      "tools/openclinxr/evidence/iwsdk/check-github-pages-site.test.ts",
      "tools/openclinxr/evidence/iwsdk/iwsdk-evidence-contract-check.test.ts",
      "tools/openclinxr/evidence/model-vetting-actor-player-runtime-evidence.test.ts",
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
