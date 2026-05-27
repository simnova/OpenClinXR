import type { ProviderHealth } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  buildOpenClinXrCapabilityRoutingMatrix,
  evaluateCapabilityRoutingMatrix,
  evaluateRuntimeProviderReadinessSurface,
  RuntimeCapabilityFacade,
  type CapabilityProviderBinding,
  type RuntimeCapabilityAdapter,
  type RuntimeCapabilityRequest,
} from "./index.js";

describe("OpenClinXR runtime capability gateway", () => {
  it("defines provider-swappable bindings for every required capability in every runtime profile", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const readiness = evaluateCapabilityRoutingMatrix(matrix);

    expect(readiness).toMatchObject({
      designReady: true,
      blockers: [],
    });
    for (const profile of matrix.profiles) {
      for (const capabilityId of matrix.requiredCapabilities) {
        expect(matrix.bindings.some((binding) =>
          binding.profile === profile && binding.capabilityId === capabilityId
        )).toBe(true);
      }
    }
  });

  it("keeps local development on mocks, mongodb-memory-server, and local/internal workers", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const localDevelopmentBindings = matrix.bindings.filter((binding) => binding.profile === "local-development");

    expect(localDevelopmentBindings.some((binding) =>
      binding.capabilityId === "persistence" && binding.providerId === "mongodb-memory-server"
    )).toBe(true);
    expect(localDevelopmentBindings.filter((binding) => binding.providerKind === "paid-cloud-provider")).toEqual([]);
    expect(localDevelopmentBindings.filter((binding) => binding.networkExposure === "direct-public")).toEqual([]);
  });

  it("keeps Python and native executable work internal or tunneled through the main API facade", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const executableBindings = matrix.bindings.filter((binding) => binding.executableDependencies.length > 0);

    expect(executableBindings.length).toBeGreaterThan(0);
    for (const binding of executableBindings) {
      expect(["main-api-tunnel", "internal-sidecar-http", "local-executable-worker"]).toContain(binding.transport);
      expect(binding.networkExposure).not.toBe("direct-public");
      expect(binding.requiredControls).toEqual(expect.arrayContaining([
        "async_job_queue",
        "sandboxed_workdir",
        "artifact_manifest",
        "license_provenance",
      ]));
    }
  });

  it("keeps production asset-pipeline Python workers separate from interactive provider swaps", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const productionAssetPipelineBindings = matrix.bindings.filter((binding) =>
      binding.profile === "production" && binding.plane === "asset-pipeline"
    );
    const productionInteractiveBindings = matrix.bindings.filter((binding) =>
      binding.profile === "production" && binding.plane === "interactive-runtime"
    );

    expect(productionAssetPipelineBindings.length).toBeGreaterThan(0);
    expect(productionAssetPipelineBindings.every((binding) =>
      binding.facadePackage === "@openclinxr/capability-gateway"
    )).toBe(true);
    expect(productionAssetPipelineBindings.filter((binding) => binding.providerKind !== "paid-cloud-provider").every((binding) =>
      binding.transport === "main-api-tunnel" && binding.networkExposure === "single-main-api-external"
    )).toBe(true);
    expect(productionInteractiveBindings.map((binding) => binding.capabilityId)).toEqual([
      "model-dialogue",
      "scenario-generation",
      "speech-recognition",
      "voice-synthesis",
    ]);
    expect(providerFor(matrix.bindings, "production", "voice-synthesis")).toBe("grok-voice-provider");
    expect(providerFor(matrix.bindings, "production", "voice-asset-generation")).toBe("python-voice-asset-worker");
  });

  it("documents the environment provider swaps behind the same capability ids", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();

    expect(providerFor(matrix.bindings, "local-development", "voice-synthesis")).toBe("mock-voice");
    expect(providerFor(matrix.bindings, "local-production", "voice-synthesis")).toBe("local-vibevoice-provider");
    expect(providerFor(matrix.bindings, "production", "voice-synthesis")).toBe("grok-voice-provider");
    expect(providerFor(matrix.bindings, "local-development", "persistence")).toBe("mongodb-memory-server");
    expect(providerFor(matrix.bindings, "local-production", "persistence")).toBe("local-mongodb");
    expect(providerFor(matrix.bindings, "production", "persistence")).toBe("microsoft-documentdb");
  });

  it("summarizes deterministic replay readiness separately from live provider readiness", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();

    expect(evaluateRuntimeProviderReadinessSurface(matrix, "local-development")).toMatchObject({
      profile: "local-development",
      providerProfile: "deterministic-replay",
      deterministicReplayReady: true,
      liveInteractiveProviderReady: false,
      interactiveRuntime: {
        readyCapabilityIds: ["model-dialogue", "scenario-generation", "speech-recognition", "voice-synthesis"],
        notConfiguredCapabilityIds: [],
        plannedCapabilityIds: [],
        blockedCapabilityIds: [],
      },
      assetPipeline: {
        readyCapabilityIds: ["adversarial-visual-review"],
        notConfiguredCapabilityIds: [],
        plannedCapabilityIds: [
          "character-generation",
          "voice-asset-generation",
          "medical-equipment-generation",
          "animation-generation",
          "asset-bake",
        ],
        blockedCapabilityIds: ["medical-equipment-generation"],
      },
      providerGates: expect.arrayContaining([
        expect.objectContaining({
          gateId: "local-development:deterministic-replay:model-dialogue",
          path: "deterministic-replay",
          state: "ready_for_deterministic_replay",
          liveProviderReady: false,
          blockers: [],
          recommendedNextAction: "use_deterministic_replay_for_local_review",
        }),
        expect.objectContaining({
          gateId: "local-development:local/manual:asset-generation",
          path: "local/manual",
          state: "available_for_local_manual_review",
          liveProviderReady: false,
          blockers: ["manual_asset_generation_review_evidence_not_attached"],
        }),
        expect.objectContaining({
          gateId: "local-development:emulator-queue:asset-generation",
          path: "emulator-queue",
          liveProviderReady: false,
          blockers: ["azurite_or_queue_emulator_evidence_missing", "durable_job_checkpoint_evidence_missing"],
        }),
        expect.objectContaining({
          gateId: "local-development:cloud-approved:asset-generation",
          path: "cloud-approved",
          state: "blocked",
          liveProviderReady: false,
          credentialEvidencePresent: false,
          runtimeEvidencePresent: false,
        }),
      ]),
      recommendedNextAction: "attach_manual_asset_generation_review_evidence",
      warnings: expect.arrayContaining(["deterministic_mock_only_not_live_provider_readiness"]),
    });

    expect(evaluateRuntimeProviderReadinessSurface(matrix, "local-production")).toMatchObject({
      profile: "local-production",
      providerProfile: "local-production",
      deterministicReplayReady: false,
      liveInteractiveProviderReady: false,
      interactiveRuntime: {
        readyCapabilityIds: [],
        notConfiguredCapabilityIds: ["model-dialogue", "scenario-generation", "speech-recognition", "voice-synthesis"],
        plannedCapabilityIds: [],
        blockedCapabilityIds: [],
      },
      warnings: expect.arrayContaining([
        "local-production:model-dialogue:not-configured:local-qwen-or-deepseek",
        "local-production:voice-synthesis:not-configured:local-vibevoice-provider",
        "local-production:local-production:local-toolchain:asset-generation:capture_local_toolchain_runtime_evidence_before_enabling",
      ]),
    });
  });

  it("registers planned external AI asset and adversarial-review providers without enabling execution", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const providerIds = matrix.bindings.map((binding) => binding.providerId);

    expect(providerIds).toEqual(expect.arrayContaining([
      "hunyuan3d-local",
      "meshy-cloud-requires-approval",
      "tripo-cloud-requires-approval",
      "vlm-adversarial-reviewer-requires-approval",
    ]));
    expect(matrix.bindings.find((binding) => binding.providerId === "hunyuan3d-local")).toMatchObject({
      providerKind: "python-worker",
      transport: "local-executable-worker",
      networkExposure: "none",
      status: "blocked",
      requiredControls: expect.arrayContaining([
        "local_model_license_review",
        "shared_asset_library_lru_lookup",
      ]),
    });
    for (const providerId of [
      "meshy-cloud-requires-approval",
      "tripo-cloud-requires-approval",
      "vlm-adversarial-reviewer-requires-approval",
    ]) {
      expect(matrix.bindings.find((binding) => binding.providerId === providerId)).toMatchObject({
        providerKind: "paid-cloud-provider",
        transport: "outbound-provider-api",
        networkExposure: "outbound-provider-only",
        status: "blocked",
      });
    }
    expect(evaluateRuntimeProviderReadinessSurface(matrix, "production").providerGates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gateId: "production:cloud-approved:asset-generation",
        blockers: expect.arrayContaining(["meshy_tripo_vlm_provider_approval_missing"]),
      }),
    ]));
  });

  it("does not mark live provider gates ready without credentials and runtime evidence", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();

    for (const profile of matrix.profiles) {
      const surface = evaluateRuntimeProviderReadinessSurface(matrix, profile);
      expect(surface.liveInteractiveProviderReady).toBe(false);
      expect(surface.providerGates.every((gate) => gate.liveProviderReady === false)).toBe(true);
      expect(surface.providerGates.every((gate) => gate.credentialEvidencePresent === false)).toBe(true);
      expect(surface.providerGates.every((gate) => gate.runtimeEvidencePresent === false)).toBe(true);
    }

    const productionSurface = evaluateRuntimeProviderReadinessSurface(matrix, "production");
    expect(productionSurface.providerGates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gateId: "production:cloud-approved:asset-generation",
        blockers: expect.arrayContaining([
          "cloud_provider_approval_missing",
          "paid_api_budget_and_procurement_missing",
          "production_storage_evidence_missing",
        ]),
        recommendedNextAction: "complete_security_privacy_procurement_review_before_cloud_generation",
      }),
      expect.objectContaining({
        gateId: "production:stt:speech",
        path: "cloud-approved",
        state: "planned_pending_evidence",
        liveProviderReady: false,
        blockers: expect.arrayContaining(["provider_credentials_or_operator_approval_missing", "provider_runtime_evidence_missing"]),
      }),
      expect.objectContaining({
        gateId: "production:tts:voice",
        path: "cloud-approved",
        state: "planned_pending_evidence",
        liveProviderReady: false,
        blockers: expect.arrayContaining(["provider_credentials_or_operator_approval_missing", "provider_runtime_evidence_missing"]),
      }),
      expect.objectContaining({
        gateId: "production:lip-sync-timing:voice",
        blockers: expect.arrayContaining(["lip_sync_timing_evidence_missing", "viseme_phoneme_alignment_review_missing"]),
      }),
    ]));
  });

  it("reports direct public Python endpoints as architecture blockers", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const compromised = {
      ...matrix,
      bindings: matrix.bindings.map((binding) =>
        binding.profile === "production" && binding.capabilityId === "character-generation"
          ? { ...binding, networkExposure: "direct-public" as const }
          : binding
      ),
    };

    expect(evaluateCapabilityRoutingMatrix(compromised).blockers).toEqual(
      expect.arrayContaining([
        "direct_public_capability_endpoint_production_character-generation_python-character-worker",
        "executable_binding_bad_network_exposure_production_character-generation",
      ]),
    );
  });

  it("routes execution through the first ready provider for a profile and capability", async () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const modelBinding = matrix.bindings.find((binding) =>
      binding.profile === "local-development" && binding.capabilityId === "model-dialogue"
    );
    if (!modelBinding) {
      throw new Error("Missing local-development model binding");
    }
    const facade = new RuntimeCapabilityFacade([
      new StaticCapabilityAdapter({ ...modelBinding, providerId: "blocked-model" }, { providerId: "blocked-model", status: "blocked" }),
      new StaticCapabilityAdapter(modelBinding, { providerId: modelBinding.providerId, status: "ready" }, { text: "mock response" }),
    ]);

    await expect(facade.execute({
      profile: "local-development",
      capabilityId: "model-dialogue",
      payload: { learnerUtterance: "When did the pain start?" },
    })).resolves.toEqual({ text: "mock response" });
  });

  it("skips contradictory ready provider health with blockers", async () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const modelBinding = matrix.bindings.find((binding) =>
      binding.profile === "local-development" && binding.capabilityId === "model-dialogue"
    );
    if (!modelBinding) {
      throw new Error("Missing local-development model binding");
    }
    const facade = new RuntimeCapabilityFacade([
      new StaticCapabilityAdapter(
        { ...modelBinding, providerId: "contradictory-ready-model" },
        { providerId: "contradictory-ready-model", status: "ready", blockers: ["runtime_still_blocked"] },
      ),
      new StaticCapabilityAdapter(modelBinding, { providerId: modelBinding.providerId, status: "ready" }, { text: "validated mock response" }),
    ]);

    await expect(facade.execute({
      profile: "local-development",
      capabilityId: "model-dialogue",
      payload: { learnerUtterance: "When did the pain start?" },
    })).resolves.toEqual({ text: "validated mock response" });
  });
});

function providerFor(
  bindings: CapabilityProviderBinding[],
  profile: CapabilityProviderBinding["profile"],
  capabilityId: CapabilityProviderBinding["capabilityId"],
): string | undefined {
  return bindings.find((binding) =>
    binding.profile === profile && binding.capabilityId === capabilityId
  )?.providerId;
}

class StaticCapabilityAdapter implements RuntimeCapabilityAdapter {
  constructor(
    readonly binding: CapabilityProviderBinding,
    private readonly providerHealth: ProviderHealth,
    private readonly result: unknown = {},
  ) {}

  async health(): Promise<ProviderHealth> {
    return this.providerHealth;
  }

  async execute(_request: RuntimeCapabilityRequest): Promise<unknown> {
    return this.result;
  }
}
