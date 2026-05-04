# Operator Open Questions

This file tracks non-blocking operator questions that need a better answer after more evidence. Blockers that require operator action stay in `operator-steering-needed-questions.md`.

## VibeVoice as a Grok Voice development substitute

- Asked: 2026-05-04
- Question: Is VibeVoice a somewhat usable alternative to Grok Voice for a development proof of concept on this hardware, accepting that it may be slow but free compared with API credits?
- Provisional answer: Yes for local, asynchronous development proof of concept work; not yet for live Quest dialog. It is useful for proving the voice-provider facade, generating local sample utterances, validating disclosure/retention policy, and exercising a no-cloud speech path. It should not be treated as equivalent to Grok Voice for production, real-time learner conversations, multi-actor turn-taking, or quality/SLA claims until the streaming path is benchmarked on the actual M4 Pro or M4 Max target and through WebXR playback.
- Confidence: Medium.
- Current evidence: `docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json` recorded a local, no-cloud, no-paid VibeVoice-Realtime-0.5B file-generation run. It produced 3.47 seconds of audio, but the run took 118.9 seconds wall-clock, reported 18.17 seconds of model generation, a 5.24x real-time factor, and about 9 seconds approximate first speech-token latency. That is acceptable for slow proof-of-concept generation, but not acceptable for live station dialog.
- Important nuance: The official VibeVoice-Realtime model card describes streaming text input and about 300 ms first audible latency as hardware-dependent, so the current local wrapper/file-generation benchmark may be pessimistic for a properly integrated streaming path. We still need a real streaming benchmark on this machine before upgrading confidence.
- Risks and limits: VibeVoice-Realtime-0.5B is single-speaker oriented, primarily English, speech-only, and carries responsible-use warnings around impersonation, disinformation, inaccurate output, disclosure, and real-world/commercial use. It remains a developer-only, safety-gated runtime.
- Follow-up evidence needed:
  - Run a true streaming VibeVoice benchmark, not just file generation.
  - Measure first audible playback through the browser/WebXR audio stack.
  - Measure on the actual target hardware profile: M4 Pro or M4 Max.
  - Add pronunciation checks for medical phrases and names.
  - Compare one short scenario line set against Grok Voice only if/when API spend is explicitly approved.
