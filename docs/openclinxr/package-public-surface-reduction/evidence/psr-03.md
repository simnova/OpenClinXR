# PSR-03 evidence - narrow persistence, model, conversation, GraphQL, and motion leaves

Source revision: 967b4da40175f190837fdde0c009ca940d2b8de0. Task: tsk_1a927f3a1185d16c. Base: origin/main 8c6f127e474f400f2b75d45a9b573f5302c77397.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).
Approval manifest `../approvals/psr-01c.json` (332 rows: 119 keep, 211 remove, 2 migrate, as amended at land; `rawInventoryHash` `e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`; `groupHash` `a8bd55837e0db542cf66dee57048b6dbac253f7eb6e175e15c6919bf59c89b24`). Machine-readable companion: `psr-03.json` in this directory.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-applied psr-03` - pass (after the land amendments): 46 roots, 137 entrypoints, 2322 root symbols, 3345 occurrences, 2780 unique, 547 duplicated names (surface bd6307b0c20f); ok: group psr-03 applied: 211 removed, 2 migrated; ok baseline ratchet: surface matches the checked-in baseline (no growth)
- `pnpm packages:build:affected` - pass: Tasks: 52 successful, 52 total; Time: 8.729s
- `pnpm packages:typecheck:agent` - pass: Tasks: 100 successful, 100 total; Time: 6.293s
- `pnpm packages:test:affected` - fail (OUT-OF-SCOPE, pre-existing, unrelated to this diff): exit 1, Tasks: 90 successful, 100 total; sole failing package is @openclinxr/model-vetting-studio (3 failed of 11 files; Tests 25 passed, 1 skipped). Literal lines: FAIL src/candidate-capture.test.ts; FAIL src/the-evidence-record-names-the-clip-that-played.test.ts; Error: Denied ID AGENTS.md?url; FAIL src/pipeline-admin/pipeline-admin-data.test.ts; TypeError: The URL must be of scheme file at pipeline-admin-data.test.ts:21:16. In-scope in the same run: api 20/191 (direct rerun), conversation-policy 8/88, graphql 3/11, model-gateway 5/22, motion-compiler 19/113, rest 9/53, scenario-runtime 12/114, xr-dialogue 6/29. Studio imports none of the 5 narrowed packages and no studio file is in this diff.
- `git diff --check` - pass: no whitespace errors

## Measured before and after

Before (compiler-derived on base): 46 roots, 137 entrypoints, 2,533 root symbols, 3,588 occurrences, 3,020 unique, 550 duplicated names. After (this tree): 46 roots, 137 entrypoints, 2,322 root symbols, 3,345 occurrences, 2,780 unique, 547 duplicated names. Delta: -211 root symbols, -243 occurrences, -240 unique, -3 duplicated names. Group gate: 211 removed, 2 migrated.

## Dispositions per package

| Package | Keep | Remove | Migrate | Root after |
| --- | ---: | ---: | ---: | ---: |
| packages/openclinxr/data-mongodb | 27 | 46 | 0 | 27 |
| packages/openclinxr/motion-compiler | 9 | 74 | 0 | 2 |
| packages/openclinxr/conversation-policy | 27 | 32 | 0 | 27 |
| packages/openclinxr/model-gateway | 11 | 23 | 0 | 11 |
| packages/openclinxr/graphql | 39 | 42 | 2 | 9 |

Removed-kind split per package (runtime/type): packages/openclinxr/conversation-policy 15R/17T; packages/openclinxr/data-mongodb 44R/29T; packages/openclinxr/graphql 18R/25T; packages/openclinxr/model-gateway 7R/16T; packages/openclinxr/motion-compiler 36R/40T.

## Removed symbols (211, from approvals/psr-01c.json as amended)

Full exact list is in `psr-03.json` (`removed`). By package: data-mongodb 46; motion-compiler root 74 (plus `./planted-red-manifest` keeps 7); conversation-policy 32; model-gateway 17; graphql root 10 + ./client 32.

## Migrated symbols (2)

- `adminGraphqlDocumentByOperationName`: `@openclinxr/graphql` root -> `@openclinxr/graphql/documents` (`packages/openclinxr/graphql/src/documents.js`). Signature `(operationName: string) => AdminGraphqlDocument`, identical; body verbatim.
- `adminGraphqlDocuments`: `@openclinxr/graphql` root -> `@openclinxr/graphql/documents`. Same array re-export, identical.
- The `./documents` subpath pre-existed in `package.json#exports`; no new subpath invented, no facade indirection.

