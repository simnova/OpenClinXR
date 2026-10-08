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

## Amendment before dispatch (orchestrator, 2026-09-11)

115 rows move from `remove` to `keep` (797 remove rows remain) because each name is imported by
its own package's tests through the entrypoint on origin/main 43ffd845. By package:
iwsdk-spike 32, physics-touch-contract 23, multi-actor-state-spike 11, capability-gateway 9,
agent-loop 6, scenario-fixtures 6, session-state 6, xr-runtime-state 6, model-vetting 3,
data-sources-mongoose-models 3, scenario-runtime 3, shared-schemas 3, xr-locomotion 3,
xr-station-room 1. Plan lines 83 and 92 count tests as consumers; PSR-03 showed that
un-publishing such a name raises `testInternalImports` above its shrink-only ceiling. Each amended
row names the consuming test as owner, with file:line evidence. `--require-reviewed-group psr-01e`
still exits 0.

## Amendment at xr-actor-dialogue shrink (worker, 2026-10-08; reviewed by Codex gpt-5.6-terra, session 01a11a71-9d93-7821-9ec0-4f29ca1f7ecf)

24 `packages/openclinxr/xr-actor-dialogue` rows move from `keep` to `remove` (797 remove rows
become 821). Every row's keep evidence cited `apps/ui-xr/src/main.ts` at source revision
40b6a874 as a symbol-level import binding; on xad-shrink @ 5dabb3700 none of the 24 is bound by
any consumer. The tree's only package-specifier import is `apps/ui-xr/src/main.ts:29-35`, which
binds exactly 5 other names (`createActorDialogueStore`, `ActorDialoguePlaybackEvidence`,
`ActorDialogueSequence`, `ActorDialogueTurn`, `ActorDialogueAdaptiveEvidence`); a repo-wide
multiline import scan finds no other `from "@openclinxr/xr-actor-dialogue"`, no dynamic
`import()`/`require()` of the specifier in `apps/` or `tools/`, and no relative path-reach
import into the package `src/` (the only references are `readFileSync` source-text reads in
`apps/ui-xr/src/static-assets.test.ts:676,760` for substring assertions). The own-package test
`packages/openclinxr/xr-actor-dialogue/src/store.test.ts:5` binds only `createActorDialogueStore`
through `./index.js`. Per row, with the stale keep evidence in parentheses:

- `PedsActorPlayerRuntimePlaybackEvidence` (was main.ts:525): now a local alias at
  `apps/ui-xr/src/main.ts:1250` to the consumed import (main.ts:31); main.ts:345 imports the
  same-spelled type from `@openclinxr/xr-trace-readiness`.
- `PedsActorPlayerRuntimeSequenceEvidence` (was main.ts:1233): now a local alias at
  `apps/ui-xr/src/main.ts:1247` to the consumed import (main.ts:32).
- `PedsActorPlayerRuntimeTurn` (was main.ts:1232): now a local alias at
  `apps/ui-xr/src/main.ts:1246` to the consumed import (main.ts:33).
- `PedsAdaptiveDialogueBranchResolution` (was main.ts:402): type defined locally at
  `apps/ui-xr/src/peds-adaptive-dialogue-policy.ts:6`, imported by main.ts:394-397 from
  `./peds-adaptive-dialogue-policy.js`.
- `PedsAdaptiveDialogueEvidence` (was main.ts:526): now a local alias at
  `apps/ui-xr/src/main.ts:1249` to the consumed import (main.ts:34).
- `applyPedsActorPlayerSequenceListenerCues` (was main.ts:336): main.ts:1400 defines a local
  wrapper delegating to `actorDialogueStore` (main.ts:1405); main.ts:330 imports the same-spelled
  type from `@openclinxr/xr-trace-readiness`.
- `dedupePedsActorPlayerRuntimeTurns` (was main.ts:1368): absent from main.ts entirely; exercised
  only as a store method (`store.test.ts:145`) and in-package.
- `humanoidDialogueDurationMs` (was main.ts:1254): main.ts:1437 defines a local function
  delegating to the store (main.ts:1438).
- `initialDialogueTextForSelectedScenario` (was main.ts:1349): main.ts:1363 defines a local
  function delegating to the store (main.ts:1364).
- `localDialogueActorIdForTraceTag` (was main.ts:1437): main.ts:1448 defines a local function
  delegating to the store (main.ts:1449).
- `localDialogueGazeTargetForTraceTag` (was main.ts:1440): main.ts:1451 defines a local function
  delegating to the store (main.ts:1452).
- `normalizePedsActorPlayerEmotion` (was main.ts:1269): main.ts:1384 defines a local function
  delegating to the store (main.ts:1385).
- `pedsActorPlayerBundleDialogueTurns` (was main.ts:1274): main.ts:1381 defines a local function
  delegating to the store (main.ts:1382).
- `playLiveFrozenActorTurn` (was main.ts:1343): main.ts:4322 defines the local function (factory
  and evidence tests slice main.ts source at this definition).
- `playPedsActorPlayerRuntimeSequence` (was main.ts:1397): main.ts:1407 defines a local wrapper
  delegating to the store (main.ts:1408).
- `playPedsActorPlayerRuntimeTurn` (was main.ts:1387): main.ts:1387 defines a local wrapper
  delegating to the store (main.ts:1398).
