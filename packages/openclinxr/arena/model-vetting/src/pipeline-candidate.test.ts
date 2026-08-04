import { describe, expect, it } from "vitest";
import {
  batchScorePipelineIndex,
  buildCandidateId,
  buildPipelineCandidateIndex,
  buildPromotionRecord,
  cagematchDeployTargetForManifest,
  deployTargetForManifest,
  deployTargetsForManifest,
  deriveCandidateRole,
  deriveManifestId,
  diffPipelineCandidates,
  joinPromotionStatus,
  joinVisionScore,
  numericDelta,
  PIPELINE_CANDIDATE_INDEX_CLAIM_SCOPE,
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
    promotion: null,
    notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
  };

  it("suggests the ui-xr generated-humanoids deploy target", () => {
    expect(deployTargetForManifest("nurse_winner")).toBe(
      "apps/ui-xr/public/generated-humanoids/nurse_winner.glb",
    );
  });

  it("lists both runtime deploy targets (primary + cagematch current)", () => {
    const targets = deployTargetsForManifest("nurse_winner");
    expect(targets).toEqual([
      "apps/ui-xr/public/generated-humanoids/nurse_winner.glb",
      "apps/ui-xr/public/cagematch/anny-real-garment/current/nurse_winner.glb",
    ]);
    expect(cagematchDeployTargetForManifest("nurse_winner")).toBe(targets[1]);
    expect(deployTargetForManifest("nurse_winner")).toBe(targets[0]);
  });

  it("builds a claim-scoped promotion record with deployTargets, copy command, and gates", () => {
    const record = buildPromotionRecord(candidate, {
      promotedBy: "faculty_reviewer",
      reason: "best nurse realism this batch",
      promotedAt: "2026-08-03T21:00:00.000Z",
    });
    expect(record.schemaVersion).toBe(PIPELINE_CANDIDATE_PROMOTION_SCHEMA_VERSION);
    expect(record.candidateId).toBe(candidate.candidateId);
    expect(record.deployTargetSuggestion).toBe("apps/ui-xr/public/generated-humanoids/nurse_winner.glb");
    expect(record.deployTargets).toEqual([
      "apps/ui-xr/public/generated-humanoids/nurse_winner.glb",
      "apps/ui-xr/public/cagematch/anny-real-garment/current/nurse_winner.glb",
    ]);
    expect(record.deployTargetSuggestion).toBe(record.deployTargets[0]);
    expect(record.copyCommand).toContain("cp ");
    expect(record.copyCommand).toContain("nurse_winner.glb");
    expect(record.copyCommand).toContain("cagematch/anny-real-garment/current");
    expect(record.claimScope).toContain("not_production_or_clinical_readiness");
    expect(record.notEvidenceFor).toEqual([...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR]);
  });
});

