/**
 * Real-git fixtures for merge-kill. Mocked git proves the mock; these prove the criteria.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";
import {
  formatMergeKillReport,
  parseAddedLines,
  parseNameStatus,
  parseRefFreezeCeilings,
  parseSizeFreezeCeilings,
  runMergeKill,
  type MergeKillReport,
} from "./merge-kill.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...gitEnvWithoutInheritedRepoVars(),
      GIT_AUTHOR_NAME: "merge-kill-test",
      GIT_AUTHOR_EMAIL: "merge-kill-test@example.com",
      GIT_COMMITTER_NAME: "merge-kill-test",
      GIT_COMMITTER_EMAIL: "merge-kill-test@example.com",
    },
  });
}

function initRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "merge-kill-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", "-b", "main", root], {
    stdio: "ignore",
    env: gitEnvWithoutInheritedRepoVars(),
  });
  git(root, ["config", "user.email", "merge-kill-test@example.com"]);
  git(root, ["config", "user.name", "merge-kill-test"]);
  return root;
}

function write(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function commitAll(root: string, message: string): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
}

/** Contract that is "verified" for clean paths. */
const okContract = {
  proofsOk: true as const,
  proofs: [{ rule: "exists:README.md", passed: true, detail: "found" }],
};

const SIZE_FREEZE_PATH =
  "packages/openclinxr/architecture-rules/src/checks/file-size-budgets.ts";
const REF_FREEZE_PATH =
  "packages/openclinxr/architecture-rules/src/checks/markdown-references.ts";

function sizeFreezeSource(entries: Record<string, number>): string {
  const body = Object.entries(entries)
    .map(
      ([path, n]) =>
        `  "${path}": { maxLines: ${n}, reason: "test freeze" },`,
    )
    .join("\n");
  return `export const SIZE_FREEZE = {\n${body}\n};\n`;
}

function refFreezeSource(entries: Record<string, number>): string {
  const body = Object.entries(entries)
    .map(([path, n]) => `  "${path}": ${n},`)
    .join("\n");
  return `export const BROKEN_REFERENCE_FREEZE = {\n${body}\n};\n`;
}

function findingIds(report: MergeKillReport): string[] {
  return report.findings.map((f) => f.id);
}

function killIds(report: MergeKillReport): string[] {
  return report.findings.filter((f) => f.severity === "kill").map((f) => f.id);
}

// ── Unit: parsers ────────────────────────────────────────────────────────────

describe("merge-kill parsers", () => {
  it("parseNameStatus handles M/A/D and renames", () => {
    const raw = [
      "M\tsrc/a.ts",
      "A\tsrc/b.ts",
      "D\tsrc/c.test.ts",
      "R100\told.test.ts\tnew-name.ts",
    ].join("\n");
    const entries = parseNameStatus(raw);
    expect(entries).toEqual([
      { status: "M", path: "src/a.ts" },
      { status: "A", path: "src/b.ts" },
      { status: "D", path: "src/c.test.ts" },
      { status: "R100", path: "new-name.ts", fromPath: "old.test.ts" },
    ]);
  });

  it("parseAddedLines returns only + lines with new-side numbers", () => {
    const raw = [
      "diff --git a/src/x.ts b/src/x.ts",
      "index 111..222 100644",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -3,0 +4,2 @@",
      "+alpha",
      "+beta",
    ].join("\n");
    expect(parseAddedLines(raw)).toEqual([
      { file: "src/x.ts", line: 4, text: "alpha" },
      { file: "src/x.ts", line: 5, text: "beta" },
    ]);
  });

  it("parseSizeFreezeCeilings keys by path and maxLines", () => {
    const map = parseSizeFreezeCeilings(
      sizeFreezeSource({ "apps/a.ts": 100, "apps/b.ts": 200 }),
    );
    expect(map.get("apps/a.ts")).toBe(100);
    expect(map.get("apps/b.ts")).toBe(200);
  });

  it("parseRefFreezeCeilings keys by path and integer ceiling", () => {
    const map = parseRefFreezeCeilings(refFreezeSource({ "docs/a.md": 3, "docs/b.md": 1 }));
    expect(map.get("docs/a.md")).toBe(3);
    expect(map.get("docs/b.md")).toBe(1);
  });
});

