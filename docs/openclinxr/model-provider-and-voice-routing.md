# Model Provider And Voice Routing

Date: 2026-05-03
Status: Development-team guidance with first offline contracts implemented

## Purpose

OpenClinXR should use frontier models and voice systems without binding clinical simulation logic to any one provider. The system should support Grok APIs for production experiments, local LLMs for development, and future providers through the same auditable contract.

## Provider Adapter Boundary

All model calls should go through typed adapters. The full target boundary is:

```ts
export interface ModelProviderAdapter {
  id: string;
  capabilities: ModelCapability[];
  generateActorResponse(input: ActorResponseRequest): Promise<ActorResponseResult>;
  generateScenarioDraft(input: ScenarioDraftRequest): Promise<ScenarioDraftResult>;
  reviewScenario(input: ScenarioReviewRequest): Promise<ScenarioReviewResult>;
}

export interface VoiceProviderAdapter {
  id: string;
  capabilities: VoiceCapability[];
  transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent>;
  synthesize(input: SpeechSynthesisRequest): AsyncIterable<AudioEvent>;
}
```

First implementation status:

- `packages/model-gateway` implements `ModelGateway`, `ModelProviderAdapter`, `MockModelProviderAdapter`, and `LocalModelProviderAdapter`.
- `packages/model-gateway` currently implements actor responses and health routing; scenario draft and scenario review methods remain planned.
- `packages/voice-gateway` implements `VoiceGateway`, `VoiceProviderAdapter`, `MockVoiceProviderAdapter`, `LocalVoiceProviderAdapter`, and `collectVoiceStream`.
- Mock model and voice providers are deterministic, offline, zero-cost, and return provenance.
- Local model and voice providers are intentionally visible but report `not_configured` until a real local runtime command or adapter is installed.
- The deterministic ED chest pain harness now obtains provider health through the gateways instead of hard-coded health literals.

Adapters must return provenance:

- Provider ID.
- Model ID and version.
- Request policy ID.
- Prompt template ID.
- Scenario version.
- Actor card version.
- Retrieved memory IDs.
- Safety policy version.
- Latency and token/audio usage.
- Cost estimate.
- Guardrail result.

OpenTelemetry alignment:

- Wrap each model and voice provider call in spans such as `openclinxr.model.generate_actor_response` and `openclinxr.voice.synthesize`.
- Attach low-cardinality attributes for `openclinxr.scenario_id`, `openclinxr.scenario_version`, `openclinxr.station_run_id`, `openclinxr.actor_id`, `openclinxr.provider_id`, `openclinxr.route_id`, and `openclinxr.request_policy_id`.
- Record latency, token/audio duration, guardrail status, and fallback status as metrics or span attributes.
- Do not attach prompt text, hidden facts, learner transcript text, raw audio, or patient-note text as span attributes.
- Correlate OpenTelemetry trace IDs with trace-ledger events so faculty replay can connect station behavior with infrastructure timing.

## Routing Policy

First implementation:

- Mock provider for deterministic testing.
- Local provider for development experiments on M4 Max.
- One cloud frontier provider for real dialogue tests after privacy review.
- Voice provider behind the same trace/audit model.

Production candidates:

- Grok voice and reasoning models where procurement, privacy, and safety reviews approve.
- Additional frontier providers for failover and comparative QA.
- Local models only for demos, offline authoring, and regression harnesses unless their clinical performance and license posture are separately approved.

Routing example:

```json
{
  "route_id": "actor-dialogue-prod-v1",
  "task": "actor_response",
  "primary": "grok_voice_or_reasoning_adapter",
  "fallback": "text_frontier_adapter",
  "offline_test": "local_llama_cpp_adapter",
  "constraints": {
    "no_phi": true,
    "max_first_audio_ms": 2500,
    "must_return_grounding": true,
    "must_return_guardrail_status": true
  }
}
```

## Voice Turn-Taking

The runtime should separate these streams:

- Learner speech detection.
- Partial transcript.
- Final transcript.
- Intent and trace classification.
- Actor response text.
- Actor audio chunks.
- Viseme/gesture cues.
- Station state events.

Do not block station state on perfect transcription. Record uncertainty and let faculty replay the transcript/audio later.

## Grok Adapter Notes

The xAI docs and 2026 product announcement make Grok relevant for production voice experiments, especially low-latency conversational speech. This supports investigation; it does not by itself prove medical education suitability, privacy readiness, cost fitness, or clinical accuracy.

Required gates before production use:

- Data-use and retention review.
- HIPAA/FERPA/institutional privacy review where applicable.
- Latency benchmark from Quest 3 through Azure.
- Medical vocabulary ASR benchmark.
- Actor-style adherence benchmark.
- Failover behavior.
- Cost per station and cost per exam form.
- Human reviewer override path.

Implementation note: no Grok API, cloud provider, paid API, or downloaded local runtime is used in the current codebase.

## Local Model Mode

M4 Max local mode can support:

- Scenario draft brainstorming.
- Dialogue policy regression.
- Deterministic fixture expansion.
- Synthetic learner utterance generation.
- Offline demo when internet is unavailable.

Local model mode must record model license, quantization, prompt template, and hardware profile. It should not be used for claims of clinical validity.

## Safety And Privacy Rules

- No real patient data in prompts for the first product.
- Scenario-bank data is synthetic and versioned.
- Model outputs cannot directly publish stations.
- Model-generated cases require human clinical, psychometric, legal/compliance, and simulation QA review.
- Actor responses that affect scoring require explicit/implicit grounding.
- Provider calls must be replayable through stored request metadata without storing secrets.
- Raw audio retention should be configurable and minimized.

## Evaluation Harness

Every provider candidate should run against:

- Fixed actor-card prompts.
- Synthetic learner transcripts.
- Adversarial learner prompts.
- Speech recognition medical vocabulary set.
- Communication-style adherence cases.
- Grounding audit cases.
- Latency and cost benchmark.

Output metrics:

- First token/audio latency.
- End-to-end turn latency.
- Explicit/implicit/fictional response rate.
- Style adherence score.
- Repetition score.
- Guardrail pass/fail rate.
- Cost per station.
- Reviewer acceptance rate.
- OpenTelemetry span duration by provider route.
- Fallback and timeout rate by provider route.

## Sources

- `src-xai-grok-voice-think-fast-2026`
- `src-xai-voice-api-docs-2026`
- `src-llama-cpp-github-2026`
- `src-npm-stack-metadata-2026-05-03`
- `src-opentelemetry-js-semantics-2026`
- `src-local-laverde-llm-agents-pdf-2025`
- `src-local-bodonhelyi-medical-communication-pdf-2025`
