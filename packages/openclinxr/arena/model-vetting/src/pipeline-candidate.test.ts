import { describe, expect, it } from "vitest";
import {
  buildCandidateId,
  buildPipelineCandidateIndex,
  buildPromotionRecord,
  deployTargetForManifest,
  deriveCandidateRole,
  deriveManifestId,
  joinVisionScore,
  PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION,
  PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR,
  PIPELINE_CANDIDATE_PROMOTION_SCHEMA_VERSION,
  summarizeRigging,
  validatePipelineCandidateIndex,
  type PipelineCandidate,
} from "./pipeline-candidate.js";

const dualFrameScoresDoc = {
  generatedAt: "2026-08-03T20:59:26.729Z",
  notEvidenceFor: ["aesthetic_only_not_clinical_validity"],
  framings: ["full", "face"],
  scores: {
    peds_nurse_kevin: {
      full: { realism_0to1: 0.34, clothing_0to1: 0.52, reason: "full reason" },
      face: { realism_0to1: 0.4, clothing_0to1: 0.1, reason: "face reason" },
      views: {
        full: { realism_0to1: 0.34, clothing_0to1: 0.52, reason: "full reason" },
        face: { realism_0to1: 0.4, clothing_0to1: 0.1, reason: "face reason" },
      },
      realism_0to1: 0.37,
      clothing_0to1: 0.52,
      reason: "full:full reason | face:face reason",
    },
  },
};

const flatScoresDoc = {
  generatedAt: "2026-08-03T20:59:26.729Z",
  notEvidenceFor: ["aesthetic_only_not_clinical_validity"],
  scores: {
    peds_patient_child: { realism_0to1: 0.08, clothing_0to1: 0.12, reason: "shredded" },
  },
};

describe("deriveManifestId", () => {
  it("strips .glb case-insensitively", () => {
    expect(deriveManifestId("peds_nurse_kevin.glb")).toBe("peds_nurse_kevin");
    expect(deriveManifestId("Adult_final.GLB")).toBe("Adult_final");
  });
});

describe("buildCandidateId", () => {
  it("joins group and manifest id", () => {
    expect(buildCandidateId("photoreal-skin-rung-2026-08-03", "nurse_winner")).toBe(
      "photoreal-skin-rung-2026-08-03/nurse_winner",
    );
  });
});

describe("deriveCandidateRole", () => {
  it("prefers rigging phenotype role when present", () => {
    expect(deriveCandidateRole("peds_patient_child", { phenotype: { role: "pediatric_patient_child" } })).toBe(
      "pediatric_patient_child",
    );
  });
  it("falls back to manifest id hints", () => {
    expect(deriveCandidateRole("peds_nurse_kevin")).toBe("nurse");
    expect(deriveCandidateRole("peds_anxious_parent")).toBe("parent");
    expect(deriveCandidateRole("ed_chest_pain_patient_adult_bod")).toBe("adult_patient");
    expect(deriveCandidateRole("mystery_asset")).toBe("unknown_role");
  });
});

describe("joinVisionScore", () => {
  it("joins a dual-frame score with full and face rows", () => {
    const score = joinVisionScore(dualFrameScoresDoc, "peds_nurse_kevin", {
      sourceReportPath: "docs/openclinxr/humanoid-vision-score-2026-08-03.json",
    });
    expect(score).not.toBeNull();
    expect(score?.full?.realism_0to1).toBeCloseTo(0.34);
    expect(score?.face?.realism_0to1).toBeCloseTo(0.4);
    expect(score?.aggregateRealism_0to1).toBeCloseTo(0.37);
    expect(score?.scoredAt).toBe("2026-08-03T20:59:26.729Z");
    expect(score?.sourceReportPath).toContain("humanoid-vision-score");
    expect(score?.notEvidenceFor).toContain("aesthetic_only_not_clinical_validity");
  });
  it("joins a flat aggregate-only score with null full/face", () => {
    const score = joinVisionScore(flatScoresDoc, "peds_patient_child");
    expect(score).not.toBeNull();
    expect(score?.full).toBeNull();
    expect(score?.face).toBeNull();
    expect(score?.aggregateRealism_0to1).toBeCloseTo(0.08);
  });
  it("returns null for an unknown manifest id", () => {
    expect(joinVisionScore(dualFrameScoresDoc, "not_present")).toBeNull();
    expect(joinVisionScore(null, "x")).toBeNull();
  });
});

