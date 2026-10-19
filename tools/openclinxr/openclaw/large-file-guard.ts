/**
 * Commit-time large-file / .env / .bak guard.
 *
 * Pure rule evaluation plus a CLI (`--staged | --push [--base <ref>]`, default base
 * `origin/main`) wired as the FIRST step of the pre-commit, pre-push, and strict
 * profiles in agentic-hook-runner.ts. There is no bypass flag or environment
 * variable: the only escape hatch is the reviewed allowlist file, which is read
 * from the BASE REF (never the working tree or index) so a commit cannot
 * allowlist itself.
 *
 * Rule sources (every threshold below cites its source; no invented numbers):
 *   - R-env / R-bak / R-binary / R-any: operator draft worktree-per-lane-rule.md
 *     section "Commit-time large-file guard" (binary-type files over 1 MB, any
 *     file over 5 MB, plus .env* and *.bak* refusal with a move-to-store fix).
 *   - Allowlist shape, per-glob maxBytes cap, base-ref read, seed entries:
 *     card hx-rules S5 (100,000,000 = GitHub's 100 MB blob limit).
 */
import { execFileSync, spawnSync } from "node:child_process";

export const DEFAULT_BASE = "origin/main";
export const ALLOWLIST_REPO_PATH = "tools/openclinxr/openclaw/large-file-allowlist.json";

/** Operator draft: binary-type files (npz|npy|blend|exr|glb) refused over 1 MB. */
export const BINARY_SIZE_LIMIT = 1048576; // 1 MiB
/** Operator draft: any file refused over 5 MB. */
export const ANY_SIZE_LIMIT = 5242880; // 5 MiB
/** Card hx-rules S5: an allowlist entry's maxBytes must be <= GitHub's 100 MB blob limit. */
export const ALLOWLIST_MAX_BYTES = 100000000;
/** Operator draft: the binary-type extensions the 1 MB rule applies to. */
export const BINARY_EXTENSIONS = new Set(["npz", "npy", "blend", "exr", "glb"]);
/** Operator draft R-env: basenames starting .env pass only with these suffixes. */
const ENV_EXAMPLE_SUFFIXES = [".example", ".sample", ".template"];
/** Card hx-rules S5: globs this broad exempt everything, so they invalidate the file. */
const FORBIDDEN_GLOBS = new Set(["*", "**", "**/*"]);

export type ViolationRule = "env" | "bak" | "binary" | "any";

export interface Violation {
  path: string;
  rule: ViolationRule;
  bytes: number;
  fix: string;
}

export interface AllowlistEntry {
  glob: string;
  reason: string;
  maxBytes: number;
}

export interface Allowlist {
  entries: AllowlistEntry[];
}

export const EMPTY_ALLOWLIST: Allowlist = { entries: [] };

const ENV_BAK_FIX = "remove it from the commit (secrets and backups can never be allowlisted)";
const BIG_BLOB_FIX =
  "move it to /Volumes/files/openclinxr-assets/store/<lane>/<name>/ with a manifest.json " +
  "(path, sha256, bytes, producer, source commit) and cite the path+sha256 in tracked JSON";

export function basenameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/** Operator draft R-env: basename starts `.env` unless it ends .example/.sample/.template. */
export function isEnvPath(path: string): boolean {
  const name = basenameOf(path);
  if (!name.startsWith(".env")) return false;
  return !ENV_EXAMPLE_SUFFIXES.some((s) => name.endsWith(s));
}

/** Operator draft R-bak: basename contains `.bak` (covers `notes.bak` and `.env.local.bak-<ts>`). */
export function isBakPath(path: string): boolean {
  return basenameOf(path).includes(".bak");
}

export function extensionOf(path: string): string {
  const name = basenameOf(path);
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * Subset glob matcher for allowlist entries: `**` crosses segments, `*` and `?`
 * stay inside one segment. Anything else in the glob is matched literally.
 */
export function globMatches(glob: string, path: string): boolean {
  const gSegs = glob.split("/");
  const pSegs = path.split("/");
  const segMatches = (g: string, p: string): boolean => {
    const re = `^${[...g].map((c) => (c === "*" ? "[^/]*" : c === "?" ? "[^/]" : escapeRegExp(c))).join("")}$`;
    return new RegExp(re).test(p);
  };
  const rec = (gi: number, pi: number): boolean => {
    if (gi === gSegs.length) return pi === pSegs.length;
    if (gSegs[gi] === "**") {
      for (let k = pi; k <= pSegs.length; k++) {
        if (rec(gi + 1, k)) return true;
      }
      return false;
    }
    if (pi === pSegs.length) return false;
    const g = gSegs[gi];
    const p = pSegs[pi];
    if (g === undefined || p === undefined) return false;
    return segMatches(g, p) && rec(gi + 1, pi + 1);
  };
  return rec(0, 0);
}

function escapeRegExp(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/, "\\$&");
}

