import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildAnnySkinCagematchProbeReport,
  validateAnnySkinCagematchProbeReport,
  type AnnySkinCagematchProbeReport,
} from "./anny-skin-cagematch-probe.js";

describe("Anny skin cagematch probe", () => {
  it("exposes package scripts for local-only skin cagematch probing", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:anny-skin:cagematch-probe"]).toBe("tsx tools/openclinxr/evidence/anny-skin-cagematch-probe.ts");
    expect(rootPackage.scripts["asset:anny-skin:cagematch-validate"]).toBe("tsx tools/openclinxr/evidence/anny-skin-cagematch-probe.ts --validate-latest");
  });

  it("reports ready only for a local no-promotion StableGen and ComfyUI cagematch", async () => {
    const report = await buildAnnySkinCagematchProbeReport({
      generatedAt: "2026-06-06T03:40:00.000Z",
      observations: availableObservations(),
    });

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.anny-skin-cagematch-probe.v1",
      claimScope: "local_skin_texturing_and_rigging_cagematch_availability_only",
      providerBoundary: {
        localOnly: true,
        availabilityProbeOnly: true,
        blenderExecutedForProbe: true,
        comfyStatusEndpointProbed: true,
        stableGenGenerationAttempted: false,
        comfyWorkflowQueued: false,
        diffusionWeightsLoaded: false,
        modelDownloadsUsed: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialsUsed: false,
        productionAssetReadinessClaimed: false,
      },
      readiness: {
        status: "ready_for_local_skin_texture_cagematch_without_generation",
        readyForLocalTextureCagematch: true,
        generationAllowedByThisReport: false,
      },
      notEvidenceFor: [
        "generated_skin_quality",
        "stablegen_texture_success",
        "diffusion_model_license_clearance",
        "b_plus_visual_realism_gate",
        "production_asset_readiness",
        "quest_readiness",
        "learner_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    });
    expect(report.upstreamReferences.map((reference) => reference.id)).toEqual(["stablegen", "comfyui", "cloudrig"]);
    expect(report.candidates.find((candidate) => candidate.id === "stablegen_comfyui_skin_texturing")).toMatchObject({
      status: "ready_for_local_cagematch",
      blockers: [
        "before_after_skin_texture_screenshot_plan_required",
      ],
    });
    expect(report.licensedCheckpoints["RealVisXL_V5.0_fp16.safetensors"]).toMatchObject({
      source: "https://huggingface.co/SG161222/RealVisXL_V5.0",
      license: "CreativeML Open RAIL++-M",
      placementDate: "2026-06-06",
      exists: true,
    });
    expect(validateAnnySkinCagematchProbeReport(report)).toEqual({ ok: true });
  });

  it("fails closed when generation or readiness gates are loosened", async () => {
    const report = await buildAnnySkinCagematchProbeReport({
      observations: availableObservations(),
    });

    report.providerBoundary.stableGenGenerationAttempted = true as never;
    report.providerBoundary.comfyWorkflowQueued = true as never;
    report.providerBoundary.diffusionWeightsLoaded = true as never;
    report.providerBoundary.externalNetworkUsed = true as never;
    report.providerBoundary.productionAssetReadinessClaimed = true as never;
    report.readiness.generationAllowedByThisReport = true as never;
    report.notEvidenceFor = report.notEvidenceFor.filter((gate) => gate !== "clinical_validity") as never;

    expect(validateAnnySkinCagematchProbeReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/providerBoundary/stableGenGenerationAttempted must be false",
        "/providerBoundary/comfyWorkflowQueued must be false",
        "/providerBoundary/diffusionWeightsLoaded must be false",
        "/providerBoundary/externalNetworkUsed must be false",
        "/providerBoundary/productionAssetReadinessClaimed must be false",
        "/readiness/generationAllowedByThisReport must be false",
        "/notEvidenceFor must include clinical_validity",
      ]),
    });
  });

  it("records missing local skin stack as a blocker rather than a generation plan", async () => {
    const report = await buildAnnySkinCagematchProbeReport({
      observations: {
        ...availableObservations(),
        blenderAddons: {
          stablegen: { status: "missing", moduleName: null, source: null },
          cloudrig: { status: "missing", moduleName: null, source: null },
          rigify: { status: "available", moduleName: "rigify", source: "builtin" },
        },
        comfyui: {
          status: "missing",
          url: "http://127.0.0.1:8188",
          endpoint: "/system_stats",
          responseStatus: null,
          hasSystemStats: false,
          detail: "ECONNREFUSED",
        },
      },
    });

    expect(report.readiness).toMatchObject({
      status: "blocked_missing_local_skin_generation_stack",
      readyForLocalTextureCagematch: false,
      generationAllowedByThisReport: false,
    });
    expect(report.readiness.blockers).toEqual(expect.arrayContaining([
      "stablegen_blender_addon_not_detected",
      "comfyui_local_server_not_available",
      "cloudrig_not_ready_for_rigging_cagematch",
    ]));
    expect(validateAnnySkinCagematchProbeReport(report)).toEqual({ ok: true });
  });
});

function availableObservations(): AnnySkinCagematchProbeReport["observations"] {
  return {
    blender: {
      status: "available",
      executable: "blender",
      version: "Blender 4.2.0",
      detail: null,
    },
    blenderAddons: {
      stablegen: {
        status: "available",
        moduleName: "stablegen",
        source: "/Users/patrick/Library/Application Support/Blender/4.2/scripts/addons/stablegen/__init__.py",
      },
      cloudrig: {
        status: "available",
        moduleName: "cloudrig",
        source: "/Users/patrick/Library/Application Support/Blender/4.2/scripts/addons/cloudrig/__init__.py",
      },
      rigify: {
        status: "available",
        moduleName: "rigify",
        source: "/Applications/Blender.app/Contents/Resources/4.2/scripts/addons/rigify/__init__.py",
      },
    },
    comfyui: {
      status: "available",
      url: "http://127.0.0.1:8188",
      endpoint: "/system_stats",
      responseStatus: 200,
      hasSystemStats: true,
      detail: null,
    },
    localPaths: {
      comfyUiCandidates: [{ path: "/Users/patrick/ComfyUI", exists: true }],
      blenderAddonCandidates: [{ path: "/Users/patrick/Library/Application Support/Blender/4.2/scripts/addons/stablegen", exists: true }],
    },
    cliTools: {
      fastSimplification: {
        status: "available",
        executable: "python3",
        version: null,
        detail: "/opt/homebrew/lib/python/site-packages/fast_simplification/__init__.py",
      },
      trimesh: {
        status: "available",
        executable: "python3",
        version: null,
        detail: "/opt/homebrew/lib/python/site-packages/trimesh/__init__.py",
      },
      gltfTransform: {
        status: "available",
        executable: "npx",
        version: "4.2.1",
        detail: null,
      },
    },
  };
}
