# Development Handoff

Date: 2026-05-03
Status: Next-code-phase handoff draft

## Build Goal

Build the first OpenClinXR planning-to-runtime skeleton for a Step 2 CS-inspired, multi-station XR clinical skills exam system. The first code milestone should support authoring an exam blueprint, drafting a station, reviewing it, assembling an exam form, starting an exam session, recording trace events, and generating a faculty review packet.

## Non-Goals

- No high-stakes scoring.
- No ECFMG/USMLE equivalence claims.
- No confidential exam content.
- No real patient data.
- No public marketplace.
- No EHR integration.
- No production-grade avatar pipeline.

## Recommended First Implementation Phases

The most detailed build sequence now lives in:

- `docs/openclinxr/code-implementation-plan.md`
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`
- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md`

Use those documents as the implementation source of truth. The phase outline below is the shorter orientation version.

### Phase 0: Repo And Domain Skeleton

Create a TypeScript monorepo influenced by CellixJS DDD patterns:

- `apps/api`
- `apps/ui-admin`
- `apps/ui-xr`
- `packages/openclinxr/domain`
- `packages/openclinxr/data-mongodb`
- `packages/openclinxr/data-sources-mongoose-models`
- `packages/openclinxr/scenario-runtime`
- `packages/openclinxr/session-state`
- `packages/openclinxr/model-gateway`
- `packages/openclinxr/voice-gateway`
- `packages/openclinxr/trace-ledger`
- `packages/openclinxr/review-workflow`
- `packages/openclinxr/shared-schemas`
- `packages/openclinxr/graphql`
- `packages/openclinxr/rest`
- `packages/openclinxr/ui-route-shared`
- `packages/openclinxr/ui-shared`
- `packages/openclinxr/test-harness`
- `packages/openclinxr/asset-registry`

### Phase 1: Blueprint And Scenario Bank

Implement:

- Exam blueprint CRUD.
- Scenario bank CRUD.
- Actor card CRUD.
- Communication-style profile CRUD.
- Environment catalog CRUD.
- Review status workflow.
- Source and claim ledger.

Acceptance:

- Admin can create a blueprint and one ED chest pain station.
- Station cannot be published without clinical, psychometric, and legal review states.

### Phase 2: Exam Form Assembly

Implement:

- Exam form assembler from approved scenarios.
- Coverage matrix against AMA day-one skills and EPAs.
- Station ordering.
- Version lock.

Acceptance:

- Admin can assemble an ordered exam form.
- The system flags missing skill coverage.

### Phase 3: Station Runtime Skeleton

Implement:

- Exam session start.
- Doorway instructions.
- Encounter timer.
- Note timer.
- Station transition.
- Trace event append.
- Mock actor responses.
- Multi-actor session-state context from `@openclinxr/session-state`.

Acceptance:

- Learner can complete one station with trace events and a patient note.
- Actor model requests use promoted session-state context without exposing hidden facts.

### Phase 4: LLM Actor Gateway

Implement:

- Actor dialogue request contract.
- Prompt policy.
- Communication-style and bounded-stubbornness policy.
- Memory retrieval pack.
- Safety guardrail.
- LLM audit event.
- Mock provider and one real provider adapter.

Acceptance:

- Actor responses are generated with auditable prompt/model/memory provenance.
- Guardrail can block a response and produce fallback.

### Phase 5: Faculty Review Packet

Implement:

- Review queue.
- Trace timeline.
- Highlighted required events.
- Rubric scoring.
- Faculty comments.
- Score audit event.

Acceptance:

- Faculty can review a station and submit human-governed scores.

## Critical Engineering Spikes

1. Quest browser/WebXR capability and latency.
2. ASR latency and medical vocabulary reliability.
3. TTS naturalness and emotional controllability.
4. LLM actor consistency under adversarial learner inputs.
5. Communication-style adherence without repetitive or exaggerated behavior.
6. MongoDB schema and index performance for trace replay.
7. CellixJS fit for DDD/monorepo/runtime patterns.
8. WebSocket session-state delta shape using `docs/openclinxr/session-state-websocket-message-design.md`.

## First Acceptance Test Scenario

ED Chest Pain:

- Learner receives doorway instructions.
- Patient, nurse, and family member are present.
- Learner asks pain/history questions.
- Nurse interruption introduces new vital sign.
- Learner requests ECG or escalates.
- Learner submits patient note.
- Faculty opens review packet and scores history, urgent recognition, teamwork, documentation, and organizing work.

## Readiness Gates Before Code

The next implementation plan should not start until these docs are reviewed:

- `docs/openclinxr/research-brief-step2cs-llm-vsp.md`
- `docs/openclinxr/exam-scenario-architecture.md`
- `docs/openclinxr/mongodb-data-model.md`
- `docs/openclinxr/statecharts-and-sequences.md`
- `docs/openclinxr/ux-flows.md`
- `docs/openclinxr/knowledge-graph-and-indexing.md`
- `docs/openclinxr/station-pack-ed-chest-pain-v1.md`
- `docs/openclinxr/psychometric-and-review-governance.md`
- `docs/openclinxr/claims-consent-privacy-governance.md`
- `docs/openclinxr/technology-approach-brief.md`
- `docs/openclinxr/asset-generation-pipeline.md`
- `docs/openclinxr/webxr-azure-quest-performance-brief.md`
- `docs/openclinxr/virtual-patient-agent-model.md`
- `docs/openclinxr/communication-style-and-emotion-qa.md`
- `docs/openclinxr/sample-case-bank-v1.md`
- `docs/openclinxr/admin-ux-and-testing-brief.md`
- `docs/openclinxr/model-provider-and-voice-routing.md`
- `docs/openclinxr/local-hardware-spike-results.md`
- `docs/openclinxr/local-ai-voice-model-strategy.md`
- `docs/openclinxr/mongodb-memory-server-test-strategy.md`
- `docs/openclinxr/quest3-usb-webxr-smoke-checklist.md`
- `docs/openclinxr/code-implementation-plan.md`
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`
- `docs/openclinxr/development-handoff.md`
- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md`
- MADRs 0011 through 0027

## Code-Phase Hard Stops

