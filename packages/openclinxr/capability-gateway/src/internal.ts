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

export function buildProviderGateMetadata(
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
      blockers: ["emotional_prosody_policy_review_missing", "affect_safety_review_missing"],
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

export function providerGate(input: Omit<ProviderGateMetadata, "liveProviderReady" | "credentialEvidencePresent" | "runtimeEvidencePresent" | "claimBoundary">): ProviderGateMetadata {
  return {
    ...input,
    liveProviderReady: false,
    credentialEvidencePresent: false,
    runtimeEvidencePresent: false,
    claimBoundary: "provider_gate_metadata_not_live_provider_readiness",
  };
}

export function recommendedNextActionForProviderGates(gates: readonly ProviderGateMetadata[]): string {
  return gates.find((gate) => gate.blockers.length > 0 && gate.path !== "deterministic-replay")?.recommendedNextAction
    ?? "continue_deterministic_replay_without_live_provider_claims";
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function binding(
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

export function summarizeProviderPlane(
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

export function capabilityIdsByStatus(
  bindings: readonly CapabilityProviderBinding[],
  status: CapabilityBindingStatus,
): CapabilityId[] {
  return bindings
    .filter((binding) => binding.status === status)
    .map((binding) => binding.capabilityId);
}

export function planeForCapability(capabilityId: CapabilityId): CapabilityPlane {
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

export function facadeForCapability(capabilityId: CapabilityId): string {
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

export function executableWorkerControls(): string[] {
  return [
    "async_job_queue",
    "sandboxed_workdir",
    "artifact_manifest",
    "license_provenance",
    "resource_limits",
    "operator_enabled",
  ];
}

