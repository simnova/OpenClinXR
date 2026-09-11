# PSR-01C evidence — data/model/motion review (data-mongodb, motion-compiler, conversation-policy, model-gateway, graphql)

Source revision: 40b6a874bde71b77bc8642c0b3edec3626ac8b1e. Task: PSR-01C v2.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`; working tree matches that commit).

Machine-readable companions: `psr-01c.json` in this directory; approval manifest `../approvals/psr-01c.json` (332 rows: package, entrypoint, symbol, kind, disposition, route, owner, rationale, evidence; `rawInventoryHash` `e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`; `groupHash` `a8bd55837e0db542cf66dee57048b6dbac253f7eb6e175e15c6919bf59c89b24`). Raw rows: `../raw-inventory.json` (3,588 rows). Review only: no package code, exports, consumers, raw inventory, or verification policy changed.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-reviewed-group psr-01c` — exits 1 before the approval exists, 0 after (literal outputs below).
- `git diff --check` — no whitespace errors.

## --require-reviewed-group before column (literal output on this tree)

```text
$ tsx tools/openclinxr/architecture/public-surface/verify.ts -- --require-reviewed-group psr-01c
46 roots, 137 entrypoints, 2533 root symbols, 3588 occurrences, 3020 unique, 550 duplicated names (surface 4782814823d2)
FAIL: approval manifest for psr-01c is absent
ok baseline ratchet: surface matches the checked-in baseline (no growth)
public-surface verify FAILED: one or more required gates failed
```

## --require-reviewed-group after column (literal output on this tree)

```text
$ tsx tools/openclinxr/architecture/public-surface/verify.ts -- --require-reviewed-group psr-01c
46 roots, 137 entrypoints, 2533 root symbols, 3588 occurrences, 3020 unique, 550 duplicated names (surface 4782814823d2)
ok: group psr-01c reviewed: 332 resolved rows
ok baseline ratchet: surface matches the checked-in baseline (no growth)
```

## Measured before and after

Before: compiler-derived 46 roots, 137 entrypoints, 2,533 root symbols, 3,588 occurrences, 3,020 unique symbols, 550 duplicated names. After: identical (review approves dispositions; implementation belongs to PSR-03). Wildcard declarations untouched. Duplicated names untouched (3 in-group duplicates resolved by migrate disposition, applied later). Manifest hashes per package unchanged (see `psr-01c.json`).

## Dispositions per package

| Package | Rows | Keep | Remove | Migrate | Projected root exports after application |
| --- | ---: | ---: | ---: | ---: | ---: |
| packages/openclinxr/data-mongodb | 73 | 0 | 73 | 0 | 0 |
| packages/openclinxr/motion-compiler | 83 | 7 | 76 | 0 | 0 |
| packages/openclinxr/conversation-policy | 59 | 27 | 32 | 0 | 27 |
| packages/openclinxr/model-gateway | 34 | 11 | 23 | 0 | 11 |
| packages/openclinxr/graphql | 83 | 38 | 43 | 2 | 9 |

Plan review targets: at most 50 per root; at most 1,000 root exports program-wide. Every package projects under 50 per root (0, 0, 27, 11, 9). Program-wide projection is PSR-01B..E joint work, not this card. Numbers reported, not forced.

## Removed, migrated, retained