- Do not require cloud API keys, paid services, local model downloads, local voice runtimes, MongoDB, Bun, or Quest 3 hardware for the first deterministic station simulation.
- Do not start local LLM or voice runtime implementation until mock provider audit contracts exist and pass verification.
- Do not start generated-human asset work until asset manifest validation and license/provenance gates exist.
- Do not claim production asset readiness from placeholder Blender bake evidence or local asset evidence fixtures; the production asset evidence ladder must be backed by reviewed generated artifacts, provenance, visual QA, and Quest budget evidence.
- Do not claim diagnostic performance, licensure readiness, ECFMG replacement, USMLE equivalence, or validated high-stakes scoring.
- Do not call the first XR shell ready until the desktop fallback renders a nonblank canvas and core text does not overlap.
- Do not claim Quest readiness until the Quest 3 USB-C smoke checklist records a pass or a precise blocker.
- Do not approve a scenario without clinical, psychometric, legal, and simulation QA review states.

## Internal Asset Job Endpoint (Current Contract)

Internal asset-generation jobs now route through the main API facade:

- `POST /internal/capabilities/:capabilityId/jobs`
- `GET /internal/capabilities/:capabilityId/jobs/:jobId`

Routed now (zero-spend deterministic):

- `character-generation`
- `medical-equipment-generation`
- `voice-asset-generation`
- `animation-generation`
- `asset-bake`

Operational boundary:

- The default route behavior remains deterministic/zero-spend, and Python/native workers stay behind the main API tunnel/facade and separate from interactive provider swaps.

## Local Hardware Updates

- Android Platform Tools were installed locally on 2026-05-03.
- The Quest 3 is visible to `adb` as device serial `2G0YC5ZGB5000J`; USB debugging is authorized, `adb reverse tcp:5173 tcp:5173` succeeds, and Quest Browser can load the local XR app through the reversed port.
- `pnpm xr:quest:smoke` produced `docs/openclinxr/quest-cdp-smoke-2026-05-04.json`: the Quest Browser shell loaded, the Three.js canvas was nonblank, WebXR was exposed as ready, and a trace interaction advanced. After Patrick woke the headset on 2026-05-04, `pnpm local:runtime:probe` recorded `mWakefulness=Awake` and `questForegroundPreflight.status=ready`, but the Quest CDP smoke still reported the page as `document.hidden`, so the render loop records only the initial frame and CDP frame sampling remains incomplete. Do not claim Quest frame-pacing readiness yet.
- `mongodb-memory-server` is accepted as the local MongoDB integration-test path, with binary download/cache behavior documented as an explicit setup gate.
- Blender 5.1.1 was installed locally on 2026-05-04 through Homebrew cask for asset-pipeline evidence only. Treat Blender as workstation tooling under its GPL tooling license posture; do not bundle Blender into application deployments.
- `pnpm asset:blender:bake` produced `docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json`: Blender generated a repo-owned low-poly clinical humanoid placeholder GLB with valid `glTF` magic/version/declared length, 27,284 bytes, no external assets, and 5.61s elapsed bake time.
- `llama.cpp` 9010 was installed locally on 2026-05-04 through Homebrew for model-runtime evidence only. `llama-cli` and `llama-server` are available with Metal backend initialization on this Apple Silicon machine, and `docs/openclinxr/local-model-runtime-benchmark-2026-05-04.json` records the first approved local `Qwen/Qwen3-4B-GGUF` benchmark. `pnpm local:model:runtime -- --parse-log <local-log> --output <report.json>` harvests an existing local llama.cpp log into the same report shape without executing inference. `pnpm local:model:runtime -- --execute-approved-local-run --model-file <cached-Qwen3-4B-Q4_K_M.gguf> --llama-executable /opt/homebrew/bin/llama-completion --raw-log <local-log> --output docs/openclinxr/local-model-runtime-benchmark-YYYY-MM-DD.json` runs the approved local Qwen/llama.cpp benchmark in explicit cache-only `--offline` mode, writes raw logs outside the repo, and commits evidence only. It does not download weights, use cloud APIs, or make production/clinical/target-hardware claims.
- `docs/openclinxr/spikes/vibevoice-local-voice-spike.md` records the VibeVoice safety/license intake. Patrick approved the local-only VibeVoice runtime proposal, Codex installed the wrapper at `/Users/patrick/.local/bin/vibevoice`, and `docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json` records first-audio file generation. `pnpm local:voice:runtime -- --log <local-log> --prompt <local-text> --audio <local-wav> --output <report.json>` now harvests existing VibeVoice log, prompt, and WAV metadata without running VibeVoice or committing audio; because it is parse-only, the report `generatedAt` remains the original generation timestamp and live streaming/WebXR playback remain blocked.
- `pnpm local:runtime:probe -- --api-bun-websocket-runtime-smoke docs/openclinxr/api-bun-websocket-runtime-smoke-2026-05-05.json` produced `docs/openclinxr/local-runtime-probe-2026-05-06.json`: Quest USB is ready, Bun 1.3.13 is available at `/Users/patrick/.bun/bin/bun`, and Homebrew, Node 22, pnpm 10, Python 3.11, ffmpeg, adb, Blender, `llama.cpp`, `vibevoice`, `portless@0.12.0` at `/Users/patrick/Library/pnpm/portless`, and the pinned Apache-2.0 `gltf-pipeline` CLI are visible on this machine. The local Bun WebSocket smoke in `docs/openclinxr/api-bun-websocket-runtime-smoke-2026-05-05.json` passed for `/voice/realtime/ws` with HTTP/3/WebTransport/QUIC/Web3 still out of scope. The headset was connected but asleep during this refresh, so `questForegroundPreflight` remains blocked on `quest_3_asleep_or_not_foreground_ready`.
- `pnpm xr:quest:smoke` produced multiple 2026-05-04 foreground Quest reports. The latest activation-focused run `docs/openclinxr/quest-cdp-smoke-xr-entry-activation-2026-05-04.json` shows Quest Browser awake, visible, focused, frame-sampling in flat preview at about 72 FPS, and trace interactions advancing. It remains blocked for immersive-session claims because CDP mouse/touch input did not reach the app's `Enter Full VR` handler: the report records `quest_immersive_entry_activation_not_received`, `quest_immersive_session_not_started`, and app-side `window.__openClinXrXrEntryEvidence.attempts = 0`. This is not a substitute for the manual worn-headset comfort/readability report.
- Quest CDP smoke report verdicts now include `verdict.immersiveEntryOutcome`, and evidence checks include `immersiveEntryOutcome` with `not_requested`, `activation_missed`, `app_request_failed`, or `session_started`. `activation_missed` means the CDP click did not reach the app-side WebXR entry handler and still does not satisfy human headset/controller activation or manual foreground Quest readiness.
- `pnpm local:provider:benchmark -- --env-file .env.openclinxr.local` produced `docs/openclinxr/local-provider-benchmark-2026-05-04.json`: deterministic mock model/voice benchmarks pass and the approved local model/voice runtime IDs are ready to benchmark without cloud calls.
- `docs/openclinxr/local-model-runtime-benchmark-2026-05-05.json` records a fresh repo-managed, cache-only local `Qwen/Qwen3-4B-GGUF` run through `llama.cpp` on Apple M1 Max Metal: about 45.43 generated tokens/sec, about 571 ms approximate time to first generated token, and parsable JSON with schema/extraction caveats. This is still only a local adapter latency/structured-output smoke.
- `docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json` records local VibeVoice-Realtime file generation on MPS: 3.47 s audio, 18.17 s generation time, RTF 5.24x, about 118.92 s full cold-run wall-clock, and no committed audio. This is not yet a WebXR/live-streaming latency pass.

