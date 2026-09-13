/**
 * The CEO PostToolUse guard must skip only when NOTHING coordination-shaped is dirty.
 *
 * MEASURED 2026-09-12: the hook ran `pnpm agent:alignment && pnpm docs:drift-check` after every
 * matching tool call in the orchestrator session at 1.22 s a time, while `git status --porcelain`
 * answers in 0.03 s. Scoping is only safe if the skip branch is provably narrow, so this drives the
 * real script against real git repositories rather than unit-testing a copy of its logic.
 *
 * Black box on purpose: the script is `.mjs`, and importing it from TypeScript would add untyped
 * import errors to the typecheck error-count ratchet this repo freezes at zero.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const script = path.join(repoRoot, ".grok/hooks/post-coord-edit-scope.mjs");

function repoWith(files: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "coord-guard-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, env: gitEnvWithoutInheritedRepoVars() });
  for (const rel of files) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, "x\n", "utf8");
  }
  return dir;
}

function runGuard(cwd: string, env: Record<string, string> = {}): string {
  const r = spawnSync("node", [script], {
    cwd,
    encoding: "utf8",
    env: { ...gitEnvWithoutInheritedRepoVars(), OPENCLINXR_COORD_GUARD_DRY_RUN: "1", OPENCLINXR_WORKER: "0", GROK_SUBAGENT: "", ...env },
  });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

describe("CEO coordination guard scope", () => {
  it("skips when only product code is dirty", () => {
    const dir = repoWith(["apps/ui-xr/src/main.ts", "packages/openclinxr/domain/src/index.ts", "tools/openclinxr/openclaw/x.ts"]);
    const out = runGuard(dir);
    expect(out).toContain("no coordination path dirty");
    expect(out).not.toContain("running pnpm agent:alignment");
  });

  for (const coordPath of [
    "AGENTS.md",
    "PROJECT_STATUS.md",
    "CLAUDE.md",
    "docs/openclinxr/worker-backlog-and-validation-matrix.md",
    "docs/openclinxr/doc-authority-registry-2026-05-27.json",
    "agents/rules/GUARD_DRIFT.md",
    "agents/coordinator/chief-coordinator/memory.md",
    ".grok/hooks/post-coord-edit-guards.json",
    ".claude/skills/board-conduit/SKILL.md",
    "operator-open-questions.md",
  ]) {
    it(`runs the guards when ${coordPath} is dirty`, () => {
      const dir = repoWith(["apps/ui-xr/src/main.ts", coordPath]);
      const out = runGuard(dir);
      expect(out).toContain("running pnpm agent:alignment");
      expect(out).not.toContain("no coordination path dirty");
    });
  }

  it("fails safe and runs the guards when git status cannot be read", () => {
    // A directory that is not a git repository at all: `git status` exits non-zero.
    const dir = mkdtempSync(path.join(tmpdir(), "coord-guard-nogit-"));
    const out = runGuard(dir);
    expect(out).toContain("running pnpm agent:alignment");
  });

  it("stays a no-op for worker sessions, as before", () => {
    const dir = repoWith(["AGENTS.md"]);
    const out = runGuard(dir, { OPENCLINXR_WORKER: "1" });
    expect(out).toContain("PostToolUse (worker)");
    expect(out).not.toContain("running pnpm agent:alignment");
  });

  it("detects a coordination path renamed into place", () => {
    const dir = repoWith(["apps/ui-xr/src/main.ts"]);
    execFileSync("git", ["add", "-A"], { cwd: dir, env: gitEnvWithoutInheritedRepoVars() });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"], { cwd: dir, env: gitEnvWithoutInheritedRepoVars() });
    execFileSync("git", ["mv", "apps/ui-xr/src/main.ts", "AGENTS.md"], { cwd: dir, env: gitEnvWithoutInheritedRepoVars() });
    const out = runGuard(dir);
    expect(out).toContain("running pnpm agent:alignment");
  });
});
