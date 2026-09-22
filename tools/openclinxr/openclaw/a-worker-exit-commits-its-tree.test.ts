import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { commitWriteRoots } from "./commit-write-roots";

describe("worker exit commit write roots", () => {
  it("commits in-scope file and leaves out-of-scope file unstaged via commitWriteRoots", () => {
    const tmpDir = mkdtempSync({ cwd: "/tmp", prefix: "worker-exit-test-" });
    try {
      // Initialize a git repo
      execFileSync("git", ["init", "-q"], { cwd: tmpDir, encoding: "utf8" });
      execFileSync("git", ["config", "user.email", "test@test.com"], {
        cwd: tmpDir,
        encoding: "utf8",
      });
      execFileSync("git", ["config", "user.name", "Test"], {
        cwd: tmpDir,
        encoding: "utf8",
      });

      // Create the tools/openclinxr/openclaw directory structure
      const ow = resolve(tmpDir, "tools/openclinxr/openclaw");
      const owParent = resolve(tmpDir, "tools/openclinxr");
      mkdirSync(owParent, { recursive: true });
      mkdirSync(ow, { recursive: true });

      // Write one file under the declared write root (tools/openclinxr/openclaw)
      writeFileSync(resolve(ow, "in-scope-file.txt"), "in-scope content", "utf8");
      // Write one file at the repo root (OUTSIDE the write root)
      writeFileSync(resolve(tmpDir, "out-of-scope-file.txt"), "out-of-scope content", "utf8");

      // Call commitWriteRoots with the write root. It will commit only paths under
      // the write root and leave every other dirty path unstaged.
      commitWriteRoots(tmpDir, ["tools/openclinxr/openclaw"]);

      // Verify: in-scope file should be in HEAD
      const headTrees = execFileSync("git", [
        "ls-tree",
        "HEAD",
        "--name-only",
      ], {
        cwd: tmpDir,
        encoding: "utf8",
      });
      const headTreeLines = headTrees.split("\n").filter((l) => l.trim());
      expect(headTreeLines).toContain("tools/openclinxr/openclaw/in-scope-file.txt");

      // Verify: out-of-scope file should still be present as unstaged
      const statusOutput = execFileSync("git", ["status", "--porcelain"], {
        cwd: tmpDir,
        encoding: "utf8",
      });
      const outOfScopeLine = statusOutput.split("\n").find(
        (l) => l.includes("out-of-scope-file.txt"),
      );

      // The out-of-scope file must still be visible in git status --porcelain
      // (meaning it was NOT committed). It should be listed as a modified file.
      expect(outOfScopeLine).toBeDefined();
      // It should NOT be a deletion or rename
      expect(outOfScopeLine).not.toMatch(/^D/);
      expect(outOfScopeLine).not.toMatch(/^R/);
      // It should be a modified file (starts with " M" or " M " pattern)
      expect(outOfScopeLine).toMatch(/^ M /);

      console.log(`  PASS: commitWriteRoots committed in-scope, left out-of-scope unstaged`);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});