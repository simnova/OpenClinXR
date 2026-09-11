# PSR-01D review — REST, asset-registry, Admin contracts (v2)

Companion: `psr-01d.json` (1,304 rows). Governing plan
`docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at
`1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256
`01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).
Raw inventory `raw-inventory.json` (`inventoryHash`
`e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`);
group hash `21f46d05a61ca2639359ddbf9b80cbebf4c6e5e0932e15603fd7ee71ec593e3f`
over the three packages on the current tree. Zero unresolved.

## Dispositions

| Package | Rows | Keep | Remove | Migrate | Root before | Root after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| packages/openclinxr/rest | 193 | 90 | 103 | 0 | 193 | 90 |
| packages/openclinxr/asset-registry | 538 | 92 | 398 | 48 | 240 | 21 |
| packages/openclinxr/ui-route-admin | 573 | 25 | 546 | 2 | 277 | 11 |

Plan review targets: at most 50 per root, at most 1,000 root exports
program-wide. Projected roots (90 / 21 / 11) are reported, not forced;
rest still exceeds 50 and needs an implementation-card exception or a
deeper facade cut at PSR-04 time. No namespace wrapping, facade
indirection, package splitting, or subpath relocation was used to earn
shrinkage; migrate rows only collapse an existing root duplicate onto its
already-exported subpath.

## Facade redesigns (highest value, per plan)

1. **ui-route-admin** (277 root symbols, 30 subpaths): root re-exports
   every panel, hook, formatter, codec, client, and model; 252 names are
   duplicated by file-shaped subpaths. Retained root: 11 (workbench
   providers, publication gates, shared preview/authoring entry used by
   apps/ui-admin). Two root duplicates migrate to `./case-authoring-workbench`
   and `./faculty-compile-lock-types`.
2. **asset-registry** (240 root symbols, 24 subpaths): aggregation hub
   (policy, lookup, review, bundles, provenance, resolvers). Retained
   root: 21. 48 root duplicates migrate, chiefly to `./runtime-bundles`
   (24), `./actor-posture` (13), and `./runtime-asset-review` (7).
3. **rest** (193 root symbols, 0 subpaths): route catalogue, transport
   contracts, app composition, persistence integration, promotion, and
   protocol posture on one root. Retained: 90, all consumed from
   apps/api. No migrate (no subpaths exist); the PSR-04 facade cut is
   left to implementation.

## Consumer directories covered by PSR-04 through PSR-06

Keep/migrate owners outside the defining package: apps/api (95),
apps/ui-xr (55), packages/openclinxr/rest (27, consumes asset-registry),
apps/ui-admin (27), packages/openclinxr/data-mongodb (14),
packages/openclinxr/xr-station (8), packages/openclinxr/ui-route-admin
(8), packages/openclinxr/xr-runtime-state (7), packages/openclinxr/xr-pose
(4), plus scenario-runtime, xr-humanoid-animation, xr-capture-evidence,
xr-dialogue, xr-actor-dialogue, xr-asset-loading, ui-route-shared
(1–2 each). Implementation write roots for PSR-04/05/06 must cover at
least apps/api, apps/ui-xr, apps/ui-admin, and the consuming packages
above; any required migration outside the planted roots fails the card.

## Method (rerunnable)

Classifier source lives outside the repo: `/tmp/psr01d-cls/consumer-refs3.mjs`
(TypeScript compiler-API parse of 120 external consumer files: static
named imports including `import type`, namespace member use,
`export … from`, dynamic-import member/destructure access, require) plus
checker passes `tc2.mjs` (specifier module exports the name) and `tc3.mjs`
(identifier resolves through the reviewed specifier). Parser-confirmed:
249 rows. 36 same-name leads were checker-adjudicated: 7 keep (name
resolves through the reviewed specifier, e.g. `ApiFacultyCompileLockRecord`
via `ui-route-shared/src/admin-api-client-types.ts:100`), 29 remove
(local shadows in `api-bootstrap.ts`, relative-path imports of
session-state/review-workflow, comment/string/regex-only mentions).
Sampling: 20 remove rows at reference count 0 and 20 keep rows with
file:line are in `psr-01d.json` (`sampledRemoves`, `sampledKeeps`).

## Verify

Before (no manifest): `FAIL: approval manifest for psr-01d is absent`
(exit 1). After: `ok: group psr-01d reviewed: 1304 resolved rows`
(exit 0); baseline ratchet ok.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity,
Quest readiness, runtime performance, and public npm compatibility.
Parser blind spots (renamed dynamic bindings, string-built specifiers,
app-barrel re-exports) mean implementation cards rerun compiler plus
builds per row before removing publication. Behavior is untouched by
this card: no package code, exports, consumers, raw inventory, or
verification policy changed.
