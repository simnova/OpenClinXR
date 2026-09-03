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
import type { PublicationTargetUse, ReviewerAttestationVerifier, ReviewerEvidence } from "@openclinxr/review-workflow";
import type {
  ActorModelContext,
  InteractionRoutingReason,
  MultiActorClinicalSession,
  RecordClinicalActionInput,
  RouteActorInteractionInput,
} from "@openclinxr/session-state";
import type { InteractionEmotion, ProviderHealth, ReviewPacket, Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import type { InMemoryTraceLedger } from "@cellix/trace-ledger";
import type { AudioEvent, VoiceGateway } from "@openclinxr/voice-gateway";

/**
 * Public + internal type surface for the scenario runtime. Split out of index.ts so the
 * orchestration class, feature helpers, and factories share one type SSOT without a
 * god-file. Values/logic live in scenario-runtime.ts and the feature helper modules.
 */

/**
 * Runtime-visible provider readiness for whatever adapters are actually wired.
 *
 * The four convenience keys (`model` / `voice` / `localModel` / `localVoice`) stay populated
 * when those historical adapter ids are present, so existing UI/API consumers keep working.
 * They are optional so a deployment that supplies only a real provider (no mock, no local)
 * can report health without inventing missing roster entries.
 *
 * `adapters` is the complete list of validated health entries from both gateways — the open
 * set source of truth after gateways became injectable.
 */
export type ProviderHealthSnapshot = {
  /** Present when `mock-model` is among the model adapters. */
  model?: ProviderHealth;
  /** Present when `mock-voice` is among the voice adapters. */
  voice?: ProviderHealth;
  /** Present when `local-model` is among the model adapters. */
  localModel?: ProviderHealth;
  /** Present when `local-voice` is among the voice adapters. */
  localVoice?: ProviderHealth;
  /** Every validated adapter health entry currently wired (model gateway then voice). */
  adapters: ProviderHealth[];
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
  attestationVerifier?: ReviewerAttestationVerifier;
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
  /** One seed or plan identifier binding speaker, spokenText, caption, and affect. */
  authoredBindingId?: string;
  speakerActorId?: string;
  spokenText?: string;
  caption?: string;
  affect?: InteractionEmotion;
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
  /** Override the default ED chest pain scenario. When set, asset manifests are built for this scenario. */
  scenario?: Scenario;
  durableStore?: ScenarioRuntimeDurableStore;
  conversationPolicy?: ConversationPolicy;
  /**
   * Override the model gateway so the composing PROCESS chooses which provider adapters are live.
   *
   * Without this the adapter list is fixed inside createDefaultScenarioRuntime (Mock + a
   * `not_configured` Local), which means a real provider cannot be introduced without editing that
   * factory — the ports-and-adapters seam exists but nothing can reach it. Adapter selection is a
   * composition-root decision, not a library default.
   */
  modelGateway?: ModelGateway;
  /** Same rationale as {@link CreateDefaultScenarioRuntimeOptions.modelGateway}, for voice. */
  voiceGateway?: VoiceGateway;
};
