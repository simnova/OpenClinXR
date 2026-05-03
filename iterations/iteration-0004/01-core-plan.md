# Core Plan

## Position

The first implementation should run without Grok or any cloud model provider. Local model and voice runtimes are valuable, but they must be optional because they are not installed and not yet benchmarked.

## Added Artifacts

- `docs/openclinxr/local-hardware-spike-results.md`
- `docs/openclinxr/local-ai-voice-model-strategy.md`
- Source records for VibeVoice, MLX LM, Qwen local docs, Qwen3-4B-GGUF, DeepSeek-R1-Distill-Qwen, Kimi-K2-Thinking, and the local hardware spike.
- MADRs 0021 through 0024.

## Core Recommendation

Use this local stack order:

1. Mock model and voice providers.
2. MLX LM or llama.cpp for Qwen3-4B smoke.
3. Qwen3-8B or DeepSeek-R1-Distill-Qwen-7B for developer local reasoning.
4. VibeVoice-Realtime-0.5B for local TTS only after safety and benchmark gates.
5. Kimi-K2-class models remain future on-prem/provider candidates, not laptop defaults.

## Evidence Added

The local hardware spike confirms the current laptop can support TypeScript planning and local simulation tests, but cannot yet prove Bun, XR, asset pipeline, local LLM, or voice assumptions.
