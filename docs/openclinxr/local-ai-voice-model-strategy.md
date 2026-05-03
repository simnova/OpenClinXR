# Local AI And Voice Model Strategy

Date: 2026-05-03
Status: Development-team guidance

## Purpose

The user wants to minimize cloud charges and avoid third-party API usage while still planning for reasoning and voice capabilities. This strategy replaces the previous "Grok as likely production provider" posture with a local-first adapter strategy.

Cloud providers remain future options. They are not required for the first implementation plan.

## Local-First Policy

Default development mode:

- No Grok API calls.
- No paid cloud inference.
- No automatic model downloads during normal tests.
- Mock providers are the default for CI and deterministic tests.
- Local model providers are opt-in and run behind environment flags.
- Every local model has a model card record, license record, hardware profile, and benchmark report.

## Current Hardware Reality

The machine used for this spike reports Apple M1 Max with 64 GB RAM. The user mentioned Apple M4 Pro as a target. Treat M4 Pro/M4 Max support as a target profile, not proven by this machine.

The current machine lacks Bun, Blender, Ollama, llama.cpp binaries, Whisper binaries, and MLX LM. The pinned pnpm `gltf-pipeline` CLI is now available for permissive GLB conversion/optimization checks, but local model execution remains a planned spike, not a completed benchmark.

## Recommended Local Reasoning Stack

### Runtime Candidates

| Runtime | Role | Recommendation |
| --- | --- | --- |
| MLX LM | Apple Silicon optimized Python runtime | Preferred first Apple Silicon reasoning spike |
| llama.cpp | GGUF runtime with Metal support | Preferred portable runtime and local server spike |
| Ollama | Convenience wrapper over local models | Useful developer convenience, not core abstraction |
| Transformers/PyTorch MPS | Baseline compatibility | Avoid as first path unless MLX/llama.cpp fails |

### Model Tiers

| Tier | Candidate | Intended use | Hardware posture |
| --- | --- | --- | --- |
| Smoke | Qwen3-4B-GGUF or MLX 4-bit | Adapter wiring, prompt policy tests, schema output | Very likely feasible on 64 GB after install |
| Developer default | Qwen3-8B GGUF/MLX or DeepSeek-R1-Distill-Qwen-7B quantized | Local actor-policy and reasoning experiments | Likely feasible, benchmark required |
| Deep local review | DeepSeek-R1-Distill-Qwen-14B quantized | Slower adversarial critique and plan review | Possibly feasible on 64 GB, benchmark required |
| Overnight only | DeepSeek-R1-Distill-Qwen-32B quantized | Noninteractive critique if acceptable latency | Risky on 64 GB, benchmark before use |
| Not laptop-default | Kimi-K2-Thinking | Future on-prem/prosumer or provider candidate | Not feasible as laptop default; 1T total params |

### Kimi Position

Kimi-K2-Thinking is impressive as an open-weight reasoning model, but it is a 1T total parameter MoE with 32B activated parameters and large deployment expectations. It should not be the local laptop default for OpenClinXR. Use smaller Qwen or DeepSeek-Qwen models for local work, and keep Kimi as a future on-prem or hosted provider option after hardware, license, and safety review.

## Recommended Local Voice Stack

### VibeVoice Position

VibeVoice is a credible local voice research candidate:

- MIT repository license.
- VibeVoice-Realtime-0.5B is described as streaming text input with low first audible latency.
- VibeVoice-ASR is described as long-form multilingual structured transcription.

But it is not production-ready by assumption:

- The README warns about biased, inaccurate, unexpected output.
- The README highlights deepfake/disinformation misuse risk.
- The README says real-world/commercial use is not recommended without further testing and development.
- VibeVoice-TTS code history includes removal after misuse concerns.

Recommendation: build `VoiceProviderAdapter` support for VibeVoice, but keep it disabled by default until local benchmark, voice-safety review, license review, and disclosure UX pass.

### Voice Fallback Ladder