## Executable Local Evidence Gates

Use these commands when moving from design intent to verified readiness:

- `pnpm verify`: full local gate covering agent artifacts, TypeScript, package tests, pnpm audit, and dependency license policy.
- `pnpm agent:verify`: agent-factory gate covering memory index, source ledger, pinned dependencies, stale loop-plan detection, risk/evidence debt, maturity, and benchmark evidence reporting.
- `pnpm agent:benchmarks`: regenerates `.agent-factory/benchmark-gate-report.json` from the latest raw Quest CDP smoke, manual Quest performance, GLB pipeline, local runtime, local provider benchmark, real local model benchmark, and real local voice benchmark outputs. The report keeps raw blockers for traceability, adds `blocker_summary.groups`, and splits the latest iteration-0008 evidence debt into separate Quest foreground performance, local model, and local voice leadership gates. It also records `evidence_freshness` for every non-IWSDK benchmark input and injects `*:evidence_stale_over_24h` blockers into the relevant leadership gates before old Quest, runtime, provider, GLTF, Blender, model, voice, or manual headset evidence can look current. The local runtime probe now contributes `questForegroundPreflight`, so an asleep headset appears as `quest_foreground_preflight:quest_3_asleep_or_not_foreground_ready` instead of being mistaken for app frame-pacing failure. The Quest CDP section includes a validate-only classification such as `foreground_ready` or `shell_interaction_only_hidden_page`; derived `quest-cdp-smoke-check-*` files are deliberately excluded from raw smoke selection. If a completed `docs/openclinxr/quest-manual-performance-*.json` report exists, excluding generated `quest-manual-performance-check-*` artifacts, the benchmark gate derives the manual Quest check directly from that raw report or from the copied in-app `{ manualPerformanceDraft, captureSummary }` payload saved under the same filename pattern; otherwise it uses `.agent-factory/quest-manual-performance-report.json`.
- The benchmark report now projects IWSDK as Phase 1 sidecar evidence with sub-verdicts for license posture, runtime fit, Vite fit, AI/MCP tooling, Quest manual proof, local-only controls, and blocked reference downloads.
- `pnpm asset:gltf:smoke`: generates a tiny local glTF, runs the pinned `gltf-pipeline` CLI, validates the resulting GLB header/length, and writes a machine-readable smoke report when `--output` is supplied.
- `pnpm asset:blender:bake`: runs Blender headlessly against a generated placeholder clinical humanoid fixture, exports a temporary GLB, validates its header/length, and writes a machine-readable smoke report when `--output` is supplied.
- `pnpm asset:production:ladder:validate`: validates the committed production asset evidence ladder schema, claim boundary, blocked verdict shape, and policy booleans without generating assets.
- `pnpm local:provider:benchmark`: records deterministic mock model/voice benchmark evidence and explicit local model/voice readiness blockers without downloads, cloud calls, or local runtime execution. Use `.env.openclinxr.local.example` as the local-only setup contract for `OPENCLINXR_LOCAL_MODEL_RUNTIME`, `OPENCLINXR_LOCAL_MODEL_ID`, `OPENCLINXR_LOCAL_VOICE_RUNTIME`, `OPENCLINXR_LOCAL_VOICE_ID`, `OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED`, `OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED`, `OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL`, `OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE`, and `OPENCLINXR_PYTHON_VOICE_BACKEND_RUNTIME_EVIDENCE_FILE`; keep real values out of version control. To load a private file explicitly, run `pnpm local:provider:benchmark -- --env-file .env.openclinxr.local`.
- `pnpm local:model:runtime -- --parse-log /Users/patrick/.cache/openclinxr/benchmarks/qwen3-4b-llama-completion-json2-YYYY-MM-DD.log --output docs/openclinxr/local-model-runtime-benchmark-YYYY-MM-DD.json`: parses an already-produced llama.cpp local runtime log, hashes the raw log, extracts structured-output and timing evidence, and records the approved Qwen/llama.cpp policy posture. Add `--execute-approved-local-run --model-file <cached-Qwen3-4B-Q4_K_M.gguf> --llama-executable /opt/homebrew/bin/llama-completion --raw-log <local-log>` only for the approved local Qwen benchmark path. That execution mode forces `llama.cpp --offline`, writes raw logs outside the repo, remains outside default `pnpm verify`, and must not be generalized to cloud, paid API, production, clinical-quality, or target-M4 claims.
- `pnpm local:voice:runtime -- --log /Users/patrick/.cache/openclinxr/vibevoice/benchmarks/vibevoice-first-audio-YYYY-MM-DD.log --prompt /Users/patrick/.cache/openclinxr/vibevoice/benchmarks/openclinxr-first-audio.txt --audio /Users/patrick/.cache/openclinxr/vibevoice/outputs/openclinxr-first-audio_generated.wav --output docs/openclinxr/local-voice-runtime-benchmark-YYYY-MM-DD.json`: parses existing VibeVoice file-generation logs, reads local prompt text, hashes/inspects local PCM WAV metadata, and records no-cloud/no-committed-audio policy posture. It intentionally has no VibeVoice execution mode in default repo workflows; a fresh leadership-ready voice-runtime evidence timestamp still requires a new operator-approved local voice run outside this parser.
- `pnpm xr:quest:smoke`: starts a CDP-backed Quest Browser smoke against the local XR app. It requires the dev server to be running and the Quest 3 connected/authorized over USB-C. Add `--reuse-open-page` when the headset is awake, exactly one ordinary HTTP page is open in Quest Browser, and `adb shell am start`/CDP still exposes a stale smoke tab; the tool will intentionally reuse that one page and navigate it to the requested URL instead of requiring a manual CDP one-liner. Add `--enter-vr` to attempt a remote `Enter Full VR` activation and collect `window.__openClinXrXrEntryEvidence`; if the report contains `quest_immersive_entry_activation_not_received`, the remote automation never reached the app handler and a human headset/controller click is still required.
- `pnpm xr:quest:smoke:validate -- --output .agent-factory/quest-cdp-smoke-check.json`: validates the latest committed Quest CDP smoke report without touching ADB or the headset. Use it to classify the current machine-readable evidence as `foreground_ready`, `shell_interaction_only_hidden_page`, `blocked`, or `missing`.
- `pnpm xr:quest:manual:harvest -- --output docs/openclinxr/quest-manual-performance-YYYY-MM-DD.json`: attaches to the foreground Quest Browser page after a human has manually entered Full VR, then polls `window.__openClinXrManualPerformanceDraft` and `window.__openClinXrManualPerformanceCaptureSummary` until technical headset signals are present or the timeout expires. The harvester defaults to `--skip-launch` and `--reuse-open-page`, does not attempt WebXR entry itself, does not reload the page, and writes a copied-payload shape `{ manualPerformanceDraft, captureSummary, harvestSummary }`; it waits for at least 600 immersive frames, a 120-sample window, fresh frame stats, headset trace latency from `xr_controller_select` or `xr_hand_select`, and locomotion evidence. It still does not fill human audit fields such as operator identity, screencast posture, comfort, heat, or battery observations.
- `pnpm xr:quest:manual:check`: validates a foreground in-headset manual performance report, or records `missing_quest_manual_performance_report` until one exists. Use `docs/openclinxr/quest-manual-performance-template.json` as the capture template, or save the copied in-app Quest Evidence payload containing `{ manualPerformanceDraft, captureSummary }`; the checker validates `manualPerformanceDraft` with the same raw-report gates, requires copied payloads to include a fresh `captureSummary`, and treats `captureSummary` as additional audit context/blockers, never as a readiness shortcut. The copied draft includes audit-only `reproducibility` metadata for URL, user agent, browser-version hints, app version/commit/build time, WebXR support checks, viewport, screen, and device-pixel-ratio; these fields improve run reproduction but are browser-reported and do not prove Horizon OS, Android build, USB power, or thermal state. The checker requires operator identity, strict ISO timestamp, foreground page, screencast disabled, extra windows closed, immersive session confirmation, explicit Full VR mode evidence (`modeId: "full_vr"`, `requestedSessionMode: "immersive-vr"`, `mixedRealityPassthroughImplemented: false`), at least one observed foreground headset hand/controller interaction, observed locomotion with `lastLocomotionAtMs`, non-`none` `activeLocomotionSource`, and a measurable `locomotionDelta`, at least 600 total observed frames, at least 600 immersive Full VR frames, a rolling frame window of at least 120 samples backed by immersive frames from `window.__openClinXrFrameStats`, string-only console errors, plausible nonnegative frame metrics, battery-drop entry, comfort, and the FPS/frame-time thresholds before frame-pacing claims can clear. When locomotion is still blocked, copied `captureSummary.locomotionProbeSummary` reason codes are preserved as manual-evidence blockers such as `copied_payload_locomotion_probe:no_gamepad_sources`, `copied_payload_locomotion_probe:hand_arming_dwell`, `copied_payload_locomotion_probe:hand_below_deadzone`, or `copied_payload_locomotion_probe:active_vector_without_rig_delta`, with reason-specific next steps. In hand-tracking-only runs, pinch thumb to index, hold the whole hand steady through the 450 ms dwell, then move the still-pinched hand through space past the deadzone; the runtime compares the wrist/index/thumb centroid against the arming origin, so curling fingers in place is not locomotion input. The template also preserves DOM trace-latency proxy context, but that proxy is supporting evidence only and does not substitute for real worn-headset latency; readiness requires an `xr_controller_select` controller-trigger trace or `xr_hand_select` deliberate right-hand stable-pinch trace with tag, measured timestamp, positive latency, and matching `performance.controllerSelectLatencyMs`. The generated check includes `nextSteps` strings for each blocker so the operator can complete the remaining fields without loosening the gate.
- `pnpm local:runtime:probe`: checks local hardware/runtime prerequisites without cloud or paid API usage.
- `pnpm --filter @openclinxr/api smoke:azure`: locally bundles the Hono/Azure-compatible API with `tsdown`, prepares the Azure deploy folder, and smoke-tests `/health`, seed timing/queue routes, REST review snapshot routes, and generated-document GraphQL snapshot create/list paths. The prior Rolldown build path remains available as `pnpm --filter @openclinxr/api build:azure:rolldown`.
- `pnpm security:audit`: runs `pnpm audit --audit-level=high`. For point-in-time evidence, save `pnpm audit --json` to `docs/openclinxr/security-audit-YYYY-MM-DD.json` and pass it to `pnpm security:audit-policy -- --audit-json ... --output ...`; the latest evidence is `docs/openclinxr/security-audit-2026-05-05.json` and `docs/openclinxr/security-audit-policy-2026-05-05.json`.
- `pnpm security:licenses`: checks dependency licenses against the OpenClinXR policy and writes `docs/openclinxr/dependency-license-policy-2026-05-03.json`.

