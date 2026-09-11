# PSR-10 evidence - asset-registry and shared-schemas noRootAbove 50

Source revision: apply commit on `wt/bothy-tsk_88e388304dbf73ee`. Task: tsk_88e388304dbf73ee. Base: this worktree `1b43a8e7` (approval amendment RED).
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).
Independent grok-4.6 review session `01a09174-3a8e-72b3-90f9-92a59232f49f` rejected noRootAbove for asset-registry (58) and shared-schemas (56). Approval amendment is commit `1b43a8e7` (`psr-01d.json` / `psr-01e.json`). Machine-readable companion: `psr-10.json` in this directory.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-applied psr-05` - fail before change: on `1b43a8e7` asset-registry still published the 8 migrate names. Literal: `46 roots, 114 entrypoints, 1243 root symbols, 1484 occurrences, 1456 unique, 28 duplicated names (surface 8ea82b069725)`; `FAIL: group psr-05 not applied: extra: packages/openclinxr/asset-registry. publishes unapproved buildEncounterFactoryDryRunSummary` (and four more extras in the first five).
- `pnpm arch:public-surface:verify -- --require-applied psr-05` - pass after change (exit 0): `46 roots, 114 entrypoints, 1220 root symbols, 1461 occurrences, 1441 unique, 20 duplicated names (surface 6580727cf497)`; `ok: group psr-05 applied: 329 removed, 56 migrated`; `ok baseline ratchet: surface matches the checked-in baseline (no growth)`
- `pnpm arch:public-surface:verify -- --require-applied psr-08` - pass after change (exit 0): same surface line; `ok: group psr-08 applied: 694 removed, 45 migrated`
- `pnpm arch:public-surface:verify -- --require-all-reviewed` - pass: `ok: all review groups resolved`
- `pnpm --filter @openclinxr/asset-registry test` - pass: Test Files 19 passed (19); Tests 140 passed (140)
- `pnpm --filter @openclinxr/shared-schemas test` - pass: Test Files 4 passed (4); Tests 39 passed (39)
- `pnpm typecheck:relaxed` - pass (exit 0)
- `pnpm architecture` - pass: Test Files 18 passed (18); Tests 213 passed (213)
- `git diff --check` - pass: no whitespace errors
- `pnpm packages:typecheck:agent` / `pnpm packages:build:affected` / `pnpm packages:test:affected` - not run (orchestrator at land)

## Measured before and after

| | Before (`1b43a8e7`) | After |
| --- | ---: | ---: |
| roots | 46 | 46 |
| entrypoints | 114 | 114 |
| root symbols | 1,243 | 1,220 |
| occurrences | 1,484 | 1,461 |
| unique | 1,456 | 1,441 |
| duplicated names | 28 | 20 |
| asset-registry root | 58 | 50 |
| shared-schemas root | 56 | 41 |

Delta: -23 root symbols (8 migrate + 15 remove), -8 duplicated names (the 8 asset-registry names already published on a kept subpath).

## Dispositions this slice

| Package | Action | Root after |
| --- | --- | ---: |
| packages/openclinxr/asset-registry | 8 migrate | 50 |
| packages/openclinxr/shared-schemas | 15 remove | 41 |

asset-registry migrate destinations: `./approach-executor` 2 (`footSlideMeters`, `stepBedsideApproach`), `./runtime-asset-review` 1 (`promoteEncounterRuntimeAssetBundleForLocalUse`), `./runtime-bundles` 5 (`buildEncounterFactoryDryRunSummary`, `buildEncounterFactoryInputPlanningSummary`, `createEdChestPainLocalEncounterRuntimeAssetBundle`, `resolveRuntimeAssetBlobUrl`, `toLearnerRuntimeAssetBundle`).

shared-schemas remove: `ActorCardSchema`, `ActorPhenotypeSchema`, `ActorPlacementSchema`, `AssetKindSchema`, `AssetNeedSchema`, `CaseEmotionPolicySchema`, `EnvironmentSchema`, `ScenarioSchema`, `TouchResponseSchema`, `AssetKind`, `StationPhase`, `EmotionEventKind`, `EmotionTransitionRule`, `AssetManifest`, `DynamicEncounterFactoryPlanningProjection`. `export` keywords in `schemas.ts` / `schema-types.ts` / `runtime-schemas.ts` kept. No kept subpath publishes those 15 names.

Un-publish method: names dropped from `src/index.ts` barrels only. Implementations stayed. No namespace wrapping, facade, package split, or substitute.

## Consumer files moved

Import-line retargets only, including the package's own tests and relative-path tools:

- `packages/openclinxr/asset-registry/src/asset-registry.test.ts` → `@openclinxr/asset-registry/runtime-bundles` and `./runtime-asset-review`
- `packages/openclinxr/asset-registry/src/runtime-bundles.test.ts` → `@openclinxr/asset-registry/runtime-bundles`
- `packages/openclinxr/asset-registry/src/the-executor-arrives-and-feet-are-measured.test.ts` → `@openclinxr/asset-registry/approach-executor`
- `tools/openclinxr/evidence/asset-production-readiness-benchmark.ts` → `src/runtime-bundles-entry.js`
- `tools/openclinxr/evidence/foot-plant/bound-clip-foot-plant.ts` → `src/approach-executor.js`
- `tools/openclinxr/evidence/foot-plant/the-walk-clip-plants-its-feet.test.ts` → `src/approach-executor.js`
- `tools/openclinxr/evidence/licence/the-replacement-walk-preserves-approach-behaviour.ts` → `src/approach-executor.js`
- `tools/openclinxr/evidence/scene-closure/the-measurement-rubric-rejects-broken-controls.test.ts` → `src/approach-executor.js`

shared-schemas: no static import, `typeof import(...)`, or dynamic `import("@openclinxr/shared-schemas")` consumer of the 15 names. Two dynamic-import files mention a name in comments or import a kept name (`ProductionStationId`, `classifyScenarioEquipmentBinding`). Did not write a substitute.

## Ceilings before and after

| File | Before | After |
| --- | --- | --- |
| packages/openclinxr/asset-registry/arch-ceiling.json | testInternalImports 1, rootEntrypointExports 58 | testInternalImports 1, rootEntrypointExports 50 |
| packages/openclinxr/shared-schemas/arch-ceiling.json | testInternalImports 2, rootEntrypointExports 56 | testInternalImports 2, rootEntrypointExports 41 |

`pnpm arch:ceilings` rewrote 33 ceiling files; only these two changed content and were kept. `pnpm arch:index` updated only these two indexes.

## Claim

PSR-10 applies the independent criterion-6 review: 8 asset-registry root names migrated to kept subpaths (58→50) and 15 shared-schemas root names un-published (56→41). Implementations kept. `--require-applied psr-05` and `--require-applied psr-08` and `--require-all-reviewed` exit 0 after the change.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility. `packages:typecheck:agent`, `packages:build:affected`, and `packages:test:affected` are land-time orchestrator runs. `typeof` consumers and string-built `["@openclinxr/shared-schemas"].join("")` importers the review named as NOT TESTED: none found in `apps`, `packages`, `tools`.
