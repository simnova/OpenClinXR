/**
 * test-framework-routing.test.ts — classifier adversaries, facade-origin
 * checks, static relatedness, CLI partition, and continue-on-failure routing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildNodeTestArgs,
  buildPlaywrightTestArgs,
  buildVitestListArgs,
  buildVitestRelatedArgs,
  classifyTestFile,
  classifyTestSource,
  combineGroupCodes,
  createFileCache,
  facadeOriginReexportsPlaywright,
  filterKnownRed,
  FrameworkRoutingError,
  parseVitestFilesOnly,
  partitionByFramework,
  PLAYWRIGHT_FACADE_CANONICAL,
  reachesTouched,
  routeRelatedGroup,
  selectRelatedFiles,
  type ClassifyEnv,
  type GroupExec,
  type RouteRequest,
} from "./test-framework-routing.js";
import { isProjectArchivedRepoRel, PROJECT_ARCHIVE_EXCLUDES } from "./project-test-scope.js";

function facadeEnv(): ClassifyEnv {
  return {
    importerDir: "tests/openclinxr",
    isPlaywrightFacade: (resolved) => resolved === PLAYWRIGHT_FACADE_CANONICAL,
  };
}

function scratch(): string {
  return mkdtempSync(join("/tmp", `fw-routing-${process.pid}-`));
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
}

function withTree(files: Record<string, string>, fn: (root: string) => void): void {
  const root = scratch();
  try {
    writeTree(root, files);
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const REAL_FACADE_SOURCE = [
  `import { chromium as playwrightChromium } from "@playwright/test";`,
  `import { createSlottedChromium } from "./slotted-playwright.js";`,
  `export * from "@playwright/test";`,
  `export const chromium = createSlottedChromium(playwrightChromium);`,
  ``,
].join("\n");

describe("classifyTestSource (bare runner imports)", () => {
  it("routes the bare Playwright runner to playwright", () => {
    expect(classifyTestSource(`import { test, expect } from "@playwright/test";`, "a.spec.ts", facadeEnv())).toBe(
      "playwright",
    );
    expect(classifyTestSource(`const { test } = require("@playwright/test");`, "b.spec.ts", facadeEnv())).toBe(
      "playwright",
    );
    expect(classifyTestSource(`const t = await import("@playwright/test");`, "c.spec.ts", facadeEnv())).toBe(
      "playwright",
    );
    expect(classifyTestSource(`export { expect } from "@playwright/test";`, "d.spec.ts", facadeEnv())).toBe(
      "playwright",
    );
  });

  it("routes vitest and node:test to their runners", () => {
    expect(classifyTestSource(`import { describe, it } from "vitest";`, "a.test.ts", facadeEnv())).toBe("vitest");
    expect(classifyTestSource(`import test from "node:test";`, "b.test.ts", facadeEnv())).toBe("node");
    expect(classifyTestSource(`import { spec } from "node:test/reporters";`, "c.test.ts", facadeEnv())).toBe("node");
    expect(classifyTestSource(`import test = require("node:test");`, "d.test.ts", facadeEnv())).toBe("node");
  });

  it("does not mistake runner subpaths or sibling libraries for the runner", () => {
    expect(classifyTestSource(`import type { Reporter } from "@playwright/test/reporter";`, "a.ts", facadeEnv())).toBe(
      "vitest",
    );
    expect(classifyTestSource(`import { chromium } from "playwright";`, "b.ts", facadeEnv())).toBe("vitest");
    expect(classifyTestSource(`import assert from "node:assert/strict";`, "c.ts", facadeEnv())).toBe("vitest");
  });

  it("ignores type-only imports, comments, and string literals", () => {
    expect(classifyTestSource(`import type { test } from "@playwright/test";`, "a.ts", facadeEnv())).toBe("vitest");
    expect(classifyTestSource(`import { type test } from "@playwright/test";`, "b.ts", facadeEnv())).toBe("vitest");
    expect(classifyTestSource(`export type { Page } from "@playwright/test";`, "c.ts", facadeEnv())).toBe("vitest");
    expect(
      classifyTestSource(
        [`// import { test } from "@playwright/test";`, `/* import test from "node:test"; */`, `import { it } from "vitest";`].join(
          "\n",
        ),
        "d.ts",
        facadeEnv(),
      ),
    ).toBe("vitest");
    expect(
      classifyTestSource(
        [`const a = "import test from 'node:test'";`, `const b = \`await import("@playwright/test")\`;`, `void a; void b;`].join(
          "\n",
        ),
        "e.ts",
        facadeEnv(),
      ),
    ).toBe("vitest");
  });

  it("fails closed on mixed frameworks, naming the file", () => {
    const mixed: Array<[string, string]> = [
      [`import { it } from "vitest";\nimport { test } from "@playwright/test";\n`, "m1.spec.ts"],
      [`import test from "node:test";\nimport { test as pw } from "@playwright/test";\nvoid pw;\n`, "m2.spec.ts"],
      [`import test from "node:test";\nimport { it } from "vitest";\n`, "m3.test.ts"],
      [`import { it } from "vitest";\nconst pw = await import("@playwright/test");\nvoid pw;\n`, "m4.spec.ts"],
    ];
    for (const [src, name] of mixed) {
      expect(() => classifyTestSource(src, name, facadeEnv())).toThrow(FrameworkRoutingError);
      expect(() => classifyTestSource(src, name, facadeEnv())).toThrow(name);
    }
  });

  it("routes the canonical owned facade to playwright by precise path", () => {
    const src = `import { chromium, test, expect } from "../../tools/openclinxr/evidence/lib/slotted-playwright-test.js";\nvoid chromium; void test; void expect;\n`;
    expect(classifyTestSource(src, "spec.ts", facadeEnv())).toBe("playwright");
  });

  it("does not recognize basename lookalikes from other directories", () => {
    const env: ClassifyEnv = { importerDir: "tools/other", isPlaywrightFacade: () => false };
    const src = `import { test } from "./slotted-playwright-test.js";\nvoid test;\n`;
    expect(classifyTestSource(src, "x.test.ts", env)).toBe("vitest");
  });

  it("fails closed when the canonical path lacks a verified origin", () => {
    const env: ClassifyEnv = { importerDir: "tests/openclinxr", isPlaywrightFacade: () => false };
    const src = `import { test } from "../../tools/openclinxr/evidence/lib/slotted-playwright-test.js";\nvoid test;\n`;
    expect(() => classifyTestSource(src, "assembled.spec.ts", env)).toThrow(FrameworkRoutingError);
  });

  it("defaults framework-free files to vitest (the historical collector)", () => {
    expect(classifyTestSource(`import { foo } from "./helper.js";\nfoo();\n`, "a.test.ts", facadeEnv())).toBe("vitest");
  });
});

