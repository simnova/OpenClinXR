# OpenClinXR Code Implementation Plan (Historical Context)

**Note (2026-06, post new-owner efficiency + reorg):** Superseded by current snapshots in PROJECT_COORDINATION_INDEX.md / AUTONOMOUS_WORK_PLAN.md / worker-backlog-and-validation-matrix.md (UI-XR runtime evidence consumer + materialization for peds_asthma_parent_anxiety_v1, OpenClaw daily driver, M1 Max 64GB, gates false). See AGENTS.md + factory/ generators for active blueprint-to-runtime slices. This file retained as current-ref per doc-authority-registry for historical reference only; do not treat as active marching orders. Trimmed for relevance.

Date: 2026-05-03 (original)
Status: Historical draft (early exhaustive planning)

Companion artifacts (many now in snapshots or purged historical):

- `docs/openclinxr/worker-backlog-and-validation-matrix.md` (current)
- (historical superpowers/ purged)
- `docs/openclinxr/local-hardware-spike-results.md` (M1-aligned)
- etc.

## Goal (Historical)

Build the first OpenClinXR codebase: a deterministic, single-user, Step 2 CS-inspired XR clinical-skills station skeleton with scenario authoring, review gates, trace replay, mock actor dialogue, local-only model/voice adapter contracts, and a path to Quest 3 validation.

## Product Scope For First Build

Build one complete vertical slice:

- ED chest pain station.
- Patient, spouse, and nurse actors.
- Doorway instructions.
- Encounter timer.
- Nurse interruption.
- Mock actor dialogue.
- Trace event capture.
- Patient note.
- Faculty review packet.
- Scenario review gates.
- Asset manifest and placeholder asset registry.
- Admin web workflow.
- WebXR shell with non-XR fallback.

The first build does not include high-stakes scoring, cloud model providers, real patient data, live generated 3D assets, live local LLM as a dependency, or VibeVoice as a default runtime.

## Repository Shape

Use a pnpm workspace because pnpm is already installed locally and works with TypeScript monorepos. Keep Bun as the target deployment runtime for the API after an install gate; use Node-compatible Hono locally until Bun is installed.

```text
apps/
  api/
  ui-admin/
  ui-xr/
packages/
  cellix/
    <external Cellix-compatible packages used as-is>
  openclinxr/
    shared-schemas/
    domain/
    scenario-fixtures/
    session-state/
    scenario-runtime/
    trace-ledger/
    review-workflow/
    data-mongodb/
    model-gateway/
    voice-gateway/
    asset-registry/
    asset-pipeline/
    ui-route-scenario-bank/
    ui-route-review-replay/
    ui-route-exam-forms/
    ui-route-shared/
    ui-shared/
    graphql/
    rest/
    data-sources-mongoose-models/
    architecture-rules/
    test-harness/
docs/
  openclinxr/
  superpowers/plans/
```

Workspace naming should follow the development team's Turborepo convention:

- SPA portals: `apps/ui-<<portal-name>>`.
- Shared external packages: `packages/cellix/*`, treated as immutable vendor-style code when copied from CellixJS.
- Project-owned packages: `packages/openclinxr/*`.
- Route packages: `packages/openclinxr/ui-route-<<top-level-route>>`.
- Shared route code: `packages/openclinxr/ui-route-shared`.
- Shared UI across portals: `packages/openclinxr/ui-shared`.
- Main Azure Functions-compatible backend: `apps/api`.
- Protocol contracts/adapters: `packages/openclinxr/graphql`, `packages/openclinxr/rest`, and additional `packages/openclinxr/...` protocols as needed.
- Mongoose model layer: `packages/openclinxr/data-sources-mongoose-models`.
- Local dependency simulators: `apps/mock-<<server-type>>-server`.
- Architecture enforcement: `packages/openclinxr/architecture-rules` with ArchUnitTS tests that turn naming and dependency-direction decisions into executable checks.
- Multi-actor runtime state: `packages/openclinxr/session-state` owns the production-shaped actor/session state contract promoted from the server-side multi-actor spike. The historical `packages/openclinxr/multi-actor-state-spike` remains evidence-only and superseded for production imports.