## Development Team Stack Preferences

Use these preferences when making new implementation decisions unless a runtime constraint argues against them:

- Prefer pnpm over npm for workspace dependency management and command examples.
- Use Turborepo-friendly names: `apps/ui-<<portal-name>>` for React SPAs, `packages/openclinxr/ui-route-<<top-level-route>>` for route-owned code, `packages/openclinxr/ui-route-shared` for route-shared SPA code, `packages/openclinxr/ui-shared` for cross-portal SPA code, `packages/openclinxr/graphql` and `packages/openclinxr/rest` for protocol packages, `packages/openclinxr/data-sources-mongoose-models` for Mongoose models, and `apps/mock-<<server-type>>-server` for local mock servers.
- Keep `packages/cellix/*` reserved for shared Cellix-compatible packages copied from CellixJS and used as-is. If project-specific edits are needed, make a modified copy under `packages/openclinxr/*` instead of changing `packages/cellix/*`.
- Treat architectural decisions as executable rules: `packages/openclinxr/architecture-rules` uses ArchUnitTS to enforce approved app naming, prevent UI portal imports from backend persistence/runtime packages, block paid/cloud model and voice SDK dependencies or credential env keys from manifests, package scripts, config files, env templates, and default local runtime source, and check shared UI packages for import cycles.
- Prefer Mongoose for mature MongoDB admin/control-plane schemas, while keeping high-volume trace replay repositories thin and performance-oriented.
- Prefer Apollo GraphQL plus GraphQL Code Generator for admin workbench queries and generated TypeScript operation/resolver contracts. The first generated-document slice is active in `packages/openclinxr/graphql` and consumed by `apps/ui-admin` for station-run queue review snapshots.
- Prefer React Router for administrative app routing and nested workbench modules.
- Prefer TurboRepo when package count and CI/runtime tasks need caching or affected-package execution.
- Prefer Biome, Knip, and E18E for lint/format, unused dependency/export detection, and ecosystem-health review after scoped baselines are tuned.
- Prefer OpenTelemetry for performance analysis and trace/metric naming across API, GraphQL, MongoDB, model/voice gateways, and XR runtime events.
- Prefer a CellixJS-inspired fluent API bootstrap for `apps/api`: register infrastructure services, set request/application context, initialize application services, register Azure Function-compatible GraphQL/REST handlers, then start up. Keep the OpenClinXR variant Hono/Azure Functions-compatible and local-testable.
- Treat the Ant Design CLI skill as optional local support for AntD 6 component work. Prefer package-managed execution with `@ant-design/cli`, use `--format json`, and verify exact-version component APIs/tokens/demos before authoring UI. A 2026-05-04 package-managed spike showed `env`, `doctor`, and `info` working for `apps/ui-admin`, but `lint` failed with `ERR_REQUIRE_ESM` in a transient `oxc-parser` dependency path, so do not add AntD CLI lint to `pnpm verify` yet. The CLI is not installed globally in this workspace.
- Treat Apollo GraphQL Skills as optional local agent support for schema, operation, and client reviews. Install and record them deliberately, keep recommendations source-aware, and require repo tests/codegen to back any GraphQL implementation changes.
- Prefer package-managed `tsdown` for the API deploy bundle when the output is smoke-tested and dependency bundling is explicit. The 2026-05-04 spike reduced `apps/api` deploy JS from 1,355.35 kB with Rolldown to 538.86 kB with `tsdown`; do not use `pnpm dlx tsdown` as the blessed path on this machine because the transient CLI path exposed native-binding and Node-runtime issues.
- If TurboRepo is introduced, use the official Turborepo skill as operating guidance: package scripts own task logic, root scripts delegate with `turbo run`, `--affected` gates changed packages and dependents, dev/watch tasks are persistent and uncached, repo scripts set `TURBO_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1`, and remote caching remains disabled unless the team explicitly enables it.
- Consider Portless as an optional local developer-experience layer for parallel worktrees and named local URLs. Patrick has run `portless trust`, and a 2026-05-04 unprivileged proxy smoke loaded `apps/ui-xr` through Chrome DevTools MCP at `https://ui-xr.localhost:1355` with a live canvas and no warning/error console messages. Keep privileged/default-port proxy startup opt-in, and do not replace Quest 3 `adb reverse tcp:5173 tcp:5173` evidence with Portless LAN mode until a headset spike verifies that path. On this machine, prefer explicit Node 22 for Portless child Vite commands because a pnpm child path exposed Node 21.7.1.
- Keep headset runtime imports narrow. `apps/ui-xr` now imports the approved ED station through `@openclinxr/scenario-fixtures/ed-chest-pain` instead of the scenario-fixture barrel; the 2026-05-04 Portless/Chrome DevTools smoke showed the dev browser fetching only the active fixture subpath, and the production app chunk dropped to 11.72 kB with Three.js isolated in `three-vendor`.
- Treat Meta Immersive Web SDK as an XR spike candidate, not a default runtime dependency. `apps/ui-xr-iwsdk-spike` now exists as the approved Phase 1 sidecar with `@iwsdk/core@0.3.1`, `@iwsdk/xr-input@0.3.1`, `three@0.184.0`, and a root pnpm override pinning Three. It renders the ED chest pain shell, exposes IWSDK export counts, preserves the scene-name parity contract, and now exposes an explicit Quest Browser `Enter Full VR` button that calls `navigator.xr.requestSession("immersive-vr")` and switches Three.js onto `renderer.setAnimationLoop`. The production `apps/ui-xr` shell received the same immersive-session entry path plus in-VR canvas-text EHR, dialogue, and input-evidence panels, controller ray/grip affordances, local mesh hand assets with primitive-sphere fallback, async GLB load-failure evidence, and experimental thumbstick/keyboard/hand-gesture dolly locomotion. Both renderers now skip `renderer.setSize` while `renderer.xr.isPresenting` to avoid Three.js resize warnings during an active headset session. Treat this Phase 1 runtime as full immersive VR: runtime evidence records `modeId: "full_vr"`, `Phase 1 Full VR`, `requestedSessionMode: "immersive-vr"`, and `mixedRealityPassthroughImplemented: false`. Patrick approved [proposal-webxr-mixed-reality-mode.md](../../proposals/approved/proposal-webxr-mixed-reality-mode.md) on 2026-05-04 as a parallel MR sidecar track; `apps/ui-xr/src/runtime-state.ts` now includes explicit Full VR and Mixed Reality mode contracts so a future `immersive-ar` path must keep its evidence lane, passthrough observation, privacy/safety review, UX affordances, and production-readiness claims separate while still sharing the scenario trace contract. The sidecar passed Chrome DevTools plus Quest CDP smokes with nonblank WebGL canvas, `ecg_request`/`urgent_escalation` trace advancement, Full VR ready on Quest Browser, and no warning/error console messages. It is not production-ready: `docs/openclinxr/iwsdk-sidecar-phase1-metrics-2026-05-04.json` now records foreground Quest preflight and p95 frame evidence, but still blocks on `app_js_bundle_kb_over_budget`, `bundle_delta_vs_ui_xr_kb_over_budget`, `avg_fps_below_floor`, and `missing_controller_select_latency_ms`. Patrick approved [proposal-iwsdk-phase2-devtools.md](../../proposals/approved/proposal-iwsdk-phase2-devtools.md) on 2026-05-04, so Codex may add `@iwsdk/vite-plugin-dev@0.3.1`, adapter sync, and MCP inventory evidence inside `apps/ui-xr-iwsdk-spike` when useful under `--approved-phase2-devtools`. Patrick also approved reference warmup scope, `@meta-quest/hzdb` legal/procurement posture, and the Quest foreground performance capture proposal, but those approvals do not authorize production manifests, default verification, or production Quest readiness claims without the human headset report. Keep `@iwsdk/create`, `@iwsdk/reference`, `@iwsdk/starter-assets`, `@meta-quest/hzdb`, and optimizer packages out of the sidecar until their gates are deliberately revised. The sidecar must not import or depend on `@openclinxr/ui-xr` or `apps/ui-xr/src/**`. `docs/openclinxr/iwsdk-codex-mcp-runbook.md` is the human runbook for the future local adapter. `pnpm iwsdk:verify` is the opt-in IWSDK policy lane and now runs the workspace posture check with `--approved-sidecar`; Phase 2 devtool installs require the separate `--approved-phase2-devtools` posture flag.