// ── Integration: real temporary git repos ────────────────────────────────────

describe("runMergeKill", () => {
  it("1. clean diff on a trivial repo → killed:false and lists criteria that ran", () => {
    const root = initRepo();
    write(root, "README.md", "# base\n");
    commitAll(root, "init");
    git(root, ["checkout", "-q", "-b", "wt/clean"]);
    write(root, "README.md", "# base\n\nhello\n");
    commitAll(root, "feat: harmless edit");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/clean",
      contract: okContract,
      // classifier injected and returns empty → forbidden-class is clean, not skipped
      classifyForbidden: () => [],
    });

    expect(report.killed).toBe(false);
    expect(report.schemaVersion).toBe("openclinxr.merge-kill.v1");
    expect(report.changedFiles).toBeGreaterThan(0);
    expect(report.skippedChecks).toEqual([]);
    expect(killIds(report)).toEqual([]);

    const formatted = formatMergeKillReport(report);
    expect(formatted).toMatch(/criteria evaluated:/);
    expect(formatted).toMatch(/added-suppression: clean/);
    expect(formatted).toMatch(/deleted-test: clean/);
    expect(formatted).toMatch(/raised-ceiling: clean/);
    expect(formatted).toMatch(/contract-not-verified: clean/);
    expect(formatted).toMatch(/forbidden-class: clean/);
    expect(formatted).toMatch(/VERDICT: pass/);
  });

  it("2. added suppression line → added-suppression kill with file and line", () => {
    const root = initRepo();
    write(root, "src/app.ts", "export const x = 1;\n");
    commitAll(root, "init");
    git(root, ["checkout", "-q", "-b", "wt/suppress"]);
    // Build the token so this test source does not itself look like a production suppression
    // when someone diffs this worktree — the violation lives only in the temp repo.
    const ignore = ["@", "ts-ignore"].join("");
    write(root, "src/app.ts", `// ${ignore}\nexport const x = 1;\nexport const y = 2;\n`);
    commitAll(root, "feat: silence the compiler");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/suppress",
      contract: okContract,
      classifyForbidden: () => [],
    });

    expect(report.killed).toBe(true);
    expect(killIds(report)).toContain("added-suppression");
    const finding = report.findings.find((f) => f.id === "added-suppression");
    expect(finding?.evidence[0]?.file).toBe("src/app.ts");
    expect(finding?.evidence[0]?.line).toBe(1);
    expect(finding?.evidence[0]?.excerpt).toContain(ignore);
  });

  it("3. PRE-EXISTING suppression while other lines change → NO added-suppression kill", () => {
    const root = initRepo();
    const ignore = ["@", "ts-ignore"].join("");
    write(root, "src/app.ts", `// ${ignore}\nexport const x = 1;\n`);
    commitAll(root, "init with pre-existing suppression");
    git(root, ["checkout", "-q", "-b", "wt/touch"]);
    write(root, "src/app.ts", `// ${ignore}\nexport const x = 1;\nexport const y = 2;\n`);
    commitAll(root, "feat: touch other lines only");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/touch",
      contract: okContract,
      classifyForbidden: () => [],
    });

    expect(killIds(report)).not.toContain("added-suppression");
    // Still clean overall (contract ok, no other violations)
    expect(report.killed).toBe(false);
  });

  it("4. deleted foo.test.ts → deleted-test kill", () => {
    const root = initRepo();
    write(root, "foo.test.ts", "export {};\n");
    write(root, "README.md", "x\n");
    commitAll(root, "init");
    git(root, ["checkout", "-q", "-b", "wt/del-test"]);
    git(root, ["rm", "-q", "foo.test.ts"]);
    commitAll(root, "chore: drop the test");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/del-test",
      contract: okContract,
      classifyForbidden: () => [],
    });

    expect(report.killed).toBe(true);
    expect(killIds(report)).toContain("deleted-test");
    const finding = report.findings.find((f) => f.id === "deleted-test");
    expect(finding?.evidence.some((e) => e.file === "foo.test.ts")).toBe(true);
  });

  it("5. maxLines 100 → 200 in freeze map → raised-ceiling kill naming the entry", () => {
    const root = initRepo();
    write(root, SIZE_FREEZE_PATH, sizeFreezeSource({ "apps/god.ts": 100 }));
    write(root, REF_FREEZE_PATH, refFreezeSource({ "docs/a.md": 1 }));
    commitAll(root, "init freeze");
    git(root, ["checkout", "-q", "-b", "wt/raise"]);
    write(root, SIZE_FREEZE_PATH, sizeFreezeSource({ "apps/god.ts": 200 }));
    commitAll(root, "chore: raise ceiling");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/raise",
      contract: okContract,
      classifyForbidden: () => [],
    });

    expect(report.killed).toBe(true);
    expect(killIds(report)).toContain("raised-ceiling");
    const finding = report.findings.find((f) => f.id === "raised-ceiling");
    const excerpts = (finding?.evidence ?? []).map((e) => e.excerpt).join("\n");
    expect(excerpts).toMatch(/apps\/god\.ts/);
    expect(excerpts).toMatch(/100\s*→\s*200/);
  });

  it("6. maxLines 200 → 100 → NO raised-ceiling kill", () => {
    const root = initRepo();
    write(root, SIZE_FREEZE_PATH, sizeFreezeSource({ "apps/god.ts": 200 }));
    write(root, REF_FREEZE_PATH, refFreezeSource({ "docs/a.md": 1 }));
    commitAll(root, "init freeze high");
    git(root, ["checkout", "-q", "-b", "wt/lower"]);
    write(root, SIZE_FREEZE_PATH, sizeFreezeSource({ "apps/god.ts": 100 }));
    commitAll(root, "chore: tighten ceiling");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/lower",
      contract: okContract,
      classifyForbidden: () => [],
    });

    expect(killIds(report)).not.toContain("raised-ceiling");
    expect(report.killed).toBe(false);
  });

  it("7. NEW freeze entry added → raised-ceiling kill", () => {
    const root = initRepo();
    write(root, SIZE_FREEZE_PATH, sizeFreezeSource({ "apps/a.ts": 100 }));
    write(root, REF_FREEZE_PATH, refFreezeSource({ "docs/a.md": 1 }));
    commitAll(root, "init freeze");
    git(root, ["checkout", "-q", "-b", "wt/new-entry"]);
    write(
      root,
      SIZE_FREEZE_PATH,
      sizeFreezeSource({ "apps/a.ts": 100, "apps/b.ts": 999 }),
    );
    commitAll(root, "chore: grandfather another god-file");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/new-entry",
      contract: okContract,
      classifyForbidden: () => [],
    });

    expect(report.killed).toBe(true);
    expect(killIds(report)).toContain("raised-ceiling");
    const finding = report.findings.find((f) => f.id === "raised-ceiling");
    const excerpts = (finding?.evidence ?? []).map((e) => e.excerpt).join("\n");
    expect(excerpts).toMatch(/NEW maxLines entry "apps\/b\.ts"/);
  });

  it("8. proofsOk true with empty diff → empty-diff-with-passing-proofs kill", () => {
    const root = initRepo();
    write(root, "README.md", "x\n");
    commitAll(root, "init");
    // head == base → empty triple-dot diff
    git(root, ["branch", "-q", "wt/empty"]);

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/empty",
      contract: {
        proofsOk: true,
        proofs: [{ rule: "run:echo ok", passed: true, detail: "ok" }],
      },
      classifyForbidden: () => [],
    });

    expect(report.changedFiles).toBe(0);
    expect(report.killed).toBe(true);
    expect(killIds(report)).toContain("empty-diff-with-passing-proofs");
  });

  it("9. contract null → contract-not-verified kill", () => {
    const root = initRepo();
    write(root, "README.md", "x\n");
    commitAll(root, "init");
    git(root, ["checkout", "-q", "-b", "wt/nocontract"]);
    write(root, "README.md", "y\n");
    commitAll(root, "feat: edit");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/nocontract",
      contract: null,
      classifyForbidden: () => [],
    });

    expect(report.killed).toBe(true);
    expect(killIds(report)).toContain("contract-not-verified");
  });

  it("10. no classifier injected → forbidden-class in skippedChecks, not a pass", () => {
    const root = initRepo();
    write(root, "README.md", "x\n");
    commitAll(root, "init");
    git(root, ["checkout", "-q", "-b", "wt/noclass"]);
    write(root, "README.md", "y\n");
    commitAll(root, "feat: edit");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/noclass",
      contract: okContract,
      // classifyForbidden intentionally omitted
    });

    expect(report.skippedChecks.some((s) => s.startsWith("forbidden-class:"))).toBe(
      true,
    );
    // Skipped must not appear as a kill finding either — absence of classifier ≠ violation
    expect(findingIds(report)).not.toContain("forbidden-class");
    // And must not be silently counted as pass: format shows SKIPPED
    const formatted = formatMergeKillReport(report);
    expect(formatted).toMatch(/forbidden-class: SKIPPED/);
    expect(formatted).not.toMatch(/forbidden-class: clean/);
  });

  it("11. commit message containing --no-verify → hook-bypass-in-history kill", () => {
    const root = initRepo();
    write(root, "README.md", "x\n");
    commitAll(root, "init");
    git(root, ["checkout", "-q", "-b", "wt/bypass"]);
    write(root, "README.md", "y\n");
    // Message mentions the bypass token (the incident class this criterion catches)
    const noVerify = ["--", "no-verify"].join("");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", `feat: land with ${noVerify} because hooks were red`]);

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/bypass",
      contract: okContract,
      classifyForbidden: () => [],
    });

    expect(report.killed).toBe(true);
    expect(killIds(report)).toContain("hook-bypass-in-history");
  });

  it("12. formatMergeKillReport names every killing finding", () => {
    const root = initRepo();
    write(root, "README.md", "x\n");
    write(root, "gone.test.ts", "export {};\n");
    commitAll(root, "init");
    git(root, ["checkout", "-q", "-b", "wt/multi"]);
    git(root, ["rm", "-q", "gone.test.ts"]);
    const ignore = ["@", "ts-ignore"].join("");
    write(root, "src/bad.ts", `// ${ignore}\nexport const z = 0;\n`);
    commitAll(root, "feat: multi-violation");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/multi",
      contract: null,
      classifyForbidden: () => [],
    });

    expect(report.killed).toBe(true);
    const kills = killIds(report);
    expect(kills).toContain("deleted-test");
    expect(kills).toContain("added-suppression");
    expect(kills).toContain("contract-not-verified");

    const formatted = formatMergeKillReport(report);
    for (const id of kills) {
      expect(formatted).toContain(`[KILL] ${id}:`);
    }
    expect(formatted).toMatch(/VERDICT: KILL/);
  });

  it("rename that strips .test. from the name → deleted-test kill", () => {
    const root = initRepo();
    write(root, "foo.test.ts", "export {};\n");
    commitAll(root, "init");
    git(root, ["checkout", "-q", "-b", "wt/rename-test"]);
    git(root, ["mv", "foo.test.ts", "foo.ts"]);
    commitAll(root, "chore: demote test to source");

    const report = runMergeKill({
      repoRoot: root,
      base: "main",
      head: "wt/rename-test",
      contract: okContract,
      classifyForbidden: () => [],
    });

    expect(killIds(report)).toContain("deleted-test");
  });
});
