import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  JSON: { input: unknown; output: unknown; }
};

export type Actor = {
  __typename?: 'Actor';
  actorId: Scalars['ID']['output'];
  communicationProfile?: Maybe<CommunicationProfile>;
  demeanor?: Maybe<Scalars['String']['output']>;
  displayName: Scalars['String']['output'];
  role: Scalars['String']['output'];
};

export type AssembleExamFormInput = {
  blueprintId?: InputMaybe<Scalars['ID']['input']>;
  examFormId: Scalars['ID']['input'];
  scenarioIds: Array<Scalars['ID']['input']>;
};

export type AssetBlocker = {
  __typename?: 'AssetBlocker';
  assetId: Scalars['ID']['output'];
  blockers: Array<Scalars['String']['output']>;
};

export type AssetNeed = {
  __typename?: 'AssetNeed';
  assetId: Scalars['ID']['output'];
  assetType: Scalars['String']['output'];
  description: Scalars['String']['output'];
  licenseStatus: Scalars['String']['output'];
};

export type AssetProductionReadinessLadder = {
  __typename?: 'AssetProductionReadinessLadder';
  assetId: Scalars['ID']['output'];
  blockers: Array<Scalars['String']['output']>;
  productionReady: Scalars['Boolean']['output'];
  scenarioId: Scalars['ID']['output'];
  steps: Array<AssetProductionReadinessStep>;
};

export type AssetProductionReadinessStep = {
  __typename?: 'AssetProductionReadinessStep';
  blockers: Array<Scalars['String']['output']>;
  evidenceRefs: Array<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  step: Scalars['String']['output'];
};

export type AssetReadiness = {
  __typename?: 'AssetReadiness';
  blockedAssets: Array<AssetBlocker>;
  devReady: Scalars['Boolean']['output'];
  missingRequiredAssetIds: Array<Scalars['ID']['output']>;
  productionBlockedAssets: Array<AssetBlocker>;
  productionReadinessLadder: ScenarioAssetProductionReadinessLadder;
  productionReady: Scalars['Boolean']['output'];
  scenarioId: Scalars['ID']['output'];
};

export type CommunicationProfile = {
  __typename?: 'CommunicationProfile';
  adverseResponse: Scalars['String']['output'];
  baselineMood: Array<Scalars['String']['output']>;
  communicativeness: Scalars['String']['output'];
  culturalLanguageNotes: Array<Scalars['String']['output']>;
  deescalationTriggers: Array<Scalars['String']['output']>;
  escalationTriggers: Array<Scalars['String']['output']>;
  intensity: Scalars['Float']['output'];
  style: Scalars['String']['output'];
  styleFamily: Scalars['String']['output'];
  topicsToAvoid: Array<Scalars['String']['output']>;
};

export type CreateStationRunQueueSnapshotInput = {
  createdAt?: InputMaybe<Scalars['String']['input']>;
  reviewerId?: InputMaybe<Scalars['ID']['input']>;
  snapshotId?: InputMaybe<Scalars['ID']['input']>;
};

export type DurableClinicalEventReviewSummary = {
  __typename?: 'DurableClinicalEventReviewSummary';
  clinicalEventKinds: Scalars['JSON']['output'];
  durableStore?: Maybe<Scalars['String']['output']>;
  eventCount: Scalars['Int']['output'];
  latestAtSecond?: Maybe<Scalars['Int']['output']>;
  redactedEventCount: Scalars['Int']['output'];
  safeForFacultyReview: Scalars['Boolean']['output'];
  stationRunId?: Maybe<Scalars['ID']['output']>;
  statusCounts: Scalars['JSON']['output'];
  traceTags: Array<Scalars['String']['output']>;
};

export type ExamBreakCheckpoint = {
  __typename?: 'ExamBreakCheckpoint';
  afterStationOrder: Scalars['Int']['output'];
  atSecond: Scalars['Int']['output'];
};

export type ExamForm = {
  __typename?: 'ExamForm';
  blueprintId: Scalars['ID']['output'];
  coverage: Scalars['JSON']['output'];
  examFormId: Scalars['ID']['output'];
  stationRefs: Array<StationRef>;
  status: Scalars['String']['output'];
};

export type ExamStationTimingWindow = {
  __typename?: 'ExamStationTimingWindow';
  doorway: ExamTimingWindow;
  encounter: ExamTimingWindow;
  label: Scalars['String']['output'];
  note: ExamTimingWindow;
  slotId: Scalars['ID']['output'];
  stationOrder: Scalars['Int']['output'];
};

export type ExamTimingWindow = {
  __typename?: 'ExamTimingWindow';
  durationSeconds: Scalars['Int']['output'];
  endsAtSecond: Scalars['Int']['output'];
  startsAtSecond: Scalars['Int']['output'];
};

export type FacultyScoreDraft = {
  __typename?: 'FacultyScoreDraft';
  comments: Scalars['String']['output'];
  reviewerId: Scalars['ID']['output'];
  status: Scalars['String']['output'];
};

export type FacultyScoreDraftInput = {
  comments: Scalars['String']['input'];
  reviewerId: Scalars['ID']['input'];
  rubricScores: Scalars['JSON']['input'];
  stationRunId: Scalars['ID']['input'];
};

export type HiddenFactPolicy = {
  __typename?: 'HiddenFactPolicy';
  disclosureRequiresTrigger: Scalars['Boolean']['output'];
  learnerView: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  assembleExamForm: ExamForm;
  createStationRunQueueSnapshot: StationRunQueueSnapshot;
  saveFacultyScoreDraft: ReviewPacket;
  submitScenarioReview: Scenario;
};


export type MutationAssembleExamFormArgs = {
  input: AssembleExamFormInput;
};


export type MutationCreateStationRunQueueSnapshotArgs = {
  input: CreateStationRunQueueSnapshotInput;
};


export type MutationSaveFacultyScoreDraftArgs = {
  input: FacultyScoreDraftInput;
};


export type MutationSubmitScenarioReviewArgs = {
  input: ScenarioReviewDecisionInput;
};

