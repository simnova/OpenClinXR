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

export { ActorTurnReplayPanel, type ActorTurnReplayPanelProps } from "./actor-turn-replay-panel-mod.js";
export type {
  AdminNoReadinessEvidenceClaim,
  AdminRealtimeVoicePosture,
  AdminRuntimeProtocolPosture,
  AdminRuntimeProtocolSupport,
  AdminRuntimeProviderPlaneReadiness,
  AdminRuntimeProviderReadiness,
  AdminRuntimeProviderReadinessSurface,
} from "./admin-runtime-posture.js";
export {
  capabilityTagColor,
  clampedScoreFromWorkbenchInput,
  countActorCommunicationProfiles,
  formatActorCommunicationProfileCoverage,
  formatDuration,
  formatMinutes,
  pluralizeWorkbenchCount,
  uniqueWorkbenchValues,
} from "./admin-workbench-format-mod.js";
export { EmissionReplayBindPanel, type EmissionReplayBindPanelProps } from "./emission-replay-bind-panel.js";
export { FacultyDispositionPanel, type FacultyDispositionPanelProps } from "./faculty-disposition-panel-mod.js";
