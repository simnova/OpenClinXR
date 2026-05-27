# OpenClinXR Encounter Factory Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the dynamic encounter factory path from reviewed scenario definition to evidence-gated WebXR encounter bundle metadata, with generated humanoid realism requirements treated as pipeline data rather than one-off scene edits.

**Architecture:** Encounter definitions feed queue requests, queue requests carry per-actor humanoid realism requirements/profiles, worker/publication reports preserve those profiles, and runtime/admin surfaces consume only gated metadata until evidence is attached. The pipeline remains local/Azurite/Mongoose-compatible by default and explicitly avoids learner-use, Quest-readiness, clinical-validity, scoring-validity, production-readiness, paid/cloud/API, or deployment claims.

**Tech Stack:** TypeScript, pnpm/Corepack, Vitest, Hono/API packages, React admin/UI-XR packages, asset-registry runtime bundles, capability-gateway queue contracts, local JSON report tools, Azurite-compatible blob metadata, Mongoose/MongoDB-compatible durable-state naming.

---

## Current State

- Queue reports now carry metadata-only `humanoidRealismProfiles`.
- Capability gateway can carry `realismProfile` in each humanoid requirement through queue encode/decode and plan derivation.
- Queue and publication validation enforce required viseme, eye micro-saccade, and generated eyelid blink signal IDs.
- Publication reports carry per-humanoid runtime requirements and now carry queue-level realism profiles.
- UI-XR evidence has locomotion path-quality observability and hand-select evidence, but this plan avoids Quest refresh unless a later task explicitly gates it.
- Scenario-bank maturity exposes pressure/context actor coverage through API/admin.

## Completion Definition

- Every dynamic encounter factory stage preserves actor-level humanoid realism metadata from scenario/queue through publication handoff.
- Queue, worker, publication, and admin-facing metadata reject stale profile counts, missing actor profile coverage, missing eye/viseme/gaze/blink signals, or overclaiming boundaries.
- Runtime bundle/publication metadata can explain why learner use is blocked and exactly what evidence is missing.
- The first safe path remains local deterministic and testable without writing generated assets or refreshing Quest evidence.

## Active Boundaries

- Do not run Quest/IWSDK/browser screenshot refresh unless a task explicitly says it verifies newly changed runtime behavior.
- Do not run publication materialization commands that write `apps/ui-xr/public/xr-assets/generated/**` unless explicitly approved.
- Do not generate GLBs, textures, screenshots, videos, or external assets in this plan.
- Do not use paid/cloud APIs, production deployment, Redis/Redka, WebTransport, QUIC, Web3, or runtime dependency changes.
- Do not claim production readiness, Quest readiness, clinical validity, scoring validity, or exam equivalence.
- Do not use git commit/amend/reset commands unless Patrick explicitly asks.

---

## File Map

