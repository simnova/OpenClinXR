import { type ProviderHealth, validateProviderHealth } from "@cellix/provider-contracts";

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