/** Card hx-rules S5: allowlist validation; any defect fails the guard closed. */
export function validateAllowlist(json: unknown): { allowlist: Allowlist } | { error: string } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { error: "allowlist root must be an object with an entries array" };
  }
  const entries = (json as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    return { error: "allowlist root must be an object with an entries array" };
  }
  const out: AllowlistEntry[] = [];
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      return { error: "allowlist entry must be an object" };
    }
    const { glob, reason, maxBytes } = e as Record<string, unknown>;
    if (typeof glob !== "string" || glob === "") return { error: "allowlist entry needs a glob" };
    if (FORBIDDEN_GLOBS.has(glob)) {
      return { error: `allowlist glob '${glob}' is too broad and invalidates the file` };
    }
    if (typeof reason !== "string" || reason === "") {
      return { error: `allowlist entry for '${glob}' needs a reason` };
    }
    if (typeof maxBytes !== "number" || !Number.isInteger(maxBytes) || maxBytes <= 0) {
      return { error: `allowlist entry for '${glob}' needs a positive integer maxBytes` };
    }
    if (maxBytes > ALLOWLIST_MAX_BYTES) {
      return {
        error: `allowlist entry for '${glob}' exceeds GitHub's 100 MB blob limit (${ALLOWLIST_MAX_BYTES})`,
      };
    }
    out.push({ glob, reason, maxBytes });
  }
  return { allowlist: { entries: out } };
}

/**
 * Card hx-rules S5: an allowlist entry exempts R-binary and R-any only, per
 * matching glob, and only when size <= that entry's maxBytes. R-env and R-bak
 * can NEVER be allowlisted.
 */
export function isAllowlisted(path: string, bytes: number, allowlist: Allowlist): boolean {
  return allowlist.entries.some(
    (e) => globMatches(e.glob, path) && bytes <= e.maxBytes,
  );
}

export function checkFile(path: string, bytes: number, allowlist: Allowlist): Violation | null {
  if (isEnvPath(path)) return { path, rule: "env", bytes, fix: ENV_BAK_FIX };
  if (isBakPath(path)) return { path, rule: "bak", bytes, fix: ENV_BAK_FIX };
  // Operator draft: binary-type files over 1 MiB, or any file over 5 MiB.
  if (BINARY_EXTENSIONS.has(extensionOf(path)) && bytes > BINARY_SIZE_LIMIT) {
    if (!isAllowlisted(path, bytes, allowlist)) {
      return { path, rule: "binary", bytes, fix: BIG_BLOB_FIX };
    }
  }
  if (bytes > ANY_SIZE_LIMIT) {
    if (!isAllowlisted(path, bytes, allowlist)) {
      return { path, rule: "any", bytes, fix: BIG_BLOB_FIX };
    }
  }
  return null;
}

export function checkFiles(files: { path: string; bytes: number }[], allowlist: Allowlist): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    const v = checkFile(f.path, f.bytes, allowlist);
    if (v) out.push(v);
  }
  return out;
}

export function formatViolation(v: Violation): string {
  return `${v.path} | ${v.rule} | ${v.bytes} | ${v.fix}`;
}

