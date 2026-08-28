# Cagematch finding: IWSDK agentic scene composer vs a case definition (issue #577)

- **Date:** 2026-08-28
- **Lane:** C (cagematch — deliverable is a decision with evidence, not working code)
- **factory_step:** room_generate
- **Verdict:** **REJECT_MEASURED — the composer cannot build a station from a case
  definition as shipped, and `pnpm iwsdk:verify` cannot run in the dispatch
  environment.** Two independent negative results, both measured:

  1. The verify gate fails closed at its first command (missing node_modules →
     `TS2688` → `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, exit 2). Exact log:
     `.openclinxr/evidence/issue-577/iwsdk-verify-run.log` (gitignored).
  2. The composer itself — `@iwsdk/scene-composition@0.5.3` (MIT, local) — accepts
     **only** `iwsdk.scene.v1` documents. An OpenClinXR case definition (the
     generated `openclinxr.runtime-scene-manifest.v1` for
     `ed_chest_pain_priority_v1`) is rejected with zero schema overlap. A station
     document only validates after an agent hand-writes a field mapping
     (prefab shapes, `content.type` discriminators, the `framingRole` enum
     `{content, support}`, namespaced metadata keys) — five fail-closed
     iterations with precise JSON-pointer errors each. That hand-mapping is the
     D1/D9 anti-pattern (bespoke per-station code, no adapter, no factory
     station), and no adapter exists in the repo.

  **The tool itself is healthy.** Import works standalone (82 exports), it is
  MIT-licensed and local, and its validator/composer behave deterministically.
  The refusal is scoped to "station from a case definition **with no adapter**",
  not to the package.

## Claim under test

The card asks whether the IWSDK agentic scene composer can build a station from a
case definition (`factory_step: room_generate`). "Agentic scene composer" here
means `@iwsdk/scene-composition` ("agentic scene composition tools" per its
README) driven by an agent, plus the IWSDK MCP tooling that would expose it to
an agent. It is **not** the cloud-backed `@meta-quest/metavr` MCP (approved by
the operator 2026-08-22, Meta Platform Technologies SDK License, not installed
or connected in this session). The two must not be confused: metavr is cloud
Meta tooling; `@iwsdk/*` is MIT and local.

## Environment (measured 2026-08-28)

| Fact | Measurement |
|---|---|
| Dispatch worktree | no `node_modules` (0 entries); `pnpm store` warm at `~/Library/pnpm/store/v11`; install never ran before dispatch |
| MCP servers connected in session | `github`, `notion`, `tasks` only — **no iwsdk, no metavr** |
| IWSDK MCP inventory (sanctioned, per repo contract) | 32 expected tools; scene category is **read-only** (`scene_get_hierarchy`, `scene_get_object_transform`); no scene-authoring/composition tool exists in the inventory |
| `pnpm iwsdk:verify` | **exit 2** — see below |
| `@iwsdk/scene-composition@0.5.3` | installs standalone outside the repo (scratch dir `~/.openclinxr-tools/iwsdk-scene-composer-probe/`, same convention as rhubarb/infinigen); imports fine, 82 exports, `CURRENT_SCENE_VERSION = iwsdk.scene.v1` |

## Result 1 — the verify gate cannot run (done_when `run:pnpm iwsdk:verify`)

First command of the chain, exact output:

```
$ tsgo --noEmit -p tsconfig.vitest.json
error TS2688: Cannot find type definition file for 'node'.
  The file is in the program because:
    Entry point of type library 'node' specified in compilerOptions
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @openclinxr/iwsdk-spike@0.1.0 typecheck: `tsgo --noEmit -p tsconfig.vitest.json`
Exit status 2
[WARN]  Local package.json exists, but node_modules missing, did you mean to install?
[ELIFECYCLE] Command failed with exit code 2.
```

Exit code 2. The gate is `reject_measured` — it ran and failed closed on a
missing dependency (the worktree has no install), and the chain cannot proceed
to the cagematch-relevant steps (workspace posture, npm-currentness, evidence
contract) because the first `pnpm --filter` step never resolves. Full log:
`.openclinxr/evidence/issue-577/iwsdk-verify-run.log`.

## Result 2 — the composer accepts no case definition directly

Probe: `node .openclinxr/evidence/issue-577/iwsdk-scene-composer-probe.mjs`
(result: `.openclinxr/evidence/issue-577/iwsdk-scene-composer-probe-result.json`,
both gitignored). It feeds the **real** generated scene manifest for
`ed_chest_pain_priority_v1` (the case's runtime surface: stationId
`ed_chest_pain_station_v1`, 1 roomProp, 3 actor placements) into
`@iwsdk/scene-composition@0.5.3`.

| # | Step | Result |
|---|---|---|
| 0 | import the composer standalone | ok — 82 exports |
| 1 | read the case-definition manifest | ok — `openclinxr.runtime-scene-manifest.v1`, `ed_chest_pain_station_v1` |
| 2 | feed the manifest straight into `assertValidSceneDocument` | **rejected** — `version/units/resources/nodes` required and missing; `schemaVersion/manifestId/source` not allowed. Zero schema overlap |
| 3 | agent hand-maps roomProps + actorPlacements → `iwsdk.scene.v1` nodes | **5 fail-closed iterations, then green** (`composeSceneDocument` ok, 1 station node, 3 actors) |
| 4 | `assertValidSceneDocument` on the mapped document | ok after iteration 5 |

The five iterations and the precise failure each time:

1. prefab needs `root` (an object), not `content`; node content is a `type`-discriminated union.
2. `framingRole` is a closed enum `{content, support}` — OpenClinXR's
   `semanticRole` (`objective_cue`, …) and `slotKind` (`primary_patient`,
   `clinical_team`, `family_or_observer`) are **not in the enum**; the clinical
   role vocabulary does not survive the mapping.
3. metadata extension keys must be namespaced (`ocx:*`).
4. every metadata key including `evidenceCue` must be namespaced.
5. green.

## Scorecard against the card's plausible outcomes

1. *Verify gate green, composer consumed* — **not measured**: gate cannot run (Result 1).
2. *Case definition composes directly* — **refuted**: zero schema overlap (probe step 2).
3. *Agent-driven composition works with a mapping* — **measured true, and it is the
   anti-pattern**: the package composes a valid station document, but only after
   an agent hand-authoring the case→`iwsdk.scene.v1` field mapping per station.
   D9/D1 forbid that as the production path; a deterministic adapter
   (case fields → scene nodes) would be a factory station and does not exist.
4. *Agentic tooling available to drive it* — **refuted for this session**: no
   IWSDK/`metavr` MCP connected; the sanctioned 32-tool IWSDK MCP inventory has
   no scene-authoring tool (scene category is read-only inspection).

## Decision

**Do not adopt** IWSDK scene-composition as a `room_generate` producer for
OpenClinXR. Not because the package is bad — it is MIT, local, deterministic,
and pleasant to fail against — but because the claim "build a station from a
case definition" requires an adapter that does not exist, and building one is a
factory-station slice, not something this cagematch can ship. The right next
slice (if pursued) is a deterministic `openclinxr case/manifest → iwsdk.scene.v1`
adapter inside `packages/openclinxr/arena/iwsdk-spike` (allowed first-slice
package per `buildIwsdkPreInstallPackagePolicy`), with the `framingRole` enum
and namespaced-metadata constraints recorded in its contract.

## Residual / NOT TESTED

- The full `pnpm iwsdk:verify` chain (workspace posture, npm-currentness,
  evidence contract, quest MR check) was never reached — the first step blocks.
  A provisioned worktree (`pnpm install`) could clear Result 1; it would not
  change Result 2.
- No attempt was made to run the IWSDK dev MCP server or `metavr` (cloud);
  neither is connected in this session.
- `claimScope`: this is a tool-capability cagematch on this machine on
  2026-08-28. `notEvidenceFor`: any readiness claim about IWSDK or Quest
  validation, any clinical validity claim, and any statement about `metavr`
  behaviour (different package, not exercised).
