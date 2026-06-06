import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildModelVettingCaptureManifest,
  validateModelVettingCaptureManifest,
} from "./model-vetting-capture-manifest.js";

const sourceReportPath = "docs/openclinxr/model-vetting-report-peds-asthma-parent-anxiety-2026-06-05.json";
const overviewScreenshotPath = "docs/openclinxr/model-vetting-studio-peds-asthma-parent-anxiety-2026-06-05.png";

describe("model-vetting capture manifest", () => {
  it("exposes package scripts for capture manifest generation and validation", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:model-vetting:capture-manifest"]).toBe("tsx tools/openclinxr/evidence/model-vetting-capture-manifest.ts");
    expect(rootPackage.scripts["asset:model-vetting:capture-manifest:validate"]).toBe("tsx tools/openclinxr/evidence/model-vetting-capture-manifest.ts --validate-latest");
    expect(rootPackage.scripts["asset:model-vetting:turntable-capture"]).toBe("tsx tools/openclinxr/evidence/model-vetting-turntable-capture.ts");
    expect(rootPackage.scripts["asset:model-vetting:video-capture"]).toBe("tsx tools/openclinxr/evidence/model-vetting-turntable-capture.ts --capture-views turntable,viseme_timeline,emotion_transition");
  });

  it("records the studio overview separately from missing fixed-camera and video slot artifacts", async () => {
    const sourceReport = JSON.parse(await readFile(sourceReportPath, "utf8"));
    const manifest = await buildModelVettingCaptureManifest({
      generatedAt: "2026-06-05T18:30:00.000Z",
      sourceReportPath,
      sourceReport,
      overviewScreenshotPath,
    });

    expect(manifest).toMatchObject({
      schemaVersion: "openclinxr.model-vetting-capture-manifest.v1",
      claimScope: "isolated_model_vetting_capture_manifest_only",
      studioEvidence: {
        overviewScreenshotPath,
        overviewScreenshotPresent: true,
        overviewScreenshotClaim: "studio_ui_smoke_only_not_fixed_camera_or_video_slot_evidence",
      },
      decision: {
        isolatedLabCaptureComplete: false,
        scenePlacementEvidenceAllowed: false,
        runtimePromotionAllowed: false,
        productionManifestPromotionAllowed: false,
      },
      providerBoundary: {
        providerExecutionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialsRequired: false,
      },
    });
    expect(manifest.candidates.map((candidate) => candidate.actorId)).toEqual([
      "patient_maya_johnson_v1",
      "parent_tara_johnson_v1",
      "nurse_kevin_lee_v1",
    ]);
    for (const candidate of manifest.candidates) {
      expect(candidate.gateResult).toBe("blocked_before_scene");
      expect(candidate.slots).toHaveLength(6);
      expect(candidate.slots.every((slot) => slot.status === "missing")).toBe(true);
      expect(candidate.slots.every((slot) => slot.artifactPath === null)).toBe(true);
      expect(candidate.slots.every((slot) => slot.evidenceClaim === "not_captured")).toBe(true);
    }
    expect(manifest.notEvidenceFor).toContain("quest_readiness");
    expect(manifest.notEvidenceFor).toContain("clinical_validity");
    expect(validateModelVettingCaptureManifest(manifest)).toEqual({ ok: true });
  });

  it("validates disk-compatible manifest JSON without allowing scene placement promotion", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-model-vetting-capture-"));
    const manifestPath = path.join(tempDir, "manifest.json");
    try {
      const manifest = await buildModelVettingCaptureManifest({
        sourceReportPath,
        sourceReport: JSON.parse(await readFile(sourceReportPath, "utf8")),
      });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await expect(readFile(manifestPath, "utf8").then(JSON.parse).then(validateModelVettingCaptureManifest)).resolves.toEqual({ ok: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fills a capture slot only when an explicit local artifact exists", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-model-vetting-slot-"));
    const artifactPath = path.join(tempDir, "patient-front.png");
    try {
      await writeFile(artifactPath, "fixture image bytes", "utf8");
      const sourceReport = JSON.parse(await readFile(sourceReportPath, "utf8"));
      const manifest = await buildModelVettingCaptureManifest({
        sourceReportPath,
        sourceReport,
        slotArtifacts: {
          schemaVersion: "openclinxr.model-vetting-capture-artifact-map.v1",
          artifacts: [
            {
              candidateId: "peds_patient_child_anny_compatible_candidate",
              slotId: "front_screenshot",
              artifactPath,
            },
          ],
        },
      });

      const patient = manifest.candidates.find((candidate) => candidate.candidateId === "peds_patient_child_anny_compatible_candidate");
      const parent = manifest.candidates.find((candidate) => candidate.candidateId === "peds_anxious_parent_anny_compatible_candidate");
      expect(patient?.slots.find((slot) => slot.slotId === "front_screenshot")).toMatchObject({
        status: "captured",
        artifactPath,
        evidenceClaim: "isolated_lab_slot_artifact_only",
      });
      expect(patient?.slots.filter((slot) => slot.status === "captured")).toHaveLength(1);
      expect(parent?.slots.every((slot) => slot.status === "missing")).toBe(true);
      expect(manifest.decision).toMatchObject({
        isolatedLabCaptureComplete: false,
        scenePlacementEvidenceAllowed: false,
        runtimePromotionAllowed: false,
        productionManifestPromotionAllowed: false,
      });
      expect(validateModelVettingCaptureManifest(manifest)).toEqual({ ok: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects explicit slot artifacts that do not exist", async () => {
    const sourceReport = JSON.parse(await readFile(sourceReportPath, "utf8"));
    await expect(buildModelVettingCaptureManifest({
      sourceReportPath,
      sourceReport,
      slotArtifacts: {
        schemaVersion: "openclinxr.model-vetting-capture-artifact-map.v1",
        artifacts: [
          {
            candidateId: "peds_patient_child_anny_compatible_candidate",
            slotId: "front_screenshot",
            artifactPath: "docs/openclinxr/missing-patient-front.png",
          },
        ],
      },
    })).rejects.toThrow("does not exist");
  });
});