- Removed (249): exact lists in `../approvals/psr-01c.json` (`disposition: remove`). data-mongodb 73 (zero confirmed external importers; only string-literal mentions in architecture tests and capability routing, no module import). motion-compiler root 76 (zero confirmed external importers; only the adapter string literal in `packages/openclinxr/factory-stations/src/motion_retarget/run.ts:19`, not an import). conversation-policy 32, model-gateway 23, graphql 43 (no confirmed external named importer from the specifier; text-match leads ruled out by specifier check, e.g. `ReviewDecision` in apps/api is a local record type, `ModelProvenance` lead is the identifier `hasModelProvenance`, `TurnCancelModality` lead is voice-gateway-local `ActorTurnCancelModality`). Removal un-publishes the name; implementation stays.
- Migrated (2): graphql root `adminGraphqlDocumentByOperationName` and `adminGraphqlDocuments` move to the existing `./documents` subpath (consumer-oriented route already declared in `package.json#exports`; no new subpath invented). Root copies removed on application.
- Retained (81): keep rows name the consuming package/app as owner with up to 3 file:line references. conversation-policy 27 (scenario-runtime, apps/ui-xr, voice-gateway). model-gateway 11 (scenario-runtime, test-harness). graphql root 7 + `./documents` 3 + `./client` 28 (rest, apps/api, ui-route-shared, ui-shared). motion-compiler `./planted-red-manifest` 7 (intra-package derivation test contract).
- Retained exceptions: none beyond keep rows; no compatibility contract without an in-repo consumer was claimed.
- Wildcard declarations removed: 0 (review only). Duplicates removed on application: 2 of the 3 in-group duplicate names (`adminGraphqlDocumentByOperationName`, `adminGraphqlDocuments` off root; `AdminGraphqlDocument` keeps `./documents` as canonical and removes root).
- Consumer files migrated: none (review only; PSR-03 owns migration).
- No relocation theater: no namespace wrapping, facade indirection, package splitting, or subpath relocation. Both migrate routes are entrypoints already declared in the package's exports.

## Sampled remove rows (20, compiler external-reference count 0)

Deterministic sample (sha256("psr-01c-remove") stride over sorted remove rows):

| Package | Entrypoint | Symbol | Kind | External refs |
| --- | --- | --- | --- | ---: |
| packages/openclinxr/conversation-policy | . | CanonicalInterruptionIdentity | type | 0 |
| packages/openclinxr/conversation-policy | . | EmotionPerformanceMapperInput | type | 0 |
| packages/openclinxr/conversation-policy | . | resolveLearnerBargeIn | runtime | 0 |
| packages/openclinxr/data-mongodb | . | ActorTurnExecutionRecord | type | 0 |
| packages/openclinxr/data-mongodb | . | createExamRunLedger | runtime | 0 |
| packages/openclinxr/data-mongodb | . | examRunLedgerClaimBoundary | runtime | 0 |
| packages/openclinxr/data-mongodb | . | MemoryPromotedEncounterBundleRepository | runtime | 0 |
| packages/openclinxr/data-mongodb | . | MongoExamRunLedger | runtime | 0 |
| packages/openclinxr/data-mongodb | . | PromotedEncounterBundleRecord | type | 0 |
| packages/openclinxr/graphql | ./client | AssembleExamFormDocument | runtime | 0 |
| packages/openclinxr/graphql | ./client | FacultyDispositionTrailFieldsFragmentDoc | runtime | 0 |
| packages/openclinxr/graphql | ./client | useFragment | runtime | 0 |
| packages/openclinxr/model-gateway | . | ActorCommunicationProfileContext | type | 0 |
| packages/openclinxr/model-gateway | . | DialogueSeedActorResponseRequestOptions | type | 0 |
| packages/openclinxr/motion-compiler | . | canonicalMotionProgramHash | runtime | 0 |
| packages/openclinxr/motion-compiler | . | DeclaredContact | type | 0 |
| packages/openclinxr/motion-compiler | . | MOTION_BODY_REGIONS | runtime | 0 |
| packages/openclinxr/motion-compiler | . | motionBodyRegionForComplianceRegion | runtime | 0 |
| packages/openclinxr/motion-compiler | . | MotionValidation | type | 0 |
| packages/openclinxr/motion-compiler | . | RegisteredPrimitive | type | 0 |

## Sampled keep rows (20, referencing file:line)

Deterministic sample (sha256("psr-01c-keep") stride over sorted keep rows):