function gitShow(ref: string, repoPath: string, cwd: string): string | null {
  try {
    // Probe: stderr silenced so the expected base-miss (first landing) does not
    // print git's own "fatal" above the guard's verdict.
    return execFileSync("git", ["show", `${ref}:${repoPath}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * Card hx-rules S5: read the allowlist from the base ref, never the working tree
 * or index, so a commit cannot allowlist itself. When the base ref lacks the file
 * (first landing only) fall back to HEAD's committed copy; when neither has it,
 * the allowlist is empty (stricter, never looser).
 */
export function loadAllowlist(
  base: string,
  cwd: string,
): { allowlist: Allowlist } | { error: string } {
  const fromBase = gitShow(base, ALLOWLIST_REPO_PATH, cwd);
  const fromHead = fromBase === null ? gitShow("HEAD", ALLOWLIST_REPO_PATH, cwd) : null;
  const text = fromBase ?? fromHead;
  if (text === null) return { allowlist: EMPTY_ALLOWLIST };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: `allowlist at ${base}:${ALLOWLIST_REPO_PATH} is not valid JSON` };
  }
  return validateAllowlist(json);
}

function stagedFiles(cwd: string): { path: string; bytes: number }[] {
  // Card hx-rules S5: --staged scans `git diff --cached --name-only -z --diff-filter=ACMR`.
  const raw = execFileSync("git", ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], {
    cwd,
    encoding: "utf8",
  });
  const out: { path: string; bytes: number }[] = [];
  for (const path of raw.split("\0")) {
    if (!path) continue;
    // Size from the staged blob itself (`git cat-file -s :<path>`), not the worktree.
    let sizeText: string;
    try {
      sizeText = execFileSync("git", ["cat-file", "-s", `:${path}`], { cwd, encoding: "utf8" }).trim();
    } catch {
      continue; // gitlink or unreadable staged entry: no blob to measure, nothing to refuse.
    }
    const bytes = Number(sizeText);
    if (!Number.isInteger(bytes) || bytes < 0) continue;
    out.push({ path, bytes });
  }
  return out;
}

function pushRangeBlobs(base: string, cwd: string): { path: string; bytes: number }[] {
  // Card hx-rules S5: --push scans every blob in `git rev-list --objects <base>..HEAD`
  // so a blob added then deleted inside the range is still refused.
  let rev: string;
  try {
    rev = execFileSync("git", ["rev-list", "--objects", `${base}..HEAD`], { cwd, encoding: "utf8" });
  } catch {
    throw new Error(`large-file-guard: base ref '${base}' is missing; cannot scan the push range`);
  }
  const shas: string[] = [];
  const pathBySha = new Map<string, string>();
  for (const line of rev.split("\n")) {
    const m = /^([0-9a-f]{40})(?: (.*))?$/.exec(line.trim());
    if (!m) continue;
    const sha = m[1] as string;
    shas.push(sha);
    const p = m[2];
    if (p && !pathBySha.has(sha)) pathBySha.set(sha, p);
  }
  if (shas.length === 0) return [];
  const check = spawnSync("git", ["cat-file", "--batch-check"], {
    cwd,
    input: `${shas.join("\n")}\n`,
    encoding: "utf8",
  });
  if (check.status !== 0) {
    throw new Error("large-file-guard: git cat-file --batch-check failed on the push range");
  }
  const out: { path: string; bytes: number }[] = [];
  const seen = new Set<string>();
  for (const line of String(check.stdout ?? "").split("\n")) {
    const m = /^([0-9a-f]{40}) (\S+) (\d+)$/.exec(line.trim());
    if (!m) continue;
    const sha = m[1];
    const type = m[2];
    const size = m[3];
    if (sha === undefined || size === undefined) continue;
    if (type !== "blob" || seen.has(sha)) continue;
    seen.add(sha);
    // Blobs without a path cannot be name-checked, but the size rule still applies
    // with no allowlist exemption available.
    out.push({ path: pathBySha.get(sha) ?? `(unpathed-blob ${sha})`, bytes: Number(size) });
  }
  return out;
}

export type GuardMode = "--staged" | "--push";

export function runGuard(mode: GuardMode, base: string, cwd: string): Violation[] {
  const loaded = loadAllowlist(base, cwd);
  if ("error" in loaded) throw new Error(`large-file-guard: ${loaded.error}`);
  const files = mode === "--staged" ? stagedFiles(cwd) : pushRangeBlobs(base, cwd);
  return checkFiles(files, loaded.allowlist);
}

/** Command builder imported by agentic-hook-runner.ts (keeps this module knip-reachable). */
export function buildLargeFileGuardCommand(mode: GuardMode): string[] {
  return ["pnpm", "exec", "tsx", "tools/openclinxr/openclaw/large-file-guard.ts", mode];
}

function printUsage(): void {
  process.stdout.write("usage: large-file-guard.ts --staged | --push [--base <ref>]\n");
}

const invokedDirectly = process.argv[1]?.endsWith("large-file-guard.ts") ?? false;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const mode = args.includes("--staged") ? "--staged" : args.includes("--push") ? "--push" : null;
  const baseIdx = args.indexOf("--base");
  const base = baseIdx === -1 ? DEFAULT_BASE : (args[baseIdx + 1] ?? "");
  if (!mode || !base) {
    printUsage();
    process.exit(2);
  }
  try {
    const violations = runGuard(mode, base, process.cwd());
    if (violations.length > 0) {
      for (const v of violations) process.stdout.write(`${formatViolation(v)}\n`);
      process.exit(1);
    }
    process.exit(0);
  } catch (error) {
    process.stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
