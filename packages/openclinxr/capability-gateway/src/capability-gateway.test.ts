import type { ProviderHealth } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  buildOpenClinXrCapabilityRoutingMatrix,
  evaluateCapabilityRoutingMatrix,
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
    expect(productionAssetPipelineBindings.every((binding) =>
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
