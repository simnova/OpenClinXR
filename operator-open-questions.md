# Operator Open Questions

This file tracks non-blocking operator questions that need a better answer after more evidence. Blockers that require operator action stay in `operator-steering-needed-questions.md`.

## 2026-06-05 Anny local package/source manifest

- Question: Should real Anny forward-pass work use a local source checkout, a Python package install, or a manually curated weights/source manifest first?
- Current answer: Prefer a manually curated weights/source manifest first, even though Patrick approved adding the local module and Codex installed `anny==0.3.1` plus `roma==1.5.6` into the active Python 3.11 user site. The manifest gives the tightest auditability and license guardrails before any real forward pass.
- Recommended default: keep real Anny generation blocked until a local-only Anny package/source/weights manifest records package version, source URL/repo, license, hash/cache path, optional noncommercial topology exclusions, and exact case-parameter bindings. Then run a no-promotion real Anny API construction/forward-pass smoke before replacing or promoting any runtime assets.

## 2026-06-06 StableGen/ComfyUI skin cagematch boundary

- Question: Should the next Anny skin/facial-surface improvement use StableGen with a local ComfyUI backend?
- Current answer: Yes. Use StableGen plus local ComfyUI for the next copied-candidate skin/facial-surface cagematch, local FOSS only and no promotion. `docs/openclinxr/anny-skin-cagematch-probe-2026-06-06.json` now shows StableGen is available in Blender 5.1 and ComfyUI 0.24.0 is reachable on local MPS at `http://127.0.0.1:8188`; `fast_simplification`/`trimesh` are available, and glTF-Transform is usable after the targeted pnpm override. Manual hair/face marker geometry is explicitly abandoned after visual rejection.
- Recommended default: StableGen/Comfy is software-ready; the remaining blocker is a licensed local diffusion checkpoint/cache manifest, not StableGen itself. The local Comfy checkpoint inventory is currently empty, so do not queue a workflow until a checkpoint path, source URL, license, sha256, and cache reuse key are recorded. The Track A MIT PBR cagematch generated copied after GLBs and screenshots, but visual spot-check found patchy/noisy skin, so it is a no-promotion failed cagematch rather than a realism win. Address or isolate the shared Python environment caveat before scaling: ComfyUI installed `pydantic` 2.13.4, which conflicts with installed `olive-ai 0.3.0`.

## 2026-06-04 Local exam Mongo-memory boot profile boundary

- Question: Should the local production-app validation profile boot API with prehydrated in-memory Mongo for manual and automated exam validation?
- Current answer: Yes, but implement it as a dedicated local/test harness profile that uses existing data-layer Mongo-memory helpers and deterministic providers without adding `mongodb-memory-server` to app runtime manifests or weakening architecture rules.
- Recommended default: keep `pnpm local:exam:smoke` as the fast current gate; implement a dedicated local exam boot profile in data/test-harness boundaries, then expose a documented command for API/Admin/UI-XR seeded validation once fixtures and review-packet evidence are ready. Do not add `mongodb-memory-server` to production manifests.

## Quest foreground performance capture blocked in this session

- Asked: 2026-05-25
- Question: Can we complete the single honest Quest 3 foreground performance capture in this session, or should we keep the report as a prepared draft until a human worn-headset pass is available?
- Current answer: Keep the report as a prepared draft until a real human worn-headset pass is available. A real headset pass is required to honestly record comfort, readability, immersive-session, and sustained-frame observations.
- Confidence: High
- Current evidence: No live headset action or fresh manual performance artifact was produced in this session; the report is prepared as a blocker-aware draft only.
- Recommended default: Use the prepared draft report as-is, keep the Quest Browser setup to one foreground window, disable DevTools screencast before the next real capture, and resume the manual checklist only when the operator can physically wear the headset.

## VibeVoice as a Grok Voice development substitute

