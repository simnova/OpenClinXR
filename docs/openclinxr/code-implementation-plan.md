# OpenClinXR Code Implementation Plan

Date: 2026-05-03
Status: Exhaustive implementation planning draft

Companion artifacts:

- `docs/openclinxr/worker-backlog-and-validation-matrix.md`
- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md`
- `docs/openclinxr/local-hardware-spike-results.md`
- `docs/openclinxr/local-ai-voice-model-strategy.md`
- `docs/openclinxr/mongodb-memory-server-test-strategy.md`
- `docs/openclinxr/quest3-usb-webxr-smoke-checklist.md`

## Goal

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
  shared-schemas/
  domain/
  scenario-fixtures/
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
- Route packages: `packages/ui-route-<<top-level-route>>`.
- Shared route code: `packages/ui-route-shared`.
- Shared UI across portals: `packages/ui-shared`.
- Main Azure Functions-compatible backend: `apps/api`.
- Protocol contracts/adapters: `packages/graphql`, `packages/rest`, and additional `packages/...` protocols as needed.
- Mongoose model layer: `packages/data-sources-mongoose-models`.
- Local dependency simulators: `apps/mock-<<server-type>>-server`.
- Architecture enforcement: `packages/architecture-rules` with ArchUnitTS tests that turn naming and dependency-direction decisions into executable checks.

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

- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md`

## Sources

- `src-local-hardware-spike-2026-05-03`
- `src-vibevoice-github-2026`
- `src-mlx-lm-github-2026`
- `src-qwen-local-docs-2026`
- `src-deepseek-r1-distill-qwen-2025`
- `src-kimi-k2-thinking-2026`
- `src-internal-openclinxr-architecture-bundle`
