# PSR-07 evidence - apply bounded XR runtime interfaces

Source revision: `3663acdd1ab0f140c3c25d8e99d8900fb92034d4`. Task: tsk_33fd77bc3512d46f. Base: origin/main `3663acdd`.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).
Approval manifest `../approvals/psr-01e.json` seven-package subset (keep/remove/migrate as amended, including the 115 test-consumer keeps of `cc3da7f3`; `rawInventoryHash` `e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`; `groupHash` `7e8b0ae8c2ea0bfc39e7f8a0a622a350d6be58ac52fba2b47fade6a1ba224664`). Machine-readable companion: `psr-07.json` in this directory.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-applied psr-07` - fail before change: on origin/main `3663acdd` the seven XR packages still published the 115 remove names. First measured fail (truncated to 5): extra `DIALOGUE_PRONUNCIATIONS`, `JAW_OPEN_TEETH_CLEAR_RADIANS`, `MorphRootLike`, `NamedVisemeDriveResult`, `VisemeFrame` on `packages/openclinxr/xr-dialogue.`. Card known-good: 46 roots, 137 entrypoints, 2,533 root symbols, 3,588 occurrences, 3,020 unique, 550 duplicated names.
- `pnpm arch:public-surface:verify -- --require-applied psr-07` - pass after change (exit 0): 46 roots, 137 entrypoints, 1959 root symbols, 2753 occurrences, 2326 unique, 412 duplicated names (surface 3311da409553); ok: group psr-07 applied: 115 removed, 1 migrated; ok baseline ratchet: surface matches the checked-in baseline (no growth)
- `pnpm --filter @openclinxr/xr-runtime-state test` - pass: Test Files 5 passed (5); Tests 82 passed (82)
- `pnpm --filter @openclinxr/xr-station test` - pass: Test Files 6 passed (6); Tests 41 passed (41)
- `pnpm --filter @openclinxr/xr-pose test` - pass: Test Files 1 passed (1); Tests 4 passed (4)
- `pnpm --filter @openclinxr/xr-locomotion test` - pass: Test Files 1 passed (1); Tests 15 passed (15)
- `pnpm --filter @openclinxr/xr-dialogue test` - pass: Test Files 6 passed (6); Tests 29 passed (29)
- `pnpm --filter @openclinxr/xr-scene test` - pass: Test Files 8 passed (8); Tests 67 passed (67)
- `pnpm --filter @openclinxr/xr-humanoid-animation test` - pass: Test Files 4 passed (4); Tests 16 passed (16)
- `pnpm --filter @openclinxr/ui-xr test` - pass: Test Files 19 passed (19); Tests 130 passed (130)
- `pnpm typecheck:relaxed` - pass
- `pnpm architecture` - pass after `pnpm arch:index` and `pnpm arch:ceilings`: Test Files 17 passed (17); Tests 199 passed (199)
- `pnpm hygiene:knip` - pass
- `git diff --check` - pass: no whitespace errors
- `pnpm packages:typecheck:agent` / `pnpm packages:build:affected` / `pnpm packages:test:affected` - not re-run this turn (orchestrator at land)

## Measured before and after

Before (origin/main after PSR-05, `psr-05.json` measuredAfter): 46 roots, 137 entrypoints, 2,041 root symbols, 2,869 occurrences, 2,439 unique, 415 duplicated names. After: 46 roots, 137 entrypoints, 1,959 root symbols, 2,753 occurrences, 2,326 unique, 412 duplicated names. Delta vs that start: -82 root symbols, -116 occurrences, -113 unique, -3 duplicated names. Group gate: 115 removed, 1 migrated.

## Dispositions per package

| Package | Keep | Remove | Migrate | Root after |
| --- | ---: | ---: | ---: | ---: |
| packages/openclinxr/xr-runtime-state | 127 | 17 | 0 | 119 |
| packages/openclinxr/xr-station | 70 | 10 | 0 | 70 |
| packages/openclinxr/xr-scene | 38 | 17 | 0 | 38 |
| packages/openclinxr/xr-dialogue | 47 | 15 | 0 | 47 |
| packages/openclinxr/xr-locomotion | 27 | 5 | 0 | 27 |
| packages/openclinxr/xr-pose | 34 | 25 | 1 | 32 |
| packages/openclinxr/xr-humanoid-animation | 33 | 26 | 0 | 22 |

Full exact lists are in `psr-07.json` (`removed`, `migrated`).

Un-publish method: names dropped from `src/index.ts` barrels. Subpath defining modules moved to `*-mod.ts` with keep-only barrels at the declared export-map path (PSR-05 pattern). `export` keywords in defining modules were not removed. No namespace wrapping, facade indirection, package splitting, or subpath relocation of published names.

## Consumer files moved

Migrate row: `describeRuntimeBundleScenarioMatch` left `./actor-floor-composition` and stays on `@openclinxr/xr-pose` root (already a keep there). Internal production imports that needed unpublished subpath names now import `*-mod.ts` (`case-owned-approach-runtime-mod`, `stance-lock-mod`, `station-bedside-approach-mod`). `actor-floor-composition.test.ts` dynamically loads the implementation module. apps/ui-xr non-test source: no import-line retargets (net-zero line budget held).

Relative-path tools that imported `xr-station/src/index.ts` already used keep names (`buildStationEnvironment`, `createAssembledStationApiClient`). `tools/openclinxr/evidence/cast-identity-ssot.ts` already imported `bankPatientDisplayNameForScenario` from `initial-dialogue-text.ts`, not the package root.

## Retained exceptions

xr-runtime-state root 119 and xr-station root 70 remain above the plan's 50-root review target; PSR-01E recorded those as exceptions. Keep rows include the 115 test-consumer keeps amended at `cc3da7f3` (group-wide); this card applies only the seven-package subset. `xr-humanoid-animation` `./stance-lock` keep=0: empty barrel remains as the declared subpath; implementation stays in `stance-lock-mod.ts`. `rootEntrypointExports` omitted from xr-humanoid-animation's ceiling: measured 22, at or below the default budget of 25.

## Ceilings before and after

| File | Before (origin/main) | After |
| --- | --- | --- |
| packages/openclinxr/xr-runtime-state/arch-ceiling.json | testInternalImports 3, rootEntrypointExports 131 | testInternalImports 3, rootEntrypointExports 119 |
| packages/openclinxr/xr-station/arch-ceiling.json | testInternalImports 4, rootEntrypointExports 80 | testInternalImports 4, rootEntrypointExports 70 |
| packages/openclinxr/xr-scene/arch-ceiling.json | testInternalImports 5, rootEntrypointExports 55 | testInternalImports 5, rootEntrypointExports 38 |
| packages/openclinxr/xr-dialogue/arch-ceiling.json | testInternalImports 5, rootEntrypointExports 62 | testInternalImports 5, rootEntrypointExports 47 |
| packages/openclinxr/xr-locomotion/arch-ceiling.json | testInternalImports 2, rootEntrypointExports 32 | testInternalImports 2, rootEntrypointExports 27 |
| packages/openclinxr/xr-pose/arch-ceiling.json | rootEntrypointExports 47 | rootEntrypointExports 32 |
| packages/openclinxr/xr-humanoid-animation/arch-ceiling.json | testInternalImports 3, rootEntrypointExports 30 | testInternalImports 3 (rootEntrypointExports omitted; measured 22) |

Indexes regenerated with `pnpm arch:index` for the seven packages.

## Claim

PSR-07 applies PSR-01E core XR subset as amended: 115 names un-published, 1 migrated from `./actor-floor-composition` to `.`, keep names remain published. Implementations kept. `--require-applied psr-07` exits 0 after the change.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility. `packages:typecheck:agent`, `packages:build:affected`, and `packages:test:affected` are land-time orchestrator runs on this turn.
