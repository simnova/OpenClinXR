/**
 * pipeline-candidate-index.ts — scan generated humanoid GLB candidates and join
 * their dual-frame (full + face) vision scores + rigging metadata into a single
 * index consumed by the Pipeline Administration / Model Vetting Studio UI.
 *
 * Read-only over the asset-production tree + the latest humanoid-vision-score
 * report. Emits `.openclinxr/asset-production/pipeline-candidate-index.json`.
 * Aesthetic-only metadata; keeps notEvidenceFor gates. Not clinical validity.
 *
 * Run from repo root:
 *   tsx tools/openclinxr/evidence/pipeline-candidate-index.ts
 *   OUT_PATH=.openclinxr/asset-production/pipeline-candidate-index.json \
 *     VISION_SCORE_REPORT=docs/openclinxr/humanoid-vision-score-2026-08-03.json tsx ...
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildCandidateId,
  buildPipelineCandidateIndex,
  deriveCandidateRole,
  deriveManifestId,
  joinVisionScore,
  PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR,
  summarizeRigging,
  type PipelineCandidate,
} from "../../../packages/openclinxr/arena/model-vetting/src/pipeline-candidate.js";

const REPO_ROOT = process.cwd();
const ANNY_ROOT =
  process.env.ANNY_ROOT || path.join(REPO_ROOT, ".openclinxr", "asset-production", "anny");
const OUT_PATH =
  process.env.OUT_PATH ||
  path.join(REPO_ROOT, ".openclinxr", "asset-production", "pipeline-candidate-index.json");
const DOCS_DIR = process.env.DOCS_DIR || path.join(REPO_ROOT, "docs", "openclinxr");
/** Folders that are fixtures/smoke, not vet-able candidates. */
const EXCLUDED_GROUPS = new Set((process.env.EXCLUDED_GROUPS || "smoke").split(",").map((s) => s.trim()));

type GlbEntry = { absPath: string; group: string; manifestId: string; glbPath: string };

/** Recursively list every *.glb under a root directory. */
export async function listGlbFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".glb")) out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

/** Derive `{ group, manifestId }` for a GLB absolute path under the anny root. */
export function deriveGroupAndManifest(absPath: string, annyRoot: string): { group: string; manifestId: string } {
  const rel = path.relative(annyRoot, absPath);
  const parts = rel.split(path.sep);
  const manifestId = deriveManifestId(parts[parts.length - 1] ?? "");
  const group = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
  return { group, manifestId };
}

/** Pick the newest `humanoid-vision-score-*.json` filename (lexicographic on ISO date suffix). */
export function selectLatestVisionScoreReport(fileNames: string[]): string | null {
  const matches = fileNames
    .filter((name) => /^humanoid-vision-score-.*\.json$/u.test(name))
    .sort();
  return matches.length > 0 ? (matches[matches.length - 1] ?? null) : null;
}

async function readJsonOrNull(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function toRepoRelative(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();

  // Locate the latest vision-score report (unless overridden).
  let visionScoreReportAbs: string | null = null;
  if (process.env.VISION_SCORE_REPORT) {
    visionScoreReportAbs = path.resolve(REPO_ROOT, process.env.VISION_SCORE_REPORT);
  } else {
    const docFiles = await readdir(DOCS_DIR).catch(() => [] as string[]);
    const latest = selectLatestVisionScoreReport(docFiles);
    if (latest) visionScoreReportAbs = path.join(DOCS_DIR, latest);
  }
  const scoresDoc = visionScoreReportAbs ? await readJsonOrNull(visionScoreReportAbs) : null;
  const sourceVisionScoreReportPath = visionScoreReportAbs ? toRepoRelative(visionScoreReportAbs) : null;

  const glbAbsPaths = await listGlbFiles(ANNY_ROOT);
  const entries: GlbEntry[] = glbAbsPaths.map((absPath) => {
    const { group, manifestId } = deriveGroupAndManifest(absPath, ANNY_ROOT);
    return { absPath, group, manifestId, glbPath: toRepoRelative(absPath) };
  });

  const candidates: PipelineCandidate[] = [];
  for (const entry of entries) {
    const topGroup = entry.group.split("/")[0] ?? entry.group;
    if (EXCLUDED_GROUPS.has(topGroup)) continue;

    const dir = path.dirname(entry.absPath);
    const riggingReport = await readJsonOrNull(path.join(dir, `${entry.manifestId}_rigging_report.json`));
    const riggingSummary = summarizeRigging(riggingReport);
    const role = deriveCandidateRole(entry.manifestId, riggingReport);
    const visionScore = joinVisionScore(scoresDoc, entry.manifestId, {
      sourceReportPath: sourceVisionScoreReportPath,
    });

    // Optional sibling thumbnail (front-frame png), if one already exists.
    let thumbnailPath: string | null = null;
    for (const candidateName of [`${entry.manifestId}.front.png`, `${entry.manifestId}.png`, "front.png"]) {
      const thumbAbs = path.join(dir, candidateName);
      const thumbStat = await stat(thumbAbs).catch(() => null);
      if (thumbStat?.isFile()) {
        thumbnailPath = toRepoRelative(thumbAbs);
        break;
      }
    }

    const fileStat = await stat(entry.absPath).catch(() => null);
    candidates.push({
      candidateId: buildCandidateId(entry.group, entry.manifestId),
      group: entry.group,
      manifestId: entry.manifestId,
      role,
      glbPath: entry.glbPath,
      sizeBytes: fileStat?.size ?? 0,
      modifiedAt: fileStat ? fileStat.mtime.toISOString() : generatedAt,
      visionScore,
      riggingSummary,
      thumbnailPath,
      notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
    });
  }

  // Rank: scored candidates by aggregate realism desc, then unscored by mtime desc.
  candidates.sort((a, b) => {
    const ar = a.visionScore?.aggregateRealism_0to1 ?? -1;
    const br = b.visionScore?.aggregateRealism_0to1 ?? -1;
    if (ar !== br) return br - ar;
    return b.modifiedAt.localeCompare(a.modifiedAt);
  });

  const index = buildPipelineCandidateIndex({
    generatedAt,
    sourceVisionScoreReportPath,
    candidates,
  });

  const serialized = `${JSON.stringify(index, null, 2)}\n`;
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, serialized, "utf8");
  console.log(
    `[pipeline-candidate-index] wrote ${toRepoRelative(OUT_PATH)} ` +
      `(${index.candidateCount} candidates, ${index.scoredCandidateCount} scored, ` +
      `source=${sourceVisionScoreReportPath ?? "none"})`,
  );

  // Also emit a browser-servable copy into the studio public dir so the admin
  // UI can fetch the live generated index (gitignored; the committed sample is
  // the fallback). Skipped when WRITE_STUDIO_PUBLIC=0.
  if (process.env.WRITE_STUDIO_PUBLIC !== "0") {
    const studioPublic = path.join(
      REPO_ROOT,
      "apps",
      "arena",
      "model-vetting-studio",
      "public",
      "pipeline-candidate-index.json",
    );
    try {
      await mkdir(path.dirname(studioPublic), { recursive: true });
      await writeFile(studioPublic, serialized, "utf8");
      console.log(`[pipeline-candidate-index] wrote ${toRepoRelative(studioPublic)} (studio-servable)`);
    } catch (error) {
      console.warn(`[pipeline-candidate-index] could not write studio public copy: ${String(error)}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
