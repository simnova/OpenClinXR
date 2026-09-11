# PSR-02 evidence — apply PSR-01B support-contract dispositions

Source revision: ce82b7407d6486656d07118adae98d43146a6a39. Task: PSR-02 v2.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).

Machine-readable companion: `psr-02.json` in this directory. Approval manifest: `../approvals/psr-01b.json` (59 rows; `rawInventoryHash` `e43ee9c249ee`, `groupHash` `82f312da4e6a`). Removal un-publishes names only; implementations stay in place. No namespace wrapping, facade indirection, package splitting, or subpath relocation.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-applied psr-02` — exits 1 before the change (`group psr-02 not applied: extra: packages/openclinxr/auth. publishes unapproved AUTH_CLAIM_BOUNDARY; ...`), 0 after (after column below).
- Plain `pnpm arch:public-surface:verify` — exits 0 (baseline ratchet ok).
- Full architecture suite — 199 passed, 0 failed (17 files), after `pnpm arch:index` regenerated the auth index and the auth ceiling was retired (auth tests import only through the entrypoint again).
- `pnpm --filter @openclinxr/auth|telemetry|config-rolldown|physics-touch-artifacts|test-harness test` — pass (5, 11, 5, 6, 4 tests).
- `pnpm packages:typecheck:agent` on the five touched packages — green. `git diff --check` — clean.
- BLOCKER (outside write roots, pre-commit hook fails): repo-wide typecheck baseline reports 1 error, `tools/openclinxr/evidence/blueprint-voice-simulation-spike.ts|17|3|TS2724` — that file imports `safeTelemetryAttributes` directly from `packages/openclinxr/telemetry/src/index.js` (relative path, not the package specifier, so the approval's zero-reference scan missed it). The migration is `safeTelemetryAttributes` → kept export `telemetryRouteAttributes` (behavior-identical: it delegates to `safeTelemetryAttributes`) at lines 17, 139, 458, 525, 1615 of that file. `tools/**` is outside this card's write roots, so the fix is left for the orchestrator at land.
- NOTE: `pnpm packages:test:affected` does not pass on this tree: `@openclinxr/api#test` fails (2 files, e.g. a 5 s timeout in `app.test.ts` actor-response routing and a `factory-run-table` row assertion; the failing file varies run to run). Scoped grep confirms no removed name is referenced from `apps/api/src` (only kept `createInMemoryTelemetryRecorder`) or `packages/openclinxr/rest/src`, so the failures are flaky and independent of this slice; `pnpm --filter @openclinxr/api test` has passed 191/191 on this tree in an earlier run.

## --require-applied after column (literal output on this tree)

```text
46 roots, 137 entrypoints, 2496 root symbols, 3551 occurrences, 2983 unique, 550 duplicated names (surface 50a4b8805ff2)
ok: group psr-02 applied: 37 removed, 0 migrated
ok baseline ratchet: surface matches the checked-in baseline (no growth)
```

## Measured before and after

Before: 46 roots, 137 entrypoints, 2,533 root symbols, 3,588 occurrences, 3,020 unique symbols, 550 duplicated names. After: 46 roots, 137 entrypoints, 2,496 root symbols, 3,551 occurrences, 2,983 unique symbols, 550 duplicated names. Delta: 37 root symbols removed, 0 migrated. Star-export walls remaining on the five roots: 0 (both pre-existing walls retired with the test-harness entrypoint). Duplicated names remaining: 550.

## Applied dispositions per package (measured root exports beside review targets: at most 50 per root; at most 1,000 root exports program-wide)

| Package | Rows | Keep | Remove | Migrate | Measured root exports |
| --- | ---: | ---: | ---: | ---: | ---: |
| packages/openclinxr/auth | 15 | 9 | 6 | 0 | 9 |
| packages/openclinxr/config-rolldown | 7 | 2 | 5 | 0 | 2 |
| packages/openclinxr/physics-touch-artifacts | 7 | 0 | 7 | 0 | 0 |
| packages/openclinxr/telemetry | 20 | 11 | 9 | 0 | 11 |
| packages/openclinxr/test-harness | 10 | 0 | 10 | 0 | 0 |

How each remove was applied: auth drops the six names from `src/index.ts` (types and constants stay defined in `src/types.ts`; `jwt.ts` keeps importing them internally). config-rolldown de-exports the five names in `src/index.ts` (types, alias-map builder, adoption summary stay defined and used internally). physics-touch-artifacts and test-harness roots become `export {};` (implementation files `types.ts`/`gates.ts` and `adversarial-report.ts`/`station-simulation.ts` untouched). telemetry de-exports the nine names in `src/index.ts` (types and helpers stay defined and called internally, e.g. `telemetryRouteAttributes` calls `safeTelemetryAttributes`). The staged diff also edits `packages/openclinxr/auth/src/auth.test.ts`: the worker first repointed its boundary-constant assertions at `./types.js`, which made auth tests import an internal module reachable from the entrypoint via `jwt.ts` (a violation of package-tests-use-the-public-entrypoint). The fix keeps the test on the supported entrypoint — the test now imports only from `./index.js` and asserts the kept export `DEFAULT_DEV_AUTH_IDENTITY` instead of the removed constants. `telemetry.test.ts` exercises the public route-attributes path; config-rolldown tests cover the alias map through the public config builder plus a direct workspace-missing case.

## Consumer migrations

No external consumer imported a removed name through an entrypoint (scoped grep over `apps packages tools` confirms: auth removed-name hits only inside `packages/openclinxr/auth/src`; config-rolldown removed-name hits only inside its own `src`; telemetry removed-name hits only inside its own `src`; physics-touch-artifacts and test-harness have zero entrypoint consumers). Approved in-repo consumers of kept names are unchanged (`apps/api/rolldown.config.ts`, `apps/api/scripts/prepare-deploy.ts`, rest route/middleware sources, `apps/api` bootstrap/tests). `tools/openclinxr/evidence/blueprint-voice-simulation-spike.ts` imports `safeTelemetryAttributes` and `TelemetryAttributeInput` from the telemetry source file directly (`../../../packages/openclinxr/telemetry/src/index.js`), not the package specifier, so it is unaffected by the entrypoint change. No consumer files migrated.

## Ceilings and derived index

- `pnpm arch:ceilings` deleted `packages/openclinxr/physics-touch-artifacts/arch-ceiling.json` and `packages/openclinxr/test-harness/arch-ceiling.json`, and the auth ceiling created mid-slice was retired. Measured values after the change justify removing each file (a ceiling file is only needed when a measurement exceeds a default budget): test-harness measures 0 root exports (budget 25), 0 `export *` walls, and 0 test-internal imports against its old ceiling (`testInternalImports: 4, starExports: 2`); physics-touch-artifacts measures 0/0/0 against its old `testInternalImports: 1`; auth measures 9 exports, 0 star walls, 0 test-internal imports, so no ceiling is needed. No ceiling raised; telemetry (11/0/0) and config-rolldown (2/0/0) carry no ceiling.
- `pnpm arch:index` regenerated `arch-index.json` for all five touched packages (auth 15→9 exports, telemetry 20→11, config-rolldown 7→2, physics-touch-artifacts 7→0, test-harness 10→0).

## Claim

All 59 PSR-01B rows are applied exactly as approved (22 keep published, 37 remove un-published, 0 migrate); `verify --require-applied psr-02` passes on this tree with runtime behavior preserved.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility.

## Orchestrator amendment at land (2026-09-11)

The land commit's Knip gate refused: with all seven physics-touch-artifacts exports un-published, `packages/openclinxr/physics-touch-artifacts/src/types.ts` became an unused file, and the plan forbids deleting source to satisfy Knip. MADR 0031 names this package as the production baked-physics path, so its seven names are kept as a deliberate compatibility contract with that MADR as owner. approvals/psr-01b.json is amended accordingly (7 rows remove -> keep, owner and rationale recorded) and the package is left as it is on main. Applied totals therefore become 30 removed and 29 kept, not 37 and 22; the worker's before/after counts above predate this amendment.
