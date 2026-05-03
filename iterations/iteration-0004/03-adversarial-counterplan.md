# Adversarial Counterplan

## Attack

The local-first plan can still fail if it quietly assumes optional runtimes are available. The current machine lacks Bun, Blender, gltf-transform, MLX, llama.cpp, Ollama, Whisper, and VibeVoice. The implementation plan must not depend on any of them for baseline success.

## Required Replacements

- Replace all provider calls with mock providers in CI.
- Replace Bun requirement with Node-compatible Hono until Bun passes a spike.
- Replace live local voice with mock/prerecorded audio until VibeVoice passes safety and latency gates.
- Replace Kimi local default with Qwen/DeepSeek smaller model tiers.
- Replace asset generation with manifest validation until Blender/gltf-transform are installed.

## Residual Risk

Local-only development may produce lower actor-dialogue fidelity than cloud frontier providers. That is acceptable for the first implementation because the first goal is architecture correctness, traceability, and review workflow.
