# Operator Open Questions

This file tracks non-blocking operator questions that need a better answer after more evidence. Blockers that require operator action stay in `operator-steering-needed-questions.md`.

## Quest foreground performance capture blocked in this session

- Asked: 2026-05-25
- Question: Can we complete the single honest Quest 3 foreground performance capture in this session, or should we keep the report as a prepared draft until a human worn-headset pass is available?
- Current answer: Keep the report as a prepared draft for now. A real headset pass is still required to honestly record comfort, readability, immersive-session, and sustained-frame observations.
- Confidence: High
- Current evidence: No live headset action or fresh manual performance artifact was produced in this session; the report is prepared as a blocker-aware draft only.
- Recommended default: Use the new dated draft report as-is, keep the Quest Browser setup to one foreground window, disable DevTools screencast before the next real capture, and resume the manual checklist only when the operator can physically wear the headset.

## VibeVoice as a Grok Voice development substitute

- Asked: 2026-05-04
- Question: Is VibeVoice a somewhat usable alternative to Grok Voice for a development proof of concept on this hardware, accepting that it may be slow but free compared with API credits?
- Current answer: Yes for local, asynchronous development proof-of-concept work; no for live Quest dialog today. VibeVoice is useful for proving the voice-provider facade, generating local sample utterances, validating disclosure/retention policy, and exercising a no-cloud speech path. It should not be treated as equivalent to Grok Voice for production, real-time learner conversations, multi-actor turn-taking, or quality/SLA claims until a true streaming model path is benchmarked on the target M4 Pro or M4 Max profile and through Quest/WebXR or Godot playback.
- Confidence: Medium-high for slow local development audio generation; low for realtime interactive station dialog.
- Current evidence: `docs/openclinxr/local-voice-runtime-benchmark-2026-05-06.json` is the latest harvested VibeVoice evidence artifact. Codex reran the approved local-only wrapper on 2026-05-06 with Hugging Face offline flags enabled, observed no cloud or paid API use, and harvested the resulting log/audio without committing generated audio. The no-cloud, no-paid VibeVoice-Realtime-0.5B file-generation run produced 3.33 seconds of audio, took 20.59 seconds wall-clock, reported 8.37 seconds of model generation, and recorded a 2.51x real-time factor. That is better than the first May 4 run but still acceptable only for slow proof-of-concept generation, not live station dialog.
- Realtime alternative evidence: `docs/openclinxr/realtime-voice-transport-spike-2026-05-06.json` proves a no-cloud bidirectional WebSocket transport harness through the Hono gateway shape and Python-compatible backend fixture, `docs/openclinxr/api-python-backend-runtime-smoke-2026-05-06.json` proves the real FastAPI backend can run locally and handle JSON/binary WebSocket frames with canonical protocol and latency fields, `docs/openclinxr/local-provider-benchmark-2026-05-06.json` refreshes deterministic no-cloud/no-download provider readiness, and `docs/openclinxr/godot-project-import-check-2026-05-06.json` records local headless Godot import evidence for the Quest/Godot sidecar. `docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json` records both approved local Moshi and Qwen3-TTS model caches. This proves transport/backend/model-adapter/cache/import shape only; it does not prove real VibeVoice streaming, Moshi full-duplex inference, Grok Voice, microphone capture, Opus encode/decode, playback, or headset latency.
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

## 2026-05-25 Faculty review posture detail

Question: Should the reviewer-decision posture also surface a one-line `late behavior present` summary next to existing trace-quality metrics?

Recommended default: Keep the current timeline/note/posture exposure as-is unless faculty reviewers ask for a more explicit late-behavior badge. Existing blocker IDs and decision reasons already surface late behavior without adding another UI chip.

## Nonblocking - ui-xr typecheck has pre-existing runtime interaction variable errors

- Context: `pnpm --filter @openclinxr/ui-xr typecheck` currently fails in `apps/ui-xr/src/main.ts` because `latestRuntimeInteractionEvidence` is referenced at two sites but is not in scope.
- Impact: focused `runtime-state.test.ts` passed for the XR trace summary slice, but full ui-xr typecheck remains blocked until this existing runtime wiring issue is corrected.
- Recommended default: fix the `latestRuntimeInteractionEvidence` scope issue in a focused ui-xr runtime wiring slice before using full package typecheck as a gate for future XR work.

## 2026-05-25 Resolution - ui-xr runtime interaction scope blocker

- Prior question: `latestRuntimeInteractionEvidence` was referenced outside scope in `apps/ui-xr/src/main.ts`, blocking full `@openclinxr/ui-xr` typecheck.
- Resolution: The runtime interaction evidence variable was moved to shared file scope in a focused ui-xr slice.
- Current evidence: `pnpm --filter @openclinxr/ui-xr typecheck` passed after the fix.
- Recommended default: Treat this blocker as resolved and keep future XR trace slices gated by focused ui-xr tests plus package typecheck when touched.

## 2026-05-27 - MPFB/MakeHuman garment license allowlist

Question: Which specific MPFB/MakeHuman garment source should be allowlisted first for Reom OB/pediatric fitting?

Recommended default: keep `mpfb_makehuman_clothing_library` blocked for materialized runtime assets until a specific garment has source URL, license, author, redistribution permission, hash, and semantic key. Continue local procedural fitter only as pipeline test evidence.

## 2026-05-27 - License-compatible garment allowlist source

Question: Which specific external garment mesh source should be reviewed first for allowlisting into the provider-routed garment pipeline?

Recommended default: do not materialize any external garment; keep MPFB/MakeHuman blocked pending a concrete source URL, license, author, redistribution permission, local hash, and semantic garment key. Continue automation around provider gates, cache reuse, and B+ screenshot scoring.

## 2026-05-28 Nonblocking runtime-proof default

- Question: Should generated pediatric runtime bundles be allowed to report `bundle_ready` when actor/equipment records still wrap shared neutral generated blobs under scenario-specific names?
- Recommended default: keep the bundle constructible for local pipeline proof, but attach explicit blocked visual-realism/non-learner-use caveats and require actor/equipment variant materialization evidence before promotion.
