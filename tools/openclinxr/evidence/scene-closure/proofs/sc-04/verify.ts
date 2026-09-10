import { readFileSync } from "node:fs";
import path from "node:path";
import { SCENE_CLOSURE_SELECTED_ASSET_MANIFEST } from "../../../../factory/scene-closure-case-source.js";
import {
  auditSelectedSceneAssetLineage,
  SELECTED_CASE_CLIP_CLEARANCE,
  SUBCOMPONENT_CLEARANCE,
} from "../../../licence/selected-scene-asset-lineage.js";
import {
  type EvidenceRegistry,
  type IndependentFacts,
  nodeObjectReader,
  sha256Hex,
  verifyReport,
} from "./verify-core.js";

/**
 * SC-04's direct actual-evidence verifier.
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
const EXPECTED_REPORT_PATH = `${CONTRACT_DIR}/evidence/sc-04.json`;

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
 * Recompute SC-04's decidable facts from the product tree.
 *
 * This is the half of the CLI that cannot live in the unit-tested core: it runs the real cast
 * resolver, reads the shipped bytes and the licence records on disk, and hands the core facts the
 * report had no hand in producing. Any throw becomes an Error and the run fails — there is no path
 * where a recomputation problem is downgraded to a pass.
 */
async function recompute(): Promise<IndependentFacts | Error> {
  try {
    const audit = await auditSelectedSceneAssetLineage({ repoRoot: process.cwd() });
    const citedPhrasesPresent = [...SELECTED_CASE_CLIP_CLEARANCE, ...SUBCOMPONENT_CLEARANCE].every(
      (clearance) => {
        if (clearance.licenceRecordPath === "first-party") return true;
        let text: string;
        try {
          text = readFileSync(clearance.licenceRecordPath, "utf8");
        } catch {
          return false;
        }
        return clearance.requiredRecordPhrases.every((phrase) => text.includes(phrase));
      },
    );
    const decisions = SELECTED_CASE_CLIP_CLEARANCE.map((clearance) => clearance.decisions);
    return {
      lineageFindings: audit.findings.map((finding) => `${finding.kind}: ${finding.actorId}: ${finding.detail}`),
      selectedAssets: audit.selected.map((entry) => ({
        assetPath: entry.assetPath,
        sha256: entry.sha256,
        recordedSha256: entry.recordedSha256,
        retargetedClips: entry.clips
          .map((clip) => clip.clipName)
          .filter((clipName) => clipName.startsWith("openclinxr_retarget_")),
      })),
      publicRenderDecision: SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.publicRender.decision,
      publicRenderBlockedRecords: SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.publicRender.blockedBy.map(
        (block) => block.record,
      ),
      citedPhrasesPresent,
      // Three booleans that are not all equal across the table: adopting CMU for build-time work
      // while refusing to ship or publish it is the separation this check exists to see.
      clearanceDecisionsSeparated: decisions.some(
        (decision) =>
          decision.adoptedForBuild !== decision.shippedInRedistributedBytes
          || decision.shippedInRedistributedBytes !== decision.renderedInPublicMedia,
      ),
    };
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`sc-04 verify: ${parsed.error}\n`);
    process.exitCode = 2;
    return;
  }
  if (path.normalize(parsed.report) !== path.normalize(EXPECTED_REPORT_PATH)) {
    process.stderr.write(
      `sc-04 verify: refused --report ${parsed.report}; this card may only grade ${EXPECTED_REPORT_PATH}\n`,
    );
    process.exitCode = 2;
    return;
  }

  let report: unknown;
  try {
    report = JSON.parse(readFileSync(parsed.report, "utf8"));
  } catch (error) {
    process.stderr.write(`sc-04 verify: cannot read report — ${String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  const contractDocuments = new Map<string, string>();
  for (const document of CONTRACT_DOCUMENTS) {
    try {
      contractDocuments.set(document, sha256Hex(readFileSync(document)));
    } catch (error) {
      process.stderr.write(`sc-04 verify: cannot hash contract document ${document} — ${String(error)}\n`);
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
    independent: await recompute(),
  });

  if (result.ok) {
    process.stdout.write("sc-04 verify: every required check, control and artifact resolved.\n");
    return;
  }
  process.stderr.write(`sc-04 verify: ${result.problems.length} unmet requirement(s)\n`);
  for (const problem of result.problems) process.stderr.write(`  - ${problem}\n`);
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify.ts")) await main();
