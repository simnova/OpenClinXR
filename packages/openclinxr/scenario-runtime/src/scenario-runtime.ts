import type { ScenarioAssetReadiness } from "@openclinxr/asset-registry";
import {
  type ActorTurnInProgress,
  type ArbitrateTurnTakingInput,
  type CaseEmotionPolicy,
  type ConversationPolicy,
  createDefaultConversationPolicy,
  EmotionEngine,
  type EmotionEventKind,
  type EmotionTransition,
  type HistoryTakingCoverageSpec,
  type HistoryTakingCoverageState,
  type LearnerBargeInInput,
  type TurnTakingDecision,
} from "@openclinxr/conversation-policy";
import { createStationRun, type StationRun, transitionStation } from "@openclinxr/domain";
import type { ModelGateway } from "@openclinxr/model-gateway";
import {
  buildReviewPacket,
  evaluateScenarioPublicationReadiness,
  type ScenarioPublicationReadiness,
} from "@openclinxr/review-workflow";
import {
  type ActorModelContext,
  buildActorModelContext,
  createMultiActorClinicalSession,
  type MultiActorClinicalSession,
  recordClinicalAction as recordSessionClinicalAction,
  routeActorInteraction,
} from "@openclinxr/session-state";
import type { ActorTurnPlan, InteractionEmotion, ReviewPacket, Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import {
  type AudioEvent,
  collectVoiceStream,
  type VoiceGateway,
} from "@openclinxr/voice-gateway";
import { resolveCaseEmotionPolicy } from "./emotion-policy.js";
import {
  actorInteractionRoutePayload,
  buildProviderHealthSnapshot,
  settleDurableStoreCall,
  voiceSynthesisPolicy,
  voiceSynthesisRequestId,
} from "./provider-support.js";
import { ACTOR_TURN_EXECUTED_EVENT_TYPE, executionFromFrozenPlan } from "./actor-turn-plan.js";
import { generateActorResponseFromContext } from "./actor-turn-generation.js";
import {
  durableEventRef,
  replayablePhaseTransitionEvent,
  traceEvent,
  type ReplayablePhaseTransitionType,
  type TraceEventInput,
  withDurableEventRef,
} from "./trace.js";
import type {
  AssembledStationContext,
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
  ScenarioRuntimeOptions,
  SessionRecord,
  StartEncounterInput,
  StartSessionInput,
  SubmitNoteInput,
  SubmitNoteResult,
  SynthesizeActorSpeechInput,
  SynthesizeActorSpeechResult,
} from "./runtime-types.js";

export class ScenarioRuntime {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly conversationPolicy: ConversationPolicy;

  constructor(private readonly options: ScenarioRuntimeOptions) {
    this.conversationPolicy = options.conversationPolicy ?? createDefaultConversationPolicy();
  }

  async startSession(input: StartSessionInput): Promise<RuntimeSessionSummary> {
    if (!input.consentAccepted) {
      throw new Error("Consent is required before starting a station session");
    }

    const assembledStation = input.assembledStation
      ? validateAssembledStationContext(input.assembledStation, this.options.scenario.scenarioId)
      : undefined;
    const run = createStationRun(this.options.scenario.scenarioId, input.learnerId);
    this.options.ledger.append(traceEvent({ stationRunId: run.stationRunId, sequence: 0, eventType: "station.started", atSecond: 0, source: "system" }));
    this.options.ledger.append(traceEvent({ stationRunId: run.stationRunId, sequence: 1, eventType: "consent.accepted", atSecond: 0, source: "learner" }));
    const historyTakingCoverageSpec = this.conversationPolicy.buildHistoryTakingCoverageSpec(this.options.scenario);
    const emotionPolicy = resolveCaseEmotionPolicy(this.options.scenario);
    const emotionEngines = new Map<string, EmotionEngine>();
    for (const actor of this.options.scenario.actors) {
      emotionEngines.set(actor.actorId, new EmotionEngine(emotionPolicy.baseline));
    }
    const sessionRecord: SessionRecord = {
      run,
      multiActorSession: createMultiActorClinicalSession({
        scenario: this.options.scenario,
        stationRunId: run.stationRunId,
      }),
      nextSequence: 2,
      actorTurnInProgress: null,
      historyTakingCoverageSpec,
      historyTakingCoverage: this.conversationPolicy.initialHistoryTakingCoverageState(historyTakingCoverageSpec),
      lastSpeakerActorId: null,
      emotionEngines,
      emotionPolicy,
      frozenActorTurnPlans: new Map(),
    };
    if (assembledStation) {
      sessionRecord.assembledStation = assembledStation;
    }
    this.sessions.set(run.stationRunId, sessionRecord);

    return {
      stationRunId: run.stationRunId,
      scenarioId: this.options.scenario.scenarioId,
      phase: run.phase,
    };
  }

  startEncounter(stationRunId: string, input: StartEncounterInput): RuntimeSessionSummary {
    const session = this.requireSession(stationRunId);
    session.run = transitionStation(session.run, { type: "START_ENCOUNTER", atSecond: input.atSecond });
    if (session.assembledStation) {
      this.appendAssembledPhase(session, "encounter.started", "encounter", session.assembledStation.formTiming.encounter.startsAtSecond);
    } else {
      this.options.ledger.append(
        traceEvent({
          stationRunId,
          sequence: session.nextSequence,
          eventType: "encounter.started",
          atSecond: input.atSecond,
          source: "system",
        }),
      );
      session.nextSequence += 1;
    }

    return {
      stationRunId,
      scenarioId: this.options.scenario.scenarioId,
      phase: session.run.phase,
    };
  }

  appendLearnerEvent(stationRunId: string, input: LearnerEventInput): TraceEvent {
    const session = this.requireSession(stationRunId);
    const eventInput: TraceEventInput = {
      stationRunId,
      sequence: session.nextSequence,
      eventType: input.eventType,
      atSecond: input.atSecond,
      source: "learner",
    };
    if (input.tag) {
      eventInput.tag = input.tag;
    }
    if (input.actorId) {
      eventInput.actorId = input.actorId;
    }
    if (input.payload) {
      eventInput.payload = input.payload;
    }

    const event = traceEvent(eventInput);
    this.options.ledger.append(event);
    session.nextSequence += 1;
    return event;
  }

  recordClinicalAction(stationRunId: string, input: RecordRuntimeClinicalActionInput): TraceEvent {
    const session = this.requireSession(stationRunId);
    session.multiActorSession = recordSessionClinicalAction(session.multiActorSession, input);
    const actorContext = buildActorModelContext(session.multiActorSession, input.actorId);

    return this.appendTrace(session, {
      eventType: "clinical.action.recorded",
      atSecond: input.atSecond,
      source: "session-state",
      actorId: input.actorId,
      tag: input.traceTag,
      payload: {
        actionType: input.actionType,
        label: input.label,
        completedTraceTags: actorContext.clinicalState.completedTraceTags,
        openOrderCount: actorContext.clinicalState.openOrders.length,
        findingCount: session.multiActorSession.clinicalState.findings.length,
      },
    });
  }

  routeActorInteractionTurn(
    stationRunId: string,
    input: RouteRuntimeActorInteractionInput,
  ): RouteRuntimeActorInteractionResult {
    const session = this.requireSession(stationRunId);
    const routed = routeActorInteraction(session.multiActorSession, input);
    session.multiActorSession = routed.updatedSession;

    const actorContext = buildActorModelContext(session.multiActorSession, routed.routedActorId);
    const primaryTag = input.traceContextTags?.[0];
    const interactionEvent = this.appendTrace(session, {
      eventType: "actor.interaction.routed",
      atSecond: input.atSecond,
      source: "session-state",
      actorId: routed.routedActorId,
      ...(primaryTag ? { tag: primaryTag } : {}),
      payload: withDurableEventRef(
        actorInteractionRoutePayload(input, routed.routingReason),
        stationRunId,
        session.nextSequence,
      ),
    });

    return {
      routedActorId: routed.routedActorId,
      routingReason: routed.routingReason,
      conversationTurn: actorContext.conversationTurn,
      actorContext,
      interactionEvent,
    };
  }

  async generateActorResponse(stationRunId: string, input: GenerateActorResponseInput): Promise<GenerateActorResponseResult> {
    const session = this.requireSession(stationRunId);
    const actorContext = buildActorModelContext(session.multiActorSession, input.actorId);
    return generateActorResponseFromContext(this.actorTurnGenerationHost(), session, {
      ...input,
      actorContext,
      conversationTurn: this.actorResponseTurnCount(stationRunId, input.actorId) + 1,
    });
  }

  async generateRoutedActorResponse(
    stationRunId: string,
    input: GenerateRoutedActorResponseInput,
  ): Promise<GenerateRoutedActorResponseResult> {
    const routed = this.routeActorInteractionTurn(stationRunId, input);
    const session = this.requireSession(stationRunId);
    const turnTakingDecision = this.turnTakingDecision(stationRunId, {
      routedActorId: routed.routedActorId,
      learnerUtterance: input.learnerUtterance,
      conversationTurn: routed.actorContext.conversationTurn,
    });
    const generated = await generateActorResponseFromContext(this.actorTurnGenerationHost(), session, {
      actorId: routed.routedActorId,
      learnerUtterance: input.learnerUtterance,
      atSecond: input.atSecond,
      ...(input.traceContextTags ? { traceContextTags: input.traceContextTags } : {}),
      actorContext: routed.actorContext,
      conversationTurn: routed.actorContext.conversationTurn,
    });
    return {
      ...generated,
      routedActorId: routed.routedActorId,
      routingReason: routed.routingReason,
      routeEvent: routed.interactionEvent,
      turnTakingDecision,
    };
  }

  /**
   * Register a learner barge-in against any in-progress actor turn.
   * Always appends a distinct trace event (eventType conversation.learner.barge_in, tag learner_barge_in).
   */
  registerLearnerBargeIn(stationRunId: string, input: LearnerBargeInInput): RegisterLearnerBargeInResult {
    const session = this.requireSession(stationRunId);
    const resolution = this.conversationPolicy.resolveLearnerBargeIn(session.actorTurnInProgress, input);
    if (resolution.outcome === "actor_turn_interrupted") {
      session.actorTurnInProgress = null;
    }
    const event = this.appendTrace(session, {
      eventType: "conversation.learner.barge_in",
      atSecond: input.atSecond,
      source: "conversation-policy",
      tag: resolution.bargeInTraceTag,
      ...(resolution.interruptedActorId ? { actorId: resolution.interruptedActorId } : {}),
      payload: {
        outcome: resolution.outcome,
        bargeInTraceTag: resolution.bargeInTraceTag,
        interruptedActorId: resolution.interruptedActorId,
        interruptedAtSecond: resolution.interruptedAtSecond,
        truncatedResponse: resolution.truncatedResponse,
        yieldedToLearner: resolution.yieldedToLearner,
        claimScope: resolution.claimScope,
        notEvidenceFor: [...resolution.notEvidenceFor],
        ...(input.learnerUtterance ? { learnerUtterance: input.learnerUtterance } : {}),
      },
    });
    return { resolution, event };
  }

  /**
   * Apply an emotion event against the actor's EmotionEngine.
   * When the emotion CHANGES, emits a trace event with the PINNED shape:
   *   { eventType: "emotion_transition", actorId, payload: { from, to, trigger, turnIndex } }
   *
   * Returns the resolved EmotionTransition (changed=true when a transition occurred).
   */
  applyEmotionEvent(
    stationRunId: string,
    actorId: string,
    kind: EmotionEventKind,
    opts?: { atSecond?: number; turnIndex?: number },
  ): EmotionTransition {
    const session = this.requireSession(stationRunId);
    const engine = session.emotionEngines.get(actorId);
    if (!engine) {
      throw new Error(`No emotion engine for actor: ${actorId}`);
    }

    const atSecond = opts?.atSecond ?? 0;
    const transition = engine.transition({ kind }, session.emotionPolicy, opts?.turnIndex);

    if (transition.changed) {
      this.appendTrace(session, {
        eventType: "emotion_transition",
        atSecond,
        source: "emotion-engine",
        actorId,
        payload: {
          from: transition.from,
          to: transition.to,
          trigger: transition.trigger,
          turnIndex: transition.turnIndex,
        },
      });
    }

    return transition;
  }

  /** Frozen ActorTurnPlan for an actor, if generateActorResponse has committed one. */
  getFrozenActorTurnPlan(stationRunId: string, actorId: string): ActorTurnPlan | undefined {
    return this.requireSession(stationRunId).frozenActorTurnPlans.get(actorId);
  }

  /** Return the current InteractionEmotion for an actor in a session. */
  getActorEmotion(stationRunId: string, actorId: string): InteractionEmotion {
    const session = this.requireSession(stationRunId);
    const engine = session.emotionEngines.get(actorId);
    if (!engine) {
      throw new Error(`No emotion engine for actor: ${actorId}`);
    }
    return engine.currentEmotion;
  }

  /** Current history-taking domain coverage for a session (traced, not scored). */
  historyTakingCoverage(stationRunId: string): HistoryTakingCoverageState {
    return this.requireSession(stationRunId).historyTakingCoverage;
  }

  /**
   * Deterministic who-speaks-next helper. Uses session last speaker + scenario actors.
   */
  turnTakingDecision(
    stationRunId: string,
    input: {
      routedActorId?: string | null;
      learnerUtterance?: string;
      conversationTurn?: number;
    } = {},
  ): TurnTakingDecision {
    const session = this.requireSession(stationRunId);
    const actors = this.options.scenario.actors.map((actor) => ({
      actorId: actor.actorId,
      role: actor.role,
    }));
    const arbitrateInput: ArbitrateTurnTakingInput = {
      actors,
      lastActorId: session.lastSpeakerActorId,
      conversationTurn: input.conversationTurn ?? this.nextConversationTurnHint(stationRunId),
      ...(input.routedActorId !== undefined ? { routedActorId: input.routedActorId } : {}),
      ...(input.learnerUtterance !== undefined ? { learnerUtterance: input.learnerUtterance } : {}),
    };
    return this.conversationPolicy.arbitrateTurnTaking(arbitrateInput);
  }

  async synthesizeActorSpeech(stationRunId: string, input: SynthesizeActorSpeechInput): Promise<SynthesizeActorSpeechResult> {
    const session = this.requireSession(stationRunId);
    const actor = this.options.scenario.actors.find((candidate) => candidate.actorId === input.actorId);
    if (!actor) {
      throw new Error(`Actor not found: ${input.actorId}`);
    }
    const frozenPlan = session.frozenActorTurnPlans.get(input.actorId);
    if (!frozenPlan) {
      throw new Error("ActorTurnPlan must be frozen before speech render");
    }

    const voiceId = frozenPlan.voiceId;
    const actorTurnExecution = executionFromFrozenPlan(frozenPlan);
    const audioEvents = await collectVoiceStream(
      this.options.voiceGateway.synthesize({
        requestId: voiceSynthesisRequestId(stationRunId, input.actorId, voiceId),
        stationRunId,
        actorId: input.actorId,
        voiceId,
        text: frozenPlan.spokenTextForTts,
        performancePlanId: frozenPlan.performancePlanId,
        policy: voiceSynthesisPolicy,
      }),
    );
    const audioTraceEvents = audioEvents.map((audioEvent) =>
      this.appendTrace(session, {
        eventType: "voice.audio.generated",
        atSecond: input.atSecond,
        source: "voice-gateway",
        actorId: input.actorId,
        payload: {
          voiceId,
          audioFormat: audioEvent.audioFormat,
          chunkIndex: audioEvent.chunkIndex,
          durationMs: audioEvent.durationMs,
          visemeCue: audioEvent.visemeCue,
          provenance: audioEvent.provenance,
          actorTurnExecution,
        },
      }),
    );
    const executedEvent = this.appendTrace(session, {
      eventType: ACTOR_TURN_EXECUTED_EVENT_TYPE,
      atSecond: input.atSecond,
      source: "voice-gateway",
      actorId: input.actorId,
      payload: { actorTurnExecution },
    });

    return { audioEvents, traceEvents: [...audioTraceEvents, executedEvent], actorTurnExecution };
  }

  submitNote(stationRunId: string, input: SubmitNoteInput): SubmitNoteResult {
    const session = this.requireSession(stationRunId);
    const assembled = session.assembledStation;
    if (session.run.phase === "encounter") {
      session.run = transitionStation(session.run, { type: "END_ENCOUNTER", atSecond: assembled?.formTiming.encounter.endsAtSecond ?? 960 });
      if (assembled) {
        this.appendAssembledPhase(session, "encounter.ended", "encounter", assembled.formTiming.encounter.endsAtSecond);
        this.appendAssembledPhase(session, "note.started", "note", assembled.formTiming.note.startsAtSecond);
      } else {
        this.options.ledger.append(
          traceEvent({
            stationRunId,
            sequence: session.nextSequence,
            eventType: "encounter.ended",
            atSecond: 960,
            source: "system",
          }),
        );
        session.nextSequence += 1;
      }
    }
    session.run = transitionStation(session.run, {
      type: "SUBMIT_NOTE",
      atSecond: input.atSecond,
      noteText: input.text,
    });
    if (assembled) {
      this.appendAssembledPhase(session, "note.submitted", "note", assembled.formTiming.note.endsAtSecond);
      this.appendAssembledPhase(
        session,
        "station.advanced",
        "complete",
        assembled.formTiming.note.endsAtSecond,
        input.advanceReason ?? "patient_note_submitted_advancing",
      );
    } else {
      this.options.ledger.append(
        traceEvent({
          stationRunId,
          sequence: session.nextSequence,
          eventType: "note.submitted",
          atSecond: input.atSecond,
          source: "learner",
          tag: "patient_note_submitted",
        }),
      );
      session.nextSequence += 1;
    }

    return {
      phase: session.run.phase,
      note: session.run.note,
    };
  }

  reviewPacket(stationRunId: string): ReviewPacket {
    const packet = this.buildReviewPacketForSession(stationRunId);
    // Sync signature preserved for API/GraphQL callers; awaitable stores fire-and-forget here.
    // Prefer reviewPacketAndPersist when durable callbacks must complete before return.
    settleDurableStoreCall(this.options.durableStore?.saveReviewPacket?.(stationRunId, packet));
    return packet;
  }

  /**
   * Build review packet and await optional durableStore.saveReviewPacket.
   * Use from CLI/async hosts that need durable completion guarantees.
   */
  async reviewPacketAndPersist(stationRunId: string): Promise<ReviewPacket> {
    const packet = this.buildReviewPacketForSession(stationRunId);
    await this.options.durableStore?.saveReviewPacket?.(stationRunId, packet);
    return packet;
  }

  saveFacultyScoreDraft(stationRunId: string, input: SaveFacultyScoreDraftInput): ReviewPacket {
    const session = this.requireSession(stationRunId);
    const reviewerId = input.reviewerId.trim();
    const comments = input.comments.trim();
    if (reviewerId.length === 0) {
      throw new Error("Faculty score draft requires reviewerId");
    }
    if (comments.length === 0) {
      throw new Error("Faculty score draft requires comments");
    }

    session.facultyScoreDraft = {
      reviewerId,
      status: "draft",
      comments,
    };
    this.options.ledger.append(traceEvent({
      stationRunId,
      sequence: session.nextSequence,
      eventType: "faculty.score_draft.saved",
      atSecond: session.run.note?.submittedAtSecond ?? 0,
      source: "faculty",
      payload: {
        reviewerId,
        rubricScoreCount: Object.keys(input.rubricScores).length,
      },
    }));
    session.nextSequence += 1;

    return this.reviewPacket(stationRunId);
  }

  traceEvents(stationRunId: string): TraceEvent[] {
    this.requireSession(stationRunId);
    return this.options.ledger.replay(stationRunId);
  }

  async providerHealth(): Promise<ProviderHealthSnapshot> {
    const [modelHealth, voiceHealth] = await Promise.all([this.options.modelGateway.health(), this.options.voiceGateway.health()]);
    // Snapshot describes what is actually wired — not a fixed four-id roster.
    return buildProviderHealthSnapshot(modelHealth, voiceHealth);
  }

  assetReadiness(): ScenarioAssetReadiness {
    return this.options.assetRegistry.evaluateScenarioReadiness(this.options.scenario);
  }

  scenarioPublicationReadiness(input: ScenarioPublicationReadinessInput): ScenarioPublicationReadiness {
    return evaluateScenarioPublicationReadiness({
      scenario: this.options.scenario,
      targetUse: input.targetUse,
      reviewerEvidence: input.reviewerEvidence,
      assetReadiness: this.assetReadiness(),
      ...(input.attestationVerifier ? { attestationVerifier: input.attestationVerifier } : {}),
    });
  }

  private requireSession(stationRunId: string): SessionRecord {
    const session = this.sessions.get(stationRunId);
    if (!session) {
      throw new Error(`Session not found: ${stationRunId}`);
    }
    return session;
  }

  private appendAssembledPhase(
    session: SessionRecord,
    eventType: ReplayablePhaseTransitionType,
    phase: "encounter" | "note" | "complete",
    formAtSecond: number,
    advanceReason?: string,
  ): void {
    const assembled = session.assembledStation;
    if (!assembled) {
      throw new Error("assembled-station context required for canonical phase event");
    }
    const doorwayStart = assembled.formTiming.doorway?.startsAtSecond ?? 0;
    const event = replayablePhaseTransitionEvent({
      stationRunId: session.run.stationRunId,
      sequence: session.nextSequence,
      eventType,
      atSecond: Math.max(0, formAtSecond - doorwayStart),
      scenarioId: assembled.scenarioId,
      examRunId: assembled.examRunId,
      stationOrder: assembled.stationOrder,
      phase,
      formAtSecond,
      ...(advanceReason ? { advanceReason } : {}),
    });
    this.options.ledger.append(event);
    session.nextSequence += 1;
  }

  private buildReviewPacketForSession(stationRunId: string): ReviewPacket {
    const session = this.requireSession(stationRunId);
    return buildReviewPacket({
      stationRunId,
      scenarioId: this.options.scenario.scenarioId,
      requiredTraceTags: this.options.scenario.requiredTraceTags,
      traceEvents: this.options.ledger.replay(stationRunId),
      ...(session.run.note ? { patientNote: session.run.note } : {}),
      facultyScoreDraft: session.facultyScoreDraft ?? {
        reviewerId: "faculty_001",
        status: "draft",
        comments: "Generated from local in-memory scenario runtime.",
      },
    });
  }

  private appendTrace(
    session: SessionRecord,
    input: {
      eventType: string;
      atSecond: number;
      source: string;
      actorId?: string;
      tag?: string;
      payload?: Record<string, unknown>;
    },
  ): TraceEvent {
    const event = traceEvent({
      stationRunId: session.run.stationRunId,
      sequence: session.nextSequence,
      eventType: input.eventType,
      atSecond: input.atSecond,
      source: input.source,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.tag ? { tag: input.tag } : {}),
      ...(input.payload ? { payload: input.payload } : {}),
    });
    this.options.ledger.append(event);
    session.nextSequence += 1;
    return event;
  }

  private actorResponseTurnCount(stationRunId: string, actorId: string): number {
    return this.options.ledger.replay(stationRunId).filter((event) =>
      (event.eventType === "actor.response.generated" || event.eventType === "actor.response.failed") && event.actorId === actorId
    ).length;
  }

  private nextConversationTurnHint(stationRunId: string): number {
    return this.options.ledger.replay(stationRunId).filter((event) =>
      event.eventType === "actor.response.generated" || event.eventType === "actor.response.failed"
    ).length + 1;
  }

  private applyHistoryTakingCoverageUpdate(
    session: SessionRecord,
    input: {
      atSecond: number;
      learnerUtterance: string;
      traceContextTags: string[];
    },
  ): HistoryTakingCoverageState {
    const update = this.conversationPolicy.updateHistoryTakingCoverage(
      session.historyTakingCoverage,
      {
        traceTags: input.traceContextTags,
        learnerUtterance: input.learnerUtterance,
      },
      session.historyTakingCoverageSpec,
    );
    session.historyTakingCoverage = update.state;

    // Emit only on state CHANGE (newly covered domains) so unchanged paths stay lean.
    if (update.newlyCoveredDomainIds.length > 0) {
      const singleNewTag =
        update.newlyCoveredDomainIds.length === 1
          ? update.state.coverageTraceTags.find((tag) =>
            tag === `history_coverage:${update.newlyCoveredDomainIds[0]}`
          )
          : undefined;
      this.appendTrace(session, {
        eventType: "conversation.history_coverage.updated",
        atSecond: input.atSecond,
        source: "conversation-policy",
        ...(singleNewTag ? { tag: singleNewTag } : {}),
        payload: {
          coveredDomainIds: [...update.state.coveredDomainIds],
          missingDomainIds: [...update.state.missingDomainIds],
          newlyCoveredDomainIds: [...update.newlyCoveredDomainIds],
          coveragePercent: update.state.coveragePercent,
          coverageTraceTags: [...update.state.coverageTraceTags],
          claimScope: update.state.claimScope,
          notEvidenceFor: [...update.state.notEvidenceFor],
        },
      });
    }

    return update.state;
  }

  private actorTurnGenerationHost() {
    return {
      scenario: this.options.scenario,
      modelGateway: this.options.modelGateway,
      ...(this.options.durableStore ? { durableStore: this.options.durableStore } : {}),
      appendTrace: this.appendTrace.bind(this),
      applyEmotionEvent: this.applyEmotionEvent.bind(this),
      applyHistoryTakingCoverageUpdate: this.applyHistoryTakingCoverageUpdate.bind(this),
    };
  }
}