describe("summarizeRigging", () => {
  it("distills skeleton, morph, garment, wardrobe fields", () => {
    const summary = summarizeRigging({
      realismGrade: "C",
      canonicalSkeleton: { boneCount: 23 },
      morphTargets: { count: 25 },
      realGarmentRegionFromPhenotype: { faceCount: 324 },
      skinning: { normalized: true },
      wardrobeTags: { top: "short_sleeve_exam_tshirt", extras: ["cyan"] },
    });
    expect(summary?.realismGrade).toBe("C");
    expect(summary?.boneCount).toBe(23);
    expect(summary?.morphTargetCount).toBe(25);
    expect(summary?.hasRealGarmentRegion).toBe(true);
    expect(summary?.garmentRegionFaces).toBe(324);
    expect(summary?.skinningNormalized).toBe(true);
    expect(summary?.wardrobeTags).toContain("short_sleeve_exam_tshirt");
    expect(summary?.wardrobeTags).toContain("cyan");
  });
  it("returns null for non-object input", () => {
    expect(summarizeRigging(null)).toBeNull();
  });
});

describe("buildPromotionRecord + deployTargetForManifest", () => {
  const candidate: PipelineCandidate = {
    candidateId: "photoreal-skin-rung-2026-08-03/nurse_winner",
    group: "photoreal-skin-rung-2026-08-03",
    manifestId: "nurse_winner",
    role: "nurse",
    glbPath: ".openclinxr/asset-production/anny/photoreal-skin-rung-2026-08-03/nurse_winner.glb",
    sizeBytes: 123456,
    modifiedAt: "2026-08-03T00:00:00.000Z",
    visionScore: null,
    riggingSummary: null,
    thumbnailPath: null,
    notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
  };

  it("suggests the ui-xr generated-humanoids deploy target", () => {
    expect(deployTargetForManifest("nurse_winner")).toBe(
      "apps/ui-xr/public/generated-humanoids/nurse_winner.glb",
    );
  });

  it("builds a claim-scoped promotion record with copy command and gates", () => {
    const record = buildPromotionRecord(candidate, {
      promotedBy: "faculty_reviewer",
      reason: "best nurse realism this batch",
      promotedAt: "2026-08-03T21:00:00.000Z",
    });
    expect(record.schemaVersion).toBe(PIPELINE_CANDIDATE_PROMOTION_SCHEMA_VERSION);
    expect(record.candidateId).toBe(candidate.candidateId);
    expect(record.deployTargetSuggestion).toBe("apps/ui-xr/public/generated-humanoids/nurse_winner.glb");
    expect(record.copyCommand).toContain("cp ");
    expect(record.copyCommand).toContain("nurse_winner.glb");
    expect(record.claimScope).toContain("not_production_or_clinical_readiness");
    expect(record.notEvidenceFor).toEqual([...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR]);
  });
});

describe("buildPipelineCandidateIndex + validatePipelineCandidateIndex", () => {
  const candidate: PipelineCandidate = {
    candidateId: "g/a",
    group: "g",
    manifestId: "a",
    role: "nurse",
    glbPath: ".openclinxr/asset-production/anny/g/a.glb",
    sizeBytes: 10,
    modifiedAt: "2026-08-03T00:00:00.000Z",
    visionScore: joinVisionScore(flatScoresDoc, "peds_patient_child"),
    riggingSummary: null,
    thumbnailPath: null,
    notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
  };

  it("assembles an index with counts and gates and validates", () => {
    const index = buildPipelineCandidateIndex({
      generatedAt: "2026-08-03T21:00:00.000Z",
      sourceVisionScoreReportPath: "docs/openclinxr/humanoid-vision-score-2026-08-03.json",
      candidates: [candidate, { ...candidate, candidateId: "g/b", manifestId: "b", visionScore: null }],
    });
    expect(index.schemaVersion).toBe(PIPELINE_CANDIDATE_INDEX_SCHEMA_VERSION);
    expect(index.candidateCount).toBe(2);
    expect(index.scoredCandidateCount).toBe(1);
    expect(index.notEvidenceFor).toContain("clinical_validity");
    expect(validatePipelineCandidateIndex(index)).toEqual({ ok: true });
  });

  it("rejects malformed indices", () => {
    expect(validatePipelineCandidateIndex(null).ok).toBe(false);
    expect(validatePipelineCandidateIndex({ schemaVersion: "wrong", candidates: [] }).ok).toBe(false);
  });
});