- Asked: 2026-05-04
- Question: Is VibeVoice a somewhat usable alternative to Grok Voice for a development proof of concept on this hardware, accepting that it may be slow but free compared with API credits?
- Current answer: Yes for local asynchronous development proof-of-concept work; no for live Quest dialog or production claims. VibeVoice is useful for proving the voice-provider facade, generating local sample utterances, validating disclosure/retention policy, and exercising a no-cloud speech path. Current file-generation evidence is acceptable for offline work but too slow for real-time. Prioritize a true streaming benchmark with VibeVoice-Realtime, Moshi MLX, or Qwen3-TTS on the current Apple M1 Max 64 GB target plus Godot/Quest sidecar before upgrading confidence.
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

Recommended default: No. Keep the current timeline/note/posture exposure as-is unless faculty reviewers ask for a more explicit late-behavior badge. Existing blocker IDs and decision reasons already surface late behavior without adding another UI chip.

## Nonblocking - ui-xr typecheck has pre-existing runtime interaction variable errors

- Context: `pnpm --filter @openclinxr/ui-xr typecheck` currently fails in `apps/ui-xr/src/main.ts` because `latestRuntimeInteractionEvidence` is referenced at two sites but is not in scope.
- Impact: focused `runtime-state.test.ts` passed for the XR trace summary slice, but full ui-xr typecheck remains blocked until this existing runtime wiring issue is corrected.
- Recommended default: Superseded by the 2026-05-25 resolution below. Treat the original `latestRuntimeInteractionEvidence` scope issue as resolved; remaining full typecheck concerns should be tracked under the strict-index-signature/legacy fixture cleanup entries.

## 2026-05-25 Resolution - ui-xr runtime interaction scope blocker

- Prior question: `latestRuntimeInteractionEvidence` was referenced outside scope in `apps/ui-xr/src/main.ts`, blocking full `@openclinxr/ui-xr` typecheck.
- Resolution: The runtime interaction evidence variable was moved to shared file scope in a focused ui-xr slice.
- Current evidence: `pnpm --filter @openclinxr/ui-xr typecheck` passed after the fix.
- Recommended default: Treat this blocker as resolved. Future XR slices should gate on focused tests plus full package typecheck when touched, subject to the remaining strict-index-signature/legacy fixture cleanup posture below.

## 2026-05-27 - MPFB/MakeHuman garment license allowlist

Question: Which specific MPFB/MakeHuman garment source should be allowlisted first for Reom OB/pediatric fitting?

Recommended default: Keep blocked. Prioritize the first garment only when it has full provenance: source URL, license, author, redistribution permission, hash, and semantic key for Reom OB/pediatric use. Continue local procedural fitter only as pipeline test evidence.

## 2026-05-27 - License-compatible garment allowlist source

Question: Which specific external garment mesh source should be reviewed first for allowlisting into the provider-routed garment pipeline?

Recommended default: Keep the same posture: do not materialize any external garment yet. Require concrete license/attribution evidence before provider-routed pipeline inclusion, and keep automation focused on gates, cache reuse, and scoring.

## 2026-05-28 Nonblocking runtime-proof default

- Question: Should generated pediatric runtime bundles be allowed to report `bundle_ready` when actor/equipment records still wrap shared neutral generated blobs under scenario-specific names?
- Recommended default: Allow `bundle_ready` for local pipeline proof only with explicit blocked visual-realism and non-learner-use caveats. Require full actor/equipment variant materialization evidence before any promotion.

## 2026-05-28 Nonblocking API runtime-selection test fixture drift

- Question: Should `/runtime/selection-review-packet` API tests prefer the durable pediatric runtime-selection artifact when present, or keep asserting the older API-local ED fixture by default?
- Recommended default: Prefer the durable pediatric runtime-selection artifact when present because it is the current blueprint-to-runtime factory chain. Split older ED-local fixture assertions into explicit fallback-only tests.

## 2026-05-28 Nonblocking UI-XR strict typecheck drift

