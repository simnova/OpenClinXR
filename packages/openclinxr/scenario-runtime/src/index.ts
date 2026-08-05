/**
 * @openclinxr/scenario-runtime — public barrel.
 *
 * Orchestration (the ScenarioRuntime class) lives in ./scenario-runtime.ts; the type SSOT
 * in ./runtime-types.ts; feature/support helpers in ./emotion-policy.ts, ./trace.ts, and
 * ./provider-support.ts. This barrel re-exports the same public surface the runtime has
 * always exposed — consumers import from "@openclinxr/scenario-runtime" unchanged.
 */

export type {
  ActorTurnInProgress,
  BargeInResolution,
  ConversationPolicy,
  HistoryTakingCoverageState,
  TurnTakingDecision,
} from "@openclinxr/conversation-policy";
export type { PublicationTargetUse, ReviewerEvidence, ScenarioPublicationReadiness } from "@openclinxr/review-workflow";

export { createDurableStoreFromPersistenceHooks } from "./provider-support.js";
export {
  createDefaultScenarioRuntime,
  createScenarioRuntimeWithPersistenceHooks,
} from "./default-runtime-factory.js";
export {
  type ScenarioCatalogEntry,
  type ScenarioCatalogPort,
  type ScenarioCatalogSource,
  resolveScenarioById,
} from "./scenario-catalog.js";
export { ScenarioRuntime } from "./scenario-runtime.js";
export type {
  CreateDefaultScenarioRuntimeOptions,
  DurableStorePersistenceHooks,
  GenerateActorResponseInput,
  GenerateActorResponseResult,
  GenerateRoutedActorResponseInput,
  GenerateRoutedActorResponseResult,
  LearnerEventInput,
  ProviderHealthSnapshot,
  RecordRuntimeClinicalActionInput,
  RegisterLearnerBargeInResult,
  RouteRuntimeActorInteractionInput,
  RouteRuntimeActorInteractionResult,
  RuntimeSessionSummary,
  SaveFacultyScoreDraftInput,
  ScenarioPublicationReadinessInput,
  ScenarioRuntimeActorTurn,
  ScenarioRuntimeDurableStore,
  ScenarioRuntimeOptions,
  StartEncounterInput,
  StartSessionInput,
  SubmitNoteInput,
  SubmitNoteResult,
  SynthesizeActorSpeechInput,
  SynthesizeActorSpeechResult,
} from "./runtime-types.js";
