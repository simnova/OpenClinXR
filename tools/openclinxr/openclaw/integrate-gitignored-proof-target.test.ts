/**
 * #217 — the gitignored-proof-target criterion, probed against real git repos.
 *
 * The class: a contract proof whose target is gitignored and absent from the merge diff cannot
 * fail for the right reason on a clean clone — it fails for a missing file (#215 cost a worker
 * a cycle and the orchestrator a wrong regression call). This is the destructive probe in three
 * parts:
 *
 *   1. untracked-and-gitignored exists: target  → the refusal FIRES
 *   2. the same target force-added (tracked)    → the refusal does NOT fire
 *   3. run:/changed: rules naming the same path  → the refusal does NOT fire
 *
 * plus the deliberate-untracked opt-out from the trusted brief, and glob targets.
 *
 * The check lives in merge-kill and is enforced at the land boundary; the opt-out is wired in
 * `integrate`, so both seams are covered here.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetCoordinationRootCache } from "./coordination-root.js";
import { integrate } from "./integrate.js";
import {
  evaluateGitignoredProofTarget,
  extractProofTarget,
  runMergeKill,
  type MergeKillReport,
} from "./merge-kill.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
  resetCoordinationRootCache();
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "gitignored-proof-target-test",
      GIT_AUTHOR_EMAIL: "gitignored-proof-target-test@example.com",
      GIT_COMMITTER_NAME: "gitignored-proof-target-test",
      GIT_COMMITTER_EMAIL: "gitignored-proof-target-test@example.com",
    },
  });
}

/** A repo with `.secret/` gitignored, one tracked file, and a `wt/` branch. */
function repoWithIgnoredSecretDir(): { root: string; base: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "gitignored-target-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", "-b", "main", root], { stdio: "ignore" });
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "t"]);
  writeFileSync(join(root, ".gitignore"), ".secret/\n");
  writeFileSync(join(root, "readme.md"), "base\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);

  git(root, ["checkout", "-q", "-b", "wt/slice"]);
  writeFileSync(join(root, "readme.md"), "base\nchanged\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "worker change"]);

  const base = git(root, ["rev-parse", "main"]).trim();
  const head = git(root, ["rev-parse", "wt/slice"]).trim();
  // integrate() merges head INTO the checked-out branch — it must be run from main.
  git(root, ["checkout", "-q", "main"]);
  return { root, base, head };
}

function forceAddToBranch(root: string, branch: string, rel: string, content: string): void {
  git(root, ["checkout", "-q", branch]);
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  git(root, ["add", "-f", rel]);
  git(root, ["commit", "-q", "-m", `force-add ${rel}`]);
}

function findingIds(report: MergeKillReport): string[] {
  return report.findings.map((f) => f.id);
}

const greenContract = (rules: string[]) => ({
  proofsOk: true as const,
  proofs: rules.map((rule) => ({ rule, passed: true, detail: "probe" })),
});

// ── Units ────────────────────────────────────────────────────────────────────

describe("extractProofTarget", () => {
  it("parses exists: and min-bytes: targets, surviving colons inside the target", () => {
    expect(extractProofTarget("exists:.openclinxr/evidence/x.json")).toBe(
      ".openclinxr/evidence/x.json",
    );
    expect(extractProofTarget("min-bytes:.openclinxr/evidence/x.json:2000")).toBe(
      ".openclinxr/evidence/x.json",
    );
    // macOS/POSIX paths can contain colons — the split is first..last colon, not a naive one.
    expect(extractProofTarget("min-bytes:docs/a:b.json:2000")).toBe("docs/a:b.json");
  });

  it("returns null for run:/changed:/handoff: rules and malformed min-bytes", () => {
    expect(extractProofTarget("run:pnpm test")).toBeNull();
    expect(extractProofTarget("changed:src/a.ts")).toBeNull();
    expect(extractProofTarget("min-bytes:only-target")).toBeNull();
  });
});

describe("evaluateGitignoredProofTarget", () => {
  it("flags gitignored-and-untracked, and spares tracked and non-ignored paths", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    const ignored = evaluateGitignoredProofTarget(root, ".secret/evidence.json", base, head);
    expect(ignored.gitignored).toBe(true);
    expect(ignored.tracked).toBe(false);
    expect(ignored.wouldRefuse).toBe(true);

    const tracked = evaluateGitignoredProofTarget(root, "readme.md", base, head);
    expect(tracked.gitignored).toBe(false);
    expect(tracked.tracked).toBe(true);
    expect(tracked.wouldRefuse).toBe(false);
  });

  it("never refuses an absolute path", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    const abs = evaluateGitignoredProofTarget(root, join(root, ".secret/evidence.json"), base, head);
    expect(abs.wouldRefuse).toBe(false);
  });
});

