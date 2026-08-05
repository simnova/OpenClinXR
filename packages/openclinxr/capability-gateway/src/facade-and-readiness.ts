import { type ProviderHealth, validateProviderHealth } from "@cellix/provider-contracts";
import type {
  RuntimeProfile,
  RuntimeProviderProfileKind,
  CapabilityId,
  ProviderKind,
  ImplementationLanguage,
  CapabilityTransport,
  NetworkExposure,
  CapabilityBindingStatus,
  CapabilityPlane,
  CapabilityProviderBinding,
  CapabilityRoutingMatrix,
  CapabilityRoutingReadiness,
  RuntimeProviderPlaneReadiness,
  RuntimeProviderReadinessSurface,
  ProviderGateDomain,
  ProviderGatePath,
  ProviderGateMetadata,
  RuntimeCapabilityRequest,
  RuntimeCapabilityAdapter,
} from "./types.js";
import {
  buildProviderGateMetadata,
  providerGate,
  recommendedNextActionForProviderGates,
  uniqueStrings,
  binding,
  summarizeProviderPlane,
  capabilityIdsByStatus,
  planeForCapability,
  facadeForCapability,
  executableWorkerControls,
} from "./internal.js";

export class RuntimeCapabilityFacade {
  constructor(private readonly adapters: RuntimeCapabilityAdapter[]) {}

  async health(profile: RuntimeProfile): Promise<ProviderHealth[]> {
    return Promise.all(
      this.adapters
        .filter((adapter) => adapter.binding.profile === profile)
        .map((adapter) => adapter.health()),
    );
  }

  async execute<TPayload = unknown, TResult = unknown>(
    request: RuntimeCapabilityRequest<TPayload>,
  ): Promise<TResult> {
    const adapter = await this.firstReadyAdapter(request.profile, request.capabilityId);
    return adapter.execute(request) as Promise<TResult>;
  }

  private async firstReadyAdapter(
    profile: RuntimeProfile,
    capabilityId: CapabilityId,
  ): Promise<RuntimeCapabilityAdapter> {
    for (const adapter of this.adapters) {
      if (adapter.binding.profile !== profile || adapter.binding.capabilityId !== capabilityId) {
        continue;
      }

      const health = await adapter.health();
      if (validateProviderHealth(health).ok && health.status === "ready") {
        return adapter;
      }
    }

    throw new Error(`No ready capability provider for ${profile}:${capabilityId}`);
  }
}


