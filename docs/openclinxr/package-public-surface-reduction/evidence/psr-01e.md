# PSR-01E evidence - XR and remaining package contracts

Source revision: 40b6a874bde71b77bc8642c0b3edec3626ac8b1e. Task: PSR-01E v2.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`; working tree matches that commit).

Machine-readable companion: `psr-01e.json` in this directory. Approval: `../approvals/psr-01e.json` (1,893 rows: keep 935, remove 912, migrate 46; zero unresolved).
`rawInventoryHash` e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026; `groupHash` 7e8b0ae8c2ea0bfc39e7f8a0a622a350d6be58ac52fba2b47fade6a1ba224664.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-reviewed-group psr-01e` - exits 1 before the approval exists, 0 after (after column below).
- `git diff --check` - no whitespace errors.

## --require-reviewed-group psr-01e after column (literal output on this tree)

```text
$ tsx tools/openclinxr/architecture/public-surface/verify.ts -- --require-reviewed-group psr-01e
46 roots, 137 entrypoints, 2533 root symbols, 3588 occurrences, 3020 unique, 550 duplicated names (surface 4782814823d2)
ok: group psr-01e reviewed: 1893 resolved rows
ok baseline ratchet: surface matches the checked-in baseline (no growth)
```

## Measured before and after

Before: compiler-derived baseline of 46 roots, 137 entrypoints, 2,533 root symbols, 3,588 occurrences, 3,020 unique symbols, 550 duplicated names. After: identical (review approves dispositions; no exports changed). Wildcard declarations remaining: 46. Duplicated names remaining: 550.

## Removed, migrated, retained

No exports changed. No implementation deleted. 912 remove and 46 migrate dispositions approved for PSR-07/PSR-08 to implement; 935 keep. No relocation theater: no namespace wrapping, facade indirection, package splitting, or subpath relocation.

## Per-package counts and projected roots

| Package | Keep | Remove | Migrate | Projected root |
| --- | ---: | ---: | ---: | ---: |
| `packages/openclinxr/agent-loop` | 0 | 62 | 0 | 0 |
| `packages/openclinxr/arena/iwsdk-spike` | 2 | 99 | 0 | 2 |
| `packages/openclinxr/arena/model-vetting` | 24 | 56 | 0 | 24 |
| `packages/openclinxr/arena/multi-actor-state-spike` | 0 | 44 | 0 | 0 |
| `packages/openclinxr/arena/physics-touch-contract` | 1 | 107 | 0 | 1 |
| `packages/openclinxr/capability-gateway` | 24 | 23 | 0 | 24 |
| `packages/openclinxr/data-sources-mongoose-models` | 0 | 3 | 0 | 0 |
| `packages/openclinxr/domain` | 26 | 10 | 4 | 21 |
| `packages/openclinxr/exam-assembly` | 34 | 6 | 0 | 34 |
| `packages/openclinxr/factory-stations` | 31 | 18 | 6 | 28 |
| `packages/openclinxr/review-workflow` | 31 | 11 | 0 | 31 |
| `packages/openclinxr/scenario-fixtures` | 27 | 15 | 10 | 16 |
| `packages/openclinxr/scenario-runtime` | 20 | 14 | 0 | 20 |
| `packages/openclinxr/session-state` | 25 | 38 | 0 | 25 |
| `packages/openclinxr/shared-schemas` | 53 | 22 | 0 | 53 |
| `packages/openclinxr/ui-route-shared` | 12 | 187 | 11 | 7 |
| `packages/openclinxr/ui-shared` | 45 | 43 | 14 | 12 |
| `packages/openclinxr/voice-gateway` | 15 | 2 | 0 | 15 |
| `packages/openclinxr/xr-actor-dialogue` | 29 | 4 | 0 | 29 |
| `packages/openclinxr/xr-asset-loading` | 29 | 1 | 0 | 29 |
| `packages/openclinxr/xr-capture-evidence` | 36 | 3 | 0 | 36 |
| `packages/openclinxr/xr-dialogue` | 47 | 15 | 0 | 47 |
| `packages/openclinxr/xr-exam-flow` | 15 | 3 | 0 | 15 |
| `packages/openclinxr/xr-humanoid-animation` | 33 | 26 | 0 | 22 |
| `packages/openclinxr/xr-locomotion` | 24 | 8 | 0 | 24 |
| `packages/openclinxr/xr-pose` | 34 | 25 | 1 | 32 |
| `packages/openclinxr/xr-runtime-state` | 121 | 23 | 0 | 116 |
| `packages/openclinxr/xr-runtime-wiring` | 13 | 0 | 0 | 13 |
| `packages/openclinxr/xr-scene` | 38 | 17 | 0 | 38 |
| `packages/openclinxr/xr-scene-cues` | 38 | 2 | 0 | 38 |
| `packages/openclinxr/xr-station` | 70 | 10 | 0 | 70 |
| `packages/openclinxr/xr-station-room` | 11 | 15 | 0 | 10 |
| `packages/openclinxr/xr-trace-readiness` | 27 | 0 | 0 | 27 |