- `packages/openclinxr/capability-gateway/src/asset-generation-jobs.ts`: core queue/request/plan/worker types and validation for humanoid realism metadata.
- `packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts`: core contract coverage for queue encoding, validation, worker evidence gates, and publication target derivation.
- `tools/openclinxr/encounter-asset-generation-queue.ts`: local queue report builder/validator for encounter definition to executable encounter planning.
- `tools/openclinxr/encounter-asset-generation-queue.test.ts`: queue report tests for metadata, boundaries, profiles, and validation.
- `tools/openclinxr/encounter-publication-payloads.ts`: local publication report builder/validator for scene manifest and learner runtime bundle handoff.
- `tools/openclinxr/encounter-publication-payloads.test.ts`: publication report tests for profile/runtime requirement propagation and validation.
- `packages/openclinxr/asset-registry/src/runtime-bundles.ts`: runtime bundle and publication metadata contracts.
- `packages/openclinxr/asset-registry/src/asset-registry.test.ts`: asset-registry contract coverage.
- `apps/ui-admin/src/ScenarioBankMaturityPanel.tsx`: admin maturity display surface.
- `apps/ui-admin/src/api-client.ts`: admin API response typing.
- `apps/ui-admin/src/App.test.tsx`: admin integration tests for displayed maturity signals.
- `apps/api/src/app.test.ts`: API control-plane route contract tests.
- `AUTONOMOUS_WORK_PLAN.md`: durable progress ledger and active continuation notes.
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`: worker ownership, verification target, and boundary ledger.
- `operator-open-questions.md`: nonblocking steering questions with recommended defaults.

---

## Task 1: Capability-Gateway Profile Count And Actor Parity

**Files:**
- Modify: `packages/openclinxr/capability-gateway/src/asset-generation-jobs.ts`
- Modify: `packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts`
- Modify: `AUTONOMOUS_WORK_PLAN.md`
- Modify: `docs/openclinxr/worker-backlog-and-validation-matrix.md`

- [ ] **Step 1: Add failing test for missing embedded profile**

Add a test near the humanoid realism validation tests:

```ts
it("rejects humanoid requirements without metadata-only realism profiles", () => {
  expect(() => createEncounterAssetGenerationQueueMessage({
    requestId: "bad_missing_profile",
    tenantId: "tenant_alpha",
    examRunId: "exam_run_1",
    encounterId: "encounter_1",
    scenarioId: "ed_chest_pain_priority_v1",
    stationId: "ed_chest_pain_station_v1",
    encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
    targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
    persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
    requestedStages: ["scene-manifest-freeze", "runtime-bundle-publication", "review-evidence-gate"],
    humanoidRealismRequirements: {
      schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1",
      source: "scenario_actor_definitions",
      requirements: [
        {
          actorRole: "patient",
          requiredAssetKinds: ["generated_humanoid_mesh", "clinical_idle_animation", "viseme_phoneme_map", "gaze_blink_control"],
          requiredSignalIds: [
            "animated_humanoid_runtime_playback",
            "dialogue_viseme_and_gaze_mapping",
            "dialogue_eye_micro_saccade_blink_cue",
            "generated_eyelid_blink_control_cue",
          ],
        },
      ],
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    },
    optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 72, mayRunForDays: true, checkpointIntervalMinutes: 30 },
    evidenceGates: {
      requireGeneratedSceneManifest: true,
      requireRuntimeBundlePublication: true,
      requireHumanReviewBeforeLearnerUse: true,
      requireQuestEvidenceBeforeQuestReadinessClaim: true,
    },
    policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
  })).toThrow("Humanoid realism requirements for patient require metadata-only realismProfile");
});
```

- [ ] **Step 2: Run focused test to verify failure**

Run:

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/capability-gateway test -- asset-generation-jobs
```

Expected: FAIL with missing `realismProfile` validation.

- [ ] **Step 3: Implement minimal validator**

In `validateHumanoidRealismRequirements`, after validating `requiredSignalIds`, require:

```ts
if (!requirement.realismProfile) {
  throw new Error(`Humanoid realism requirements for ${requirement.actorRole} require metadata-only realismProfile`);
}
```

Keep the existing `claimScope` and `requiredRealismEvidenceIds` checks.

- [ ] **Step 4: Run focused verification**

Run the same focused command.

Expected: PASS.

- [ ] **Step 5: Update docs**

Append notes to `AUTONOMOUS_WORK_PLAN.md` and `docs/openclinxr/worker-backlog-and-validation-matrix.md` stating that core queue validation now requires embedded metadata-only realism profiles for humanoid requirements.

---

## Task 2: Queue Report Requirement/Profile Role Matching

**Files:**
- Modify: `tools/openclinxr/encounter-asset-generation-queue.ts`
- Modify: `tools/openclinxr/encounter-asset-generation-queue.test.ts`
- Modify: `AUTONOMOUS_WORK_PLAN.md`
- Modify: `docs/openclinxr/worker-backlog-and-validation-matrix.md`

- [ ] **Step 1: Add failing validation case for profile actor mismatch**

In `validates generated queue reports`, mutate:

```ts
invalid.humanoidRealismProfiles[0].actorRole = "unmatched_actor";
```

Expect:

```ts
"/humanoidRealismProfiles/0/actorRole must match a humanoid requirement actorRole"
```

- [ ] **Step 2: Implement role-set validation**

In `validateEncounterAssetGenerationQueueReport`, after the profile length check, create a set from `humanoidRealismRequirements.requirements[].actorRole` and reject top-level profiles whose `actorRole` is not present.

