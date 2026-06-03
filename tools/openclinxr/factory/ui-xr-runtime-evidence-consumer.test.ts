import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UiXrManualPerformanceEvidencePayload } from "./ui-xr-runtime-evidence-consumer.js";
import {
  buildUiXrRuntimeEvidenceConsumerArtifact,
  buildUiXrRuntimeEvidenceConsumerPreflightReport,
  runCli,
  validateUiXrRuntimeEvidenceConsumerArtifact,
  validateUiXrRuntimeEvidenceConsumerPreflightReport,
} from "./ui-xr-runtime-evidence-consumer.js";

describe("UI-XR runtime evidence consumer", () => {
  it("emits metadata-only attachment submit input from a UI-XR manual performance payload", () => {
    const artifact = buildUiXrRuntimeEvidenceConsumerArtifact({
      payload: uiXrPayloadFixture(),
      expectedScenarioId: "ed_chest_pain_priority_v1",
      generatedAt: "2026-05-28T15:54:00.000Z",
    });

    expect(artifact).toMatchObject({
      schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer.v1",
      generatedAt: "2026-05-28T15:54:00.000Z",
      source: "ui_xr_manual_performance_evidence_payload",
      scenarioId: "ed_chest_pain_priority_v1",
      runtimeAssetBundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
      status: "metadata_only_attachment_submit_input_ready",
      runtimeEvidenceCandidateCount: 1,
      visualQaEvidenceCandidateCount: 1,
      preflightReport: {
        schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer-preflight.v1",
        status: "consumer_ready_metadata_only",
        scenarioId: "ed_chest_pain_priority_v1",
        attachmentCount: 2,
        blockerIds: [],
        rawPayloadDisplayed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        claimBoundary: "ui_xr_consumer_preflight_metadata_only_not_runtime_visual_evidence",
      },
      adminAttachmentRouteHandoff: {
        route: "/runtime/visual-evidence-attachments",
        method: "POST",
        bodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
        rawPayloadDisplayed: false,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "ui_xr_consumer_handoff_uses_existing_metadata_attachment_route",
      },
      operatorSubmissionWorkflow: {
        status: "ready_for_guarded_attachment_route",
        sourceArtifactRef: "ui_xr_runtime_evidence_consumer_artifact",
        routeHandoffRef: "adminAttachmentRouteHandoff",
        submitBodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
        reviewerAction: "submit_metadata_only_runtime_visual_evidence_refs",
        preflightChecks: [
          "scenario_id_matches_payload_and_expected_scenario",
          "attachments_non_empty",
          "raw_payload_hidden",
          "all_execution_and_readiness_gates_false",
        ],
        nextActions: [
          "operator-select and submit up to 2 metadata-only UI-XR refs via guarded route (use operatorSelectableAttachmentCount)",
          "confirm Admin replay projection shows raw payload hidden and all readiness gates false",
          "keep runtime, learner, Quest, production, clinical, and scoring gates blocked until real runtime and visual-QA evidence clears review",
        ],
        rawPayloadDisplayed: false,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "ui_xr_operator_workflow_uses_existing_guarded_attachment_route",
      },
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "ui_xr_runtime_evidence_consumer_metadata_only_not_readiness",
    });
    expect(artifact.submitRuntimeVisualEvidenceAttachmentInput).toEqual({
      scenarioId: "ed_chest_pain_priority_v1",
      attachments: [
        expect.objectContaining({
          actionId: "attach_runtime_realism_evidence_refs",
          inputId: "runtime-realism-evidence-input:patient_robert_hayes_v1",
          inputKind: "runtime_realism_signal_input",
          evidenceRef: "ui-xr-manual-runtime-evidence://ed_chest_pain_priority_v1/patient_robert_hayes_v1",
          reviewerId: "ui_xr_manual_runtime_evidence_capture_scaffold",
          attachmentStatus: "attached_metadata_only",
        }),
        expect.objectContaining({
          actionId: "attach_visual_qa_evidence_refs",
          inputId: "visual-qa-evidence-input:patient_robert_hayes_v1",
          inputKind: "visual_qa_review_input",
          evidenceRef: "ui-xr-manual-visual-qa-evidence://ed_chest_pain_priority_v1/patient_robert_hayes_v1",
        }),
      ],
    });
    expect(artifact.submitRuntimeVisualEvidenceAttachmentInput.attachments[0]).not.toHaveProperty("runtimeExecutionAllowed");
    expect(artifact.submitRuntimeVisualEvidenceAttachmentInput.attachments[0]).not.toHaveProperty("learnerLaunchAllowed");
    expect(validateUiXrRuntimeEvidenceConsumerArtifact(artifact)).toEqual({ ok: true, errors: [] });
  });

  it("rejects scenario mismatch and true readiness gates", () => {
    expect(() =>
      buildUiXrRuntimeEvidenceConsumerArtifact({
        payload: uiXrPayloadFixture({ scenarioId: "peds_asthma_parent_anxiety_v1" }),
        expectedScenarioId: "ed_chest_pain_priority_v1",
      })
    ).toThrow("scenarioId must match expected scenario");

    expect(() =>
      buildUiXrRuntimeEvidenceConsumerArtifact({
        payload: uiXrPayloadFixture({ runtimeExecutionAllowed: true as false }),
      })
    ).toThrow("runtimeExecutionAllowed");

    const artifact = buildUiXrRuntimeEvidenceConsumerArtifact({
      payload: uiXrPayloadFixture(),
      expectedScenarioId: "ed_chest_pain_priority_v1",
    });
    expect(
      validateUiXrRuntimeEvidenceConsumerArtifact({
        ...artifact,
        operatorSubmissionWorkflow: {
          ...artifact.operatorSubmissionWorkflow,
          rawPayloadDisplayed: true,
        },
      }).errors
    ).toContain("/operatorSubmissionWorkflow/rawPayloadDisplayed must be false");
    expect(
      validateUiXrRuntimeEvidenceConsumerArtifact({
        ...artifact,
        preflightReport: {
          ...artifact.preflightReport,
          attachmentCount: 1,
        },
      }).errors
    ).toContain("/preflightReport/attachmentCount must be 2");
    expect(
      validateUiXrRuntimeEvidenceConsumerArtifact({
        ...artifact,
        operatorSubmissionWorkflow: {
          ...artifact.operatorSubmissionWorkflow,
          learnerLaunchAllowed: true,
        },
      }).errors
    ).toContain("/operatorSubmissionWorkflow/learnerLaunchAllowed must be false");
  });

  it("preflights copied UI-XR payloads before writing a consumer artifact", () => {
    const preflight = buildUiXrRuntimeEvidenceConsumerPreflightReport({
      payload: uiXrPayloadFixture(),
      expectedScenarioId: "ed_chest_pain_priority_v1",
    });
    expect(preflight).toMatchObject({
      schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer-preflight.v1",
      source: "ui_xr_manual_performance_evidence_payload",
      status: "consumer_ready_metadata_only",
      scenarioId: "ed_chest_pain_priority_v1",
      runtimeAssetBundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
      attachmentCount: 2,
      runtimeEvidenceCandidateCount: 1,
      visualQaEvidenceCandidateCount: 1,
      targetRoute: "/runtime/visual-evidence-attachments",
      submitBodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
      submitPreview: {
        route: "/runtime/visual-evidence-attachments",
        bodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
        attachmentCount: 2,
        operatorSelectableAttachmentCount: 2,
        operatorSelectionEnabled: true,
        operatorSelectionSupport: 'subset-via-count',
        actionIds: ["attach_runtime_realism_evidence_refs", "attach_visual_qa_evidence_refs"],
        inputIds: [
          "runtime-realism-evidence-input:patient_robert_hayes_v1",
          "visual-qa-evidence-input:patient_robert_hayes_v1",
        ],
        localArtifactPaths: [
          "ui-xr/manual-performance-evidence/ed_chest_pain_priority_v1/patient_robert_hayes_v1-runtime-realism.json",
          "ui-xr/manual-performance-evidence/ed_chest_pain_priority_v1/patient_robert_hayes_v1-visual-qa.json",
        ],
        rawPayloadDisplayed: false,
        claimBoundary: "ui_xr_consumer_preflight_submit_preview_metadata_only",
      },
      blockerIds: [],
      nextActions: [
        "operator-select and submit up to 2 metadata-only UI-XR refs via guarded route (use operatorSelectableAttachmentCount)",
        "confirm Admin replay projection shows raw payload hidden and all readiness gates false",
        "keep runtime, learner, Quest, production, clinical, and scoring gates blocked until real runtime and visual-QA evidence clears review",
      ],
      rawPayloadDisplayed: false,
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "ui_xr_consumer_preflight_metadata_only_not_runtime_visual_evidence",
    });
    expect(validateUiXrRuntimeEvidenceConsumerPreflightReport(preflight)).toEqual({ ok: true, errors: [] });
  });

  it("preflight reports operator-visible blockers without exposing raw payloads", () => {
    expect(buildUiXrRuntimeEvidenceConsumerPreflightReport({
      payload: { runtimeAssetBundleId: "local_exam_run:missing-scaffold" },
      expectedScenarioId: "ed_chest_pain_priority_v1",
    })).toMatchObject({
      status: "consumer_blocked",
      scenarioId: null,
      runtimeAssetBundleId: "local_exam_run:missing-scaffold",
      attachmentCount: 0,
      blockerIds: ["runtime_visual_evidence_capture_scaffold_missing"],
      rawPayloadDisplayed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
    });

    expect(buildUiXrRuntimeEvidenceConsumerPreflightReport({
      payload: uiXrPayloadFixture({ scenarioId: "peds_asthma_parent_anxiety_v1" }),
      expectedScenarioId: "ed_chest_pain_priority_v1",
    }).blockerIds).toContain("scenario_id_mismatch");

    expect(buildUiXrRuntimeEvidenceConsumerPreflightReport({
      payload: uiXrPayloadFixture({ runtimeExecutionAllowed: true as false }),
      expectedScenarioId: "ed_chest_pain_priority_v1",
    }).blockerIds).toContain("readiness_gate_true");

    expect(buildUiXrRuntimeEvidenceConsumerPreflightReport({
      payload: uiXrPayloadFixture({ attachments: [] }),
      expectedScenarioId: "ed_chest_pain_priority_v1",
    }).blockerIds).toContain("attachments_empty");
  });

  it("validates preflight report status and gate boundaries", () => {
    const preflight = buildUiXrRuntimeEvidenceConsumerPreflightReport({
      payload: uiXrPayloadFixture({ attachments: [] }),
      expectedScenarioId: "ed_chest_pain_priority_v1",
    });
    expect(validateUiXrRuntimeEvidenceConsumerPreflightReport(preflight)).toEqual({ ok: true, errors: [] });
    expect(validateUiXrRuntimeEvidenceConsumerPreflightReport({
      ...preflight,
      blockerIds: [],
    }).errors).toContain("/blockerIds must not be empty when status is consumer_blocked");
    expect(validateUiXrRuntimeEvidenceConsumerPreflightReport({
      ...preflight,
      rawPayloadDisplayed: true,
    }).errors).toContain("/rawPayloadDisplayed must be false");
    expect(validateUiXrRuntimeEvidenceConsumerPreflightReport({
      ...preflight,
      runtimeExecutionAllowed: true,
    }).errors).toContain("/runtimeExecutionAllowed must be false");
    expect(validateUiXrRuntimeEvidenceConsumerPreflightReport({
      ...preflight,
      submitPreview: {
        ...preflight.submitPreview,
        rawPayloadDisplayed: true,
      },
    }).errors).toContain("/submitPreview/rawPayloadDisplayed must be false");
    expect(validateUiXrRuntimeEvidenceConsumerPreflightReport({
      ...preflight,
      attachmentCount: 1,
      submitPreview: {
        ...preflight.submitPreview,
        actionIds: [],
      },
    }).errors).toContain("/submitPreview/actionIds must contain 1 entries");
  });

  it("writes and validates preflight reports only when an output path is explicit", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-ui-xr-preflight-"));
    const originalExitCode = process.exitCode;
    try {
      const inputPath = path.join(tempDir, "manual-payload.json");
      const preflightPath = path.join(tempDir, "consumer-preflight.json");
      const artifactPath = path.join(tempDir, "consumer-artifact.json");
      await writeFile(inputPath, `${JSON.stringify(uiXrPayloadFixture(), null, 2)}\n`, "utf8");

      await runCli([
        "--preflight",
        "--input",
        inputPath,
        "--scenario-id",
        "ed_chest_pain_priority_v1",
        "--preflight-output",
        preflightPath,
      ]);
      expect(JSON.parse(await readFile(preflightPath, "utf8"))).toMatchObject({
        schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer-preflight.v1",
        status: "consumer_ready_metadata_only",
        blockerIds: [],
        rawPayloadDisplayed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
      });

      await runCli(["--validate-preflight", preflightPath]);
      await expect(readFile(artifactPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      process.exitCode = originalExitCode;
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

function uiXrPayloadFixture(overrides: Partial<{
  scenarioId: string;
  runtimeExecutionAllowed: false;
  attachments: UiXrManualPerformanceEvidencePayload["runtimeVisualEvidenceCaptureScaffold"] extends infer Scaffold
    ? Scaffold extends { submitRuntimeVisualEvidenceAttachmentInput: { attachments: infer Attachments } }
      ? Attachments
      : never
    : never;
}> = {}): UiXrManualPerformanceEvidencePayload {
  const scenarioId = overrides.scenarioId ?? "ed_chest_pain_priority_v1";
  const runtimeExecutionAllowed = overrides.runtimeExecutionAllowed ?? false;
  return {
    runtimeAssetBundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
    runtimeVisualEvidenceCaptureScaffold: {
      schemaVersion: "openclinxr.ui-xr-runtime-visual-evidence-capture-scaffold.v1",
      source: "ui_xr_manual_performance_evidence_payload",
      scenarioId,
      runtimeAssetBundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
      status: "metadata_only_attachment_candidates_not_submitted",
      runtimeEvidenceCandidateCount: 1,
      visualQaEvidenceCandidateCount: 1,
      submitRuntimeVisualEvidenceAttachmentInput: {
        scenarioId,
        attachments: overrides.attachments ?? [
          {
            actionId: "attach_runtime_realism_evidence_refs",
            inputId: "runtime-realism-evidence-input:patient_robert_hayes_v1",
            inputKind: "runtime_realism_signal_input",
            evidenceRef: `ui-xr-manual-runtime-evidence://${scenarioId}/patient_robert_hayes_v1`,
            localArtifactPath: `ui-xr/manual-performance-evidence/${scenarioId}/patient_robert_hayes_v1-runtime-realism.json`,
            reviewerId: "ui_xr_manual_runtime_evidence_capture_scaffold",
            attachmentStatus: "attached_metadata_only",
            comments: "Metadata-only UI-XR runtime capture scaffold.",
            attachedAt: "2026-05-28T15:53:00.000Z",
          },
          {
            actionId: "attach_visual_qa_evidence_refs",
            inputId: "visual-qa-evidence-input:patient_robert_hayes_v1",
            inputKind: "visual_qa_review_input",
            evidenceRef: `ui-xr-manual-visual-qa-evidence://${scenarioId}/patient_robert_hayes_v1`,
            localArtifactPath: `ui-xr/manual-performance-evidence/${scenarioId}/patient_robert_hayes_v1-visual-qa.json`,
            reviewerId: "ui_xr_manual_runtime_evidence_capture_scaffold",
            attachmentStatus: "attached_metadata_only",
            comments: "Metadata-only UI-XR visual-QA capture scaffold.",
            attachedAt: "2026-05-28T15:53:00.000Z",
          },
        ],
      },
      providerExecutionAllowed: false,
      runtimeExecutionAllowed,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "ui_xr_capture_scaffold_not_runtime_visual_evidence",
      notEvidenceFor: [
        "provider_availability",
        "runtime_readiness",
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
        "learner_launch_readiness",
      ],
    },
  };
}