Projected root-export total for the group: 859 against the plan review targets (at most 50 per root; at most 1,000 program-wide). Reported, not forced.

## 20 sampled remove rows (compiler external-reference count 0)

| Package | Entrypoint | Symbol |
| --- | --- | --- |
| `packages/openclinxr/xr-pose` | `./actor-floor-composition` | MAX_SINK_METERS |
| `packages/openclinxr/ui-route-shared` | `./admin-api-client` | AdminFacultyReviewDecisionRecord |
| `packages/openclinxr/capability-gateway` | `.` | AssetGenerationArtifactKind |
| `packages/openclinxr/agent-loop` | `.` | createAgentLoopPlan |
| `packages/openclinxr/scenario-runtime` | `.` | createScenarioRuntimeWithPersistenceHooks |
| `packages/openclinxr/arena/iwsdk-spike` | `.` | evaluateIwsdkWorkspacePosture |
| `packages/openclinxr/ui-route-shared` | `./admin-api-client` | RuntimeVisualEvidenceAttachment |
| `packages/openclinxr/arena/model-vetting` | `.` | deployTargetForManifest |
| `packages/openclinxr/shared-schemas` | `.` | ProviderAuditRecordSchema |
| `packages/openclinxr/xr-pose` | `.` | plantSeatedFeetNearFloor |
| `packages/openclinxr/factory-stations` | `.` | lightingDesignRunner |
| `packages/openclinxr/arena/physics-touch-contract` | `.` | PalpationConfig |
| `packages/openclinxr/session-state` | `.` | updateActorSpatialState |
| `packages/openclinxr/arena/multi-actor-state-spike` | `.` | VoiceTranscriptInteractionSource |
| `packages/openclinxr/arena/iwsdk-spike` | `.` | IwsdkSpikePackagePosture |
| `packages/openclinxr/ui-route-shared` | `./admin-api-client-types` | FrozenActorTurnPlanPreview |
| `packages/openclinxr/xr-dialogue` | `.` | resolveVisemeTarget |
| `packages/openclinxr/arena/physics-touch-contract` | `.` | buildScenarioInspectionReport |
| `packages/openclinxr/xr-dialogue` | `.` | applyVisemeWeights |
| `packages/openclinxr/shared-schemas` | `.` | ProviderHealthSchema |

## 20 sampled keep rows (referencing file:line)

