import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gitEnvWithoutInheritedRepoVars } from "../openclinxr/openclaw/worktree-base-freshness.js";

/**
 * OBSERVABLE: the operator's four rule drafts (frozen 2026-10-19) were installed as three
 * on-demand agents/rules files by card hx-rules. A later edit that softens a draft sentence
 * (re-allowing stash push, next-to-file .bak, heavyq, a second fast-forward owner) must fail.
 *
 * claimScope: verbatim operator phrases are present per file, the C2/C3/C5/C6 removals are
 *   absent, and the startup tier still excludes the three files (pointer-only reachability).
 * notEvidenceFor: that any harness loads the pointed file at the right moment.
 */

const REPO = join(import.meta.dirname, "../..");

function ruleText(name: string): string {
  return readFileSync(join(REPO, "agents/rules", name), "utf8");
}

/** The whole phrase check in one function so the destructive probe can re-run it (T-probe). */
export function checkRuleText(text: string, must: readonly string[], mustNot: readonly string[]): string[] {
  const violations: string[] = [];
  for (const phrase of must) {
    if (!text.includes(phrase)) violations.push(`missing MUST phrase: ${phrase}`);
  }
  for (const phrase of mustNot) {
    if (text.includes(phrase)) violations.push(`present MUST-NOT phrase: ${phrase}`);
  }
  return violations;
}

const WORKTREE_MUST = [
  "Never edit tracked files in, or commit from, `/Volumes/files/src/openclinxr`",
  "Dispatcher resets also start from `origin/main`",
  "No stashes.",
  "No `--no-verify` and no `OPENCLINXR_SKIP_HOOKS`.",
  "One owner fast-forwards main.",
  "PROPOSED",
  "Grok Bot",
  "merge --ff-only origin/main",
  "Coordination files get a dedicated worktree, not an exemption.",
  "Big binaries go to the asset store.",
  "manifest.json",
  "must **fail**, not skip",
  "large-file-guard.ts",
  "OPENCLINXR_WT_ROOT",
] as const;

const WORKTREE_MUST_NOT = [
  "Hardcoded paths to fix",
  "Migration checklist",
  "hair-tgt2",
  "stash@{0}",
  "Done when:",
] as const;

const STANDING_MUST = [
  "Back up before you change anything",
  ".openclinxr/backups/<lane>/",
  "Keep stash entries",
  "git stash apply",
  "each of the other side's hunks",
  "Take the safe option after a timeout",
  "30 min",
  "Still needs Patrick live",
  "openclinxr-decisions.jsonl",
  "`undo` is required",
  "If in doubt, it isn't covered",
  "GUARD_WORKTREE_PER_LANE",
  "until a heavy-job queue exists, one heavy job at a time",
] as const;

const STANDING_MUST_NOT = ["stash push", ".bak-<", "heavyq", "or fast-forward `main`"] as const;

const PRIOR_ART_MUST = [
  "Step 0 of every new card",
  "What is the standard technique?",
  "Which references?",
  "How do professionals verify it?",
  "What does Quest need?",
  "Can the search be automated?",
  "Goodhart risk",
  "Log every trial",
  "Reproducible",
  "Free models first",
  "Reviewers reject a card",
  "Prior art -",
  "pre-dispatch-alignment",
  "scipy.optimize",
  "Compute-first candidates",
] as const;

const PRIOR_ART_MUST_NOT = [
  "heavyq",
  ".openclinxr/prior-art/",
  "Seen while surveying",
  "heavy-job-queue-design",
] as const;

/** 2,560 B cap on GUARD_SAFETY.md comes from card hx-rules (brief S2; 1,913 B at base 4b108ef17). */
const GUARD_SAFETY_BYTE_CAP = 2560;