describe("classifyTestFile and facade origin", () => {
  it("verifies the real facade origin and classifies the real spec shape", () => {
    withTree(
      {
        [`${PLAYWRIGHT_FACADE_CANONICAL}.ts`]: REAL_FACADE_SOURCE,
        "tests/openclinxr/assembled-exam-learner-faculty.spec.ts": [
          `import { chromium, test, expect } from "../../tools/openclinxr/evidence/lib/slotted-playwright-test.js";`,
          `test("assembled", () => { expect(chromium).toBeDefined(); });`,
          ``,
        ].join("\n"),
      },
      (root) => {
        expect(facadeOriginReexportsPlaywright(root, createFileCache())).toBe(true);
        expect(classifyTestFile(resolve(root, "tests/openclinxr/assembled-exam-learner-faculty.spec.ts"), root)).toBe(
          "playwright",
        );
      },
    );
  });

  it("rejects a facade lookalike with no @playwright/test origin", () => {
    withTree(
      {
        [`${PLAYWRIGHT_FACADE_CANONICAL}.ts`]: `export const test = 1;\n`,
        "tests/openclinxr/assembled-exam-learner-faculty.spec.ts": [
          `import { test } from "../../tools/openclinxr/evidence/lib/slotted-playwright-test.js";`,
          `void test;`,
          ``,
        ].join("\n"),
      },
      (root) => {
        expect(facadeOriginReexportsPlaywright(root, createFileCache())).toBe(false);
        expect(() =>
          classifyTestFile(resolve(root, "tests/openclinxr/assembled-exam-learner-faculty.spec.ts"), root),
        ).toThrow(FrameworkRoutingError);
      },
    );
  });

  it("fails closed on unreadable files instead of skipping them", () => {
    withTree({}, (root) => {
      expect(() => classifyTestFile(resolve(root, "missing.test.ts"), root)).toThrow(FrameworkRoutingError);
    });
  });

  it("classifies node:test files on disk to node", () => {
    withTree({ "tools/x/portless-server.test.ts": `import test from "node:test";\ntest("a", () => {});\n` }, (root) => {
      expect(classifyTestFile(resolve(root, "tools/x/portless-server.test.ts"), root)).toBe("node");
    });
  });
});