export type PatientNote = {
  __typename?: 'PatientNote';
  stationRunId: Scalars['ID']['output'];
  submittedAtSecond: Scalars['Int']['output'];
  text: Scalars['String']['output'];
};

export type Query = {
  __typename?: 'Query';
  assetReadiness: AssetReadiness;
  clinicalEventReviewSummary: DurableClinicalEventReviewSummary;
  examForm?: Maybe<ExamForm>;
  reviewPacket?: Maybe<ReviewPacket>;
  reviewReplayReadinessSummary: ReviewReplayReadinessSummary;
  scenario?: Maybe<Scenario>;
  scenarioReviewDecisions: Array<ScenarioReviewDecisionRecord>;
  scenarios: Array<Scenario>;
  stationRunQueueSnapshots: Array<StationRunQueueSnapshot>;
  traceEvents: Array<TraceEvent>;
};


export type QueryAssetReadinessArgs = {
  scenarioId: Scalars['ID']['input'];
  version: Scalars['Int']['input'];
};


export type QueryClinicalEventReviewSummaryArgs = {
  stationRunId: Scalars['ID']['input'];
};


export type QueryExamFormArgs = {
  examFormId: Scalars['ID']['input'];
};


export type QueryReviewPacketArgs = {
  stationRunId: Scalars['ID']['input'];
};


export type QueryReviewReplayReadinessSummaryArgs = {
  stationRunId: Scalars['ID']['input'];
};


