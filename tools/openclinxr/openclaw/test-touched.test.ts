import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  COMMIT_FILES_B64_FLAG,
  commitFileSetFromArgs,
  decodeCommitFileSet,
  encodeCommitFileSet,
  planTests,
  touchedSourceFiles,
} from "./test-touched.js";

/** Short unique scratch root (long TMPDIR breaks tsx IPC). */
function scratch(): string {
  return mkdtempSync(join("/tmp", `ph114-touched-${process.pid}-`));
}

/**
 * Fixture env (ph117): temp-repo git setup must never inherit the caller's
 * foreign repo vars. A GIT_INDEX_FILE / GIT_DIR / GIT_WORK_TREE exported by a
 * hook or an acceptance probe points at trees whose blobs are absent in the
 * fresh temp repo and breaks fixture creation before any source assertion.
 * Explicit per-fixture overrides (e.g. a private alternate index) pass via
 * `extra` and win over the cleaned defaults.
 */
function cleanFixtureEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_INDEX_FILE;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", ...extra };
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync("git", args, {
    cwd,
    env: env ?? cleanFixtureEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Temp repo modelling the ph113 incident: real index A carries unrelated
 * staged work, the working tree adds unstaged + untracked noise, and private
 * index B carries only the intended commit file. Returns { dir, indexB }.
 */
function incidentFixture(): { dir: string; indexB: string } {
  const dir = scratch();
  git(dir, ["init", "-b", "main"]);
  git(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "base"]);
  writeFileSync(join(dir, "unstaged.ts"), "export const a = 1;\n");
  git(dir, ["add", "unstaged.ts"]);
  git(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "tracked"]);
  writeFileSync(join(dir, "unrelated.ts"), "export const u = 1;\n");
  git(dir, ["add", "unrelated.ts"]); // real index A: unrelated work only
  writeFileSync(join(dir, "unstaged.ts"), "export const a = 2;\n"); // unstaged modification
  writeFileSync(join(dir, "untracked.ts"), "export const n = 1;\n"); // untracked noise
  writeFileSync(join(dir, "intended.ts"), "export const ok = 1;\n");
  // Private commit index B: only the intended file staged (simulates the git
  // hook's GIT_INDEX_FILE temp index).
  const indexB = join(dir, ".git", "indexB");
  const bEnv = cleanFixtureEnv({ GIT_INDEX_FILE: indexB });
  git(dir, ["read-tree", "HEAD"], bEnv);
  git(dir, ["add", "intended.ts"], bEnv);
  // intended.ts stays staged in B only: remove it from the workdir so the
  // default interactive query (real index A) cannot see it at all.
  rmSync(join(dir, "intended.ts"));
  return { dir, indexB };
}

describe("test:touched explicit commit file set (ph114)", () => {
  const savedIndex = process.env.GIT_INDEX_FILE;
  afterEach(() => {
    if (savedIndex === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = savedIndex;
  });

  it("round-trips the exact file list, including spaces/quotes/unicode (no escaping loss)", () => {
    const files = [
      "apps/api/src/odd name.ts",
      "packages/openclinxr/xr-pose/src/it’s-quoted-“x”.tsx",
      "tools/openclinxr/openclaw/a b/c.ts",
    ];
    expect(decodeCommitFileSet(encodeCommitFileSet(files))).toEqual([...files].sort());
  });

  it("fails closed on malformed payloads (no silent fallback to a re-queried set)", () => {
    expect(() => decodeCommitFileSet("!!!not-json!!!")).toThrow(/malformed/);
    expect(() => decodeCommitFileSet("")).toThrow(/malformed/);
    expect(() => decodeCommitFileSet(Buffer.from("{}").toString("base64"))).toThrow(/malformed/);
    expect(() => decodeCommitFileSet(Buffer.from("[1,2]").toString("base64"))).toThrow(/malformed/);
    expect(() => decodeCommitFileSet(Buffer.from('[""]').toString("base64"))).toThrow(/malformed/);
    expect(() => decodeCommitFileSet(Buffer.from('["/abs/path.ts"]').toString("base64"))).toThrow(/malformed/);
    expect(() => decodeCommitFileSet(Buffer.from('["../escape.ts"]').toString("base64"))).toThrow(/malformed/);
    expect(() => decodeCommitFileSet(Buffer.from('["a\\\\b.ts"]').toString("base64"))).toThrow(/malformed/);
  });

  it("commitFileSetFromArgs is null without the flag (interactive default unchanged)", () => {
    expect(commitFileSetFromArgs([])).toBeNull();
    expect(commitFileSetFromArgs(["--profile", "pre-commit"])).toBeNull();
  });

  it("commitFileSetFromArgs throws when the flag has no value", () => {
    expect(() => commitFileSetFromArgs([COMMIT_FILES_B64_FLAG])).toThrow(/requires a value/);
  });

  it("default interactive set still merges staged+unstaged+untracked (unchanged behavior)", () => {
    const { dir } = incidentFixture();
    delete process.env.GIT_INDEX_FILE;
    expect(touchedSourceFiles({ cwd: dir })).toEqual(["unrelated.ts", "unstaged.ts", "untracked.ts"]);
  });

  it("commit mode consumes the explicit list exclusively — unrelated staged/unstaged/untracked excluded", () => {
    const { dir, indexB } = incidentFixture();
    // Even under the commit temp index, a re-query would see the WRONG set
    // (stripped env reads real index A: unrelated.ts). The explicit payload is
    // the only correct source — assert the consumer path never re-queries.
    const explicit = decodeCommitFileSet(encodeCommitFileSet(["intended.ts", "notes.md"]));
    const sources = explicit.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    const plan = planTests(sources);
    expect(plan).toEqual({ kind: "run", rootFiles: ["intended.ts"], byPackage: new Map() });
    // And the payload itself carries nothing from the working tree:
    expect(explicit).toEqual(["intended.ts", "notes.md"]);
    expect(indexB.endsWith("indexB")).toBe(true);
    expect(dir.length).toBeGreaterThan(0);
  });

  it("planTests keeps root/package partition for an explicit commit set", () => {
    const plan = planTests(["tools/openclinxr/openclaw/test-touched.ts"]);
    expect(plan).toEqual({
      kind: "run",
      rootFiles: ["tools/openclinxr/openclaw/test-touched.ts"],
      byPackage: new Map(),
    });
  });
});
