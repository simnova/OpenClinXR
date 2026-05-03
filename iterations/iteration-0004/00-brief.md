# Iteration 0004 Brief

Date: 2026-05-03
Loop focus: local-only feasibility, current hardware, no-cloud provider posture, VibeVoice, MLX, llama.cpp, Qwen, DeepSeek, and Kimi fit.

## User Instruction

Continue iterating toward an exhaustive code implementation plan. Use local hardware where possible and avoid cloud charges or third-party API calls. Consider VibeVoice as a local voice alternative and Apple Silicon optimized Qwen/Kimi/DeepSeek models as local reasoning alternatives.

## Local Spike Summary

The current machine reports Apple M1 Max with 64 GB RAM, not the mentioned M4 Pro. Node, npm, pnpm, Python, and ffmpeg are present. Bun, Blender, gltf-transform, Ollama, llama.cpp binaries, Whisper binaries, and MLX are not installed.

Lightweight local smokes showed TypeScript/Node JSON serialization, schema validation, and synthetic vector retrieval are not near-term blockers. Local LLM, local voice, asset pipeline, and Quest 3 performance remain gated spikes.

## Iteration Goal

Shift the plan from cloud-optional to local-first:

- Mock providers by default.
- Optional local model/voice adapters.
- No automatic model downloads.
- No cloud API calls.
- Model and voice benchmark records before runtime enablement.
