import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type InferenceObservation,
  screenCandidate,
} from "../../../scene-closure-research/candidate-screening.js";
import {
  loadRetrievedSources,
  measureHostFacts,
} from "../../../scene-closure-research/load-retrieved-sources.js";
import {
  type EvidenceRegistry,
  type IndependentResearchFacts,
  nodeObjectReader,
  sha256Hex,
  verifyReport,
} from "./verify-core.js";

/**
 * SC-10's direct actual-evidence verifier.
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
const EXPECTED_REPORT_PATH = `${CONTRACT_DIR}/evidence/sc-10.json`;

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
 * Motion-inference observations, read from the OWNER STORE rather than from the report.
 *
 * Absence is the honest zero. If no run happened there is no file, and the verifier then refuses
 * any `executed` verdict and any latency/memory claim. A report cannot add observations here.
 */
function loadInferenceObservations(storeRoot: string): InferenceObservation[] {
  const observationPath = path.join(storeRoot, "sc-10/runs/inference-observations.json");
  if (!existsSync(observationPath)) return [];
  return JSON.parse(readFileSync(observationPath, "utf8")) as InferenceObservation[];
}

/**
 * Recompute SC-10's verdict from the actual retrieved first-party bytes.
 *
 * This is the half of the CLI that cannot live in the unit-tested core: it resolves the stored
 * sources through the owner registry, re-hashes each against its retrieval receipt, measures this
 * host, and runs the research instrument. Nothing the report says reaches it. Any throw becomes an
 * Error and the run fails; there is no path where a recomputation problem is downgraded to a pass.
 */
function recompute(): IndependentResearchFacts | Error {
  try {
    const loaded = loadRetrievedSources(process.env["OPENCLINXR_SC_EVIDENCE_REGISTRY"]);
    const observations = loadInferenceObservations(loaded.storeRoot);
    const screening = screenCandidate({
      sources: loaded.sources,
      host: measureHostFacts(),
      observations,
    });
    const divergence = screening.dimensions.find((entry) => entry.id === "documentation-divergence");
    const skeleton = screening.dimensions.find((entry) => entry.id === "skeleton-mapping");
    return {
      verdict: screening.verdict,
      dimensionOutcomes: screening.dimensions.map((entry) => ({ id: entry.id, outcome: entry.outcome })),
      holdReasons: screening.holdReasons,
      nextUnblock: screening.nextUnblock,
      qualifyingInferenceObservationCount: observations.filter(
        (observation) => observation.kind === "motion-inference",
      ).length,
      sourceProblems: loaded.problems,
      retrievedSourceIds: [...loaded.sources.keys()],
      skeletonMappingInspected: skeleton?.outcome === "eligible",
      documentationDivergenceResolution:
        divergence === undefined ? "absent" : divergence.outcome === "eligible" ? "resolved" : "unresolved",
    };
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`sc-10 verify: ${parsed.error}\n`);
    process.exitCode = 2;
    return;
  }
  if (path.normalize(parsed.report) !== path.normalize(EXPECTED_REPORT_PATH)) {
    process.stderr.write(
      `sc-10 verify: refused --report ${parsed.report}; this card may only grade ${EXPECTED_REPORT_PATH}\n`,
    );
    process.exitCode = 2;
    return;
  }

  let report: unknown;
  try {
    report = JSON.parse(readFileSync(parsed.report, "utf8"));
  } catch (error) {
    process.stderr.write(`sc-10 verify: cannot read report — ${String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  const contractDocuments = new Map<string, string>();
  for (const document of CONTRACT_DOCUMENTS) {
    try {
      contractDocuments.set(document, sha256Hex(readFileSync(document)));
    } catch (error) {
      process.stderr.write(`sc-10 verify: cannot hash contract document ${document} — ${String(error)}\n`);
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
    independent: recompute(),
  });

  if (result.ok) {
    process.stdout.write("sc-10 verify: every required check, control and artifact resolved.\n");
    return;
  }
  process.stderr.write(`sc-10 verify: ${result.problems.length} unmet requirement(s)\n`);
  for (const problem of result.problems) process.stderr.write(`  - ${problem}\n`);
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify.ts")) main();
