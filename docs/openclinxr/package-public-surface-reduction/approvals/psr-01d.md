# PSR-01D approval record

Review group `psr-01d`: `packages/openclinxr/rest`,
`packages/openclinxr/asset-registry`, `packages/openclinxr/ui-route-admin`.
Machine-readable contract: `psr-01d.json` in this directory (1,304 rows;
`rawInventoryHash`
`e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`,
`groupHash`
`21f46d05a61ca2639359ddbf9b80cbebf4c6e5e0932e15603fd7ee71ec593e3f`).
Human-readable companion:
`../evidence/psr-01d.md` (dispositions, facade redesigns, consumer
coverage, method, verify output, limitations).

Scope: review only. No package code, exports, consumers, raw inventory,
or verification policy changed. Implementation cards PSR-04 (rest),
PSR-05 (asset-registry), PSR-06 (ui-route-admin) consume this contract
as a read-only input; required migrations outside their planted roots
fail those cards.

## Amendment before dispatch (orchestrator, 2026-09-11)

50 rows move from `remove` to `keep` because each name is imported by its own package's tests
through the entrypoint on origin/main 43ffd845: rest 3 (now 93 keep, 100 remove),
asset-registry 46 (now 138 keep, 352 remove, 48 migrate), ui-route-admin 1. Plan lines 83 and 92
count tests as consumers. PSR-03 showed the alternative fails: un-publishing such a name forces
the test onto an internal module, which raises `testInternalImports` above its shrink-only
ceiling and is refused by `package-tests-use-the-public-entrypoint` at push. Each amended row
names the consuming test as owner, with file:line evidence. `--require-reviewed-group psr-01d`
still exits 0.