Current tooling note: `turbo`, `knip`, and `@e18e/cli` are installed as pnpm-managed root dev dependencies. `@openclinxr/graphql` now runs `graphql-codegen` against local schema and operation files, publishes typed client documents/resolver signatures, and blocks drift with `generate:check` in package tests. `pnpm packages:typecheck` and `pnpm packages:test` now delegate package work to `turbo run` with telemetry opt-out variables set in the scripts, while root-only agent/source/audit checks stay outside Turbo. `pnpm packages:typecheck:affected`, `pnpm packages:test:affected`, and `pnpm packages:build:affected` provide changed-package-plus-dependent checks for local agent slices before the full `pnpm verify` gate. `packages/cellix/config-typescript` has no package-local test/typecheck script and is safely skipped by Turbo, matching the previous `pnpm -r --if-present` behavior. `pnpm hygiene:knip` is report-only for now. `pnpm hygiene:e18e:help` verifies the E18E CLI entrypoint. `pnpm hygiene:e18e:analyze` is intentionally outside the main `verify` gate because a whole-repo spike on 2026-05-03 did not return promptly and needs a scoped baseline before becoming blocking. MongoDB Agent Skills from `mongodb/agent-skills` are installed locally for future MongoDB schema, repository, query, index, and search/AI slices; use them as workflow guidance before Mongo work, while keeping Atlas/cloud usage separately approved.

