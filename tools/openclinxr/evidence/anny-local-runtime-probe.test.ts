import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildAnnyLocalRuntimeProbeReport,
  validateAnnyLocalRuntimeProbeReport,
} from "./anny-local-runtime-probe.js";

describe("Anny local runtime probe", () => {
  it("exposes package scripts for local-only Anny availability probing", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:anny-runtime:probe"]).toBe("tsx tools/openclinxr/evidence/anny-local-runtime-probe.ts");
    expect(rootPackage.scripts["asset:anny-runtime:validate"]).toBe("tsx tools/openclinxr/evidence/anny-local-runtime-probe.ts --validate-latest");
  });

  it("records missing Anny as a blocker without attempting weights or provider execution", async () => {
    const report = await buildAnnyLocalRuntimeProbeReport({
      generatedAt: "2026-06-05T05:00:00.000Z",
      sourceRecord: {
        source_id: "src-anny-github-2026",
        title: "naver/anny GitHub Repository",
        claims_supported: [
          "Anny code is licensed under Apache-2.0 and uses adapted MPFB2 assets licensed CC0.",
        ],
      },
      pythonObservation: {
        executable: "/usr/bin/python3",
        version: "3.11.0",
        modules: {
          anny: { status: "missing", location: null },
          torch: { status: "available", location: "/site-packages/torch/__init__.py" },
          numpy: { status: "available", location: "/site-packages/numpy/__init__.py" },
        },
      },
    });

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.anny-local-runtime-probe.v1",
      claimScope: "local_anny_import_availability_only",
      providerBoundary: {
        localOnly: true,
        pythonOnlyImportProbe: true,
        annyForwardPassAttempted: false,
        modelWeightsLoaded: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
      },
      sourceRecord: {
        sourceId: "src-anny-github-2026",
        questRuntimeClaimSupported: false,
        animationOrClothingClaimSupported: false,
      },
      readiness: {
        status: "blocked_missing_anny_module",
        localImportAvailable: false,
        realAnnyWeightsUsed: false,
        readyForCandidateGeneration: false,
      },
    });
    expect(report.readiness.blockers).toEqual(expect.arrayContaining([
      "python_module_anny_missing",
      "real_anny_weights_manifest_not_loaded",
      "case_actor_parameters_not_bound_to_real_anny_forward_pass",
    ]));
    expect(report.notEvidenceFor).toEqual([
      "real_anny_model_output",
      "anny_forward_pass_success",
      "provider_runtime_readiness",
      "generated_asset_quality",
      "b_plus_visual_realism_gate",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ]);
    expect(validateAnnyLocalRuntimeProbeReport(report)).toEqual({ ok: true });
  });

  it("rejects reports that claim generation readiness or provider execution", async () => {
    const report = await buildAnnyLocalRuntimeProbeReport({
      pythonObservation: {
        executable: "/usr/bin/python3",
        version: "3.11.0",
        modules: {
          anny: { status: "available", location: "/site-packages/anny/__init__.py" },
          torch: { status: "available", location: "/site-packages/torch/__init__.py" },
          numpy: { status: "available", location: "/site-packages/numpy/__init__.py" },
        },
      },
      sourceRecord: {},
    });
    report.providerBoundary.annyForwardPassAttempted = true as never;
    report.providerBoundary.externalNetworkUsed = true as never;
    report.readiness.readyForCandidateGeneration = true as never;
    report.readiness.realAnnyWeightsUsed = true as never;
    report.notEvidenceFor = report.notEvidenceFor.filter((gate) => gate !== "quest_readiness") as never;

    expect(validateAnnyLocalRuntimeProbeReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/providerBoundary/annyForwardPassAttempted must be false",
        "/providerBoundary/externalNetworkUsed must be false",
        "/readiness/realAnnyWeightsUsed must be false",
        "/readiness/readyForCandidateGeneration must be false",
        "/notEvidenceFor must include quest_readiness",
      ]),
    });
  });
});
