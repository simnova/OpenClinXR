import type { ProviderHealth } from "@openclinxr/shared-schemas";

export * from "./asset-generation-jobs.js";

export type RuntimeProfile = "local-development" | "local-production" | "production";

export type CapabilityId =
  | "model-dialogue"
  | "scenario-generation"
  | "speech-recognition"
  | "voice-synthesis"
  | "character-generation"
  | "voice-asset-generation"
  | "medical-equipment-generation"
  | "animation-generation"
  | "asset-bake"
  | "persistence"
  | "vector-index";

export type ProviderKind =
  | "deterministic-mock"
  | "local-runtime"
  | "local-database"
  | "managed-database"
  | "paid-cloud-provider"
  | "python-worker"
  | "native-executable-worker";

export type ImplementationLanguage = "typescript" | "python" | "native-executable" | "managed-service";

export type CapabilityTransport =
  | "in-process"
  | "main-api-facade"
  | "main-api-tunnel"
  | "internal-sidecar-http"
  | "local-executable-worker"
  | "outbound-provider-api";

export type NetworkExposure =
  | "none"
  | "internal-only"
  | "single-main-api-external"
  | "outbound-provider-only"
  | "direct-public";

export type CapabilityBindingStatus = "ready" | "not-configured" | "planned" | "blocked";
export type CapabilityPlane = "interactive-runtime" | "asset-pipeline" | "persistence";

export type CapabilityProviderBinding = {
  profile: RuntimeProfile;
  capabilityId: CapabilityId;
  plane: CapabilityPlane;
  providerId: string;
  providerKind: ProviderKind;
  implementationLanguage: ImplementationLanguage;
  transport: CapabilityTransport;
  networkExposure: NetworkExposure;
  facadePackage: string;
  endpointPath?: string;
  executableDependencies: string[];
  requiredControls: string[];
  status: CapabilityBindingStatus;
  notes: string;
};

export type CapabilityRoutingMatrix = {
  publicIngress: {
    strategy: "single-main-api-endpoint";
    allowedExternalEndpoint: string;
    internalServices: string[];
  };
  requiredCapabilities: CapabilityId[];
  profiles: RuntimeProfile[];
  bindings: CapabilityProviderBinding[];
};

export type CapabilityRoutingReadiness = {
  designReady: boolean;
  blockers: string[];
  warnings: string[];
};

export type RuntimeCapabilityRequest<TPayload = unknown> = {
  profile: RuntimeProfile;
  capabilityId: CapabilityId;
  payload: TPayload;
};

export interface RuntimeCapabilityAdapter<TPayload = unknown, TResult = unknown> {
  readonly binding: CapabilityProviderBinding;
  health(): Promise<ProviderHealth>;
  execute(request: RuntimeCapabilityRequest<TPayload>): Promise<TResult>;
}

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
      if (health.status === "ready") {
        return adapter;
      }
    }

    throw new Error(`No ready capability provider for ${profile}:${capabilityId}`);
  }
}