## Consumer files moved (every file)

- `apps/api/src/api-bootstrap.test.ts`: `@openclinxr/graphql` -> `@openclinxr/graphql/documents` (adminGraphqlDocumentByOperationName)
- `apps/api/src/app.test.ts`: `@openclinxr/graphql` -> `@openclinxr/graphql/documents` (adminGraphqlDocumentByOperationName)
- `apps/api/src/the-api-refuses-stale-scenario-review-identity.test.ts`: `@openclinxr/graphql` -> `@openclinxr/graphql/documents` (adminGraphqlDocumentByOperationName)
- `apps/api/src/the-persisted-scene-reaches-the-normal-xr-consumer.test.ts`: `@openclinxr/graphql` -> `@openclinxr/graphql/documents` (adminGraphqlDocumentByOperationName)
- `packages/openclinxr/data-mongodb/src/api-persistence-sink.integration.test.ts`: `@openclinxr/graphql` -> `@openclinxr/graphql/documents` (adminGraphqlDocumentByOperationName)
- `packages/openclinxr/rest/src/routes/admin-graphql-routes.ts`: `@openclinxr/graphql` -> `@openclinxr/graphql/documents` (adminGraphqlDocuments)
- `packages/openclinxr/rest/src/scenario-promotion-io.ts`: `@openclinxr/graphql` -> `@openclinxr/graphql/documents` (adminGraphqlDocumentByOperationName)
- `packages/openclinxr/data-mongodb/src/exam-run-ledger.test.ts`: imports through `./index.js` (createExamRunLedger, examRunLedgerClaimBoundary, examRunLedgerNotEvidenceFor, MemoryExamRunLedger, createMongoExamPersistence, CanonicalPhaseEventAdmission, OpenExamRunInput)
- `packages/openclinxr/data-mongodb/src/mongodb-repositories.integration.test.ts`: imports through `./index.js` (createMongoApiPersistenceSink, createMongoDurableMultiActorSessionStore, MongoDurableClinicalEventRepository, MongoDurableConversationTurnRepository, MongoDurableEmotionalStateTimelineRepository, MongoEncounterMaterializationEvidenceRepository, MongoExamFormRepository, MongoRuntimeAssetBundleRepository, MongoStationRunQueueRepository, MongoFacultyScoreDraftRepository, MongoReviewPacketRepository, MongoScenarioRepository, MongoScenarioReviewDecisionRepository, MongoTraceRepository, durableActorTurnPersistenceScope, durableClinicalEventPersistenceScope, saveLearnerRuntimeAssetBundleFromGeneratedReport, EncounterMaterializationEvidenceRecord, ScenarioReviewDecisionRecord; keeps the `(candidate): candidate is EncounterRuntimeAsset` noShadow rename)
- `packages/openclinxr/data-mongodb/src/api-persistence-sink.integration.test.ts`: imports through `./index.js` (createMongoApiPersistenceSink)
- `packages/openclinxr/graphql/src/admin-graphql.test.ts`: `buildAdminGraphqlSchema` through `./index.js`; `adminGraphqlDocumentByOperationName, adminGraphqlDocuments` through the declared `./documents` subpath (public entrypoint, does not count as internal)
- `packages/openclinxr/graphql/src/the-faculty-disposition-contract-is-append-only.test.ts`: `buildAdminGraphqlSchema, executeAdminGraphql` through `./index.js`
- `packages/openclinxr/graphql/src/the-review-packet-replay-includes-actor-turn-layers.test.ts`: `buildAdminGraphqlSchema, executeAdminGraphql` through `./index.js`; `adminGraphqlDocumentByOperationName` through `./documents`
- `packages/openclinxr/model-gateway/src/model-gateway.test.ts`: unchanged from origin/main; imports through `./index.js`, which re-publishes buildActorCommunicationProfilePromptContext, buildActorResponseProviderPromptInput and the three local-provider factories from their new modules (actor-prompt.ts, local-providers.ts)
- `packages/openclinxr/model-gateway/src/mock-adapter.ts`: `./index.js (GuardrailResult type)` -> `./model-gateway-internal.js` (GuardrailResult)
- `packages/openclinxr/model-gateway/src/openai-compatible-adapter.ts`: `./index.js (ActorCommunicationProfileContext, GuardrailResult types)` -> `./model-gateway-internal.js` (ActorCommunicationProfileContext, GuardrailResult)
- `packages/openclinxr/model-gateway/src/deepseek-actor-thinking-is-disabled.test.ts`: unchanged from origin/main; OpenAiCompatibleModelProviderAdapter through `./index.js`
- `packages/openclinxr/model-gateway/src/muse-spark-sends-no-reasoning.test.ts`: unchanged from origin/main; OpenAiCompatibleModelProviderAdapter through `./index.js`
- `packages/openclinxr/model-gateway/src/openai-compatible-adapter.test.ts`: unchanged from origin/main; the adapter through the `./index.js` namespace
- `packages/openclinxr/motion-compiler/src/the-compiler-surface-carries-region-and-effector.test.ts`: `./index.js` -> `./primitive-registry.js + ./compile-motion-program.js + ./derive-skeleton-profile.js` (primitive registry surface)
- `packages/openclinxr/motion-compiler/src/the-four-response-kinds-are-four-behaviours.test.ts`: `./index.js` -> `./primitive-registry.js + ./program/response-kind-to-primitive.js` (response-kind primitive surface)

