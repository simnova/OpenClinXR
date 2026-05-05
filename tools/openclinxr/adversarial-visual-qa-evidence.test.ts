import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildAdversarialVisualQaEvidenceReport,
  evaluateAdversarialVisualQaEvidence,
  type AdversarialVisualQaEvidence,
  type AdversarialVisualQaEvidenceReport,
} from "./adversarial-visual-qa-evidence.js";

const execFileAsync = promisify(execFile);

describe("adversarial visual QA evidence evaluator", () => {
  it("accepts the current IWER screenshot as adversarial visual QA support only", () => {
    const result = evaluateAdversarialVisualQaEvidence(readyEvidence());

    expect(result).toEqual({
      readyForAdversarialVisualQaSupport: true,
      readyForProductionRuntime: false,
      readyForPhysicalQuestClaim: false,
      blockers: [],
    });
  });

  it("accepts browser, Quest CDP, and human headset media as visual QA support without physical readiness", () => {
    for (const source of ["desktop_browser", "quest_cdp", "human_worn_headset"] as const) {
      const evidence = readyEvidence({ source });
      if (source === "human_worn_headset") {
        evidence.notes = [
          "This human headset capture is for adversarial visual QA support only.",
          "Physical Quest readiness remains separate from screenshot or video evidence.",
          "Manual headset performance validation is required before production readiness claims.",
        ];
      }

      const result = evaluateAdversarialVisualQaEvidence(evidence);

      expect(result).toEqual({
        readyForAdversarialVisualQaSupport: true,
        readyForProductionRuntime: false,
        readyForPhysicalQuestClaim: false,
        blockers: [],
      });
    }
  });

  it("accepts a video artifact as adversarial visual QA support only", () => {
    const evidence = readyEvidence({
      artifactType: "video",
      artifact: "docs/openclinxr/videos/adversarial-visual-qa-fixture-2026-05-05.mp4",
      mimeType: "video/mp4",
      bytes: 2270,
      dimensions: undefined,
      captureCommand: "browser-devtools video capture fixture",
    });

    const result = evaluateAdversarialVisualQaEvidence(evidence);

    expect(result).toEqual({
      readyForAdversarialVisualQaSupport: true,
      readyForProductionRuntime: false,
      readyForPhysicalQuestClaim: false,
      blockers: [],
    });
  });

  it("rejects missing and nonexistent artifacts", () => {
    const evidence = readyEvidence();
    evidence.media![0]!.artifact = "docs/openclinxr/screenshots/not-captured.png";
    evidence.media![0]!.bytes = undefined;

    const result = evaluateAdversarialVisualQaEvidence(evidence);

    expect(result.readyForAdversarialVisualQaSupport).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "media[0].artifact_file_missing",
      "media[0].artifact_bytes_invalid_or_missing",
    ]));
  });

  it("rejects screenshot metadata that does not match the local PNG artifact", () => {
    const evidence = readyEvidence();
    evidence.media![0]!.bytes = 1;
    evidence.media![0]!.dimensions = { width: 499, height: 500 };

    const result = evaluateAdversarialVisualQaEvidence(evidence);

    expect(result.readyForAdversarialVisualQaSupport).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "media[0].artifact_bytes_do_not_match_file_size",
      "media[0].artifact_dimensions_do_not_match_png_header",
    ]));
  });

  it("rejects artifacts outside the allowed screenshot and video directories", () => {
    const screenshotEvidence = readyEvidence();
    screenshotEvidence.media![0]!.artifact = "docs/openclinxr/iwer-sidecar-agent-browser-2026-05-04.png";

    const videoEvidence = readyEvidence({
      artifactType: "video",
      artifact: "docs/openclinxr/screenshots/quest-run.mp4",
      mimeType: "video/mp4",
    });

    expect(evaluateAdversarialVisualQaEvidence(screenshotEvidence).blockers).toContain(
      "media[0].artifact_not_under_allowed_media_dir",
    );
    expect(evaluateAdversarialVisualQaEvidence(videoEvidence).blockers).toContain(
      "media[0].artifact_not_under_allowed_media_dir",
    );
  });

  it("rejects video metadata when mime type or bytes do not match the local artifact", () => {
    const evidence = readyEvidence({
      artifactType: "video",
      artifact: "docs/openclinxr/videos/adversarial-visual-qa-fixture-2026-05-05.mp4",
      mimeType: "image/png",
      bytes: 1,
      dimensions: undefined,
    });

    const result = evaluateAdversarialVisualQaEvidence(evidence);

    expect(result.readyForAdversarialVisualQaSupport).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "media[0].mime_type_invalid_for_artifact_type",
      "media[0].artifact_bytes_do_not_match_file_size",
    ]));
    expect(result.blockers).not.toEqual(expect.arrayContaining([
      "media[0].artifact_width_invalid_or_missing",
      "media[0].artifact_height_invalid_or_missing",
    ]));
  });

  it("rejects automated sources that try to claim physical Quest readiness", () => {
    const evidence = readyEvidence();
    evidence.allowedClaims = ["adversarial_visual_iteration_artifact", "physical_quest_readiness"];

    const result = evaluateAdversarialVisualQaEvidence(evidence);

    expect(result.readyForAdversarialVisualQaSupport).toBe(false);
    expect(result.readyForPhysicalQuestClaim).toBe(false);
    expect(result.blockers).toContain("unsafe_allowed_claim:physical_quest_readiness");
  });

  it("rejects human headset visual QA media that tries to claim production readiness", () => {
    const evidence = readyEvidence({ source: "human_worn_headset" });
    evidence.notes = [
      "This human headset capture is for adversarial visual QA support only.",
      "Physical Quest readiness remains separate from screenshot or video evidence.",
      "Manual headset performance validation is required before production readiness claims.",
    ];
    evidence.allowedClaims = ["adversarial_visual_iteration_artifact", "production_runtime_readiness"];

    const result = evaluateAdversarialVisualQaEvidence(evidence);

    expect(result.readyForAdversarialVisualQaSupport).toBe(false);
    expect(result.readyForProductionRuntime).toBe(false);
    expect(result.readyForPhysicalQuestClaim).toBe(false);
    expect(result.blockers).toContain("unsafe_allowed_claim:production_runtime_readiness");
  });

  it("rejects notes lacking explicit physical Quest limitation language", () => {
    const evidence = readyEvidence();
    evidence.notes = ["The screenshot should be used for adversarial UI/scene iteration only."];

    const result = evaluateAdversarialVisualQaEvidence(evidence);

    expect(result.readyForAdversarialVisualQaSupport).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "missing_limit_note:not_physical",
      "missing_limit_note:not_quest_or_headset",
      "missing_limit_note:manual_headset_required",
    ]));
  });

  it("builds a timestamped report around the adversarial evidence contract", () => {
    const report = buildAdversarialVisualQaEvidenceReport({
      generatedAt: "2026-05-05T00:00:00.000Z",
      inputFile: "docs/openclinxr/adversarial-visual-qa-evidence-iwer-sidecar-2026-05-04.json",
      evidence: readyEvidence(),
    });

    expect(report).toEqual({
      generatedAt: "2026-05-05T00:00:00.000Z",
      inputFile: "docs/openclinxr/adversarial-visual-qa-evidence-iwer-sidecar-2026-05-04.json",
      evidence: readyEvidence(),
      result: {
        readyForAdversarialVisualQaSupport: true,
        readyForProductionRuntime: false,
        readyForPhysicalQuestClaim: false,
        blockers: [],
      },
    });
  });

  it("exposes a CLI and package scripts for adversarial visual QA evidence JSON", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["visual:qa:adversarial"]).toBe(
      "tsx tools/openclinxr/adversarial-visual-qa-evidence.ts",
    );
    expect(rootPackage.scripts["visual:qa:adversarial:validate"]).toBe(
      "tsx tools/openclinxr/adversarial-visual-qa-evidence.ts --input docs/openclinxr/adversarial-visual-qa-evidence-iwer-sidecar-2026-05-04.json",
    );

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-adversarial-visual-qa-"));
    const inputPath = path.join(tempDir, "adversarial-visual-qa.json");
    const outputPath = path.join(tempDir, "adversarial-visual-qa-report.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/adversarial-visual-qa-evidence.ts", "--input", inputPath, "--output", outputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(await readFile(outputPath, "utf8")) as AdversarialVisualQaEvidenceReport;

    expect(stdout).toContain(`Wrote ${outputPath}`);
    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForAdversarialVisualQaSupport).toBe(true);
    expect(report.result.readyForProductionRuntime).toBe(false);
    expect(report.result.readyForPhysicalQuestClaim).toBe(false);
  });

  it("accepts pnpm-style argument separators before input flags", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-adversarial-visual-qa-pnpm-args-"));
    const inputPath = path.join(tempDir, "adversarial-visual-qa.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/adversarial-visual-qa-evidence.ts", "--", "--input", inputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(stdout) as AdversarialVisualQaEvidenceReport;

    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForAdversarialVisualQaSupport).toBe(true);
  });
});