export function buildOpenClinXrCapabilityRoutingMatrix(): CapabilityRoutingMatrix {
  const requiredCapabilities: CapabilityId[] = [
    "model-dialogue",
    "scenario-generation",
    "speech-recognition",
    "voice-synthesis",
    "character-generation",
    "voice-asset-generation",
    "medical-equipment-generation",
    "animation-generation",
    "asset-bake",
    "persistence",
    "vector-index",
  ];
  const profiles: RuntimeProfile[] = ["local-development", "local-production", "production"];

  return {
    publicIngress: {
      strategy: "single-main-api-endpoint",
      allowedExternalEndpoint: "apps/api",
      internalServices: [
        "python-capability-worker",
        "asset-executable-worker",
        "local-model-runtime",
        "local-voice-runtime",
      ],
    },
    requiredCapabilities,
    profiles,
    bindings: [
      binding("local-development", "model-dialogue", "mock-model", "deterministic-mock", {
        implementationLanguage: "typescript",
        transport: "in-process",
        networkExposure: "none",
        status: "ready",
        notes: "Deterministic actor dialogue for CI and development without model downloads.",
      }),
      binding("local-development", "scenario-generation", "mock-scenario-generator", "deterministic-mock", {
        implementationLanguage: "typescript",
        transport: "in-process",
        networkExposure: "none",
        status: "ready",
        notes: "Deterministic draft generation until local or cloud models are deliberately enabled.",
      }),
      binding("local-development", "speech-recognition", "mock-transcript", "deterministic-mock", {
        implementationLanguage: "typescript",
        transport: "in-process",
        networkExposure: "none",
        status: "ready",
        notes: "Typed or fixture transcript path for repeatable station tests.",
      }),
      binding("local-development", "voice-synthesis", "mock-voice", "deterministic-mock", {
        implementationLanguage: "typescript",
        transport: "in-process",
        networkExposure: "none",
        status: "ready",
        notes: "Deterministic audio event stream with no local voice model execution.",
      }),
      binding("local-development", "character-generation", "python-character-worker", "python-worker", {
        implementationLanguage: "python",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/character-generation/jobs",
        executableDependencies: ["python", "blender"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Generates character manifests and source assets asynchronously through the main API facade.",
      }),
      binding("local-development", "voice-asset-generation", "python-voice-asset-worker", "python-worker", {
        implementationLanguage: "python",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/voice-asset-generation/jobs",
        executableDependencies: ["python", "ffmpeg"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Generates approved prerecorded voice assets, not live interactive dialogue.",
      }),
      binding("local-development", "medical-equipment-generation", "python-equipment-worker", "python-worker", {
        implementationLanguage: "python",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/medical-equipment-generation/jobs",
        executableDependencies: ["python", "blender"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Generates reviewable equipment meshes and manifests for scenario environments.",
      }),
      binding("local-development", "animation-generation", "blender-animation-worker", "native-executable-worker", {
        implementationLanguage: "native-executable",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/animation-generation/jobs",
        executableDependencies: ["blender"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Generates and retargets animation clips for actors and clinical equipment.",
      }),
      binding("local-development", "asset-bake", "blender-bake-worker", "native-executable-worker", {
        implementationLanguage: "native-executable",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/asset-bake/jobs",
        executableDependencies: ["blender", "gltf-pipeline"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Bakes and optimizes generated assets outside request handlers.",
      }),
      binding("local-development", "persistence", "mongodb-memory-server", "local-database", {
        implementationLanguage: "typescript",
        transport: "main-api-facade",
        networkExposure: "none",
        requiredControls: ["dev_only", "test_seeded", "no_external_network"],
        status: "ready",
        notes: "Ephemeral Mongo-compatible store for local tests and demos.",
      }),
      binding("local-development", "vector-index", "local-memory-vector-index", "deterministic-mock", {
        implementationLanguage: "typescript",
        transport: "in-process",
        networkExposure: "none",
        status: "ready",
        notes: "Small deterministic vector-index substitute until persistence-backed retrieval is wired.",
      }),
      binding("local-production", "model-dialogue", "local-qwen-or-deepseek", "local-runtime", {
        implementationLanguage: "typescript",
        transport: "internal-sidecar-http",
        networkExposure: "internal-only",
        requiredControls: ["explicit_model_id", "license_record", "local_benchmark", "operator_enabled"],
        status: "not-configured",
        notes: "Local Apple Silicon model runtime behind the same model gateway contract.",
      }),
      binding("local-production", "scenario-generation", "local-qwen-or-deepseek", "local-runtime", {
        implementationLanguage: "typescript",
        transport: "internal-sidecar-http",
        networkExposure: "internal-only",
        requiredControls: ["explicit_model_id", "license_record", "local_benchmark", "operator_enabled"],
        status: "not-configured",
        notes: "Uses the same local model runtime for draft scenario generation when enabled.",
      }),
      binding("local-production", "speech-recognition", "local-speech-runtime", "local-runtime", {
        implementationLanguage: "typescript",
        transport: "internal-sidecar-http",
        networkExposure: "internal-only",
        requiredControls: ["medical_vocabulary_wer", "streaming_latency_benchmark", "operator_enabled"],
        status: "not-configured",
        notes: "Local ASR can swap in without changing station runtime code.",
      }),
      binding("local-production", "voice-synthesis", "local-vibevoice-provider", "local-runtime", {
        implementationLanguage: "typescript",
        transport: "internal-sidecar-http",
        networkExposure: "internal-only",
        requiredControls: ["voice_safety_review", "first_audio_latency_benchmark", "operator_enabled"],
        status: "not-configured",
        notes: "Interactive local voice provider swaps remain behind the voice gateway and separate from asset-generation workers.",
      }),
      binding("local-production", "character-generation", "python-character-worker", "python-worker", {
        implementationLanguage: "python",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/character-generation/jobs",
        executableDependencies: ["python", "blender"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Local workstation asset generation remains asynchronous and facade-routed.",
      }),
      binding("local-production", "voice-asset-generation", "python-voice-asset-worker", "python-worker", {
        implementationLanguage: "python",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/voice-asset-generation/jobs",
        executableDependencies: ["python", "ffmpeg"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Production-like local generation of approved voice assets remains asynchronous and review-gated.",
      }),
      binding("local-production", "medical-equipment-generation", "python-equipment-worker", "python-worker", {
        implementationLanguage: "python",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/medical-equipment-generation/jobs",
        executableDependencies: ["python", "blender"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Local equipment generation can use Python and Blender while staying inside the main API facade.",
      }),
      binding("local-production", "animation-generation", "blender-animation-worker", "native-executable-worker", {
        implementationLanguage: "native-executable",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/animation-generation/jobs",
        executableDependencies: ["blender"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Local animation generation remains a batch pipeline separate from live station interaction.",
      }),
      binding("local-production", "asset-bake", "blender-bake-worker", "native-executable-worker", {
        implementationLanguage: "native-executable",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/asset-bake/jobs",
        executableDependencies: ["blender", "gltf-pipeline"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Asset baking may run on the M4 workstation but should not widen the public API surface.",
      }),
      binding("local-production", "persistence", "local-mongodb", "local-database", {
        implementationLanguage: "typescript",
        transport: "main-api-facade",
        networkExposure: "internal-only",
        requiredControls: ["connection_string_secret", "migration_check", "backup_policy"],
        status: "not-configured",
        notes: "Local durable MongoDB instance for production-like single-user runs.",
      }),
      binding("local-production", "vector-index", "local-mongodb-vector-index", "local-database", {
        implementationLanguage: "typescript",
        transport: "main-api-facade",
        networkExposure: "internal-only",
        requiredControls: ["index_versioning", "embedding_model_record", "rebuild_job"],
        status: "planned",
        notes: "Mongo-compatible vector index or adjacent local vector store behind repository contracts.",
      }),
      binding("production", "model-dialogue", "grok-reasoning-provider", "paid-cloud-provider", {
        implementationLanguage: "managed-service",
        transport: "outbound-provider-api",
        networkExposure: "outbound-provider-only",
        requiredControls: ["procurement_review", "phi_policy", "cost_budget", "model_trace_provenance"],
        status: "planned",
        notes: "Production model provider remains an outbound server-side adapter behind the model gateway.",
      }),
      binding("production", "scenario-generation", "grok-reasoning-provider", "paid-cloud-provider", {
        implementationLanguage: "managed-service",
        transport: "outbound-provider-api",
        networkExposure: "outbound-provider-only",
        requiredControls: ["procurement_review", "case_review_required", "model_trace_provenance"],
        status: "planned",
        notes: "Scenario generation output must still pass clinical, psychometric, legal, and simulation review.",
      }),
      binding("production", "speech-recognition", "grok-voice-provider", "paid-cloud-provider", {
        implementationLanguage: "managed-service",
        transport: "outbound-provider-api",
        networkExposure: "outbound-provider-only",
        requiredControls: ["procurement_review", "medical_vocabulary_wer", "transcript_redaction_policy"],
        status: "planned",
        notes: "Production STT can switch providers without touching WebXR station logic.",
      }),
      binding("production", "voice-synthesis", "grok-voice-provider", "paid-cloud-provider", {
        implementationLanguage: "managed-service",
        transport: "outbound-provider-api",
        networkExposure: "outbound-provider-only",
        requiredControls: ["procurement_review", "voice_safety_review", "latency_slo"],
        status: "planned",
        notes: "Production TTS is provider-swappable through the voice gateway.",
      }),
      binding("production", "character-generation", "python-character-worker", "python-worker", {
        implementationLanguage: "python",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/character-generation/jobs",
        executableDependencies: ["python", "blender"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Internal production worker for generated character assets and manifests.",
      }),
      binding("production", "voice-asset-generation", "python-voice-asset-worker", "python-worker", {
        implementationLanguage: "python",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/voice-asset-generation/jobs",
        executableDependencies: ["python", "ffmpeg"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Internal production worker for reviewable voice assets; live TTS remains in the voice gateway.",
      }),
      binding("production", "medical-equipment-generation", "python-equipment-worker", "python-worker", {
        implementationLanguage: "python",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/medical-equipment-generation/jobs",
        executableDependencies: ["python", "blender"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Internal production worker for medical-equipment meshes, colliders, and provenance manifests.",
      }),
      binding("production", "animation-generation", "blender-animation-worker", "native-executable-worker", {
        implementationLanguage: "native-executable",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/animation-generation/jobs",
        executableDependencies: ["blender"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Internal production worker for Speech2Motion, Mesh2Motion, retargeting, and authored animation clips.",
      }),
      binding("production", "asset-bake", "blender-bake-worker", "native-executable-worker", {
        implementationLanguage: "native-executable",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/asset-bake/jobs",
        executableDependencies: ["blender", "gltf-pipeline"],
        requiredControls: executableWorkerControls(),
        status: "planned",
        notes: "Internal asset pipeline worker; outputs versioned GLB/KTX2/meshopt artifacts.",
      }),
      binding("production", "persistence", "microsoft-documentdb", "managed-database", {
        implementationLanguage: "managed-service",
        transport: "main-api-facade",
        networkExposure: "internal-only",
        requiredControls: ["private_networking", "backup_policy", "migration_check", "audit_logging"],
        status: "planned",
        notes: "Mongo-compatible production persistence behind repository contracts.",
      }),
      binding("production", "vector-index", "documentdb-vector-index", "managed-database", {
        implementationLanguage: "managed-service",
        transport: "main-api-facade",
        networkExposure: "internal-only",
        requiredControls: ["index_versioning", "embedding_model_record", "rebuild_job", "audit_logging"],
        status: "planned",
        notes: "Production vector/retrieval index remains hidden behind repository and memory contracts.",
      }),
    ],
  };
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

function binding(
  profile: RuntimeProfile,
  capabilityId: CapabilityId,
  providerId: string,
  providerKind: ProviderKind,
  options: {
    plane?: CapabilityPlane;
    implementationLanguage: ImplementationLanguage;
    transport: CapabilityTransport;
    networkExposure: NetworkExposure;
    facadePackage?: string;
    endpointPath?: string;
    executableDependencies?: string[];
    requiredControls?: string[];
    status: CapabilityBindingStatus;
    notes: string;
  },
): CapabilityProviderBinding {
  const binding: CapabilityProviderBinding = {
    profile,
    capabilityId,
    plane: options.plane ?? planeForCapability(capabilityId),
    providerId,
    providerKind,
    implementationLanguage: options.implementationLanguage,
    transport: options.transport,
    networkExposure: options.networkExposure,
    facadePackage: options.facadePackage ?? facadeForCapability(capabilityId),
    executableDependencies: options.executableDependencies ?? [],
    requiredControls: options.requiredControls ?? [],
    status: options.status,
    notes: options.notes,
  };

  return options.endpointPath ? { ...binding, endpointPath: options.endpointPath } : binding;
}

function planeForCapability(capabilityId: CapabilityId): CapabilityPlane {
  if (
    capabilityId === "character-generation"
    || capabilityId === "voice-asset-generation"
    || capabilityId === "medical-equipment-generation"
    || capabilityId === "animation-generation"
    || capabilityId === "asset-bake"
  ) {
    return "asset-pipeline";
  }
  if (capabilityId === "persistence" || capabilityId === "vector-index") {
    return "persistence";
  }
  return "interactive-runtime";
}

function facadeForCapability(capabilityId: CapabilityId): string {
  if (capabilityId === "model-dialogue" || capabilityId === "scenario-generation") {
    return "@openclinxr/model-gateway";
  }
  if (capabilityId === "speech-recognition" || capabilityId === "voice-synthesis") {
    return "@openclinxr/voice-gateway";
  }
  if (capabilityId === "persistence" || capabilityId === "vector-index") {
    return "@openclinxr/data-mongodb";
  }
  return "@openclinxr/capability-gateway";
}

function executableWorkerControls(): string[] {
  return [
    "async_job_queue",
    "sandboxed_workdir",
    "artifact_manifest",
    "license_provenance",
    "resource_limits",
    "operator_enabled",
  ];
}