describe("partitionByFramework", () => {
  it("partitions disjointly, exhaustively, and collapses duplicates", () => {
    withTree(
      {
        "a.test.ts": `import test from "node:test";\ntest("a", () => {});\n`,
        "b.test.ts": `import { it, expect } from "vitest";\nit("b", () => expect(1).toBe(1));\n`,
        [`${PLAYWRIGHT_FACADE_CANONICAL}.ts`]: REAL_FACADE_SOURCE,
        "sub/c.spec.ts": `import { test } from "../${PLAYWRIGHT_FACADE_CANONICAL}.js";\nvoid test;\n`,
      },
      (root) => {
        const files = ["a.test.ts", "b.test.ts", "sub/c.spec.ts", "a.test.ts"];
        const part = partitionByFramework(files, root);
        expect(part.node).toEqual(["a.test.ts"]);
        expect(part.vitest).toEqual(["b.test.ts"]);
        expect(part.playwright).toEqual(["sub/c.spec.ts"]);
        expect([...part.node, ...part.vitest, ...part.playwright].sort()).toEqual(
          ["a.test.ts", "b.test.ts", "sub/c.spec.ts"].sort(),
        );
      },
    );
  });

  it("throws on mixed-framework files instead of dropping them", () => {
    withTree(
      { "m.spec.ts": `import test from "node:test";\nimport { it } from "vitest";\n` },
      (root) => {
        expect(() => partitionByFramework(["m.spec.ts"], root)).toThrow(FrameworkRoutingError);
      },
    );
  });
});

describe("static relatedness (transitive closure)", () => {
  const tree: Record<string, string> = {
    "tools/openclinxr/evidence/lib/slotted-playwright.ts": `export const slot = 1;\n`,
    [`${PLAYWRIGHT_FACADE_CANONICAL}.ts`]: REAL_FACADE_SOURCE,
    "tests/openclinxr/helpers/harness.ts": `import "../fixtures/two-station.json";\nexport const h = 1;\n`,
    "tests/openclinxr/assembled-exam-learner-faculty.spec.ts": [
      `import { test } from "../../tools/openclinxr/evidence/lib/slotted-playwright-test.js";`,
      `import { h } from "./helpers/harness.js";`,
      `test("assembled", () => h);\n`,
    ].join("\n"),
    "tools/openclinxr/evidence/lib/slotted-playwright.test.ts": `import { it } from "vitest";\nit("x", () => {});\n`,
    "tools/x/unrelated.test.ts": `import { it } from "vitest";\nimport fs from "node:fs";\nvoid fs;\nit("u", () => {});\n`,
  };

  it("selects the Playwright spec transitively via the touched slotted source", () => {
    withTree(tree, (root) => {
      const env = { root, cache: createFileCache() };
      expect(
        selectRelatedFiles(["tests/openclinxr/assembled-exam-learner-faculty.spec.ts"], ["tools/openclinxr/evidence/lib/slotted-playwright.ts"], env),
      ).toEqual(["tests/openclinxr/assembled-exam-learner-faculty.spec.ts"]);
    });
  });

  it("does not select unrelated candidates", () => {
    withTree(tree, (root) => {
      const env = { root, cache: createFileCache() };
      expect(
        selectRelatedFiles(["tools/x/unrelated.test.ts"], ["tools/openclinxr/evidence/lib/slotted-playwright.ts"], env),
      ).toEqual([]);
      expect(
        selectRelatedFiles(
          ["tools/openclinxr/evidence/lib/slotted-playwright.test.ts"],
          ["tools/openclinxr/evidence/lib/slotted-playwright.ts"],
          env,
        ),
      ).toEqual([]);
    });
  });

  it("selects a touched candidate itself and terminates on import cycles", () => {
    withTree(
      {
        "a.test.ts": `import { it } from "vitest";\nimport "./b.js";\nit("a", () => {});\n`,
        "b.ts": `import "./a.js";\nexport const b = 1;\n`,
      },
      (root) => {
        const env = { root, cache: createFileCache() };
        expect(selectRelatedFiles(["a.test.ts"], ["a.test.ts"], env)).toEqual(["a.test.ts"]);
        expect(selectRelatedFiles(["a.test.ts"], ["tools/other/touched.ts"], env)).toEqual([]);
      },
    );
  });

  it("selects conservatively on unresolvable bare specifiers (aliases), not on externals", () => {
    withTree(
      {
        "aliased.test.ts": `import { it } from "vitest";\nimport { x } from "@openclinxr/xr-dialogue/actor-audio-runtime";\nvoid x;\nit("a", () => {});\n`,
        "plain.test.ts": `import { it } from "vitest";\nimport fs from "node:fs";\nvoid fs;\nit("p", () => {});\n`,
      },
      (root) => {
        const env = { root, cache: createFileCache(), bareIsExternal: (spec: string) => spec === "node:fs" || spec === "vitest" };
        expect(selectRelatedFiles(["aliased.test.ts"], ["tools/other/touched.ts"], env)).toEqual(["aliased.test.ts"]);
        expect(selectRelatedFiles(["plain.test.ts"], ["tools/other/touched.ts"], env)).toEqual([]);
      },
    );
  });

  it("follows a resolved workspace bare specifier into a touched file", () => {
    withTree(
      {
        "pkg/slots.ts": `export const slot = 1;\n`,
        "tools/n.test.ts": `import test from "node:test";\nimport { slot } from "@scope/pkg/slots";\nvoid slot;\ntest("n", () => {});\n`,
      },
      (root) => {
        const env = {
          root,
          cache: createFileCache(),
          bareIsExternal: () => true,
          resolveBare: (spec: string) => (spec === "@scope/pkg/slots" ? join(root, "pkg/slots.ts") : `/external/${spec}`),
        };
        expect(selectRelatedFiles(["tools/n.test.ts"], ["pkg/slots.ts"], env)).toEqual(["tools/n.test.ts"]);
        expect(selectRelatedFiles(["tools/n.test.ts"], ["pkg/other.ts"], env)).toEqual([]);
      },
    );
  });

  it("reachesTouched matches the real spec through the real facade file", () => {
    withTree(
      {
        [`${PLAYWRIGHT_FACADE_CANONICAL}.ts`]: REAL_FACADE_SOURCE,
        "tests/openclinxr/assembled-exam-learner-faculty.spec.ts": `import { test } from "../../${PLAYWRIGHT_FACADE_CANONICAL}.js";\nvoid test;\n`,
      },
      (root) => {
        const touched = new Set([`tools/openclinxr/evidence/lib/slotted-playwright`]);
        expect(
          reachesTouched("tests/openclinxr/assembled-exam-learner-faculty.spec.ts", touched, {
            root,
            cache: createFileCache(),
          }),
        ).toBe(true);
      },
    );
  });
});

