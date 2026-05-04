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

Acceptance:

- Learner can complete one station with trace events and a patient note.

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
- Do not claim diagnostic performance, licensure readiness, ECFMG replacement, USMLE equivalence, or validated high-stakes scoring.
- Do not call the first XR shell ready until the desktop fallback renders a nonblank canvas and core text does not overlap.
- Do not claim Quest readiness until the Quest 3 USB-C smoke checklist records a pass or a precise blocker.
- Do not approve a scenario without clinical, psychometric, legal, and simulation QA review states.

## Local Hardware Updates

- Android Platform Tools were installed locally on 2026-05-03.
- The Quest 3 is visible to `adb` as device serial `2G0YC5ZGB5000J`; USB debugging is authorized, `adb reverse tcp:5173 tcp:5173` succeeds, and Quest Browser can load the local XR app through the reversed port.
- `pnpm xr:quest:smoke` produced `docs/openclinxr/quest-cdp-smoke-2026-05-03.json`: the Quest Browser shell loaded, the Three.js canvas was nonblank, WebXR was exposed as ready, and a trace interaction advanced. The current blocker is sustained frame sampling: the app now exposes frame telemetry, but CDP reports the Quest page as `document.hidden`, so the render loop records only the initial frame. Do not claim Quest frame-pacing readiness yet.
- `mongodb-memory-server` is accepted as the local MongoDB integration-test path, with binary download/cache behavior documented as an explicit setup gate.
- `pnpm local:runtime:probe` produced `docs/openclinxr/local-runtime-probe-2026-05-03.json`: Quest USB and the pinned Apache-2.0 `gltf-pipeline` CLI are ready on this machine, while local model runtime, local voice runtime, and Blender-backed asset generation/bake steps are intentionally marked `not_configured` until Ollama/llama.cpp/MLX, VibeVoice-style voice runtime, and Blender are installed and benchmarked.

## Executable Local Evidence Gates

Use these commands when moving from design intent to verified readiness:

- `pnpm verify`: full local gate covering agent artifacts, TypeScript, package tests, pnpm audit, and dependency license policy.
- `pnpm agent:verify`: agent-factory gate covering memory index, source ledger, pinned dependencies, stale loop-plan detection, risk/evidence debt, maturity, and benchmark evidence reporting.
- `pnpm agent:benchmarks`: regenerates `.agent-factory/benchmark-gate-report.json` from the latest Quest CDP smoke, manual Quest performance, GLB pipeline, local runtime, and local provider benchmark outputs. The report keeps raw blockers for traceability and adds `blocker_summary.groups` so leadership can see the distinct remediation buckets.
- `pnpm asset:gltf:smoke`: generates a tiny local glTF, runs the pinned `gltf-pipeline` CLI, validates the resulting GLB header/length, and writes a machine-readable smoke report when `--output` is supplied.
- `pnpm local:provider:benchmark`: records deterministic mock model/voice benchmark evidence and explicit local model/voice readiness blockers without downloads, cloud calls, or local runtime execution. Use `.env.openclinxr.local.example` as the local-only setup contract for `OPENCLINXR_LOCAL_MODEL_RUNTIME`, `OPENCLINXR_LOCAL_MODEL_ID`, `OPENCLINXR_LOCAL_VOICE_RUNTIME`, and `OPENCLINXR_LOCAL_VOICE_ID`; keep real values out of version control. To load a private file explicitly, run `pnpm local:provider:benchmark -- --env-file .env.openclinxr.local`.
- `pnpm xr:quest:smoke`: starts a CDP-backed Quest Browser smoke against the local XR app. It requires the dev server to be running and the Quest 3 connected/authorized over USB-C.
- `pnpm xr:quest:manual:check`: validates a foreground in-headset manual performance report, or records `missing_quest_manual_performance_report` until one exists. Use `docs/openclinxr/quest-manual-performance-template.json` as the capture template.
- `pnpm local:runtime:probe`: checks local hardware/runtime prerequisites without cloud or paid API usage.
- `pnpm --filter @openclinxr/api smoke:azure`: locally bundles the Hono/Azure-compatible API with Rolldown and smoke-tests `/health` plus the Step 2 CS-style seed timing-plan endpoint.
- `pnpm security:audit`: runs `pnpm audit --audit-level=high`.
- `pnpm security:licenses`: checks dependency licenses against the OpenClinXR policy and writes `docs/openclinxr/dependency-license-policy-2026-05-03.json`.

## Development Team Stack Preferences

Use these preferences when making new implementation decisions unless a runtime constraint argues against them:

