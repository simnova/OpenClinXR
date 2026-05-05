import { describe, expect, it } from "vitest";
import {
  evaluateAdversarialVisualQaEvidence,
  type AdversarialVisualQaEvidence,
} from "./adversarial-visual-qa-evidence.js";

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
