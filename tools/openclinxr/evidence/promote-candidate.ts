/**
 * promote-candidate.ts — record a chosen pipeline candidate as promoted.
 *
 * Reads the pipeline-candidate-index.json, finds the candidate, and writes a
 * claim-scoped promotion record JSON under
 * `.openclinxr/asset-production/promotions/` plus updates a promotions index.
 * The actual copy-to-deployed-path is a documented/scripted step (printed as
 * `copyCommand`, and runnable with --apply-copy or scripts/promote-candidate-copy.sh).
 *
 * Aesthetic metadata only. Not production/clinical/scoring/learner readiness.
 *
 * Run from repo root:
 *   tsx tools/openclinxr/evidence/promote-candidate.ts --candidate-id "<group>/<manifestId>" \
 *     --promoted-by faculty_reviewer --reason "best nurse realism" [--apply-copy]
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
  console.log(`[promote-candidate] deploy target suggestion: ${record.deployTargetSuggestion}`);
  console.log(`[promote-candidate] copy command: ${record.copyCommand}`);

  if (applyCopy) {
    const srcAbs = path.resolve(REPO_ROOT, candidate.glbPath);
    const destAbs = path.resolve(REPO_ROOT, record.deployTargetSuggestion);
    await mkdir(path.dirname(destAbs), { recursive: true });
    await copyFile(srcAbs, destAbs);
    console.log(`[promote-candidate] --apply-copy: copied GLB → ${record.deployTargetSuggestion}`);
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