function trackedClaudeRules(): string[] {
  const env = gitEnvWithoutInheritedRepoVars();
  delete env["GIT_PREFIX"];
  const out = execFileSync("git", ["ls-files", ".claude/rules"], { cwd: REPO, encoding: "utf8", env });
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

describe("the installed lane rules keep the operator's decisions", () => {
  it("GUARD_WORKTREE_PER_LANE.md keeps the Rule bullets and drops the one-time sections", () => {
    expect(checkRuleText(ruleText("GUARD_WORKTREE_PER_LANE.md"), WORKTREE_MUST, WORKTREE_MUST_NOT)).toEqual([]);
  });

  it("GUARD_STANDING_APPROVAL.md keeps the approval contract with the C2/C3/C4/C5 fixes", () => {
    expect(checkRuleText(ruleText("GUARD_STANDING_APPROVAL.md"), STANDING_MUST, STANDING_MUST_NOT)).toEqual([]);
  });

  it("PROTO_PRIOR_ART_COMPUTE_FIRST.md keeps Step 0 and the survey appendix without the dropped half", () => {
    expect(checkRuleText(ruleText("PROTO_PRIOR_ART_COMPUTE_FIRST.md"), PRIOR_ART_MUST, PRIOR_ART_MUST_NOT)).toEqual([]);
  });

  it("the three rules stay reachable by pointer, never by startup tier", () => {
    const safety = readFileSync(join(REPO, "agents/rules/GUARD_SAFETY.md"), "utf8");
    for (const base of ["GUARD_WORKTREE_PER_LANE.md", "GUARD_STANDING_APPROVAL.md", "PROTO_PRIOR_ART_COMPUTE_FIRST.md"]) {
      expect(safety, `GUARD_SAFETY.md must name ${base}`).toContain(base);
    }
    expect(
      statSync(join(REPO, "agents/rules/GUARD_SAFETY.md")).size,
      `GUARD_SAFETY.md must stay <= ${GUARD_SAFETY_BYTE_CAP} B`,
    ).toBeLessThanOrEqual(GUARD_SAFETY_BYTE_CAP);
    const preDispatch = readFileSync(join(REPO, ".claude/skills/pre-dispatch-alignment/SKILL.md"), "utf8");
    expect(preDispatch).toContain("PROTO_PRIOR_ART_COMPUTE_FIRST");
    const delegation = readFileSync(join(REPO, ".claude/skills/delegation-rules/SKILL.md"), "utf8");
    for (const base of ["GUARD_WORKTREE_PER_LANE.md", "GUARD_STANDING_APPROVAL.md", "PROTO_PRIOR_ART_COMPUTE_FIRST.md"]) {
      expect(delegation, `delegation-rules must point at ${base}`).toContain(base);
    }
    const claudeRules = trackedClaudeRules();
    for (const base of ["GUARD_WORKTREE_PER_LANE.md", "GUARD_STANDING_APPROVAL.md", "PROTO_PRIOR_ART_COMPUTE_FIRST.md"]) {
      expect(claudeRules, `.claude/rules must not track ${base}`).not.toContain(`.claude/rules/${base}`);
    }
  });

  it("destructive probe: deleting a MUST phrase and splicing a MUST-NOT phrase each report a violation", () => {
    const real = ruleText("GUARD_WORKTREE_PER_LANE.md");
    const before = checkRuleText(real, WORKTREE_MUST, WORKTREE_MUST_NOT);
    const deleted = checkRuleText(real.replace("No stashes.", ""), WORKTREE_MUST, WORKTREE_MUST_NOT);
    const spliced = checkRuleText(`${real}\nHardcoded paths to fix\n`, WORKTREE_MUST, WORKTREE_MUST_NOT);
    console.log(JSON.stringify({ before, afterDelete: deleted, afterSplice: spliced }));
    expect(before).toEqual([]);
    expect(deleted.length, "deleting a MUST phrase must report a violation").toBeGreaterThan(0);
    expect(spliced.length, "splicing a MUST-NOT phrase must report a violation").toBeGreaterThan(0);
  });
});
