import { createScenarioPlaceholderManifests, InMemoryAssetRegistry, type ScenarioAssetReadiness } from "@openclinxr/asset-registry";
import { createStationRun, transitionStation, type StationRun } from "@openclinxr/domain";
import {
  createDefaultModelGateway,
  LocalModelProviderAdapter,
  MockModelProviderAdapter,
  type ActorResponseResult,
  type ModelGateway,
  type ModelRequestPolicy,
} from "@openclinxr/model-gateway";
import {
  buildReviewPacket,
  evaluateScenarioPublicationReadiness,
  type PublicationTargetUse,
  type ReviewerEvidence,
  type ScenarioPublicationReadiness,
} from "@openclinxr/review-workflow";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import {
  buildActorModelContext,
  createMultiActorClinicalSession,
  recordClinicalAction as recordSessionClinicalAction,
  routeActorInteraction,
  type ActorModelContext,
  type InteractionRoutingReason,
  type MultiActorClinicalSession,
  type RecordClinicalActionInput,
  type RouteActorInteractionInput,
} from "@openclinxr/session-state";
import type { ProviderHealth, ReviewPacket, Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import { InMemoryTraceLedger } from "@openclinxr/trace-ledger";
import {
  collectVoiceStream,
  createDefaultVoiceGateway,
  LocalVoiceProviderAdapter,
  MockVoiceProviderAdapter,
  type AudioEvent,
  type VoiceGateway,
  type VoiceRequestPolicy,
} from "@openclinxr/voice-gateway";

export type { PublicationTargetUse, ReviewerEvidence, ScenarioPublicationReadiness } from "@openclinxr/review-workflow";

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
};

