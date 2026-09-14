# Humanoid-motion decision ledger (seed)

Baseline main `dd074568`. Machine JSON: `decision-ledger.json`.
Registry: `docs/openclinxr/doc-authority-registry-2026-05-27.json` (not `docs/agent-ops`).
ENTRYPOINT / full design / superseded brief are archive-candidate with no instruction weight.
Owner may approve factual ENTRYPOINT edits without reclassifying that registry.
Full design is read-only in MR-01.

This seed is honest baseline, not owner semantic review. Independent claim-to-consumer grade is owner work after `status=review`.

## Input identity (live)

Computed from `report.json` `actorAssetSha256` vs sha256 of
`apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`.

At dd074568: report `b744d3d5…`, disk `8409334c…`, classification `identity-stale`.
If those hashes later match, classification must become `current-actor-bound`. Do not freeze stale.

Bake-off `verdict` is read from `report.json` (currently `other`: landed, inconclusive, no winner).
That is factual task state, not today’s quality grade. Do not edit those hashes to green a capture.

## Topic index

See JSON `topics[]`. Required ids, `claim`, `class` (`math|engineering|policy|authoring|observed`),
`status` (`retained|reopened|unknown|superseded`), `currentSource.path`+`sha256` of an existing file,
`caller` production path or `kind: none` with evidence, `claimScope`, `notEvidenceFor`,
`ownerDecision`, `phaseReleaseOwnerGate`.

## Phase release (owner gates)

- MR-01: Idle until owner plants after this package is on main.
- MR-02 / MR-03: blocked until owner review; do not create executable cards in this slice.