## Implementation Progress

Milestone 1 deterministic station core has started:

- pnpm workspace added.
- Shared schemas package added.
- Pure station domain package added.
- ED chest pain fixture package added.
- In-memory trace ledger package added.
- Review workflow package added.
- Test harness package added.

The current deterministic harness runs the ED chest pain fixture through station start, encounter, nurse interruption, learner actions, patient note submission, trace replay, and faculty review packet generation using the offline model and voice gateways for provider health.

Milestone 2 API shell has also started:

- Hono API app exists at `apps/api`.
- API can serve the ED fixture, start a session, append learner trace events, submit a note, and return a review packet.
- API state is intentionally in-memory by default for this slice, but the persistence boundary now has Mongo-backed integration coverage for review replay.
- API provider health is now sourced from the offline model and voice gateways rather than hard-coded local literals.

MongoDB repository-contract milestone has also started:

- `packages/openclinxr/data-mongodb` exists.
- `mongodb-memory-server` tests pass locally using MongoDB binary `7.0.24`.
- Scenario, trace, review-packet, scenario-review-decision, exam-form, and station-run queue repositories now have contract tests for versioned scenario lookup, approved scenario queries, trace append, ordered replay, sequence uniqueness, review replay order, locked scenario refs, and reviewer queue snapshots.

XR station-shell milestone has also started:

- `apps/ui-xr` exists.
- The ED chest pain station shell renders a Three.js emergency department bay with patient, nurse, spouse, bed, monitor, timer/status strip, simulated EHR, mock dialogue, and trace action controls.
- Runtime state tests, package typecheck, and production build pass locally.
- Desktop and mobile browser smoke checks show a nonblank canvas with no console errors and readable control surfaces.
- Quest 3 smoke has advanced past USB authorization: the local shell loads and trace controls advance in Quest Browser. The remaining hardware-performance blocker is reliable sustained frame sampling and frame-pacing evidence on the headset; current CDP evidence reports the page as hidden/inactive during the automated sample.

Offline model/voice gateway milestone has also started:

- `packages/openclinxr/model-gateway` exists.
- `packages/openclinxr/voice-gateway` exists.
- Mock model responses are deterministic and include provider/model IDs, policy IDs, prompt template ID, scenario version, actor ID, retrieved memory IDs, safety policy version, token usage, zero cost, and guardrail result.
- Mock voice streaming emits partial/final transcript events and audio chunk events with provenance and a viseme cue.
- Local model and voice adapters are intentionally surfaced as `not_configured` until local Qwen/Kimi/DeepSeek or VibeVoice-style runtime adapters are explicitly installed and benchmarked.

Asset registry milestone has also started:

- `packages/openclinxr/asset-registry` exists.
- ED chest pain placeholder manifests exist for patient, nurse, and ED bay assets.
- Generic scenario placeholder manifests now cover all 12 seed-bank scenarios from their `assetNeeds` entries for dev readiness and Quest budget checks, while preserving production blockers for placeholder assets.
- Registry readiness checks block copyleft/unknown/review-required licenses, missing QA, and over-budget Quest 3 geometry/texture/draw-call profiles.
- Registry readiness now separates `devReady` from `productionReady`; placeholders can support deterministic smoke tests but block production clinical release readiness.
- This is the gate to use before attempting Anny, MakeHuman, StableGen, SMPLitex, clothing, rigging, or generated-environment ingestion.

Scenario runtime milestone has also started:

- `packages/openclinxr/scenario-runtime` exists.
- It centralizes the ED chest pain station session flow, trace append, note submission, provider health, asset readiness, and review packet generation.
- Session creation now requires explicit consent and starts in doorway phase.
- Encounter start is a separate runtime/API transition, preserving the doorway hold expected in a clinical-skills exam station.
- `packages/openclinxr/session-state` now owns the promoted Phase 2 persistence-boundary contract for durable conversation turns, actor emotional-state timeline records, durable clinical-event records, disposable Redis/Redka-shaped realtime cache snapshots, and cache rehydration from durable state. Its durable-store interfaces expose `listClinicalEventReviewProjections(...)` so reviewer paths can use redacted projections as the first-class replay shape. `packages/openclinxr/data-mongodb` contains package-local MongoDB adapters for durable turns, emotional-state timelines, and clinical events, including the same redacted clinical-event review projection path. Clinical-event ids are immutable idempotency keys; status-change history uses distinct event ids rather than replacing an earlier event. API/runtime wiring and Redis/Redka runtime adapters remain future slices.
- `packages/openclinxr/scenario-runtime` now exposes `routeActorInteractionTurn` to route learner text or final voice transcripts through the promoted multi-actor session state, update per-actor conversation turns, and append sanitized `actor.interaction.routed` trace events without raw audio.
- `apps/api` exposes `POST /sessions/:stationRunId/actor-interaction-route` for the same non-realtime routing flow. The response redacts server-only actor context and returns only routed actor id, routing reason, conversation turn, and sanitized trace evidence.
- `apps/api` now uses it for station sessions, provider health, asset readiness, and review packets.
- `packages/openclinxr/test-harness` now uses it for the deterministic ED chest pain benchmark.

