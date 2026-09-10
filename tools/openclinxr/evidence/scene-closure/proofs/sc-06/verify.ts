import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type EvidenceRegistry,
  nodeObjectReader,
  SC06_DEPENDENCY_BASELINE,
  sha256Hex,
  verifyReport,
} from "./verify-core.js";

/**
 * SC-06's direct actual-evidence verifier.
 *
 * proof-contract-v2.md: "Production verification has no fixture flag, default report, environment
 * fallback to a test fixture, auto-generated successful sample or catch-and-pass mode. It must not
 * generate the evidence it is grading."
 *
 * So this file has exactly one job that its unit-tested core cannot do: turn the real filesystem
 * into the core's inputs. There is no `--fixture`, no default `--report`, and no code path that
 * fabricates an artifact. Every failure below exits nonzero; nothing is caught and downgraded.
 */

const CONTRACT_DIR = "docs/openclinxr/scene-closure-2026-09-09";
const CONTRACT_DOCUMENTS = [
  `${CONTRACT_DIR}/acceptance-v2.md`,
  `${CONTRACT_DIR}/tasks-v2.md`,
  `${CONTRACT_DIR}/proof-contract-v2.md`,
  `${CONTRACT_DIR}/delegation-v2.md`,
];

/** The only report location this card may grade. A path outside it is a refusal. */
const EXPECTED_REPORT_PATH = `${CONTRACT_DIR}/evidence/sc-06.json`;

/** The tree this run grades. Every repo-relative path below resolves against it. */
const REPO_ROOT = process.cwd();

/**
 * Read a tracked file so the core can rehash it from the TREE.
 *
 * IT RETURNS BYTES, NOT TEXT, and that is a correctness fix rather than a preference. A first version
 * returned `readFileSync(path, "utf8")`, and every binary input in the manifest — the four selected
 * humanoid GLBs — hashed to a value that disagreed with the file: decoding 11 MB of glTF as UTF-8
 * replaces every invalid sequence with U+FFFD, so the digest is of the mangled string. Measured: the
 * physician body reported `4a6d8a78…` from its real bytes and `2c483a01…` through the text reader.
 * A verifier that cannot hash a binary input cannot certify one, and the four bodies are exactly the
 * inputs this card's invalidation claim rests on.
 *
 * The point of passing this in rather than letting the core read: `verifier.test.ts` drives the same
 * clauses against a synthetic tree, and the CLI is the only place a real filesystem appears. It
 * refuses a path that escapes the repo root, because a report naming `../../etc/hosts` would
 * otherwise be hashed and reported as a clean input.
 */
function readSource(repoRelativePath: string): Buffer | Error {
  const resolved = path.resolve(REPO_ROOT, repoRelativePath);
  if (resolved !== REPO_ROOT && !resolved.startsWith(`${REPO_ROOT}${path.sep}`)) {
    return new Error(`${repoRelativePath} resolves outside the repository`);
  }
  try {
    return readFileSync(resolved);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export type ParsedArgs = { report: string; scopes: string[] } | { error: string };

/** Strict argv. Unknown flags, a missing or repeated --report and bare arguments all refuse. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const scopes: string[] = [];
  let report: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    // `noUncheckedIndexedAccess` makes this `string | undefined`. A non-null assertion would
    // silence the type without checking anything; the loop bound already rules it out, so the
    // guard is a refusal rather than a cast.
    if (token === undefined) return { error: `missing argument at position ${index}` };
    if (token === "--report") {
      if (report !== undefined) return { error: "--report supplied more than once" };
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return { error: "--report needs a value" };
      report = value;
      index += 1;
      continue;
    }
    if (token === "--scope") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return { error: "--scope needs a value" };
      scopes.push(value);
      index += 1;
      continue;
    }
    return { error: `unknown argument ${token}` };
  }
  if (report === undefined) return { error: "--report is required" };
  if (scopes.length === 0) return { error: "at least one --scope is required" };
  return { report, scopes };
}

function loadRegistry(): EvidenceRegistry | Error {
  const registryPath = process.env["OPENCLINXR_SC_EVIDENCE_REGISTRY"];
  if (!registryPath) return new Error("OPENCLINXR_SC_EVIDENCE_REGISTRY is not set");
  if (!path.isAbsolute(registryPath)) return new Error("OPENCLINXR_SC_EVIDENCE_REGISTRY must be absolute");
  try {
    return JSON.parse(readFileSync(registryPath, "utf8")) as EvidenceRegistry;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function registryDigest(): string | Error {
  const registryPath = process.env["OPENCLINXR_SC_EVIDENCE_REGISTRY"];
  if (!registryPath) return new Error("OPENCLINXR_SC_EVIDENCE_REGISTRY is not set");
  try {
    return sha256Hex(readFileSync(registryPath));
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Every path the TREE says changed: committed since the pinned baseline, plus anything uncommitted.
 *
 * This is the half the scope audit was missing. Without it `changedFiles` was an array the report
 * supplied and nothing compared it with the repository — a reviewer appended a comment to an
 * out-of-scope file and the CLI produced byte-identical output.
 *
 * The baseline is `SC06_DEPENDENCY_BASELINE` from the verifier's own source, not the report's, so a
 * report cannot pick a baseline that hides its own changes.
 */
function treeChangedFiles(): string[] | Error {
  try {
    const git = (...args: string[]): string[] =>
      execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
    return [
      ...new Set([
        ...git("diff", "--name-only", `${SC06_DEPENDENCY_BASELINE}..HEAD`),
        ...git("diff", "--name-only", "HEAD"),
        ...git("ls-files", "--others", "--exclude-standard"),
      ]),
    ];
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function main(): void {
  // The scope audit, the input rehash and the contract hashes are all repo-relative. Run from
  // anywhere else they would silently grade a different tree, or nothing at all.
  if (!existsSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"))) {
    process.stderr.write(`sc-06 verify: cwd ${REPO_ROOT} is not the workspace root\n`);
    process.exitCode = 2;
    return;
  }
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`sc-06 verify: ${parsed.error}\n`);
    process.exitCode = 2;
    return;
  }
  if (path.normalize(parsed.report) !== path.normalize(EXPECTED_REPORT_PATH)) {
    process.stderr.write(
      `sc-06 verify: refused --report ${parsed.report}; this card may only grade ${EXPECTED_REPORT_PATH}\n`,
    );
    process.exitCode = 2;
    return;
  }

  let report: unknown;
  try {
    report = JSON.parse(readFileSync(parsed.report, "utf8"));
  } catch (error) {
    process.stderr.write(`sc-06 verify: cannot read report — ${String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  const contractDocuments = new Map<string, string>();
  for (const document of CONTRACT_DOCUMENTS) {
    try {
      contractDocuments.set(document, sha256Hex(readFileSync(document)));
    } catch (error) {
      process.stderr.write(`sc-06 verify: cannot hash contract document ${document} — ${String(error)}\n`);
      process.exitCode = 2;
      return;
    }
  }

  const result = verifyReport({
    report,
    suppliedScopes: parsed.scopes,
    registry: loadRegistry(),
    registrySha256: registryDigest(),
    reader: nodeObjectReader,
    contractDocuments,
    sourceReader: readSource,
    treeChangedFiles: treeChangedFiles(),
  });

  if (result.ok) {
    process.stdout.write("sc-06 verify: every required check, control and artifact resolved.\n");
    return;
  }
  process.stderr.write(`sc-06 verify: ${result.problems.length} unmet requirement(s)\n`);
  for (const problem of result.problems) process.stderr.write(`  - ${problem}\n`);
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify.ts")) main();
