/**
 * ci-w10: shared resolver that materializes machine-local test inputs from the
 * asset store, following the ECG precedent
 * (`tools/openclinxr/evidence/fixtures/ecg-controls/ecg-input-bootstrap.py` +
 * `OPENCLINXR_ECG_FIXTURE_ARCHIVE` handling in `run-tools-tests.ts`).
 *
 * Contract, per input topic:
 * - inputs live in the asset store (`/Volumes/files/openclinxr-assets/store/`),
 *   never in git;
 * - a TRACKED manifest pins the store path plus sha256 + byte size;
 * - the resolver reads the store path (or an absolute env-var override),
 *   verifies sha + size BEFORE any write, and throws a named
 *   `[ci-cleanup]` error when the store is absent or mismatched;
 * - archive members restore exact repo paths under gitignored
 *   `.openclinxr-local/` / `.openclinxr/`; an existing target with identical
 *   bytes is reused, an existing target with different bytes is a refusal.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve as pathResolve } from "node:path";

export type ArchiveEntry = { targetRepoPath: string; sha256: string; bytes: number };
export type ArchiveManifest = {
  envVar: string;
  storeArchive: string;
  archiveSha256: string;
  archiveBytes: number;
  entries: ArchiveEntry[];
};
export type SingleFileManifest = {
  envVar: string;
  storeFile: string;
  sha256: string;
  bytes: number;
  targetRepoPath: string;
};
export type RegistryManifest = {
  envVar: string;
  registryStorePath: string;
  registrySha256: string;
  registryBytes: number;
};

export function repoRootFrom(startDir: string): string {
  let cur = startDir;
  for (let i = 0; i < 14; i++) {
    if (existsSync(join(cur, "package.json")) && existsSync(join(cur, "tools"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error("[ci-cleanup] cannot discover repo root from " + startDir);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readManifest<T>(manifestPath: string): T {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as T;
}

/** Resolve the store input path: absolute env override, else the pinned default. */
function resolveStorePath(envVar: string, pinned: string, what: string): string {
  const env = process.env[envVar];
  if (env !== undefined && env !== "") {
    if (!isAbsolute(env)) throw new Error(`[ci-cleanup] refusing non-absolute ${envVar}: ${env}`);
    return env;
  }
  return pinned;
}

function refuseUnlessInside(root: string, repoRel: string, what: string): string {
  const target = pathResolve(root, repoRel);
  if (target !== root && !target.startsWith(root + "/")) {
    throw new Error(`[ci-cleanup] refusing ${what} outside workspace: ${repoRel}`);
  }
  return target;
}

function verifyFileBytes(path: string, expectedSha: string, expectedBytes: number, what: string): void {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) {
    throw new Error(`[ci-cleanup] missing store ${what} at ${path} (asset store absent or renamed)`);
  }
  const actualBytes = lstatSync(path).size;
  if (actualBytes !== expectedBytes) {
    throw new Error(
      `[ci-cleanup] refusing store ${what} with wrong byte size at ${path}: expected ${expectedBytes} got ${actualBytes}`,
    );
  }
  const actualSha = sha256File(path);
  if (actualSha !== expectedSha) {
    throw new Error(
      `[ci-cleanup] refusing store ${what} with wrong SHA256 at ${path}: expected ${expectedSha} got ${actualSha}`,
    );
  }
}

