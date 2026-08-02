import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  expandPathsToFiles,
  handoffRelativePath,
  isPathAllowedForPromote,
  mapWorktreePathToMain,
  mapWorktreeSourcePath,
  normalizeRepoRelativePath,
  parseGitStatusShort,
  parseWorktreePromoteArgs,
  partitionPromotePaths,
  promoteReportPath,
  worktreeDirMatchesRepo,
} from "./worktree-promote.ts";

describe("worktree-promote pure helpers", () => {
  it("normalizes repo-relative paths", () => {
    expect(normalizeRepoRelativePath("./foo/bar.ts")).toBe("foo/bar.ts");
    expect(normalizeRepoRelativePath("\\foo\\bar.ts")).toBe("foo/bar.ts");
    expect(normalizeRepoRelativePath("/packages/x.ts")).toBe("packages/x.ts");
  });

  it("allows writeRoots globs and role handoff only", () => {
    const roots = ["packages/openclinxr/arena/**", "tools/openclinxr/asset-pipeline/**"];
    expect(
      isPathAllowedForPromote(
        "packages/openclinxr/arena/foo.ts",
        roots,
        "xr-systems-architect",
      ),
    ).toBe(true);
    expect(
      isPathAllowedForPromote(
        ".openclinxr/slices/context-opt-wave-c/handoffs/xr-systems-architect.json",
        roots,
        "xr-systems-architect",
      ),
    ).toBe(true);
    expect(
      isPathAllowedForPromote(
        ".openclinxr/slices/context-opt-wave-c/handoffs/other-role.json",
        roots,
        "xr-systems-architect",
      ),
    ).toBe(false);
    expect(isPathAllowedForPromote("apps/ui-xr/src/main.ts", roots, "xr-systems-architect")).toBe(
      false,
    );
    expect(isPathAllowedForPromote("PROJECT_STATUS.md", roots, "xr-systems-architect")).toBe(
      false,
    );
  });

  it("partitions promote paths with clear skip reasons", () => {
    const roots = ["docs/agent-ops/**"];
    const { allowed, skipped } = partitionPromotePaths(
      [
        "docs/agent-ops/WORKTREE-PROMOTE.md",
        "packages/openclinxr/arena/x.ts",
        ".openclinxr/slices/s1/handoffs/hrbp.json",
      ],
      roots,
      "hrbp",
    );
    expect(allowed).toEqual([
      "docs/agent-ops/WORKTREE-PROMOTE.md",
      ".openclinxr/slices/s1/handoffs/hrbp.json",
    ]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.path).toBe("packages/openclinxr/arena/x.ts");
    expect(skipped[0]?.reason).toContain("writeRoots");
  });

  it("parses git status --short including renames and deletes", () => {
    const raw = [
      " M packages/openclinxr/arena/a.ts",
      "?? .openclinxr/slices/s1/handoffs/xr-systems-architect.json",
      "D  packages/openclinxr/arena/gone.ts",
      "R  old.ts -> packages/openclinxr/arena/new.ts",
      "",
    ].join("\n");
    const { paths, deleted } = parseGitStatusShort(raw);
    expect(paths).toContain("packages/openclinxr/arena/a.ts");
    expect(paths).toContain(".openclinxr/slices/s1/handoffs/xr-systems-architect.json");
    expect(paths).toContain("packages/openclinxr/arena/new.ts");
    expect(paths).not.toContain("packages/openclinxr/arena/gone.ts");
    expect(deleted).toContain("packages/openclinxr/arena/gone.ts");
  });

  it("maps relative paths onto worktree and main roots", () => {
    expect(mapWorktreeSourcePath("docs/a.md", "/tmp/wt")).toBe("/tmp/wt/docs/a.md");
    expect(mapWorktreePathToMain("docs/a.md", "/repo")).toBe("/repo/docs/a.md");
  });

  it("matches worktree container names for openclinxr", () => {
    expect(worktreeDirMatchesRepo("src-openclinxr", "openclinxr")).toBe(true);
    expect(worktreeDirMatchesRepo("openclinxr", "openclinxr")).toBe(true);
    expect(worktreeDirMatchesRepo("src-atlantis-cameras-v2", "openclinxr")).toBe(false);
  });

  it("builds handoff and report paths", () => {
    expect(handoffRelativePath("context-opt-wave-c", "hrbp")).toBe(
      ".openclinxr/slices/context-opt-wave-c/handoffs/hrbp.json",
    );
    expect(promoteReportPath("/repo", "s1", "hrbp")).toBe(
      "/repo/.openclinxr/openclaw/worktree-promote-s1-hrbp.json",
    );
  });

  it("parses CLI args for promote flags", () => {
    const flags = parseWorktreePromoteArgs([
      "promote",
      "--slice-id",
      "context-opt-wave-c",
      "--role",
      "hrbp",
      "--dry-run",
      "--worktree-path",
      "/tmp/wt",
    ]);
    expect(flags.command).toBe("promote");
    expect(flags.sliceId).toBe("context-opt-wave-c");
    expect(flags.roleId).toBe("hrbp");
    expect(flags.dryRun).toBe(true);
    expect(flags.worktreePath).toBe("/tmp/wt");
  });

  it("expands untracked directory paths to files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "wt-promote-"));
    mkdirSync(path.join(root, "docs", "agent-ops"), { recursive: true });
    writeFileSync(path.join(root, "docs", "agent-ops", "a.md"), "a\n", "utf8");
    writeFileSync(path.join(root, "docs", "agent-ops", "b.md"), "b\n", "utf8");
    writeFileSync(path.join(root, "file.ts"), "x\n", "utf8");
    const files = expandPathsToFiles(["docs/agent-ops/", "file.ts"], root).sort();
    expect(files).toEqual(["docs/agent-ops/a.md", "docs/agent-ops/b.md", "file.ts"]);
  });
});
