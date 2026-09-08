import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFreezeListHonesty } from "./file-size-budgets.js";

/**
 * Diagnosis (IMMUTABLE): checkFreezeListHonesty measured a frozen file with
 * `git show HEAD:<file>`, so at pre-commit time it read the LAST COMMIT rather
 * than the tree being committed. Once a frozen file grew, HEAD held the
 * violation and the extraction that brought it back under its freeze ceiling
 * was rejected by the same gate that required the extraction. Measured on
 * CaseAuthoringWorkbench.tsx — staged at 672 against a 679 ceiling, reported
 * as 718 from HEAD.
 *
 * Known-good: freeze semantics stay shrink-only. Growth still fails. Only the
 * SOURCE of the line count was wrong.
 *
 * Counterweight: reading the working tree unconditionally would green the
 * repair case and break CI, which commits nothing and must still measure
 * committed content. Unstaged working-tree shrink must not hide HEAD/index
 * growth.
 *
 * ## FIXED (tsk_52788fa5047bc963)
 *
 * Honesty now prefers `git show :0:<file>` (the index / the commit being
 * formed), then HEAD, then the working tree for non-git fixtures.
 *
 * ## FIXED (tsk_52788fa5047bc963 review correction)
 *
 * `git show :0:` failing is not "try HEAD". A usable index that does not list
 * the path is a staged deletion and must report "file no longer exists".
 * `git ls-files` failing (non-git fixture) remains the only HEAD/working-tree
 * fallback.
 */

const ZONE_BUDGETS = [{ prefix: "packages/openclinxr/", maxLines: 10 }] as const;
const REL = "packages/openclinxr/frozen-actor.ts";
const FREEZE_CEILING = 20;
const HEAD_GROWN = 30;
const STAGED_REPAIR = 15;
const STAGED_GROWTH = 25;

function textWithLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `const n${i} = ${i};`).join("\n");
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  env.GIT_AUTHOR_NAME = "t";
  env.GIT_AUTHOR_EMAIL = "t@t";
  env.GIT_COMMITTER_NAME = "t";
  env.GIT_COMMITTER_EMAIL = "t@t";
  return env;
}

function git(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore", env: gitEnv() });
}

function makeGitRepo(headLines: number): { root: string } {
  const root = mkdtempSync(join(tmpdir(), "ratchet-honesty-"));
  mkdirSync(join(root, "packages", "openclinxr"), { recursive: true });
  mkdirSync(join(root, "apps"), { recursive: true });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@t"]);
  git(root, ["config", "user.name", "t"]);
  writeFileSync(join(root, REL), textWithLines(headLines));
  git(root, ["add", REL]);
  git(root, ["commit", "-q", "-m", "head"]);
  return { root };
}

function honesty(root: string) {
  return checkFreezeListHonesty({
    workspaceRoot: root,
    zoneBudgets: ZONE_BUDGETS,
    sizeFreeze: {
      [REL]: { maxLines: FREEZE_CEILING, reason: "fixture" },
    },
  });
}

function impossible(actual: number): string {
  return `${REL}: freeze ceiling ${FREEZE_CEILING} is below actual ${actual} — impossible (ceilings only shrink as files shrink)`;
}

describe("the ratchet measures what is being committed", () => {
  it("(1) a staged repair under the freeze ceiling is not blocked by a grown HEAD", () => {
    const { root } = makeGitRepo(HEAD_GROWN);
    writeFileSync(join(root, REL), textWithLines(STAGED_REPAIR));
    git(root, ["add", REL]);
    const stale = honesty(root);
    expect(
      stale.filter((v) => v.includes("impossible")),
      `HEAD-only read would report ${impossible(HEAD_GROWN)}; staged repair is ${STAGED_REPAIR} under ceiling ${FREEZE_CEILING}. got:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: a staged file that grows past its freeze ceiling is still reported", () => {
    const { root } = makeGitRepo(FREEZE_CEILING);
    writeFileSync(join(root, REL), textWithLines(STAGED_GROWTH));
    git(root, ["add", REL]);
    const stale = honesty(root);
    expect(stale).toContain(impossible(STAGED_GROWTH));
  });

  it("(3) COUNTERWEIGHT: an unstaged working-tree shrink does not hide HEAD growth", () => {
    const { root } = makeGitRepo(HEAD_GROWN);
    writeFileSync(join(root, REL), textWithLines(STAGED_REPAIR));
    const stale = honesty(root);
    expect(stale).toContain(impossible(HEAD_GROWN));
  });

  it("(4) COUNTERWEIGHT: a staged deletion is measured as absent, not as HEAD", () => {
    const { root } = makeGitRepo(HEAD_GROWN);
    git(root, ["rm", "-q", "--", REL]);
    const stale = honesty(root);
    expect(stale).toContain(`${REL}: file no longer exists — remove freeze entry`);
    expect(
      stale.filter((v) => v.includes("impossible")),
      "staged git rm fell through to HEAD line count",
    ).toEqual([]);
  });
});
