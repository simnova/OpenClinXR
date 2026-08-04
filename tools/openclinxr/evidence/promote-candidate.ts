/**
 * promote-candidate.ts — record a chosen pipeline candidate as promoted.
 *
 * Reads the pipeline-candidate-index.json, finds the candidate, and writes a
 * claim-scoped promotion record JSON under
 * `.openclinxr/asset-production/promotions/` plus updates a promotions index.
 * With `--apply-copy`, copies the source GLB to ALL `deployTargets` (primary
 * generated-humanoids + cagematch current). Missing source GLB does not throw:
 * the record still writes and deploy reports skipped.
 *
 * Aesthetic metadata only. Not production/clinical/scoring/learner readiness.
 *
 * Run from repo root:
 *   tsx tools/openclinxr/evidence/promote-candidate.ts --candidate-id "<group>/<manifestId>" \
 *     --promoted-by faculty_reviewer --reason "best nurse realism" [--apply-copy]
 */

import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildPromotionRecord,
  type PipelineCandidate,
  type PipelineCandidateIndex,
  type PromotionRecord,
  validatePipelineCandidateIndex,
} from "../../../packages/openclinxr/arena/model-vetting/src/pipeline-candidate.js";

const REPO_ROOT = process.cwd();
const INDEX_PATH =
  process.env.INDEX_PATH ||
  path.join(REPO_ROOT, ".openclinxr", "asset-production", "pipeline-candidate-index.json");
const PROMOTIONS_DIR =
  process.env.PROMOTIONS_DIR || path.join(REPO_ROOT, ".openclinxr", "asset-production", "promotions");

type PromotionsIndex = {
  schemaVersion: "openclinxr.pipeline-candidate-promotions-index.v1";
  updatedAt: string;
  claimScope: string;
  notEvidenceFor: string[];
  promotions: Array<{
    candidateId: string;
    manifestId: string;
    role: string;
    promotedAt: string;
    promotedBy: string;
    recordPath: string;
  }>;
};

export type DeployCopyResult = {
  sourceExists: boolean;
  sourcePath: string;
  results: Array<{ target: string; status: "copied" | "skipped_missing_source" | "error"; error?: string }>;
};

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/** Deterministic, filesystem-safe basename for a promotion record. */
export function promotionRecordFileName(candidateId: string, promotedAt: string): string {
  const safeId = candidateId.replace(/[^a-zA-Z0-9._-]+/gu, "_");
  const safeStamp = promotedAt.replace(/[:.]/gu, "-");
  return `${safeId}--${safeStamp}.json`;
}

/**
 * Copy a source GLB to every deploy target under `repoRoot`.
 * Does not throw when the source is missing — reports skipped instead.
 * Creates parent directories as needed.
 */
export async function applyDeployCopy(options: {
  repoRoot: string;
  sourceGlbPath: string;
  deployTargets: string[];
}): Promise<DeployCopyResult> {
  const sourceAbs = path.resolve(options.repoRoot, options.sourceGlbPath);
  let sourceExists = false;
  try {
    await access(sourceAbs);
    sourceExists = true;
  } catch {
    sourceExists = false;
  }

  const results: DeployCopyResult["results"] = [];
  for (const target of options.deployTargets) {
    if (!sourceExists) {
      results.push({ target, status: "skipped_missing_source" });
      continue;
    }
    try {
      const destAbs = path.resolve(options.repoRoot, target);
      await mkdir(path.dirname(destAbs), { recursive: true });
      await copyFile(sourceAbs, destAbs);
      results.push({ target, status: "copied" });
    } catch (error) {
      results.push({
        target,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { sourceExists, sourcePath: options.sourceGlbPath, results };
}

async function readIndex(): Promise<PipelineCandidateIndex> {
  const raw = JSON.parse(await readFile(INDEX_PATH, "utf8")) as unknown;
  const validation = validatePipelineCandidateIndex(raw);
  if (!validation.ok) throw new Error(`invalid pipeline candidate index: ${validation.errors.join("; ")}`);
  return raw as PipelineCandidateIndex;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const candidateId = typeof args["candidate-id"] === "string" ? args["candidate-id"] : "";
  const promotedBy = typeof args["promoted-by"] === "string" ? args["promoted-by"] : "unspecified_reviewer";
  const reason = typeof args["reason"] === "string" ? args["reason"] : "no reason provided";
  const applyCopy = args["apply-copy"] === true;
  if (!candidateId) throw new Error("--candidate-id is required (format: <group>/<manifestId>)");

  const index = await readIndex();
  const candidate: PipelineCandidate | undefined = index.candidates.find((c) => c.candidateId === candidateId);
  if (!candidate) {
    throw new Error(
      `candidate ${candidateId} not found in ${path.relative(REPO_ROOT, INDEX_PATH)} ` +
        `(have ${index.candidateCount})`,
    );
  }

  const promotedAt = new Date().toISOString();
  const record: PromotionRecord = buildPromotionRecord(candidate, { promotedBy, reason, promotedAt });

  await mkdir(PROMOTIONS_DIR, { recursive: true });
  const recordFileName = promotionRecordFileName(candidateId, promotedAt);
  const recordAbs = path.join(PROMOTIONS_DIR, recordFileName);
  await writeFile(recordAbs, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const recordRel = path.relative(REPO_ROOT, recordAbs).split(path.sep).join("/");

  // Update the promotions index (append, newest first).
  const indexAbs = path.join(PROMOTIONS_DIR, "index.json");
  let promotionsIndex: PromotionsIndex;
  try {
    promotionsIndex = JSON.parse(await readFile(indexAbs, "utf8")) as PromotionsIndex;
  } catch {
    promotionsIndex = {
      schemaVersion: "openclinxr.pipeline-candidate-promotions-index.v1",
      updatedAt: promotedAt,
      claimScope: record.claimScope,
      notEvidenceFor: record.notEvidenceFor,
      promotions: [],
    };
  }
  promotionsIndex.updatedAt = promotedAt;
  promotionsIndex.promotions = [
    {
      candidateId: record.candidateId,
      manifestId: record.manifestId,
      role: record.role,
      promotedAt: record.promotedAt,
      promotedBy: record.promotedBy,
      recordPath: recordRel,
    },
    ...promotionsIndex.promotions.filter((p) => p.recordPath !== recordRel),
  ];
  await writeFile(indexAbs, `${JSON.stringify(promotionsIndex, null, 2)}\n`, "utf8");

  console.log(`[promote-candidate] recorded promotion → ${recordRel}`);
  console.log(`[promote-candidate] deploy targets: ${record.deployTargets.join(", ")}`);
  console.log(`[promote-candidate] copy command: ${record.copyCommand}`);

  if (applyCopy) {
    const deploy = await applyDeployCopy({
      repoRoot: REPO_ROOT,
      sourceGlbPath: candidate.glbPath,
      deployTargets: record.deployTargets,
    });
    if (!deploy.sourceExists) {
      console.log(
        `[promote-candidate] --apply-copy: source GLB missing (${candidate.glbPath}); record written, deploy skipped`,
      );
    }
    for (const row of deploy.results) {
      if (row.status === "copied") {
        console.log(`[promote-candidate] --apply-copy: copied GLB → ${row.target}`);
      } else if (row.status === "skipped_missing_source") {
        console.log(`[promote-candidate] --apply-copy: skipped (missing source) → ${row.target}`);
      } else {
        console.log(`[promote-candidate] --apply-copy: error → ${row.target}: ${row.error ?? "unknown"}`);
      }
    }
  } else {
    console.log("[promote-candidate] copy NOT applied (record only). Re-run with --apply-copy or run the copy command.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
