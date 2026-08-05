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
export declare const PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR: readonly ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"];
export type PipelineCandidateNotEvidenceForClaim = (typeof PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR)[number];
export declare const PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION: "openclinxr.pipeline-candidate-index.v1";
export declare const PIPELINE_CANDIDATE_PROMOTION_SCHEMA_VERSION: "openclinxr.pipeline-candidate-promotion.v1";
export declare const PIPELINE_CANDIDATE_INDEX_CLAIM_SCOPE: "aesthetic_pipeline_candidate_inventory_metadata_only_not_clinical_or_production_readiness";
export declare const PIPELINE_CANDIDATE_PROMOTION_CLAIM_SCOPE: "aesthetic_metadata_promotion_record_not_production_or_clinical_readiness";
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
/** Strip a trailing `.glb` (case-insensitive) to get the manifest id. */
export declare function deriveManifestId(glbBasename: string): string;
/** Build a stable, unique candidate id from group folder + manifest id. */
export declare function buildCandidateId(group: string, manifestId: string): string;
/**
 * Derive a coarse actor role from the manifest id, optionally refined by a
 * rigging report phenotype/role hint. Aesthetic labeling only.
 */
export declare function deriveCandidateRole(manifestId: string, riggingReport?: unknown): string;
/**
 * Join the humanoid-vision-score report `scores` map for one manifest id.
 * Handles both the dual-frame shape (`full`/`face`/`views`) and the flat
 * aggregate-only shape.
 */
export declare function joinVisionScore(scoresDoc: unknown, manifestId: string, options?: {
    sourceReportPath?: string | null;
    scoredAt?: string | null;
}): CandidateVisionScore | null;
/** Distill a *_rigging_report.json into a compact quality/rigging summary. */
export declare function summarizeRigging(riggingReport: unknown): CandidateRiggingSummary | null;
/** Primary runtime deploy path (ui-xr generated-humanoids). Back-compat alias for deployTargets[0]. */
export declare function deployTargetForManifest(manifestId: string): string;
/** Cagematch "current" slot path for a promoted candidate GLB. */
export declare function cagematchDeployTargetForManifest(manifestId: string): string;
/**
 * Both runtime deploy targets for aesthetic asset staging.
 * Order is stable: primary generated-humanoids first, then cagematch current.
 */
export declare function deployTargetsForManifest(manifestId: string): string[];
/** Build a deterministic, claim-scoped promotion record for a candidate. */
export declare function buildPromotionRecord(candidate: PipelineCandidate, options: {
    promotedBy: string;
    reason: string;
    promotedAt: string;
}): PromotionRecord;
/**
 * Join promotions index entries onto candidates (match by candidateId; newest wins).
 * Pure helper used by the index builder and tests.
 */
export declare function joinPromotionStatus(candidates: PipelineCandidate[], promotionsIndex: unknown): PipelineCandidate[];
/** Assemble a full candidate index document (pure — inputs already gathered). */
export declare function buildPipelineCandidateIndex(input: {
    generatedAt: string;
    sourceVisionScoreReportPath: string | null;
    candidates: PipelineCandidate[];
}): PipelineCandidateIndex;
/** Structural validation for a loaded pipeline candidate index JSON. */
export declare function validatePipelineCandidateIndex(value: unknown): {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
/**
 * Batch-score every candidate in an index by joining a humanoid-vision-score
 * report `scores` map (dual-frame or flat). Pure — no filesystem, no network.
 *
 * Aesthetic generation-quality only; never flips readiness/clinical gates.
 * Results are written back onto each candidate's `visionScore` field and the
 * index `scoredCandidateCount` / `sourceVisionScoreReportPath` are refreshed.
 */
export declare function batchScorePipelineIndex(index: PipelineCandidateIndex, scoresDoc: unknown, options?: {
    sourceReportPath?: string | null;
    scoredAt?: string | null;
    generatedAt?: string;
    /** When true (default), keep prior visionScore if join returns null. */
    preserveUnmatched?: boolean;
}): PipelineCandidateIndex;
/** Nullable numeric delta: right − left, or null when either side is null/undefined. */
export declare function numericDelta(left: number | null | undefined, right: number | null | undefined): number | null;
export type CandidateScoreDelta = {
    aggregateRealism: number | null;
    aggregateClothing: number | null;
    fullRealism: number | null;
    faceRealism: number | null;
    fullClothing: number | null;
    faceClothing: number | null;
};
export type CandidateRiggingDelta = {
    boneCount: number | null;
    morphTargetCount: number | null;
    garmentRegionFaces: number | null;
    realismGrade: {
        left: string | null;
        right: string | null;
        changed: boolean;
    };
    hasRealGarmentRegion: {
        left: boolean | null;
        right: boolean | null;
        changed: boolean;
    };
    skinningNormalized: {
        left: boolean | null;
        right: boolean | null;
        changed: boolean;
    };
    wardrobeTagsAdded: string[];
    wardrobeTagsRemoved: string[];
};
export type PipelineCandidateDiff = {
    leftCandidateId: string;
    rightCandidateId: string;
    leftManifestId: string;
    rightManifestId: string;
    leftRole: string;
    rightRole: string;
    scoreDeltas: CandidateScoreDelta;
    riggingDeltas: CandidateRiggingDelta;
    claimScope: "aesthetic_candidate_diff_metadata_only_not_clinical_or_production_readiness";
    notEvidenceFor: string[];
};
/**
 * Side-by-side candidate DIFF: score deltas (right − left) + rigging deltas.
 * Aesthetic-only comparison; not evidence for clinical/scoring/learner readiness.
 */
export declare function diffPipelineCandidates(left: PipelineCandidate, right: PipelineCandidate): PipelineCandidateDiff;
//# sourceMappingURL=pipeline-candidate.d.ts.map