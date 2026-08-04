/**
 * pipeline-candidate.ts — shared data contract for the Pipeline Administration /
 * Model Vetting proving-ground surface.
 *
 * Pure types + pure builder/join helpers only (NO node fs). The filesystem scan
 * lives in tools/openclinxr/evidence/pipeline-candidate-index.ts; the studio app
 * and the promote tool both consume these helpers so the on-disk JSON contract
 * has a single source of truth.
 *
 * Every artifact keeps `notEvidenceFor` gates and an aesthetic-only claim scope.
 * Realism scores are aesthetic generation-quality only, never clinical validity.
 */

export const PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR = [
  "clinical_validity",
  "exam_equivalence",
  "scoring",
  "learner_readiness",
] as const;

export type PipelineCandidateNotEvidenceForClaim =
  (typeof PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR)[number];

export const PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION =
  "openclinxr.pipeline-candidate-index.v1" as const;
export const PIPELINE_CANDIDATE_PROMOTION_SCHEMA_VERSION =
  "openclinxr.pipeline-candidate-promotion.v1" as const;

export const PIPELINE_CANDIDATE_INDEX_CLAIM_SCOPE =
  "aesthetic_pipeline_candidate_inventory_metadata_only_not_clinical_or_production_readiness" as const;
export const PIPELINE_CANDIDATE_PROMOTION_CLAIM_SCOPE =
  "aesthetic_metadata_promotion_record_not_production_or_clinical_readiness" as const;

/** Single-framing score row as emitted by humanoid-vision-score.ts. */
export type DualFrameVisionScoreRow = {
  realism_0to1: number;
  clothing_0to1: number;
  reason: string;
  framing?: "full" | "face";
};

/** Joined dual-frame (full + face) vision score for one candidate. */
export type CandidateVisionScore = {
  full: DualFrameVisionScoreRow | null;
  face: DualFrameVisionScoreRow | null;
  aggregateRealism_0to1: number;
  aggregateClothing_0to1: number;
  reason: string;
  sourceReportPath: string | null;
  scoredAt: string | null;
  notEvidenceFor: string[];
};

/** Structural rigging/quality metadata distilled from a *_rigging_report.json. */
export type CandidateRiggingSummary = {
  realismGrade: string | null;
  boneCount: number | null;
  morphTargetCount: number | null;
  hasRealGarmentRegion: boolean;
  garmentRegionFaces: number | null;
  wardrobeTags: string[];
  skinningNormalized: boolean | null;
  claimScope: string;
};

/** Promotion status joined from `.openclinxr/asset-production/promotions/index.json`. */
export type CandidatePromotionStatus = {
  promoted: true;
  promotedAt: string;
  promotedBy: string;
  recordPath: string;
};

export type PipelineCandidate = {
  candidateId: string;
  group: string;
  manifestId: string;
  role: string;
  glbPath: string;
  sizeBytes: number;
  modifiedAt: string;
  visionScore: CandidateVisionScore | null;
  riggingSummary: CandidateRiggingSummary | null;
  thumbnailPath: string | null;
  /** Present when this candidate has a promotion record (newest wins); null otherwise. */
  promotion?: CandidatePromotionStatus | null;
  notEvidenceFor: string[];
};

export type PipelineCandidateIndex = {
  schemaVersion: typeof PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION;
  generatedAt: string;
  claimScope: typeof PIPELINE_CANDIDATE_INDEX_CLAIM_SCOPE;
  sourceVisionScoreReportPath: string | null;
  candidateCount: number;
  scoredCandidateCount: number;
  notEvidenceFor: string[];
  candidates: PipelineCandidate[];
};