// ── The three-part destructive probe, at the merge-kill seam ─────────────────

describe("gitignored-proof-target — destructive probe (part 1): refusal fires", () => {
  it("kills when an exists: proof reads a gitignored target the branch does not land", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    // The proof is "green" (passed=true) against a file that only exists machine-locally.
    const report = runMergeKill({
      repoRoot: root,
      base,
      head,
      contract: greenContract(["exists:.secret/evidence.json"]),
      classifyForbidden: () => [],
    });

    expect(report.killed).toBe(true);
    expect(findingIds(report)).toContain("gitignored-proof-target");
    const finding = report.findings.find((f) => f.id === "gitignored-proof-target");
    expect(finding?.evidence[0]?.file).toBe(".secret/evidence.json");
    expect(finding?.evidence[0]?.excerpt).toMatch(/clean clone/);
  });

  it("kills on min-bytes: targets exactly as on exists:", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    const report = runMergeKill({
      repoRoot: root,
      base,
      head,
      contract: greenContract(["min-bytes:.secret/evidence.json:10"]),
      classifyForbidden: () => [],
    });
    expect(findingIds(report)).toContain("gitignored-proof-target");
  });

  it("kills on a glob target when nothing matching is tracked", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    const report = runMergeKill({
      repoRoot: root,
      base,
      head,
      contract: greenContract(["exists:.secret/*.png"]),
      classifyForbidden: () => [],
    });
    expect(findingIds(report)).toContain("gitignored-proof-target");
  });
});

describe("gitignored-proof-target — destructive probe (part 2): tracked is not refused", () => {
  it("does NOT kill when the same target was force-added (the remediation path)", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    forceAddToBranch(root, "wt/slice", ".secret/evidence.json", "catalog\n");
    const fixedHead = git(root, ["rev-parse", "wt/slice"]).trim();

    const report = runMergeKill({
      repoRoot: root,
      base,
      head: fixedHead,
      contract: greenContract(["exists:.secret/evidence.json"]),
      classifyForbidden: () => [],
    });

    expect(findingIds(report)).not.toContain("gitignored-proof-target");
    expect(report.killed).toBe(false);
  });

  it("does NOT kill a glob target when any tracked file matches it", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    forceAddToBranch(root, "wt/slice", ".secret/evidence.png", "png\n");
    const fixedHead = git(root, ["rev-parse", "wt/slice"]).trim();

    const report = runMergeKill({
      repoRoot: root,
      base,
      head: fixedHead,
      contract: greenContract(["exists:.secret/*.png"]),
      classifyForbidden: () => [],
    });

    expect(findingIds(report)).not.toContain("gitignored-proof-target");
  });

  it("does NOT kill when the gitignored target is already tracked on main", () => {
    const { root } = repoWithIgnoredSecretDir();
    // Force-add on MAIN before the branch is cut: a clean clone of main has the file.
    forceAddToBranch(root, "main", ".secret/evidence.json", "catalog\n");
    git(root, ["checkout", "-q", "wt/slice"]);
    writeFileSync(join(root, "readme.md"), "base\nchanged again\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "worker change 2"]);
    const base = git(root, ["rev-parse", "main"]).trim();
    const head = git(root, ["rev-parse", "wt/slice"]).trim();

    const report = runMergeKill({
      repoRoot: root,
      base,
      head,
      contract: greenContract(["exists:.secret/evidence.json"]),
      classifyForbidden: () => [],
    });

    expect(findingIds(report)).not.toContain("gitignored-proof-target");
    expect(report.killed).toBe(false);
  });
});

