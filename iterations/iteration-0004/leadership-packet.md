# Leadership Packet: iteration-0004

## Score Summary

```text
iterations/iteration-0004/06-leadership-scorecard.json
  plan_type: leadership-review
  weighted_score: 4.563
  composite_score: 4.564
  confidence: 0.90
  critical_risks: 1
  evidence_debt: 2
  decision_debt: 1
```


---

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



---

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



---

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



---

# Core Revision

The core team accepts the adversarial corrections.

Revised default:

- CI uses mock providers only.
- Local dev uses pnpm and Node-compatible Hono until Bun is installed.
- Local LLM and VibeVoice adapters exist as contracts and optional spike packages.
- Kimi-K2 is removed from laptop-default planning.
- Asset generation remains manifest-only until tools are installed.

This revision directly informs the implementation plan and MADRs 0021 through 0024.



---

# Leadership Review

Leadership accepts iteration 0004.

The main value is discipline: the plan no longer depends on paid APIs or uninstalled local runtimes. The local spike also corrected the hardware assumption from M4 Pro to the actual M1 Max 64 GB machine.

Required actions:

- Keep mock providers as the default.
- Record every optional model/voice install as a spike.
- Re-run hardware and model benchmarks on the target M4 Pro or M4 Max before local model lock.
- Keep Kimi as a future on-prem or provider candidate, not local laptop default.



---

# Final Synthesis

Iteration 0004 moves OpenClinXR from cloud-optional to local-first. It proves the current machine can support planning and deterministic local tests, but it also documents missing runtime tools and keeps model/voice/asset assumptions behind gates.

The code implementation plan should therefore begin with mock providers, schemas, pure domain logic, fixtures, trace replay, and admin/XR shells before any local LLM or voice install.



---

# Memory Update Log

Date: 2026-05-03

## Durable Lessons

- Current hardware is Apple M1 Max with 64 GB RAM; M4 Pro assumptions must be re-tested on target hardware.
- Bun, Blender, gltf-transform, llama.cpp, Ollama, Whisper, MLX, and VibeVoice are not installed.
- Mock providers are the default for code implementation.
- Qwen/DeepSeek local models are plausible spike candidates; Kimi-K2 is not a laptop default.
- VibeVoice is a local voice candidate behind safety and benchmark gates.

