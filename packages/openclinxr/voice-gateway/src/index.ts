import type { ProviderHealth } from "@openclinxr/shared-schemas";

export type VoiceCapability = "transcription" | "synthesis" | "viseme_cues";

export type VoiceRequestPolicy = {
  requestPolicyId: string;
  safetyPolicyVersion: string;
};

export type VoiceProvenance = {
  providerId: string;
  modelId: string;
  modelVersion: string;
  requestPolicyId: string;
  safetyPolicyVersion: string;
  latencyMs: number;
  costEstimateUsd: number;
};

export type SpeechInput = {
  stationRunId: string;
  streamId: string;
  language: string;
  audioFormat: string;
  policy: VoiceRequestPolicy;
};

export type SpeechSynthesisRequest = {
  stationRunId: string;
  actorId: string;
  voiceId: string;
  text: string;
  policy: VoiceRequestPolicy;
};

export type TranscriptEvent = {
  eventType: "partial_transcript" | "final_transcript";
  text: string;
  confidence: number;
  atMs: number;
  provenance: VoiceProvenance;
};

export type AudioEvent = {
  eventType: "audio_chunk";
  audioFormat: string;
  chunkIndex: number;
  durationMs: number;
  visemeCue: string;
  provenance: VoiceProvenance;
};

export interface VoiceProviderAdapter {
  readonly id: string;
  readonly capabilities: VoiceCapability[];
  health(): Promise<ProviderHealth>;
  transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent>;
  synthesize(input: SpeechSynthesisRequest): AsyncIterable<AudioEvent>;
}

export type VoiceGatewayOptions = {
  adapters: VoiceProviderAdapter[];
  routeId: string;
};

export class VoiceGateway {
  constructor(private readonly options: VoiceGatewayOptions) {}

  async health(): Promise<ProviderHealth[]> {
    return Promise.all(this.options.adapters.map((adapter) => adapter.health()));
  }

  async *transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent> {
    const adapter = await this.firstReadyAdapter("transcription");
    yield* adapter.transcribe(input);
  }

  async *synthesize(input: SpeechSynthesisRequest): AsyncIterable<AudioEvent> {
    const adapter = await this.firstReadyAdapter("synthesis");
    yield* adapter.synthesize(input);
  }

  private async firstReadyAdapter(capability: VoiceCapability): Promise<VoiceProviderAdapter> {
    for (const adapter of this.options.adapters) {
      const health = await adapter.health();
      if (health.status === "ready" && adapter.capabilities.includes(capability)) {
        return adapter;
      }
    }

    throw new Error(`No ready voice provider for route ${this.options.routeId}`);
  }
}

export function createDefaultVoiceGateway(options: VoiceGatewayOptions): VoiceGateway {
  return new VoiceGateway(options);
}

export async function collectVoiceStream<TEvent>(events: AsyncIterable<TEvent>): Promise<TEvent[]> {
  const collected: TEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

export class MockVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly id = "mock-voice";
  readonly capabilities: VoiceCapability[] = ["transcription", "synthesis", "viseme_cues"];

  async health(): Promise<ProviderHealth> {
    return { providerId: this.id, status: "ready" };
  }

  async *transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent> {
    const provenance = this.provenance(input.policy);
    yield {
      eventType: "partial_transcript",
      text: "When did",
      confidence: 0.75,
      atMs: 120,
      provenance,
    };
    yield {
      eventType: "final_transcript",
      text: "When did the chest pressure start?",
      confidence: 0.99,
      atMs: 420,
      provenance,
    };
  }

  async *synthesize(input: SpeechSynthesisRequest): AsyncIterable<AudioEvent> {
    yield {
      eventType: "audio_chunk",
      audioFormat: "audio/mock",
      chunkIndex: 0,
      durationMs: 1100,
      visemeCue: "neutral-pain",
      provenance: this.provenance(input.policy),
    };
  }

  private provenance(policy: VoiceRequestPolicy): VoiceProvenance {
    return {
      providerId: this.id,
      modelId: "deterministic-voice-mock",
      modelVersion: "1.0.0",
      requestPolicyId: policy.requestPolicyId,
      safetyPolicyVersion: policy.safetyPolicyVersion,
      latencyMs: 0,
      costEstimateUsd: 0,
    };
  }
}

export type LocalVoiceProviderOptions = {
  providerId: string;
};

export class LocalVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly capabilities: VoiceCapability[] = ["transcription", "synthesis", "viseme_cues"];

  constructor(private readonly options: LocalVoiceProviderOptions) {}

  get id(): string {
    return this.options.providerId;
  }

  async health(): Promise<ProviderHealth> {
    return { providerId: this.id, status: "not_configured" };
  }

  async *transcribe(): AsyncIterable<TranscriptEvent> {
    throw new Error(`Local voice provider ${this.id} is not configured`);
  }

  async *synthesize(): AsyncIterable<AudioEvent> {
    throw new Error(`Local voice provider ${this.id} is not configured`);
  }
}
