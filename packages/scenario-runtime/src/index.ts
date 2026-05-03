import { createEdChestPainPlaceholderManifests, InMemoryAssetRegistry, type ScenarioAssetReadiness } from "@openclinxr/asset-registry";
import { createStationRun, transitionStation, type StationRun } from "@openclinxr/domain";
import { createDefaultModelGateway, LocalModelProviderAdapter, MockModelProviderAdapter, type ModelGateway } from "@openclinxr/model-gateway";
import { buildReviewPacket } from "@openclinxr/review-workflow";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import type { ProviderHealth, ReviewPacket, Scenario, TraceEvent } from "@openclinxr/shared-schemas";
import { InMemoryTraceLedger } from "@openclinxr/trace-ledger";
import { createDefaultVoiceGateway, LocalVoiceProviderAdapter, MockVoiceProviderAdapter, type VoiceGateway } from "@openclinxr/voice-gateway";

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

export type StartEncounterInput = {
  atSecond: number;
};

export type SubmitNoteResult = {
  phase: StationRun["phase"];
  note: StationRun["note"];
};

type SessionRecord = {
  run: StationRun;
  nextSequence: number;
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
    this.sessions.set(run.stationRunId, { run, nextSequence: 2 });

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
    this.requireSession(stationRunId);
    return buildReviewPacket({
      stationRunId,
      scenarioId: this.options.scenario.scenarioId,
      requiredTraceTags: this.options.scenario.requiredTraceTags,
      traceEvents: this.options.ledger.replay(stationRunId),
      facultyScoreDraft: {
        reviewerId: "faculty_001",
        status: "draft",
        comments: "Generated from local in-memory scenario runtime.",
      },
    });
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

  private requireSession(stationRunId: string): SessionRecord {
    const session = this.sessions.get(stationRunId);
    if (!session) {
      throw new Error(`Session not found: ${stationRunId}`);
    }
    return session;
  }
}

export function createDefaultScenarioRuntime(): ScenarioRuntime {
  const assetRegistry = new InMemoryAssetRegistry();
  for (const manifest of createEdChestPainPlaceholderManifests()) {
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
};

function traceEvent(input: TraceEventInput): TraceEvent {
  const event: TraceEvent = {
    stationRunId: input.stationRunId,
    sequence: input.sequence,
    eventType: input.eventType,
    occurredAt: occurredAt(input.atSecond),
    atSecond: input.atSecond,
    source: input.source,
    payload: {},
  };

  if (input.tag) {
    event.tag = input.tag;
  }
  if (input.actorId) {
    event.actorId = input.actorId;
  }

  return event;
}

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
