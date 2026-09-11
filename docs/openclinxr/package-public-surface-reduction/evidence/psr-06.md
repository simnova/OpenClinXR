# PSR-06 evidence - Admin route composition apply

Source revision: `cdf9bb84`. Task: tsk_ab265f7f3ac7bed1. Base: origin/main `3663acdd`.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).
Approval manifest `../approvals/psr-01d.json` ui-route-admin subset (26 keep, 545 remove, 2 migrate; `rawInventoryHash` `e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`; `groupHash` `21f46d05a61ca2639359ddbf9b80cbebf4c6e5e0932e15603fd7ee71ec593e3f`). Machine-readable companion: `psr-06.json` in this directory.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-applied psr-06` - fail before change (exit 1): 46 roots, 137 entrypoints, 2041 root symbols, 2869 occurrences, 2439 unique, 415 duplicated names (surface c5327ea69039); FAIL: group psr-06 not applied: extra: packages/openclinxr/ui-route-admin. publishes unapproved ADMIN_ASSEMBLED_EXAM_REVIEW_PACKET_PATH (and four more extras in the first five).
- `pnpm arch:public-surface:verify -- --require-applied psr-06` - fail after change (exit 1) on two migrate-destination extras only: 46 roots, 114 entrypoints, 1776 root symbols, 2324 occurrences, 2153 unique, 163 duplicated names (surface aeff95e589a2); extra: `./case-authoring-workbench` publishes CaseAuthoringWorkbench; extra: `./faculty-compile-lock-types` publishes FacultyCompileLockClient. ok baseline ratchet: surface matches the checked-in baseline (no growth).
- `pnpm --filter @openclinxr/ui-route-admin test` - pass: Test Files 35 passed (35); Tests 132 passed (132)
- `pnpm --filter @openclinxr/ui-admin test` - pass: Test Files 18 passed (18); Tests 80 passed (80)
- `pnpm typecheck:relaxed` - pass
- `pnpm hygiene:knip` - pass
- `git diff --check` - pass: no whitespace errors
- `pnpm architecture` - 196 passed / 3 failed: surface-meter clause (1) entrypoints 114 vs pin 137; clause (2) ui-route-admin rootSymbols 12 vs pin 277 (outside write-roots; orchestrator re-derives at land). Index/ceiling failures were fixed (ceiling file deleted: measured 12 root exports ≤ budget 25, testInternalImports 0).
- `pnpm packages:typecheck:agent` / `pnpm packages:build:affected` / `pnpm packages:test:affected` - not run this turn (orchestrator at land).

## Measured before and after

Before (origin/main after PSR-05, `psr-05.json` measuredAfter): 46 roots, 137 entrypoints, 2,041 root symbols, 2,869 occurrences, 2,439 unique, 415 duplicated names. After: 46 roots, 114 entrypoints, 1,776 root symbols, 2,324 occurrences, 2,153 unique, 163 duplicated names. Delta: -23 entrypoints, -265 root symbols, -545 occurrences, -286 unique, -252 duplicated names.

## Dispositions per package

| Package | Keep | Remove | Migrate | Root after |
| --- | ---: | ---: | ---: | ---: |
| packages/openclinxr/ui-route-admin | 26 | 545 | 2 | 12 |

Removed-kind split: 268 runtime / 277 type. Migrated-kind split: 1 runtime / 1 type. Migrate destinations: `./case-authoring-workbench` (CaseAuthoringWorkbench), `./faculty-compile-lock-types` (FacultyCompileLockClient). Full exact lists are in `psr-06.json` (`removed`, `migrated`).

Un-publish method: keep-only barrels (`*-entry.ts`) at the 7 remaining declared subpaths; implementations stay in the original modules with `export` keywords intact. Root `src/index.ts` publishes the 12 keep names only. All-remove file-shaped subpaths dropped from `package.json` `exports`. No namespace wrapping, facade indirection, package splitting, or subpath relocation of published names.

## Consumer files moved

- `apps/ui-admin/src/app.tsx`: `CaseAuthoringWorkbench` from `@openclinxr/ui-route-admin/case-authoring-workbench`; `FacultyCompileLockClient` from `@openclinxr/ui-route-admin/faculty-compile-lock-types`. Keep workbench/route names stay on the package root. Non-test source stayed 137 lines (react-router imports collapsed).
- `apps/ui-admin/src/app.test.tsx`: `FacultyCompileLockClient` from `./faculty-compile-lock-types`.

Package tests that imported removed preview names from the root now import `authoredContentIdentity` from `@openclinxr/domain` (identical re-export) and `previewAuthoringRevision` / `STALE_REVIEW_IDENTITY_REFUSAL` from the defining modules. `testInternalImports` measured 0.

Relative-path tool `tools/openclinxr/evidence/faculty-review-gate.ts` still imports `scenario-review-gate-constants.js` by source path; that file was not deleted. Outside write-roots.

## Retained exceptions

Two migrate destinations stay published so Admin consumers have a home. `expectedSurface` applies the subpath `remove` after the root `migrate` put, so `--require-applied psr-06` reports them as extra. Same class as the PSR-05 19-row destination amendment. Orchestrator amends those two subpath rows from `remove` to `keep`.

## Ceilings before and after

| File | Before (origin/main) | After |
| --- | --- | --- |
| packages/openclinxr/ui-route-admin/arch-ceiling.json | testInternalImports 2, rootEntrypointExports 240, starExports 10 | deleted: measured rootEntrypointExports 12 ≤ default budget 25; testInternalImports 0; starExports 0 |

Index regenerated with `pnpm arch:index` (`packages/openclinxr/ui-route-admin/arch-index.json` only; 12 root exports).

## Claim

PSR-06 applies PSR-01D ui-route-admin subset: 12 keep names on root, 7 keep-only concept subpaths, file-shaped all-remove subpaths un-published, 2 migrate consumers moved in apps/ui-admin. Implementations kept. `--require-applied psr-06` exits 1 before the change and still 1 after on the two migrate-destination extras.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility. `packages:typecheck:agent`, `packages:build:affected`, and `packages:test:affected` are land-time orchestrator runs. `surface-meter.test.ts` still pins 137 entrypoints and ui-route-admin `rootSymbols` at 277; measured 114 and 12. That file is outside this card's write-roots.

## Orchestrator amendment at land (2026-09-11)

The two migrate-destination extras this worker reported were a review defect (the same one as PSR-05's 19 rows): approval psr-01d now keeps `CaseAuthoringWorkbench` on `./case-authoring-workbench` and `FacultyCompileLockClient` on `./faculty-compile-lock-types` (91429f54). `46 roots, 114 entrypoints, 1694 root symbols, 2208 occurrences, 2040 unique, 160 duplicated names (surface 85a9bae22e88)`; `ok: group psr-06 applied: 543 removed, 2 migrated`.

`surface-meter.test.ts` pins updated: entrypoints 137 -> 114, counted independently from the 46 scoped `package.json` exports maps; ui-route-admin `rootSymbols` 277 -> 12, re-derived with `ts.TypeChecker.getExportsOfModule` (the same method still returns 94 for rest). `pnpm architecture`: 199 passed.
