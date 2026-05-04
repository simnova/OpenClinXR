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

export type AssetReadiness = {
  __typename?: 'AssetReadiness';
  blockedAssets: Array<AssetBlocker>;
  devReady: Scalars['Boolean']['output'];
  missingRequiredAssetIds: Array<Scalars['ID']['output']>;
  productionBlockedAssets: Array<AssetBlocker>;
  productionReady: Scalars['Boolean']['output'];
};

export type CreateStationRunQueueSnapshotInput = {
  createdAt?: InputMaybe<Scalars['String']['input']>;
  reviewerId?: InputMaybe<Scalars['ID']['input']>;
  snapshotId?: InputMaybe<Scalars['ID']['input']>;
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
  examForm?: Maybe<ExamForm>;
  reviewPacket?: Maybe<ReviewPacket>;
  scenario?: Maybe<Scenario>;
  scenarios: Array<Scenario>;
  stationRunQueueSnapshots: Array<StationRunQueueSnapshot>;
  traceEvents: Array<TraceEvent>;
};


export type QueryAssetReadinessArgs = {
  scenarioId: Scalars['ID']['input'];
  version: Scalars['Int']['input'];
};


export type QueryExamFormArgs = {
  examFormId: Scalars['ID']['input'];
};


export type QueryReviewPacketArgs = {
  stationRunId: Scalars['ID']['input'];
};


export type QueryScenarioArgs = {
  scenarioId: Scalars['ID']['input'];
  version?: InputMaybe<Scalars['Int']['input']>;
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
  unsafeEvents: Array<TraceEvent>;
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
  AssetReadiness: ResolverTypeWrapper<AssetReadiness>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CreateStationRunQueueSnapshotInput: CreateStationRunQueueSnapshotInput;
  ExamBreakCheckpoint: ResolverTypeWrapper<ExamBreakCheckpoint>;
  ExamForm: ResolverTypeWrapper<ExamForm>;
  ExamStationTimingWindow: ResolverTypeWrapper<ExamStationTimingWindow>;
  ExamTimingWindow: ResolverTypeWrapper<ExamTimingWindow>;
  FacultyScoreDraft: ResolverTypeWrapper<FacultyScoreDraft>;
  FacultyScoreDraftInput: FacultyScoreDraftInput;
  HiddenFactPolicy: ResolverTypeWrapper<HiddenFactPolicy>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  JSON: ResolverTypeWrapper<Scalars['JSON']['output']>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  PatientNote: ResolverTypeWrapper<PatientNote>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  ReviewDecision: ReviewDecision;
  ReviewPacket: ResolverTypeWrapper<ReviewPacket>;
  ReviewTraceQuality: ResolverTypeWrapper<ReviewTraceQuality>;
  Scenario: ResolverTypeWrapper<Scenario>;
  ScenarioEnvironment: ResolverTypeWrapper<ScenarioEnvironment>;
  ScenarioGovernance: ResolverTypeWrapper<ScenarioGovernance>;
  ScenarioReviewDecisionInput: ScenarioReviewDecisionInput;
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
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Actor: Actor;
  AssembleExamFormInput: AssembleExamFormInput;
  AssetBlocker: AssetBlocker;
  AssetNeed: AssetNeed;
  AssetReadiness: AssetReadiness;
  Boolean: Scalars['Boolean']['output'];
  CreateStationRunQueueSnapshotInput: CreateStationRunQueueSnapshotInput;
  ExamBreakCheckpoint: ExamBreakCheckpoint;
  ExamForm: ExamForm;
  ExamStationTimingWindow: ExamStationTimingWindow;
  ExamTimingWindow: ExamTimingWindow;
  FacultyScoreDraft: FacultyScoreDraft;
  FacultyScoreDraftInput: FacultyScoreDraftInput;
  HiddenFactPolicy: HiddenFactPolicy;
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  JSON: Scalars['JSON']['output'];
  Mutation: Record<PropertyKey, never>;
  PatientNote: PatientNote;
  Query: Record<PropertyKey, never>;
  ReviewPacket: ReviewPacket;
  ReviewTraceQuality: ReviewTraceQuality;
  Scenario: Scenario;
  ScenarioEnvironment: ScenarioEnvironment;
  ScenarioGovernance: ScenarioGovernance;
  ScenarioReviewDecisionInput: ScenarioReviewDecisionInput;
  ScenarioReviewState: ScenarioReviewState;
  StationRef: StationRef;
  StationRunQueue: StationRunQueue;
  StationRunQueueItem: StationRunQueueItem;
  StationRunQueueSnapshot: StationRunQueueSnapshot;
  StationRunQueueSummary: StationRunQueueSummary;
  String: Scalars['String']['output'];
  TraceEvent: TraceEvent;
  TraceTimelineEntry: TraceTimelineEntry;
};

export type ActorResolvers<ContextType = any, ParentType extends ResolversParentTypes['Actor'] = ResolversParentTypes['Actor']> = {
  actorId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
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

export type AssetReadinessResolvers<ContextType = any, ParentType extends ResolversParentTypes['AssetReadiness'] = ResolversParentTypes['AssetReadiness']> = {
  blockedAssets?: Resolver<Array<ResolversTypes['AssetBlocker']>, ParentType, ContextType>;
  devReady?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  missingRequiredAssetIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  productionBlockedAssets?: Resolver<Array<ResolversTypes['AssetBlocker']>, ParentType, ContextType>;
  productionReady?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
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
  examForm?: Resolver<Maybe<ResolversTypes['ExamForm']>, ParentType, ContextType, RequireFields<QueryExamFormArgs, 'examFormId'>>;
  reviewPacket?: Resolver<Maybe<ResolversTypes['ReviewPacket']>, ParentType, ContextType, RequireFields<QueryReviewPacketArgs, 'stationRunId'>>;
  scenario?: Resolver<Maybe<ResolversTypes['Scenario']>, ParentType, ContextType, RequireFields<QueryScenarioArgs, 'scenarioId'>>;
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
  unsafeEvents?: Resolver<Array<ResolversTypes['TraceEvent']>, ParentType, ContextType>;
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

export type Resolvers<ContextType = any> = {
  Actor?: ActorResolvers<ContextType>;
  AssetBlocker?: AssetBlockerResolvers<ContextType>;
  AssetNeed?: AssetNeedResolvers<ContextType>;
  AssetReadiness?: AssetReadinessResolvers<ContextType>;
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
  ReviewTraceQuality?: ReviewTraceQualityResolvers<ContextType>;
  Scenario?: ScenarioResolvers<ContextType>;
  ScenarioEnvironment?: ScenarioEnvironmentResolvers<ContextType>;
  ScenarioGovernance?: ScenarioGovernanceResolvers<ContextType>;
  ScenarioReviewState?: ScenarioReviewStateResolvers<ContextType>;
  StationRef?: StationRefResolvers<ContextType>;
  StationRunQueue?: StationRunQueueResolvers<ContextType>;
  StationRunQueueItem?: StationRunQueueItemResolvers<ContextType>;
  StationRunQueueSnapshot?: StationRunQueueSnapshotResolvers<ContextType>;
  StationRunQueueSummary?: StationRunQueueSummaryResolvers<ContextType>;
  TraceEvent?: TraceEventResolvers<ContextType>;
  TraceTimelineEntry?: TraceTimelineEntryResolvers<ContextType>;
};