export function validateAssembledStationContext(
  value: AssembledStationContext,
  runtimeScenarioId: string,
): AssembledStationContext {
  const examRunId = value.examRunId.trim();
  const scenarioId = value.scenarioId.trim();
  const timing = value.formTiming;
  if (
    examRunId.length === 0
    || scenarioId.length === 0
    || !timing
    || !isFormWindow(timing.encounter)
    || !isFormWindow(timing.note)
    || (timing.doorway !== undefined && !isFormWindow(timing.doorway))
  ) {
    throw new Error("incomplete assembled-station context");
  }
  if (!Number.isInteger(value.stationOrder) || value.stationOrder < 1) {
    throw new Error("assembled-station order must be a positive integer");
  }
  if (scenarioId !== runtimeScenarioId) {
    throw new Error(`assembled-station scenario mismatch: expected ${runtimeScenarioId} got ${scenarioId}`);
  }
  const assembled: AssembledStationContext = {
    examRunId,
    scenarioId,
    stationOrder: value.stationOrder,
    formTiming: {
      encounter: timing.encounter,
      note: timing.note,
    },
  };
  if (timing.doorway) {
    assembled.formTiming.doorway = timing.doorway;
  }
  return assembled;
}

function isFormWindow(value: unknown): value is { startsAtSecond: number; endsAtSecond: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { startsAtSecond?: unknown; endsAtSecond?: unknown };
  return Number.isInteger(record.startsAtSecond)
    && Number.isInteger(record.endsAtSecond)
    && (record.startsAtSecond as number) >= 0
    && (record.endsAtSecond as number) >= (record.startsAtSecond as number);
}

// Factory functions extracted to default-runtime-factory.ts to keep class file under freeze.
export { createDefaultScenarioRuntime, createScenarioRuntimeWithPersistenceHooks } from "./default-runtime-factory.js";
