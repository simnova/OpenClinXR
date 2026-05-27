# Dynamic Encounter Factory Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the local, evidence-gated OpenClinXR dynamic encounter factory path from reviewed encounter definition to reviewable WebXR runtime payloads, while preserving no-production/no-Quest/no-clinical/no-scoring claim boundaries.

**Architecture:** The pipeline remains metadata-first and review-gated. Encounter definitions produce deterministic asset-generation work orders, humanoid realism requirements, dynamic behavior coverage, publication dry-run summaries, and learner runtime bundle references before any materialized generation or learner activation. Admin/API surfaces expose gaps and next actions so specialists can iterate without hardcoded runtime assumptions.

**Tech Stack:** TypeScript, pnpm workspaces, Hono API, React/Ant Design admin UI, asset-registry/runtime bundle contracts, scenario-fixtures, capability-gateway, scenario-runtime/review-workflow, Vitest/tsgo focused verification.

---

## Completion Definition

The dynamic encounter factory is considered locally feature-complete when:

- Encounter definitions can deterministically produce asset work orders for environment, equipment, humanoids, clothing/hair/skin, rigging, animation, phoneme/viseme maps, gaze/blink controls, dialogue turns, actor placements, and evidence gates.
- Admin users can initiate and review the factory pipeline from scenario configuration without hardcoded scene assumptions.
- API/admin readiness payloads expose all missing metadata and review blockers with recommended next actions and explicit claim boundaries.
- Learner WebXR runtime consumes generated-manifest style payloads through runtime bundle references rather than hardcoded scene actors or props.
- Humanoid realism requirements remain actor-role scoped and include rigging, face/eye/lip sync, gaze target, collision/interaction, and animation playback metadata.
- Persistence/provider/review gates are represented as deterministic local contracts before cloud, paid APIs, production, or Quest-readiness claims.
- Focused tests cover each contract, and docs record boundaries plus next operator decisions.

## Current Pipeline Shape

1. `@openclinxr/scenario-fixtures` owns reviewed scenario definitions, maturity, dialogue seed posture, traceability, and recommended next actions.
2. `@openclinxr/asset-registry` owns environment queues, scene-generation work orders, learner runtime asset bundles, evidence gates, publication metadata, and learner-use gate posture.
3. `@openclinxr/capability-gateway` owns asset-generation publication targets, capability routing, and provider boundary metadata.
4. `tools/openclinxr/encounter-asset-generation-queue.ts` owns local encounter asset queue reports.
5. `tools/openclinxr/generated-ed-station-runtime-bundle.ts` owns deterministic generated station runtime bundle reports.
6. `tools/openclinxr/encounter-publication-payloads.ts` owns local publication payload validation, dynamic behavior coverage, dry-run plan summaries, and evidence boundaries.
7. `apps/api/src/app.ts` exposes control-plane REST contracts for scenario scene-generation requests and publication readiness.
8. `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx` exposes the admin review and blocker surface.
9. `apps/ui-xr` should consume runtime manifests and learner bundles without hardcoding encounter-specific generated assets.

## Repo-Agent Work Allocation

- Chief Coordinator: keep tasks product-advancing and prevent evidence churn.
- Implementation Planning Lead: keep slices small and dependency ordered.
- Asset Pipeline Lead: own queue/work-order/runtime bundle metadata.
- XR Systems Architect: own WebXR runtime manifest consumption and interaction affordances.
- Clinical Simulation Lead: own scenario/dialogue/actor intent coverage.
- Psychometrics/Rubric Steward: own review gates and no-score-use boundaries.
- Security/Privacy/Legal: own claim language, asset provenance, storage, and learner-use gates.
- VP Engineering Delivery: own verification matrix and completion tracking.

---

## Task 1: Extract Shared Dynamic Behavior And Dry-Run Summary Contracts

**Why:** Current behavior/dry-run shapes are present in tooling and admin/API response types. To prevent drift, move the common summary contracts into a shared package that API, UI, and tooling can reference.

**Files:**

- Modify: `packages/openclinxr/asset-registry/src/runtime-bundles.ts`
- Modify: `packages/openclinxr/asset-registry/src/runtime-bundles.test.ts`
- Modify: `tools/openclinxr/encounter-publication-payloads.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/ui-admin/src/api-client.ts`

