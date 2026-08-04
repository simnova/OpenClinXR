import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  joinPromotionStatus,
  PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR,
  type PipelineCandidate,
} from "../../../packages/openclinxr/arena/model-vetting/src/pipeline-candidate.js";
import { deriveGroupAndManifest, selectLatestVisionScoreReport } from "./pipeline-candidate-index.js";

describe("deriveGroupAndManifest", () => {
  const annyRoot = "/repo/.openclinxr/asset-production/anny";
  it("derives group folder + manifest id for a nested candidate", () => {
    const result = deriveGroupAndManifest(
      path.join(annyRoot, "photoreal-skin-rung-2026-08-03", "nurse_winner.glb"),
      annyRoot,
    );
    expect(result.group).toBe("photoreal-skin-rung-2026-08-03");
    expect(result.manifestId).toBe("nurse_winner");
  });
  it("handles a glb directly under the root", () => {
    const result = deriveGroupAndManifest(path.join(annyRoot, "loose.glb"), annyRoot);
    expect(result.group).toBe("(root)");
    expect(result.manifestId).toBe("loose");
  });
});

describe("selectLatestVisionScoreReport", () => {
  it("picks the newest dated report", () => {
    expect(
      selectLatestVisionScoreReport([
        "humanoid-vision-score-2026-08-01.json",
        "humanoid-vision-score-2026-08-03.json",
        "humanoid-vision-score-2026-08-02.json",
        "unrelated.json",
      ]),
    ).toBe("humanoid-vision-score-2026-08-03.json");
  });
  it("returns null when none match", () => {
    expect(selectLatestVisionScoreReport(["other.json"])).toBeNull();
  });
});

describe("promotion-status join (index builder)", () => {
  const candidate: PipelineCandidate = {
    candidateId: "pilot-demo/peds_nurse_kevin",
    group: "pilot-demo",
    manifestId: "peds_nurse_kevin",
    role: "nurse",
    glbPath: ".openclinxr/asset-production/anny/pilot-demo/peds_nurse_kevin.glb",
    sizeBytes: 100,
    modifiedAt: "2026-08-03T00:00:00.000Z",
    visionScore: null,
    riggingSummary: null,
    thumbnailPath: null,
    notEvidenceFor: [...PIPELINE_CANDIDATE_NOT_EVIDENCE_FOR],
  };

  it("sets promotion from promotions index (newest first)", () => {
    const joined = joinPromotionStatus([candidate], {
      promotions: [
        {
          candidateId: "pilot-demo/peds_nurse_kevin",
          promotedAt: "2026-08-03T22:00:00.000Z",
          promotedBy: "faculty_reviewer",
          recordPath: ".openclinxr/asset-production/promotions/a.json",
        },
      ],
    });
    expect(joined[0]?.promotion?.promoted).toBe(true);
    expect(joined[0]?.promotion?.promotedBy).toBe("faculty_reviewer");
    expect(joined[0]?.promotion?.recordPath).toContain("promotions");
  });

  it("sets promotion null when index absent", () => {
    expect(joinPromotionStatus([candidate], null)[0]?.promotion).toBeNull();
  });
});
