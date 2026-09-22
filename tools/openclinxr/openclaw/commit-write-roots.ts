import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Commit only dirty paths whose repo-relative name is under one of the
 * declared write roots. Every other dirty path stays unstaged.
 * Never `git add -A` or `git add .`.
 *
 * After calling this function, the caller should recompute deriveHandoffState
 * so the ledger row reflects the committed state.
 *
 * @param repoPath Absolute path to the git repo root
 * @param writeRoots Repo-relative root paths (e.g. ["tools/openclinxr/openclaw"])
 *                   under which dirty paths will be committed
 */
export function commitWriteRoots(
  repoPath: string,
  writeRoots: readonly string[],
): void {
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoPath,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\n")
    .filter((l) => l.trim().length > 0);

  const toCommit: string[] = [];

  for (const line of porcelain) {
    // porcelain format: "XY filename" where XY is status codes (AM, M , MM, etc.)
    // The filename starts at position 3 (after the two status chars and space)
    const filename = line.trim().substring(3);

    if (!filename) continue;

    // Check if this file is under any of the write roots
    const underWriteRoot = writeRoots.some((root) => {
      // Normalize both paths: ensure they don't have leading/trailing slashes issues
      const normalizedRoot = root.replace(/\/+$/, "");
      const normalizedFilename =
        filename.replace(/^\/+/, "").replace(/^tools\//, "tools/");
      return normalizedFilename === normalizedRoot ||
        normalizedFilename.startsWith(normalizedRoot + "/");
    });

    if (underWriteRoot) {
      toCommit.push(filename);
    }
  }

  if (toCommit.length > 0) {
    // Stage only the in-scope files
    const filesArg = toCommit.map((f) => ` ${f}`).join("");
    execFileSync("git", ["add", ...toCommit], {
      cwd: repoPath,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Commit only the staged in-scope files
    execFileSync("git", ["commit", "-qm", "worker: in-scope file commit"], {
      cwd: repoPath,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  // If nothing in-scope is dirty, do not create a commit (no-op)
}
export { commitWriteRoots };