- Question: Should the next UI-XR cleanup slice repair the broad `noPropertyAccessFromIndexSignature` and legacy fixture-shape typecheck failures now surfaced by `pnpm --filter @openclinxr/ui-xr typecheck`?
- Current answer: Not required to complete the runtime evidence capture scaffold slice because focused UI-XR tests, Biome, and cross-boundary API attachment tests passed, but the full package typecheck is not a usable gate until the existing strict-index-signature and fixture errors are cleaned up.
- Recommended default: Schedule a dedicated UI-XR cleanup slice for `noPropertyAccessFromIndexSignature` and legacy fixture errors before using full `@openclinxr/ui-xr typecheck` as a required gate. Focused tests plus Biome remain sufficient for current runtime evidence work.

## 2026-05-28 Nonblocking re-alignment of agent coordination surfaces (this review)

- Question: After injecting Current State Snapshots + synced queue + Efficient Rehydration + Working Model into the canonical coordination files (and updating the alignment check markers), should the long chronological ledgers in AUTONOMOUS_WORK_PLAN.md and worker-backlog-and-validation-matrix.md be further collapsed (e.g. move detailed history to a separate generated or archived ledger, keep only last N slices + summary tables) to make re-reads even lighter for daily agentic use?
- Recommended default: No for now. The frontmatter snapshots (first 60-80 lines) + tail for latest "next" + the explicit rehydration checklist in AGENTS/PROJECT provide efficient entry point without risking loss of audit trail or requiring changes to runbook/drift-check/alignment that reference the full files. If after several more weeks the files grow another 50% and rehydration feels slow even with snapshots, then propose a ledger-extract slice (with drift-police + coordinator review first). The re-align already makes agentic continuation (including for this Grok session) faster and less prone to using stale 05-21 queues vs actual 05-28 runtime-evidence/UI-XR pipeline + materialization work. All edits passed alignment + drift post-edit.

## 2026-05-28 Nonblocking hardware target re-alignment (M1 Max 64GB now primary)

- Question: With the host confirmed as Apple M1 Max 64 GB (exact match to "this machine"), and explicit request to target it (Quest aside/disconnected), are there lingering assumptions or gates assuming other hardware (M4 Pro/Max as primary target, M1 only spike)?
- Recommended default / resolution: Updated all active references (operator voice Qs, spike/strategy/asset-pipeline docs, benchmark source code + tests + gate report, sources json record, plan ledger). M1 Max 64GB (current host) is now the supported target profile for local model quality, voice, asset workstation. M4 Pro/Max treated as higher-end future. Resource analysis: aligned for current deterministic slices (node 24, pnpm, python/blender/llama/mlx/godot on this hardware per prior successful spikes and runs; 64GB unified sufficient with quantization for approved local models; heavy concurrent asset+model+UIs may need monitoring but no scope change). No Intel/other hardware assumptions found. New evidence runs will reflect; historical generated JSONs left as-is per artifact guardrails. All checks (alignment, drift, focused tests, biome) green post-edit. Continue product work with corrected posture.

## 2026-06-06 Nonblocking licensed checkpoint placement for Worker 10/11 skin cagematch (StableGen/ComfyUI local texturing of existing Anny peds GLB candidates)

