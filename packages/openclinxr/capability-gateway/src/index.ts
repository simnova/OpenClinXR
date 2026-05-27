import { validateProviderHealth, type ProviderHealth } from "@openclinxr/shared-schemas";

export * from "./asset-generation-jobs.js";
export * from "./azure-storage-queue-client.js";

export type RuntimeProfile = "local-development" | "local-production" | "production";
export type RuntimeProviderProfileKind = "deterministic-replay" | RuntimeProfile;

export type CapabilityId =
  | "model-dialogue"
  | "scenario-generation"
  | "speech-recognition"
  | "voice-synthesis"
  | "adversarial-visual-review"
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

export type RuntimeProviderPlaneReadiness = {
  readyCapabilityIds: CapabilityId[];
  notConfiguredCapabilityIds: CapabilityId[];
  plannedCapabilityIds: CapabilityId[];
  blockedCapabilityIds: CapabilityId[];
};

export type RuntimeProviderReadinessSurface = {
  profile: RuntimeProfile;
  providerProfile: RuntimeProviderProfileKind;
  deterministicReplayReady: boolean;
  liveInteractiveProviderReady: boolean;
  interactiveRuntime: RuntimeProviderPlaneReadiness;
  assetPipeline: RuntimeProviderPlaneReadiness;
  persistence: RuntimeProviderPlaneReadiness;
  providerGates: ProviderGateMetadata[];
  recommendedNextAction: string;
  warnings: string[];
};

export type ProviderGateDomain =
  | "model-dialogue"
  | "speech"
  | "voice"
  | "asset-generation";

export type ProviderGatePath =
  | "deterministic-replay"
  | "local/manual"
  | "local-toolchain"
  | "emulator-queue"
  | "cloud-approved"
  | "blocked";