| Layer | Default | Local experimental | Gate |
| --- | --- | --- | --- |
| Station CI | Text-only mock voice | None | Always on |
| Developer demo | Browser speech synthesis or prerecorded clips | VibeVoice-Realtime-0.5B | Local install + latency + safety |
| STT | Text input fixture | Whisper.cpp, VibeVoice-ASR, or platform speech | Medical vocabulary WER |
| TTS | Prerecorded voice clips | VibeVoice or another local TTS | First audio latency + disclosure |
| Production | Provider adapter selected later | Local/on-prem if validated | Privacy, procurement, safety, cost |

## Adapter Contracts

Local reasoning and voice should use the same provider boundary as cloud providers.

```ts
export interface LocalModelRuntime {
  readonly runtimeId: "mock" | "mlx-lm" | "llama-cpp" | "ollama";
  readonly modelId: string;
  health(): Promise<LocalRuntimeHealth>;
  generate(request: LocalGenerationRequest): AsyncIterable<LocalGenerationEvent>;
}

export interface LocalVoiceRuntime {
  readonly runtimeId: "mock" | "vibevoice" | "whisper-cpp" | "browser-speech";
  health(): Promise<LocalRuntimeHealth>;
  synthesize(request: LocalSpeechSynthesisRequest): AsyncIterable<LocalAudioEvent>;
  transcribe(request: LocalTranscriptionRequest): AsyncIterable<LocalTranscriptEvent>;
}
```

All runtime calls must log:

- Runtime ID.
- Model ID.
- Model file path or model repo.
- Quantization.
- License ID.
- Hardware profile.
- Prompt template or voice script ID.
- Latency metrics.
- Token/audio usage.
- Safety/grounding result.

## Local Benchmark Harness

The benchmark harness should run without cloud services:

1. `mock-fast`: deterministic schema output.
2. `mock-slow`: deterministic delayed output to test timers.
3. `local-llm-small`: Qwen3-4B.
4. `local-llm-default`: Qwen3-8B or DeepSeek-R1-Distill-Qwen-7B.
5. `local-voice-mock`: prerecorded audio chunk stream.
6. `local-vibevoice`: VibeVoice-Realtime-0.5B after install.

First executable status:

- `pnpm local:provider:benchmark -- --output docs/openclinxr/local-provider-benchmark-2026-05-03.json`
- Deterministic mock model benchmark passed with zero cost.
- Deterministic mock voice benchmark passed with transcript and audio-chunk evidence.
- Local model benchmark remains `not_configured` because no Ollama, llama.cpp, or MLX LM runtime is detected and `OPENCLINXR_LOCAL_MODEL_RUNTIME` / `OPENCLINXR_LOCAL_MODEL_ID` are unset.
- Local voice benchmark remains `not_configured` because no VibeVoice runtime is detected and `OPENCLINXR_LOCAL_VOICE_RUNTIME` / `OPENCLINXR_LOCAL_VOICE_ID` are unset.
- The script explicitly records `cloudCallsAllowed: false`, `modelDownloadsAllowed: false`, and `localRuntimeExecutionAllowed: false`.

Metrics:

- Time to first token.
- Tokens per second.
- JSON schema adherence.
- Actor grounding adherence.
- Communication-style adherence.
- Memory retrieval sensitivity.
- First audio latency.
- Real-time factor for TTS.
- Transcript word error rate on medical vocabulary.
- Peak memory.
- Thermal throttling observation.

## Install Gates

Before enabling a local runtime:

- Record model license.
- Record model size and disk requirement.
- Record exact install commands.
- Record uninstall commands.
- Store benchmark output in `docs/openclinxr/spikes/`.
- Keep default tests independent of model downloads.

## Implementation Plan Impact

The first code implementation should:

- Build mock providers first.
- Add local provider contracts second.
- Add health checks and benchmark CLI third.
- Add MLX/llama.cpp/VibeVoice adapters as optional packages.
- Never require local model installs for CI or basic development.

## Sources

- `src-local-hardware-spike-2026-05-03`
- `src-vibevoice-github-2026`
- `src-mlx-lm-github-2026`
- `src-qwen-local-docs-2026`
- `src-qwen3-4b-gguf-2026`
- `src-deepseek-r1-distill-qwen-2025`
- `src-kimi-k2-thinking-2026`
