# PSR-01A raw contract inventory

Source revision: b5d158dad5e3f58e4b013ce37c2b6a106ec3a34a. Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`; working tree matches that commit).

Machine-readable companion: `raw-inventory.json` in this directory (3,588 rows: package, entrypoint, symbol, kind, disposition, consumers; top-level `manifestHashes`; `inventoryHash` `e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`). Every row carries initial disposition `unresolved`; classification belongs to PSR-01B..E, not this card. No package API was changed.

| Measurement | Value |
| --- | ---: |
| TypeScript roots | 46 |
| Declared root/subpath entrypoints | 137 |
| Root symbols | 2533 |
| Entrypoint occurrences | 3588 |
| Unique per-package symbols | 3020 |
| Duplicated names | 550 |

## Method

Generated mechanically from PSR-00's own `measureSurface()` and `discoverConsumers()` (`packages/openclinxr-verification/architecture-rules/src/checks/public-surface/resolve.ts`, `consumers.ts`). One TypeScript program over all declared entrypoint sources; module symbol table resolves named exports, aliases, `export *`, `export type *`, single-quoted specifiers, nested chains; runtime/type classified by the checker's aliased symbol flags. Consumer discovery covers static, dynamic, require, re-export, and reviewed computed access across `.ts/.tsx/.mts/.cts/.js/.mjs/.cjs` in `apps`, `packages`, `tools`, `docs`. Identifier search is a lead only; compiler resolution plus builds remain the proof.

## Per-entrypoint inventory (route, kind, consumers, compatibility evidence, manifest hash, disposition)

| Package | Entrypoint | Source | Symbols (runtime/type) | Consumer imports | Compatibility evidence | Manifest hash | Disposition |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| packages/openclinxr/agent-loop | . | packages/openclinxr/agent-loop/src/index.ts | 62 (48/14) | 0 | no in-repo import references this entrypoint | 0ba04221f54e | unresolved |
| packages/openclinxr/arena/iwsdk-spike | . | packages/openclinxr/arena/iwsdk-spike/src/index.ts | 101 (34/67) | 3 | referenced by 3 supported import(s) | f4c84df8a983 | unresolved |
| packages/openclinxr/arena/model-vetting | . | packages/openclinxr/arena/model-vetting/src/index.ts | 80 (38/42) | 24 | referenced by 24 supported import(s) | d6ec85e8147f | unresolved |
| packages/openclinxr/arena/multi-actor-state-spike | . | packages/openclinxr/arena/multi-actor-state-spike/src/index.ts | 44 (11/33) | 0 | no in-repo import references this entrypoint | b997c168690b | unresolved |
| packages/openclinxr/arena/physics-touch-contract | . | packages/openclinxr/arena/physics-touch-contract/src/index.ts | 108 (60/48) | 1 | referenced by 1 supported import(s) | 642bfd30c909 | unresolved |
| packages/openclinxr/asset-registry | . | packages/openclinxr/asset-registry/src/index.ts | 240 (119/121) | 96 | referenced by 96 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./accepted-scene-plan-evidence | packages/openclinxr/asset-registry/src/accepted-scene-plan-evidence.ts | 9 (3/6) | 2 | referenced by 2 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./actor-posture | packages/openclinxr/asset-registry/src/actor-posture.ts | 25 (22/3) | 0 | no in-repo import references this entrypoint | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./approach-executor | packages/openclinxr/asset-registry/src/approach-executor.ts | 7 (4/3) | 4 | referenced by 4 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./asset-writer | packages/openclinxr/asset-registry/src/asset-writer.ts | 8 (5/3) | 0 | no in-repo import references this entrypoint | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./bedside-approach-path | packages/openclinxr/asset-registry/src/bedside-approach-path.ts | 6 (4/2) | 1 | referenced by 1 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./case-actor-placements | packages/openclinxr/asset-registry/src/case-actor-placements.ts | 6 (3/3) | 2 | referenced by 2 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./case-approach-intent | packages/openclinxr/asset-registry/src/case-approach-intent.ts | 9 (3/6) | 10 | referenced by 10 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./case-frozen-scene-plans | packages/openclinxr/asset-registry/src/case-frozen-scene-plans.ts | 1 (1/0) | 2 | referenced by 2 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./case-owned-scene-plan | packages/openclinxr/asset-registry/src/case-owned-scene-plan.ts | 8 (4/4) | 2 | referenced by 2 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./case-runtime-equipment | packages/openclinxr/asset-registry/src/case-runtime-equipment.ts | 7 (6/1) | 2 | referenced by 2 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./cast-asset-constants | packages/openclinxr/asset-registry/src/cast-asset-constants.ts | 27 (27/0) | 2 | referenced by 2 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./encounter-bundle-admission | packages/openclinxr/asset-registry/src/encounter-bundle-admission.ts | 13 (9/4) | 6 | referenced by 6 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./environment-zone-templates | packages/openclinxr/asset-registry/src/environment-zone-templates.ts | 22 (21/1) | 5 | referenced by 5 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./fixture-wall-mounting | packages/openclinxr/asset-registry/src/fixture-wall-mounting.ts | 2 (1/1) | 5 | referenced by 5 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./frozen-scene-replay | packages/openclinxr/asset-registry/src/frozen-scene-replay.ts | 10 (6/4) | 2 | referenced by 2 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./initial-scene-contents | packages/openclinxr/asset-registry/src/initial-scene-contents.ts | 8 (1/7) | 4 | referenced by 4 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./layout-solve | packages/openclinxr/asset-registry/src/layout-solve.ts | 5 (3/2) | 2 | referenced by 2 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./layout-variation | packages/openclinxr/asset-registry/src/layout-variation.ts | 9 (6/3) | 4 | referenced by 4 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./measured-station-geometry-freshness | packages/openclinxr/asset-registry/src/measured-station-geometry-freshness.ts | 3 (2/1) | 4 | referenced by 4 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./object-store | packages/openclinxr/asset-registry/src/object-store.ts | 13 (7/6) | 0 | no in-repo import references this entrypoint | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./runtime-asset-review | packages/openclinxr/asset-registry/src/runtime-asset-review.ts | 18 (7/11) | 7 | referenced by 7 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./runtime-bundle-lookups | packages/openclinxr/asset-registry/src/runtime-bundle-lookups.ts | 4 (4/0) | 2 | referenced by 2 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./runtime-bundles | packages/openclinxr/asset-registry/src/runtime-bundles.ts | 71 (29/42) | 70 | referenced by 70 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/asset-registry | ./scene-plan-freeze | packages/openclinxr/asset-registry/src/scene-plan-freeze.ts | 7 (4/3) | 2 | referenced by 2 supported import(s) | cf94c0bb7202 | unresolved |
| packages/openclinxr/auth | . | packages/openclinxr/auth/src/index.ts | 15 (10/5) | 31 | referenced by 31 supported import(s) | 26240570cba3 | unresolved |
| packages/openclinxr/capability-gateway | . | packages/openclinxr/capability-gateway/src/index.ts | 47 (21/26) | 28 | referenced by 28 supported import(s) | 5cb73a260434 | unresolved |
| packages/openclinxr/config-rolldown | . | packages/openclinxr/config-rolldown/src/index.ts | 7 (4/3) | 2 | referenced by 2 supported import(s) | a200e45f56a3 | unresolved |
| packages/openclinxr/conversation-policy | . | packages/openclinxr/conversation-policy/src/index.ts | 59 (26/33) | 22 | referenced by 22 supported import(s) | ebd081cf2547 | unresolved |
| packages/openclinxr/data-mongodb | . | packages/openclinxr/data-mongodb/src/index.ts | 73 (44/29) | 0 | no in-repo import references this entrypoint | d3cd8948917b | unresolved |
| packages/openclinxr/data-sources-mongoose-models | . | packages/openclinxr/data-sources-mongoose-models/src/index.ts | 3 (2/1) | 0 | no in-repo import references this entrypoint | f96f2cf2a16c | unresolved |
| packages/openclinxr/domain | . | packages/openclinxr/domain/src/index.ts | 30 (25/5) | 19 | referenced by 19 supported import(s) | 10d21c5087e6 | unresolved |
| packages/openclinxr/domain | ./claim-language | packages/openclinxr/domain/src/claim-language.ts | 10 (6/4) | 12 | referenced by 12 supported import(s) | 10d21c5087e6 | unresolved |
| packages/openclinxr/exam-assembly | . | packages/openclinxr/exam-assembly/src/index.ts | 40 (20/20) | 45 | referenced by 45 supported import(s) | 516eca03370b | unresolved |
| packages/openclinxr/factory-stations | . | packages/openclinxr/factory-stations/src/index.ts | 44 (35/9) | 24 | referenced by 24 supported import(s) | 487f19d5805a | unresolved |
| packages/openclinxr/factory-stations | ./catalog | packages/openclinxr/factory-stations/src/catalog.ts | 11 (3/8) | 3 | referenced by 3 supported import(s) | 487f19d5805a | unresolved |
| packages/openclinxr/graphql | . | packages/openclinxr/graphql/src/index.ts | 20 (15/5) | 19 | referenced by 19 supported import(s) | 7148f229cd60 | unresolved |
| packages/openclinxr/graphql | ./client | packages/openclinxr/graphql/src/client.ts | 60 (18/42) | 15 | referenced by 15 supported import(s) | 7148f229cd60 | unresolved |
| packages/openclinxr/graphql | ./documents | packages/openclinxr/graphql/src/documents.ts | 3 (2/1) | 1 | referenced by 1 supported import(s) | 7148f229cd60 | unresolved |
| packages/openclinxr/model-gateway | . | packages/openclinxr/model-gateway/src/index.ts | 34 (13/21) | 20 | referenced by 20 supported import(s) | 06eee5942a82 | unresolved |
| packages/openclinxr/motion-compiler | . | packages/openclinxr/motion-compiler/src/index.ts | 76 (36/40) | 0 | no in-repo import references this entrypoint | d87b1c92eccc | unresolved |
| packages/openclinxr/motion-compiler | ./planted-red-manifest | packages/openclinxr/motion-compiler/src/planted-red-manifest.ts | 7 (4/3) | 1 | referenced by 1 supported import(s) | d87b1c92eccc | unresolved |
| packages/openclinxr/physics-touch-artifacts | . | packages/openclinxr/physics-touch-artifacts/src/index.ts | 7 (3/4) | 0 | no in-repo import references this entrypoint | e15866c5490d | unresolved |
| packages/openclinxr/rest | . | packages/openclinxr/rest/src/index.ts | 193 (105/88) | 79 | referenced by 79 supported import(s) | 224fa68aebb9 | unresolved |
| packages/openclinxr/review-workflow | . | packages/openclinxr/review-workflow/src/index.ts | 37 (19/18) | 50 | referenced by 50 supported import(s) | cb505b0694cd | unresolved |
| packages/openclinxr/review-workflow | ./accepted-scene-plan-review | packages/openclinxr/review-workflow/src/accepted-scene-plan-review.ts | 5 (3/2) | 0 | no in-repo import references this entrypoint | cb505b0694cd | unresolved |
| packages/openclinxr/scenario-fixtures | . | packages/openclinxr/scenario-fixtures/src/index.ts | 29 (25/4) | 81 | referenced by 81 supported import(s) | 29a9d149bd3a | unresolved |
| packages/openclinxr/scenario-fixtures | ./authored-utterance-record | packages/openclinxr/scenario-fixtures/src/authored-utterance-record.ts | 10 (8/2) | 2 | referenced by 2 supported import(s) | 29a9d149bd3a | unresolved |
| packages/openclinxr/scenario-fixtures | ./ed-chest-pain | packages/openclinxr/scenario-fixtures/src/ed-chest-pain.ts | 5 (4/1) | 17 | referenced by 17 supported import(s) | 29a9d149bd3a | unresolved |
| packages/openclinxr/scenario-fixtures | ./pediatric-asthma | packages/openclinxr/scenario-fixtures/src/pediatric-asthma.ts | 2 (2/0) | 3 | referenced by 3 supported import(s) | 29a9d149bd3a | unresolved |
| packages/openclinxr/scenario-fixtures | ./scenario-bank | packages/openclinxr/scenario-fixtures/src/scenario-bank.ts | 6 (4/2) | 23 | referenced by 23 supported import(s) | 29a9d149bd3a | unresolved |
| packages/openclinxr/scenario-runtime | . | packages/openclinxr/scenario-runtime/src/index.ts | 34 (12/22) | 37 | referenced by 37 supported import(s) | de1a9a3ddf7c | unresolved |
| packages/openclinxr/session-state | . | packages/openclinxr/session-state/src/index.ts | 54 (15/39) | 15 | referenced by 15 supported import(s) | 0542f673e74d | unresolved |
| packages/openclinxr/session-state | ./accepted-scene-plan | packages/openclinxr/session-state/src/accepted-scene-plan.ts | 9 (3/6) | 0 | no in-repo import references this entrypoint | 0542f673e74d | unresolved |
| packages/openclinxr/shared-schemas | . | packages/openclinxr/shared-schemas/src/index.ts | 75 (36/39) | 223 | referenced by 223 supported import(s) | 6d4cecff7de7 | unresolved |
| packages/openclinxr/telemetry | . | packages/openclinxr/telemetry/src/index.ts | 20 (8/12) | 14 | referenced by 14 supported import(s) | d3e7b089454f | unresolved |
| packages/openclinxr/test-harness | . | packages/openclinxr/test-harness/src/index.ts | 10 (3/7) | 0 | no in-repo import references this entrypoint | 4b9991f9323e | unresolved |
| packages/openclinxr/ui-route-admin | . | packages/openclinxr/ui-route-admin/src/index.ts | 277 (146/131) | 9 | referenced by 9 supported import(s) | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./actor-phenotype-fields | packages/openclinxr/ui-route-admin/src/actor-phenotype-fields.tsx | 2 (1/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./actor-touch-response-fields | packages/openclinxr/ui-route-admin/src/actor-touch-response-fields.tsx | 2 (1/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./admin-review-types | packages/openclinxr/ui-route-admin/src/admin-review-types.ts | 79 (0/79) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./asset-needs-panel | packages/openclinxr/ui-route-admin/src/asset-needs-panel.tsx | 1 (1/0) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./case-authoring-io | packages/openclinxr/ui-route-admin/src/case-authoring-io.ts | 5 (5/0) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./case-authoring-model | packages/openclinxr/ui-route-admin/src/case-authoring-model.ts | 25 (20/5) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./case-authoring-workbench | packages/openclinxr/ui-route-admin/src/case-authoring-workbench.tsx | 3 (1/2) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./dialogue-seed-authoring-panel | packages/openclinxr/ui-route-admin/src/dialogue-seed-authoring-panel.tsx | 26 (9/17) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./emotion-policy-panel | packages/openclinxr/ui-route-admin/src/emotion-policy-panel.tsx | 1 (1/0) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./encounter-bundle-promotion | packages/openclinxr/ui-route-admin/src/encounter-bundle-promotion/index.ts | 15 (9/6) | 4 | referenced by 4 supported import(s) | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./encounter-environment-panel | packages/openclinxr/ui-route-admin/src/encounter-environment-panel.tsx | 2 (1/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./environment-generation-queue-panel | packages/openclinxr/ui-route-admin/src/environment-generation-queue-panel.tsx | 7 (2/5) | 2 | referenced by 2 supported import(s) | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./environment-queue-readiness-summaries | packages/openclinxr/ui-route-admin/src/environment-queue-readiness-summaries.ts | 22 (22/0) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./equipment-panel | packages/openclinxr/ui-route-admin/src/equipment-panel.tsx | 1 (1/0) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./faculty-adjudication-workspace | packages/openclinxr/ui-route-admin/src/faculty-adjudication-workspace.tsx | 16 (12/4) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./faculty-compile-lock | packages/openclinxr/ui-route-admin/src/faculty-compile-lock.tsx | 15 (11/4) | 2 | referenced by 2 supported import(s) | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./faculty-compile-lock-types | packages/openclinxr/ui-route-admin/src/faculty-compile-lock-types.ts | 3 (0/3) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./faculty-review-decision-panel | packages/openclinxr/ui-route-admin/src/faculty-review-decision-panel.tsx | 2 (1/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./queue-review-snapshot-history | packages/openclinxr/ui-route-admin/src/queue-review-snapshot-history.tsx | 2 (1/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./review-replay-readiness-summary-panel | packages/openclinxr/ui-route-admin/src/review-replay-readiness-summary-panel.tsx | 2 (1/1) | 2 | referenced by 2 supported import(s) | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./review-replay-safety-panel | packages/openclinxr/ui-route-admin/src/review-replay-safety-panel.tsx | 2 (1/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./runtime-selection-review-packet-panel | packages/openclinxr/ui-route-admin/src/runtime-selection-review-packet-panel.tsx | 2 (1/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./scenario-authoring-preview | packages/openclinxr/ui-route-admin/src/scenario-authoring-preview/preview-authoring-revision.ts | 9 (6/3) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./scenario-authoring-workspace | packages/openclinxr/ui-route-admin/src/scenario-authoring-workspace.tsx | 3 (2/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./scenario-bank-maturity-panel | packages/openclinxr/ui-route-admin/src/scenario-bank-maturity-panel.tsx | 7 (6/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./scenario-review-gate-constants | packages/openclinxr/ui-route-admin/src/scenario-review-gate-constants.ts | 4 (3/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./scenario-review-gate-panel | packages/openclinxr/ui-route-admin/src/scenario-review-gate-panel.tsx | 14 (12/2) | 2 | referenced by 2 supported import(s) | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./seed-exam-readiness-boundary-panel | packages/openclinxr/ui-route-admin/src/seed-exam-readiness-boundary-panel.tsx | 2 (1/1) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./seed-worldview-queue | packages/openclinxr/ui-route-admin/src/seed-worldview-queue.tsx | 18 (12/6) | 5 | referenced by 5 supported import(s) | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-admin | ./status-view-model | packages/openclinxr/ui-route-admin/src/status-view-model.tsx | 4 (4/0) | 0 | no in-repo import references this entrypoint | b21a6847c8a5 | unresolved |
| packages/openclinxr/ui-route-shared | . | packages/openclinxr/ui-route-shared/src/index.ts | 12 (6/6) | 5 | referenced by 5 supported import(s) | b8bdd4d27e4f | unresolved |
| packages/openclinxr/ui-route-shared | ./admin-api-client | packages/openclinxr/ui-route-shared/src/admin-api-client.ts | 93 (4/89) | 0 | no in-repo import references this entrypoint | b8bdd4d27e4f | unresolved |
| packages/openclinxr/ui-route-shared | ./admin-api-client-types | packages/openclinxr/ui-route-shared/src/admin-api-client-types.ts | 89 (0/89) | 4 | referenced by 4 supported import(s) | b8bdd4d27e4f | unresolved |
| packages/openclinxr/ui-route-shared | ./compile-encounter-world | packages/openclinxr/ui-route-shared/src/compile-encounter-world.ts | 2 (2/0) | 2 | referenced by 2 supported import(s) | b8bdd4d27e4f | unresolved |
| packages/openclinxr/ui-route-shared | ./dialogue-seed-types | packages/openclinxr/ui-route-shared/src/dialogue-seed-types.ts | 14 (5/9) | 0 | no in-repo import references this entrypoint | b8bdd4d27e4f | unresolved |
| packages/openclinxr/ui-shared | . | packages/openclinxr/ui-shared/src/index.ts | 23 (13/10) | 5 | referenced by 5 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./actor-turn-replay-panel | packages/openclinxr/ui-shared/src/actor-turn-replay-panel.tsx | 5 (4/1) | 1 | referenced by 1 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./admin-compile-graph-canvas | packages/openclinxr/ui-shared/src/admin-compile-graph-canvas.tsx | 5 (2/3) | 9 | referenced by 9 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./admin-factory-station-cards | packages/openclinxr/ui-shared/src/admin-factory-station-cards.tsx | 2 (1/1) | 5 | referenced by 5 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./admin-runtime-posture | packages/openclinxr/ui-shared/src/admin-runtime-posture.ts | 7 (0/7) | 5 | referenced by 5 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./admin-string-list-field | packages/openclinxr/ui-shared/src/admin-string-list-field.tsx | 1 (1/0) | 2 | referenced by 2 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./admin-workbench-format | packages/openclinxr/ui-shared/src/admin-workbench-format.ts | 8 (8/0) | 0 | no in-repo import references this entrypoint | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./assembled-exam-replay-timeline | packages/openclinxr/ui-shared/src/assembled-exam-replay-timeline.tsx | 11 (5/6) | 13 | referenced by 13 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./emission-replay-bind-panel | packages/openclinxr/ui-shared/src/emission-replay-bind-panel.tsx | 8 (4/4) | 1 | referenced by 1 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./factory-run-progress-panel | packages/openclinxr/ui-shared/src/factory-run-progress-panel.tsx | 5 (1/4) | 2 | referenced by 2 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./factory-run-table-client | packages/openclinxr/ui-shared/src/factory-run-table-client.ts | 6 (1/5) | 2 | referenced by 2 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./faculty-disposition-codec | packages/openclinxr/ui-shared/src/faculty-disposition-codec.ts | 2 (2/0) | 0 | no in-repo import references this entrypoint | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./faculty-disposition-panel | packages/openclinxr/ui-shared/src/faculty-disposition-panel.tsx | 6 (5/1) | 2 | referenced by 2 supported import(s) | 39feafb539f9 | unresolved |
| packages/openclinxr/ui-shared | ./faculty-disposition-record | packages/openclinxr/ui-shared/src/faculty-disposition-record.ts | 13 (8/5) | 0 | no in-repo import references this entrypoint | 39feafb539f9 | unresolved |
| packages/openclinxr/voice-gateway | . | packages/openclinxr/voice-gateway/src/index.ts | 17 (9/8) | 29 | referenced by 29 supported import(s) | fabe9bb50da1 | unresolved |
| packages/openclinxr/xr-actor-dialogue | . | packages/openclinxr/xr-actor-dialogue/src/index.ts | 33 (23/10) | 2 | referenced by 2 supported import(s) | c4612488fdba | unresolved |
| packages/openclinxr/xr-asset-loading | . | packages/openclinxr/xr-asset-loading/src/index.ts | 30 (26/4) | 19 | referenced by 19 supported import(s) | b893fee5dded | unresolved |
| packages/openclinxr/xr-capture-evidence | . | packages/openclinxr/xr-capture-evidence/src/index.ts | 39 (37/2) | 9 | referenced by 9 supported import(s) | 40856a9ffab4 | unresolved |
| packages/openclinxr/xr-dialogue | . | packages/openclinxr/xr-dialogue/src/index.ts | 62 (45/17) | 28 | referenced by 28 supported import(s) | a67da3ecb575 | unresolved |
| packages/openclinxr/xr-exam-flow | . | packages/openclinxr/xr-exam-flow/src/index.ts | 18 (10/8) | 2 | referenced by 2 supported import(s) | e595f77d7b15 | unresolved |
| packages/openclinxr/xr-humanoid-animation | . | packages/openclinxr/xr-humanoid-animation/src/index.ts | 30 (19/11) | 18 | referenced by 18 supported import(s) | 5ed86196df7f | unresolved |
| packages/openclinxr/xr-humanoid-animation | ./case-owned-approach-runtime | packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime.ts | 10 (7/3) | 2 | referenced by 2 supported import(s) | 5ed86196df7f | unresolved |
| packages/openclinxr/xr-humanoid-animation | ./locomotion-clip-playback | packages/openclinxr/xr-humanoid-animation/src/locomotion-clip-playback.ts | 4 (4/0) | 2 | referenced by 2 supported import(s) | 5ed86196df7f | unresolved |
| packages/openclinxr/xr-humanoid-animation | ./mounted-approach-geometry | packages/openclinxr/xr-humanoid-animation/src/mounted-approach-geometry.ts | 2 (1/1) | 6 | referenced by 6 supported import(s) | 5ed86196df7f | unresolved |
| packages/openclinxr/xr-humanoid-animation | ./stance-lock | packages/openclinxr/xr-humanoid-animation/src/stance-lock.ts | 4 (2/2) | 0 | no in-repo import references this entrypoint | 5ed86196df7f | unresolved |
| packages/openclinxr/xr-humanoid-animation | ./station-bedside-approach | packages/openclinxr/xr-humanoid-animation/src/station-bedside-approach.ts | 9 (6/3) | 2 | referenced by 2 supported import(s) | 5ed86196df7f | unresolved |
| packages/openclinxr/xr-locomotion | . | packages/openclinxr/xr-locomotion/src/index.ts | 32 (24/8) | 6 | referenced by 6 supported import(s) | 146b08bb24e8 | unresolved |
| packages/openclinxr/xr-pose | . | packages/openclinxr/xr-pose/src/index.ts | 47 (44/3) | 24 | referenced by 24 supported import(s) | 133571e4bab6 | unresolved |
| packages/openclinxr/xr-pose | ./actor-floor-composition | packages/openclinxr/xr-pose/src/actor-floor-composition.ts | 13 (7/6) | 4 | referenced by 4 supported import(s) | 133571e4bab6 | unresolved |
| packages/openclinxr/xr-runtime-state | . | packages/openclinxr/xr-runtime-state/src/index.ts | 131 (80/51) | 108 | referenced by 108 supported import(s) | 853a48bf0064 | unresolved |
| packages/openclinxr/xr-runtime-state | ./bedside-approach-execution | packages/openclinxr/xr-runtime-state/src/bedside-approach-execution.ts | 8 (5/3) | 2 | referenced by 2 supported import(s) | 853a48bf0064 | unresolved |
| packages/openclinxr/xr-runtime-state | ./composed-body-direction | packages/openclinxr/xr-runtime-state/src/composed-body-direction.ts | 5 (5/0) | 2 | referenced by 2 supported import(s) | 853a48bf0064 | unresolved |
| packages/openclinxr/xr-runtime-wiring | . | packages/openclinxr/xr-runtime-wiring/src/index.ts | 13 (11/2) | 3 | referenced by 3 supported import(s) | ca04cc09c1c5 | unresolved |
| packages/openclinxr/xr-scene | . | packages/openclinxr/xr-scene/src/index.ts | 55 (47/8) | 51 | referenced by 51 supported import(s) | ddd01b4909e3 | unresolved |
| packages/openclinxr/xr-scene-cues | . | packages/openclinxr/xr-scene-cues/src/index.ts | 40 (24/16) | 5 | referenced by 5 supported import(s) | 3e9cd900a115 | unresolved |
| packages/openclinxr/xr-station | . | packages/openclinxr/xr-station/src/index.ts | 80 (62/18) | 68 | referenced by 68 supported import(s) | 18a2b69790e1 | unresolved |
| packages/openclinxr/xr-station-room | . | packages/openclinxr/xr-station-room/src/index.ts | 25 (7/18) | 6 | referenced by 6 supported import(s) | 2e0cc1c5431c | unresolved |
| packages/openclinxr/xr-station-room | ./station-environment-affect-cue | packages/openclinxr/xr-station-room/src/station-environment-affect-cue.ts | 1 (1/0) | 2 | referenced by 2 supported import(s) | 2e0cc1c5431c | unresolved |
| packages/openclinxr/xr-trace-readiness | . | packages/openclinxr/xr-trace-readiness/src/index.ts | 27 (26/1) | 8 | referenced by 8 supported import(s) | e8adbe272f64 | unresolved |

Symbol-level rows (all 3,588) live in `raw-inventory.json`. Each row carries `package`, `entrypoint`, `symbol`, `kind`, `disposition: unresolved`, and `consumers` (the {file, form} hits from `discoverConsumers()` importing that package entrypoint; empty list allowed). Per-symbol consumer attribution is at package-entrypoint granularity: an import references the package specifier, not an individual symbol. Symbol-to-consumer binding is PSR-01B..E review work.

Consumer coverage: 694 of 3,588 rows sit on entrypoints with zero consumer hits. Zero-consumer rows per package: packages/openclinxr/agent-loop 62/62; packages/openclinxr/arena/iwsdk-spike 0/101; packages/openclinxr/arena/model-vetting 0/80; packages/openclinxr/arena/multi-actor-state-spike 44/44; packages/openclinxr/arena/physics-touch-contract 0/108; packages/openclinxr/asset-registry 46/538; packages/openclinxr/auth 0/15; packages/openclinxr/capability-gateway 0/47; packages/openclinxr/config-rolldown 0/7; packages/openclinxr/conversation-policy 0/59; packages/openclinxr/data-mongodb 73/73; packages/openclinxr/data-sources-mongoose-models 3/3; packages/openclinxr/domain 0/40; packages/openclinxr/exam-assembly 0/40; packages/openclinxr/factory-stations 0/55; packages/openclinxr/graphql 0/83; packages/openclinxr/model-gateway 0/34; packages/openclinxr/motion-compiler 76/83; packages/openclinxr/physics-touch-artifacts 7/7; packages/openclinxr/rest 0/193; packages/openclinxr/review-workflow 5/42; packages/openclinxr/scenario-fixtures 0/52; packages/openclinxr/scenario-runtime 0/34; packages/openclinxr/session-state 9/63; packages/openclinxr/shared-schemas 0/75; packages/openclinxr/telemetry 0/20; packages/openclinxr/test-harness 10/10; packages/openclinxr/ui-route-admin 225/573; packages/openclinxr/ui-route-shared 107/210; packages/openclinxr/ui-shared 23/102; packages/openclinxr/voice-gateway 0/17; packages/openclinxr/xr-actor-dialogue 0/33; packages/openclinxr/xr-asset-loading 0/30; packages/openclinxr/xr-capture-evidence 0/39; packages/openclinxr/xr-dialogue 0/62; packages/openclinxr/xr-exam-flow 0/18; packages/openclinxr/xr-humanoid-animation 4/59; packages/openclinxr/xr-locomotion 0/32; packages/openclinxr/xr-pose 0/60; packages/openclinxr/xr-runtime-state 0/144; packages/openclinxr/xr-runtime-wiring 0/13; packages/openclinxr/xr-scene 0/55; packages/openclinxr/xr-scene-cues 0/40; packages/openclinxr/xr-station 0/80; packages/openclinxr/xr-station-room 0/26; packages/openclinxr/xr-trace-readiness 0/27. Consumer-form hits across the tree: static 917; dynamic 59; require 3; re-export 15; computed 566. 18 hits reference specifiers outside the 46-package scope or undeclared subpaths (fixtures, app-only packages) and are excluded from row attribution; see `evidence/psr-01a.md` for the list. Per-symbol consumer attribution is at package-entrypoint granularity above: a consumer import references the package specifier, not an individual symbol; symbol-to-consumer binding is PSR-01B..E review work.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility.
