# PSR-08 evidence - apply remaining-package contract tail

Source revision: `2f050c9162aeb6a99eeff2f534629177d854b07f` (apply commit). Task: tsk_7e8b151eab28f3f5. Base: this worktree `3357d1f2` before apply.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).
Approval manifest `../approvals/psr-01e.json` 26-package complement (keep/remove/migrate as amended, including the 115 test-consumer keeps of `cc3da7f3`; `rawInventoryHash` `e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`; `groupHash` `7e8b0ae8c2ea0bfc39e7f8a0a622a350d6be58ac52fba2b47fade6a1ba224664`). Machine-readable companion: `psr-08.json` in this directory.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-applied psr-08` - fail before change: on `3357d1f2` the 26 packages still published remove names. First measured fail (truncated to 5): extra `AgentLoopPlan`, `DONE_WHEN_RULE_VOCABULARY`, `GROK_TIER_PACKAGE_SCRIPTS`, `GrokDelegationIntent`, `GrokSessionTokenSnapshot` on `packages/openclinxr/agent-loop.`. Card known-good: 46 roots, 137 entrypoints, 2,533 root symbols, 3,588 occurrences, 3,020 unique, 550 duplicated names.
- `pnpm arch:public-surface:verify -- --require-applied psr-08` - pass after change (exit 0): 46 roots, 114 entrypoints, 1243 root symbols, 1481 occurrences, 1453 unique, 28 duplicated names (surface b4eb88b99559); ok: group psr-08 applied: 682 removed, 45 migrated; ok baseline ratchet: surface matches the checked-in baseline (no growth)
- `pnpm arch:public-surface:verify -- --require-applied psr-08 -- --require-all-reviewed` - pass: ok: all review groups resolved
- Single-package tests for touched packages - pass (agent-loop 181, capability-gateway 49, factory-stations 78, domain 23, scenario-fixtures 49, shared-schemas 39, review-workflow 66, exam-assembly 32, session-state 21, scenario-runtime 114, ui-shared 9, ui-route-shared 10, voice-gateway 49, xr-* and arena packages as run)
- `pnpm architecture` - pass: Test Files 17 passed (17); Tests 199 passed (199)
- `pnpm hygiene:knip` - pass
- `git diff --check` - pass: no whitespace errors
- `pnpm packages:typecheck:agent` / `pnpm packages:build:agent` / `pnpm packages:test:agent` - land-time orchestrator proofs (not run in the worker commit turn)

## Measured before and after

Before (this worktree pre-apply, after PSR-06/PSR-07): 46 roots, 114 entrypoints, 1,694 root symbols, 2,208 occurrences, 2,040 unique, 160 duplicated names. After: 46 roots, 114 entrypoints, 1,243 root symbols, 1,481 occurrences, 1,453 unique, 28 duplicated names. Delta vs that start: -451 root symbols, -727 occurrences, -587 unique, -132 duplicated names. Group gate: 682 removed, 45 migrated.

## Dispositions per package

Full exact lists are in `psr-08.json` (`removed`, `migrated`). Complement excludes the seven PSR-07 XR packages.

Un-publish method: names dropped from declared entrypoint barrels. Defining-module subpaths moved to `*-mod.ts` with keep-only barrels at the declared export-map path, except freeze-listed files (`arena/iwsdk-spike/src/index.ts`, `ui-route-shared/src/admin-api-client.ts`, `ui-route-shared/src/admin-api-client-types.ts`) which stay at their grandfathered paths; those packages' `package.json` now point `.` / `./admin-api-client` / `./admin-api-client-types` at small keep-only entry files. `export` keywords in defining modules were not removed. No namespace wrapping, facade indirection, package splitting, or subpath relocation of published names.

Wildcard `export *` removed from `arena/model-vetting` and `arena/multi-actor-state-spike` roots.

## Consumer files moved

Migrate rows retargeted in-package tests to the kept route (`./claim-language.js`, `./scenario-bank.js`, `./pediatric-asthma.js`, `./index.js` for names migrated onto `.`). `localDevelopmentModelDialogueBinding` in scenario-runtime annotated with a keep-derived return type so `CapabilityProviderBinding` need not be published. Computed-access tests that required unpublished names now read the implementation module (`station-runners.ts`, `scene-asset-evidence.ts`) or keep-route validators.

## Retained exceptions

See `../exceptions/psr-08-residual.json`: program root count 1,243 vs review target 1,000; physics-touch-contract remains source-published experimental; seven keep=0 declared subpaths are `export {}` barrels; arena `arch-index.json` files are written by `pnpm arch:index` while architecture-rules `indexedPackages()` still lists only direct children.

## Ceilings

Touched packages' `rootEntrypointExports` lowered via `pnpm arch:ceilings`. `testInternalImports` held or lowered versus origin/main. Indexes regenerated including `packages/openclinxr/arena/*/arch-index.json`.

## Claim

PSR-08 applies PSR-01E remaining 26-package complement as amended: 682 names un-published, 45 migrated, keep names remain published. Implementations kept. `--require-applied psr-08` and `--require-all-reviewed` exit 0 after the change.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility. `packages:typecheck:agent`, `packages:build:agent`, and `packages:test:agent` are land-time orchestrator runs.
