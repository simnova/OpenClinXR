import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type EvidenceRegistry,
  nodeObjectReader,
  sha256Hex,
  verifyReport,
} from "./verify-core.js";

/**
 * SC-05's direct actual-evidence verifier.
 *
 * proof-contract-v2.md: "Production verification has no fixture flag, default report, environment
 * fallback to a test fixture, auto-generated successful sample or catch-and-pass mode. It must not
 * generate the evidence it is grading."
 *
 * So this file has exactly one job that its unit-tested core cannot do: turn the real filesystem
 * into the core's inputs. There is no `--fixture`, no default `--report`, and no code path that
 * fabricates an artifact. Every failure below exits nonzero; nothing is caught and downgraded.
 */

/** The repo root, asserted rather than assumed: a wrong cwd would silently read nothing. */
const REPO_ROOT = process.cwd();

const CONTRACT_DIR = "docs/openclinxr/scene-closure-2026-09-09";
const CONTRACT_DOCUMENTS = [
  `${CONTRACT_DIR}/acceptance-v2.md`,
  `${CONTRACT_DIR}/tasks-v2.md`,
  `${CONTRACT_DIR}/proof-contract-v2.md`,
  `${CONTRACT_DIR}/delegation-v2.md`,
];

/** The only report location this card may grade. A path outside it is a refusal. */
const EXPECTED_REPORT_PATH = `${CONTRACT_DIR}/evidence/sc-05.json`;

export type ParsedArgs = { report: string; scopes: string[] } | { error: string };

/** Strict argv. Unknown flags, a missing or repeated --report and bare arguments all refuse. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const scopes: string[] = [];
  let report: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    // `noUncheckedIndexedAccess` makes this `string | undefined`, and `lint/style/noNonNullAssertion`
    // refuses the assertion that would silence it. The loop bound already rules undefined out, so
    // this guard is a refusal rather than a cast.
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

/** Real filesystem source reader, rooted at the workspace. No fallback, no fixture. */
function readSource(repoRelativePath: string): string | Error {
  if (path.isAbsolute(repoRelativePath)) return new Error(`source path ${repoRelativePath} must be repo-relative`);
  const resolved = path.resolve(REPO_ROOT, repoRelativePath);
  if (!resolved.startsWith(`${REPO_ROOT}${path.sep}`)) return new Error(`source path ${repoRelativePath} escapes the repo`);
  try {
    return readFileSync(resolved, "utf8");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function main(): void {
  if (!existsSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"))) {
    process.stderr.write(`sc-05 verify: cwd ${REPO_ROOT} is not the workspace root\n`);
    process.exitCode = 2;
    return;
  }
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`sc-05 verify: ${parsed.error}\n`);
    process.exitCode = 2;
    return;
  }
  if (path.normalize(parsed.report) !== path.normalize(EXPECTED_REPORT_PATH)) {
    process.stderr.write(
      `sc-05 verify: refused --report ${parsed.report}; this card may only grade ${EXPECTED_REPORT_PATH}\n`,
    );
    process.exitCode = 2;
    return;
  }

  let report: unknown;
  try {
    report = JSON.parse(readFileSync(parsed.report, "utf8"));
  } catch (error) {
    process.stderr.write(`sc-05 verify: cannot read report — ${String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  const contractDocuments = new Map<string, string>();
  for (const document of CONTRACT_DOCUMENTS) {
    try {
      contractDocuments.set(document, sha256Hex(readFileSync(document)));
    } catch (error) {
      process.stderr.write(`sc-05 verify: cannot hash contract document ${document} — ${String(error)}\n`);
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
  });

  if (result.ok) {
    process.stdout.write("sc-05 verify: every required check, control and artifact resolved.\n");
    return;
  }
  process.stderr.write(`sc-05 verify: ${result.problems.length} unmet requirement(s)\n`);
  for (const problem of result.problems) process.stderr.write(`  - ${problem}\n`);
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify.ts")) main();
