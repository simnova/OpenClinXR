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
];
export const PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION = "openclinxr.pipeline-candidate-index.v1";
export const PIPELINE_CANDIDATE_PROMOTION_SCHEMA_VERSION = "openclinxr.pipeline-candidate-promotion.v1";
export const PIPELINE_CANDIDATE_INDEX_CLAIM_SCOPE = "aesthetic_pipeline_candidate_inventory_metadata_only_not_clinical_or_production_readiness";
export const PIPELINE_CANDIDATE_PROMOTION_CLAIM_SCOPE = "aesthetic_metadata_promotion_record_not_production_or_clinical_readiness";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(1, n));
}
/** Strip a trailing `.glb` (case-insensitive) to get the manifest id. */
export function deriveManifestId(glbBasename) {
    return glbBasename.replace(/\.glb$/iu, "");
}
/** Build a stable, unique candidate id from group folder + manifest id. */
export function buildCandidateId(group, manifestId) {
    return `${group}/${manifestId}`;
}
const ROLE_HINTS = [
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
export function deriveCandidateRole(manifestId, riggingReport) {
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
        if (hint.pattern.test(manifestId))
            return hint.role;
    }
    return "unknown_role";
}
/**
 * Join the humanoid-vision-score report `scores` map for one manifest id.
 * Handles both the dual-frame shape (`full`/`face`/`views`) and the flat
 * aggregate-only shape.
 */
