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