describe("gitignored-proof-target — destructive probe (part 3): run:/changed: are exempt", () => {
  it("does NOT kill on run: or changed: rules that name the same gitignored path", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    const report = runMergeKill({
      repoRoot: root,
      base,
      head,
      contract: greenContract(["run:pnpm exec true", "changed:.secret/evidence.json"]),
      classifyForbidden: () => [],
    });

    expect(findingIds(report)).not.toContain("gitignored-proof-target");
    // And nothing else fires — the branch is benign and the contract is green.
    expect(report.killed).toBe(false);
  });
});

// ── The opt-out: deliberate machine-local artifacts ──────────────────────────

describe("gitignored-proof-target — the deliberate-untracked opt-out", () => {
  it("does NOT kill a gitignored target listed in allowedGitignoredProofTargets", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    const report = runMergeKill({
      repoRoot: root,
      base,
      head,
      contract: greenContract(["exists:.secret/evidence.json"]),
      allowedGitignoredProofTargets: [".secret/evidence.json"],
      classifyForbidden: () => [],
    });

    expect(findingIds(report)).not.toContain("gitignored-proof-target");
    expect(report.killed).toBe(false);
  });

  it("the opt-out is exact — a similar-looking target is still refused", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    const report = runMergeKill({
      repoRoot: root,
      base,
      head,
      contract: greenContract(["exists:.secret/evidence.json"]),
      allowedGitignoredProofTargets: [".secret/other.json"],
      classifyForbidden: () => [],
    });

    expect(findingIds(report)).toContain("gitignored-proof-target");
  });

  it("integrate wires the brief's gitignoredProofTargetsAllowed into the land boundary", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();

    // The trusted brief lives in the coordination root (the scratch repo is its own root).
    const briefDir = join(root, ".openclinxr", "slices", "issue-probe");
    mkdirSync(briefDir, { recursive: true });
    writeFileSync(
      join(briefDir, "brief.json"),
      JSON.stringify({
        schemaVersion: "openclinxr.slice-brief.v1",
        id: "issue-probe",
        done_when: ["exists:.secret/evidence.json"],
        // A 639 MB capture directory must never be force-added — this is the stated decision.
        gitignoredProofTargetsAllowed: [".secret/evidence.json"],
      }, null, 2),
    );

    const result = integrate({
      repoRoot: root,
      base,
      head,
      slice: "issue-probe",
      contract: greenContract(["exists:.secret/evidence.json"]),
      dryRun: false,
    });

    expect(result.killReport.killed).toBe(false);
    expect(result.landed).toBe(true);
  });

  it("integrate REFUSES the same brief shape without the opt-out", () => {
    const { root, base, head } = repoWithIgnoredSecretDir();
    const briefDir = join(root, ".openclinxr", "slices", "issue-no-optout");
    mkdirSync(briefDir, { recursive: true });
    writeFileSync(
      join(briefDir, "brief.json"),
      JSON.stringify({
        schemaVersion: "openclinxr.slice-brief.v1",
        id: "issue-no-optout",
        done_when: ["exists:.secret/evidence.json"],
      }, null, 2),
    );

    const result = integrate({
      repoRoot: root,
      base,
      head,
      slice: "issue-no-optout",
      contract: greenContract(["exists:.secret/evidence.json"]),
      dryRun: false,
    });

    expect(result.killReport.killed).toBe(true);
    expect(result.killReport.findings.some((f) => f.id === "gitignored-proof-target")).toBe(true);
    expect(result.landed).toBe(false);
  });
});