## Files outside the card write roots (read-only from this card) 

The previous session edited 4 files under `tools/` which are outside this card write roots. Each replacement is behaviour-identical (verified by diffing origin/main against HEAD):

- `tools/openclinxr/evidence/authored-exam-reaches-learner.ts`: adminGraphqlDocumentByOperationName from graphql root (packages/openclinxr/graphql/src/index.js) replaced by adminGraphqlDocumentByOperationName from packages/openclinxr/graphql/src/documents.js. Input types identical: true; return types identical: true; behaviour-identical: true. Same function body moved verbatim; root re-export deleted, documents.js implementation unchanged: (operationName: string) => AdminGraphqlDocument; throws on unknown operation.
- `tools/openclinxr/evidence/faculty-review-gate.ts`: adminGraphqlDocumentByOperationName from graphql root (packages/openclinxr/graphql/src/index.js) replaced by adminGraphqlDocumentByOperationName from packages/openclinxr/graphql/src/documents.js. Input types identical: true; return types identical: true; behaviour-identical: true. Same function body moved verbatim; signature and throw behavior unchanged.
- `tools/openclinxr/evidence/promotion-path-reaches-learner.ts`: adminGraphqlDocumentByOperationName from graphql root (packages/openclinxr/graphql/src/index.js) replaced by adminGraphqlDocumentByOperationName from packages/openclinxr/graphql/src/documents.js. Input types identical: true; return types identical: true; behaviour-identical: true. Same function body moved verbatim; signature and throw behavior unchanged.
- `tools/openclinxr/api-mongo-boot.ts`: createMongoApiPersistenceSink + MongoClient from data-mongodb root (packages/openclinxr/data-mongodb/src/index.js) replaced by createMongoApiPersistenceSink from packages/openclinxr/data-mongodb/src/persistence-sink.js; MongoClient resolved from the data-mongodb-owned mongodb dependency via createRequire. Input types identical: true; return types identical: true; behaviour-identical: true. createMongoApiPersistenceSink(db: Db) implementation unchanged at persistence-sink.ts:241 on both revisions; MongoClient was a bare re-export of the mongodb driver class, now resolved from the same package-owned copy; boot wiring (connect/db/close/sink) unchanged.

No replacement is behaviour-divergent. No stop condition triggered.

## Retained exceptions

None beyond keep rows (83 keep rows name the consuming package with file:line evidence in the approval manifest). No compatibility contract without an in-repo consumer was claimed.

## Claim

PSR-03 applies PSR-01C as amended at land: 211 root exports removed, 2 graphql document symbols migrated from root to the existing ./documents subpath, 32 symbols re-kept (25 data-mongodb, 6 model-gateway, and buildAdminGraphqlSchema) because each is imported by its own package's tests through `./index.js` on origin/main (plan lines 83 and 92 count tests as consumers), implementations kept, all in-repo consumers moved to kept routes, verify/build/typecheck green.

## Re-kept at land (32)