export function joinVisionScore(scoresDoc, manifestId, options = {}) {
    if (!isRecord(scoresDoc))
        return null;
    const scores = scoresDoc["scores"];
    if (!isRecord(scores))
        return null;
    const entry = scores[manifestId];
    if (!isRecord(entry))
        return null;
    const readRow = (value, framing) => {
        if (!isRecord(value))
            return null;
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
        ? scoresDoc["notEvidenceFor"].filter((c) => typeof c === "string")
        : ["aesthetic_only_not_clinical_validity"];
    return {
        full,
        face,
        aggregateRealism_0to1: clamp01(entry["realism_0to1"]),
        aggregateClothing_0to1: clamp01(entry["clothing_0to1"]),
        reason: typeof entry["reason"] === "string" ? entry["reason"] : "no reason",
        sourceReportPath: options.sourceReportPath ?? null,
        scoredAt: options.scoredAt ??
            (typeof scoresDoc["generatedAt"] === "string" ? scoresDoc["generatedAt"] : null),
        notEvidenceFor,
    };
}
/** Distill a *_rigging_report.json into a compact quality/rigging summary. */
export function summarizeRigging(riggingReport) {
    if (!isRecord(riggingReport))
        return null;
    const skeleton = riggingReport["canonicalSkeleton"];
    const morphTargets = riggingReport["morphTargets"];
    const garment = riggingReport["realGarmentRegionFromPhenotype"];
    const skinning = riggingReport["skinning"];
    const wardrobe = riggingReport["wardrobeTags"];
    const wardrobeTags = [];
    if (isRecord(wardrobe)) {
        for (const value of Object.values(wardrobe)) {
            if (typeof value === "string" && value.trim())
                wardrobeTags.push(value.trim());
            else if (Array.isArray(value)) {
                for (const item of value)
                    if (typeof item === "string")
                        wardrobeTags.push(item);
            }
        }
    }
    const garmentFaces = isRecord(garment) && typeof garment["faceCount"] === "number"
        ? garment["faceCount"]
        : isRecord(garment) && typeof garment["faces"] === "number"
            ? garment["faces"]
            : null;
    return {
        realismGrade: typeof riggingReport["realismGrade"] === "string" ? riggingReport["realismGrade"] : null,
        boneCount: isRecord(skeleton) && typeof skeleton["boneCount"] === "number" ? skeleton["boneCount"] : null,
        morphTargetCount: isRecord(morphTargets) && typeof morphTargets["count"] === "number" ? morphTargets["count"] : null,
        hasRealGarmentRegion: isRecord(garment) && Object.keys(garment).length > 0,
        garmentRegionFaces: garmentFaces,
        wardrobeTags: [...new Set(wardrobeTags)],
        skinningNormalized: isRecord(skinning) && typeof skinning["normalized"] === "boolean" ? skinning["normalized"] : null,
        claimScope: "aesthetic_structural_rigging_metadata_only_not_clinical_or_production_rig",
    };
}
/** Primary runtime deploy path (ui-xr generated-humanoids). Back-compat alias for deployTargets[0]. */
export function deployTargetForManifest(manifestId) {
    return `apps/ui-xr/public/generated-humanoids/${manifestId}.glb`;
}
/** Cagematch "current" slot path for a promoted candidate GLB. */
export function cagematchDeployTargetForManifest(manifestId) {
    return `apps/ui-xr/public/cagematch/anny-real-garment/current/${manifestId}.glb`;
}
/**
 * Both runtime deploy targets for aesthetic asset staging.
 * Order is stable: primary generated-humanoids first, then cagematch current.
 */
export function deployTargetsForManifest(manifestId) {
    return [deployTargetForManifest(manifestId), cagematchDeployTargetForManifest(manifestId)];
}
/** Build a deterministic, claim-scoped promotion record for a candidate. */
export function buildPromotionRecord(candidate, options) {
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
export function joinPromotionStatus(candidates, promotionsIndex) {
    const byId = new Map();
    if (isRecord(promotionsIndex) && Array.isArray(promotionsIndex["promotions"])) {
        for (const entry of promotionsIndex["promotions"]) {
            if (!isRecord(entry))
                continue;
            const candidateId = typeof entry["candidateId"] === "string" ? entry["candidateId"] : "";
            if (!candidateId || byId.has(candidateId))
                continue; // first = newest (index is newest-first)
            const promotedAt = typeof entry["promotedAt"] === "string" ? entry["promotedAt"] : "";
            const promotedBy = typeof entry["promotedBy"] === "string" ? entry["promotedBy"] : "unknown";
            const recordPath = typeof entry["recordPath"] === "string" ? entry["recordPath"] : "";
            if (!promotedAt)
                continue;
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
export function buildPipelineCandidateIndex(input) {
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
export function validatePipelineCandidateIndex(value) {
    const errors = [];
    if (!isRecord(value))
        return { ok: false, errors: ["index is not an object"] };
    if (value["schemaVersion"] !== PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION) {
        errors.push(`schemaVersion must be ${PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION}`);
    }
    if (!Array.isArray(value["candidates"]))
        errors.push("candidates must be an array");
    if (!Array.isArray(value["notEvidenceFor"]))
        errors.push("notEvidenceFor must be an array");
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
/**
 * Batch-score every candidate in an index by joining a humanoid-vision-score
 * report `scores` map (dual-frame or flat). Pure — no filesystem, no network.
 *
 * Aesthetic generation-quality only; never flips readiness/clinical gates.
 * Results are written back onto each candidate's `visionScore` field and the
 * index `scoredCandidateCount` / `sourceVisionScoreReportPath` are refreshed.
 */
export function batchScorePipelineIndex(index, scoresDoc, options = {}) {
    const preserveUnmatched = options.preserveUnmatched !== false;
    const sourceReportPath = options.sourceReportPath !== undefined
        ? options.sourceReportPath
        : index.sourceVisionScoreReportPath;
    const scoredAt = options.scoredAt ??
        (isRecord(scoresDoc) && typeof scoresDoc["generatedAt"] === "string"
            ? scoresDoc["generatedAt"]
            : null);
    const candidates = index.candidates.map((candidate) => {
        const joined = joinVisionScore(scoresDoc, candidate.manifestId, {
            sourceReportPath,
            scoredAt,
        });
        if (joined === null && preserveUnmatched) {
            return candidate;
        }
        return {
            ...candidate,
            visionScore: joined,
            // Re-assert aesthetic-only gates on every batch score write-back.
            notEvidenceFor: uniquePreserveOrder([
                ...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR,
                ...candidate.notEvidenceFor,
            ]),
        };
    });
    return {
        ...index,
        generatedAt: options.generatedAt ?? new Date().toISOString(),
        claimScope: PIPELINE_CANDIDATE_INDEX_CLAIM_SCOPE,
        sourceVisionScoreReportPath: sourceReportPath ?? null,
        candidateCount: candidates.length,
        scoredCandidateCount: candidates.filter((c) => c.visionScore !== null).length,
        notEvidenceFor: uniquePreserveOrder([
            ...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR,
            ...index.notEvidenceFor,
        ]),
        candidates,
    };
}
/** Nullable numeric delta: right − left, or null when either side is null/undefined. */
export function numericDelta(left, right) {
    if (left === null || left === undefined || right === null || right === undefined)
        return null;
    if (!Number.isFinite(left) || !Number.isFinite(right))
        return null;
    return right - left;
}
/**
 * Side-by-side candidate DIFF: score deltas (right − left) + rigging deltas.
 * Aesthetic-only comparison; not evidence for clinical/scoring/learner readiness.
 */
export function diffPipelineCandidates(left, right) {
    const leftScore = left.visionScore;
    const rightScore = right.visionScore;
    const leftRig = left.riggingSummary;
    const rightRig = right.riggingSummary;
    const leftWardrobe = new Set(leftRig?.wardrobeTags ?? []);
    const rightWardrobe = new Set(rightRig?.wardrobeTags ?? []);
    const wardrobeTagsAdded = [...rightWardrobe].filter((t) => !leftWardrobe.has(t)).sort();
    const wardrobeTagsRemoved = [...leftWardrobe].filter((t) => !rightWardrobe.has(t)).sort();
    const leftGrade = leftRig?.realismGrade ?? null;
    const rightGrade = rightRig?.realismGrade ?? null;
    const leftGarment = leftRig ? leftRig.hasRealGarmentRegion : null;
    const rightGarment = rightRig ? rightRig.hasRealGarmentRegion : null;
    const leftSkin = leftRig?.skinningNormalized ?? null;
    const rightSkin = rightRig?.skinningNormalized ?? null;
    return {
        leftCandidateId: left.candidateId,
        rightCandidateId: right.candidateId,
        leftManifestId: left.manifestId,
        rightManifestId: right.manifestId,
        leftRole: left.role,
        rightRole: right.role,
        scoreDeltas: {
            aggregateRealism: numericDelta(leftScore?.aggregateRealism_0to1 ?? null, rightScore?.aggregateRealism_0to1 ?? null),
            aggregateClothing: numericDelta(leftScore?.aggregateClothing_0to1 ?? null, rightScore?.aggregateClothing_0to1 ?? null),
            fullRealism: numericDelta(leftScore?.full?.realism_0to1 ?? null, rightScore?.full?.realism_0to1 ?? null),
            faceRealism: numericDelta(leftScore?.face?.realism_0to1 ?? null, rightScore?.face?.realism_0to1 ?? null),
            fullClothing: numericDelta(leftScore?.full?.clothing_0to1 ?? null, rightScore?.full?.clothing_0to1 ?? null),
            faceClothing: numericDelta(leftScore?.face?.clothing_0to1 ?? null, rightScore?.face?.clothing_0to1 ?? null),
        },
        riggingDeltas: {
            boneCount: numericDelta(leftRig?.boneCount ?? null, rightRig?.boneCount ?? null),
            morphTargetCount: numericDelta(leftRig?.morphTargetCount ?? null, rightRig?.morphTargetCount ?? null),
            garmentRegionFaces: numericDelta(leftRig?.garmentRegionFaces ?? null, rightRig?.garmentRegionFaces ?? null),
            realismGrade: {
                left: leftGrade,
                right: rightGrade,
                changed: leftGrade !== rightGrade,
            },
            hasRealGarmentRegion: {
                left: leftGarment,
                right: rightGarment,
                changed: leftGarment !== rightGarment,
            },
            skinningNormalized: {
                left: leftSkin,
                right: rightSkin,
                changed: leftSkin !== rightSkin,
            },
            wardrobeTagsAdded,
            wardrobeTagsRemoved,
        },
        claimScope: "aesthetic_candidate_diff_metadata_only_not_clinical_or_production_readiness",
        notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
    };
}
function uniquePreserveOrder(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        if (seen.has(value))
            continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}
