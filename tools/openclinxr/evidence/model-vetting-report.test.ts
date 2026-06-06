import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAnnyCandidatePreflightReport } from "./anny-candidate-preflight.js";
import {
  buildModelVettingReportFromAnnyPreflight,
  validateModelVettingReport,
} from "../../../packages/openclinxr/arena/model-vetting/src/index.js";

describe("model-vetting report CLI contract", () => {
  it("exposes package scripts for report generation and validation", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:model-vetting:report"]).toBe("tsx tools/openclinxr/evidence/model-vetting-report.ts");
    expect(rootPackage.scripts["asset:model-vetting:validate"]).toBe("tsx tools/openclinxr/evidence/model-vetting-report.ts --validate-latest");
  });

  it("builds a current peds isolated model-vetting report from Anny preflight data", async () => {
    const sourceReport = await buildAnnyCandidatePreflightReport({
      generatedAt: "2026-06-05T14:00:00.000Z",
    });
    const report = buildModelVettingReportFromAnnyPreflight({
      generatedAt: "2026-06-05T14:15:00.000Z",
      sourceReport,
    });

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.model-vetting-report.v1",
      claimScope: "isolated_model_vetting_metadata_structural_and_lab_contract_only",
      sourceReport: {
        kind: "anny_candidate_preflight",
        schemaVersion: "openclinxr.anny-candidate-preflight.v1",
      },
      decision: {
        status: "blocked_before_scene",
        isolatedLabCaptureComplete: false,
        scenePlacementEvidenceAllowed: false,
        runtimePromotionAllowed: false,
        productionManifestPromotionAllowed: false,
      },
    });
    expect(report.candidates.map((candidate) => candidate.actorId)).toEqual([
      "patient_maya_johnson_v1",
      "parent_tara_johnson_v1",
      "nurse_kevin_lee_v1",
    ]);
    for (const candidate of report.candidates) {
      expect(candidate.providerBoundary.providerExecutionEnabled).toBe(false);
      expect(candidate.providerBoundary.externalNetworkUsed).toBe(false);
      expect(candidate.sourceKind).toBe("real_anny_candidate_unverified");
      expect(candidate.usesRealAnnyForwardPass).toBe(true);
      expect(candidate.falseGates.realAnny).toBe(true);
      expect(candidate.falseGates.bPlusRealism).toBe(false);
      expect(candidate.falseGates.scenePlacementReadiness).toBe(false);
      expect(candidate.falseGates.questReadiness).toBe(false);
      expect(candidate.gateResult).toBe("blocked_before_scene");
      expect(candidate.labModes.map((mode) => mode.modeId)).toEqual([
        "static_model_inspection",
        "rig_inspection",
        "morph_phoneme_inspection",
        "animation_clip_inspection",
        "material_realism_inspection",
        "optimization_inspection",
      ]);
      expect(candidate.blockers).toEqual(expect.arrayContaining([
        "fixed_camera_screenshots_missing",
        "turntable_animation_video_missing",
        "morph_viseme_timeline_capture_missing",
        "emotion_transition_capture_missing",
      ]));
      expect(candidate.nextEvidenceRequired).toContain("fixed_camera_front_side_three_quarter_lab_screenshots");
      expect(candidate.nextEvidenceRequired).toContain("deterministic_viseme_emotion_timeline_capture");
      expect(candidate.nextEvidenceRequired).toContain("visual_realism_adversary_lab_review");
    }
    expect(report.notEvidenceFor).toContain("scene_placement_readiness");
    expect(report.notEvidenceFor).toContain("quest_readiness");
    expect(report.notEvidenceFor).toContain("clinical_validity");
    expect(validateModelVettingReport(report)).toEqual({ ok: true });
  });

  it("validates disk-compatible JSON reports", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-model-vetting-"));
    const reportPath = path.join(tempDir, "model-vetting-report.json");
    try {
      const report = buildModelVettingReportFromAnnyPreflight({
        sourceReport: await buildAnnyCandidatePreflightReport(),
      });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      await expect(readFile(reportPath, "utf8").then(JSON.parse).then(validateModelVettingReport)).resolves.toEqual({ ok: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