- `recordPedsActorPlayerRuntimePlaybackEvidence` (was main.ts:351): main.ts:1410 defines a local
  wrapper delegating to the store (main.ts:1422); main.ts:345 imports the same-spelled type from
  `@openclinxr/xr-trace-readiness`.
- `runtimeDialogueTurnForTraceTag` (was main.ts:1279): main.ts:1366 defines a local function
  delegating to the store (main.ts:1367).
- `scenarioDialogueEmotionContext` (was main.ts:1435): main.ts:1440 defines a local wrapper
  delegating to the store (main.ts:1446).
- `schedulePedsActorPlayerRuntimePlaybackIfReady` (was main.ts:1355): main.ts:1369 defines a
  local function delegating to the store (main.ts:1370).
- `triggerHumanoidDialogue` (was main.ts:1416): main.ts:1427 defines a local function delegating
  to the store (main.ts:1435).
- `triggerHumanoidDialogueForTrace` (was main.ts:1413): main.ts:1424 defines a local function
  delegating to the store (main.ts:1425).
- `triggerPedsActorPlayerRuntimeTurnForTrace` (was main.ts:1364): main.ts:1378 defines a local
  function delegating to the store (main.ts:1379).
- `triggerPedsAdaptiveDialogueBranch` (was main.ts:1358): main.ts:1372 defines a local function
  delegating to the store (main.ts:1376).

Each amended row names `packages/openclinxr/xr-actor-dialogue` as owner with the disproof above
as rationale and evidence, and carries `reviewedBy: reviewed by Codex gpt-5.6-terra, session 01a11a71-9d93-7821-9ec0-4f29ca1f7ecf`; the coordinator
arranges the independent review before this amendment lands. `rawInventoryHash` and `groupHash`
are unchanged (recomputed with the repo's own `gates.ts` `groupHash` over the frozen raw rows:
`e43ee9c2…` / `7e8b0ae8…`, both match). String-content tests in `static-assets.test.ts` assert on
main.ts substrings and the package's own source text, not on entrypoint publication, so they are
unaffected by un-publishing.

## Amendment at shrink-b (worker, 2026-10-08; reviewedBy reviewed by Codex gpt-5.6-terra, session 01a11ad4-675a-7ac1-a55e-8ed57ee28447)
7 rows: `shared-schemas` `classifyScenarioEquipmentBinding` + `EQUIPMENT_BINDING_PRECEDENCE` stay `keep` with new dynamic-import evidence (`every-authored-equipment-string-is-classified.test.ts:60,61`; old `:38`/`:27` are comment sketches); `EquipmentBindingClassification` moves `keep` to `remove` (new evidence `equipment-binding.ts:17`); `ProductionStationId` stays `keep` with new inline-import evidence (`environment-generation-queue-panel.tsx:67`; old `:88` stale). `ui-route-shared` `.` `FacultyCompileLockClient` and `./admin-api-client-types` `AdminAssembledExamReplayProjection` move `keep` to `remove` (consumers bind same-spelled names from `ui-route-admin` and `ui-shared`). `voice-gateway` `.` `supportedRealtimeVoiceControlTypes` moves `keep` to `remove` (rest binds the local copy in `protocol-posture-readers.js`).

## Amendment at shrink-a consumer-contracts (worker, 2026-10-08; reviewedBy reviewed by Codex gpt-5.6-terra, session 01a11b94-7ca3-7d11-a644-1a2a3a020ea8)

39 rows move from `keep` to `remove` (a 40th candidate, `bootIsolatedSubjectLab`, stays `keep`
with a PENDING review note: see below): 10 `packages/openclinxr/xr-station` (all `.` except the
dynamically bound `setStretcherInclineDegrees` and `inspectStationFixtureVocabulary`, which stay
published), 7 `packages/openclinxr/xr-capture-evidence`, 6 `packages/openclinxr/xr-scene`,
3 `packages/openclinxr/xr-runtime-state` on `.` plus 3 on `./composed-body-direction` (the root
keeps publishing the composed-direction trio), 5 `packages/openclinxr/xr-pose`,
1 `packages/openclinxr/xr-asset-loading`, 1 `packages/openclinxr/xr-locomotion`,
1 `packages/openclinxr/xr-runtime-wiring`, and `edChestPainScenarioV3` on
`packages/openclinxr/scenario-fixtures` `./ed-chest-pain` (the root keeps publishing it).
The cited keeps pointed at same-spelled locals (main.ts wrappers, tools-evidence types, local
functions), comments, source-text Contains assertions, or imports binding another provider's
same-spelled name. Consumer contracts on shrink-a @ d387f30fe bind none of the 39 via specifier,
own-test entrypoint, path-reach, dynamic, or export-star use; the three dynamically bound names
above plus the two scenario-runtime outcomes stay published with reasons. `bootIsolatedSubjectLab`
is additionally kept unconsumed: it is the sole entry keeping the isolated-subject lab file
cluster and the xr-scene `@openclinxr/xr-pose` dependency reachable, and unpublishing orphans
all four files, which `pnpm hygiene:knip` (pre-commit hook) refuses. Each amended row names
the provider package as owner with `reviewedBy: reviewed by Codex gpt-5.6-terra, session 01a11b94-7ca3-7d11-a644-1a2a3a020ea8`; the coordinator
arranges the independent review.
