import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Paid-provider policy scan — the workspace file set whose contents are checked for paid cloud
 * model / voice SDK credentials (env templates, configs, manifests, tool sources).
 *
 * WHY THIS EXISTS: the scan used to walk the whole workspace tree (55,650 files, ~3.2 s per walk)
 * and then spawn `git check-ignore` per candidate (~100 subprocesses) to exclude gitignored local
 * secrets, and the suite called it three times with no memoisation — 3 walks + 300 spawns, ~9.4 s
 * at rest against a 5 s test timeout, closing the land path for every commit staging `apps/**`
 * (#352).
 *
 * `git ls-files` returns the tracked file set in ONE subprocess (~3,000 files, ~200 ms) and
 * excludes gitignored files by construction — which is exactly the property the per-file
 * check-ignore loop was re-deriving. Results are memoised so repeated calls within a process cost
 * nothing.
 *
 * Scope note: this enumerates TRACKED files. Untracked-but-not-ignored local scratch is
 * deliberately out of scope — the scan polices the committed policy surface.
 */

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 12; index += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const workspaceRoot = findWorkspaceRoot();

/** Directory names the old whole-tree walk skipped; kept for parity on the tracked set. */
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules", ".git", ".claude"]);

function isUnderSkippedDirectory(filePath: string): boolean {
  return filePath.split("/").some((segment) => SKIPPED_DIRECTORIES.has(segment));
}

function trackedWorkspaceFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: workspaceRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function typescriptPolicySourceFiles(tracked: string[]): string[] {
  return tracked
    .filter((filePath) =>
      filePath.startsWith("apps/") || filePath.startsWith("packages/") || filePath.startsWith("tools/")
    )
    .filter((filePath) => /\.tsx?$/.test(filePath))
    .filter((filePath) => !isUnderSkippedDirectory(filePath))
    .filter((filePath) => !/\.test\.tsx?$/.test(filePath))
    .filter((filePath) => !filePath.includes("/generated/"));
}

function packageManifestFiles(tracked: string[]): string[] {
  return tracked
    .filter((filePath) => filePath.endsWith("package.json"))
    .filter((filePath) => !filePath.includes("/node_modules/") && !filePath.includes("/dist/"));
}

function workspaceConfigAndEnvFiles(tracked: string[]): string[] {
  return tracked.filter((filePath) =>
    filePath.startsWith(".env")
    || filePath === "turbo.json"
    || filePath === "pnpm-workspace.yaml"
    || /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(filePath)
    || /(^|\/)(?:vite|vitest|tsdown|rolldown|biome|eslint|storybook|codegen|tailwind|postcss)\.config\.[cm]?[jt]s$/.test(filePath)
  );
}

let cachedFiles: string[] | null = null;

/**
 * The sorted, de-duplicated policy file set, relative to the workspace root. Memoised: the second
 * call within a process is a return, not a re-scan.
 */
export function collectPaidProviderPolicyFiles(): string[] {
  if (cachedFiles !== null) return cachedFiles;
  const tracked = trackedWorkspaceFiles()
    // A tracked-but-deleted transient (mid-edit worktree) must not be returned: consumers
    // readFileSync every path in the set.
    .filter((filePath) => existsSync(join(workspaceRoot, filePath)));
  cachedFiles = [...new Set([
    ...typescriptPolicySourceFiles(tracked),
    ...packageManifestFiles(tracked),
    ...workspaceConfigAndEnvFiles(tracked),
  ])].sort();
  return cachedFiles;
}