describe("CLI and file partition (chosen runners, exact flags)", () => {
  it("builds the exact vitest related invocation (no list-only mode exists)", () => {
    expect(buildVitestRelatedArgs(["tools/a.ts"], ["tools/known-red.test.ts", "tests/x.spec.ts"])).toEqual([
      "related",
      "--run",
      "--passWithNoTests",
      "--exclude",
      "tools/known-red.test.ts",
      "--exclude",
      "tests/x.spec.ts",
      "tools/a.ts",
    ]);
  });

  it("builds the filesOnly discovery invocation", () => {
    expect(buildVitestListArgs()).toEqual([
      "list",
      "--filesOnly",
      "--exclude",
      ".openclinxr/**",
      "--exclude",
      ".openclinxr-local/**",
    ]);
    expect(buildVitestListArgs(["a.test.ts"])).toEqual(["list", "--filesOnly", "--exclude", "a.test.ts"]);
  });

  it("reuses the exact shared project archive policy in discovery", () => {
    expect(buildVitestListArgs()).toEqual(["list", "--filesOnly", "--exclude", ".openclinxr/**", "--exclude", ".openclinxr-local/**"]);
    expect([...PROJECT_ARCHIVE_EXCLUDES]).toEqual([".openclinxr/**", ".openclinxr-local/**"]);
  });

  it("drops preserved archive copies from the test override seam", () => {
    expect(isProjectArchivedRepoRel(".openclinxr/slices/demo/evidence/compose-pilot.test.mjs")).toBe(true);
      expect(isProjectArchivedRepoRel(".openclinxr-local/provider-cache/x.test.ts")).toBe(true);
      expect(isProjectArchivedRepoRel("tools/v.test.ts")).toBe(false);
      expect(isProjectArchivedRepoRel("some/nested/.openclinxr/tools/x.test.ts")).toBe(false);
  });

  it("builds the Playwright invocation with positional file filters", () => {
    expect(buildPlaywrightTestArgs(["tests/openclinxr/assembled-exam-learner-faculty.spec.ts"])).toEqual([
      "test",
      "tests/openclinxr/assembled-exam-learner-faculty.spec.ts",
    ]);
  });

  it("keeps node budgets (concurrency 2, no force-exit)", () => {
    const args = buildNodeTestArgs(["/root/tools/a.test.ts"]);
    expect(args).toContain("--import");
    expect(args).toContain("tsx");
    expect(args).toContain("--test");
    expect(args).toContain("--test-concurrency=2");
    expect(args.join(" ")).not.toMatch(/test-force-exit/);
  });

  it("parses filesOnly output, skipping noise and ANSI wrappers", () => {
    withTree({ "a.test.mjs": "x", "sub/b.spec.ts": "y" }, (root) => {
      const ESC = String.fromCharCode(27);
      const stdout = ["", `${ESC}[32m${root}/a.test.mjs${ESC}[39m`, "some log line", `${root}/sub/b.spec.ts`, "helper.ts", ""].join(
        "\n",
      );
      expect(parseVitestFilesOnly(stdout, root)).toEqual(["a.test.mjs", "sub/b.spec.ts"]);
    });
  });

  it("filters known-red selections without editing the list", () => {
    const red = [{ path: "tests/x.spec.ts", reason: "r", card: "c" }];
    expect(filterKnownRed(["tests/x.spec.ts", "tests/y.spec.ts"], red)).toEqual({
      kept: ["tests/y.spec.ts"],
      excluded: ["tests/x.spec.ts"],
    });
  });

  it("combines exits with first-nonzero-wins", () => {
    expect(combineGroupCodes([0, 0, 0])).toBe(0);
    expect(combineGroupCodes([1, 0, 0])).toBe(1);
    expect(combineGroupCodes([0, 0, 2])).toBe(2);
    expect(combineGroupCodes([1, 2, 3])).toBe(1);
  });
});

