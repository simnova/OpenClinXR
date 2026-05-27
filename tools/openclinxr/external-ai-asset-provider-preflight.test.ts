import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExternalAiAssetProviderPreflightReport,
  validateExternalAiAssetProviderPreflightReport,
} from "./external-ai-asset-provider-preflight.js";

describe("external AI asset provider preflight", () => {
  it("documents provider candidates without enabling execution", () => {
    const report = buildExternalAiAssetProviderPreflightReport({
      generatedAt: "2026-05-25T10:30:00.000Z",
    });

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.external-ai-asset-provider-preflight.v1",
      claimScope: "provider_preflight_metadata_only_no_execution",
      providerGate: {
        status: "blocked_until_operator_approval_and_runtime_evidence",
        evidenceKind: "external_ai_provider_preflight_metadata",
        executionEnabled: false,
        externalProviderExecutionAttempted: false,
        reportMetadataOnly: true,
        surfacedInProviderGateReport: true,
      },
      recommendedRouting: {
        humanoidMeshAndRig: ["meshy_cloud_requires_approval", "hunyuan3d_local", "blender_mixamo_style_rigging_fallback"],
        equipmentAndProps: ["hunyuan3d_local", "meshy_cloud_requires_approval", "tripo_cloud_requires_approval"],
        adversarialReview: ["local_open_vlm_if_available", "frontier_cloud_vlm_requires_approval", "deterministic_fixture"],
      },
      handoff: {
        providerDisabledBoundary: "No external provider execution: keep executionEnabled false, do not request credentials, and do not use paid APIs or network calls.",
        localOnlyBoundary: "Offline/local metadata review only: restrict work to workspace evidence, deterministic fixtures, and local registry checks.",
        missingEvidenceIds: [
          "hunyuan3d_not_installed",
          "model_license_review_missing",
          "runtime_smoke_evidence_missing",
          "explicit_operator_approval_missing",
          "credential_secret_missing",
          "paid_api_budget_missing",
          "asset_license_review_missing",
          "approved_vlm_route_missing",
          "screenshot_video_redaction_policy_missing",
        ],
        nextSafeProviderDisabledExecutionStep: "Assemble the local evidence bundle for hunyuan3d_local and the approval-gated cloud candidates, then re-run this preflight in metadata-only mode without invoking any provider.",
      },
      notEvidenceFor: [
        "provider_runtime_readiness",
        "generated_asset_quality",
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    });
    expect(report.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: "hunyuan3d_local",
        executionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        requiredControls: expect.arrayContaining(["shared_asset_library_lru_lookup", "local_install_evidence"]),
      }),
      expect.objectContaining({
        providerId: "meshy_cloud_requires_approval",
        executionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialRequiredBeforeExecution: true,
        blockers: expect.arrayContaining(["explicit_operator_approval_missing", "paid_api_budget_missing"]),
      }),
      expect.objectContaining({
        providerId: "tripo_cloud_requires_approval",
        executionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialRequiredBeforeExecution: true,
        intendedTargets: expect.arrayContaining(["equipment_comparison"]),
      }),
      expect.objectContaining({
        providerId: "vlm_adversarial_reviewer_requires_approval",
        executionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialRequiredBeforeExecution: true,
        intendedTargets: expect.arrayContaining(["aaa_realism_gap_detection"]),
      }),
    ]));
    expect(validateExternalAiAssetProviderPreflightReport(report)).toEqual({ ok: true });
  });

  it("rejects preflight reports that enable external execution", () => {
    const report = buildExternalAiAssetProviderPreflightReport();
    report.candidates[1].executionEnabled = true as never;
    report.candidates[1].paidApiUsed = true as never;
    report.providerGate.executionEnabled = true as never;
    report.providerGate.externalProviderExecutionAttempted = true as never;
    report.recommendedRouting.humanoidMeshAndRig = ["hunyuan3d_local", "meshy_cloud_requires_approval", "blender_mixamo_style_rigging_fallback"] as never;

    expect(validateExternalAiAssetProviderPreflightReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/candidates/1/executionEnabled must be false",
        "/candidates/1/paidApiUsed must be false",
        "/providerGate/executionEnabled must be false",
        "/providerGate/externalProviderExecutionAttempted must be false",
        "/recommendedRouting/humanoidMeshAndRig must start with meshy_cloud_requires_approval",
      ]),
    });
  });

  it("rejects provider-disabled planning surfaces that drift from the exact handoff boundary and missing evidence IDs", () => {
    const report = buildExternalAiAssetProviderPreflightReport();
    report.handoff.providerDisabledBoundary = "changed boundary" as never;
    report.handoff.localOnlyBoundary = "changed local-only boundary" as never;
    report.handoff.missingEvidenceIds = [
      "hunyuan3d_not_installed",
      "model_license_review_missing",
      "runtime_smoke_evidence_missing",
      "explicit_operator_approval_missing",
      "credential_secret_missing",
      "paid_api_budget_missing",
      "asset_license_review_missing",
      "approved_vlm_route_missing",
    ] as never;
    report.handoff.nextSafeProviderDisabledExecutionStep = "changed next step" as never;

    expect(validateExternalAiAssetProviderPreflightReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/handoff/providerDisabledBoundary must be \"No external provider execution: keep executionEnabled false, do not request credentials, and do not use paid APIs or network calls.\"",
        "/handoff/localOnlyBoundary must be \"Offline/local metadata review only: restrict work to workspace evidence, deterministic fixtures, and local registry checks.\"",
        "/handoff/missingEvidenceIds must equal [\"hunyuan3d_not_installed\",\"model_license_review_missing\",\"runtime_smoke_evidence_missing\",\"explicit_operator_approval_missing\",\"credential_secret_missing\",\"paid_api_budget_missing\",\"asset_license_review_missing\",\"approved_vlm_route_missing\",\"screenshot_video_redaction_policy_missing\"]",
        "/handoff/nextSafeProviderDisabledExecutionStep must be \"Assemble the local evidence bundle for hunyuan3d_local and the approval-gated cloud candidates, then re-run this preflight in metadata-only mode without invoking any provider.\"",
      ]),
    });
  });

  it("validates reports from disk", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-external-ai-preflight-"));
    const reportPath = path.join(tempDir, "external-ai-asset-provider-preflight.json");
    try {
      await writeFile(reportPath, `${JSON.stringify(buildExternalAiAssetProviderPreflightReport(), null, 2)}\n`, "utf8");
      await expect(readFile(reportPath, "utf8").then(JSON.parse).then(validateExternalAiAssetProviderPreflightReport)).resolves.toEqual({ ok: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps the checked-in handoff doc aligned with the built report contract", async () => {
    const docPath = path.join(process.cwd(), "docs/openclinxr/external-ai-asset-provider-preflight-2026-05-25.json");
    const docReport = JSON.parse(await readFile(docPath, "utf8")) as unknown;

    expect(validateExternalAiAssetProviderPreflightReport(docReport)).toEqual({ ok: true });
    expect(docReport).toMatchObject({
      handoff: {
        providerDisabledBoundary: "No external provider execution: keep executionEnabled false, do not request credentials, and do not use paid APIs or network calls.",
        localOnlyBoundary: "Offline/local metadata review only: restrict work to workspace evidence, deterministic fixtures, and local registry checks.",
        missingEvidenceIds: [
          "hunyuan3d_not_installed",
          "model_license_review_missing",
          "runtime_smoke_evidence_missing",
          "explicit_operator_approval_missing",
          "credential_secret_missing",
          "paid_api_budget_missing",
          "asset_license_review_missing",
          "approved_vlm_route_missing",
          "screenshot_video_redaction_policy_missing",
        ],
        nextSafeProviderDisabledExecutionStep: "Assemble the local evidence bundle for hunyuan3d_local and the approval-gated cloud candidates, then re-run this preflight in metadata-only mode without invoking any provider.",
      },
    });
  });
});