function readyEvidence(
  mediaOverrides: Partial<NonNullable<AdversarialVisualQaEvidence["media"]>[number]> = {},
): AdversarialVisualQaEvidence {
  return {
    schemaVersion: "openclinxr.adversarial-visual-qa-evidence.v1",
    media: [{
      source: "iwer_emulation",
      artifactType: "screenshot",
      artifact: "docs/openclinxr/screenshots/iwer-sidecar-agent-browser-2026-05-04.png",
      mimeType: "image/png",
      bytes: 39536,
      dimensions: { width: 500, height: 500 },
      runtimeUrl: "http://127.0.0.1:5183/",
      route: "/",
      scenarioId: "ed_chest_pain_priority_v1",
      xrMode: "desktop_managed_browser_not_immersive_session",
      captureCommand: "pnpm iwsdk:iwer:evidence",
      ...mediaOverrides,
    }],
    notes: [
      "This is IWER emulation only for adversarial visual iteration.",
      "This is not physical Quest, not a headset readability pass, and not production readiness proof.",
      "Manual headset validation is required before physical Quest readiness claims.",
    ],
    notEvidenceFor: [
      "physical_quest_foreground_frame_pacing",
      "quest_controller_latency",
      "quest_hand_tracking_quality",
      "in_headset_text_readability",
      "thermal_or_battery_behavior",
      "production_runtime_readiness",
    ],
    allowedClaims: ["adversarial_visual_iteration_artifact"],
  };
}