describe("routeRelatedGroup (one failure never skips the other runners)", () => {
  function fakeExec(stdout: string, codes: { vitest?: number; node?: number; playwright?: number }): {
    exec: GroupExec;
    runs: string[][];
    lists: string[][];
  } {
    const runs: string[][] = [];
    const lists: string[][] = [];
    const exec: GroupExec = {
      listFiles: (cmd) => {
        lists.push(cmd);
        return stdout;
      },
      runGroup: (cmd) => {
        runs.push(cmd);
        if (cmd.includes("playwright")) return codes.playwright ?? 0;
        if (cmd[0] !== "pnpm" && cmd.includes("--test")) return codes.node ?? 0;
        return codes.vitest ?? 0;
      },
    };
    return { exec, runs, lists };
  }

  function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
    return {
      root: "/repo",
      cwd: "/repo",
      label: "root",
      vitestPrefix: ["pnpm", "exec", "vitest"],
      sources: ["tools/a.ts"],
      redExcludes: ["tools/known-red.test.ts"],
      redEntries: [{ path: "tools/known-red.test.ts", reason: "r", card: "c" }],
      touchedRel: ["tools/a.ts"],
      ownerDir: null,
      candidatesOverride: ["tools/v.test.ts", "tools/n.test.ts", "tests/x.spec.ts"],
      ...overrides,
    };
  }

  function treeForSelection(): Record<string, string> {
    return {
      "tools/v.test.ts": `import { it } from "vitest";\nimport "./a.js";\nit("v", () => {});\n`,
      "tools/a.ts": `export const a = 1;\n`,
      "tools/n.test.ts": `import test from "node:test";\nimport "./a.js";\ntest("n", () => {});\n`,
      [`${PLAYWRIGHT_FACADE_CANONICAL}.ts`]: REAL_FACADE_SOURCE,
      "tests/x.spec.ts": `import { test } from "../${PLAYWRIGHT_FACADE_CANONICAL}.js";\nimport "../tools/a.js";\nvoid test;\n`,
    };
  }

  it("routes vitest/node/playwright to their runners with exact vitest flags", () => {
    withTree(treeForSelection(), (root) => {
      const req = request({ root, cwd: root });
      const { exec, runs } = fakeExec("", {});
      const out = routeRelatedGroup(req, exec);
      expect(out.code).toBe(0);
      expect(out.ranVitest).toBe(true);
      expect(out.ranNode).toBe(true);
      expect(out.ranPlaywright).toBe(true);
      expect(out.selectedNode).toEqual(["tools/n.test.ts"]);
      expect(out.selectedPlaywright).toEqual(["tests/x.spec.ts"]);
      const vitestRun = runs.find((c) => c.includes("related"));
      expect(vitestRun?.slice(0, 3)).toEqual(["pnpm", "exec", "vitest"]);
      expect(vitestRun).toContain("related");
      expect(vitestRun).toContain("--run");
      expect(vitestRun).toContain("--passWithNoTests");
      expect(vitestRun).toContain("tools/a.ts");
      const pwRun = runs.find((c) => c.includes("playwright"));
      expect(pwRun).toEqual(["pnpm", "exec", "playwright", "test", "tests/x.spec.ts"]);
      const nodeRun = runs.find((c) => c.includes("--test"));
      expect(nodeRun?.slice(1, 5)).toEqual(["--import", "tsx", "--test", "--test-concurrency=2"]);
    });
  });

  it("still runs node and playwright when vitest fails, and reports nonzero", () => {
    withTree(treeForSelection(), (root) => {
      const req = request({ root, cwd: root });
      const { exec, runs } = fakeExec("", { vitest: 1 });
      const out = routeRelatedGroup(req, exec);
      expect(out.vitestCode).toBe(1);
      expect(out.code).toBe(1);
      expect(runs.some((c) => c.includes("playwright"))).toBe(true);
      expect(runs.some((c) => c.includes("--test"))).toBe(true);
    });
  });

  it("still runs vitest and playwright when the node group fails", () => {
    withTree(treeForSelection(), (root) => {
      const req = request({ root, cwd: root });
      const { exec } = fakeExec("", { node: 2 });
      const out = routeRelatedGroup(req, exec);
      expect(out.nodeCode).toBe(2);
      expect(out.code).toBe(2);
      expect(out.ranVitest).toBe(true);
      expect(out.ranPlaywright).toBe(true);
    });
  });

  it("keeps known-red files out of routed selection and reports them", () => {
    withTree(treeForSelection(), (root) => {
      const req = request({
        root,
        cwd: root,
        candidatesOverride: ["tools/n.test.ts"],
        redEntries: [{ path: "tools/n.test.ts", reason: "planted", card: "t-1" }],
      });
      const { exec, runs } = fakeExec("", {});
      const out = routeRelatedGroup(req, exec);
      expect(out.selectedNode).toEqual([]);
      expect(out.redExcludedFromRouted).toEqual(["tools/n.test.ts"]);
      expect(out.ranNode).toBe(false);
      expect(runs.some((c) => c.includes("--test"))).toBe(false);
    });
  });

  it("runs nothing when no sources are touched", () => {
    withTree({}, (root) => {
      const req = request({ root, cwd: root, sources: [] });
      const { exec, runs } = fakeExec("", {});
      const out = routeRelatedGroup(req, exec);
      expect(out.code).toBe(0);
      expect(runs).toEqual([]);
    });
  });

  it("scopes root archive discovery to the repo root; package-local .openclinxr stays live", () => {
    withTree(
      {
        ...treeForSelection(),
        "packages/foo/.openclinxr/kept.test.ts": `import { it } from "vitest";\nit("kept", () => {});\n`,
      },
      (root) => {
        // Root owner discovery carries the archive excludes.
        const rootReq = request({ root, cwd: root, ownerDir: null, candidatesOverride: undefined });
        const rootSpy = fakeExec("", {});
        routeRelatedGroup(rootReq, rootSpy.exec);
        expect(rootSpy.lists[0]).toContain("--exclude");
        expect(rootSpy.lists[0]).toContain(".openclinxr/**");
        // Package owner discovery must not exclude live package-local `.openclinxr`.
        const pkgReq = request({
          root,
          cwd: join(root, "packages", "foo"),
          ownerDir: "packages/foo",
          candidatesOverride: undefined,
        });
        const pkgSpy = fakeExec(".openclinxr/kept.test.ts\n", {});
        const pkgOut = routeRelatedGroup(pkgReq, pkgSpy.exec);
        expect(pkgSpy.lists[0]).not.toContain("--exclude");
        expect(pkgOut.candidates.vitest).toEqual(["packages/foo/.openclinxr/kept.test.ts"]);
      },
    );
  });

  it("filters archived preserved copies from the override seam before partition", () => {
    withTree(treeForSelection(), (root) => {
      const req = request({
        root,
        cwd: root,
        candidatesOverride: [
          "tools/v.test.ts",
          ".openclinxr/slices/demo/evidence/compose-pilot.test.mjs",
        ],
      });
      const { exec } = fakeExec("", {});
      const out = routeRelatedGroup(req, exec);
      expect(out.candidates.vitest).toEqual(["tools/v.test.ts"]);
    });
  });
});
