import { closeSync, mkdirSync, openSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  CANDIDATE_SOURCES,
  type CandidateSource,
  manifestRevisionProblems,
} from "../../../../../../tools/openclinxr/evidence/scene-closure-research/candidate-source-manifest.js";
import { loadRetrievedSources } from "../../../../../../tools/openclinxr/evidence/scene-closure-research/load-retrieved-sources.js";

/**
 * CI input routing for SC-10: prepare a unique job-owned metadata store and
 * alias registry, then print the absolute registry path on stdout.
 *
 * Retrieval itself stays in `retrieve-candidate-sources.ts`; this file only
 * validates the manifest, creates the per-job directories, and writes the
 * registry that `OPENCLINXR_SC_EVIDENCE_REGISTRY` must point at. Callers pass
 * the printed path explicitly — there is no default and no fixture fallback.
 */

const ALLOWED_KINDS: ReadonlySet<string> = new Set([
  "code-blob",
  "code-licence",
  "model-card",
  "model-licence",
  "checkpoint-config",
  "availability-index",
]);

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "raw.githubusercontent.com",
  "huggingface.co",
]);

const WEIGHT_SUFFIX = /\.(safetensors|bin|onnx|pt|ckpt|gguf)(\?|#|$)/i;

function sourceUrlProblems(source: CandidateSource): string[] {
  const problems: string[] = [];
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    problems.push(`${source.sourceId} has unparsable URL: refusing retrieval`);
    return problems;
  }
  if (url.protocol !== "https:") {
    problems.push(`${source.sourceId} is not an https first-party URL: refusing retrieval`);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    problems.push(`${source.sourceId} host ${url.hostname} is not allowlisted: refusing retrieval`);
  }
  if (url.username || url.password) {
    problems.push(`${source.sourceId} carries URL credentials: refusing retrieval`);
  }
  // Model-weight suffix refused regardless of kind: a pinned metadata URL must
  // never point at a weight payload, even with a metadata kind label.
  if (WEIGHT_SUFFIX.test(url.pathname)) {
    problems.push(`${source.sourceId} points at a model-weight payload: refusing retrieval`);
  }
  return problems;
}

export function storeValidationProblems(
  sources: readonly CandidateSource[] = CANDIDATE_SOURCES,
): string[] {
  const problems = [...manifestRevisionProblems(sources)];
  for (const source of sources) {
    if (!ALLOWED_KINDS.has(source.kind)) {
      problems.push(`${source.sourceId} has unexpected kind ${source.kind}: refusing retrieval`);
    }
    problems.push(...sourceUrlProblems(source));
    if (!source.objectKey.startsWith("sc-10/sources/") || source.objectKey.includes("..")) {
      problems.push(`${source.sourceId} escapes the sc-10 metadata prefix: refusing retrieval`);
    }
  }
  return problems;
}

/**
 * Atomic wx create of `<storeRoot>/registry.json`. Absolute root only;
 * nonexistent or EMPTY directories permitted, nonempty roots or an existing
 * registry.json refused. Returns the actual registry path.
 */
export function writeAliasRegistry(storeRoot: string): string {
  if (!path.isAbsolute(storeRoot)) throw new Error("store root must be absolute");
  const existing = statSync(storeRoot, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isDirectory()) throw new Error("store root is not a directory");
    if (readdirSync(storeRoot).length > 0) throw new Error("refuse nonempty store root");
  } else {
    mkdirSync(storeRoot, { recursive: true });
  }
  const registryPath = path.join(storeRoot, "registry.json");
  const payload =
    `${JSON.stringify({ aliases: { "sc-evidence": { root: storeRoot } } }, null, 2)}\n`;
  const fd = openSync(registryPath, "wx", 0o600);
  try {
    writeFileSync(fd, payload);
  } finally {
    closeSync(fd);
  }
  return registryPath;
}

/**
 * Verify the prepared store through the actual retrieval loader, which checks
 * URL/status/bodySHA/count per receipt. Rejects loader problems first, then
 * source and receipt count mismatches. No body-free receipt shortcut.
 */
export function verifyPreparedStore(registryPath: string): void {
  const loaded = loadRetrievedSources(registryPath);
  if (loaded.problems.length > 0) {
    throw new Error(`retrieved store problems: ${loaded.problems.join("; ")}`);
  }
  if (loaded.sources.size !== CANDIDATE_SOURCES.length) {
    throw new Error(
      `expected ${CANDIDATE_SOURCES.length} sources, got ${loaded.sources.size}`,
    );
  }
  if (loaded.receipts.length !== CANDIDATE_SOURCES.length) {
    throw new Error(
      `expected ${CANDIDATE_SOURCES.length} receipts, got ${loaded.receipts.length}`,
    );
  }
}

function resolveOutputDir(argv: string[]): string {
  const flag = argv.indexOf("--output-dir");
  if (flag === -1 || !argv[flag + 1]) {
    throw new Error("prepare-sc10-metadata-store requires --output-dir <absolute dir>");
  }
  const dir = argv[flag + 1] as string;
  if (!path.isAbsolute(dir)) throw new Error("--output-dir must be an absolute path");
  return dir;
}

async function main(argv: string[], repoRoot: string): Promise<number> {
  let storeRoot: string;
  try {
    storeRoot = resolveOutputDir(argv);
  } catch (err) {
    process.stderr.write(`prepare-sc10-metadata-store: ${String(err)}\n`);
    return 2;
  }
  const problems = storeValidationProblems();
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write("prepare-sc10-metadata-store: manifest validation failed; refusing to retrieve\n");
    return 2;
  }
  const registryPath = writeAliasRegistry(storeRoot);
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "tools/openclinxr/evidence/scene-closure-research/retrieve-candidate-sources.ts"],
    { cwd: repoRoot, env: { ...process.env, OPENCLINXR_SC_EVIDENCE_REGISTRY: registryPath }, stdio: "inherit" },
  );
  if (child.status !== 0) {
    process.stderr.write(
      `prepare-sc10-metadata-store: retrieval failed (code ${child.status}); failing closed, no fixture written\n`,
    );
    return child.status ?? 1;
  }
  try {
    verifyPreparedStore(registryPath);
  } catch (err) {
    process.stderr.write(`prepare-sc10-metadata-store: post-retrieval verification failed: ${String(err)}\n`);
    return 1;
  }
  process.stdout.write(`${registryPath}\n`);
  return 0;
}

const invokedAsScript = process.argv[1]?.endsWith("prepare-sc10-metadata-store.ts") ?? false;
if (invokedAsScript) {
  await main(process.argv.slice(2), process.cwd()).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`prepare-sc10-metadata-store: FATAL ${String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
