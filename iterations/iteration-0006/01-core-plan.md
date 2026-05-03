# Core Plan

## Core Position

The implementation can begin, but only as a deterministic first vertical slice. The team must treat local LLMs, local voice, MongoDB, WebXR headset validation, generated 3D humans, and Bun as gated capabilities rather than build blockers.

The first code branch should prove one thin thread:

1. Load the approved ED chest pain scenario fixture.
2. Start a station run.
3. Move through doorway, encounter, note, and review states.
4. Append deterministic trace events.
5. Produce a review packet.
6. Render a minimal admin review UI.
7. Render a non-XR learner runtime shell.
8. Expose mock model and voice providers with auditable contracts.

## Worker-Ready Decomposition

### Worker A: Workspace And Schemas

Owns:

- `pnpm-workspace.yaml`
- root `package.json`
- `tsconfig.base.json`
- `packages/shared-schemas`

Acceptance:

- `pnpm install` completes without optional AI or graphics dependencies.
- Schemas validate scenario, actor, trace, station state, patient note, review packet, model audit, voice audit, and asset manifest.
- Publishing a scenario without clinical, psychometric, legal, and simulation QA review states fails validation.

### Worker B: Domain And Scenario Fixture

Owns:

- `packages/domain`
- `packages/scenario-fixtures`

Acceptance:

- Station transitions are pure and deterministic.
- The ED chest pain fixture includes patient, spouse, and nurse actor cards.
- Required trace tags include ECG request, escalation, empathy, family communication, teamwork, and patient note.
- Domain tests prove incorrect ordering is rejected.

### Worker C: Trace Ledger And Review Workflow

Owns:

- `packages/trace-ledger`
- `packages/review-workflow`

Acceptance:

- In-memory trace append enforces station run ID and sequence ordering.
- Replay reconstructs the station timeline.
- Review packet identifies observed, missing, and late required behaviors.
- Faculty score draft is human-authored and never described as automated high-stakes scoring.

### Worker D: API Shell

Owns:

- `apps/api`
- API-facing repository interfaces

Acceptance:

- Hono server exposes health, scenario fixture, session start, event append, note submit, mock actor response, and review packet endpoints.
- API contract tests use in-memory repositories by default.
- MongoDB tests are skipped unless `OPENCLINXR_MONGO_URI` is set.

### Worker E: Admin UX

Owns:

- `apps/admin`
- reusable admin components if created later

Acceptance:

- Admin loads the ED chest pain station.
- Review status cannot jump to approved unless the required reviewer roles are present.
- Trace replay is visible in a dense Ant Design table/timeline layout.
- Storybook stories exist for scenario summary, review gate panel, trace timeline, and review packet.

### Worker F: XR Runtime Shell

Owns:

- `apps/xr`
- XR runtime fixtures

Acceptance:

- Desktop fallback renders without headset.
- Canvas is nonblank and stable under Playwright screenshot checks.
- XR entry is feature-detected and disabled when unavailable.
- Doorway instructions, timer, mock dialogue, and simulated EHR/note panel are visible without relying on generated avatars.

### Worker G: Model And Voice Gateways

Owns:

- `packages/model-gateway`
- `packages/voice-gateway`
- local benchmark contracts

Acceptance:

- Mock providers are deterministic.
- Local provider adapters return explicit `not_configured` health states when MLX, llama.cpp, Ollama, or VibeVoice are absent.
- No model download occurs during install, test, or dev server startup.
- Benchmark CLI can measure mock latency and record host metadata.

### Worker H: Test Harness And Verification

Owns:

- `packages/test-harness`
- root verification scripts

Acceptance:

- One deterministic station simulation can run headlessly.
- It emits a trace, submits a note, and generates a review packet.
- CI-equivalent local command runs typecheck, unit tests, contract tests, and mock simulation.
- Optional gates print skipped status with reasons.

## Dependency Rules

- Pin dependency versions during implementation; do not use `latest` in new application package manifests.
- Add optional dependencies only after a license and install-risk note is recorded.
- Keep AGPL/copyleft packages out of default runtime.
- Keep vendor model/voice APIs behind adapter interfaces with no keys required.
- Do not run paid cloud APIs during spikes.

## Local Runtime Rules

- MLX LM and llama.cpp are evaluation candidates, not required packages.
- Qwen3 4B GGUF is the first small local smoke candidate.
- DeepSeek-R1-Distill-Qwen 7B is a reasoning candidate after small-model smoke passes.
- Kimi-K2-Thinking is a server/offload research candidate, not the MacBook default.
- VibeVoice is a local voice research candidate behind consent, watermarking/disclosure, and misuse gates.

## Verification Matrix

| Area | First test | Blocker threshold |
| --- | --- | --- |
| Schemas | AJV/TypeBox unit tests | invalid approved scenario passes |
| Domain | station state Vitest tests | illegal transition accepted |
| Trace | append/replay tests | sequence gap not detected |
| Review | packet tests | missing required trace tag not flagged |
| API | supertest/undici contract tests | cloud key required |
| Admin | Storybook and Playwright | review gate can be bypassed |
| XR | screenshot and WebGL nonblank | blank canvas or overlapping core UI |
| Model | mock provider tests | live provider required |
| Voice | mock provider tests | audio runtime required |
| Assets | manifest validation | missing license accepted |

