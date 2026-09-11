# PSR-05 evidence - asset-registry apply across the A-to-B consumer seam

Source revision: `601be899c8203946db11aab3b460124719ac7aa3`. Task: tsk_71a17af99c7db421. Base: origin/main `26d5aab5`.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).
Approval manifest `../approvals/psr-01d.json` asset-registry subset (157 keep, 333 remove, 48 migrate, as amended at `26d5aab5`; `rawInventoryHash` `e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`; `groupHash` `21f46d05a61ca2639359ddbf9b80cbebf4c6e5e0932e15603fd7ee71ec593e3f`). Machine-readable companion: `psr-05.json` in this directory.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-applied psr-05` - fail before change: on origin/main `26d5aab5` the asset-registry package still published the 333 remove names, so the apply gate cannot pass. Card known-good: 46 roots, 137 entrypoints, 2,533 root symbols, 3,588 occurrences, 3,020 unique, 550 duplicated names.
- `pnpm arch:public-surface:verify -- --require-applied psr-05` - pass after change (exit 0): 46 roots, 137 entrypoints, 2037 root symbols, 2865 occurrences, 2435 unique, 415 duplicated names (surface d5383823dce8); ok: group psr-05 applied: 333 removed, 48 migrated; ok baseline ratchet: surface matches the checked-in baseline (no growth)
- `pnpm --filter @openclinxr/asset-registry test` - pass: Test Files 19 passed (19); Tests 140 passed (140)
- `pnpm --filter @openclinxr/api test` - pass: Test Files 20 passed (20); Tests 192 passed (192)
- `pnpm --filter @openclinxr/ui-xr test` - pass: Test Files 19 passed (19); Tests 130 passed (130)
- `pnpm typecheck:relaxed` - pass
- `pnpm architecture` - pass after `pnpm arch:index`: Test Files 17 passed (17); Tests 199 passed (199)
- `git diff --check` - pass: no whitespace errors
- `pnpm packages:typecheck:agent` / `pnpm packages:build:affected` / `pnpm packages:test:affected` - not re-run this turn (orchestrator at land). Earlier this session: typecheck:agent 100/100; build:affected 44/44; test:affected failed two ui-xr tests that `163b2782` fixes.

## Measured before and after

Before (origin/main after PSR-04, `psr-04.json` measuredAfter): 46 roots, 137 entrypoints, 2,223 root symbols, 3,246 occurrences, 2,681 unique, 547 duplicated names. After: 46 roots, 137 entrypoints, 2,037 root symbols, 2,865 occurrences, 2,435 unique, 415 duplicated names. Delta vs that start: -186 root symbols, -381 occurrences, -246 unique, -132 duplicated names. Group gate: 333 removed, 48 migrated.

## Dispositions per package

| Package | Keep | Remove | Migrate | Root after |
| --- | ---: | ---: | ---: | ---: |
| packages/openclinxr/asset-registry | 157 | 333 | 48 | 54 |

Removed-kind split: 148 runtime / 185 type. Migrated-kind split: 32 runtime / 16 type. Migrate destinations: `./runtime-bundles` 24, `./actor-posture` 13, `./runtime-asset-review` 7, `./runtime-bundle-lookups` 3, `./bedside-approach-path` 1. Full exact lists are in `psr-05.json` (`removed`, `migrated`).

Un-publish method: keep-only barrels at declared subpaths; implementations stay in `*-mod.ts` (or `runtime-bundles.ts` under its file-size freeze, with `runtime-bundles-entry.ts` as the keep-only `./runtime-bundles` target). `export` keywords in defining modules were restored. No namespace wrapping, facade indirection, package splitting, or subpath relocation of published names.

## Consumer files moved

Migrate rows: consumers of the 48 names moved from `@openclinxr/asset-registry` root to the named existing subpaths (`./runtime-bundles`, `./actor-posture`, `./runtime-asset-review`, `./runtime-bundle-lookups`, `./bedside-approach-path`) in the same change. In-scope files include `apps/ui-xr/src/main.ts`, xr-pose / xr-runtime-state / xr-scene / rest / ui-route-* / ui-route-admin, and xr-station's two-copies test (`findRuntimeEquipmentAsset` on `./runtime-bundle-lookups` plus `sceneManifest.equipmentPlacements`; the removed `findRuntimeEquipmentPlacementByRealizedId` has no keep replacement).

Relative-path tools that imported `src/index.ts` for migrated names now import `src/runtime-bundles-entry.ts` or the keep subpath file. Factory import-line edits only: keep names through those entries; `EncounterAssetNeedsReadinessManifest` became `ReturnType<typeof buildEncounterAssetNeedsReadinessManifest>` (keep on root). `writeEncounterRuntimeAssetBundle` and `createAzuriteAssetObjectStore` have no keep row; factory points at `asset-writer-mod.ts` / `object-store-mod.ts` and those names stay unpublished.

Apps/ui-xr and apps/api non-test source: import-line retargets only (net-zero line budget held by collapsing rest/ui-route-shared freeze overruns from extra import lines).

## Retained exceptions

Amendment `26d5aab5` keeps 19 destination names that a root `migrate` had already routed to `./actor-posture`, `./runtime-asset-review`, and `./runtime-bundles` while the subpath row said `remove`. They stay published. `testInternalImports` stays 1 (`encounter-bundle-promotion.test.ts` → `./encounter-bundle-promotion.js`).

## Ceilings before and after

| File | Before (origin/main) | After |
| --- | --- | --- |
| packages/openclinxr/asset-registry/arch-ceiling.json | testInternalImports 1, rootEntrypointExports 240, starExports 8 | testInternalImports 1, rootEntrypointExports 54 |

`starExports` omitted: measured 0, at or below origin/main. Index regenerated with `pnpm arch:index` (`packages/openclinxr/asset-registry/arch-index.json` only).

## Claim

PSR-05 applies PSR-01D asset-registry subset as amended at 26d5aab5: 333 names un-published, 48 migrated from root to existing subpaths, 157 keep names remain published (54 at root). Implementations kept. `--require-applied psr-05` exits 0 after the change.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility. `packages:typecheck:agent`, `packages:build:affected`, and `packages:test:affected` are land-time orchestrator runs on this turn. `writeEncounterRuntimeAssetBundle` and `createAzuriteAssetObjectStore` have no keep route and are reached only from tools via unpublished implementation modules.

## Orchestrator amendment at land (2026-09-11)

Four root names stay published: `evaluateScenarioAssetBudget`, `ScenarioAssetBudget`, `ScenarioGenerationEvidence`, `ScenarioOptimizationEvidence`. `tools/openclinxr/evidence/asset-production-readiness-benchmark.ts` and `the-readiness-verdict-reads-measured-geometry.test.ts` import them from the package root, and plan line 92 counts tools as consumers. The apply worker had replaced the function with a locally written wrapper around `InMemoryAssetRegistry`, which the brief forbids; both files are back to their origin/main imports. Approval psr-01d rows amended to keep.

`46 roots, 137 entrypoints, 2041 root symbols, 2869 occurrences, 2439 unique, 415 duplicated names (surface c5327ea69039)`; `ok: group psr-05 applied: 329 removed, 48 migrated`