**Steps:**

- [ ] Add exported types `EncounterDynamicBehaviorCoverageSummary` and `EncounterFactoryDryRunSummary` to `runtime-bundles.ts` with explicit `claimBoundary`, blocker/warning arrays, and evidence-boundary flags.
- [ ] Add pure builders in `runtime-bundles.ts` for dynamic behavior coverage and dry-run summary from a learner runtime bundle plus request metadata.
- [ ] Update `encounter-publication-payloads.ts` to use the shared types/builders instead of local duplicate logic.
- [ ] Update `apps/api/src/app.ts` to use the shared builders for scene-generation publication readiness.
- [ ] Update `apps/ui-admin/src/api-client.ts` to import/use the shared types or mirror them only if package boundaries require local UI types.
- [ ] Add regression tests ensuring API and publication tooling produce matching summaries for ED chest pain actor roles.

**Verification:**

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/asset-registry test -- runtime-bundles
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js exec vitest run tools/openclinxr/encounter-publication-payloads.test.ts
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/api test -- app.test.ts
```

**Boundary:** Metadata contract only. Do not generate assets, refresh Quest evidence, use cloud/paid APIs, deploy, or claim runtime/clinical/scoring readiness.

---

## Task 2: Complete Encounter Asset Work Orders For Humanoid Realism

**Why:** The factory must treat humanoid models, clothing, hair, skin, rigging, animation, eyes, lips, gaze, and collision/interaction as generated pipeline outputs rather than one-off scene details.

**Files:**

- Modify: `packages/openclinxr/asset-registry/src/scene-generation-pipeline.ts` or the existing asset-registry file that defines scene-generation pipeline work orders.
- Modify: `packages/openclinxr/asset-registry/src/scene-generation-pipeline.test.ts` or the nearest existing test.
- Modify: `tools/openclinxr/encounter-asset-generation-queue.ts`
- Modify: `tools/openclinxr/encounter-asset-generation-queue.test.ts`

**Steps:**

- [ ] Add pipeline stages for humanoid mesh generation, hair/clothing/skin material generation, rigging, facial rigging, viseme/phoneme mapping, gaze/blink controls, locomotion/idle/conversation animations, and collision proxy preparation.
- [ ] Add required evidence IDs for each stage: `humanoid_mesh_manifest`, `rig_validation_report`, `facial_blendshape_map`, `viseme_phoneme_map`, `gaze_blink_control_map`, `animation_clip_manifest`, `collision_proxy_manifest`, and `license_provenance_report`.
- [ ] Ensure every generated actor role from the scenario has a work-order task for each required humanoid realism output.
- [ ] Ensure prohibited actions remain explicit for AGPL/copyleft, unreviewed paid APIs, production storage, or unapproved cloud generation.
- [ ] Add tests that fail when patient/nurse/family actors lack any of the required humanoid realism stage/evidence IDs.

**Verification:**

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/asset-registry test -- scene-generation
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js exec vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts
```

**Boundary:** Work-order metadata only. Do not install generators, run Anny/Blender, materialize GLB output, or make visual quality claims unless explicitly approved.

---

## Task 3: Make Runtime Scene Manifest Fully Dynamic For Actors, Props, And Interactions

**Why:** The learner runtime should render the encounter from manifest/bundle inputs, not hardcoded actor/prop assumptions.

**Files:**

- Modify: `packages/openclinxr/asset-registry/src/runtime-bundles.ts`
- Modify: `packages/openclinxr/asset-registry/src/runtime-bundles.test.ts`
- Modify: `apps/ui-xr/src/**` files that load/render WebXR scene actors and props.
- Modify: `apps/ui-xr/src/**.test.tsx` or nearest XR runtime tests.

**Steps:**

- [ ] Extend manifest/runtime bundle contracts with interaction affordances for generated assets: `inspectable`, `touchable`, `dialogueTarget`, `collisionProxy`, `noteCue`, and `equipmentCue`.
- [ ] Ensure actors reference placement, model, animation clips, phoneme maps, gaze profiles, and interaction affordances through bundle IDs.
- [ ] Ensure room props and equipment render from manifest arrays with stable IDs and interaction tags.
- [ ] Add UI-XR runtime code that maps manifest actor/equipment/prop arrays into scene nodes without ED-specific hardcoding.
- [ ] Add tests with a second synthetic scenario manifest to prove runtime rendering is manifest-driven.

