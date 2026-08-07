/**
 * Worktree asset provisioning (#66) — copy DECLARED files from main into a worker tree.
 *
 * Design decided by peer round (see worktree-asset-provisioning.test.ts header):
 *   - SYMLINK rejected: dispatch `--deny` is a literal-path matcher, not an FS sandbox; concurrent
 *     workers would share main's ignored assets as a live write target.
 *   - WHOLE-ROOT copy rejected on cost: cagematch ~352 MB + generated-humanoids ~48 MB × N workers.
 *   - COPY DECLARED FILES adopted. Brief names paths; only those are provisioned.
 *
 * Copy strategy: prefer `COPYFILE_FICLONE` (macOS clonefile / CoW when available) so we do not
 * pay a full byte copy on same-volume clones, then fall back to a plain copy. HARD LINKS are not
 * used — a hardlink makes worker writes visible in main, which is the same class of isolation
 * failure as a symlink.
 *
 * Wired from {@link prepareWorktreeForWorker} so a real dispatch uses it. assetPaths come from the
 * trusted brief (`assetPaths`) and/or `DispatchOptions.assetPaths`.
 */

import {
  copyFileSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

export type ProvisionWorktreeAssetsInput = {
  worktreePath: string;
  /** Repo-relative paths the slice declared. Only these are copied. */
  assetPaths: string[];
  /** Source tree (usually main). Defaults to process.cwd(). */
  repoRoot?: string;
};

export type ProvisionedAsset = { path: string; bytes: number };

export type ProvisionWorktreeAssetsReport = {
  provisioned: ProvisionedAsset[];
};

/** Refuse absolute paths and `..` escapes — provisioner only copies repo-relative declarations. */
export function assertSafeAssetPath(rel: string): void {
  if (rel.trim() === "") {
    throw new Error("provisionWorktreeAssets: asset path is empty");
  }
  if (isAbsolute(rel)) {
    throw new Error(
      `provisionWorktreeAssets: assetPaths must be repo-relative, got absolute: ${rel}`,
    );
  }
  const norm = normalize(rel);
  if (norm === ".." || norm.startsWith(`..${sep}`) || norm.split(sep).includes("..")) {
    throw new Error(
      `provisionWorktreeAssets: assetPaths must not escape repo root: ${rel}`,
    );
  }
}

/**
 * Copy one file. Prefer copy-on-write clone (FICLONE); fall back to full copy.
 * Never hardlink — worker mutations must not appear in main.
 */
function copyFilePreferClone(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  try {
    copyFileSync(src, dest, constants.COPYFILE_FICLONE);
  } catch {
    // Platform lacks clonefile / cross-device: plain byte copy.
    copyFileSync(src, dest);
  }
}

function copyDeclaredPath(
  src: string,
  dest: string,
  relPath: string,
  out: ProvisionedAsset[],
): void {
  const st = statSync(src);
  if (st.isDirectory()) {
    // Declared path may be a directory; recurse only that path (not undeclared siblings).
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(src)) {
      const childRel = relPath === "" ? name : `${relPath}/${name}`;
      copyDeclaredPath(join(src, name), join(dest, name), childRel, out);
    }
    return;
  }
  if (!st.isFile()) return;
  copyFilePreferClone(src, dest);
  out.push({ path: relPath.replace(/\\/g, "/"), bytes: st.size });
}

/**
 * Synchronous provisioner used by prepareWorktreeForWorker (sync prepare path).
 */
export function provisionWorktreeAssetsSync(
  input: ProvisionWorktreeAssetsInput,
): ProvisionWorktreeAssetsReport {
  const repoRoot = input.repoRoot ?? process.cwd();
  if (!existsSync(input.worktreePath)) {
    throw new Error(
      `provisionWorktreeAssets: worktreePath does not exist: ${input.worktreePath}`,
    );
  }
  if (!existsSync(repoRoot)) {
    throw new Error(`provisionWorktreeAssets: repoRoot does not exist: ${repoRoot}`);
  }

  const provisioned: ProvisionedAsset[] = [];
  for (const rel of input.assetPaths) {
    assertSafeAssetPath(rel);
    const src = join(repoRoot, rel);
    if (!existsSync(src)) {
      throw new Error(
        `provisionWorktreeAssets: declared asset missing from repoRoot: ${rel} `
        + `(looked under ${repoRoot})`,
      );
    }
    const dest = join(input.worktreePath, rel);
    copyDeclaredPath(src, dest, rel.replace(/\\/g, "/"), provisioned);
  }
  return { provisioned };
}

/**
 * Async entry matching the planted contract signature.
 * Implementation is sync copy (FICLONE/plain); Promise keeps the public API awaitable.
 */
export async function provisionWorktreeAssets(
  input: ProvisionWorktreeAssetsInput,
): Promise<ProvisionWorktreeAssetsReport> {
  return provisionWorktreeAssetsSync(input);
}