| Package | Entrypoint | Symbol | Referencing file:line |
| --- | --- | --- | --- |
| packages/openclinxr/conversation-policy | . | BargeInContext | packages/openclinxr/voice-gateway/src/carry-learner-stt-interruption.ts:6 |
| packages/openclinxr/conversation-policy | . | CaseEmotionPolicy | packages/openclinxr/scenario-runtime/src/emotion-policy.ts:1 |
| packages/openclinxr/conversation-policy | . | domainsForTraceTag | apps/ui-xr/src/peds-adaptive-dialogue-policy.ts:1 |
| packages/openclinxr/conversation-policy | . | EmotionTransition | packages/openclinxr/scenario-runtime/src/actor-turn-generation.ts:1 |
| packages/openclinxr/conversation-policy | . | LearnerBargeInInput | packages/openclinxr/scenario-runtime/src/scenario-runtime.ts:2 |
| packages/openclinxr/conversation-policy | . | stripProviderMarkup | packages/openclinxr/scenario-runtime/src/actor-turn-plan.ts:1 |
| packages/openclinxr/graphql | ./client | CreateStationRunQueueSnapshotDocument | packages/openclinxr/ui-route-shared/src/admin-api-client.ts:12 |
| packages/openclinxr/graphql | ./client | FacultyDispositionStatus | packages/openclinxr/ui-shared/src/faculty-disposition-codec.ts:1 |
| packages/openclinxr/graphql | ./client | ReviewPacketReplayQueryVariables | packages/openclinxr/ui-route-shared/src/admin-api-client-types.ts:12 |
| packages/openclinxr/graphql | ./client | ScenarioBankDocument | packages/openclinxr/ui-route-shared/src/admin-api-client.test.ts:1 |
| packages/openclinxr/graphql | ./client | ScenarioDetailQuery | packages/openclinxr/ui-route-shared/src/admin-api-client-types.ts:12 |
| packages/openclinxr/graphql | ./client | ScenarioReviewDecisionsQueryVariables | packages/openclinxr/ui-route-shared/src/admin-api-client.ts:12 |
| packages/openclinxr/graphql | ./client | StationRunQueueSnapshotsQueryVariables | packages/openclinxr/ui-route-shared/src/admin-api-client.ts:12 |
| packages/openclinxr/graphql | ./documents | AdminGraphqlDocument | packages/openclinxr/rest/src/routes/admin-graphql-routes.ts:22 (serves documents over HTTP) |
| packages/openclinxr/graphql | . | AdminGraphqlRootValue | packages/openclinxr/rest/src/api-route-support.ts:29 |
| packages/openclinxr/graphql | . | executeAdminGraphql | packages/openclinxr/rest/src/routes/admin-graphql-routes.ts:2 |
| packages/openclinxr/model-gateway | . | buildActorResponseRequestsForDialogueSeeds | packages/openclinxr/test-harness/src/station-simulation.ts:3 |
| packages/openclinxr/model-gateway | . | MockModelProviderAdapter | packages/openclinxr/scenario-runtime/src/scenario-runtime.test.ts:4 |
| packages/openclinxr/model-gateway | . | ModelRequestPolicy | packages/openclinxr/scenario-runtime/src/provider-support.ts:1 |
| packages/openclinxr/motion-compiler | ./planted-red-manifest | discoverPlantedClauses | packages/openclinxr/motion-compiler/src/test/planted-red-manifest.derived.test.ts:10 |

## Classifier source

The classifier ran outside the repo (`/tmp/psr01c-classify/attr.mjs`, copied into the worktree run as `psr01c-attr.tmp.mjs`, removed after). Method: for each of the 5 packages, grep all out-of-package source files importing the package name, build one TypeScript program over those files, walk ImportDeclaration/ExportDeclaration nodes matching the package specifier (`@openclinxr/<pkg>` or `@openclinxr/<pkg>/<subpath>`), and record named imports per (entrypoint, symbol) with file:line. Text matches then confirmed against the importing specifier (rules out same-identifier locals such as api `ReviewDecision`, voice-gateway `ActorTurnCancelModality`, `hasModelProvenance`). Full per-symbol attribution table is in `psr-01c.json` (`attribution`); approval rows carry the confirming file:line in `evidence`.

## Claim

Review dispositions for all 332 PSR-01C rows are approved: 81 keep, 249 remove, 2 migrate; `verify --require-reviewed-group psr-01c` passes; no code changed.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility.
