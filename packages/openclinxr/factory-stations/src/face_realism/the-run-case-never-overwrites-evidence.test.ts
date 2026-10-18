import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRunDir } from "./run-case.js";

/**
 * Card tsk_386c8c91eee19dca handback B1: run-case.ts must never overwrite
 * evidence. An explicitly requested run dir that exists and is non-empty
 * is never reused; the next free runN is allocated and the redirect is
 * recorded. Importing run-case.js must not execute the CLI (entrypoint
 * guard) — this file's import itself proves it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function freshCaseDir(): string {
  const root = join(tmpdir(), `run-case-no-overwrite-${process.pid}-${roots.length}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

describe("run-case never overwrites evidence", () => {
  it("a free requested run is used as-is without redirect", () => {
    const dir = freshCaseDir();
    expect(resolveRunDir(dir, 2)).toEqual({ runN: 2, redirected: false });
  });

  it("a non-empty requested run dir redirects to the next free run and keeps the old files", () => {
    const dir = freshCaseDir();
    mkdirSync(join(dir, "run1"), { recursive: true });
    mkdirSync(join(dir, "run2"), { recursive: true });
    writeFileSync(join(dir, "run2", "stage-records.json"), '{"run":"run2"}\n');
    const got = resolveRunDir(dir, 2);
    expect(got).toEqual({ runN: 3, redirected: true });
    expect(readFileSync(join(dir, "run2", "stage-records.json"), "utf8")).toBe('{"run":"run2"}\n');
    expect(existsSync(join(dir, "run3"))).toBe(false);
  });

  it("an empty requested run dir is reusable (mkdir residue, no evidence)", () => {
    const dir = freshCaseDir();
    mkdirSync(join(dir, "run4"), { recursive: true });
    expect(readdirSync(join(dir, "run4")).length).toBe(0);
    expect(resolveRunDir(dir, 4)).toEqual({ runN: 4, redirected: false });
  });

  it("no requested run allocates the next free index", () => {
    const dir = freshCaseDir();
    mkdirSync(join(dir, "run1"), { recursive: true });
    writeFileSync(join(dir, "run1", "x"), "x");
    expect(resolveRunDir(dir, null)).toEqual({ runN: 2, redirected: false });
  });

  it("the CLI module does not self-execute on import", () => {
    expect(typeof resolveRunDir).toBe("function");
    expect(HERE.endsWith("face_realism")).toBe(true);
  });
});