describe("joinPromotionStatus", () => {
  const base: PipelineCandidate = {
    candidateId: "pilot-demo/peds_nurse_kevin",
    group: "pilot-demo",
    manifestId: "peds_nurse_kevin",
    role: "nurse",
    glbPath: ".openclinxr/asset-production/anny/pilot-demo/peds_nurse_kevin.glb",
    sizeBytes: 10,
    modifiedAt: "2026-08-03T00:00:00.000Z",
    visionScore: null,
    riggingSummary: null,
    thumbnailPath: null,
    notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
  };

  it("sets promotion=null when no promotions index", () => {
    const joined = joinPromotionStatus([base], null);
    expect(joined[0]?.promotion).toBeNull();
  });

  it("joins newest promotion by candidateId (first entry wins)", () => {
    const joined = joinPromotionStatus([base, { ...base, candidateId: "other/x", manifestId: "x" }], {
      promotions: [
        {
          candidateId: "pilot-demo/peds_nurse_kevin",
          promotedAt: "2026-08-03T22:00:00.000Z",
          promotedBy: "faculty_reviewer",
          recordPath: ".openclinxr/asset-production/promotions/newer.json",
        },
        {
          candidateId: "pilot-demo/peds_nurse_kevin",
          promotedAt: "2026-08-03T21:00:00.000Z",
          promotedBy: "old",
          recordPath: ".openclinxr/asset-production/promotions/older.json",
        },
      ],
    });
    expect(joined[0]?.promotion).toEqual({
      promoted: true,
      promotedAt: "2026-08-03T22:00:00.000Z",
      promotedBy: "faculty_reviewer",
      recordPath: ".openclinxr/asset-production/promotions/newer.json",
    });
    expect(joined[1]?.promotion).toBeNull();
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

describe("batchScorePipelineIndex", () => {
  const unscoredNurse: PipelineCandidate = {
    candidateId: "g/peds_nurse_kevin",
    group: "g",
    manifestId: "peds_nurse_kevin",
    role: "nurse",
    glbPath: ".openclinxr/asset-production/anny/g/peds_nurse_kevin.glb",
    sizeBytes: 10,
    modifiedAt: "2026-08-03T00:00:00.000Z",
    visionScore: null,
    riggingSummary: null,
    thumbnailPath: null,
    notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
  };
  const unscoredOther: PipelineCandidate = {
    ...unscoredNurse,
    candidateId: "g/unknown_mesh",
    manifestId: "unknown_mesh",
    role: "unknown_role",
  };

  it("joins humanoid-vision-score rows onto all matching candidates and refreshes counts", () => {
    const index = buildPipelineCandidateIndex({
      generatedAt: "2026-08-03T20:00:00.000Z",
      sourceVisionScoreReportPath: null,
      candidates: [unscoredNurse, unscoredOther],
    });
    expect(index.scoredCandidateCount).toBe(0);

    const scored = batchScorePipelineIndex(index, dualFrameScoresDoc, {
      sourceReportPath: "docs/openclinxr/humanoid-vision-score-2026-08-03.json",
      generatedAt: "2026-08-03T21:00:00.000Z",
    });

    expect(scored.claimScope).toBe(PIPELINE_CANDIDATE_INDEX_CLAIM_SCOPE);
    expect(scored.sourceVisionScoreReportPath).toBe(
      "docs/openclinxr/humanoid-vision-score-2026-08-03.json",
    );
    expect(scored.scoredCandidateCount).toBe(1);
    expect(scored.candidates[0]?.visionScore?.aggregateRealism_0to1).toBeCloseTo(0.37);
    expect(scored.candidates[0]?.visionScore?.full?.realism_0to1).toBeCloseTo(0.34);
    expect(scored.candidates[0]?.visionScore?.notEvidenceFor).toContain(
      "aesthetic_only_not_clinical_validity",
    );
    // Unmatched manifest keeps prior (null) score when preserveUnmatched defaults true.
    expect(scored.candidates[1]?.visionScore).toBeNull();
    expect(scored.notEvidenceFor).toEqual(expect.arrayContaining([...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR]));
    expect(validatePipelineCandidateIndex(scored)).toEqual({ ok: true });
  });

  it("clears unmatched scores when preserveUnmatched=false", () => {
    const prior = {
      ...unscoredOther,
      visionScore: joinVisionScore(flatScoresDoc, "peds_patient_child"),
      manifestId: "peds_patient_child",
      candidateId: "g/peds_patient_child",
    };
    const index = buildPipelineCandidateIndex({
      generatedAt: "2026-08-03T20:00:00.000Z",
      sourceVisionScoreReportPath: null,
      candidates: [prior],
    });
    const scored = batchScorePipelineIndex(index, dualFrameScoresDoc, {
      preserveUnmatched: false,
      sourceReportPath: "docs/openclinxr/humanoid-vision-score-2026-08-03.json",
    });
    expect(scored.candidates[0]?.visionScore).toBeNull();
    expect(scored.scoredCandidateCount).toBe(0);
  });
});

describe("diffPipelineCandidates + numericDelta", () => {
  const left: PipelineCandidate = {
    candidateId: "g/left",
    group: "g",
    manifestId: "left_mesh",
    role: "nurse",
    glbPath: ".openclinxr/asset-production/anny/g/left.glb",
    sizeBytes: 10,
    modifiedAt: "2026-08-03T00:00:00.000Z",
    visionScore: {
      full: { realism_0to1: 0.3, clothing_0to1: 0.4, reason: "L full" },
      face: { realism_0to1: 0.2, clothing_0to1: 0.1, reason: "L face" },
      aggregateRealism_0to1: 0.25,
      aggregateClothing_0to1: 0.4,
      reason: "left",
      sourceReportPath: null,
      scoredAt: null,
      notEvidenceFor: ["aesthetic_only_not_clinical_validity"],
    },
    riggingSummary: {
      realismGrade: "C",
      boneCount: 20,
      morphTargetCount: 10,
      hasRealGarmentRegion: false,
      garmentRegionFaces: 0,
      wardrobeTags: ["scrubs"],
      skinningNormalized: false,
      claimScope: "aesthetic_structural_rigging_metadata_only_not_clinical_or_production_rig",
    },
    thumbnailPath: null,
    notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
  };
  const right: PipelineCandidate = {
    ...left,
    candidateId: "g/right",
    manifestId: "right_mesh",
    role: "parent",
    visionScore: {
      full: { realism_0to1: 0.5, clothing_0to1: 0.6, reason: "R full" },
      face: { realism_0to1: 0.45, clothing_0to1: 0.2, reason: "R face" },
      aggregateRealism_0to1: 0.48,
      aggregateClothing_0to1: 0.55,
      reason: "right",
      sourceReportPath: null,
      scoredAt: null,
      notEvidenceFor: ["aesthetic_only_not_clinical_validity"],
    },
    riggingSummary: {
      realismGrade: "B",
      boneCount: 23,
      morphTargetCount: 25,
      hasRealGarmentRegion: true,
      garmentRegionFaces: 324,
      wardrobeTags: ["scrubs", "short_sleeve"],
      skinningNormalized: true,
      claimScope: "aesthetic_structural_rigging_metadata_only_not_clinical_or_production_rig",
    },
  };

  it("computes right-minus-left score and rigging deltas", () => {
    const diff = diffPipelineCandidates(left, right);
    expect(diff.scoreDeltas.aggregateRealism).toBeCloseTo(0.23);
    expect(diff.scoreDeltas.fullRealism).toBeCloseTo(0.2);
    expect(diff.scoreDeltas.faceRealism).toBeCloseTo(0.25);
    expect(diff.riggingDeltas.boneCount).toBe(3);
    expect(diff.riggingDeltas.morphTargetCount).toBe(15);
    expect(diff.riggingDeltas.garmentRegionFaces).toBe(324);
    expect(diff.riggingDeltas.realismGrade).toEqual({ left: "C", right: "B", changed: true });
    expect(diff.riggingDeltas.hasRealGarmentRegion.changed).toBe(true);
    expect(diff.riggingDeltas.wardrobeTagsAdded).toEqual(["short_sleeve"]);
    expect(diff.riggingDeltas.wardrobeTagsRemoved).toEqual([]);
    expect(diff.claimScope).toContain("aesthetic_candidate_diff");
    expect(diff.notEvidenceFor).toEqual([...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR]);
  });

  it("returns null numeric deltas when a side is unscored", () => {
    const unscored = { ...right, visionScore: null };
    const diff = diffPipelineCandidates(left, unscored);
    expect(diff.scoreDeltas.aggregateRealism).toBeNull();
    expect(numericDelta(null, 0.5)).toBeNull();
    expect(numericDelta(0.1, 0.4)).toBeCloseTo(0.3);
  });
});
