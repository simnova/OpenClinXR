# PSR-04 evidence - bounded REST adapter facade

Source revision: `fe74d6a6db762b3293d3a72e228dfde1c6c7d725`. Task: tsk_1b5c868161a95aba. Base: origin/main `cc3da7f3`.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).
Approval manifest `../approvals/psr-01d.json` rest subset (93 keep, 100 remove, 0 migrate, as amended at `cc3da7f3`; `rawInventoryHash` `e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`; `groupHash` `21f46d05a61ca2639359ddbf9b80cbebf4c6e5e0932e15603fd7ee71ec593e3f`). Machine-readable companion: `psr-04.json` in this directory.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-applied psr-04` - fail before change (exit 1): 46 roots, 137 entrypoints, 2322 root symbols, 3345 occurrences, 2780 unique, 547 duplicated names (surface bd6307b0c20f); FAIL: group psr-04 not applied: extra: packages/openclinxr/rest. publishes unapproved ApiAssembledStationContext (and four more extras in the first five).
- `pnpm arch:public-surface:verify -- --require-applied psr-04` - pass after change (exit 0): 46 roots, 137 entrypoints, 2222 root symbols, 3245 occurrences, 2680 unique, 547 duplicated names (surface bad75b84a082); ok: group psr-04 applied: 100 removed, 0 migrated; ok baseline ratchet: surface matches the checked-in baseline (no growth)
- `pnpm --filter @openclinxr/rest test` - pass: Test Files 9 passed (9); Tests 53 passed (53)
- `pnpm --filter @openclinxr/api test` - pass: Test Files 20 passed (20); Tests 192 passed (192)
- `pnpm --filter @openclinxr/ui-route-shared test` - pass: Test Files 2 passed (2); Tests 10 passed (10)
- `pnpm packages:typecheck:agent` - pass: Tasks: 100 successful, 100 total
- `pnpm typecheck:relaxed` - pass
- `pnpm hygiene:knip` - pass
- `git diff --check` - pass: no whitespace errors
- `pnpm packages:build:affected` - pass: Tasks: 31 successful, 31 total
- `pnpm packages:test:affected` - fail (OUT-OF-SCOPE): @openclinxr/ui-admin 2 tests (src/app.test.tsx AdminApp seed exam readiness; src/the-worldview-canvas-adds-and-removes-nodes.test.tsx). ui-admin is not in this card's write-roots and was not edited. In-scope in the same run: rest, api, ui-route-shared (card proofs).

## Measured before and after

Before (compiler-derived on this tree, pre-edit): 46 roots, 137 entrypoints, 2,322 root symbols, 3,345 occurrences, 2,780 unique, 547 duplicated names. After: 46 roots, 137 entrypoints, 2,222 root symbols, 3,245 occurrences, 2,680 unique, 547 duplicated names. Delta: -100 root symbols, -100 occurrences, -100 unique, 0 duplicated names. Group gate: 100 removed, 0 migrated.

## Dispositions per package

| Package | Keep | Remove | Migrate | Root after |
| --- | ---: | ---: | ---: | ---: |
| packages/openclinxr/rest | 93 | 100 | 0 | 93 |

Removed-kind split: rest 52 runtime / 48 type (from `psr-04.json` `removed`).

## Removed symbols (100, from approvals/psr-01d.json rest subset)

Full exact list is in `psr-04.json` (`removed`). Rest root only; no subpath invented; `export type * from "./api-types.js"` replaced with the 28 keep types from that module.

## Migrated symbols (0)

None. Approval rest subset has zero migrate rows.

## Consumer files moved

- `apps/api/src/the-factory-run-table-route-serves-the-station-table.test.ts`: computed `import(["@openclinxr/rest"].join(""))` of `FACTORY_RUN_ROLLUP_REL` (approval remove; static scan missed it) -> the identical `export const FACTORY_RUN_ROLLUP_REL` in `packages/openclinxr/rest/src/routes/factory-run-table-routes.ts`. `parseFactoryRunRollup` stays a keep import from `@openclinxr/rest`. Apps/api non-test source line budget: zero change.

No other in-scope consumer of a remove name was found. Internal rest modules that already import keep names (`routeById`, `matchOpenClinXrRestRoute`, `ApiPersistenceSink`) through `@openclinxr/rest` were left unchanged.

## Retained exceptions

Three keep rows owned by `packages/openclinxr/rest/src/rest-routes.test.ts` (amendment `cc3da7f3`): `matchOpenClinXrRestRoute`, `openClinXrRestRouteIds`, `openClinXrRestRoutes`. Rest `testInternalImports` stays 23.

## Ceilings before and after

| File | Before | After |
| --- | --- | --- |
| packages/openclinxr/rest/arch-ceiling.json | testInternalImports 23, rootEntrypointExports 151, ApiAppContext 20 | testInternalImports 23, rootEntrypointExports 93, ApiAppContext 20 |

Index regenerated with `pnpm arch:index` (only `packages/openclinxr/rest/arch-index.json` changed; 93 exports).

## Claim

PSR-04 applies PSR-01D rest subset as amended at cc3da7f3: 100 rest root exports removed, 0 migrated, 93 keep names remain published; implementations kept; one computed api-test consumer of `FACTORY_RUN_ROLLUP_REL` moved to the route module; `--require-applied psr-04` exits 1 before the change and 0 after.

## Limitations and NOT TESTED

`pnpm architecture` `surface-meter.test.ts:121` still pins rest `rootSymbols` at 193; that file is outside this card's write-roots (`packages/openclinxr-verification/architecture-rules`). Land needs that pin lowered to 93.

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility.

## Orchestrator amendment at land (2026-09-11)

`FACTORY_RUN_ROLLUP_REL` stays published. The apps/api test consumed it through `import(["@openclinxr/rest"].join(""))`, a specifier the review's static consumer scan could not see, so psr-01d marked it remove. The worker moved the test to a relative import of `packages/openclinxr/rest/src/routes/factory-run-table-routes.js`, which reaches into another package's source. Instead, approval psr-01d now keeps the constant (owner: that test), the rest root re-exports it, and the test imports both names statically from `@openclinxr/rest`. Result: 99 removed, 94 kept; rest `rootEntrypointExports` ceiling 151 -> 94.

`46 roots, 137 entrypoints, 2223 root symbols, 3246 occurrences, 2681 unique, 547 duplicated names (surface 7f994e47ff0b)`; `ok: group psr-04 applied: 99 removed, 0 migrated`

The surface-meter pin for rest (`surface-meter.test.ts` clause 2) moved from 193 to 94. The value was re-derived with `ts.TypeChecker.getExportsOfModule` on `rest/src/index.ts`; the same method returns 277 for the untouched ui-route-admin pin. `pnpm architecture`: 199 passed. rest 53, api 192, ui-route-shared 10 tests passed; `packages:typecheck:agent` 100/100; knip clean.
