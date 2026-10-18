import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeHandoff } from "./handoff.js";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";

// Under a pre-commit hook git exports GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE,
// which override `cwd`. Without this scrub every fixture git call below would
// drive the HOST repository (measured 2026-09-23: core.bare flipped on the
// shared checkout). Same pattern as a-worker-exit-commits-its-tree.test.ts.
const GIT_ENV = {
  ...gitEnvWithoutInheritedRepoVars(),
  GIT_AUTHOR_NAME: "ctxcap-test",
  GIT_AUTHOR_EMAIL: "ctxcap@test",
  GIT_COMMITTER_NAME: "ctxcap-test",
  GIT_COMMITTER_EMAIL: "ctxcap@test",
} as Record<string, string>;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV }).trim();
}

function buildFixture(): { repo: string; branch: string; head: string; subjects: string[] } {
  const base = join(tmpdir(), `ocxr-handoff-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const origin = join(base, "origin.git");
  const repo = join(base, "repo");
  git(base === "" ? tmpdir() : tmpdir(), "init", "--bare", origin);
  execFileSync("git", ["init", "-b", "main", repo], { encoding: "utf8", env: GIT_ENV });
  git(repo, "remote", "add", "origin", origin);
  git(repo, "commit", "--allow-empty", "-m", "seed main");
  git(repo, "push", "-u", "origin", "main");
  git(repo, "checkout", "-b", "lane-x");
  git(repo, "commit", "--allow-empty", "-m", "lane first commit");
  git(repo, "commit", "--allow-empty", "-m", "lane second commit");
  git(repo, "worktree", "add", join(base, "wt-side"), "main");
  const head = git(repo, "rev-parse", "HEAD");
  return { repo, branch: "lane-x", head, subjects: ["lane second commit", "lane first commit"] };
}

describe("handoff", () => {
  it("names the branch, HEAD sha and both unpushed commit subjects", { timeout: 15_000 }, async () => {
    const { repo, branch, head, subjects } = buildFixture();
    const out = join(repo, ".openclinxr", "handoffs", "lane-x.md");
    const written = await writeHandoff({ repo, lane: "lane-x", results: [], cards: [] });
    expect(written).toBe(out);
    expect(existsSync(out)).toBe(true);
    const body = readFileSync(out, "utf8");
    expect(body).toContain(branch);
    expect(body).toContain(head);
    for (const subject of subjects) expect(body).toContain(subject);
    expect(body).toContain("You are resuming lane lane-x.");
  });
});
