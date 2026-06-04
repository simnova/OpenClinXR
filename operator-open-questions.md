# Operator Open Questions

This file tracks non-blocking operator questions that need a better answer after more evidence. Blockers that require operator action stay in `operator-steering-needed-questions.md`.

## 2026-06-04 Local exam Mongo-memory boot profile boundary

- Question: Should the local production-app validation profile boot API with prehydrated in-memory Mongo for manual and automated exam validation?
- Current answer: Yes, but implement it as a dedicated local/test harness profile that uses existing data-layer Mongo-memory helpers and deterministic providers without adding `mongodb-memory-server` to app runtime manifests or weakening architecture rules.
- Recommended default: keep `pnpm local:exam:smoke` as the fast current gate; next implement a local exam boot profile in data/test-harness boundaries, then expose a documented command for API/Admin/UI-XR validation once it can seed fixtures and publish useful review-packet evidence.

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
- Current answer: Yes for local, asynchronous development proof-of-concept work; no for live Quest dialog today. VibeVoice is useful for proving the voice-provider facade, generating local sample utterances, validating disclosure/retention policy, and exercising a no-cloud speech path. It should not be treated as equivalent to Grok Voice for production, real-time learner conversations, multi-actor turn-taking, or quality/SLA claims until a true streaming model path is benchmarked on the current target Apple M1 Max 64 GB profile (this workstation) and through Quest/WebXR or Godot playback. (M4 Pro/Max remain higher-end future profiles.)
- Confidence: Medium-high for slow local development audio generation; low for realtime interactive station dialog.
- Current evidence: `docs/openclinxr/local-voice-runtime-benchmark-2026-05-06.json` is the latest harvested VibeVoice evidence artifact. Codex reran the approved local-only wrapper on 2026-05-06 with Hugging Face offline flags enabled, observed no cloud or paid API use, and harvested the resulting log/audio without committing generated audio. The no-cloud, no-paid VibeVoice-Realtime-0.5B file-generation run produced 3.33 seconds of audio, took 20.59 seconds wall-clock, reported 8.37 seconds of model generation, and recorded a 2.51x real-time factor. That is better than the first May 4 run but still acceptable only for slow proof-of-concept generation, not live station dialog.
- Realtime alternative evidence: `docs/openclinxr/realtime-voice-transport-spike-2026-05-06.json` proves a no-cloud bidirectional WebSocket transport harness through the Hono gateway shape and Python-compatible backend fixture, `docs/openclinxr/api-python-backend-runtime-smoke-2026-05-06.json` proves the real FastAPI backend can run locally and handle JSON/binary WebSocket frames with canonical protocol and latency fields, `docs/openclinxr/local-provider-benchmark-2026-05-06.json` refreshes deterministic no-cloud/no-download provider readiness, and `docs/openclinxr/godot-project-import-check-2026-05-06.json` records local headless Godot import evidence for the Quest/Godot sidecar. `docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json` records both approved local Moshi and Qwen3-TTS model caches. This proves transport/backend/model-adapter/cache/import shape only; it does not prove real VibeVoice streaming, Moshi full-duplex inference, Grok Voice, microphone capture, Opus encode/decode, playback, or headset latency.
- Important nuance: The official VibeVoice-Realtime model card describes streaming text input and about 300 ms first audible latency as hardware-dependent, so the current local wrapper/file-generation benchmark may be pessimistic for a properly integrated streaming path. We still need a real streaming benchmark on this machine before upgrading confidence.
- Risks and limits: VibeVoice-Realtime-0.5B is single-speaker oriented, primarily English, speech-only, and carries responsible-use warnings around impersonation, disinformation, inaccurate output, disclosure, and real-world/commercial use. It remains a developer-only, safety-gated runtime.
- Follow-up evidence needed:
  - Run a true streaming VibeVoice benchmark, not just file generation.
  - Run Moshi MLX or Qwen3-TTS behind `apps/arena/api-python-backend` without cloud/API calls.
  - Execute the Godot sidecar on Quest 3 and record binary frame round-trip, then real audio capture/playback.
  - Measure first audible playback through the browser/WebXR audio stack.
  - Measure on the actual target hardware profile: Apple M1 Max 64 GB (current target machine); M4 Pro/Max are higher-spec future profiles.
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

## 2026-05-28 Nonblocking API runtime-selection test fixture drift

- Question: Should `/runtime/selection-review-packet` API tests prefer the durable pediatric runtime-selection artifact when present, or keep asserting the older API-local ED fixture by default?
- Recommended default: prefer the durable pediatric artifact when it exists because it is the current blueprint-to-runtime factory chain, and split any ED-local fixture expectation into an explicit fallback-only test.

## 2026-05-28 Nonblocking UI-XR strict typecheck drift

- Question: Should the next UI-XR cleanup slice repair the broad `noPropertyAccessFromIndexSignature` and legacy fixture-shape typecheck failures now surfaced by `pnpm --filter @openclinxr/ui-xr typecheck`?
- Current answer: Not required to complete the runtime evidence capture scaffold slice because focused UI-XR tests, Biome, and cross-boundary API attachment tests passed, but the full package typecheck is not a usable gate until the existing strict-index-signature and fixture errors are cleaned up.
- Recommended default: schedule a dedicated UI-XR typecheck cleanup slice before using full `@openclinxr/ui-xr typecheck` as a required gate for future runtime wiring changes.

## 2026-05-28 Nonblocking re-alignment of agent coordination surfaces (this review)

- Question: After injecting Current State Snapshots + synced queue + Efficient Rehydration + Working Model into the canonical coordination files (and updating the alignment check markers), should the long chronological ledgers in AUTONOMOUS_WORK_PLAN.md and worker-backlog-and-validation-matrix.md be further collapsed (e.g. move detailed history to a separate generated or archived ledger, keep only last N slices + summary tables) to make re-reads even lighter for daily agentic use?
- Recommended default: No for now. The frontmatter snapshots (first 60-80 lines) + tail for latest "next" + the explicit rehydration checklist in AGENTS/PROJECT provide efficient entry point without risking loss of audit trail or requiring changes to runbook/drift-check/alignment that reference the full files. If after several more weeks the files grow another 50% and rehydration feels slow even with snapshots, then propose a ledger-extract slice (with drift-police + coordinator review first). The re-align already makes agentic continuation (including for this Grok session) faster and less prone to using stale 05-21 queues vs actual 05-28 runtime-evidence/UI-XR pipeline + materialization work. All edits passed alignment + drift post-edit.

## 2026-05-28 Nonblocking hardware target re-alignment (M1 Max 64GB now primary)

- Question: With the host confirmed as Apple M1 Max 64 GB (exact match to "this machine"), and explicit request to target it (Quest aside/disconnected), are there lingering assumptions or gates assuming other hardware (M4 Pro/Max as primary target, M1 only spike)?
- Recommended default / resolution: Updated all active references (operator voice Qs, spike/strategy/asset-pipeline docs, benchmark source code + tests + gate report, sources json record, plan ledger). M1 Max 64GB (current host) is now the supported target profile for local model quality, voice, asset workstation. M4 Pro/Max treated as higher-end future. Resource analysis: aligned for current deterministic slices (node 24, pnpm, python/blender/llama/mlx/godot on this hardware per prior successful spikes and runs; 64GB unified sufficient with quantization for approved local models; heavy concurrent asset+model+UIs may need monitoring but no scope change). No Intel/other hardware assumptions found. New evidence runs will reflect; historical generated JSONs left as-is per artifact guardrails. All checks (alignment, drift, focused tests, biome) green post-edit. Continue product work with corrected posture.