export type GenerateRoutedActorResponseResult = GenerateActorResponseResult & {
  routedActorId: string;
  routingReason: InteractionRoutingReason;
  routeEvent: TraceEvent;
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

type SessionRecord = {
  run: StationRun;
  multiActorSession: MultiActorClinicalSession;
  nextSequence: number;
  facultyScoreDraft?: ReviewPacket["facultyScoreDraft"];
};

type GenerateActorResponseFromContextInput = {
  actorId: string;
  learnerUtterance: string;
  atSecond: number;
  traceContextTags?: string[];
  actorContext: ActorModelContext;
  conversationTurn: number;
};

export type ScenarioRuntimeOptions = {
  scenario: Scenario;
  ledger: InMemoryTraceLedger;
  assetRegistry: InMemoryAssetRegistry;
  modelGateway: ModelGateway;
  voiceGateway: VoiceGateway;
};

export class ScenarioRuntime {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly options: ScenarioRuntimeOptions) {}

  async startSession(input: StartSessionInput): Promise<RuntimeSessionSummary> {
    if (!input.consentAccepted) {
      throw new Error("Consent is required before starting a station session");
    }

    let run = createStationRun(this.options.scenario.scenarioId, input.learnerId);
    this.options.ledger.append(traceEvent({ stationRunId: run.stationRunId, sequence: 0, eventType: "station.started", atSecond: 0, source: "system" }));
    this.options.ledger.append(traceEvent({ stationRunId: run.stationRunId, sequence: 1, eventType: "consent.accepted", atSecond: 0, source: "learner" }));
    this.sessions.set(run.stationRunId, {
      run,
      multiActorSession: createMultiActorClinicalSession({
        scenario: this.options.scenario,
        stationRunId: run.stationRunId,
      }),
      nextSequence: 2,
    });

    return {
      stationRunId: run.stationRunId,
      scenarioId: this.options.scenario.scenarioId,
      phase: run.phase,
    };
  }

  startEncounter(stationRunId: string, input: StartEncounterInput): RuntimeSessionSummary {
    const session = this.requireSession(stationRunId);
    session.run = transitionStation(session.run, { type: "START_ENCOUNTER", atSecond: input.atSecond });
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
      payload: actorInteractionRoutePayload(input, routed.routingReason),
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
    return this.generateActorResponseFromContext(session, {
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
    const generated = await this.generateActorResponseFromContext(session, {
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
    };
  }

  async synthesizeActorSpeech(stationRunId: string, input: SynthesizeActorSpeechInput): Promise<SynthesizeActorSpeechResult> {
    const session = this.requireSession(stationRunId);
    const actor = this.options.scenario.actors.find((candidate) => candidate.actorId === input.actorId);
    if (!actor) {
      throw new Error(`Actor not found: ${input.actorId}`);
    }

    const audioEvents = await collectVoiceStream(
      this.options.voiceGateway.synthesize({
        stationRunId,
        actorId: input.actorId,
        voiceId: input.voiceId,
        text: input.text,
        policy: voiceSynthesisPolicy,
      }),
    );
    const traceEvents = audioEvents.map((audioEvent) =>
      this.appendTrace(session, {
        eventType: "voice.audio.generated",
        atSecond: input.atSecond,
        source: "voice-gateway",
        actorId: input.actorId,
        payload: {
          voiceId: input.voiceId,
          audioFormat: audioEvent.audioFormat,
          chunkIndex: audioEvent.chunkIndex,
          durationMs: audioEvent.durationMs,
          visemeCue: audioEvent.visemeCue,
          provenance: audioEvent.provenance,
        },
      }),
    );

    return { audioEvents, traceEvents };
  }

  submitNote(stationRunId: string, input: SubmitNoteInput): SubmitNoteResult {
    const session = this.requireSession(stationRunId);
    if (session.run.phase === "encounter") {
      session.run = transitionStation(session.run, { type: "END_ENCOUNTER", atSecond: 960 });
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
    session.run = transitionStation(session.run, {
      type: "SUBMIT_NOTE",
      atSecond: input.atSecond,
      noteText: input.text,
    });
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

    return {
      phase: session.run.phase,
      note: session.run.note,
    };
  }

  reviewPacket(stationRunId: string): ReviewPacket {
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
    return {
      model: requireProviderHealth(modelHealth, "mock-model"),
      voice: requireProviderHealth(voiceHealth, "mock-voice"),
      localModel: requireProviderHealth(modelHealth, "local-model"),
      localVoice: requireProviderHealth(voiceHealth, "local-voice"),
    };
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
    });
  }

  private requireSession(stationRunId: string): SessionRecord {
    const session = this.sessions.get(stationRunId);
    if (!session) {
      throw new Error(`Session not found: ${stationRunId}`);
    }
    return session;
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

  private async generateActorResponseFromContext(
    session: SessionRecord,
    input: GenerateActorResponseFromContextInput,
  ): Promise<GenerateActorResponseResult> {
    const actor = this.options.scenario.actors.find((candidate) => candidate.actorId === input.actorId);
    if (!actor) {
      throw new Error(`Actor not found: ${input.actorId}`);
    }

    const traceContextTags = [...(input.traceContextTags ?? [])];
    const primaryTag = traceContextTags[0];
    const learnerEvent = this.appendTrace(session, {
      eventType: "learner.utterance",
      atSecond: input.atSecond,
      source: "learner",
      actorId: input.actorId,
      ...(primaryTag ? { tag: primaryTag } : {}),
      payload: {
        text: input.learnerUtterance,
        traceContextTags,
      },
    });
    let response: ActorResponseResult;
    try {
      response = await this.options.modelGateway.generateActorResponse({
        stationRunId: session.run.stationRunId,
        scenarioId: this.options.scenario.scenarioId,
        scenarioVersion: this.options.scenario.version,
        actorId: actor.actorId,
        actorDisplayName: actor.displayName,
        actorRole: actor.role,
        conversationTurn: input.conversationTurn,
        learnerUtterance: input.learnerUtterance,
        visibleFacts: input.actorContext.visibleMemory.facts,
        hiddenFacts: [],
        retrievedMemoryIds: input.actorContext.retrievedMemoryIds,
        traceContextTags,
        clinicalState: {
          completedTraceTags: [...input.actorContext.clinicalState.completedTraceTags],
          openOrders: input.actorContext.clinicalState.openOrders.map((order) => ({ ...order })),
        },
        policy: actorResponsePolicy,
      });
    } catch {
      this.appendTrace(session, {
        eventType: "actor.response.failed",
        atSecond: input.atSecond,
        source: "model-gateway",
        actorId: input.actorId,
        ...(primaryTag ? { tag: primaryTag } : {}),
        payload: {
          errorCode: "model_provider_error",
          traceContextTags,
        },
      });
      throw new Error("Actor response generation failed");
    }
    const actorResponseEvent = this.appendTrace(session, {
      eventType: "actor.response.generated",
      atSecond: input.atSecond,
      source: "model-gateway",
      actorId: input.actorId,
      ...(primaryTag ? { tag: primaryTag } : {}),
      payload: {
        text: response.text,
        responseKind: response.responseKind,
        traceTags: response.traceTags,
        provenance: response.provenance,
      },
    });

    return {
      conversationTurn: input.conversationTurn,
      response,
      learnerEvent,
      actorResponseEvent,
    };
  }
}

export function createDefaultScenarioRuntime(): ScenarioRuntime {
  const assetRegistry = new InMemoryAssetRegistry();
  for (const manifest of createScenarioPlaceholderManifests(edChestPainScenario)) {
    assetRegistry.upsert(manifest);
  }

  return new ScenarioRuntime({
    scenario: edChestPainScenario,
    ledger: new InMemoryTraceLedger(),
    assetRegistry,
    modelGateway: createDefaultModelGateway({
      routeId: "actor-dialogue-offline-v1",
      adapters: [new MockModelProviderAdapter(), new LocalModelProviderAdapter({ providerId: "local-model" })],
    }),
    voiceGateway: createDefaultVoiceGateway({
      routeId: "voice-offline-v1",
      adapters: [new MockVoiceProviderAdapter(), new LocalVoiceProviderAdapter({ providerId: "local-voice" })],
    }),
  });
}

type TraceEventInput = {
  stationRunId: string;
  sequence: number;
  eventType: string;
  atSecond: number;
  source: string;
  tag?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
};

function traceEvent(input: TraceEventInput): TraceEvent {
  const event: TraceEvent = {
    stationRunId: input.stationRunId,
    sequence: input.sequence,
    eventType: input.eventType,
    occurredAt: occurredAt(input.atSecond),
    atSecond: input.atSecond,
    source: input.source,
    payload: input.payload ?? {},
  };

  if (input.tag) {
    event.tag = input.tag;
  }
  if (input.actorId) {
    event.actorId = input.actorId;
  }

  return event;
}

const actorResponsePolicy: ModelRequestPolicy = {
  requestPolicyId: "actor-dialogue-offline-v1",
  promptTemplateId: "mock-actor-response-v1",
  safetyPolicyVersion: "clinical-simulation-safety-v1",
};

const voiceSynthesisPolicy: VoiceRequestPolicy = {
  requestPolicyId: "voice-offline-v1",
  safetyPolicyVersion: "clinical-simulation-safety-v1",
};

function occurredAt(atSecond: number): string {
  return new Date(Date.parse("2026-05-03T15:38:58.000Z") + atSecond * 1000).toISOString();
}

function requireProviderHealth(health: ProviderHealth[], providerId: string): ProviderHealth {
  const provider = health.find((entry) => entry.providerId === providerId);
  if (!provider) {
    throw new Error(`Missing provider health for ${providerId}`);
  }
  return provider;
}

function actorInteractionRoutePayload(
  input: RouteRuntimeActorInteractionInput,
  routingReason: RouteRuntimeActorInteractionResult["routingReason"],
): Record<string, unknown> {
  const traceContextTags = [...(input.traceContextTags ?? [])];
  const base = {
    learnerUtterance: input.learnerUtterance,
    routingReason,
    traceContextTags,
  };

  if (input.source?.kind === "voice_transcript") {
    return {
      ...base,
      sourceKind: "voice_transcript",
      streamId: input.source.streamId,
      transcriptSegmentId: input.source.transcriptSegmentId,
      provider: input.source.provider,
      provenanceRefs: [...input.source.provenanceRefs],
      rawAudioStored: false,
    };
  }

  return {
    ...base,
    sourceKind: "text",
    provenanceRefs: [...(input.source?.provenanceRefs ?? [])],
  };
}
