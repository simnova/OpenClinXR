export const openClinXrAdminTheme = {
  token: {
    borderRadius: 6,
    colorPrimary: "#245b55",
    colorInfo: "#315f91",
    colorTextHeading: "#17211f",
  },
} as const;

export const adminWorkbenchCapabilityTags = Object.freeze([
  "GraphQL Codegen",
  "Apollo Client",
  "ProComponents v3",
  "React Router",
  "Ant Design 6",
]);

export {
  countActorCommunicationProfiles,
  formatActorCommunicationProfileCoverage,
  formatDuration,
  formatMinutes,
  uniqueWorkbenchValues,
  pluralizeWorkbenchCount,
  clampedScoreFromWorkbenchInput,
  capabilityTagColor,
} from "./admin-workbench-format.js";
export type {
  AdminNoReadinessEvidenceClaim,
  AdminRuntimeProviderPlaneReadiness,
  AdminRuntimeProviderReadiness,
  AdminRuntimeProviderReadinessSurface,
  AdminRuntimeProtocolPosture,
  AdminRuntimeProtocolSupport,
  AdminRealtimeVoicePosture,
} from "./admin-runtime-posture.js";