- Question: For the leased "Worker 10/11 local skin stack enablement for Anny copied-candidate cagematch" slice (after internet research confirmed StableGen installer.py + specific models + ComfyUI --force-fp16 + IPAdapter+ControlNet+Marigold PBR approaches for texturing *existing* GLBs on Apple Silicon/M1 Max), the immediate blocker to no-promotion test texturing is the absence of a local *licensed* SDXL checkpoint (e.g. RealVisXL_V5.0_fp16.safetensors or user SDXL base) + IPAdapter (ip-adapter-plus_sdxl_vit-h.safetensors + CLIP-ViT), ControlNet (controlnet_depth_sdxl.safetensors), Lightning LoRA, and Marigold/StableDelight models in the appropriate ~/ComfyUI/models/ subdirs (checkpoints/, ipadapter/, clip_vision/, controlnet/, loras/). Per probe notes, states snapshots, and subagent chief-coordinator confirmation (explore read-only, subagent_id 019e9b1e-9562-7f60-8130-38759a80389f): research answers are fully captured (StableGen GitHub README/MANUAL_INSTALLATION.md + ComfyUI MPS practices), gates respected (local licensed only, no external/paid/download in claims, stablegen_comfyui_skin_texturing ready_for_local_cagematch but generation false until manifest + before/after isolated screenshots), Q1 (case peds/anny -> generated runtime assets with real PBR textures via local FOSS toolchain), Q4 (review via probe/manifest), Q5 (focused verif of installer/server + research sources). Server/models subdirs verified post-installer (many models/ subdirs populated; custom nodes structure per research). ComfyUI server may need (re)start with `python main.py --listen 127.0.0.1 --port 8188 --force-fp16` (MPS-friendly) in the active env; lease held by codex for the slice (no conflict). 
- Recommended default: Patrick should place the local licensed checkpoint(s) and supporting models in `~/ComfyUI/models/...` with a short license note in the probe/manifest, for example `RealVisXL_V5.0_fp16.safetensors`, `ip-adapter-plus_sdxl_vit-h.safetensors`, `controlnet_depth_sdxl.safetensors`, and Marigold or equivalent, all as licensed local copies with no redistribution. Then run no-promotion copied-candidate texturing for the existing peds Anny GLB candidates, capture before/after evidence and isolated screenshots, refresh the probe/manifest, and run post-slice/alignment/drift checks. All false gates remain closed for real-Anny, B+, scene, Quest, production, learner, clinical, and scoring readiness.
- Recorded: 2026-06-06 (post subagent chief-coordinator consult + verification curl/ls + probe confirmation that "notes" + "checkpoints_populated" contain the exact researched approaches and gate language). Aligns with source-of-truth, anti-toil (after prior evidence the enablement + this operator record is the construction pivot), model-work product guard, and lease contract.

## 2026-06-06 Portless and Playwright CLI tooling candidates

- Question: Should future parallel development/browser-evidence slices evaluate `vercel-labs/portless` and `microsoft/playwright-cli`?
- Current answer: Yes as tooling candidates, not default dependencies yet. `portless` is especially promising for parallel development because it replaces fragile local port numbers with stable named `.localhost` URLs and supports monorepos. `microsoft/playwright-cli` should be considered for record/codegen/screenshot workflows, but the repo already has `@playwright/test`/`playwright` CLI available and the prior `@playwright/cli` package addition pulled an alpha Playwright dependency chain, so keep it evaluative until a focused browser-tooling slice proves net value.
- Recommended default: trial `portless` in a sidecar/adapter slice for model-vetting-studio, ui-xr, and api parallel runs before adding it broadly. Prefer `pnpm exec playwright ...` from `@playwright/test` for now; only add `microsoft/playwright-cli` tooling if it provides a concrete workflow advantage without version drift.

## 2026-06-06 StableGen first copied-patient trial modality

- Question: Now that RealVisXL and the requested support models are cached locally and licensed in the probe/manifest, should the first copied peds patient StableGen texture trial run through interactive Blender StableGen, or should OpenClinXR build a direct ComfyUI texture/projection cagematch that bypasses the installed addon's modal path?
- Current answer: The licensed checkpoint blocker is resolved. ComfyUI can execute RealVisXL directly on MPS, but the installed StableGen Blender addon did not complete in `blender --background --online-mode`: `object.test_stable` polled true and returned `RUNNING_MODAL`, then wrote no files and never queued ComfyUI within the bounded attempt. Evidence: `docs/openclinxr/realvisxl-skin-smoke-2026-06-06.json` and `docs/openclinxr/stablegen-blender-background-trial-2026-06-06.json`.
- Recommended default: Do not keep retrying the same headless StableGen modal path. Prefer either one operator-assisted interactive Blender StableGen run for the first copied peds patient, or a repo-native direct ComfyUI texture/projection cagematch that preserves the RealVisXL license/provenance cache, copies candidates only, captures isolated before/after model-vetting evidence, and keeps all runtime/production/readiness gates false.
