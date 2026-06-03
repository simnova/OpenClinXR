# MADR 0022: Use MLX And llama.cpp Model Tiers For Local Reasoning

Status: Accepted for planning
Date: 2026-05-03

## Context

The user suggested optimized Apple Silicon Qwen, Kimi, and DeepSeek models as local alternatives to Grok reasoning. The current machine is Apple M1 Max with 64 GB RAM, not the user's mentioned M4 Pro, and no local LLM runtime is installed.

## Decision

Use a model-tier strategy:

- Qwen3-4B for smoke tests.
- Qwen3-8B or DeepSeek-R1-Distill-Qwen-7B quantized for developer-default local reasoning experiments.
- DeepSeek-R1-Distill-Qwen-14B quantized for deeper local critique if benchmark passes.
- Kimi-K2-class models are not laptop defaults because Kimi-K2-Thinking is a 1T total parameter MoE.

Support MLX LM and llama.cpp first. Ollama can be a convenience wrapper but not the core abstraction.

## Consequences

Positive:

- Fits Apple Silicon constraints better than trying to run frontier-scale models locally.
- Keeps local reasoning useful for mock actors, fixture expansion, and adversarial critique.
- Preserves future Kimi/on-prem options without overcommitting.

Negative:

- Smaller models may not match Grok/frontier reasoning quality.
- Model license and quantization provenance must be recorded per model.
- Local setup requires installed runtimes and large downloads.

## Reversal Trigger

Revisit if M4 Pro/M4 Max benchmarks show a larger model meets latency, memory, license, and quality requirements.

## Sources

- `src-qwen-local-docs-2026`
- `src-qwen3-4b-gguf-2026`
- `src-deepseek-r1-distill-qwen-2025`
- `src-kimi-k2-thinking-2026`
- `src-local-hardware-spike-2026-05-03`
