/**
 * tools-file-cache.test.ts — counterweight tests for the per-file result cache.
 *
 * Fixture-repo style: every case builds a tiny repo in a temp dir (never the
 * real tree, never real slots) and asserts which files EXECUTE, not just the
 * exit code. The fake runner is planExecution: `toRun` is the executed set,
 * `skipped` the cached set.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCli } from "./run-tools-tests";
import {
  computeFileKey,
  computeSalt,
  createKeyContext,
  extractStringLiterals,
  fingerprintDataPath,
  parseVitestJsonResults,
  planExecution,
  resolveLiteralToRepoPath,
  SALT_FILES,
  type FileCacheStore,
} from "./tools-file-cache";

const EMPTY_ENV = {};

function fixtureRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tools-file-cache-"));
  for (const salt of SALT_FILES) {
    mkdirSync(path.dirname(path.join(dir, salt)), { recursive: true });
    writeFileSync(path.join(dir, salt), `// salt fixture ${salt}\n`);
  }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

/** A test file with a code dependency (helper) and a data dependency (data.json). */
function instrumentedRepo(): { dir: string; test: string } {
  const dir = fixtureRepo({
    "t.test.ts": `import { v } from "./helper.js";\nimport { readFileSync } from "node:fs";\nexport const d = readFileSync("./data.json", "utf8");\nexport const w = v;\n`,
    "helper.ts": `export const v = 1;\n`,
    "data.json": `{"threshold": 0.5}\n`,
  });
  return { dir, test: "t.test.ts" };
}

function keysFor(dir: string, files: readonly string[]): Map<string, string> {
  const ctx = createKeyContext(dir, EMPTY_ENV);
  const keys = new Map<string, string>();
  for (const f of files) keys.set(f, computeFileKey(path.join(dir, f), ctx).key);
  return keys;
}

/** Drive one fake run: plan, "execute" toRun, record only passes. */
function fakeRun(
  dir: string,
  files: readonly string[],
  store: FileCacheStore,
  passed: readonly string[],
): { executed: string[]; skipped: string[]; store: FileCacheStore } {
  const keys = keysFor(dir, files);
  const plan = planExecution(files, keys, store);
  const next: FileCacheStore = { version: store.version, entries: { ...store.entries } };
  for (const f of plan.toRun) {
    if (passed.includes(f)) next.entries[f] = keys.get(f) as string;
  }
  return { executed: plan.toRun, skipped: plan.skipped, store: next };
}

const EMPTY_STORE: FileCacheStore = { version: 1, entries: {} };

