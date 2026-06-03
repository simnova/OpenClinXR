import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractRuntimeAssetReviewDecisions,
  runSceneGenerationReviewDecisionExportCli,
} from "./scene-generation-review-decision-export.js";

describe("scene generation review decision export", () => {
  it("extracts runtime asset review decisions from a request queue", () => {
    expect(extractRuntimeAssetReviewDecisions(requestQueue(), "scene_generation_request:ed_chest_pain_priority_v1:local-admin")).toEqual([
      expect.objectContaining({
        assetId: "generated_patient_robert_hayes_humanoid_glb",
        reviewerRole: "asset_pipeline",
        decision: "approved_for_local_runtime",
      }),
    ]);
  });

  it("writes CLI decision array and export report", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-review-export-"));
    try {
      const inputPath = path.join(tempDir, "request-queue.json");
      const outputPath = path.join(tempDir, "runtime-asset-review-decisions.json");
      const reportPath = path.join(tempDir, "export-report.json");
      await writeFile(inputPath, `${JSON.stringify(requestQueue(), null, 2)}\n`, "utf8");

      await runSceneGenerationReviewDecisionExportCli([
        "--input", inputPath,
        "--request-id", "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
        "--output", outputPath,
        "--report", reportPath,
      ]);

      await expect(readFile(outputPath, "utf8").then(JSON.parse)).resolves.toEqual([
        expect.objectContaining({ assetId: "generated_patient_robert_hayes_humanoid_glb" }),
      ]);
      await expect(readFile(reportPath, "utf8").then(JSON.parse)).resolves.toMatchObject({
        schemaVersion: "openclinxr.scene-generation-review-decision-export.v1",
        decisionCount: 1,
        claimBoundary: "runtime_asset_review_decision_export_not_bundle_publication",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function requestQueue() {
  return {
    requestCount: 1,
    requests: [
      {
        requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
        runtimeAssetReviewDecisions: [
          {
            assetId: "generated_patient_robert_hayes_humanoid_glb",
            reviewerRole: "asset_pipeline",
            reviewerId: "admin_asset_pipeline_reviewer",
            decision: "approved_for_local_runtime",
            comments: "Local runtime evidence attached.",
            evidenceRefs: ["scene_generation_request:ed_chest_pain_priority_v1:local-admin:asset_pipeline"],
            reviewedAt: "2026-05-23T00:00:00.000Z",
          },
        ],
      },
    ],
  };
}
