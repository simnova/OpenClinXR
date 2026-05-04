# Worker Backlog And Validation Matrix

Date: 2026-05-03
Status: code-phase handoff companion

## Purpose

This document translates the architecture into worker-owned build slices. It complements the exhaustive implementation plan and should be kept current while code is being written.

## Global Rules

- No cloud APIs, paid services, or third-party model calls in default setup.
- No model or voice downloads during install, test, or dev startup.
- Optional local runtimes must report `not_configured` instead of failing.
- `mongodb-memory-server` may download a `mongod` binary for local integration tests; this must be pinned, documented, and skippable until cached.
- Every package gets unit tests before downstream UI depends on it.
- Every user-facing assessment phrase must avoid licensure, diagnosis, and exam-equivalence claims.
- Every asset record must carry provenance, license, optimization target, and QA status.

## Worker 1: Workspace Steward

Owned paths:

- `pnpm-workspace.yaml`
- `package.json`
- `tsconfig.base.json`
- `vitest.config.ts`
- `.npmrc`

Tasks:

- Create workspace.
- Add root verification scripts.
- Pin dependency versions.
- Document optional dependency gates.

Validation:

- `pnpm install`
- `pnpm typecheck`
- `pnpm test`

Done when:

- Empty workspace or first package verifies without optional runtimes.

## Worker 2: Schema Steward

Owned paths:

- `packages/openclinxr/shared-schemas`

Schemas:

- `ExamBlueprint`
- `Scenario`
- `ActorCard`
- `CommunicationProfile`
- `EnvironmentManifest`
- `AssetManifest`
- `StationRun`
- `TraceEvent`
- `PatientNote`
- `ReviewPacket`
- `ModelProviderAudit`
- `VoiceProviderAudit`
- `ProviderHealth`

Validation:

- Valid ED chest pain scenario passes.
- Missing review gates fail.
- Trace event without sequence fails.
- Asset without license fails.
- Provider audit without provider ID fails.

Done when:

- Schema package has passing positive and negative tests.

## Worker 3: Domain Steward

Owned paths:

- `packages/openclinxr/domain`

Tasks:

- Implement station state transitions.
- Implement command validation.
- Implement event schedule evaluation.
- Implement required trace tag evaluation.
- Implement claim-language constants for safe UI copy.

Validation:

- Doorway to encounter to note to review passes.
- Note submission before encounter end fails.
- Nurse interruption appears at configured time.
- Missing ECG request is detected.

Done when:

- Domain package has no dependency on API, React, MongoDB, model, or voice packages.

## Worker 4: Scenario Fixture Steward

Owned paths:

- `packages/openclinxr/scenario-fixtures`

Tasks:

- Encode ED chest pain station.
- Add patient, spouse, and nurse actors.
- Add environment needs.
- Add equipment needs.
- Add required trace tags.
- Add dialogue fixture seeds.
- Add review rubric IDs.

Validation:

- Fixture validates against schemas.
- Actor IDs referenced by dialogue and trace expectations exist.
- Required trace tags align with review packet expectations.

Done when:

- Test harness can load the fixture without file-system guessing.

## Worker 5: Trace And Review Steward

Owned paths:

- `packages/openclinxr/trace-ledger`
- `packages/openclinxr/review-workflow`

Tasks:

- Add append-only in-memory trace ledger.
- Add replay API.
- Add review packet builder.
- Add observed/missing/late behavior classification.
- Add human faculty score draft shape.

Validation:

- Sequence ordering enforced.
- Replay is deterministic.
- Missing required tag is flagged.
- Human score draft cannot be generated without reviewer identity.

Done when:

- A synthetic trace can produce a faculty review packet.

## Worker 6: Test Harness Steward

Owned paths:

- `packages/openclinxr/test-harness`

Tasks:

- Build deterministic station runner.
- Emit trace fixture.
- Submit patient note.
- Generate review packet.
- Emit JSON summary for CI.
- Report optional runtime skip status.

Validation:

- `pnpm --filter @openclinxr/test-harness bench:mock`
- Simulation completes under local-only constraints.
- Output includes station run ID, event count, missing required tags, and provider health.

Done when:

- This harness is the first sprint completion gate.

## Worker 7: API Steward

Owned paths:

- `apps/api`

Endpoints:

- `GET /health`
- `GET /scenarios/ed-chest-pain`
- `POST /sessions`
- `POST /sessions/:id/events`
- `POST /sessions/:id/note`
- `POST /sessions/:id/actor-response`
- `GET /sessions/:id/review-packet`
- `GET /providers/health`

Validation:

- Contract tests run against in-memory repositories.
- No environment variable is required for default tests.
- Provider health returns mock ready and optional runtimes not configured.

Done when:

- API can drive the same station lifecycle as the test harness.

## Worker 8: Admin UX Steward

Owned paths:

- `apps/ui-admin`

Screens:

- Scenario bank.
- ED station detail.
- Actor card view.
- Review gate panel.
- Trace replay.
- Faculty review packet.

Validation:

- Storybook stories for review gate and trace replay.
- Playwright smoke loads ED station.
- Review approval cannot bypass missing role.
- Text fits desktop and mobile breakpoints.

Done when:

- Faculty can inspect a completed station and see missing required behaviors.

## Worker 9: XR Runtime Steward

Owned paths:

- `apps/ui-xr`

Runtime elements:

- Desktop fallback.
- Feature-detected XR entry.
- Doorway instructions.
- Encounter timer.
- Placeholder ED room.
- Patient, spouse, nurse actor slots.
- Simulated EHR/note panel.
- Mock dialogue feed.
- Trace controls.

Validation:

- Browser smoke loads desktop runtime.
- WebGL canvas is nonblank.
- Core UI text does not overlap at desktop and mobile widths.
- XR feature detection does not throw when WebXR is unavailable.
- Quest 3 USB-C smoke loads the local Vite app through Quest Browser port forwarding after `adb devices -l` reports the headset as `device`.
- DevTools screencasting is disabled during comfort observations.

Done when:

- A learner can complete the station in desktop fallback with mock interactions, and the Quest 3 manual smoke checklist is either passed or recorded as blocked with a concrete reason.

Optional isolated spike:

- `packages/openclinxr/iwsdk-spike` now contains the source-backed planning contract for Meta Immersive Web SDK package posture, adoption gates, and Codex-oriented agent verification. It is intentionally dependency-free.
- A future `apps/ui-xr-iwsdk-spike` app may evaluate Meta Immersive Web SDK for controller input, locomotion, spatial UI, ECS debugging, screenshots, and AI/MCP-assisted XR inspection.
- The planning package now exposes machine-readable metric thresholds: max 300 MB installed footprint, max 1200 KB IWSDK injected dev runtime, max 550 KB spike app JS bundle, max 100 KB bundle delta versus `apps/ui-xr`, zero console errors, at least 72 FPS, p95 frame time at or below 25 ms, and controller-select latency at or below 150 ms.
- Keep IWSDK out of `apps/ui-xr` and shared production packages until the local scratch blockers are resolved: Vite 8 peer mismatch, explicit Node 22 execution path, Rolldown native binding setup, install/runtime weight, physical Quest 3 behavior, `@meta-quest/hzdb` legal status, sharp/libvips LGPL path, and Unknown pmndrs license metadata.
- Do not add IWSDK commands to `pnpm verify`, install hooks, or default dev startup until the spike has a committed source record and legal/license review path.

Validation:

- `pnpm --filter @openclinxr/iwsdk-spike test`
- `pnpm --filter @openclinxr/iwsdk-spike typecheck`
- `pnpm --filter @openclinxr/architecture-rules test`
- `pnpm --filter @openclinxr/architecture-rules typecheck`
- `pnpm agent:sources`
- A committed spike report comparable to `docs/openclinxr/immersive-web-sdk-evaluation-2026-05-04.md`

## Worker 10: Provider Gateway Steward

Owned paths:

- `packages/openclinxr/model-gateway`
- `packages/openclinxr/voice-gateway`

Tasks:

- Add `MockModelProvider`.
- Add `MockVoiceProvider`.
- Add provider health contracts.
- Add provider audit records.
- Add local adapter stubs for MLX/llama.cpp/Ollama and VibeVoice.

Validation:

- Mock responses are deterministic.
- Local adapters return `not_configured` until explicitly enabled.
- Audit records include provider ID, model/runtime name, request ID, latency, and safety status.

Done when:

- Switching provider implementation does not change domain contracts.

## Worker 11: Asset Registry Steward

Owned paths:

- `packages/openclinxr/asset-registry`

Tasks:

- Add asset manifest schema consumption.
- Add ED room, bed, monitor, ECG, IV stand, patient, spouse, nurse placeholder records.
- Add license/provenance status.
- Add optimization target fields.
- Add Quest QA status.

Validation:

- Missing license fails validation.
- Missing optimization target fails simulation QA.
- Placeholder assets are allowed only with explicit QA status.

Done when:

- Asset production can start from a validated manifest rather than free-form notes.

## Worker 12: MongoDB Steward

Owned paths:

- `packages/openclinxr/data-mongodb`

Tasks:

- Define repository interfaces shared with in-memory API.
- Add collection names and indexes.
- Add repository contract tests.
- Add `mongodb-memory-server` local tests.
- Use `MongoMemoryServer` for CRUD/index contract tests.
- Use `MongoMemoryReplSet` for transaction-sensitive repository tests.
- Gate production-URI tests behind `OPENCLINXR_MONGO_URI`.
- Print whether Mongo memory tests ran, skipped due missing binary, or used a cached binary.

Validation:

- In-memory repository contracts pass by default.
- Mongo memory repository contracts pass after the binary is available.
- Tests skip cleanly without production Mongo URI.
- Production repository contracts pass when `OPENCLINXR_MONGO_URI` is provided.
- Index declarations cover scenario version, station run trace sequence, review status, and source IDs.

Done when:

- MongoDB can replace in-memory repositories without API contract changes, with local Mongo behavior covered by `mongodb-memory-server`.

## First Sprint Completion Command

Target command after implementation:

```bash
pnpm verify && pnpm --filter @openclinxr/test-harness bench:mock
```

Expected evidence:

- Typecheck passes.
- Unit and contract tests pass.
- Deterministic station simulation produces a review packet.
- Mongo memory tests pass or report a clear first-run binary/cache skip.
- Optional local model, voice, Bun, and Quest gates are reported as skipped, not configured, blocked, or passed.

## Development Stop Conditions

- A live API key becomes required for tests.
- A model download becomes required for startup.
- Review packet can be generated without trace evidence.
- Scenario can be approved without required reviewer roles.
- UI says or implies licensure, diagnosis, ECFMG replacement, or validated high-stakes scoring.
- XR app renders a blank canvas or inaccessible controls.
- Asset manifest accepts missing license or provenance.
