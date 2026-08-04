import {
  validatePipelineCandidateIndex,
  type PipelineCandidate,
  type PipelineCandidateIndex,
} from "@openclinxr/model-vetting";

export type PipelineAdminLoadResult = {
  index: PipelineCandidateIndex;
  loadedFromUrl: string;
};

/** Candidate source URLs, tried in order. Generated index first, sample fallback last. */
export function pipelineCandidateIndexUrls(overrideUrl?: string | null): string[] {
  const urls: string[] = [];
  if (overrideUrl) urls.push(overrideUrl);
  // Generated artifact served from the studio public dir when the scanner tool
  // (tools/openclinxr/evidence/pipeline-candidate-index.ts) has emitted it.
  urls.push("/pipeline-candidate-index.json");
  // Committed sample fallback (also served from the studio public dir).
  urls.push("/sample-pipeline-candidate-index.json");
  return urls;
}

/**
 * Load + validate the pipeline candidate index, trying each URL in order.
 * `fetchImpl` is injectable for tests.
 */
export async function loadPipelineCandidateIndex(options?: {
  overrideUrl?: string | null;
  urls?: string[];
  fetchImpl?: typeof fetch;
}): Promise<PipelineAdminLoadResult> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const urls = options?.urls ?? pipelineCandidateIndexUrls(options?.overrideUrl);
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        errors.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      const json = (await response.json()) as unknown;
      const validation = validatePipelineCandidateIndex(json);
      if (!validation.ok) {
        errors.push(`${url}: ${validation.errors.join(", ")}`);
        continue;
      }
      return { index: json as PipelineCandidateIndex, loadedFromUrl: url };
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to load pipeline candidate index. Tried:\n${errors.join("\n")}`);
}

/** Aggregate realism (0..1) or null. */
export function aggregateRealism(candidate: PipelineCandidate): number | null {
  return candidate.visionScore ? candidate.visionScore.aggregateRealism_0to1 : null;
}

/** Full-frame realism (0..1) or null when the dual-frame split is absent. */
export function fullRealism(candidate: PipelineCandidate): number | null {
  return candidate.visionScore?.full ? candidate.visionScore.full.realism_0to1 : null;
}

/** Face-frame realism (0..1) or null when the dual-frame split is absent. */
export function faceRealism(candidate: PipelineCandidate): number | null {
  return candidate.visionScore?.face ? candidate.visionScore.face.realism_0to1 : null;
}

/** Aggregate clothing quality (0..1) or null. */
export function aggregateClothing(candidate: PipelineCandidate): number | null {
  return candidate.visionScore ? candidate.visionScore.aggregateClothing_0to1 : null;
}

export type ScoreFraming = "full" | "face" | "aggregate";

/** The realism value for a given framing emphasis. */
export function realismForFraming(candidate: PipelineCandidate, framing: ScoreFraming): number | null {
  if (framing === "full") return fullRealism(candidate);
  if (framing === "face") return faceRealism(candidate);
  return aggregateRealism(candidate);
}

/** Format a 0..1 score as a percentage integer string, or an em dash when null. */
export function formatScorePercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}`;
}

/** Bytes → megabytes with one decimal. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short ISO date (YYYY-MM-DD) for display. */
export function formatDay(iso: string): string {
  return iso.slice(0, 10);
}

/** Distinct roles present in the candidate set (for Table filters). */
export function distinctRoles(candidates: PipelineCandidate[]): string[] {
  return [...new Set(candidates.map((candidate) => candidate.role))].sort();
}