function publishVerified(root: string, targetRepoPath: string, staged: string, expectedSha: string): "restored" | "reused" {
  const target = refuseUnlessInside(root, targetRepoPath, "target");
  try {
    const st = lstatSync(target);
    if (st.isSymbolicLink()) throw new Error(`[ci-cleanup] refusing symlink at target: ${targetRepoPath}`);
    if (!st.isFile()) throw new Error(`[ci-cleanup] refusing non-regular target: ${targetRepoPath}`);
    if (sha256File(target) !== expectedSha) {
      throw new Error(`[ci-cleanup] REFUSE: existing different bytes preserved: ${targetRepoPath}`);
    }
    return "reused";
  } catch (err) {
    if (err instanceof Error && /REFUSE|refusing/.test(err.message)) throw err;
    // Missing target: fall through to publish.
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(staged, target);
  if (sha256File(target) !== expectedSha) {
    throw new Error(`[ci-cleanup] post-publish SHA mismatch: ${targetRepoPath}`);
  }
  return "restored";
}

/**
 * Verify a store tar.gz (sha + size), extract members to a temp dir, verify
 * every member sha, then publish to exact repo paths. No repo write happens
 * before the archive and all members verify.
 */
export function materializeArchive(
  manifestPath: string,
  root?: string,
): { restored: string[]; reused: string[] } {
  const manifest = readManifest<ArchiveManifest>(manifestPath);
  const repoRoot = root ?? repoRootFrom(dirname(manifestPath));
  const archive = resolveStorePath(manifest.envVar, manifest.storeArchive, "archive");
  verifyFileBytes(archive, manifest.archiveSha256, manifest.archiveBytes, "archive");
  const stage = mkdtempSync(join(tmpdir(), "ci-cleanup-"));
  try {
    execFileSync("tar", ["-xzf", archive, "-C", stage], { stdio: "pipe" });
    const staged = new Map<string, string>();
    for (const entry of manifest.entries) {
      refuseUnlessInside(repoRoot, entry.targetRepoPath, "member target");
      const member = join(stage, entry.targetRepoPath);
      if (!existsSync(member) || lstatSync(member).isSymbolicLink()) {
        throw new Error(`[ci-cleanup] archive member missing after extract: ${entry.targetRepoPath}`);
      }
      const raw = readFileSync(member);
      if (raw.byteLength !== entry.bytes) {
        throw new Error(`[ci-cleanup] size mismatch for ${entry.targetRepoPath}`);
      }
      if (createHash("sha256").update(raw).digest("hex") !== entry.sha256) {
        throw new Error(`[ci-cleanup] SHA mismatch for ${entry.targetRepoPath}`);
      }
      staged.set(entry.targetRepoPath, member);
    }
    const restored: string[] = [];
    const reused: string[] = [];
    for (const entry of manifest.entries) {
      const outcome = publishVerified(repoRoot, entry.targetRepoPath, staged.get(entry.targetRepoPath)!, entry.sha256);
      (outcome === "restored" ? restored : reused).push(entry.targetRepoPath);
    }
    return { restored, reused };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Verify a single store file (sha + size), then publish to its repo path. */
export function materializeSingleFile(
  manifestPath: string,
  root?: string,
): { restored: string[]; reused: string[] } {
  const manifest = readManifest<SingleFileManifest>(manifestPath);
  const repoRoot = root ?? repoRootFrom(dirname(manifestPath));
  const storeFile = resolveStorePath(manifest.envVar, manifest.storeFile, "input file");
  verifyFileBytes(storeFile, manifest.sha256, manifest.bytes, "input file");
  const outcome = publishVerified(repoRoot, manifest.targetRepoPath, storeFile, manifest.sha256);
  return outcome === "restored" ? { restored: [manifest.targetRepoPath], reused: [] } : { restored: [], reused: [manifest.targetRepoPath] };
}

/**
 * Resolve the scene-closure evidence registry: explicit env when set, else the
 * pinned store copy. The copy carries the same retrieval receipts, and
 * `loadRetrievedSources` re-hashes every object against its receipt, so the
 * default is the same verified bytes, not a fixture.
 */
export function resolveRegistryWithDefault(manifestPath: string): string {
  const manifest = readManifest<RegistryManifest>(manifestPath);
  const registry = resolveStorePath(manifest.envVar, manifest.registryStorePath, "registry");
  if (!isAbsolute(registry)) throw new Error(`[ci-cleanup] ${manifest.envVar} must be absolute`);
  verifyFileBytes(registry, manifest.registrySha256, manifest.registryBytes, "registry");
  return registry;
}
