# PSR criterion-6 residual exceptions (2026-09-11)

Measured on origin/main 5ae2f68e after PSR-10: 1,220 root exports (target 1,000), median 25.5 per
root (15), p90 47 (25), largest root 119 in xr-runtime-state (50; also over: rest 94, xr-station 70).
Duplicate names 20 (target 200, met).

Owner: the orchestrator of the reduction program. Reviewer: grok-4.6 in two fresh read-only sessions
that did not author these entries. The first review (01a09174) rejected the "no root above 50" miss
for asset-registry (58) and shared-schemas (56); PSR-10 cut them to 50 and 41. The second review
(01a09194) accepted all four entries on the post-PSR-10 numbers. Entries, reasons and verdicts are in
`psr-c6-residual.json`. `pnpm arch:public-surface:acceptance` counts an entry only if its measured
value equals the tree, its threshold equals the plan's, and its reviewer differs from its owner.