export type ProviderGateMetadata = {
  gateId: string;
  domain: ProviderGateDomain;
  path: ProviderGatePath;
  capabilityIds: CapabilityId[];
  state: "ready_for_deterministic_replay" | "available_for_local_manual_review" | "planned_pending_evidence" | "blocked";
  liveProviderReady: boolean;
  credentialEvidencePresent: boolean;
  runtimeEvidencePresent: boolean;
  blockers: string[];
  recommendedNextAction: string;
  claimBoundary: "provider_gate_metadata_not_live_provider_readiness";
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
      if (validateProviderHealth(health).ok && health.status === "ready") {
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
    "adversarial-visual-review",
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
      binding("local-development", "adversarial-visual-review", "deterministic-visual-reviewer", "deterministic-mock", {
        implementationLanguage: "typescript",
        transport: "in-process",
        networkExposure: "none",
        status: "ready",
        notes: "Deterministic visual-review fixtures convert known screenshot findings into remediation refs without external models.",
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
      binding("local-development", "medical-equipment-generation", "hunyuan3d-local", "python-worker", {
        implementationLanguage: "python",
        transport: "local-executable-worker",
        networkExposure: "none",
        executableDependencies: ["python", "blender"],
        requiredControls: [...executableWorkerControls(), "local_model_license_review", "shared_asset_library_lru_lookup"],
        status: "blocked",
        notes: "Planned local/open-source Hunyuan3D trial route for non-humanoid equipment and room props; disabled until install, license, cache, and runtime evidence exist.",
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
      binding("local-production", "adversarial-visual-review", "local-vlm-adversarial-reviewer", "local-runtime", {
        implementationLanguage: "typescript",
        transport: "internal-sidecar-http",
        networkExposure: "internal-only",
        requiredControls: ["model_license_review", "screenshot_video_evidence_policy", "operator_enabled", "claim_boundary_enforced"],
        status: "not-configured",
        notes: "Local VLM adversarial reviewer candidate for screenshots/videos; no model execution until local model evidence and policy controls exist.",
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
      binding("local-production", "medical-equipment-generation", "hunyuan3d-local", "python-worker", {
        implementationLanguage: "python",
        transport: "local-executable-worker",
        networkExposure: "none",
        executableDependencies: ["python", "blender"],
        requiredControls: [...executableWorkerControls(), "local_model_license_review", "shared_asset_library_lru_lookup"],
        status: "blocked",
        notes: "Local Hunyuan3D route for reusable equipment/room prop generation; disabled until installation, license, cache, and runtime evidence are attached.",
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
      binding("production", "adversarial-visual-review", "vlm-adversarial-reviewer-requires-approval", "paid-cloud-provider", {
        implementationLanguage: "managed-service",
        transport: "outbound-provider-api",
        networkExposure: "outbound-provider-only",
        requiredControls: ["procurement_review", "phi_policy", "cost_budget", "screenshot_video_redaction", "claim_boundary_enforced"],
        status: "blocked",
        notes: "Cloud VLM adversarial review candidate for screenshot/video realism critique; blocked until explicit approval, privacy review, and cost controls.",
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
      binding("production", "character-generation", "meshy-cloud-requires-approval", "paid-cloud-provider", {
        implementationLanguage: "managed-service",
        transport: "outbound-provider-api",
        networkExposure: "outbound-provider-only",
        requiredControls: ["procurement_review", "paid_api_budget", "asset_license_review", "credential_secret", "shared_asset_library_lru_lookup", "human_review_before_learner_use"],
        status: "blocked",
        notes: "Meshy cloud candidate for humanoid mesh/rigging/basic animation experiments; blocked until explicit approval, credentials, budget, and license review.",
      }),
      binding("production", "character-generation", "tripo-cloud-requires-approval", "paid-cloud-provider", {
        implementationLanguage: "managed-service",
        transport: "outbound-provider-api",
        networkExposure: "outbound-provider-only",
        requiredControls: ["procurement_review", "paid_api_budget", "asset_license_review", "credential_secret", "shared_asset_library_lru_lookup", "human_review_before_learner_use"],
        status: "blocked",
        notes: "Tripo cloud candidate for fast draft props/reference-image-to-3D comparisons; blocked until explicit approval and license/cost controls.",
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
      binding("production", "medical-equipment-generation", "hunyuan3d-local-or-managed-requires-review", "python-worker", {
        implementationLanguage: "python",
        transport: "main-api-tunnel",
        networkExposure: "single-main-api-external",
        endpointPath: "/internal/capabilities/medical-equipment-generation/jobs/hunyuan3d",
        executableDependencies: ["python", "blender"],
        requiredControls: [...executableWorkerControls(), "model_license_review", "shared_asset_library_lru_lookup", "human_review_before_learner_use"],
        status: "blocked",
        notes: "Hunyuan3D candidate for reusable medical equipment/room prop generation; blocked until license, runtime, and deployment posture are reviewed.",
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

function buildProviderGateMetadata(
  profile: RuntimeProfile,
  bindings: readonly CapabilityProviderBinding[],
  deterministicReplayReady: boolean,
): ProviderGateMetadata[] {
  const capabilityStatus = (capabilityId: CapabilityId): CapabilityBindingStatus =>
    bindings.find((binding) => binding.capabilityId === capabilityId)?.status ?? "blocked";
  const liveBlockers = (capabilityIds: CapabilityId[], extraBlockers: string[] = []) => uniqueStrings([
    ...capabilityIds.map((capabilityId) => `${profile}:${capabilityId}:${capabilityStatus(capabilityId)}`),
    "provider_credentials_or_operator_approval_missing",
    "provider_runtime_evidence_missing",
    ...extraBlockers,
  ]);
  const deterministicBlockers = deterministicReplayReady ? [] : ["deterministic_replay_bindings_not_ready"];

  return [
    providerGate({
      gateId: `${profile}:deterministic-replay:model-dialogue`,
      domain: "model-dialogue",
      path: "deterministic-replay",
      capabilityIds: ["model-dialogue", "scenario-generation"],
      state: deterministicReplayReady ? "ready_for_deterministic_replay" : "blocked",
      blockers: deterministicBlockers,
      recommendedNextAction: deterministicReplayReady ? "use_deterministic_replay_for_local_review" : "restore_deterministic_mock_bindings",
    }),
    providerGate({
      gateId: `${profile}:local/manual:asset-generation`,
      domain: "asset-generation",
      path: "local/manual",
      capabilityIds: ["character-generation", "voice-asset-generation", "medical-equipment-generation", "animation-generation", "asset-bake"],
      state: "available_for_local_manual_review",
      blockers: ["manual_asset_generation_review_evidence_not_attached"],
      recommendedNextAction: "attach_manual_asset_generation_review_evidence",
    }),
    providerGate({
      gateId: `${profile}:local-toolchain:asset-generation`,
      domain: "asset-generation",
      path: "local-toolchain",
      capabilityIds: ["character-generation", "voice-asset-generation", "medical-equipment-generation", "animation-generation", "asset-bake"],
      state: "planned_pending_evidence",
      blockers: liveBlockers(["character-generation", "voice-asset-generation", "medical-equipment-generation", "animation-generation", "asset-bake"], [
        "local_blender_ffmpeg_toolchain_evidence_missing",
        "hunyuan3d_local_install_license_cache_evidence_missing",
        "shared_asset_library_lru_reuse_evidence_missing",
      ]),
      recommendedNextAction: "capture_local_toolchain_runtime_evidence_before_enabling",
    }),
    providerGate({
      gateId: `${profile}:emulator-queue:asset-generation`,
      domain: "asset-generation",
      path: "emulator-queue",
      capabilityIds: ["character-generation", "voice-asset-generation", "medical-equipment-generation", "animation-generation", "asset-bake"],
      state: "planned_pending_evidence",
      blockers: ["azurite_or_queue_emulator_evidence_missing", "durable_job_checkpoint_evidence_missing"],
      recommendedNextAction: "run_local_queue_emulator_contract_and_attach_evidence",
    }),
    providerGate({
      gateId: `${profile}:cloud-approved:asset-generation`,
      domain: "asset-generation",
      path: "cloud-approved",
      capabilityIds: ["character-generation", "voice-asset-generation", "medical-equipment-generation", "animation-generation", "asset-bake"],
      state: "blocked",
      blockers: ["cloud_provider_approval_missing", "paid_api_budget_and_procurement_missing", "production_storage_evidence_missing", "meshy_tripo_vlm_provider_approval_missing"],
      recommendedNextAction: "complete_security_privacy_procurement_review_before_cloud_generation",
    }),
    providerGate({
      gateId: `${profile}:blocked:asset-generation`,
      domain: "asset-generation",
      path: "blocked",
      capabilityIds: ["character-generation", "voice-asset-generation", "medical-equipment-generation", "animation-generation", "asset-bake"],
      state: "blocked",
      blockers: ["live_asset_generation_disabled_by_default"],
      recommendedNextAction: "keep_live_asset_generation_disabled_until_named_gate_evidence_exists",
    }),
    providerGate({
      gateId: `${profile}:stt:speech`,
      domain: "speech",
      path: profile === "local-development" ? "deterministic-replay" : profile === "production" ? "cloud-approved" : "local-toolchain",
      capabilityIds: ["speech-recognition"],
      state: profile === "local-development" && deterministicReplayReady ? "ready_for_deterministic_replay" : "planned_pending_evidence",
      blockers: profile === "local-development" && deterministicReplayReady ? [] : liveBlockers(["speech-recognition"], ["stt_medical_vocabulary_evidence_missing"]),
      recommendedNextAction: profile === "local-development" && deterministicReplayReady ? "use_fixture_transcripts_for_replay" : "attach_stt_latency_and_medical_vocabulary_evidence",
    }),
    providerGate({
      gateId: `${profile}:tts:voice`,
      domain: "voice",
      path: profile === "local-development" ? "deterministic-replay" : profile === "production" ? "cloud-approved" : "local-toolchain",
      capabilityIds: ["voice-synthesis"],
      state: profile === "local-development" && deterministicReplayReady ? "ready_for_deterministic_replay" : "planned_pending_evidence",
      blockers: profile === "local-development" && deterministicReplayReady ? [] : liveBlockers(["voice-synthesis"], ["tts_latency_safety_evidence_missing"]),
      recommendedNextAction: profile === "local-development" && deterministicReplayReady ? "use_mock_voice_events_for_replay" : "attach_tts_latency_and_voice_safety_evidence",
    }),
    providerGate({
      gateId: `${profile}:emotional-prosody:voice`,
      domain: "voice",
      path: "blocked",
      capabilityIds: ["voice-synthesis"],
      state: "blocked",
      blockers: ["emotional_prosody_clinical_review_missing", "prosody_safety_evidence_missing"],
      recommendedNextAction: "review_emotional_prosody_policy_before_enabling",
    }),
    providerGate({
      gateId: `${profile}:lip-sync-timing:voice`,
      domain: "voice",
      path: "blocked",
      capabilityIds: ["voice-synthesis", "animation-generation"],
      state: "blocked",
      blockers: ["lip_sync_timing_evidence_missing", "viseme_phoneme_alignment_review_missing"],
      recommendedNextAction: "attach_lip_sync_timing_and_viseme_alignment_evidence",
    }),
  ];
}

function providerGate(input: Omit<ProviderGateMetadata, "liveProviderReady" | "credentialEvidencePresent" | "runtimeEvidencePresent" | "claimBoundary">): ProviderGateMetadata {
  return {
    ...input,
    liveProviderReady: false,
    credentialEvidencePresent: false,
    runtimeEvidencePresent: false,
    claimBoundary: "provider_gate_metadata_not_live_provider_readiness",
  };
}

function recommendedNextActionForProviderGates(gates: readonly ProviderGateMetadata[]): string {
  return gates.find((gate) => gate.blockers.length > 0 && gate.path !== "deterministic-replay")?.recommendedNextAction
    ?? "continue_deterministic_replay_without_live_provider_claims";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
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

function summarizeProviderPlane(
  bindings: readonly CapabilityProviderBinding[],
  plane: CapabilityPlane,
): RuntimeProviderPlaneReadiness {
  const planeBindings = bindings.filter((binding) => binding.plane === plane);

  return {
    readyCapabilityIds: capabilityIdsByStatus(planeBindings, "ready"),
    notConfiguredCapabilityIds: capabilityIdsByStatus(planeBindings, "not-configured"),
    plannedCapabilityIds: capabilityIdsByStatus(planeBindings, "planned"),
    blockedCapabilityIds: capabilityIdsByStatus(planeBindings, "blocked"),
  };
}

function capabilityIdsByStatus(
  bindings: readonly CapabilityProviderBinding[],
  status: CapabilityBindingStatus,
): CapabilityId[] {
  return bindings
    .filter((binding) => binding.status === status)
    .map((binding) => binding.capabilityId);
}

function planeForCapability(capabilityId: CapabilityId): CapabilityPlane {
  if (
    capabilityId === "adversarial-visual-review"
    || capabilityId === "character-generation"
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
