import type { InMemoryAssetRegistry } from "@openclinxr/asset-registry";
import type {
  ActorTurnInProgress,
  BargeInResolution,
  CaseEmotionPolicy,
  ConversationPolicy,
  EmotionEngine,
  HistoryTakingCoverageSpec,
  HistoryTakingCoverageState,
  TurnTakingDecision,
} from "@openclinxr/conversation-policy";
import type { StationRun } from "@openclinxr/domain";
import type { ActorResponseResult, ModelGateway } from "@openclinxr/model-gateway";
import type { PublicationTargetUse, ReviewerEvidence } from "@openclinxr/review-workflow";
import type {
  ActorModelContext,
  InteractionRoutingReason,
  MultiActorClinicalSession,
  RecordClinicalActionInput,
  RouteActorInteractionInput,
} from "@openclinxr/session-state";
import type { InteractionEmotion, ProviderHealth, ReviewPacket, Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import type { InMemoryTraceLedger } from "@openclinxr/trace-ledger";
import type { AudioEvent, VoiceGateway } from "@openclinxr/voice-gateway";

/**
 * Public + internal type surface for the scenario runtime. Split out of index.ts so the
 * orchestration class, feature helpers, and factories share one type SSOT without a
 * god-file. Values/logic live in scenario-runtime.ts and the feature helper modules.
 */

export type ProviderHealthSnapshot = {
  model: ProviderHealth;
  voice: ProviderHealth;
  localModel: ProviderHealth;
  localVoice: ProviderHealth;
};

export type StartSessionInput = {
  learnerId: string;
  consentAccepted: boolean;
};

export type RuntimeSessionSummary = {
  stationRunId: string;
  scenarioId: string;
  phase: StationRun["phase"];
};

export type LearnerEventInput = {
  eventType: string;
  atSecond: number;
  tag?: string;
  actorId?: string;
  /** Optional review-safe payload (e.g. clinical.touch region); additive. */
  payload?: Record<string, unknown>;
};

export type SubmitNoteInput = {
  atSecond: number;
  text: string;
};

export type SynthesizeActorSpeechInput = {
  actorId: string;
  voiceId: string;
  text: string;
  atSecond: number;
};

export type SynthesizeActorSpeechResult = {
  audioEvents: AudioEvent[];
  traceEvents: TraceEvent[];
};

export type StartEncounterInput = {
  atSecond: number;
};

export type GenerateActorResponseInput = {
  actorId: string;
  learnerUtterance: string;
  atSecond: number;
  traceContextTags?: string[];
};

export type RecordRuntimeClinicalActionInput = RecordClinicalActionInput;

export type RouteRuntimeActorInteractionInput = RouteActorInteractionInput;

export type GenerateRoutedActorResponseInput = RouteRuntimeActorInteractionInput;

export type RouteRuntimeActorInteractionResult = {
  routedActorId: string;
  routingReason: InteractionRoutingReason;
  conversationTurn: number;
  actorContext: ActorModelContext;
  interactionEvent: TraceEvent;
};

export type GenerateActorResponseResult = {
  conversationTurn: number;
  response: ActorResponseResult;
  learnerEvent: TraceEvent;
  actorResponseEvent: TraceEvent;
  /** Additive: history-taking domain coverage after this learner turn (traced, not scored). */
  historyTakingCoverage?: HistoryTakingCoverageState;
};

export type GenerateRoutedActorResponseResult = GenerateActorResponseResult & {
  routedActorId: string;
  routingReason: InteractionRoutingReason;
  routeEvent: TraceEvent;
  /** Additive: deterministic who-speaks-next decision for this routed turn. */
  turnTakingDecision?: TurnTakingDecision;
};

export type RegisterLearnerBargeInResult = {
  resolution: BargeInResolution;
  event: TraceEvent;
};

export type ScenarioPublicationReadinessInput = {
  targetUse: PublicationTargetUse;
  reviewerEvidence: ReviewerEvidence[];
};

export type SaveFacultyScoreDraftInput = {
  reviewerId: string;
  comments: string;
  rubricScores: Record<string, unknown>;
};

export type SubmitNoteResult = {
  phase: StationRun["phase"];
  note: StationRun["note"];
};

export type SessionRecord = {
  run: StationRun;
  multiActorSession: MultiActorClinicalSession;
  nextSequence: number;
  facultyScoreDraft?: ReviewPacket["facultyScoreDraft"];
  actorTurnInProgress: ActorTurnInProgress | null;
  historyTakingCoverage: HistoryTakingCoverageState;
  historyTakingCoverageSpec: HistoryTakingCoverageSpec;
  lastSpeakerActorId: string | null;
  emotionEngines: Map<string, EmotionEngine>;
  emotionPolicy: CaseEmotionPolicy;
};

export type GenerateActorResponseFromContextInput = {
  actorId: string;
  learnerUtterance: string;
  atSecond: number;
  traceContextTags?: string[];
  actorContext: ActorModelContext;
  conversationTurn: number;
};

export type ScenarioRuntimeActorTurn = {
  turnId: string;
  stationRunId: string;
  actorId: string;
  atSecond: number;
  conversationTurn: number;
  learnerUtterance: string;
  responseText: string;
  responseKind: string;
  traceContextTags: string[];
  durableEventRef: string;
  learnerEventSequence: number;
  actorResponseEventSequence: number;
  /** Current affective state at the time this actor turn was produced (additive, back-compat). */
  currentEmotion?: InteractionEmotion | undefined;
};

export type ScenarioRuntimeDurableStore = {
  saveReviewPacket?(stationRunId: string, packet: ReviewPacket): void | Promise<void>;
  saveActorTurn?(stationRunId: string, turn: ScenarioRuntimeActorTurn): void | Promise<void>;
};

/**
 * ApiPersistenceSink-shaped hooks for review packets + actor turns.
 * Hosts (API bootstrap residual, CLIs) attach sinks without coupling
 * scenario-runtime to apps/api or data-mongodb.
 */
export type DurableStorePersistenceHooks = {
  saveReviewPacket?(stationRunId: string, packet: ReviewPacket): void | Promise<void>;
  saveActorTurn?(stationRunId: string, turn: ScenarioRuntimeActorTurn): void | Promise<void>;
};

export type ScenarioRuntimeOptions = {
  scenario: Scenario;
  ledger: InMemoryTraceLedger;
  assetRegistry: InMemoryAssetRegistry;
  modelGateway: ModelGateway;
  voiceGateway: VoiceGateway;
  /** Optional durable sink. In-memory default when unset. */
  durableStore?: ScenarioRuntimeDurableStore;
  /**
   * Optional deterministic conversation policy (turn-taking, barge-in, history coverage).
   * When omitted, a default local policy is constructed internally.
   */
  conversationPolicy?: ConversationPolicy;
};

export type CreateDefaultScenarioRuntimeOptions = {
  durableStore?: ScenarioRuntimeDurableStore;
  conversationPolicy?: ConversationPolicy;
};