**Verification:**

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/asset-registry test -- runtime-bundles
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/ui-xr test
```

**Boundary:** Local rendering contract only. Do not claim Quest readiness without hardware evidence.

---

## Task 4: Add Humanoid Animation, Lip-Sync, And Gaze Runtime Contracts

**Why:** Humanoids need face/eye/lip/gaze behavior tied to dialogue and target actor metadata, even before high-fidelity assets are materialized.

**Files:**

- Modify: `packages/openclinxr/asset-registry/src/runtime-bundles.ts`
- Modify: `packages/openclinxr/scenario-runtime/src/**`
- Modify: `apps/ui-xr/src/**` runtime actor behavior files.
- Add or modify relevant tests in each package.

**Steps:**

- [ ] Add runtime contract fields for `activeDialogueTurnId`, `phonemeTimelineRef`, `visemeMapRef`, `gazeTargetActorId`, `blinkCueRef`, `facialExpressionCueIds`, and `animationClipRefs`.
- [ ] Ensure dialogue turns bind speaker actor ID, gaze target kind, optional target actor ID, and phoneme/viseme map references.
- [ ] Add local deterministic runtime tests that verify speaking actor gaze target follows learner or target actor metadata.
- [ ] Add UI-XR tests or component-level tests proving actor animation/gaze metadata is consumed without visual readiness claims.

**Verification:**

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/scenario-runtime test
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/ui-xr test
```

**Boundary:** Runtime metadata and playback hooks only. Do not claim lifelike facial realism without screenshot/video evidence and review.

---

## Task 5: Wire Admin Scenario Configuration To Factory Inputs

**Why:** The pipeline should be initiated from the administrative system after scenario configuration, producing work orders and review gates for the selected encounter.

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/ui-admin/src/App.tsx`
- Modify: `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`
- Modify: `apps/ui-admin/src/api-client.ts`
- Modify: related UI tests.

**Steps:**

- [ ] Add or extend request input for scene-generation requests to include scenario version, encounter ID, target runtime, asset-store kind, and generation profile.
- [ ] Persist request metadata in the existing in-memory API queue shape and keep boundaries explicit.
- [ ] Render request configuration summary in admin before initiation.
- [ ] Add admin/API tests for custom encounter IDs and target runtime metadata.
- [ ] Ensure the route still returns deterministic work-order and publication-readiness summaries.

**Verification:**

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/api test -- app.test.ts
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/ui-admin test -- App EnvironmentGenerationQueuePanel api-client
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/ui-admin typecheck
```

**Boundary:** Local admin control-plane request metadata only. No background generation job or cloud queue unless explicitly approved.

---

## Task 6: Add Persistence/Storage Emulator Contracts For Long-Running Factory Jobs

**Why:** High-fidelity encounters may take hours or days. The app needs durable local contracts for job state, blobs, and review outputs before real cloud use.

**Files:**

- Modify: `packages/openclinxr/capability-gateway/src/**` for publication targets if needed.
- Modify: `packages/openclinxr/asset-registry/src/**` for job state types.
- Modify: `apps/api/src/app.ts` persistence sink interfaces.
- Modify: tests in touched packages.
- Update: `operator-open-questions.md` if storage emulator assumptions remain.

**Steps:**

- [ ] Define local emulator-safe job state records for queued, running, review_pending, blocked, and complete states.
- [ ] Define blob reference records for scene manifests, learner bundles, generated GLBs, textures, animations, phoneme maps, and evidence artifacts.
- [ ] Add API persistence sink hooks for saving/listing scene-generation request job states and artifact refs.
- [ ] Add tests using in-memory persistence sink to prove request state survives the API flow.
- [ ] Keep Azure/Azurite as target metadata unless emulator commands are already documented and approved.

**Verification:**

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/api test -- app.test.ts
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/asset-registry test
```

**Boundary:** Local/in-memory contract first. Do not start cloud services, mutate real Azure, or claim durable production storage.

---

## Task 7: Expand Scenario Bank Factory Coverage Beyond ED Chest Pain

**Why:** The original product goal is a multi-station exam. Factory maturity should not remain ED-only.

**Files:**

- Modify: `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`
- Modify: `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`
- Modify: `apps/ui-admin/src/**` only if summaries need broader display.

**Steps:**

- [ ] Select the next highest-maturity scenario already present in the bank.
- [ ] Add actor/environment/asset-need metadata sufficient for dynamic encounter factory planning.
- [ ] Add dialogue seed and traceability metadata needed for behavior coverage summaries.
- [ ] Add tests that maturity/recommended actions reflect the new scenario’s factory readiness without learner-use claims.
- [ ] Keep clinical/psychometric/legal gates explicit and blocked until reviewer evidence exists.

**Verification:**

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/scenario-fixtures test -- scenario-bank
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/api test -- app.test.ts
```

**Boundary:** Scenario metadata/maturity only. No clinical-validity or score-use claims.

---

## Task 8: Evidence Loop And Visual QA Hooks Without Evidence Churn

**Why:** The product needs screenshot/video/Quest evidence eventually, but only when it verifies changed runtime behavior or unlocks a named decision.

**Files:**

- Modify: `docs/openclinxr/worker-backlog-and-validation-matrix.md`
- Modify: `AUTONOMOUS_WORK_PLAN.md`
- Modify or create: `docs/openclinxr/evidence-loop-playbook.md`
- Modify tests only if evidence hook contracts are executable locally.

**Steps:**

- [ ] Document when to capture screenshots/video and when not to.
- [ ] Define visual QA checklist for humanoid eyes, mouth, facial expression, pose, locomotion, room layout, asset affordances, and performance clues.
- [ ] Define evidence IDs that can attach to runtime evidence gates without claiming Quest readiness or clinical/scoring validity.
- [ ] Add operator instructions for Quest/IWSDK only as nonblocking unless hardware action is truly required.
- [ ] Link the evidence loop from the autonomous work plan and worker backlog.

**Verification:**

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js agent:alignment
```

**Boundary:** Documentation and gating only. Do not refresh evidence unless verifying touched runtime behavior.

---

## Task 9: Provider Gates For Model, Voice, Speech, And Asset Generation

**Why:** The platform needs frontier/local provider paths without accidentally enabling paid/cloud APIs or provider readiness claims.

**Files:**

- Modify: `packages/openclinxr/capability-gateway/src/**`
- Modify: `packages/openclinxr/voice-gateway/src/**`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/ui-admin/src/**` readiness panels if already present.

**Steps:**

- [ ] Ensure provider readiness surfaces distinguish deterministic replay, local development, local production, and production profiles.
- [ ] Add asset-generation provider gates for local/manual, local toolchain, emulator queue, cloud-approved, and blocked states.
- [ ] Add voice/speech provider gate metadata for STT, TTS, emotional prosody, and lip-sync timing.
- [ ] Render missing provider gates in admin with recommended next action.
- [ ] Add tests rejecting live-provider readiness when credentials/evidence are absent.

**Verification:**

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/capability-gateway test
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/voice-gateway test
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/api test -- app.test.ts
```

**Boundary:** Provider gate metadata only. No live provider calls unless explicitly approved.

---

## Execution Order

1. Task 1: shared contracts to prevent divergence.
2. Task 2: humanoid work-order completeness.
3. Task 5: admin scenario configuration inputs.
4. Task 6: persistence/storage emulator contracts.
5. Task 3: dynamic WebXR scene consumption.
6. Task 4: humanoid playback/lip/gaze runtime metadata.
7. Task 7: scenario-bank expansion.
8. Task 9: provider gates.
9. Task 8: evidence loop hooks once runtime behavior exists to verify.

## Parallelization Plan

- Worker A, Asset Pipeline Lead: Task 1 and Task 2 shared contracts/work orders.
- Worker B, Admin/API Review Workflow: Task 5 and API/admin visibility portions of Task 6.
- Worker C, XR Systems Architect: Task 3 and Task 4 runtime consumption contracts.
- Worker D, Scenario/Clinical Simulation: Task 7 scenario bank expansion.
- Worker E, Security/Privacy/Provider Gates: Task 8 and Task 9 boundary/evidence/provider gate surfaces.
- Coordinator: review outputs for drift, duplicate contract definitions, boundary language, and overlap.

## Plan Self-Review

- Spec coverage: The plan covers dynamic asset pipeline, humanoid realism, admin initiation, storage emulator contracts, WebXR dynamic consumption, scenario-bank maturity, provider gates, and evidence loops.
- Placeholder scan: No task is allowed to use unspecified cloud, paid API, production deployment, or visual readiness claims. Each task has exact target paths or nearest existing package paths and focused verification commands.
- Type consistency: Dynamic behavior coverage and dry-run summaries should converge into asset-registry shared contracts before API/UI/tooling expansion.

## Immediate Next Slice

Start with Task 1 because current API/tooling/UI summary shapes are useful but duplicated. Shared contracts reduce drift and make subsequent workers safer.

---

## Coordinator Refinement: Dependency-Ordered Work Packages

The OpenClaw coordination agent refined the execution order to reduce drift and prevent runtime work from outrunning encounter definitions.

1. Encounter definition completion pass: ensure selected scenarios have validated definitions, actor cards, dialogue seeds, required trace tags, environment/equipment needs, review gates, and no readiness/clinical/scoring claims.
2. Encounter definition to asset work-order bridge: convert reviewed encounter definitions into deterministic asset-generation queue/work-order payloads for humanoids, clothing, equipment, environment, animation, provenance, optimization, and evidence gates.
3. Humanoid realism metadata contract: carry face/eye/mouth/pose/clothing/skin/rig controls, limitations, provenance, fixture/non-production status, and visual-QA blockers.
4. Runtime bundle assembly boundary: freeze encounter runtime bundles from definitions and work-order outputs while keeping publisher-ready separate from learner-runtime-use-ready.
5. Admin review gate orchestration: show definition, work-order, runtime bundle, humanoid metadata, and human review actions without readiness claims.
6. Learner WebXR scene use under blocked-gate posture: consume approved/local bundle metadata and fixture assets while preventing generated bundle learner use when evidence gates are pending.
7. Replayable evidence loop: connect learner trace, notes, actor turns, runtime evidence refs, review packet, and faculty review handoff into a deterministic local loop.
8. Completion gate packet and worker handoff: produce machine-readable path state across definitions, work orders, humanoid metadata, bundle, admin gates, XR use gate, evidence loop blockers, and next approved worker.

Execution rule: work left-to-right unless two write scopes are independent. Keep claims framed as local deterministic development posture, evidence-gated review posture, or blocked readiness posture.

## Active Dispatch Log

- 2026-05-25: Coordinator `019e5cd4-0a2b-7310-b95f-93b26956c1d8` completed dependency-order review and was closed.
- 2026-05-25: First implementation dispatch starts with the shared contract slice because current dynamic behavior and dry-run summary shapes are duplicated across tooling/API/UI and should converge before broader runtime/admin expansion.

## Scenario Steward Finding: Next Definition Expansion Lane

Read-only scenario steward review selected `peds_asthma_parent_anxiety_v1` as the next safe scenario-definition completion pass after ED chest pain.

Findings:

- Actor structure is already present for patient, parent/family, and nurse roles.
- Dialogue seed shape is already present, including a guardrail/hidden-truth probe.
- Traceability appears structurally aligned with rubric/event/safety tags.
- Environment and equipment metadata are present for `pediatric_urgent_care_bay_v1`.
- Main blocker is review posture: scenario remains draft with draft review gates and `stage_0_synthetic_draft` governance.
- Safe next claim: suitable for deterministic factory planning metadata.
- Unsafe claims: approved, expert-reviewed, clinically valid, scoring valid, Quest ready, or production ready.

Queued follow-on worker slice after shared contracts:

- Add tests/projections that ensure peds asthma can be included in dynamic encounter factory planning while preserving draft/review-blocked posture.
- Do not mark peds asthma approved or learner-use ready.
- Likely files: `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`, `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`, and only if needed `packages/openclinxr/scenario-fixtures/src/index.ts`.