Per the amended approval rows (owner = consuming test, evidence = file:line on origin/main de2d1ba7): CanonicalPhaseEventAdmission, createExamRunLedger, createMongoExamPersistence, examRunLedgerClaimBoundary, examRunLedgerNotEvidenceFor, MemoryExamRunLedger, OpenExamRunInput (exam-run-ledger.test.ts:3); createMongoDurableMultiActorSessionStore, durableActorTurnPersistenceScope, durableClinicalEventPersistenceScope, EncounterMaterializationEvidenceRecord, MongoDurableClinicalEventRepository, MongoDurableConversationTurnRepository, MongoDurableEmotionalStateTimelineRepository, MongoEncounterMaterializationEvidenceRepository, MongoExamFormRepository, MongoFacultyScoreDraftRepository, MongoReviewPacketRepository, MongoRuntimeAssetBundleRepository, MongoScenarioRepository, MongoScenarioReviewDecisionRepository, MongoStationRunQueueRepository, MongoTraceRepository, saveLearnerRuntimeAssetBundleFromGeneratedReport, ScenarioReviewDecisionRecord (mongodb-repositories.integration.test.ts:17); buildAdminGraphqlSchema (admin-graphql.test.ts:4 and both faculty/review-packet graphql tests). `createMongoApiPersistenceSink` and `MongoClient` were already keep rows (tools/openclinxr/api-mongo-boot.ts compatibility contract) and stay published.

model-gateway (added in the second land pass; evidence on origin/main 1547ed88): buildActorCommunicationProfilePromptContext, buildActorResponseProviderPromptInput, createLlamaCppModelProviderAdapter, createMlxModelProviderAdapter, createOllamaModelProviderAdapter (model-gateway.test.ts:3); OpenAiCompatibleModelProviderAdapter (deepseek-actor-thinking-is-disabled.test.ts:2, muse-spark-sends-no-reasoning.test.ts:2, openai-compatible-adapter.test.ts namespace). Un-publishing them had raised model-gateway from 0 test internal imports on origin/main to 4, with a new ceiling of 4; that raise is withdrawn.

## Ceilings before and after (all equal or lower; regenerated with `pnpm arch:ceilings`, index with `pnpm arch:index`)

| File | Before (origin/main) | After (this tree) |
| --- | --- | --- |
| packages/openclinxr/conversation-policy/arch-ceiling.json | testInternalImports 14, rootEntrypointExports 59 | testInternalImports 14, rootEntrypointExports 27 |
| packages/openclinxr/data-mongodb/arch-ceiling.json | testInternalImports 5, rootEntrypointExports 73, starExports 12 | testInternalImports 3, rootEntrypointExports 27, starExports 2 |
| packages/openclinxr/graphql/arch-ceiling.json | testInternalImports 3 | testInternalImports 3 |
| packages/openclinxr/model-gateway/arch-ceiling.json | rootEntrypointExports 34 | deleted by `pnpm arch:ceilings`: every field within the default budget (testInternalImports 0) |
| packages/openclinxr/motion-compiler/arch-ceiling.json | testInternalImports 27, rootEntrypointExports 76, starExports 7 | testInternalImports 7 |

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility.

NOT TESTED: Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility (per card NOT TESTED).

## Orchestrator amendment at land (2026-09-11)

The worker's replacement for tools/openclinxr/api-mongo-boot.ts reached into `packages/openclinxr/data-mongodb/node_modules/mongodb` through createRequire and a type import from that package's node_modules. That is behaviour-identical today and breaks the moment pnpm's layout changes. The root index on main documented the `MongoClient` re-export as existing for tools composition roots, because bare `mongodb` does not resolve from tools/ under pnpm; the review's package-specifier consumer scan could not see the relative-path importer. So `createMongoApiPersistenceSink` and `MongoClient` stay published from data-mongodb as a deliberate compatibility contract (owner tools/openclinxr/api-mongo-boot.ts), two rows of approvals/psr-01c.json change from remove to keep, and api-mongo-boot.ts is left as it is on main. Applied totals become 245 removed and 2 migrated.

A second amendment at land: un-publishing `planMotionProgram` and `ScenarioMotionCompileInput` left `packages/openclinxr/motion-compiler/src/deterministic-scenario-motion-planner.ts` unreferenced, and the Knip gate refused the commit. `planMotionProgram` is the deterministic planner entry named in docs/openclinxr/motion-dsl-consumer-path-2026-09-02.md, which the planned motion-bake cards consume, so both names stay published from the motion-compiler root as a compatibility contract owned by that document. Applied totals become 243 removed and 2 migrated.
