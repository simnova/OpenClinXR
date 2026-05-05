import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildVisualQaEvidenceReport,
  type VisualQaEvidence,
  type VisualQaEvidenceReport,
} from "./visual-qa-evidence-check.js";

const execFileAsync = promisify(execFile);

describe("visual QA evidence checker", () => {
  it("accepts the captured IWER screenshot as adversarial visual QA evidence only", async () => {
    const evidence = JSON.parse(
      await readFile("docs/openclinxr/visual-qa-evidence-2026-05-04.json", "utf8"),
    ) as VisualQaEvidence;
    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-05T00:00:00.000Z",
      inputFile: "docs/openclinxr/visual-qa-evidence-2026-05-04.json",
      evidence,
    });

    expect(report.result).toEqual({
      readyForAdversarialVisualQa: true,
      readyForProductionRuntime: false,
      readyForPhysicalQuestClaim: false,
      blockers: [],
    });
    expect(report.evidence.claimBoundaries?.notEvidenceFor).toEqual(expect.arrayContaining([
      "physical_quest_foreground_frame_pacing",
      "in_headset_text_readability",
      "production_runtime_readiness",
    ]));
  });

  it("rejects missing artifact metadata, missing review dimensions, and unsafe claims", () => {
    const evidence = readyEvidence();
    evidence.capture!.artifact = "/tmp/untracked-screenshot.jpg";
    evidence.capture!.mimeType = "image/jpeg";
    evidence.capture!.dimensions = { width: 100, height: 100 };
    evidence.adversarialReview!.checks!.ui_readability = { status: "not_assessed", notes: [] };
    evidence.adversarialReview!.checks!.evidence_limits = undefined;
    evidence.claimBoundaries!.allowedClaims = ["production_runtime_readiness"];
    evidence.claimBoundaries!.notEvidenceFor = ["psychometric_validity"];

    const report = buildVisualQaEvidenceReport({
      generatedAt: "2026-05-05T00:00:00.000Z",
      evidence,
    });

    expect(report.result.readyForAdversarialVisualQa).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "artifact_not_under_docs_openclinxr_screenshots",
      "artifact_mime_type_not_png",
      "artifact_file_missing",
      "artifact_dimensions_do_not_match_png_header",
      "review_check_missing_notes:ui_readability",
      "review_check_missing:evidence_limits",
      "missing_not_evidence_for_physical_quest_foreground_frame_pacing",
      "unsafe_allowed_claim:production_runtime_readiness",
    ]));
  });

  it("exposes a CLI for scoring visual QA evidence JSON", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["visual:qa:evidence"]).toBe(
      "tsx tools/openclinxr/visual-qa-evidence-check.ts",
    );
    expect(rootPackage.scripts["visual:qa:evidence:validate"]).toBe(
      "tsx tools/openclinxr/visual-qa-evidence-check.ts --input docs/openclinxr/visual-qa-evidence-2026-05-04.json",
    );

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-visual-qa-"));
    const inputPath = path.join(tempDir, "visual-qa.json");
    const outputPath = path.join(tempDir, "visual-qa-report.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/visual-qa-evidence-check.ts", "--input", inputPath, "--output", outputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(await readFile(outputPath, "utf8")) as VisualQaEvidenceReport;

    expect(stdout).toContain(`Wrote ${outputPath}`);
    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForAdversarialVisualQa).toBe(true);
  });

  it("accepts pnpm-style argument separators before input flags", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-visual-qa-pnpm-args-"));
    const inputPath = path.join(tempDir, "visual-qa.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/visual-qa-evidence-check.ts", "--", "--input", inputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(stdout) as VisualQaEvidenceReport;

    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForAdversarialVisualQa).toBe(true);
  });
});

function readyEvidence(): VisualQaEvidence {
  return {
    schemaVersion: "openclinxr.visual-qa-evidence.v1",
    capture: {
      source: "iwer_emulation",
      artifactType: "screenshot",
      artifact: "docs/openclinxr/screenshots/iwer-sidecar-agent-browser-2026-05-04.png",
      mimeType: "image/png",
      dimensions: { width: 500, height: 500 },
      runtimeUrl: "http://127.0.0.1:5183/",
      route: "/",
      scenarioId: "ed_chest_pain_priority_v1",
      xrMode: "desktop_managed_browser_not_immersive_session",
      captureCommand: "pnpm iwsdk:iwer:evidence",
    },
    adversarialReview: {
      reviewers: [
        "test-automation-lead",
        "ux-friction-critic",
        "clinical-safety-critic",
        "xr-systems-architect",
        "asset-pipeline-lead",
      ],
      checks: {
        clinical_scene_fidelity: { status: "concern", notes: ["ED-bay intent is visible, but clinical fidelity remains placeholder-level."] },
        actor_equipment_realism: { status: "concern", notes: ["Actors and equipment should not be treated as production-realistic from this screenshot."] },
        ui_readability: { status: "pass", notes: ["The fixed-size artifact is adequate for adversarial iteration notes."] },
        interaction_affordances: { status: "concern", notes: ["The artifact alone does not prove controller or hand input affordances."] },
        occlusion_scale: { status: "concern", notes: ["Scale and occlusion need XR scene inspection and physical Quest confirmation."] },
        evidence_limits: { status: "pass", notes: ["This is IWER managed-browser evidence, not physical Quest or production readiness proof."] },
      },
    },
    claimBoundaries: {
      notEvidenceFor: [
        "physical_quest_foreground_frame_pacing",
        "quest_controller_latency",
        "quest_hand_tracking_quality",
        "in_headset_text_readability",
        "thermal_or_battery_behavior",
        "production_runtime_readiness",
      ],
      allowedClaims: ["adversarial_visual_iteration_artifact"],
    },
  };
}