Exam assembly milestone has also started:

- `packages/openclinxr/exam-assembly` exists.
- It creates ordered exam forms from approved scenarios and reports required trace-tag coverage gaps.
- It now reports station-count fit, required environment coverage, safety-critical trace-tag coverage, and assembly issues.
- It now creates a Step 2 CS-style 12-station seed blueprint with 60-second doorway reading, 15-minute encounters, 10-minute notes, and breaks after stations 3, 6, and 9.
- It now derives deterministic station timing windows and break checkpoints from blueprint timing, giving XR/admin runtime a pure sequence plan before station execution is wired.
- It now creates a deterministic station-run queue for the 12-station seed form, preserving station order and timing while marking only the reviewed ED chest pain scenario activation-ready and keeping the eleven synthetic drafts blocked.
- It can evaluate seed-blueprint scenario readiness separately from exam-form lock, so the full sequence is visible while the eleven unreviewed draft stations remain blocked from runnable form assembly.
- It can detect scenario version drift after a form has locked station references.
- It rejects unapproved scenarios before exam-form lock, preserving the human review gates from the scenario fixture.
- `apps/api` exposes the default blueprint and a local exam-form assembly endpoint for the first ED chest pain pilot form.
- `apps/api` exposes the 12-station seed blueprint, governance readiness blockers, deterministic timing plan, station-run queue, reviewer queue snapshot creation/listing, and seed-bank asset readiness through `/exam-blueprints/step2cs-seed`, `/exam-blueprints/step2cs-seed/readiness`, `/exam-blueprints/step2cs-seed/timing-plan`, `/exam-blueprints/step2cs-seed/station-run-queue`, `GET /exam-blueprints/step2cs-seed/station-run-queue/snapshots`, `POST /exam-blueprints/step2cs-seed/station-run-queue/snapshots`, `/admin/graphql`, and `/scenario-bank/assets/readiness`.
- `apps/api` exposes version-drift comparison for a submitted exam form against current scenario versions.
- `packages/openclinxr/data-mongodb` persists exam forms with locked scenario refs for later drift review.
- `packages/openclinxr/data-mongodb` persists station-run queue snapshots with reviewer provenance, timing, launch-gating status, and per-station blockers so admin approval can reference the exact queue that was reviewed.
- `packages/openclinxr/data-mongodb` has a dev-only API restart integration test that submits `SubmitScenarioReview`, recreates the app with a fresh Mongo-backed persistence sink, and confirms both `ScenarioDetail` and `ScenarioReviewDecisions` replay the persisted review decision without exposing hidden facts.
- `apps/ui-admin` has typed control-plane client methods and an exam-forms workbench action for listing and creating seed station-run queue review snapshots through GraphQL Code Generator typed documents exported from `@openclinxr/graphql/client`. The same generated-document path now exposes immutable `ScenarioReviewDecisions` audit records for reviewer role, decision, comments, evidence refs, and timestamp. The default admin app executes generated GraphQL operations through Apollo Client with network-only query fetch policy, while retaining fetch-based REST calls and injectable test clients.
- `packages/openclinxr/architecture-rules` enforces the current boundary decision that UI apps call REST through app-local API clients, UI GraphQL imports stay on the generated document subpath, API persistence remains injected instead of importing concrete Mongo packages, and UI apps do not depend on Mongo persistence source packages.
- `packages/openclinxr/graphql` includes `createStationRunQueueSnapshot`, `stationRunQueueSnapshots`, `submitScenarioReview`, and `scenarioReviewDecisions` operation contracts, exports static document metadata through `@openclinxr/graphql/documents`, exports typed generated documents through `@openclinxr/graphql/client`, generates TypeScript resolver signatures through `@openclinxr/graphql/resolvers`, and now types the executable API GraphQL root value against the generated station-run queue and scenario-review audit args/results.
- `packages/openclinxr/data-sources-mongoose-models` includes a Mongoose 9 station-run queue snapshot model and repository with reviewer provenance, blueprint/scenario indexes, and newest-first blueprint listing.

Agent-loop orchestration milestone has also started:

- `packages/openclinxr/agent-loop` exists.
- It indexes active persistent memories while hiding superseded entries.
- It normalizes existing agent-factory scorecards into an executable loop model.
- It computes weighted maturity deltas on the 0-5 rubric and blocks senior leadership readiness when evidence, decision, or high/critical risk debt remains open.
- It emits staged work orders for core revision, physician specialty review, legal governance review, adversarial counterplanning, and leadership review or preflight.
- It serializes agent-loop plans into JSON-safe memory indexes and creates per-work-order dispatch packets with retrieved memory entries and relevant next actions.
- Its executable physician roster now includes emergency medicine, anesthesiology/critical care, cardiology, family medicine, infectious disease, internal medicine, neurology, psychiatry, pediatrics, radiology/imaging, OB/GYN, and surgery.
- `npm run agent:loop -- iterations/iteration-0007 --previous iterations/iteration-0006` writes `iterations/iteration-0007/09-agent-loop-plan.json`.

Scenario-bank governance milestone has also started:

- Scenario schemas now require governance metadata: formative/pilot/summative score-use label, synthetic disclosure, validation stage, limitations, reviewer roles, source IDs, safety-critical trace tags, and hidden-fact policy.
- Validated summative score-use claims are rejected unless governance is `stage_3_validated`.
- ED chest pain is marked `formative_local_only` with explicit validation limitations.
- The executable fixture bank now mirrors the 12-station seed form from `sample-case-bank-v1`: ED chest pain is the only activation-eligible reviewed fixture, while eleven synthetic drafts preserve governance blockers until specialty clinician, psychometric, legal, and simulation QA review evidence exists.
- Shared scenario schemas now allow the expanded actor roles needed by the case bank: consultant, interpreter, medical assistant, and respiratory therapist, in addition to patient, family, nurse, physician, and system.
- `evaluateScenarioBankMaturity` reports status counts, validation-stage counts, activation-eligible scenarios, blocked draft scenarios, setting diversity across all 12 environments, actor-role coverage, safety-critical trace tags, hidden-fact policy coverage, fixture-completeness blockers for each synthetic case, traceability coverage from required tags to rubrics/events/safety-critical tags, and the gap from the 12-station Step 2 CS-style target.
- The default API scenario endpoint now returns a learner-safe projection with actor hidden facts redacted.
- `packages/openclinxr/domain` now exports safe claim-language constants and an unsafe-claim scanner for user-facing assessment copy, blocking exam-equivalence, licensure/credentialing, diagnostic-performance, high-stakes score-use, and unsupported validation claims before UI/API surfaces adopt them.
- `apps/ui-admin` now renders the seed exam governance notice from the domain claim-language module and tests that the rendered notice has no unsafe claim-language findings.