Use:

```ts
const requirementActorRoles = new Set(
  Array.isArray(value.humanoidRealismRequirements.requirements)
    ? value.humanoidRealismRequirements.requirements
      .filter(isRecord)
      .map((requirement) => String(requirement.actorRole ?? ""))
    : [],
);
```

Inside profile validation:

```ts
if (!requirementActorRoles.has(String(profile.actorRole ?? ""))) {
  errors.push(`/humanoidRealismProfiles/${index}/actorRole must match a humanoid requirement actorRole`);
}
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js exec vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts
```

Expected: PASS.

- [ ] **Step 4: Update docs**

Append notes to the plan and matrix that queue reports reject top-level profiles with no matching humanoid requirement actor.

---

## Task 3: Publication Profile/Requirement Role Matching

**Files:**
- Modify: `tools/openclinxr/encounter-publication-payloads.ts`
- Modify: `tools/openclinxr/encounter-publication-payloads.test.ts`
- Modify: `AUTONOMOUS_WORK_PLAN.md`
- Modify: `docs/openclinxr/worker-backlog-and-validation-matrix.md`

- [ ] **Step 1: Add failing validation case**

In the corrupted publication report test, mutate:

```ts
invalid.humanoidRealismProfiles[0].actorRole = "unmatched_actor";
```

Expect:

```ts
"/humanoidRealismProfiles/0/actorRole must match a humanoid realism requirement actorRole"
```

- [ ] **Step 2: Implement role-set validation**

In `validateEncounterPublicationPayloadReport`, after validating `humanoidRealismRequirements`, build a set of requirement actor roles and reject profiles not in the set.

Use:

```ts
const humanoidRequirementActorRoles = isRecord(value.humanoidRealismRequirements)
  && Array.isArray(value.humanoidRealismRequirements.requirements)
  ? new Set(value.humanoidRealismRequirements.requirements
    .filter(isRecord)
    .map((requirement) => String(requirement.actorRole ?? "")))
  : new Set<string>();
```

Inside profile validation:

```ts
if (!humanoidRequirementActorRoles.has(String(profile.actorRole ?? ""))) {
  errors.push(`/humanoidRealismProfiles/${index}/actorRole must match a humanoid realism requirement actorRole`);
}
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js exec vitest run tools/openclinxr/encounter-publication-payloads.test.ts
```

Expected: PASS.

- [ ] **Step 4: Update docs**

Append notes to the plan and matrix that publication reports reject unmatched profile actor roles.

---

## Task 4: Asset-Registry Publication Metadata Profile Summary

**Files:**
- Modify: `packages/openclinxr/asset-registry/src/runtime-bundles.ts`
- Modify: `packages/openclinxr/asset-registry/src/asset-registry.test.ts`
- Modify: `AUTONOMOUS_WORK_PLAN.md`
- Modify: `docs/openclinxr/worker-backlog-and-validation-matrix.md`

- [ ] **Step 1: Add test for metadata profile summary**

Extend the publication metadata test to expect:

```ts
humanoidRealismProfileSummary: {
  profileCount: 3,
  requiredSignalIds: expect.arrayContaining([
    "dialogue_viseme_and_gaze_mapping",
    "dialogue_eye_micro_saccade_blink_cue",
    "generated_eyelid_blink_control_cue",
  ]),
  claimScope: "metadata_only_not_visual_quality_evidence",
}
```

- [ ] **Step 2: Add optional metadata input**

If `buildEncounterRuntimeBundlePublicationMetadata` currently accepts only a bundle, add an optional second argument:

```ts
export function buildEncounterRuntimeBundlePublicationMetadata(
  bundle: LearnerRuntimeAssetBundle,
  input?: {
    humanoidRealismProfiles?: Array<{
      requiredRealismEvidenceIds: string[];
      claimScope: "metadata_only_not_visual_quality_evidence";
    }>;
  },
)
```

- [ ] **Step 3: Implement summary**

When profiles are provided, compute:

```ts
humanoidRealismProfileSummary: {
  profileCount: input.humanoidRealismProfiles.length,
  requiredSignalIds: Array.from(new Set(input.humanoidRealismProfiles.flatMap((profile) => profile.requiredRealismEvidenceIds))),
  claimScope: "metadata_only_not_visual_quality_evidence",
}
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/asset-registry test -- asset-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update docs**

Append notes that asset-registry publication metadata can summarize humanoid realism profile evidence requirements without changing learner-use blockers.

---

## Task 5: Admin/API Visibility For Encounter Factory Profile Coverage

**Files:**
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/ui-admin/src/api-client.ts`
- Modify: `apps/ui-admin/src/ScenarioBankMaturityPanel.tsx`
- Modify: `apps/ui-admin/src/App.test.tsx`
- Modify: `AUTONOMOUS_WORK_PLAN.md`
- Modify: `docs/openclinxr/worker-backlog-and-validation-matrix.md`

- [ ] **Step 1: Add API contract assertion**

In the relevant scenario/asset pipeline route test, assert a metadata-only profile coverage object with no readiness claim. If no route exists yet, add the assertion to the nearest asset generation queue/report API route test rather than creating a new route.

- [ ] **Step 2: Extend admin client type**

Add optional metadata field:

```ts
humanoidRealismProfileCoverage?: {
  profileCount: number;
  missingProfileActorRoles: string[];
  claimScope: "metadata_only_not_visual_quality_evidence";
};
```

- [ ] **Step 3: Display compact coverage**

Add copy:

```tsx
{maturityReport.humanoidRealismProfileCoverage ? (
  <span>{maturityReport.humanoidRealismProfileCoverage.profileCount} humanoid realism profiles</span>
) : null}
```

Do not claim visual realism or Quest readiness.

- [ ] **Step 4: Run focused verification**

Run:

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/ui-admin test -- App.test.tsx api-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update docs**

Append notes that admin/control-plane visibility now reports metadata-only humanoid realism profile coverage.

---

## Task 6: Runtime Evidence Handoff Readiness Matrix

**Files:**
- Modify: `tools/openclinxr/runtime-realism-evidence-check.ts`
- Modify: `tools/openclinxr/runtime-realism-evidence-check.test.ts`
- Modify: `AUTONOMOUS_WORK_PLAN.md`
- Modify: `docs/openclinxr/worker-backlog-and-validation-matrix.md`

- [ ] **Step 1: Add test requiring profile-aware blockers**

Create or extend evidence-check tests so evidence missing profile IDs reports:

```ts
expect(report.result.blockers).toEqual(expect.arrayContaining([
  "humanoid_realism_profile_evidence_ids_missing",
]));
```

- [ ] **Step 2: Add optional profile input parsing**

Read profiles from evidence:

```ts
const humanoidRealismProfiles = Array.isArray(evidence.humanoidRealismProfiles)
  ? evidence.humanoidRealismProfiles.filter(isRecord)
  : [];
```

- [ ] **Step 3: Add blocker**

If profiles are present but none include the required viseme/eye/blink IDs, push:

```ts
"humanoid_realism_profile_evidence_ids_missing"
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js exec vitest run tools/openclinxr/runtime-realism-evidence-check.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update docs**

Append notes that runtime evidence checks can reason about profile metadata without claiming visual proof.

---

## Subagent Work Allocation

- Coordinator agent: maintain lane selection, prevent Quest/materialization drift, close subagents after handoff.
- Worker A: Task 1, capability-gateway profile validation.
- Worker B: Task 2, queue role/profile matching.
- Worker C: Task 3, publication role/profile matching.
- Worker D: Task 4, asset-registry metadata summary.
- Worker E: Task 5, admin/API visibility.
- Worker F: Task 6, runtime evidence handoff readiness.

Workers must not overlap write scopes. If two workers need the same file, execute sequentially.

## Verification Batch

After tasks complete, run focused checks only:

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js --filter @openclinxr/capability-gateway test -- asset-generation-jobs
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js exec vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js exec vitest run tools/openclinxr/encounter-publication-payloads.test.ts
```

Do not run broad test suites unless a touched file spans a package contract that focused tests cannot cover.

## Open Questions

- None blocking. Recommended default: continue metadata/contract hardening until queue/publication/asset-registry/admin/runtime evidence all preserve profile handoff, then move to actual runtime behavior slices.