describe("file key invalidation", () => {
  it("(a) a cached passing test reruns after a byte change to a module in its closure", () => {
    const { dir, test } = instrumentedRepo();
    try {
      const first = fakeRun(dir, [test], EMPTY_STORE, [test]);
      expect(first.executed).toEqual([test]);
      // PASS recorded: an unchanged rerun would skip.
      expect(fakeRun(dir, [test], first.store, []).executed).toEqual([]);
      // One byte in the helper invalidates the key.
      appendFileSync(path.join(dir, "helper.ts"), "// x\n");
      const after = fakeRun(dir, [test], first.store, []);
      expect(after.executed).toEqual([test]);
      expect(after.skipped).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(b) a cached passing test reruns after a byte change to a data file its closure names by literal path", () => {
    const { dir, test } = instrumentedRepo();
    try {
      const first = fakeRun(dir, [test], EMPTY_STORE, [test]);
      expect(first.executed).toEqual([test]);
      expect(fakeRun(dir, [test], first.store, []).executed).toEqual([]);
      appendFileSync(path.join(dir, "data.json"), " ");
      const after = fakeRun(dir, [test], first.store, []);
      expect(after.executed).toEqual([test]);
      expect(after.skipped).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(c) a failing test is not recorded and reruns", () => {
    const { dir, test } = instrumentedRepo();
    try {
      const first = fakeRun(dir, [test], EMPTY_STORE, []);
      expect(first.executed).toEqual([test]);
      expect(first.store.entries[test]).toBeUndefined();
      const second = fakeRun(dir, [test], first.store, []);
      expect(second.executed).toEqual([test]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(d) --no-file-cache runs everything even when a matching PASS is recorded", () => {
    const { dir, test } = instrumentedRepo();
    try {
      const recorded = fakeRun(dir, [test], EMPTY_STORE, [test]);
      expect(recorded.store.entries[test]).toBeDefined();
      expect(parseCli(["--no-file-cache"], dir).noFileCache).toBe(true);
      // The runner passes a null store on the --no-file-cache path.
      const keys = keysFor(dir, [test]);
      const plan = planExecution([test], keys, null);
      expect(plan.toRun).toEqual([test]);
      expect(plan.skipped).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(f) a test that passed while its literal-path asset was absent reruns once the asset appears", () => {
    // An asset-gated test skips (and reports pass) when its file is missing; the
    // recorded PASS must not survive the file arriving.
    const dir = fixtureRepo({
      "t.test.ts": `import { existsSync } from "node:fs";\nexport const gated = existsSync("evidence/late.glb");\n`,
    });
    const test = "t.test.ts";
    try {
      const first = fakeRun(dir, [test], EMPTY_STORE, [test]);
      expect(fakeRun(dir, [test], first.store, []).executed).toEqual([]);
      mkdirSync(path.join(dir, "evidence"), { recursive: true });
      writeFileSync(path.join(dir, "evidence/late.glb"), "glb");
      expect(fakeRun(dir, [test], first.store, []).executed).toEqual([test]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(g) a test naming an absolute path outside the repo reruns when that file appears", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "tools-file-cache-store-"));
    const storeFile = path.join(outside, "bake.glb");
    const dir = fixtureRepo({
      "t.test.ts": `import { existsSync } from "node:fs";\nexport const gated = existsSync(${JSON.stringify(storeFile)});\n`,
    });
    const test = "t.test.ts";
    try {
      const first = fakeRun(dir, [test], EMPTY_STORE, [test]);
      expect(fakeRun(dir, [test], first.store, []).executed).toEqual([]);
      writeFileSync(storeFile, "glb");
      expect(fakeRun(dir, [test], first.store, []).executed).toEqual([test]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("(e) an unchanged passing test is skipped", () => {
    const { dir, test } = instrumentedRepo();
    try {
      const recorded = fakeRun(dir, [test], EMPTY_STORE, [test]);
      const keys = keysFor(dir, [test]);
      const plan = planExecution([test], keys, recorded.store);
      expect(plan.toRun).toEqual([]);
      expect(plan.skipped).toEqual([test]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("key parts", () => {
  it("extracts static literals and skips computed template strings (K4 gap)", () => {
    const lits = extractStringLiterals(`const a = "./data.json";\nconst b = \`plain\`;\nconst c = \`./\${name}.json\`;\n`);
    expect(lits).toContain("./data.json");
    expect(lits).toContain("plain");
    expect(lits).not.toContain("./x.json");
  });

  it("resolves repo-relative and file-relative literals and rejects escapes", () => {
    const dir = fixtureRepo({ "sub/t.test.ts": "x", "data.json": "{}", "sub/only-here.json": "{}" });
    try {
      expect(resolveLiteralToRepoPath("data.json", path.join(dir, "sub", "t.test.ts"), dir)).toBe(
        path.join(dir, "data.json"),
      );
      expect(resolveLiteralToRepoPath("./only-here.json", path.join(dir, "sub", "t.test.ts"), dir)).toBe(
        path.join(dir, "sub", "only-here.json"),
      );
      expect(resolveLiteralToRepoPath("./data.json", path.join(dir, "sub", "t.test.ts"), dir)).toBe(
        path.join(dir, "data.json"),
      );
      expect(resolveLiteralToRepoPath("../..", path.join(dir, "sub", "t.test.ts"), dir)).toBeNull();
      expect(resolveLiteralToRepoPath("nope.json", path.join(dir, "sub", "t.test.ts"), dir)).toBeNull();
      expect(resolveLiteralToRepoPath("", path.join(dir, "sub", "t.test.ts"), dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fingerprints files by content and directories by tree (fallback, no git)", () => {
    const dir = fixtureRepo({ "d/a.json": `{"v":1}\n`, "f.txt": "hello\n" });
    try {
      const before = fingerprintDataPath(path.join(dir, "d"), dir);
      appendFileSync(path.join(dir, "d", "a.json"), " ");
      expect(fingerprintDataPath(path.join(dir, "d"), dir)).not.toBe(before);
      const f1 = fingerprintDataPath(path.join(dir, "f.txt"), dir);
      appendFileSync(path.join(dir, "f.txt"), "!");
      expect(fingerprintDataPath(path.join(dir, "f.txt"), dir)).not.toBe(f1);
      expect(fingerprintDataPath(path.join(dir, "nope.json"), dir)).toBe("missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("salts over keying sources, node version, and OPENCLINXR_/BLENDER env", () => {
    const dir = fixtureRepo({});
    try {
      const a = computeSalt(dir, {}, "v1");
      const b = computeSalt(dir, { OPENCLINXR_X: "1" }, "v1");
      const c = computeSalt(dir, {}, "v2");
      expect(b).not.toBe(a);
      expect(c).not.toBe(a);
      expect(computeSalt(dir, { UNRELATED: "1" }, "v1")).toBe(a);
      appendFileSync(path.join(dir, "package.json"), " ");
      expect(computeSalt(dir, {}, "v1")).not.toBe(a);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("vitest json attribution", () => {
  it("maps per-file status, omits files absent from the report", () => {
    const root = "/repo";
    const json = JSON.stringify({
      testResults: [
        { name: "/repo/a.test.ts", status: "passed" },
        { name: "/repo/b.test.ts", status: "failed" },
        { name: "/elsewhere/c.test.ts", status: "passed" },
        { name: "/repo/d.test.ts" },
      ],
    });
    const statuses = parseVitestJsonResults(json, root);
    expect(statuses.get("a.test.ts")).toBe("passed");
    expect(statuses.get("b.test.ts")).toBe("failed");
    expect(statuses.has("c.test.ts")).toBe(false);
    expect(statuses.has("d.test.ts")).toBe(false);
    expect(parseVitestJsonResults("not json", root).size).toBe(0);
  });

  it("does not record a file whose every test skipped (the reporter calls it passed; a skip gate may open later)", () => {
    const root = "/repo";
    const json = JSON.stringify({
      testResults: [
        { name: "/repo/gated.test.ts", status: "passed", assertionResults: [{ status: "skipped" }, { status: "pending" }] },
        { name: "/repo/mixed.test.ts", status: "passed", assertionResults: [{ status: "passed" }, { status: "skipped" }] },
      ],
    });
    const statuses = parseVitestJsonResults(json, root);
    expect(statuses.has("gated.test.ts")).toBe(false);
    expect(statuses.get("mixed.test.ts")).toBe("passed");
  });
});