export function evaluateCapabilityRoutingMatrix(matrix: CapabilityRoutingMatrix): CapabilityRoutingReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const profile of matrix.profiles) {
    for (const capabilityId of matrix.requiredCapabilities) {
      const candidates = matrix.bindings.filter((binding) =>
        binding.profile === profile && binding.capabilityId === capabilityId
      );
      if (candidates.length === 0) {
        blockers.push(`missing_${profile}_${capabilityId}_binding`);
      }
    }
  }

  const directPublicBindings = matrix.bindings.filter((binding) => binding.networkExposure === "direct-public");
  for (const binding of directPublicBindings) {
    blockers.push(`direct_public_capability_endpoint_${binding.profile}_${binding.capabilityId}_${binding.providerId}`);
  }

  const executableBindings = matrix.bindings.filter((binding) => binding.executableDependencies.length > 0);
  for (const binding of executableBindings) {
    if (!["main-api-tunnel", "internal-sidecar-http", "local-executable-worker"].includes(binding.transport)) {
      blockers.push(`executable_binding_without_internal_transport_${binding.profile}_${binding.capabilityId}`);
    }
    if (binding.networkExposure === "direct-public" || binding.networkExposure === "outbound-provider-only") {
      blockers.push(`executable_binding_bad_network_exposure_${binding.profile}_${binding.capabilityId}`);
    }
    for (const control of ["async_job_queue", "sandboxed_workdir", "artifact_manifest", "license_provenance"]) {
      if (!binding.requiredControls.includes(control)) {
        blockers.push(`executable_binding_missing_${control}_${binding.profile}_${binding.capabilityId}`);
      }
    }
  }

  const localDevCloudBindings = matrix.bindings.filter((binding) =>
    binding.profile === "local-development"
    && binding.providerKind === "paid-cloud-provider"
    && binding.status !== "blocked"
  );
  for (const binding of localDevCloudBindings) {
    blockers.push(`local_development_uses_paid_cloud_provider_${binding.capabilityId}_${binding.providerId}`);
  }

  const facadeByCapability = new Map<CapabilityId, Set<string>>();
  for (const binding of matrix.bindings) {
    if (!binding.facadePackage.startsWith("@openclinxr/")) {
      blockers.push(`non_openclinxr_facade_${binding.profile}_${binding.capabilityId}_${binding.providerId}`);
    }
    const facades = facadeByCapability.get(binding.capabilityId) ?? new Set<string>();
    facades.add(binding.facadePackage);
    facadeByCapability.set(binding.capabilityId, facades);
  }

  for (const [capabilityId, facades] of facadeByCapability) {
    if (facades.size > 1) {
      warnings.push(`multiple_facades_for_${capabilityId}_${[...facades].join(",")}`);
    }
  }

  const mainApiExternalBindings = matrix.bindings.filter((binding) =>
    binding.networkExposure === "single-main-api-external"
  );
  for (const binding of mainApiExternalBindings) {
    if (!binding.endpointPath?.startsWith("/internal/capabilities/")) {
      blockers.push(`main_api_tunnel_missing_internal_endpoint_${binding.profile}_${binding.capabilityId}`);
    }
  }

  return {
    designReady: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function evaluateRuntimeProviderReadinessSurface(
  matrix: CapabilityRoutingMatrix,
  profile: RuntimeProfile,
): RuntimeProviderReadinessSurface {
  const profileBindings = matrix.bindings.filter((binding) => binding.profile === profile);
  const interactiveRuntimeBindings = profileBindings.filter((binding) => binding.plane === "interactive-runtime");
  const deterministicReplayReady = interactiveRuntimeBindings.length > 0
    && interactiveRuntimeBindings.every((binding) =>
      binding.status === "ready"
      && binding.providerKind === "deterministic-mock"
      && binding.networkExposure === "none"
    );
  const providerGates = buildProviderGateMetadata(profile, profileBindings, deterministicReplayReady);
  const liveInteractiveProviderReady = interactiveRuntimeBindings.length > 0
    && interactiveRuntimeBindings.every((binding) =>
      binding.status === "ready"
      && binding.providerKind !== "deterministic-mock"
      && binding.networkExposure !== "direct-public"
    )
    && providerGates
      .filter((gate) => gate.domain === "model-dialogue" || gate.domain === "speech" || gate.domain === "voice")
      .every((gate) => gate.liveProviderReady);
  const warnings = [
    deterministicReplayReady && !liveInteractiveProviderReady ? "deterministic_mock_only_not_live_provider_readiness" : undefined,
    ...providerGates
      .filter((gate) => !gate.liveProviderReady && gate.path !== "deterministic-replay")
      .map((gate) => `${profile}:${gate.gateId}:${gate.recommendedNextAction}`),
    ...interactiveRuntimeBindings
      .filter((binding) => binding.status !== "ready")
      .map((binding) => `${binding.profile}:${binding.capabilityId}:${binding.status}:${binding.providerId}`),
  ].filter((warning): warning is string => typeof warning === "string");

  return {
    profile,
    providerProfile: deterministicReplayReady ? "deterministic-replay" : profile,
    deterministicReplayReady,
    liveInteractiveProviderReady,
    interactiveRuntime: summarizeProviderPlane(profileBindings, "interactive-runtime"),
    assetPipeline: summarizeProviderPlane(profileBindings, "asset-pipeline"),
    persistence: summarizeProviderPlane(profileBindings, "persistence"),
    providerGates,
    recommendedNextAction: recommendedNextActionForProviderGates(providerGates),
    warnings,
  };
}