| Package | Entrypoint | Symbol | Referencing file:line |
| --- | --- | --- | --- |
| `packages/openclinxr/exam-assembly` | `.` | currentExamFormRunStation | packages/openclinxr/scenario-runtime/src/exam-run-bridge.ts:10 |
| `packages/openclinxr/xr-capture-evidence` | `.` | recordLearnerRuntimeUseGateEvidence | apps/ui-xr/src/main.ts:80 |
| `packages/openclinxr/xr-actor-dialogue` | `.` | PedsAdaptiveDialogueBranchResolution | apps/ui-xr/src/main.ts:402 |
| `packages/openclinxr/factory-stations` | `.` | ProductionStationId | packages/openclinxr/rest/src/station-payload-validation.ts:8 |
| `packages/openclinxr/xr-pose` | `.` | plantSeatedPelvisOnSeat | apps/ui-xr/src/main.ts:172 |
| `packages/openclinxr/xr-humanoid-animation` | `.` | HumanoidExpressionWeights | apps/ui-xr/src/main.ts:133 |
| `packages/openclinxr/xr-runtime-state` | `.` | formatExamFormRunClock | packages/openclinxr/xr-exam-flow/src/evidence.ts:5 |
| `packages/openclinxr/xr-scene` | `.` | resolveLocalHumanoidRuntimeAssetFileName | apps/ui-xr/src/static-assets.test.ts:733 |
| `packages/openclinxr/xr-exam-flow` | `.` | ExamFlowRuntimeAccessors | apps/ui-xr/src/main.ts:109 |
| `packages/openclinxr/xr-dialogue` | `.` | PhonemeCue | packages/openclinxr/xr-humanoid-animation/src/types.ts:45 |
| `packages/openclinxr/xr-runtime-state` | `.` | nextExamFormRunStation | packages/openclinxr/xr-exam-flow/src/evidence.ts:6 |
| `packages/openclinxr/xr-runtime-state` | `.` | authoredTraceTagsForScenario | tools/openclinxr/evidence/bundleless-station-identity.ts:19 |
| `packages/openclinxr/xr-locomotion` | `.` | buildExamineeLocomotionEvidence | apps/ui-xr/src/main.ts:148 |
| `packages/openclinxr/xr-runtime-wiring` | `.` | nextExamScenarioId | apps/ui-xr/src/main.ts:252 |
| `packages/openclinxr/xr-runtime-wiring` | `.` | configuredExamSequence | apps/ui-xr/src/main.ts:250 |
| `packages/openclinxr/xr-runtime-state` | `./bedside-approach-execution` | travelYawForClipForward | packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime.ts:10 |
| `packages/openclinxr/ui-shared` | `./assembled-exam-replay-timeline` | AdminAssembledExamReplayProjection | apps/ui-admin/src/the-faculty-replay-shows-assembled-station-transitions.test.tsx:4 |
| `packages/openclinxr/xr-dialogue` | `.` | ActorTurnLiveSlot | apps/ui-xr/src/the-frozen-actor-turn-drives-multimodal-playback.test.ts:8 |
| `packages/openclinxr/domain` | `.` | authoredContentIdentityEvidenceRef | packages/openclinxr/review-workflow/src/scenario-bank-approval.test.ts:1 |
| `packages/openclinxr/xr-asset-loading` | `.` | shouldShowProceduralHumanoidDetailCues | apps/ui-xr/src/main.ts:62 |

## Classifier source (rerunnable)

Classifier ran outside the repo as /tmp/psr01e_genA.py + /tmp/psr01e_genB.py + /tmp/psr01e_genC.py + /tmp/psr01e_genD1.py + /tmp/psr01e_genD2.py + /tmp/psr01e-assemble.cjs + /tmp/psr01e-final.cjs + /tmp/psr01e-ev.cjs: explicit KEEP lists with owner and symbol-level import evidence from three parallel read-only classifier passes (subagents 01a08f09-b736-7922-a34e-ead7cfbcc429/ad7cfbcc429-part-A, 01a08f09-b736-7922-a34e-eaeea8db3b4d-part-B, 01a08f09-b736-7922-a34e-eaf0f4eca3b7-part-C), explicit MIGRATE lists for the seven intra-package duplicate groups (domain claim-language, factory-stations catalog, scenario-fixtures subpaths, ui-route-shared admin-api-client/types, ui-shared admin-runtime-posture/admin-workbench-format, xr-pose actor-floor-composition), REMAINDER defaulting every other row to remove. Inputs: docs/openclinxr/package-public-surface-reduction/raw-inventory.json per-row entrypoint consumers narrowed to symbol-level import bindings, package.json exports maps for route validation, tree greps for dynamic import/require/re-export/namespace/deep-relative forms.

## Consumer migrations enumerated

Keep rows carry owner plus symbol-level evidence; migrate rows carry the kept route. Deep relative imports bypassing the specifier (not surface consumers; for PSR-07/PSR-08): packages/openclinxr/motion-compiler/src/compile-motion-program.ts:46 (responseClipForBodyRegion from ../../scenario-fixtures/src/touch-response-clip.js), the-resolved-clip-id-is-what-the-compiler-produces.test.ts:6 (scenarioBank), the-llm-planner-cannot-emit-bone-tracks.test.ts:6-7 (review-workflow scenario-publication, scenario-fixtures ed-chest-pain), an-action-binds-to-an-authored-source.test.ts:6, the-planner-schema-admits-no-unknown-payload.test.ts:3. Re-export chains: packages/openclinxr/scenario-runtime/src/index.ts (review-workflow PublicationTargetUse/ReviewerEvidence/ScenarioPublicationReadiness), packages/openclinxr/shared-schemas/src/factory-stations.ts (factory-stations catalog), packages/openclinxr/ui-route-admin/src/formatters.ts (ui-shared workbench helpers), apps/ui-xr/src/capture-comparator.ts (xr-capture-evidence clocks). Dynamic import() hits folded into keeps: apps/api/src/scenario-promotion-bridge.ts:51 (xr-scene), xr-humanoid-animation an-owned-chain test (xr-pose), xr-scene infinigen test (xr-station), scenario-runtime absent-asset test (own specifier, self-import).

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility.
