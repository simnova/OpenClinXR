# PSR-01E approval - XR and remaining package contracts

Source revision: 40b6a874bde71b77bc8642c0b3edec3626ac8b1e. Task: PSR-01E v2. Lane A.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`; working tree matches that commit).

Machine-readable companion: `psr-01e.json` in this directory. Rows: 1,893 (keep 935, remove 912, migrate 46), zero unresolved. `rawInventoryHash` e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026; `groupHash` 7e8b0ae8c2ea0bfc39e7f8a0a622a350d6be58ac52fba2b47fade6a1ba224664.

## Dispositions per package

| Package | Rows | Keep | Remove | Migrate | Root now | Projected root |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `packages/openclinxr/agent-loop` | 62 | 0 | 62 | 0 | 62 | 0 |
| `packages/openclinxr/arena/iwsdk-spike` | 101 | 2 | 99 | 0 | 101 | 2 |
| `packages/openclinxr/arena/model-vetting` | 80 | 24 | 56 | 0 | 80 | 24 |
| `packages/openclinxr/arena/multi-actor-state-spike` | 44 | 0 | 44 | 0 | 44 | 0 |
| `packages/openclinxr/arena/physics-touch-contract` | 108 | 1 | 107 | 0 | 108 | 1 |
| `packages/openclinxr/capability-gateway` | 47 | 24 | 23 | 0 | 47 | 24 |
| `packages/openclinxr/data-sources-mongoose-models` | 3 | 0 | 3 | 0 | 3 | 0 |
| `packages/openclinxr/domain` | 40 | 26 | 10 | 4 | 30 | 21 |
| `packages/openclinxr/exam-assembly` | 40 | 34 | 6 | 0 | 40 | 34 |
| `packages/openclinxr/factory-stations` | 55 | 31 | 18 | 6 | 44 | 28 |
| `packages/openclinxr/review-workflow` | 42 | 31 | 11 | 0 | 37 | 31 |
| `packages/openclinxr/scenario-fixtures` | 52 | 27 | 15 | 10 | 29 | 16 |
| `packages/openclinxr/scenario-runtime` | 34 | 20 | 14 | 0 | 34 | 20 |
| `packages/openclinxr/session-state` | 63 | 25 | 38 | 0 | 54 | 25 |
| `packages/openclinxr/shared-schemas` | 75 | 53 | 22 | 0 | 75 | 53 |
| `packages/openclinxr/ui-route-shared` | 210 | 12 | 187 | 11 | 12 | 7 |
| `packages/openclinxr/ui-shared` | 102 | 45 | 43 | 14 | 23 | 12 |
| `packages/openclinxr/voice-gateway` | 17 | 15 | 2 | 0 | 17 | 15 |
| `packages/openclinxr/xr-actor-dialogue` | 33 | 29 | 4 | 0 | 33 | 29 |
| `packages/openclinxr/xr-asset-loading` | 30 | 29 | 1 | 0 | 30 | 29 |
| `packages/openclinxr/xr-capture-evidence` | 39 | 36 | 3 | 0 | 39 | 36 |
| `packages/openclinxr/xr-dialogue` | 62 | 47 | 15 | 0 | 62 | 47 |
| `packages/openclinxr/xr-exam-flow` | 18 | 15 | 3 | 0 | 18 | 15 |
| `packages/openclinxr/xr-humanoid-animation` | 59 | 33 | 26 | 0 | 30 | 22 |
| `packages/openclinxr/xr-locomotion` | 32 | 24 | 8 | 0 | 32 | 24 |
| `packages/openclinxr/xr-pose` | 60 | 34 | 25 | 1 | 47 | 32 |
| `packages/openclinxr/xr-runtime-state` | 144 | 121 | 23 | 0 | 131 | 116 |
| `packages/openclinxr/xr-runtime-wiring` | 13 | 13 | 0 | 0 | 13 | 13 |
| `packages/openclinxr/xr-scene` | 55 | 38 | 17 | 0 | 55 | 38 |
| `packages/openclinxr/xr-scene-cues` | 40 | 38 | 2 | 0 | 40 | 38 |
| `packages/openclinxr/xr-station` | 80 | 70 | 10 | 0 | 80 | 70 |
| `packages/openclinxr/xr-station-room` | 26 | 11 | 15 | 0 | 25 | 10 |
| `packages/openclinxr/xr-trace-readiness` | 27 | 27 | 0 | 0 | 27 | 27 |

Projected root-export total for the group: 859. Plan review targets (at most 50 per root; at most 1,000 program-wide) are reported, not forced.
Every root stays at or under 50 after application except none: the largest projected roots are xr-runtime-state (116), xr-station (70), xr-dialogue (47). xr-runtime-state above 50 is reported as an exception for PSR-07 to justify, not a failure of this review.

## Migration routes (46)

All routes are entrypoints that already exist in the same package exports map; no new subpaths invented. Consumer-oriented route kept in each case:

| Package | Symbol | Migrated route | Kept route |
| --- | --- | --- | --- |
| `packages/openclinxr/domain` | buildScenarioGovernanceCopy | `.` | `./claim-language` |
| `packages/openclinxr/domain` | safeUserFacingClaimLanguage | `.` | `./claim-language` |
| `packages/openclinxr/domain` | scoreUseCopy | `.` | `./claim-language` |
| `packages/openclinxr/domain` | validationStageCopy | `.` | `./claim-language` |
| `packages/openclinxr/factory-stations` | FactoryStationSchema | `./catalog` | `.` |
| `packages/openclinxr/factory-stations` | PRODUCTION_STATION_IDS | `./catalog` | `.` |
| `packages/openclinxr/factory-stations` | StandardIssue | `./catalog` | `.` |
| `packages/openclinxr/factory-stations` | StandardResult | `./catalog` | `.` |
| `packages/openclinxr/factory-stations` | StationJsonSchema | `./catalog` | `.` |
| `packages/openclinxr/factory-stations` | StationPropertySchema | `./catalog` | `.` |
| `packages/openclinxr/scenario-fixtures` | affectForAuthoredRecord | `./authored-utterance-record` | `.` |
| `packages/openclinxr/scenario-fixtures` | AuthoredUtteranceRecord | `./authored-utterance-record` | `.` |
| `packages/openclinxr/scenario-fixtures` | keywordAffectFallbackFromText | `./authored-utterance-record` | `.` |
| `packages/openclinxr/scenario-fixtures` | DialogueFixtureSeed | `./ed-chest-pain` | `.` |
| `packages/openclinxr/scenario-fixtures` | edChestPainDialogueSeeds | `./ed-chest-pain` | `.` |
| `packages/openclinxr/scenario-fixtures` | findScenarioFixtureById | `.` | `./scenario-bank` |
| `packages/openclinxr/scenario-fixtures` | firstNameFromDisplayName | `.` | `./authored-utterance-record` |
| `packages/openclinxr/scenario-fixtures` | learnerVisibleAuthoredCaption | `.` | `./authored-utterance-record` |
| `packages/openclinxr/scenario-fixtures` | pediatricAsthmaDialogueSeeds | `.` | `./pediatric-asthma` |
| `packages/openclinxr/scenario-fixtures` | responseClipForBodyRegion | `.` | `./scenario-bank` |
| `packages/openclinxr/ui-route-shared` | AdminControlPlaneClient | `./admin-api-client-types` | `.` |
| `packages/openclinxr/ui-route-shared` | FacultyCompileLockClient | `./admin-api-client-types` | `.` |
| `packages/openclinxr/ui-route-shared` | AdminAssembledExamReplayProjection | `./admin-api-client` | `./admin-api-client-types` |
| `packages/openclinxr/ui-route-shared` | AdminControlPlaneClient | `./admin-api-client` | `.` |
| `packages/openclinxr/ui-route-shared` | AdminReviewPacketReplay | `./admin-api-client` | `./admin-api-client-types` |
| `packages/openclinxr/ui-route-shared` | AdminScenario | `./admin-api-client` | `./admin-api-client-types` |
| `packages/openclinxr/ui-route-shared` | AdminScenarioReviewDecision | `./admin-api-client` | `./admin-api-client-types` |
| `packages/openclinxr/ui-route-shared` | buildAdminGraphqlEndpoint | `./admin-api-client` | `.` |
| `packages/openclinxr/ui-route-shared` | compileEncounterWorld | `./admin-api-client` | `.` |
| `packages/openclinxr/ui-route-shared` | createAdminControlPlaneClient | `./admin-api-client` | `.` |
| `packages/openclinxr/ui-route-shared` | FacultyCompileLockClient | `./admin-api-client` | `.` |
| `packages/openclinxr/ui-shared` | capabilityTagColor | `./admin-workbench-format` | `.` |
| `packages/openclinxr/ui-shared` | clampedScoreFromWorkbenchInput | `./admin-workbench-format` | `.` |
| `packages/openclinxr/ui-shared` | countActorCommunicationProfiles | `./admin-workbench-format` | `.` |
| `packages/openclinxr/ui-shared` | formatActorCommunicationProfileCoverage | `./admin-workbench-format` | `.` |
| `packages/openclinxr/ui-shared` | formatDuration | `./admin-workbench-format` | `.` |
| `packages/openclinxr/ui-shared` | pluralizeWorkbenchCount | `./admin-workbench-format` | `.` |
| `packages/openclinxr/ui-shared` | uniqueWorkbenchValues | `./admin-workbench-format` | `.` |
| `packages/openclinxr/ui-shared` | AdminNoReadinessEvidenceClaim | `.` | `./admin-runtime-posture` |
| `packages/openclinxr/ui-shared` | AdminRealtimeVoicePosture | `.` | `./admin-runtime-posture` |
| `packages/openclinxr/ui-shared` | AdminRuntimeProtocolPosture | `.` | `./admin-runtime-posture` |
| `packages/openclinxr/ui-shared` | AdminRuntimeProtocolSupport | `.` | `./admin-runtime-posture` |
| `packages/openclinxr/ui-shared` | AdminRuntimeProviderPlaneReadiness | `.` | `./admin-runtime-posture` |
| `packages/openclinxr/ui-shared` | AdminRuntimeProviderReadiness | `.` | `./admin-runtime-posture` |
| `packages/openclinxr/ui-shared` | AdminRuntimeProviderReadinessSurface | `.` | `./admin-runtime-posture` |
| `packages/openclinxr/xr-pose` | describeRuntimeBundleScenarioMatch | `./actor-floor-composition` | `.` |

## Consumer migrations

No consumer file moves in this review card: keep rows name the consuming package or app as owner with symbol-level import evidence; migrate rows name the kept route consumers already use. Implementation cards PSR-07 (seven XR facades) and PSR-08 (explicit tail) own the file edits. Cross-package deep relative imports that bypass the package specifier (motion-compiler tests importing ../../scenario-fixtures/src/ and ../../review-workflow/src/) are recorded in evidence/psr-01e.md for the implementation cards; they are not package-surface consumers.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-reviewed-group psr-01e` - exits 1 before the approval exists, 0 after (literal output in evidence/psr-01e.md).
- `git diff --check` - no whitespace errors.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility.
