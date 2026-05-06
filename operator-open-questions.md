# Operator Open Questions

This file tracks non-blocking operator questions that need a better answer after more evidence. Blockers that require operator action stay in `operator-steering-needed-questions.md`.

## VibeVoice as a Grok Voice development substitute

- Asked: 2026-05-04
- Question: Is VibeVoice a somewhat usable alternative to Grok Voice for a development proof of concept on this hardware, accepting that it may be slow but free compared with API credits?
- Current answer: Yes for local, asynchronous development proof-of-concept work; no for live Quest dialog today. VibeVoice is useful for proving the voice-provider facade, generating local sample utterances, validating disclosure/retention policy, and exercising a no-cloud speech path. It should not be treated as equivalent to Grok Voice for production, real-time learner conversations, multi-actor turn-taking, or quality/SLA claims until a true streaming model path is benchmarked on the target M4 Pro or M4 Max profile and through Quest/WebXR or Godot playback.
- Confidence: Medium-high for slow local development audio generation; low for realtime interactive station dialog.
- Current evidence: `docs/openclinxr/local-voice-runtime-benchmark-2026-05-06.json` is the latest harvested VibeVoice evidence artifact. Codex reran the approved local-only wrapper on 2026-05-06 with Hugging Face offline flags enabled, observed no cloud or paid API use, and harvested the resulting log/audio without committing generated audio. The no-cloud, no-paid VibeVoice-Realtime-0.5B file-generation run produced 3.33 seconds of audio, took 20.59 seconds wall-clock, reported 8.37 seconds of model generation, and recorded a 2.51x real-time factor. That is better than the first May 4 run but still acceptable only for slow proof-of-concept generation, not live station dialog.
- Realtime alternative evidence: `docs/openclinxr/realtime-voice-transport-spike-2026-05-04.json` proves a no-cloud bidirectional WebSocket transport harness through the Hono gateway shape and Python-compatible backend fixture, `docs/openclinxr/api-python-backend-runtime-smoke-2026-05-05.json` proves the real FastAPI backend can run locally and handle JSON/binary WebSocket frames with canonical protocol and latency fields, `docs/openclinxr/local-model-runtime-benchmark-2026-05-05.json` records a fresh cache-only Qwen/llama.cpp structured-output smoke, and `apps/ui-quest-voice-godot` now adds a source-level Quest/Godot WebSocket client contract. `docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-05.json` now proves only that the approved local cache location and support venv exist; it also explicitly records that no approved Moshi/Qwen model directory is ready. This proves transport/backend/model-adapter/cache-shape only; it does not prove real VibeVoice, Moshi, Qwen3-TTS, Grok Voice, microphone capture, Opus encode/decode, playback, or headset latency.
- Important nuance: The official VibeVoice-Realtime model card describes streaming text input and about 300 ms first audible latency as hardware-dependent, so the current local wrapper/file-generation benchmark may be pessimistic for a properly integrated streaming path. We still need a real streaming benchmark on this machine before upgrading confidence.
- Risks and limits: VibeVoice-Realtime-0.5B is single-speaker oriented, primarily English, speech-only, and carries responsible-use warnings around impersonation, disinformation, inaccurate output, disclosure, and real-world/commercial use. It remains a developer-only, safety-gated runtime.
- Follow-up evidence needed:
  - Run a true streaming VibeVoice benchmark, not just file generation.
  - Run Moshi MLX or Qwen3-TTS behind `apps/api-python-backend` without cloud/API calls.
  - Execute the Godot sidecar on Quest 3 and record binary frame round-trip, then real audio capture/playback.
  - Measure first audible playback through the browser/WebXR audio stack.
  - Measure on the actual target hardware profile: M4 Pro or M4 Max.
  - Add pronunciation checks for medical phrases and names.
  - Compare one short scenario line set against Grok Voice only if/when API spend is explicitly approved.