## Dependency Posture

Default local dev dependencies:

- TypeScript.
- Vitest.
- AJV and TypeBox for schemas.
- Hono plus Node server adapter locally.
- React and Vite.
- Ant Design 6 and Pro Components for admin.
- Three.js, React Three Fiber, and WebXR package after license verification.
- Playwright.
- Storybook.
- Serenity/JS after first admin workflow exists.

Optional local-only dependencies behind install gates:

- Bun.
- `mongodb-memory-server` for local Mongo repository tests.
- MongoDB local, Docker, or production URI only for later environment parity tests.
- llama.cpp.
- MLX LM.
- VibeVoice.
- Blender.
- glTF Transform.

## Implementation Phases

The first implementation branch should be treated as a deterministic local proof before immersive fidelity work. The worker backlog matrix binds these phases to package ownership, validation commands, stop conditions, and optional runtime gates.

### Phase 0: Workspace Foundation

Create workspace config, shared TypeScript settings, package boundaries, and verification commands.

Acceptance:

- `pnpm install` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test` runs with at least one passing test.
- No optional AI or 3D dependency is required.

### Phase 1: Shared Schemas

Create versioned schemas for:

- `ExamBlueprint`
- `Scenario`
- `ActorCard`
- `CommunicationProfile`
- `StationState`
- `TraceEvent`
- `PatientNote`
- `ReviewPacket`
- `AssetManifest`
- `ModelProviderAudit`
- `VoiceProviderAudit`

Acceptance:

- Schema validation tests pass.
- Invalid station publication fails when review gates are missing.
- Trace events require station run ID, sequence, timestamp, actor/source, event type, and payload.

### Phase 2: Pure Domain

Implement pure domain functions:

- Station state transitions.
- Timer boundaries.
- Event schedule evaluation.
- Trace event creation.
- Review gate validation.
- Grounding labels.
- Communication-style gate evaluation.

Acceptance:

- ED chest pain station reaches doorway, encounter, note, and review states.
- Nurse interruption fires at the configured simulated minute.
- Missing ECG request is traceable as a station-risk event.

### Phase 3: Fixtures And Seed Data

Implement deterministic fixtures:

- ED chest pain scenario.
- Patient, spouse, nurse actor cards.
- Dialogue fixture table.
- Review rubric.
- Asset manifest.

Acceptance:

- Fixture validates against schemas.
- Fixture can start a station run.
- Fixture can produce review packet from synthetic trace.

### Phase 3A: Multi-Actor Session State

Implement and keep current:

- `packages/openclinxr/session-state`.
- Actor runtime state.
- Per-actor visible/private memory boundaries.
- Text and final voice-transcript interaction provenance.
- Clinical action state for trace tags, orders, and findings.
- Spatial actor transform state.
- Evidence boundaries for realtime sync, persistence, Quest readiness, LLM quality, and clinical validity.

Acceptance:

- `pnpm --filter @openclinxr/session-state test` passes.
- `pnpm --filter @openclinxr/session-state typecheck` passes.
- Production packages do not import `@openclinxr/multi-actor-state-spike`.
- `@openclinxr/session-state` has no Redis, Redka, MongoDB, Colyseus, bitECS, or WebSocket runtime dependency.

### Phase 4: Trace Ledger

Implement append-only in-memory trace first, then MongoDB repository.

Acceptance:

- Append preserves sequence order.
- Replay reconstructs station timeline.
- Review packet highlights required trace tags.
- MongoDB indexes are declared and tested with repository contract tests.
- `mongodb-memory-server` runs local Mongo repository tests once the pinned `mongod` binary is cached.
- `MongoMemoryReplSet` is used for transaction-sensitive tests.

### Phase 5: API

Implement Hono API:

- Scenario CRUD.
- Review state transitions.
- Exam session start.
- Station event append.
- Actor mock response.
- Patient note submission.
- Faculty review packet.
- Local provider health endpoint.

Acceptance:

- API contract tests pass without MongoDB using in-memory repositories.
- MongoDB repository contract tests use `mongodb-memory-server` locally after the pinned binary is cached.
- Production MongoDB repository tests are skipped unless `OPENCLINXR_MONGO_URI` is set.
- No cloud API keys are required.

### Phase 6: Admin App

Implement Ant Design admin:

- Scenario bank list.
- Scenario editor for ED chest pain fixture.
- Actor card and communication profile viewer/editor.
- Review queue.
- Trace replay.
- Faculty review packet.

Acceptance:

- Playwright can create or load the ED chest pain station.
- Scenario cannot be published without review gates.
- Faculty can inspect trace and submit human-governed score draft.

### Phase 7: XR App

Implement Vite WebXR app:

- Non-XR desktop fallback.
- Doorway panel.
- Encounter timer.
- Placeholder room.
- Placeholder actors.
- Simulated EHR/note canvas panel.
- Trace event controls.
- Mock dialogue display.

#### IWSDK Sidecar Policy

Meta Immersive Web SDK is a sidecar spike candidate, not a production XR dependency. Keep the production `apps/ui-xr` shell dependency-free from `@iwsdk/*` until a real install-backed `apps/ui-xr-iwsdk-spike` proves compatibility, license posture, bundle impact, MCP behavior, and foreground Quest 3 performance.

Sidecar rules:

- `apps/ui-xr-iwsdk-spike` now exists after Patrick approved install scope, exact versions, and transitive license posture on 2026-05-04.
- The first install-backed slice evaluates exact-versioned `@iwsdk/core@0.3.1` and `@iwsdk/xr-input@0.3.1` only.
- Both `apps/ui-xr` and `apps/ui-xr-iwsdk-spike` must expose an explicit Quest Browser `Enter Full VR` control that starts `navigator.xr.requestSession("immersive-vr")`; WebXR feature detection alone is not an immersive session.
- Treat that Phase 1 path as full immersive VR, not passthrough mixed reality. Runtime evidence must record `requestedSessionMode: "immersive-vr"` and `mixedRealityPassthroughImplemented: false`; [proposal-webxr-mixed-reality-mode.md](../../proposals/approved/proposal-webxr-mixed-reality-mode.md) is approved as a separate sidecar track, so any `immersive-ar` path must keep its evidence, privacy posture, UX affordances, and production-readiness claims separate from Full VR.
- Keep `@iwsdk/reference`, `@iwsdk/starter-assets`, `@iwsdk/create`, and `@meta-quest/hzdb` out of the first install-backed slice. Patrick approved the reference warmup download scope and `@meta-quest/hzdb` legal/procurement posture on 2026-05-04, but the packages remain sidecar-gated.
- Do not run floating `npx iwsdk reference warmup`; the package-managed candidate is `pnpm dlx @iwsdk/reference@0.3.2 iwsdk-reference warmup`, and it still needs CLI help, cache location, and download-size evidence before execution.
- Reject AGPL, GPL, LGPL, UNLICENSED, Unknown, and unreviewed sharp/libvips-style transitive license paths unless leadership records an explicit exception.
- Run `pnpm iwsdk:verify` before and after any sidecar package or lockfile change.
- Treat IWSDK MCP screenshots, controller emulation, scene inspection, and ECS debugging as local development accelerators, not substitutes for physical Quest 3 USB-C smoke, foreground frame pacing, controller latency, comfort, or in-headset text-readability evidence.
- Treat `docs/openclinxr/iwsdk-sidecar-phase1-metrics-2026-05-04.json` as the first sidecar metric baseline: browser and Quest CDP parity passed, but IWSDK bundle size, average FPS, controller-select latency evidence, and human headset observations remain blockers.

Acceptance:

- Desktop fallback loads in Playwright.
- WebGL canvas renders nonblank.
- XR mode is feature-detected.
- Quest 3 USB-C smoke loads the local Vite app through Quest Browser port forwarding after `adb` authorization.
- Quest 3 smoke remains a manual gate until device automation is available.

### Phase 8: Model And Voice Gateways

Implement mock-first adapters:

- `MockModelProvider`
- `MockVoiceProvider`
- `LocalModelRuntime` interface.
- `LocalVoiceRuntime` interface.
- Provider health checks.
- Benchmark CLI.

Acceptance:

- Mock actor responses are deterministic and schema-valid.
- Local runtime adapters report "not configured" without failing app startup.
- Benchmark CLI can run mock latency tests without model downloads.

#### Capability Facade And Python/Executable Boundary

TypeScript remains the primary application runtime, but the system should explicitly support Python and native executable workers for the asset generation pipeline in both non-production and production. This is separate from the interactive model/voice provider swap problem.

Use `@openclinxr/capability-gateway` as the design contract for these capabilities:

- Interactive runtime plane: model dialogue, scenario generation, speech recognition, and live voice synthesis route through `@openclinxr/model-gateway` and `@openclinxr/voice-gateway`. Local development can use deterministic mocks, local production can opt into local runtimes such as VibeVoice after benchmark/safety gates, and production can use approved provider adapters such as Grok voice without station runtime code changes.
- Asset pipeline plane: character generation, prerecorded voice asset generation, medical equipment generation, animation generation, and asset baking may use Python, Blender, ffmpeg, and other native executables in local development, local production, and production. These jobs must be asynchronous, manifest-producing, license/provenance gated, resource-limited, and routed through the main API facade or an internal sidecar tunnel.
- Persistence plane: local development may use `mongodb-memory-server`, local production may use a local MongoDB instance, and production may use Microsoft DocumentDB or another Mongo-compatible managed service behind repository contracts.

Default external network posture should remain one main API endpoint. Python or executable workers can exist in production, but they should not become direct public endpoints unless a future security decision explicitly accepts that extra surface area. The preferred production shape is main API ingress, internal worker/service routing, and versioned output artifacts.

### Phase 9: Asset Registry And Pipeline

Implement manifest validation and registry:

- Asset manifest schema.
- Asset registry repository.
- Placeholder asset records.
- CLI to validate bundle metadata.
- License/provenance gate.

Acceptance:

- ED chest pain asset manifest validates.
- Missing license blocks simulation QA.
- Missing Quest smoke status blocks runtime approval.

### Phase 10: Test Automation

Add:

- Vitest unit tests.
- API contract tests.
- Playwright admin tests.
- Storybook stories.
- `mongodb-memory-server` repository tests.
- Quest 3 USB-C manual smoke checklist output.
- Scenario simulation tests.
- Fixture replay tests.
- Local-only benchmark scripts.

Acceptance:

- `pnpm verify` runs without external services.
- Optional tests are explicitly gated by environment variables.
- Test reports separate deterministic CI from local model/Quest/device spikes.

## First Milestone Definition Of Done

The first milestone is complete when:

- A developer can run the admin app and API locally.
- The ED chest pain station can be reviewed, started, completed, and replayed.
- The learner-facing app can show doorway, encounter, mock dialogue, and note flow.
- The trace ledger reconstructs required events.
- Faculty review can score with human governance.
- No cloud API is needed.
- Optional local model and voice runtimes remain off by default.
- The codebase has tests for pure domain, schemas, API contracts, admin happy path, and trace replay.

## Implementation Plan Artifact

The task-by-task plan lives at:

- (historical superpowers/ path purged; this doc is now in docs/openclinxr/ as current-ref per new-owner align)

## Sources

- `src-local-hardware-spike-2026-05-03`
- `src-vibevoice-github-2026`
- `src-mlx-lm-github-2026`
- `src-qwen-local-docs-2026`
- `src-deepseek-r1-distill-qwen-2025`
- `src-kimi-k2-thinking-2026`
- `src-internal-openclinxr-architecture-bundle`
- `src-meta-iwsdk-github-2026`
- `src-iwsdk-ai-docs-2026`
- `src-iwsdk-npm-metadata-2026-05-04`
- `src-iwsdk-local-spike-2026-05-04`
- `src-openclinxr-iwsdk-spike-plan-2026-05-04`