- Prefer pnpm over npm for workspace dependency management and command examples.
- Use Turborepo-friendly names: `apps/ui-<<portal-name>>` for React SPAs, `packages/openclinxr/ui-route-<<top-level-route>>` for route-owned code, `packages/openclinxr/ui-route-shared` for route-shared SPA code, `packages/openclinxr/ui-shared` for cross-portal SPA code, `packages/openclinxr/graphql` and `packages/openclinxr/rest` for protocol packages, `packages/openclinxr/data-sources-mongoose-models` for Mongoose models, and `apps/mock-<<server-type>>-server` for local mock servers.
- Keep `packages/cellix/*` reserved for shared Cellix-compatible packages copied from CellixJS and used as-is. If project-specific edits are needed, make a modified copy under `packages/openclinxr/*` instead of changing `packages/cellix/*`.
- Treat architectural decisions as executable rules: `packages/openclinxr/architecture-rules` uses ArchUnitTS to enforce approved app naming, prevent UI portal imports from backend persistence/runtime packages, and check shared UI packages for import cycles.
- Prefer Mongoose for mature MongoDB admin/control-plane schemas, while keeping high-volume trace replay repositories thin and performance-oriented.
- Prefer Apollo GraphQL plus GraphQL Code Generator for admin workbench queries and generated TypeScript operation/resolver contracts. The first generated-document slice is active in `packages/openclinxr/graphql` and consumed by `apps/ui-admin` for station-run queue review snapshots.
- Prefer React Router for administrative app routing and nested workbench modules.
- Prefer TurboRepo when package count and CI/runtime tasks need caching or affected-package execution.
- Prefer Biome, Knip, and E18E for lint/format, unused dependency/export detection, and ecosystem-health review after scoped baselines are tuned.
- Prefer OpenTelemetry for performance analysis and trace/metric naming across API, GraphQL, MongoDB, model/voice gateways, and XR runtime events.
- Prefer a CellixJS-inspired fluent API bootstrap for `apps/api`: register infrastructure services, set request/application context, initialize application services, register Azure Function-compatible GraphQL/REST handlers, then start up. Keep the OpenClinXR variant Hono/Azure Functions-compatible and local-testable.
- Treat the Ant Design CLI skill as optional local support for AntD 6 component work. Prefer package-managed execution with `@ant-design/cli`, use `--format json`, and verify exact-version component APIs/tokens/demos before authoring UI. A 2026-05-04 package-managed spike showed `env`, `doctor`, and `info` working for `apps/ui-admin`, but `lint` failed with `ERR_REQUIRE_ESM` in a transient `oxc-parser` dependency path, so do not add AntD CLI lint to `pnpm verify` yet. The CLI is not installed globally in this workspace.
- Treat Apollo GraphQL Skills as optional local agent support for schema, operation, and client reviews. Install and record them deliberately, keep recommendations source-aware, and require repo tests/codegen to back any GraphQL implementation changes.
- If TurboRepo is introduced, use the official Turborepo skill as operating guidance: package scripts own task logic, root scripts delegate with `turbo run`, `--affected` gates changed packages and dependents, dev/watch tasks are persistent and uncached, repo scripts set `TURBO_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1`, and remote caching remains disabled unless the team explicitly enables it.
- Consider Portless as an optional local developer-experience layer for parallel worktrees and named local URLs. Keep it opt-in until the team chooses to install and trust it interactively: its README/help output says it can discover pnpm workspaces, assign free child ports, inject Vite/React Router `--port`/`--host` flags, and prefix linked-worktree URLs with the branch name. A 2026-05-04 local help spike confirmed package-managed use, but also confirmed first real proxy use may auto-elevate, trust a local CA, and sync `/etc/hosts`, so do not start it unattended. Do not replace Quest 3 `adb reverse tcp:5173 tcp:5173` evidence with Portless LAN mode until a headset spike verifies that path.

Current tooling note: `turbo`, `knip`, and `@e18e/cli` are installed as pnpm-managed root dev dependencies. `@openclinxr/graphql` now runs `graphql-codegen` against local schema and operation files, publishes typed client documents/resolver signatures, and blocks drift with `generate:check` in package tests. `pnpm packages:typecheck` and `pnpm packages:test` now delegate package work to `turbo run` with telemetry opt-out variables set in the scripts, while root-only agent/source/audit checks stay outside Turbo. `pnpm packages:typecheck:affected`, `pnpm packages:test:affected`, and `pnpm packages:build:affected` provide changed-package-plus-dependent checks for local agent slices before the full `pnpm verify` gate. `packages/cellix/config-typescript` has no package-local test/typecheck script and is safely skipped by Turbo, matching the previous `pnpm -r --if-present` behavior. `pnpm hygiene:knip` is report-only for now. `pnpm hygiene:e18e:help` verifies the E18E CLI entrypoint. `pnpm hygiene:e18e:analyze` is intentionally outside the main `verify` gate because a whole-repo spike on 2026-05-03 did not return promptly and needs a scoped baseline before becoming blocking.

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
- API state is intentionally in-memory for this slice; MongoDB remains a later repository-contract milestone.
- API provider health is now sourced from the offline model and voice gateways rather than hard-coded local literals.

