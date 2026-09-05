export type AdminNoReadinessEvidenceClaim =
  | "provider_availability"
  | "runtime_readiness"
  | "production_asset_readiness"
  | "quest_readiness"
  | "clinical_validity"
  | "scoring_validity"
  | "learner_launch_readiness";

export type AdminRuntimeProviderPlaneReadiness = {
  readyCapabilityIds: string[];
  notConfiguredCapabilityIds: string[];
  plannedCapabilityIds: string[];
  blockedCapabilityIds: string[];
};

export type AdminRuntimeProviderReadinessSurface = {
  profile: string;
  providerProfile?: string;
  deterministicReplayReady: boolean;
  liveInteractiveProviderReady: boolean;
  interactiveRuntime: AdminRuntimeProviderPlaneReadiness;
  assetPipeline: AdminRuntimeProviderPlaneReadiness;
  persistence: AdminRuntimeProviderPlaneReadiness;
  providerGates?: Array<{
    gateId: string;
    domain: string;
    path: string;
    capabilityIds: string[];
    state: string;
    liveProviderReady: boolean;
    credentialEvidencePresent: boolean;
    runtimeEvidencePresent: boolean;
    blockers: string[];
    recommendedNextAction: string;
    claimBoundary: string;
  }>;
  recommendedNextAction?: string;
  warnings: string[];
};

export type AdminRuntimeProviderReadiness = {
  source: string;
  claimBoundary: string;
  surfaces: AdminRuntimeProviderReadinessSurface[];
};

export type AdminRuntimeProtocolSupport = {
  protocolId: string;
  status: string;
  claimScope: string;
  runtimeTarget: string;
  role: string;
  clinicalMediaAllowed: boolean;
  path?: string;
  blockers: string[];
  notes: string;
};

export type AdminRuntimeProtocolPosture = {
  primaryRuntimeTarget: string;
  localFallbackRuntimeTarget: string;
  azureRuntimeTarget: string;
  protocols: AdminRuntimeProtocolSupport[];
};

export type AdminRealtimeVoicePosture = {
  policy: {
    cloudApisUsed: boolean;
    paidApisUsed: boolean;
    modelDownloadsPerformed: boolean;
    productionUseAllowed: boolean;
  };
  transports: {
    websocket: { status: string; path: string; codec: string };
    webTransport: { status: string; blockers: string[] };
  };
  gatewayRuntime: {
    target: string;
    localVerifiedFallback: string;
    blockers: string[];
  };
  backends: {
    pythonFastApi: {
      status: string;
      websocketPath: string;
      transportProxy: {
        status: string;
        backendUrlConfigured: boolean;
        readyForLiveDialog: boolean;
        blockers: string[];
      };
      blockers: string[];
    };
  };
  protocolLanes: Array<{
    id: string;
    protocol: string;
    role: string;
    status: string;
    mediaAllowed: boolean;
    blockers: string[];
    notes: string;
  }>;
  providerGates?: Array<{
    gateId: string;
    capability: string;
    providerPath: string;
    state: string;
    liveProviderReady: boolean;
    credentialEvidencePresent: boolean;
    runtimeEvidencePresent: boolean;
    blockers: string[];
    recommendedNextAction: string;
    claimBoundary: string;
  }>;
  recommendedProtocolSelection: {
    selectedLane?: {
      id: string;
      protocol: string;
      role: string;
      status: string;
      mediaAllowed: boolean;
      blockers: string[];
      notes: string;
    };
    rejectedLaneReasons: Array<{ id: string; reason: string; blockers: string[] }>;
  };
};
