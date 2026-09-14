# Humanoid-motion decision ledger (MR-01 worker reconciliation)

Machine JSON: `decision-ledger.json`. Ingestion `7066a99c`. Worker session `27ec8e94-3780-4be4-8933-0ee13ddb9968`.
Registry: `docs/openclinxr/doc-authority-registry-2026-05-27.json`.
ENTRYPOINT / full design / superseded brief remain archive-candidate with no instruction weight.
Owner may approve factual ENTRYPOINT edits without reclassifying that registry.
Full design is read-only in MR-01.

This file is worker-reconciled against live consumers. Independent claim-to-consumer grade is owner work after `status=review`. Keyword/existence/source inspection is not that grade.

## Input identity (live)

Computed from `report.json` `actorAssetSha256` vs sha256 of
`apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`.

Report `b744d3d5295e2d4840ceae586924727725667cb0260a5b1f3ee68dd2e72e136f`,
disk `8409334c30861e07d7bb180b2b8f7e5d48c277bc91c4a5df8f0cb0475869c541`,
classification `identity-stale`.
If those hashes later match, classification must become `current-actor-bound`. Do not freeze stale.
Do not edit those hashes to green a capture. A later actor rebake already made identity stale again; rewriting hashes would bind retained images to new inputs.

Bake-off `verdict` is `other` in `report.json`: landed, inconclusive, no winner.
Neither requested clutch succeeded; the runtime pulse descriptor lacked a pulse goal.
Verdict `other` cannot justify an architecture winner.

## Phase release (owner gates)

- MR-01: worker returns review with clause (7) planted; owner independent acceptance is required before Landed.
- MR-02 / MR-03: blocked until owner review; do not create executable cards in this slice.

## Topics

| id | class | status | currentSource | caller | ownerDecision |
|---|---|---|---|---|---|
| ik-blend-vs-target-distance | math | retained | motion-backend-bakeoff/harness.html | none — CCDIKSolver imported in harness.html:29 only; apps/ui-xr has no CCDIKSolver import | Keep solver-blend-1 as harness interpretation; not a universal prohibition |
| expression-vs-cooperation | authoring | superseded | architecture-brief-2026-09-02.md | none — superseded brief is historical clinical-source ledger | No new clinical vocabulary in MR-01 |
| schema-validation | authoring | superseded | architecture-brief-2026-09-02.md | none — no production caller of rejected onDemand block | Do not revive the superseded schema |
| pass-order-bone-ownership | engineering | reopened | full-design-2026-09-02.md | production `apps/ui-xr/src/main.ts` — station-bedside-approach at :143/:3462/:3484; composes case-owned-approach-runtime, settling-step-turn, stance-lock; reads asset-registry. Not the full-design IK/contact/gaze controller | Do not silently archive or rewrite the full design |
| seated-rest-transfer | observed | retained | postprocess-seated-glbs.mjs | production `seated_clip_bind_stage.py:160` — factory caller, not UI-XR runtime | Do not ban constant rests |
| rig-capability-identity | engineering | retained | bakeoff report.json | none — evidence artifact, not a production descriptor consumer | MR-02, if released, must rebind live hashes; no hash-edit repair |
| catalog-transitions | observed | retained | clip-channel-deviation.ts | none — inventory instrument, not a runtime matcher | Do not adopt matching databases (LaFAN1 NC/ND) in MR-01 |
| package-station-boundary | engineering | reopened | shared-schemas/src/factory-stations.ts | none remaining on the shim; ui-shared admin cards import factory-stations/catalog directly; package.json still depends on factory-stations; motion_retarget strings adapter `@openclinxr/motion-compiler` | Do not delete the shim or change station topology in MR-01 |
| evidence-vs-obsolete-failures | observed | retained | humanoid-motion-ENTRYPOINT.md | none — ENTRYPOINT is documentation | Factual ENTRYPOINT correction without registry reclassification; independent semantic grade after worker review |
| physics-touch-fence | policy | retained | apps/ui-xr/src/static-assets.test.ts:1310 | none — fence guard, not an interaction consumer | Do not lift the fence in MR-01–MR-03 unless separately approved |
| provider-eligibility | policy | unknown | full-design-2026-09-02.md | none — no in-repo production import of GMR, Kimodo, ARDY, or Holden matcher | Permissive/non-copyleft across code, deps, weights, data, assets, output before any provider card |
| open-decision-posture-field | engineering | unknown | full-design-2026-09-02.md | none | Owner names the field before any authoring schema card |
| open-decision-station-topology | engineering | unknown | full-design-2026-09-02.md | production `factory-stations/src/motion_retarget/run.ts` — station exists; D9 multi-case-runner is a separate hardcoded chain | Owner picks topology before any packing card |
| open-decision-package-adapter | engineering | unknown | motion_retarget/run.ts | production same file — adapter string + fresh_subprocess, not a JS import | Owner picks adapter home; MR-01 must not introduce the JS back-edge |
| open-decision-rock-frame | engineering | unknown | full-design-2026-09-02.md | none — harness pelvis oscillator is bake-off evidence only | Predeclare engineering limits in MR-02 brief if that phase is released |
| open-decision-cooperation-join | authoring | unknown | full-design-2026-09-02.md | none | No invented clinical thresholds |
| open-decision-ik-blend | engineering | unknown | harness.html | none — harness-only CCDIK apply path | Do not encode unsupported joint thresholds in MR-01 tests |
| open-decision-station-schema | engineering | unknown | full-design-2026-09-02.md | none | Do not release the old motion child list from this ledger |
| open-decision-tolerance-authority | policy | unknown | full-design-2026-09-02.md | none — design withholds numbers | Owner/authoring brief sets any MR-02 numbers with provenance |
| open-decision-cooperation-provenance | authoring | unknown | architecture-brief-2026-09-02.md | none — brief remains historical clinical-source ledger only | Qualified review required before any cooperation numeric card |

Each JSON topic also carries `claim`, `claimScope`, `notEvidenceFor`, and `phaseReleaseOwnerGate`. The nine historical open decisions are the `open-decision-*` rows.

## Claim scope notes

- Historical bake-off stills and residual 0.0000 m are not today’s clutch/skin quality, not Quest evidence, and not a backend winner.
- Clip-channel-deviation inventory measures names/channels, not usable transition coverage or clinical fitness.
- Seated postprocessor stamps frame-1 leg quaternions onto every key; held posture restore is not per-frame transfer or seat contact.
- Factory `motion_retarget` registration is real integration, not proof of a rendered compiled encounter.
- No production CCDIKSolver consumer in ui-xr. Presence of approach/stance mods in ui-xr must not be generalized to “IK is in production.”