MongoDB repository-contract milestone has also started:

- `packages/openclinxr/data-mongodb` exists.
- `mongodb-memory-server` tests pass locally using MongoDB binary `7.0.24`.
- Scenario and trace repositories now have first contract tests for versioned scenario lookup, approved scenario queries, trace append, ordered replay, and sequence uniqueness.

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
- `apps/ui-admin` has typed control-plane client methods and an exam-forms workbench action for listing and creating seed station-run queue review snapshots through GraphQL Code Generator typed documents exported from `@openclinxr/graphql/client`. The default admin app now executes those generated GraphQL operations through Apollo Client with network-only query fetch policy, while retaining fetch-based REST calls and injectable test clients.
- `packages/openclinxr/architecture-rules` enforces the current boundary decision that UI apps call REST through app-local API clients, UI GraphQL imports stay on the generated document subpath, API persistence remains injected instead of importing concrete Mongo packages, and UI apps do not depend on Mongo persistence source packages.
- `packages/openclinxr/graphql` includes `createStationRunQueueSnapshot` and `stationRunQueueSnapshots` operation contracts, exports static document metadata through `@openclinxr/graphql/documents`, exports typed generated documents through `@openclinxr/graphql/client`, generates TypeScript resolver signatures through `@openclinxr/graphql/resolvers`, and now types the executable API GraphQL root value against the generated station-run queue snapshot args/results.
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
- `evaluateScenarioBankMaturity` reports status counts, validation-stage counts, activation-eligible scenarios, blocked draft scenarios, setting diversity across all 12 environments, actor-role coverage, safety-critical trace tags, hidden-fact policy coverage, and the gap from the 12-station Step 2 CS-style target.
- The default API scenario endpoint now returns a learner-safe projection with actor hidden facts redacted.

Actor-response safety milestone has also started:

- The deterministic mock model provider now grounds normal responses on visible facts rather than hidden facts.
- Hidden-truth extraction attempts such as requests to reveal hidden facts or ignore instructions return an auditable `blocked_fallback`.
- Scenario runtime records actor responses as trace events with model provenance, guardrail status, token usage, and zero-cost mock accounting.
- API exposes `POST /sessions/:stationRunId/actor-response` for actor turns.
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
- `apps/api` now has a real `rolldown.config.ts`, CellixJS-inspired Azure Functions `host.json` with OpenTelemetry mode, `.funcignore`, `package:azure`, and `smoke:azure` scripts; the smoke script imports the bundled deploy artifact and checks `/health`.
- `packages/openclinxr/graphql` now avoids runtime `.graphql` file reads in bundled API code by generating static TypeScript schema and operation artifacts. Package tests run `generate:check` before Vitest so source `.graphql` files cannot drift from the bundled artifacts, and the admin UI plus Azure bundle smoke consume the shared generated document export.
- `apps/api` now injects a no-op or in-memory telemetry recorder through the CellixJS-inspired startup path and records sanitized route-level and admin GraphQL operation spans with stable route IDs, operation names, status codes, duration, and station-run IDs where applicable. Request bodies, variables, learner utterances, prompts, patient notes, and hidden facts are intentionally excluded from telemetry attributes.
- `packages/openclinxr/data-sources-mongoose-models` exists with a first scenario-bank Mongoose model, publication indexes, a Mongoose-memory repository test path, review-gated scenario promotion, latest-approved lookup, and learner projections that redact hidden clinical truth.
- `packages/openclinxr/ui-route-shared`, `packages/openclinxr/ui-route-admin`, `packages/openclinxr/ui-shared`, and `packages/openclinxr/architecture-rules` now start the portal package split and enforce early ArchUnitTS rules, including telemetry dependency-lightness, Mongoose data-source isolation, and agent-loop/runtime separation.
- `turbo.json` now orchestrates package-level `typecheck`, `test`, `build`, and `dev` tasks. Root `typecheck` and `test` delegate package work through `turbo run`, affected-package scripts use `--affected`, while root agent-factory, source-ledger, audit, and license checks remain explicit root commands. Architecture rules now enforce Turbo delegation, telemetry opt-out variables, affected-package scripts, and no tracked `.turbo` cache artifacts.
- `pnpm verify` now includes `pnpm audit --audit-level=high`; any future audit ignore or pnpm override must be recorded in `docs/openclinxr/security-audit-exceptions.md`.
- `cellixjs-feedback.md` is the running upstream-feedback log for deficiencies, migration guidance gaps, or design ideas discovered while adapting CellixJS patterns.
- The UI stays local-first and only syncs trace actions in the background when `VITE_OPENCLINXR_API_BASE_URL` is configured.
- Fresh browser and Quest 3 smoke evidence is recorded in `docs/openclinxr/quest3-usb-webxr-smoke-checklist.md`.