export type PromotionRecord = {
  schemaVersion: typeof PIPELINE_CANDIDATE_PROMOTION_SCHEMA_VERSION;
  promotedAt: string;
  candidateId: string;
  manifestId: string;
  group: string;
  role: string;
  glbPath: string;
  visionScore: CandidateVisionScore | null;
  riggingSummary: CandidateRiggingSummary | null;
  promotedBy: string;
  reason: string;
  /**
   * Primary runtime deploy path (back-compat). Always equals `deployTargets[0]`.
   * Aesthetic asset staging only — not production/clinical readiness.
   */
  deployTargetSuggestion: string;
  /**
   * All runtime deploy paths for this promotion:
   * 1. apps/ui-xr/public/generated-humanoids/<manifestId>.glb
   * 2. apps/ui-xr/public/cagematch/anny-real-garment/current/<manifestId>.glb
   */
  deployTargets: string[];
  copyCommand: string;
  claimScope: typeof PIPELINE_CANDIDATE_PROMOTION_CLAIM_SCOPE;
  notEvidenceFor: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp01(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Strip a trailing `.glb` (case-insensitive) to get the manifest id. */
export function deriveManifestId(glbBasename: string): string {
  return glbBasename.replace(/\.glb$/iu, "");
}

/** Build a stable, unique candidate id from group folder + manifest id. */
export function buildCandidateId(group: string, manifestId: string): string {
  return `${group}/${manifestId}`;
}

const ROLE_HINTS: ReadonlyArray<{ pattern: RegExp; role: string }> = [
  { pattern: /nurse/iu, role: "nurse" },
  { pattern: /parent|caregiver|mother|father|mom|dad/iu, role: "parent" },
  { pattern: /child|peds_patient|pediatric|kid/iu, role: "pediatric_patient" },
  { pattern: /adult|ed_chest_pain|chest_pain/iu, role: "adult_patient" },
  { pattern: /patient/iu, role: "patient" },
  { pattern: /faculty|proctor|instructor/iu, role: "faculty" },
];

/**
 * Derive a coarse actor role from the manifest id, optionally refined by a
 * rigging report phenotype/role hint. Aesthetic labeling only.
 */
export function deriveCandidateRole(
  manifestId: string,
  riggingReport?: unknown,
): string {
  if (isRecord(riggingReport)) {
    const phenotype = riggingReport["phenotype"];
    if (isRecord(phenotype) && typeof phenotype["role"] === "string" && phenotype["role"].trim()) {
      return phenotype["role"].trim();
    }
    const regions = riggingReport["roleClothingMaterialRegions"];
    if (isRecord(regions) && typeof regions["wardrobeRole"] === "string" && regions["wardrobeRole"].trim()) {
      return regions["wardrobeRole"].trim();
    }
  }
  for (const hint of ROLE_HINTS) {
    if (hint.pattern.test(manifestId)) return hint.role;
  }
  return "unknown_role";
}

/**
 * Join the humanoid-vision-score report `scores` map for one manifest id.
 * Handles both the dual-frame shape (`full`/`face`/`views`) and the flat
 * aggregate-only shape.
 */
export function joinVisionScore(
  scoresDoc: unknown,
  manifestId: string,
  options: { sourceReportPath?: string | null; scoredAt?: string | null } = {},
): CandidateVisionScore | null {
  if (!isRecord(scoresDoc)) return null;
  const scores = scoresDoc["scores"];
  if (!isRecord(scores)) return null;
  const entry = scores[manifestId];
  if (!isRecord(entry)) return null;

  const readRow = (value: unknown, framing: "full" | "face"): DualFrameVisionScoreRow | null => {
    if (!isRecord(value)) return null;
    return {
      realism_0to1: clamp01(value["realism_0to1"]),
      clothing_0to1: clamp01(value["clothing_0to1"]),
      reason: typeof value["reason"] === "string" ? value["reason"] : "no reason",
      framing,
    };
  };

  const views = isRecord(entry["views"]) ? entry["views"] : entry;
  const full = readRow(views["full"], "full");
  const face = readRow(views["face"], "face");
  const notEvidenceFor = Array.isArray(scoresDoc["notEvidenceFor"])
    ? scoresDoc["notEvidenceFor"].filter((c): c is string => typeof c === "string")
    : ["aesthetic_only_not_clinical_validity"];

  return {
    full,
    face,
    aggregateRealism_0to1: clamp01(entry["realism_0to1"]),
    aggregateClothing_0to1: clamp01(entry["clothing_0to1"]),
    reason: typeof entry["reason"] === "string" ? entry["reason"] : "no reason",
    sourceReportPath: options.sourceReportPath ?? null,
    scoredAt:
      options.scoredAt ??
      (typeof scoresDoc["generatedAt"] === "string" ? scoresDoc["generatedAt"] : null),
    notEvidenceFor,
  };
}

/** Distill a *_rigging_report.json into a compact quality/rigging summary. */
export function summarizeRigging(riggingReport: unknown): CandidateRiggingSummary | null {
  if (!isRecord(riggingReport)) return null;
  const skeleton = riggingReport["canonicalSkeleton"];
  const morphTargets = riggingReport["morphTargets"];
  const garment = riggingReport["realGarmentRegionFromPhenotype"];
  const skinning = riggingReport["skinning"];
  const wardrobe = riggingReport["wardrobeTags"];

  const wardrobeTags: string[] = [];
  if (isRecord(wardrobe)) {
    for (const value of Object.values(wardrobe)) {
      if (typeof value === "string" && value.trim()) wardrobeTags.push(value.trim());
      else if (Array.isArray(value)) {
        for (const item of value) if (typeof item === "string") wardrobeTags.push(item);
      }
    }
  }

  const garmentFaces =
    isRecord(garment) && typeof garment["faceCount"] === "number"
      ? garment["faceCount"]
      : isRecord(garment) && typeof garment["faces"] === "number"
        ? garment["faces"]
        : null;

  return {
    realismGrade: typeof riggingReport["realismGrade"] === "string" ? riggingReport["realismGrade"] : null,
    boneCount: isRecord(skeleton) && typeof skeleton["boneCount"] === "number" ? skeleton["boneCount"] : null,
    morphTargetCount:
      isRecord(morphTargets) && typeof morphTargets["count"] === "number" ? morphTargets["count"] : null,
    hasRealGarmentRegion: isRecord(garment) && Object.keys(garment).length > 0,
    garmentRegionFaces: garmentFaces,
    wardrobeTags: [...new Set(wardrobeTags)],
    skinningNormalized: isRecord(skinning) && typeof skinning["normalized"] === "boolean" ? skinning["normalized"] : null,
    claimScope: "aesthetic_structural_rigging_metadata_only_not_clinical_or_production_rig",
  };
}

/** Primary runtime deploy path (ui-xr generated-humanoids). Back-compat alias for deployTargets[0]. */
export function deployTargetForManifest(manifestId: string): string {
  return `apps/ui-xr/public/generated-humanoids/${manifestId}.glb`;
}

/** Cagematch "current" slot path for a promoted candidate GLB. */
export function cagematchDeployTargetForManifest(manifestId: string): string {
  return `apps/ui-xr/public/cagematch/anny-real-garment/current/${manifestId}.glb`;
}

/**
 * Both runtime deploy targets for aesthetic asset staging.
 * Order is stable: primary generated-humanoids first, then cagematch current.
 */
export function deployTargetsForManifest(manifestId: string): string[] {
  return [deployTargetForManifest(manifestId), cagematchDeployTargetForManifest(manifestId)];
}

/** Build a deterministic, claim-scoped promotion record for a candidate. */
export function buildPromotionRecord(
  candidate: PipelineCandidate,
  options: { promotedBy: string; reason: string; promotedAt: string },
): PromotionRecord {
  const deployTargets = deployTargetsForManifest(candidate.manifestId);
  const deployTargetSuggestion = deployTargets[0] ?? deployTargetForManifest(candidate.manifestId);
  const copyParts = deployTargets.map((dest) => `cp "${candidate.glbPath}" "${dest}"`).join(" && ");
  return {
    schemaVersion: PIPELINE_CANDIDATE_PROMOTION_SCHEMA_VERSION,
    promotedAt: options.promotedAt,
    candidateId: candidate.candidateId,
    manifestId: candidate.manifestId,
    group: candidate.group,
    role: candidate.role,
    glbPath: candidate.glbPath,
    visionScore: candidate.visionScore,
    riggingSummary: candidate.riggingSummary,
    promotedBy: options.promotedBy,
    reason: options.reason,
    deployTargetSuggestion,
    deployTargets,
    copyCommand: copyParts,
    claimScope: PIPELINE_CANDIDATE_PROMOTION_CLAIM_SCOPE,
    notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
  };
}

/**
 * Join promotions index entries onto candidates (match by candidateId; newest wins).
 * Pure helper used by the index builder and tests.
 */
export function joinPromotionStatus(
  candidates: PipelineCandidate[],
  promotionsIndex: unknown,
): PipelineCandidate[] {
  const byId = new Map<string, CandidatePromotionStatus>();
  if (isRecord(promotionsIndex) && Array.isArray(promotionsIndex["promotions"])) {
    for (const entry of promotionsIndex["promotions"]) {
      if (!isRecord(entry)) continue;
      const candidateId = typeof entry["candidateId"] === "string" ? entry["candidateId"] : "";
      if (!candidateId || byId.has(candidateId)) continue; // first = newest (index is newest-first)
      const promotedAt = typeof entry["promotedAt"] === "string" ? entry["promotedAt"] : "";
      const promotedBy = typeof entry["promotedBy"] === "string" ? entry["promotedBy"] : "unknown";
      const recordPath = typeof entry["recordPath"] === "string" ? entry["recordPath"] : "";
      if (!promotedAt) continue;
      byId.set(candidateId, {
        promoted: true,
        promotedAt,
        promotedBy,
        recordPath,
      });
    }
  }
  return candidates.map((c) => ({
    ...c,
    promotion: byId.get(c.candidateId) ?? null,
  }));
}

/** Assemble a full candidate index document (pure — inputs already gathered). */
export function buildPipelineCandidateIndex(input: {
  generatedAt: string;
  sourceVisionScoreReportPath: string | null;
  candidates: PipelineCandidate[];
}): PipelineCandidateIndex {
  const scoredCandidateCount = input.candidates.filter((c) => c.visionScore !== null).length;
  return {
    schemaVersion: PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    claimScope: PIPELINE_CANDIDATE_INDEX_CLAIM_SCOPE,
    sourceVisionScoreReportPath: input.sourceVisionScoreReportPath,
    candidateCount: input.candidates.length,
    scoredCandidateCount,
    notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
    candidates: input.candidates,
  };
}

/** Structural validation for a loaded pipeline candidate index JSON. */
export function validatePipelineCandidateIndex(
  value: unknown,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["index is not an object"] };
  if (value["schemaVersion"] !== PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value["candidates"])) errors.push("candidates must be an array");
  if (!Array.isArray(value["notEvidenceFor"])) errors.push("notEvidenceFor must be an array");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
