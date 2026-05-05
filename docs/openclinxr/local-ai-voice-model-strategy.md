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

The refreshed 2026-05-04 probe records Node 22.19.0, pnpm 10.33.0, Python 3.11.4, ffmpeg 8.1, adb, Homebrew 5.1.8, Blender 5.1.1, `llama.cpp` 9010, and the pinned pnpm `gltf-pipeline` CLI as available. Quest USB and foreground preflight are ready after the headset wake rerun, but Quest frame pacing still needs a manual foreground headset performance report because CDP sampling continues to classify the browser page as hidden.

The refreshed 2026-05-05 probe records Bun 1.3.13 and Portless 0.12.0 as available, while Ollama and MLX LM remain missing from PATH. Since this strategy was first written, Codex has recorded approved local-model and local-voice benchmark evidence: `docs/openclinxr/local-model-runtime-benchmark-2026-05-04.json` for Qwen3-4B through `llama.cpp`, and `docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json` for VibeVoice-Realtime-0.5B file generation. Those clear basic local execution smoke gates, but not live clinical dialogue. Blender-backed placeholder asset baking now has a passing local smoke report, but production avatar generation still needs rigging, LOD, texture, collider, and headset-performance evidence.

## Recommended Local Reasoning Stack

### Runtime Candidates

| Runtime | Role | Recommendation |
| --- | --- | --- |
| MLX LM | Apple Silicon optimized Python runtime | Preferred first Apple Silicon reasoning spike |
| llama.cpp | GGUF runtime with Metal support | Installed through Homebrew as the first portable runtime; blocked on model selection/benchmark |
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

Current intake: `docs/openclinxr/spikes/vibevoice-local-voice-spike.md` records the safe spike boundary. Patrick approved the local voice runtime proposal on 2026-05-04, Codex installed the local wrapper outside committed source, and `docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json` recorded first local file-generation evidence. VibeVoice remains disabled for learner-facing station runtime and blocked on true streaming latency, Quest/WebXR playback, safety/disclosure/retention controls, and real-time multi-actor turn-taking evidence.

### Realtime Voice Transport Position

`docs/openclinxr/realtime-voice-transport-spike-2026-05-04.json` records a no-cloud bidirectional WebSocket transport harness through the Hono gateway shape and a Python-compatible backend fixture. `apps/api-python-backend` defines the FastAPI backend surface for future MLX/Moshi or Qwen3-TTS inference, and `apps/ui-quest-voice-godot` defines a source-level Quest/Godot `WebSocketPeer` client contract.

This lane is useful because it separates transport evidence from model evidence:

- WebSocket-first is the immediate path.
- Bun/Hono is now locally smoke-verified for the `/voice/realtime/ws` WebSocket lane; Node/Hono remains the local fallback for non-Bun development tasks.
- WebTransport, QUIC, and Web3 signaling stay protocol-posture entries, not runtime claims.
- Moshi MLX and Qwen3-TTS remain future local inference candidates.
- The Godot sidecar proves source shape only; it does not prove Quest microphone capture, native Opus encode/decode, playback, or headset latency.

Follow-up runtime evidence: `docs/openclinxr/api-python-backend-runtime-smoke-2026-05-05.json` proves the FastAPI backend can run in an ignored local venv and satisfy health plus JSON/binary WebSocket frame handling with canonical realtime voice protocol and latency-field proof. `apps/api` now has an opt-in Bun proxy boundary controlled by `OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL`; `docs/openclinxr/api-bun-python-proxy-smoke-2026-05-05.md` and `docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json` record a local Bun-to-FastAPI proxy pass. With no backend URL, the local Bun smoke remains deterministic echo evidence. Live dialog remains blocked on real local inference, audio codec, Quest capture/playback, and safety controls.

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

This section covers live interactive model and voice swaps only. It is intentionally separate from the asset-generation pipeline, where Python and native executables may be valid in production for batch generation of characters, prerecorded voice assets, medical equipment, animations, textures, and optimized scene outputs behind `@openclinxr/capability-gateway`.

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

- `pnpm local:provider:benchmark -- --env-file .env.openclinxr.local --output docs/openclinxr/local-provider-benchmark-2026-05-04.json`
- Deterministic mock model benchmark passed with zero cost.
- Deterministic mock voice benchmark passed with transcript and audio-chunk evidence.
- Local model candidate intake accepts only source-backed first candidates: `Qwen/Qwen3-4B-GGUF` (`src-qwen3-4b-gguf-2026`) and `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` (`src-deepseek-r1-distill-qwen-2025`).
- `docs/openclinxr/local-model-runtime-benchmark-2026-05-04.json` records the first approved real local Qwen GGUF benchmark through `llama.cpp`; it passes as a latency smoke but has structured-output caveats. `pnpm local:model:runtime -- --parse-log <local-log> --output <report.json>` can now harvest that local raw log into a versioned JSON report without rerunning inference, downloading weights, or using cloud APIs; it does not make stale runtime evidence fresh.
- Local voice candidate intake accepts only `microsoft/VibeVoice-Realtime-0.5B` (`src-vibevoice-github-2026`).
- `docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json` records the first approved local VibeVoice file-generation benchmark; it passes as a file-output smoke but is too slow for live Quest dialog and does not prove streaming playback latency.
- `docs/openclinxr/realtime-voice-transport-spike-2026-05-04.json` records the first bidirectional realtime voice transport spike. It passes the local transport contract but keeps live dialog blocked because no real local voice/model stream, Quest microphone capture, Opus codec path, or headset playback latency was observed.
- `docs/openclinxr/api-python-backend-runtime-smoke-2026-05-05.json` records the first real FastAPI backend runtime smoke with canonical protocol proof in an ignored local venv. It passes health and WebSocket JSON/binary frame handling but does not execute a voice model or Quest audio path.
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