export type QueryScenarioArgs = {
  scenarioId: Scalars['ID']['input'];
  version?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryScenarioReviewDecisionsArgs = {
  scenarioId: Scalars['ID']['input'];
  version: Scalars['Int']['input'];
};


export type QueryScenariosArgs = {
  status?: InputMaybe<ScenarioStatus>;
};


export type QueryStationRunQueueSnapshotsArgs = {
  blueprintId: Scalars['ID']['input'];
};


export type QueryTraceEventsArgs = {
  stationRunId: Scalars['ID']['input'];
};

export enum ReviewDecision {
  Approved = 'APPROVED',
  ChangesRequested = 'CHANGES_REQUESTED'
}

export type ReviewPacket = {
  __typename?: 'ReviewPacket';
  facultyScoreDraft: FacultyScoreDraft;
  lateTraceTags: Array<Scalars['String']['output']>;
  missingRequiredTraceTags: Array<Scalars['String']['output']>;
  observedTraceTags: Array<Scalars['String']['output']>;
  patientNote?: Maybe<PatientNote>;
  scenarioId: Scalars['ID']['output'];
  stationRunId: Scalars['ID']['output'];
  timeline: Array<TraceTimelineEntry>;
  traceQuality: ReviewTraceQuality;
  unsafeEvents: Array<Scalars['String']['output']>;
};

export type ReviewReplayReadinessSummary = {
  __typename?: 'ReviewReplayReadinessSummary';
  blockers: Array<Scalars['String']['output']>;
  durableEventCount: Scalars['Int']['output'];
  facultyReviewSafe: Scalars['Boolean']['output'];
  lateBehaviorCount: Scalars['Int']['output'];
  missingRequiredBehaviorCount: Scalars['Int']['output'];
  recommendedNextAction: Scalars['String']['output'];
  redactedDurableEventCount: Scalars['Int']['output'];
  replayBoundary: Scalars['String']['output'];
  replayEvidenceReady: Scalars['Boolean']['output'];
  runtimeVisualEvidenceReplayProjection?: Maybe<RuntimeVisualEvidenceReplayProjection>;
  safetySignalCount: Scalars['Int']['output'];
  stationRunId?: Maybe<Scalars['ID']['output']>;
  timelineEntryCount: Scalars['Int']['output'];
  traceEventCount: Scalars['Int']['output'];
};

export type ReviewTraceQuality = {
  __typename?: 'ReviewTraceQuality';
  blockedGuardrailCount: Scalars['Int']['output'];
  eventCount: Scalars['Int']['output'];
  hasModelProvenance: Scalars['Boolean']['output'];
  hasPatientNote: Scalars['Boolean']['output'];
  missingRequiredTraceTagCount: Scalars['Int']['output'];
  modelFailedEventCount: Scalars['Int']['output'];
  modelGeneratedEventCount: Scalars['Int']['output'];
  unsafeEventCount: Scalars['Int']['output'];
  voiceAudioEventCount: Scalars['Int']['output'];
};

export type RuntimeVisualEvidenceReplayProjection = {
  __typename?: 'RuntimeVisualEvidenceReplayProjection';
  acceptedActionIds: Array<Scalars['String']['output']>;
  acceptedAttachmentRefCount: Scalars['Int']['output'];
  blockerIds: Array<Scalars['String']['output']>;
  claimBoundary: Scalars['String']['output'];
  clinicalValidityClaimed: Scalars['Boolean']['output'];
  heldMetadataOnlyCount: Scalars['Int']['output'];
  learnerLaunchAllowed: Scalars['Boolean']['output'];
  nextActions: Array<Scalars['String']['output']>;
  notEvidenceFor: Array<Scalars['String']['output']>;
  productionAssetReadinessClaimed: Scalars['Boolean']['output'];
  providerExecutionAllowed: Scalars['Boolean']['output'];
  questEvidenceRefreshAllowed: Scalars['Boolean']['output'];
  rawPayloadDisplayed: Scalars['Boolean']['output'];
  replayEvidenceReady: Scalars['Boolean']['output'];
  reviewedMetadataOnlyCount: Scalars['Int']['output'];
  runtimeEvidenceRefCount: Scalars['Int']['output'];
  runtimeExecutionAllowed: Scalars['Boolean']['output'];
  scenarioId: Scalars['ID']['output'];
  schemaVersion: Scalars['String']['output'];
  scoringValidityClaimed: Scalars['Boolean']['output'];
  source: Scalars['String']['output'];
  stationRunId: Scalars['ID']['output'];
  uiXrConsumerOperatorWorkflowSummary?: Maybe<UiXrConsumerOperatorWorkflowSummary>;
  visualQaEvidenceRefCount: Scalars['Int']['output'];
};

export type Scenario = {
  __typename?: 'Scenario';
  actors: Array<Actor>;
  assetNeeds: Array<AssetNeed>;
  clinicalObjectives: Array<Scalars['String']['output']>;
  environment?: Maybe<ScenarioEnvironment>;
  equipment: Array<Scalars['String']['output']>;
  governance: ScenarioGovernance;
  requiredTraceTags: Array<Scalars['String']['output']>;
  review: ScenarioReviewState;
  scenarioId: Scalars['ID']['output'];
  status: ScenarioStatus;
  title: Scalars['String']['output'];
  version: Scalars['Int']['output'];
};

export type ScenarioAssetBudget = {
  __typename?: 'ScenarioAssetBudget';
  blockers: Array<Scalars['String']['output']>;
  maxDrawCalls: Scalars['Int']['output'];
  maxTextureMegabytes: Scalars['Int']['output'];
  maxVisibleTriangles: Scalars['Int']['output'];
  totalDrawCalls: Scalars['Int']['output'];
  totalTextureMegabytes: Scalars['Int']['output'];
  totalTriangles: Scalars['Int']['output'];
};

export type ScenarioAssetProductionReadinessLadder = {
  __typename?: 'ScenarioAssetProductionReadinessLadder';
  assetCount: Scalars['Int']['output'];
  assetLadders: Array<AssetProductionReadinessLadder>;
  blockedAssetIds: Array<Scalars['ID']['output']>;
  blockers: Array<Scalars['String']['output']>;
  missingRequiredAssetIds: Array<Scalars['ID']['output']>;
  productionReady: Scalars['Boolean']['output'];
  productionReadyAssetIds: Array<Scalars['ID']['output']>;
  scenarioId: Scalars['ID']['output'];
  stationBudget: ScenarioAssetBudget;
};

export type ScenarioEnvironment = {
  __typename?: 'ScenarioEnvironment';
  description: Scalars['String']['output'];
  environmentId: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type ScenarioGovernance = {
  __typename?: 'ScenarioGovernance';
  hiddenFactPolicy: HiddenFactPolicy;
  requiredReviewerRoles: Array<Scalars['String']['output']>;
  safetyCriticalTraceTags: Array<Scalars['String']['output']>;
  scoreUseLabel: Scalars['String']['output'];
  sourceIds: Array<Scalars['String']['output']>;
  syntheticCaseDisclosure: Scalars['String']['output'];
  validationLimitations: Array<Scalars['String']['output']>;
  validationStage: Scalars['String']['output'];
};

export type ScenarioReviewDecisionInput = {
  comments: Scalars['String']['input'];
  decision: ReviewDecision;
  evidenceRefs: Array<Scalars['String']['input']>;
  reviewerId: Scalars['ID']['input'];
  reviewerRole: Scalars['String']['input'];
  scenarioId: Scalars['ID']['input'];
  version: Scalars['Int']['input'];
};

export type ScenarioReviewDecisionRecord = {
  __typename?: 'ScenarioReviewDecisionRecord';
  comments: Scalars['String']['output'];
  decision: Scalars['String']['output'];
  evidenceRefs: Array<Scalars['String']['output']>;
  reviewedAt: Scalars['String']['output'];
  reviewerId: Scalars['ID']['output'];
  reviewerRole: Scalars['String']['output'];
  scenarioId: Scalars['ID']['output'];
  version: Scalars['Int']['output'];
};

export type ScenarioReviewState = {
  __typename?: 'ScenarioReviewState';
  clinical: Scalars['String']['output'];
  legal: Scalars['String']['output'];
  psychometric: Scalars['String']['output'];
  simulationQa: Scalars['String']['output'];
};

export enum ScenarioStatus {
  Approved = 'APPROVED',
  Archived = 'ARCHIVED',
  Draft = 'DRAFT',
  ReadyForReview = 'READY_FOR_REVIEW'
}

export type StationRef = {
  __typename?: 'StationRef';
  order: Scalars['Int']['output'];
  scenarioId: Scalars['ID']['output'];
  scenarioVersion: Scalars['Int']['output'];
  title: Scalars['String']['output'];
};

export type StationRunQueue = {
  __typename?: 'StationRunQueue';
  blueprintId: Scalars['ID']['output'];
  breakCheckpoints: Array<ExamBreakCheckpoint>;
  canStartLearnerExam: Scalars['Boolean']['output'];
  stationQueue: Array<StationRunQueueItem>;
  summary: StationRunQueueSummary;
  totalStationTimeSeconds: Scalars['Int']['output'];
};

export type StationRunQueueItem = {
  __typename?: 'StationRunQueueItem';
  blockers: Array<Scalars['String']['output']>;
  label: Scalars['String']['output'];
  scenarioId?: Maybe<Scalars['ID']['output']>;
  scenarioVersion?: Maybe<Scalars['Int']['output']>;
  slotId: Scalars['ID']['output'];
  stationOrder: Scalars['Int']['output'];
  status: Scalars['String']['output'];
  timing: ExamStationTimingWindow;
};

export type StationRunQueueSnapshot = {
  __typename?: 'StationRunQueueSnapshot';
  createdAt: Scalars['String']['output'];
  queue: StationRunQueue;
  reviewerId?: Maybe<Scalars['ID']['output']>;
  snapshotId: Scalars['ID']['output'];
};

export type StationRunQueueSummary = {
  __typename?: 'StationRunQueueSummary';
  activationReady: Scalars['Int']['output'];
  draftBlocked: Scalars['Int']['output'];
  governanceBlocked: Scalars['Int']['output'];
  missingScenario: Scalars['Int']['output'];
};

export type TraceEvent = {
  __typename?: 'TraceEvent';
  actorId?: Maybe<Scalars['ID']['output']>;
  atSecond: Scalars['Int']['output'];
  eventType: Scalars['String']['output'];
  occurredAt: Scalars['String']['output'];
  /**
   * Runtime/debug payload only. Faculty/admin review surfaces should use review-safe
   * summary projections instead of this raw payload field.
   * @deprecated Use review-safe replay summaries for faculty/admin UI; raw payload is not review-safe.
   */
  payload: Scalars['JSON']['output'];
  sequence: Scalars['Int']['output'];
  source: Scalars['String']['output'];
  stationRunId: Scalars['ID']['output'];
  tag?: Maybe<Scalars['String']['output']>;
};

export type TraceTimelineEntry = {
  __typename?: 'TraceTimelineEntry';
  actorId?: Maybe<Scalars['ID']['output']>;
  atSecond: Scalars['Int']['output'];
  eventType: Scalars['String']['output'];
  sequence: Scalars['Int']['output'];
  source: Scalars['String']['output'];
  summary: Scalars['String']['output'];
  tag?: Maybe<Scalars['String']['output']>;
};

export type UiXrConsumerOperatorWorkflowSummary = {
  __typename?: 'UiXrConsumerOperatorWorkflowSummary';
  acceptedAttachmentRefCount: Scalars['Int']['output'];
  blockerIds: Array<Scalars['String']['output']>;
  claimBoundary: Scalars['String']['output'];
  clinicalValidityClaimed: Scalars['Boolean']['output'];
  learnerLaunchAllowed: Scalars['Boolean']['output'];
  method: Scalars['String']['output'];
  nextActions: Array<Scalars['String']['output']>;
  notEvidenceFor: Array<Scalars['String']['output']>;
  preflightChecks: Array<Scalars['String']['output']>;
  productionAssetReadinessClaimed: Scalars['Boolean']['output'];
  providerExecutionAllowed: Scalars['Boolean']['output'];
  questEvidenceRefreshAllowed: Scalars['Boolean']['output'];
  rawPayloadDisplayed: Scalars['Boolean']['output'];
  reviewerAction: Scalars['String']['output'];
  runtimeEvidenceRefCount: Scalars['Int']['output'];
  runtimeExecutionAllowed: Scalars['Boolean']['output'];
  scenarioId: Scalars['ID']['output'];
  schemaVersion: Scalars['String']['output'];
  scoringValidityClaimed: Scalars['Boolean']['output'];
  source: Scalars['String']['output'];
  submitBodyRef: Scalars['String']['output'];
  submitPreview: UiXrConsumerWorkflowSubmitPreview;
  targetRoute: Scalars['String']['output'];
  visualQaEvidenceRefCount: Scalars['Int']['output'];
};

export type UiXrConsumerWorkflowSubmitPreview = {
  __typename?: 'UiXrConsumerWorkflowSubmitPreview';
  actionIds: Array<Scalars['String']['output']>;
  attachmentCount: Scalars['Int']['output'];
  bodyRef: Scalars['String']['output'];
  claimBoundary: Scalars['String']['output'];
  inputIds: Array<Scalars['String']['output']>;
  localArtifactPaths: Array<Scalars['String']['output']>;
  rawPayloadDisplayed: Scalars['Boolean']['output'];
  route: Scalars['String']['output'];
};



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Actor: ResolverTypeWrapper<Actor>;
  AssembleExamFormInput: AssembleExamFormInput;
  AssetBlocker: ResolverTypeWrapper<AssetBlocker>;
  AssetNeed: ResolverTypeWrapper<AssetNeed>;
  AssetProductionReadinessLadder: ResolverTypeWrapper<AssetProductionReadinessLadder>;
  AssetProductionReadinessStep: ResolverTypeWrapper<AssetProductionReadinessStep>;
  AssetReadiness: ResolverTypeWrapper<AssetReadiness>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CommunicationProfile: ResolverTypeWrapper<CommunicationProfile>;
  CreateStationRunQueueSnapshotInput: CreateStationRunQueueSnapshotInput;
  DurableClinicalEventReviewSummary: ResolverTypeWrapper<DurableClinicalEventReviewSummary>;
  ExamBreakCheckpoint: ResolverTypeWrapper<ExamBreakCheckpoint>;
  ExamForm: ResolverTypeWrapper<ExamForm>;
  ExamStationTimingWindow: ResolverTypeWrapper<ExamStationTimingWindow>;
  ExamTimingWindow: ResolverTypeWrapper<ExamTimingWindow>;
  FacultyScoreDraft: ResolverTypeWrapper<FacultyScoreDraft>;
  FacultyScoreDraftInput: FacultyScoreDraftInput;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  HiddenFactPolicy: ResolverTypeWrapper<HiddenFactPolicy>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  JSON: ResolverTypeWrapper<Scalars['JSON']['output']>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  PatientNote: ResolverTypeWrapper<PatientNote>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  ReviewDecision: ReviewDecision;
  ReviewPacket: ResolverTypeWrapper<ReviewPacket>;
  ReviewReplayReadinessSummary: ResolverTypeWrapper<ReviewReplayReadinessSummary>;
  ReviewTraceQuality: ResolverTypeWrapper<ReviewTraceQuality>;
  RuntimeVisualEvidenceReplayProjection: ResolverTypeWrapper<RuntimeVisualEvidenceReplayProjection>;
  Scenario: ResolverTypeWrapper<Scenario>;
  ScenarioAssetBudget: ResolverTypeWrapper<ScenarioAssetBudget>;
  ScenarioAssetProductionReadinessLadder: ResolverTypeWrapper<ScenarioAssetProductionReadinessLadder>;
  ScenarioEnvironment: ResolverTypeWrapper<ScenarioEnvironment>;
  ScenarioGovernance: ResolverTypeWrapper<ScenarioGovernance>;
  ScenarioReviewDecisionInput: ScenarioReviewDecisionInput;
  ScenarioReviewDecisionRecord: ResolverTypeWrapper<ScenarioReviewDecisionRecord>;
  ScenarioReviewState: ResolverTypeWrapper<ScenarioReviewState>;
  ScenarioStatus: ScenarioStatus;
  StationRef: ResolverTypeWrapper<StationRef>;
  StationRunQueue: ResolverTypeWrapper<StationRunQueue>;
  StationRunQueueItem: ResolverTypeWrapper<StationRunQueueItem>;
  StationRunQueueSnapshot: ResolverTypeWrapper<StationRunQueueSnapshot>;
  StationRunQueueSummary: ResolverTypeWrapper<StationRunQueueSummary>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  TraceEvent: ResolverTypeWrapper<TraceEvent>;
  TraceTimelineEntry: ResolverTypeWrapper<TraceTimelineEntry>;
  UiXrConsumerOperatorWorkflowSummary: ResolverTypeWrapper<UiXrConsumerOperatorWorkflowSummary>;
  UiXrConsumerWorkflowSubmitPreview: ResolverTypeWrapper<UiXrConsumerWorkflowSubmitPreview>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Actor: Actor;
  AssembleExamFormInput: AssembleExamFormInput;
  AssetBlocker: AssetBlocker;
  AssetNeed: AssetNeed;
  AssetProductionReadinessLadder: AssetProductionReadinessLadder;
  AssetProductionReadinessStep: AssetProductionReadinessStep;
  AssetReadiness: AssetReadiness;
  Boolean: Scalars['Boolean']['output'];
  CommunicationProfile: CommunicationProfile;
  CreateStationRunQueueSnapshotInput: CreateStationRunQueueSnapshotInput;
  DurableClinicalEventReviewSummary: DurableClinicalEventReviewSummary;
  ExamBreakCheckpoint: ExamBreakCheckpoint;
  ExamForm: ExamForm;
  ExamStationTimingWindow: ExamStationTimingWindow;
  ExamTimingWindow: ExamTimingWindow;
  FacultyScoreDraft: FacultyScoreDraft;
  FacultyScoreDraftInput: FacultyScoreDraftInput;
  Float: Scalars['Float']['output'];
  HiddenFactPolicy: HiddenFactPolicy;
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  JSON: Scalars['JSON']['output'];
  Mutation: Record<PropertyKey, never>;
  PatientNote: PatientNote;
  Query: Record<PropertyKey, never>;
  ReviewPacket: ReviewPacket;
  ReviewReplayReadinessSummary: ReviewReplayReadinessSummary;
  ReviewTraceQuality: ReviewTraceQuality;
  RuntimeVisualEvidenceReplayProjection: RuntimeVisualEvidenceReplayProjection;
  Scenario: Scenario;
  ScenarioAssetBudget: ScenarioAssetBudget;
  ScenarioAssetProductionReadinessLadder: ScenarioAssetProductionReadinessLadder;
  ScenarioEnvironment: ScenarioEnvironment;
  ScenarioGovernance: ScenarioGovernance;
  ScenarioReviewDecisionInput: ScenarioReviewDecisionInput;
  ScenarioReviewDecisionRecord: ScenarioReviewDecisionRecord;
  ScenarioReviewState: ScenarioReviewState;
  StationRef: StationRef;
  StationRunQueue: StationRunQueue;
  StationRunQueueItem: StationRunQueueItem;
  StationRunQueueSnapshot: StationRunQueueSnapshot;
  StationRunQueueSummary: StationRunQueueSummary;
  String: Scalars['String']['output'];
  TraceEvent: TraceEvent;
  TraceTimelineEntry: TraceTimelineEntry;
  UiXrConsumerOperatorWorkflowSummary: UiXrConsumerOperatorWorkflowSummary;
  UiXrConsumerWorkflowSubmitPreview: UiXrConsumerWorkflowSubmitPreview;
};

export type ActorResolvers<ContextType = any, ParentType extends ResolversParentTypes['Actor'] = ResolversParentTypes['Actor']> = {
  actorId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  communicationProfile?: Resolver<Maybe<ResolversTypes['CommunicationProfile']>, ParentType, ContextType>;
  demeanor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  displayName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AssetBlockerResolvers<ContextType = any, ParentType extends ResolversParentTypes['AssetBlocker'] = ResolversParentTypes['AssetBlocker']> = {
  assetId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  blockers?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
};

export type AssetNeedResolvers<ContextType = any, ParentType extends ResolversParentTypes['AssetNeed'] = ResolversParentTypes['AssetNeed']> = {
  assetId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  assetType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  licenseStatus?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AssetProductionReadinessLadderResolvers<ContextType = any, ParentType extends ResolversParentTypes['AssetProductionReadinessLadder'] = ResolversParentTypes['AssetProductionReadinessLadder']> = {
  assetId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  blockers?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  productionReady?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  scenarioId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  steps?: Resolver<Array<ResolversTypes['AssetProductionReadinessStep']>, ParentType, ContextType>;
};

export type AssetProductionReadinessStepResolvers<ContextType = any, ParentType extends ResolversParentTypes['AssetProductionReadinessStep'] = ResolversParentTypes['AssetProductionReadinessStep']> = {
  blockers?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  evidenceRefs?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  step?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AssetReadinessResolvers<ContextType = any, ParentType extends ResolversParentTypes['AssetReadiness'] = ResolversParentTypes['AssetReadiness']> = {
  blockedAssets?: Resolver<Array<ResolversTypes['AssetBlocker']>, ParentType, ContextType>;
  devReady?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  missingRequiredAssetIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  productionBlockedAssets?: Resolver<Array<ResolversTypes['AssetBlocker']>, ParentType, ContextType>;
  productionReadinessLadder?: Resolver<ResolversTypes['ScenarioAssetProductionReadinessLadder'], ParentType, ContextType>;
  productionReady?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  scenarioId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type CommunicationProfileResolvers<ContextType = any, ParentType extends ResolversParentTypes['CommunicationProfile'] = ResolversParentTypes['CommunicationProfile']> = {
  adverseResponse?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  baselineMood?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  communicativeness?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  culturalLanguageNotes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  deescalationTriggers?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  escalationTriggers?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  intensity?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  style?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  styleFamily?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  topicsToAvoid?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
};

export type DurableClinicalEventReviewSummaryResolvers<ContextType = any, ParentType extends ResolversParentTypes['DurableClinicalEventReviewSummary'] = ResolversParentTypes['DurableClinicalEventReviewSummary']> = {
  clinicalEventKinds?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  durableStore?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  eventCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  latestAtSecond?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  redactedEventCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  safeForFacultyReview?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  stationRunId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  statusCounts?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  traceTags?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
};

export type ExamBreakCheckpointResolvers<ContextType = any, ParentType extends ResolversParentTypes['ExamBreakCheckpoint'] = ResolversParentTypes['ExamBreakCheckpoint']> = {
  afterStationOrder?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  atSecond?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ExamFormResolvers<ContextType = any, ParentType extends ResolversParentTypes['ExamForm'] = ResolversParentTypes['ExamForm']> = {
  blueprintId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  coverage?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  examFormId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  stationRefs?: Resolver<Array<ResolversTypes['StationRef']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ExamStationTimingWindowResolvers<ContextType = any, ParentType extends ResolversParentTypes['ExamStationTimingWindow'] = ResolversParentTypes['ExamStationTimingWindow']> = {
  doorway?: Resolver<ResolversTypes['ExamTimingWindow'], ParentType, ContextType>;
  encounter?: Resolver<ResolversTypes['ExamTimingWindow'], ParentType, ContextType>;
  label?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  note?: Resolver<ResolversTypes['ExamTimingWindow'], ParentType, ContextType>;
  slotId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  stationOrder?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ExamTimingWindowResolvers<ContextType = any, ParentType extends ResolversParentTypes['ExamTimingWindow'] = ResolversParentTypes['ExamTimingWindow']> = {
  durationSeconds?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  endsAtSecond?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  startsAtSecond?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type FacultyScoreDraftResolvers<ContextType = any, ParentType extends ResolversParentTypes['FacultyScoreDraft'] = ResolversParentTypes['FacultyScoreDraft']> = {
  comments?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  reviewerId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type HiddenFactPolicyResolvers<ContextType = any, ParentType extends ResolversParentTypes['HiddenFactPolicy'] = ResolversParentTypes['HiddenFactPolicy']> = {
  disclosureRequiresTrigger?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  learnerView?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export interface JsonScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['JSON'], any> {
  name: 'JSON';
}

export type MutationResolvers<ContextType = any, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  assembleExamForm?: Resolver<ResolversTypes['ExamForm'], ParentType, ContextType, RequireFields<MutationAssembleExamFormArgs, 'input'>>;
  createStationRunQueueSnapshot?: Resolver<ResolversTypes['StationRunQueueSnapshot'], ParentType, ContextType, RequireFields<MutationCreateStationRunQueueSnapshotArgs, 'input'>>;
  saveFacultyScoreDraft?: Resolver<ResolversTypes['ReviewPacket'], ParentType, ContextType, RequireFields<MutationSaveFacultyScoreDraftArgs, 'input'>>;
  submitScenarioReview?: Resolver<ResolversTypes['Scenario'], ParentType, ContextType, RequireFields<MutationSubmitScenarioReviewArgs, 'input'>>;
};

export type PatientNoteResolvers<ContextType = any, ParentType extends ResolversParentTypes['PatientNote'] = ResolversParentTypes['PatientNote']> = {
  stationRunId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  submittedAtSecond?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  text?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type QueryResolvers<ContextType = any, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  assetReadiness?: Resolver<ResolversTypes['AssetReadiness'], ParentType, ContextType, RequireFields<QueryAssetReadinessArgs, 'scenarioId' | 'version'>>;
  clinicalEventReviewSummary?: Resolver<ResolversTypes['DurableClinicalEventReviewSummary'], ParentType, ContextType, RequireFields<QueryClinicalEventReviewSummaryArgs, 'stationRunId'>>;
  examForm?: Resolver<Maybe<ResolversTypes['ExamForm']>, ParentType, ContextType, RequireFields<QueryExamFormArgs, 'examFormId'>>;
  reviewPacket?: Resolver<Maybe<ResolversTypes['ReviewPacket']>, ParentType, ContextType, RequireFields<QueryReviewPacketArgs, 'stationRunId'>>;
  reviewReplayReadinessSummary?: Resolver<ResolversTypes['ReviewReplayReadinessSummary'], ParentType, ContextType, RequireFields<QueryReviewReplayReadinessSummaryArgs, 'stationRunId'>>;
  scenario?: Resolver<Maybe<ResolversTypes['Scenario']>, ParentType, ContextType, RequireFields<QueryScenarioArgs, 'scenarioId'>>;
  scenarioReviewDecisions?: Resolver<Array<ResolversTypes['ScenarioReviewDecisionRecord']>, ParentType, ContextType, RequireFields<QueryScenarioReviewDecisionsArgs, 'scenarioId' | 'version'>>;
  scenarios?: Resolver<Array<ResolversTypes['Scenario']>, ParentType, ContextType, Partial<QueryScenariosArgs>>;
  stationRunQueueSnapshots?: Resolver<Array<ResolversTypes['StationRunQueueSnapshot']>, ParentType, ContextType, RequireFields<QueryStationRunQueueSnapshotsArgs, 'blueprintId'>>;
  traceEvents?: Resolver<Array<ResolversTypes['TraceEvent']>, ParentType, ContextType, RequireFields<QueryTraceEventsArgs, 'stationRunId'>>;
};

export type ReviewPacketResolvers<ContextType = any, ParentType extends ResolversParentTypes['ReviewPacket'] = ResolversParentTypes['ReviewPacket']> = {
  facultyScoreDraft?: Resolver<ResolversTypes['FacultyScoreDraft'], ParentType, ContextType>;
  lateTraceTags?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  missingRequiredTraceTags?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  observedTraceTags?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  patientNote?: Resolver<Maybe<ResolversTypes['PatientNote']>, ParentType, ContextType>;
  scenarioId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  stationRunId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  timeline?: Resolver<Array<ResolversTypes['TraceTimelineEntry']>, ParentType, ContextType>;
  traceQuality?: Resolver<ResolversTypes['ReviewTraceQuality'], ParentType, ContextType>;
  unsafeEvents?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
};

export type ReviewReplayReadinessSummaryResolvers<ContextType = any, ParentType extends ResolversParentTypes['ReviewReplayReadinessSummary'] = ResolversParentTypes['ReviewReplayReadinessSummary']> = {
  blockers?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  durableEventCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  facultyReviewSafe?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  lateBehaviorCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  missingRequiredBehaviorCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  recommendedNextAction?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  redactedDurableEventCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  replayBoundary?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  replayEvidenceReady?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  runtimeVisualEvidenceReplayProjection?: Resolver<Maybe<ResolversTypes['RuntimeVisualEvidenceReplayProjection']>, ParentType, ContextType>;
  safetySignalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  stationRunId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  timelineEntryCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  traceEventCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ReviewTraceQualityResolvers<ContextType = any, ParentType extends ResolversParentTypes['ReviewTraceQuality'] = ResolversParentTypes['ReviewTraceQuality']> = {
  blockedGuardrailCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  eventCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  hasModelProvenance?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  hasPatientNote?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  missingRequiredTraceTagCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  modelFailedEventCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  modelGeneratedEventCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  unsafeEventCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  voiceAudioEventCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type RuntimeVisualEvidenceReplayProjectionResolvers<ContextType = any, ParentType extends ResolversParentTypes['RuntimeVisualEvidenceReplayProjection'] = ResolversParentTypes['RuntimeVisualEvidenceReplayProjection']> = {
  acceptedActionIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  acceptedAttachmentRefCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  blockerIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  claimBoundary?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  clinicalValidityClaimed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  heldMetadataOnlyCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  learnerLaunchAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  nextActions?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  notEvidenceFor?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  productionAssetReadinessClaimed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  providerExecutionAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  questEvidenceRefreshAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  rawPayloadDisplayed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  replayEvidenceReady?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  reviewedMetadataOnlyCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  runtimeEvidenceRefCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  runtimeExecutionAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  scenarioId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  schemaVersion?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  scoringValidityClaimed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  source?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  stationRunId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  uiXrConsumerOperatorWorkflowSummary?: Resolver<Maybe<ResolversTypes['UiXrConsumerOperatorWorkflowSummary']>, ParentType, ContextType>;
  visualQaEvidenceRefCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ScenarioResolvers<ContextType = any, ParentType extends ResolversParentTypes['Scenario'] = ResolversParentTypes['Scenario']> = {
  actors?: Resolver<Array<ResolversTypes['Actor']>, ParentType, ContextType>;
  assetNeeds?: Resolver<Array<ResolversTypes['AssetNeed']>, ParentType, ContextType>;
  clinicalObjectives?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  environment?: Resolver<Maybe<ResolversTypes['ScenarioEnvironment']>, ParentType, ContextType>;
  equipment?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  governance?: Resolver<ResolversTypes['ScenarioGovernance'], ParentType, ContextType>;
  requiredTraceTags?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  review?: Resolver<ResolversTypes['ScenarioReviewState'], ParentType, ContextType>;
  scenarioId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['ScenarioStatus'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  version?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ScenarioAssetBudgetResolvers<ContextType = any, ParentType extends ResolversParentTypes['ScenarioAssetBudget'] = ResolversParentTypes['ScenarioAssetBudget']> = {
  blockers?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  maxDrawCalls?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  maxTextureMegabytes?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  maxVisibleTriangles?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  totalDrawCalls?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  totalTextureMegabytes?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  totalTriangles?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ScenarioAssetProductionReadinessLadderResolvers<ContextType = any, ParentType extends ResolversParentTypes['ScenarioAssetProductionReadinessLadder'] = ResolversParentTypes['ScenarioAssetProductionReadinessLadder']> = {
  assetCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  assetLadders?: Resolver<Array<ResolversTypes['AssetProductionReadinessLadder']>, ParentType, ContextType>;
  blockedAssetIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  blockers?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  missingRequiredAssetIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  productionReady?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  productionReadyAssetIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  scenarioId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  stationBudget?: Resolver<ResolversTypes['ScenarioAssetBudget'], ParentType, ContextType>;
};

export type ScenarioEnvironmentResolvers<ContextType = any, ParentType extends ResolversParentTypes['ScenarioEnvironment'] = ResolversParentTypes['ScenarioEnvironment']> = {
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  environmentId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ScenarioGovernanceResolvers<ContextType = any, ParentType extends ResolversParentTypes['ScenarioGovernance'] = ResolversParentTypes['ScenarioGovernance']> = {
  hiddenFactPolicy?: Resolver<ResolversTypes['HiddenFactPolicy'], ParentType, ContextType>;
  requiredReviewerRoles?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  safetyCriticalTraceTags?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  scoreUseLabel?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sourceIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  syntheticCaseDisclosure?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  validationLimitations?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  validationStage?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ScenarioReviewDecisionRecordResolvers<ContextType = any, ParentType extends ResolversParentTypes['ScenarioReviewDecisionRecord'] = ResolversParentTypes['ScenarioReviewDecisionRecord']> = {
  comments?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  decision?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  evidenceRefs?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  reviewedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  reviewerId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  reviewerRole?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  scenarioId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  version?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ScenarioReviewStateResolvers<ContextType = any, ParentType extends ResolversParentTypes['ScenarioReviewState'] = ResolversParentTypes['ScenarioReviewState']> = {
  clinical?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  legal?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  psychometric?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  simulationQa?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type StationRefResolvers<ContextType = any, ParentType extends ResolversParentTypes['StationRef'] = ResolversParentTypes['StationRef']> = {
  order?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  scenarioId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  scenarioVersion?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type StationRunQueueResolvers<ContextType = any, ParentType extends ResolversParentTypes['StationRunQueue'] = ResolversParentTypes['StationRunQueue']> = {
  blueprintId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  breakCheckpoints?: Resolver<Array<ResolversTypes['ExamBreakCheckpoint']>, ParentType, ContextType>;
  canStartLearnerExam?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  stationQueue?: Resolver<Array<ResolversTypes['StationRunQueueItem']>, ParentType, ContextType>;
  summary?: Resolver<ResolversTypes['StationRunQueueSummary'], ParentType, ContextType>;
  totalStationTimeSeconds?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type StationRunQueueItemResolvers<ContextType = any, ParentType extends ResolversParentTypes['StationRunQueueItem'] = ResolversParentTypes['StationRunQueueItem']> = {
  blockers?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  label?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  scenarioId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  scenarioVersion?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  slotId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  stationOrder?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  timing?: Resolver<ResolversTypes['ExamStationTimingWindow'], ParentType, ContextType>;
};

export type StationRunQueueSnapshotResolvers<ContextType = any, ParentType extends ResolversParentTypes['StationRunQueueSnapshot'] = ResolversParentTypes['StationRunQueueSnapshot']> = {
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  queue?: Resolver<ResolversTypes['StationRunQueue'], ParentType, ContextType>;
  reviewerId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  snapshotId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type StationRunQueueSummaryResolvers<ContextType = any, ParentType extends ResolversParentTypes['StationRunQueueSummary'] = ResolversParentTypes['StationRunQueueSummary']> = {
  activationReady?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  draftBlocked?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  governanceBlocked?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  missingScenario?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type TraceEventResolvers<ContextType = any, ParentType extends ResolversParentTypes['TraceEvent'] = ResolversParentTypes['TraceEvent']> = {
  actorId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  atSecond?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  eventType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  occurredAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  payload?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  sequence?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  source?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  stationRunId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  tag?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type TraceTimelineEntryResolvers<ContextType = any, ParentType extends ResolversParentTypes['TraceTimelineEntry'] = ResolversParentTypes['TraceTimelineEntry']> = {
  actorId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  atSecond?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  eventType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sequence?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  source?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  summary?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  tag?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type UiXrConsumerOperatorWorkflowSummaryResolvers<ContextType = any, ParentType extends ResolversParentTypes['UiXrConsumerOperatorWorkflowSummary'] = ResolversParentTypes['UiXrConsumerOperatorWorkflowSummary']> = {
  acceptedAttachmentRefCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  blockerIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  claimBoundary?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  clinicalValidityClaimed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  learnerLaunchAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  method?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nextActions?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  notEvidenceFor?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  preflightChecks?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  productionAssetReadinessClaimed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  providerExecutionAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  questEvidenceRefreshAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  rawPayloadDisplayed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  reviewerAction?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  runtimeEvidenceRefCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  runtimeExecutionAllowed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  scenarioId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  schemaVersion?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  scoringValidityClaimed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  source?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  submitBodyRef?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  submitPreview?: Resolver<ResolversTypes['UiXrConsumerWorkflowSubmitPreview'], ParentType, ContextType>;
  targetRoute?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  visualQaEvidenceRefCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type UiXrConsumerWorkflowSubmitPreviewResolvers<ContextType = any, ParentType extends ResolversParentTypes['UiXrConsumerWorkflowSubmitPreview'] = ResolversParentTypes['UiXrConsumerWorkflowSubmitPreview']> = {
  actionIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  attachmentCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  bodyRef?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  claimBoundary?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  inputIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  localArtifactPaths?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  rawPayloadDisplayed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  route?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type Resolvers<ContextType = any> = {
  Actor?: ActorResolvers<ContextType>;
  AssetBlocker?: AssetBlockerResolvers<ContextType>;
  AssetNeed?: AssetNeedResolvers<ContextType>;
  AssetProductionReadinessLadder?: AssetProductionReadinessLadderResolvers<ContextType>;
  AssetProductionReadinessStep?: AssetProductionReadinessStepResolvers<ContextType>;
  AssetReadiness?: AssetReadinessResolvers<ContextType>;
  CommunicationProfile?: CommunicationProfileResolvers<ContextType>;
  DurableClinicalEventReviewSummary?: DurableClinicalEventReviewSummaryResolvers<ContextType>;
  ExamBreakCheckpoint?: ExamBreakCheckpointResolvers<ContextType>;
  ExamForm?: ExamFormResolvers<ContextType>;
  ExamStationTimingWindow?: ExamStationTimingWindowResolvers<ContextType>;
  ExamTimingWindow?: ExamTimingWindowResolvers<ContextType>;
  FacultyScoreDraft?: FacultyScoreDraftResolvers<ContextType>;
  HiddenFactPolicy?: HiddenFactPolicyResolvers<ContextType>;
  JSON?: GraphQLScalarType;
  Mutation?: MutationResolvers<ContextType>;
  PatientNote?: PatientNoteResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  ReviewPacket?: ReviewPacketResolvers<ContextType>;
  ReviewReplayReadinessSummary?: ReviewReplayReadinessSummaryResolvers<ContextType>;
  ReviewTraceQuality?: ReviewTraceQualityResolvers<ContextType>;
  RuntimeVisualEvidenceReplayProjection?: RuntimeVisualEvidenceReplayProjectionResolvers<ContextType>;
  Scenario?: ScenarioResolvers<ContextType>;
  ScenarioAssetBudget?: ScenarioAssetBudgetResolvers<ContextType>;
  ScenarioAssetProductionReadinessLadder?: ScenarioAssetProductionReadinessLadderResolvers<ContextType>;
  ScenarioEnvironment?: ScenarioEnvironmentResolvers<ContextType>;
  ScenarioGovernance?: ScenarioGovernanceResolvers<ContextType>;
  ScenarioReviewDecisionRecord?: ScenarioReviewDecisionRecordResolvers<ContextType>;
  ScenarioReviewState?: ScenarioReviewStateResolvers<ContextType>;
  StationRef?: StationRefResolvers<ContextType>;
  StationRunQueue?: StationRunQueueResolvers<ContextType>;
  StationRunQueueItem?: StationRunQueueItemResolvers<ContextType>;
  StationRunQueueSnapshot?: StationRunQueueSnapshotResolvers<ContextType>;
  StationRunQueueSummary?: StationRunQueueSummaryResolvers<ContextType>;
  TraceEvent?: TraceEventResolvers<ContextType>;
  TraceTimelineEntry?: TraceTimelineEntryResolvers<ContextType>;
  UiXrConsumerOperatorWorkflowSummary?: UiXrConsumerOperatorWorkflowSummaryResolvers<ContextType>;
  UiXrConsumerWorkflowSubmitPreview?: UiXrConsumerWorkflowSubmitPreviewResolvers<ContextType>;
};