Actor-response safety milestone has also started:

- The deterministic mock model provider now grounds normal responses on visible facts rather than hidden facts.
- Hidden-truth extraction attempts such as requests to reveal hidden facts or ignore instructions return an auditable `blocked_fallback`.
- Scenario runtime records actor responses as trace events with model provenance, guardrail status, token usage, and zero-cost mock accounting.
- API exposes `POST /sessions/:stationRunId/actor-response` for actor turns.
- If `actorId` is omitted from `POST /sessions/:stationRunId/actor-response`, the API now routes the utterance through the promoted session-state actor router before generating the response; explicit `actorId` keeps the direct path.
- API exposes `POST /sessions/:stationRunId/clinical-actions` for explicit session-state clinical action updates (`order_requested` or `finding_observed`) without changing the generic trace-event endpoint.
- Actor model requests now include safe clinical context from session-state (`completedTraceTags` and open orders) while keeping hidden facts out of model requests and response payloads.
- Actor-response generation failures now append sanitized `actor.response.failed` trace events and return a controlled API error.
- Test harness now includes both a normal actor turn and a blocked hidden-fact extraction probe.

Review, publication, and persistence milestones have also started:

- Review packets now include ordered replay timelines, trace-quality counts, patient-note evidence, model provenance presence, blocked guardrail counts, actor-response failure counts, and unsafe-event counts.
- Scenario publication readiness gates require reviewer evidence by role, validation-stage maturity, target-use score governance, hidden-fact policy, and asset readiness.
- API exposes publication readiness through `POST /scenarios/ed-chest-pain/publication-readiness`.
- MongoDB memory repositories now persist review packets with timeline and trace-quality fields intact.
- API exposes station trace replay through `GET /sessions/:stationRunId/trace-events`.
- The deterministic benchmark now reports trace quality, review signals, and an adversarial probe report with hidden-fact leakage, hidden-truth guardrail, and actor-response provider-failure probes.

XR shell integration milestone has also started:

- `apps/ui-xr` has a typed optional API client for session start, encounter start, trace event sync, actor response requests, and note submission.
- `apps/api` now has a CellixJS-inspired fluent startup builder that registers infrastructure service IDs, initializes application services, records Azure Function-compatible GraphQL/REST handler metadata, and feeds the local Hono Node server through the same startup path.
- Project packages have moved under `packages/openclinxr/*`, while `packages/cellix/*` is reserved for immutable shared Cellix-compatible library copies.
- `docs/openclinxr/cellix-package-adoption-brief.md` reviews the current CellixJS `packages/cellix` catalog and recommends deferring copies until a concrete implementation slice needs one.
- `packages/cellix/config-typescript` is the first copied Cellix-derived package, with local TypeScript 6-compatible config contents and a package changelog. Root `tsconfig.base.json` now extends it.
- Typechecking now uses Cellix's `tsgo` path through `@typescript/native-preview` across root, app, and package scripts after a local spike showed the root check completing faster than the previous `tsc` command on this hardware.
- `packages/openclinxr/config-rolldown` is a local compatibility spike for the Cellix `config-rolldown` Azure Functions bundling pattern, with OpenClinXR workspace dependency alias discovery and Azure Functions deploy artifact preparation while keeping the project on latest-package posture before any immutable Cellix copy is vendored.
- `apps/api` now has a `tsdown.config.ts` API deploy build, fallback `rolldown.config.ts`, CellixJS-inspired Azure Functions `host.json` with OpenTelemetry mode, `.funcignore`, `package:azure`, and `smoke:azure` scripts; the smoke script imports the bundled deploy artifact and checks health, timing, station-run queue, REST review snapshot, and GraphQL snapshot paths.
- `packages/openclinxr/graphql` now avoids runtime `.graphql` file reads in bundled API code by generating static TypeScript schema and operation artifacts. Package tests run `generate:check` before Vitest so source `.graphql` files cannot drift from the bundled artifacts, and the admin UI plus Azure bundle smoke consume the shared generated document export.
- `apps/api` now injects a no-op or in-memory telemetry recorder through the CellixJS-inspired startup path and records sanitized route-level and admin GraphQL operation spans with stable route IDs, route surfaces, station-run-scoped flags, operation names, status codes, and duration. Raw station-run IDs are intentionally kept out of API route spans because they include learner-scoped request identity; request bodies, variables, learner utterances, prompts, patient notes, and hidden facts are also excluded. `@openclinxr/telemetry` provides a local-only span summary helper that buckets by low-cardinality labels for performance analysis before a full OpenTelemetry exporter is wired.
- `packages/openclinxr/data-sources-mongoose-models` exists with a first scenario-bank Mongoose model, publication indexes, a Mongoose-memory repository test path, review-gated scenario promotion, latest-approved lookup, and learner projections that redact hidden clinical truth.
- `packages/openclinxr/ui-route-shared`, `packages/openclinxr/ui-route-admin`, `packages/openclinxr/ui-shared`, and `packages/openclinxr/architecture-rules` now start the portal package split and enforce early ArchUnitTS rules, including telemetry dependency-lightness, Mongoose data-source isolation, and agent-loop/runtime separation.
- `turbo.json` now orchestrates package-level `typecheck`, `test`, `build`, and `dev` tasks. Root `typecheck` and `test` delegate package work through `turbo run`, affected-package scripts use `--affected`, while root agent-factory, source-ledger, audit, and license checks remain explicit root commands. Architecture rules now enforce Turbo delegation, telemetry opt-out variables, affected-package scripts, and no tracked `.turbo` cache artifacts.
- `pnpm verify` now includes `pnpm audit --audit-level=high`; any future audit ignore or pnpm override must be recorded in `docs/openclinxr/security-audit-exceptions.md`.
- `cellixjs-feedback.md` is the running upstream-feedback log for deficiencies, migration guidance gaps, or design ideas discovered while adapting CellixJS patterns.
- The UI stays local-first and only syncs trace actions in the background when `VITE_OPENCLINXR_API_BASE_URL` is configured.
- Fresh browser and Quest 3 smoke evidence is recorded in `docs/openclinxr/quest3-usb-webxr-smoke-checklist.md`.
