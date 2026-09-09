# SC-01S — the selection seam: API route and XR client both carry the chosen scenario

Card `tsk_c79ff7d5b8ebb854`. A-row A01. Worktree `sc-closure-sc-01s`, baseline `1da9ce04`.
Machine-readable evidence: [`sc-01s.json`](./sc-01s.json).

## What was wrong

SC-01 landed the route half. `GET /runtime/asset-bundles/:bundleId` reads `?scenarioId=`, resolves it
authored-first through the existing `ScenarioCatalogPort`/`resolveScenarioById`, hands the resolved
document to the bundle builder, and refuses an unresolvable id with `scenario_not_found` instead of
serving the ED bay.

That query parameter had zero production callers.
`getLearnerRuntimeAssetBundle(bundleId)` took no scenario argument
(`packages/openclinxr/xr-station/src/api-client.ts:155`), and `apps/ui-xr/src/main.ts:924` called it
without one while `main.ts:1017-1027` was already holding the learner's selection. Independent review
recorded this as A01 unmet.

Measured on `1da9ce04`, through the assembled client `main.ts:291,1464` imports and constructs, with
`ward_delirium_med_rec_v1` selected:

| | measured |
|---|---|
| requested URL | `http://localhost:8787/runtime/asset-bundles/local_exam_run%3Aed_chest_pain_local_encounter%3Aruntime-assets` |
| query string | none |
| served cast | `nurse_maria_alvarez_v1`, `patient_robert_hayes_v1`, `spouse_anna_hayes_v1` |
| served `scenarioId` | `ed_chest_pain_priority_v1` |

The ED bay, for a ward delirium case.

Failing assertion:
`expect(configured.urls[0]).toContain("?scenarioId=ward_delirium_med_rec_v1")` at
`tools/openclinxr/evidence/scene-closure/proofs/sc-01s/the-selected-scenario-reaches-the-route-through-the-client.test.ts:170`.
Baseline run: 4 failed, 1 passed. Captured as artifact `red-baseline-output`.

## What changed

One product file: `packages/openclinxr/xr-station/src/api-client.ts`.
`packages/openclinxr/rest/src/routes/runtime-evidence-routes.ts` is in the frozen roots and was read
but **not edited** — SC-01 had already made the route half correct, and the equipment regression
below was measured to be already gone rather than assumed.

`getLearnerRuntimeAssetBundle(bundleId, input?)` now resolves the learner's selected scenario id in
three steps, first non-empty wins, and appends `?scenarioId=` only when one is found:

1. `input.scenarioId` — an explicit call site.
2. `options.selectedScenarioId()` — a client constructed with the selection.
3. `readAmbientSelectedScenarioId()` — the same browser surfaces `main.ts:1017-1027` reads:
   `?scenarioId=`, then `?openclinxrScenarioId=`, then `localStorage["openclinxr.scenarioId"]`.

Step 3 is what gives the parameter a caller without editing `main.ts`, which is outside this card's
frozen write roots. `readAmbientSelectedScenarioId` returns `undefined` outside a browser and when
nothing is selected; it deliberately does **not** fall back to `main.ts`'s default scenario constant,
because an invented default here would put a scenario id on every request.

The option is on `StationApiClientOptions`, which `station-api-client.ts` passes through to the base
factory unchanged, so the assembled client `main.ts` uses inherits the behaviour with no edit to that
file either.

## Two-sided probe

| revision | result |
|---|---|
| `api-client.ts` reverted to `1da9ce04`, package rebuilt | 4 failed, 19 passed across the three suites |
| restored | 23 passed, 0 failed |

Named failures on the reverted revision: `SC-01S-required-behavior`, `fixture-id-still-resolves`,
`authored-shadows-fixture-of-same-id`, `equipment-survives-an-injected-document`.

`absent-scenario-id-keeps-prior-default` passed on **both** revisions. That is the point of it: it
asserts the no-selection request and payload stay byte-identical to
`createEdChestPainLocalLearnerRuntimeAssetBundle()` called with no arguments, so a change that always
appends a query fails it. The nine pre-existing clauses in
`packages/openclinxr/xr-station/src/api-client.test.ts` — including its bare-URL assertion at line 46
— also passed unchanged on both.

## The equipment regression, measured

Independent review recorded that injecting a resolved document emptied `equipment` and
`equipmentPlacements` for `ward_delirium_med_rec_v1` and `clinic_knee_pain_return_to_play_v1`. SC-01
fixed it by inverting the rule so silence is no longer read as refusal
(`packages/openclinxr/asset-registry/src/case-runtime-equipment.ts`). Measured through the route
rather than assumed:

| selection | `equipment` | `sceneManifest.equipmentPlacements` |
|---|---|---|
| none (default) | `ecg_cart_equipment`, `iv_stand_equipment` | 2 entries |
| `ed_chest_pain_priority_v1` | same | same |
| `ward_delirium_med_rec_v1` | same | same |
| `clinic_knee_pain_return_to_play_v1` | same | same |

The regression is absent. `equipment-survives-an-injected-document` compares both injected cases
against the uninjected default rather than against a literal, so it fails if either side moves.

`ed_chest_pain_priority_v2` returns 404 `scenario_not_found` with no `actors` in the body. That is the
corrected behaviour, not a regression.

## Verifier

The seeded trio was extended, not replaced. Two controls `proof-contract-v2.md` names by name were
absent from it and are now present: **malformed** (clause 16 — a non-object report, an unsupported
`schemaVersion`, another card's `cardKey`, a missing contract section) and **wrong-run** (clause 17 —
evidence from a different run, refused even though every hash resolves).

The measurement run is derived from `counterweight.fixedOutputArtifactId` rather than declared, so a
report cannot name whichever run suits it. Exactly one artifact is exempt: the one
`counterweight.baselineOutputArtifactId` names.

That exemption was earned rather than designed. The first version of the wrong-run rule refused this
card's own `absent-scenario-id-keeps-prior-default` control for citing the baseline run — and that
control is the strongest kind, one that held on both revisions. The rule was too strict, not the
evidence. It is narrowed to the one declared baseline artifact, and clause 18 is its counterweight:
rename what the counterweight calls its baseline and the same citation is refused again.

19 verifier clauses pass.

## Commands

| command | result |
|---|---|
| `vitest run apps/api/src/the-persisted-scene-reaches-the-normal-xr-consumer.test.ts` | 9 passed |
| `tsx tools/openclinxr/openclaw/assert-contract-live.ts … SC-01-required-behavior` | 1 contract live |
| `vitest run packages/openclinxr/xr-station/src/api-client.test.ts` | 9 passed |
| `vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-01s/verifier.test.ts` | 19 passed |
| `vitest run …/proofs/sc-01s/the-selected-scenario-reaches-the-route-through-the-client.test.ts` | 5 passed |
| `tsx …/proofs/sc-01s/verify.ts --report … --scope ×5` | exit 1, 4 unmet |

`verify.ts` refuses on exactly four requirements: `implementation.treeClean is not true`,
`implementation.changeCommits is empty`, `reviews is empty`, and `no accepted review by a reviewer
distinct from the implementer`. Two require a commit, which this worker was instructed not to make;
two require the integrator. Everything else it checks passed: every artifact resolved through the
registry and rehashed, every contract-document hash matched the file on disk, all five checks and
five controls were accepted, and the changed-file audit passed against the frozen scopes.

## The CLI was probed destructively against this report, not against fixtures

Each probe was applied to the real report and store, then reverted; the restored run returns the same
four residuals every time.

| probe | verify.ts said |
|---|---|
| appended 9 bytes to `cmd6-sc01s-behavior-test.txt` | `byteCount 373 but 382 bytes on disk`, then `sha256 mismatch` |
| moved `cmd1-behavior-test.txt` out of the store | `artifact cmd1-behavior-test: ENOENT … lstat` |
| added `apps/ui-xr/src/main.ts` to `changedFiles` | `changed file outside every frozen scope: apps/ui-xr/src/main.ts` |

## Evidence registry

No owner-created registry existed on this host. `proof-contract-v2.md` makes it owner-controlled, so a
**candidate** was created at `/Volumes/files/src/.openclinxr-sc-evidence/registry.json` and marked
`status: candidate_pending_owner_ratification`. Its content hash is bound into `sc-01s.json`, so a
replacement shows up as a mismatch rather than being silently accepted. **The execution owner must
ratify or replace it and re-run every proof command.**

## Claim scope

A locally selected scenario id reaching a local API route through the production client, and the
resolved case controlling the served bundle's cast.

## Not tested

- **No browser ran.** `window` is stubbed on `globalThis` for the ambient clauses. This proves the
  client reads the selection; it does not prove a Vite bundle in Chrome did.
- **`apps/ui-xr/src/main.ts` still passes no explicit argument.** The ambient path is what carries the
  id today. An explicit call site exists and is asserted as an API, not as a shipped caller.
- The client behaviour test lives under this card's proof root because
  `packages/openclinxr/xr-station/src/api-client.test.ts` is not in the frozen write roots and the
  changed-file audit rejects it.
- Dialogue, vitals and room props remain the ED literals for every case (SC-02's).
- `describeRuntimeBundleScenarioMatch` is not called here; `@openclinxr/xr-pose` is not on this path.
  Its entire input is `bundle.scenarioId`, which the clauses read directly.
- Clinical validity, scoring validity, learner launch readiness, worn-headset readiness and public
  deployment are separate claims and none is made.

## Owner additions after the implementer returned

Two facts the implementer could not settle, recorded here so the record is complete.

**The trusted store.** The implementer found no evidence registry and created a candidate at
`/Volumes/files/src/.openclinxr-sc-evidence/registry.json`, marked
`status: candidate_pending_owner_ratification`, because `proof-contract-v2.md` makes the registry
owner-controlled and forbids a worker defining it. An owner registry did already exist, at
`/Volumes/files/src/openclinxr/.openclinxr-local/scene-closure-evidence/registry.json`
(sha256 `12b1587daf25b3a1a48dece3df89115efe6f56a89ae32b10140728e3818394fb`); the brief failed to name
it or set `OPENCLINXR_SC_EVIDENCE_REGISTRY`, which is an owner defect rather than a worker one. The
six captured artifacts were moved into the owner store under `sc-01s/`, `sc-01s.json` was rebound to
the owner registry hash, and the candidate registry was removed. The artifact bytes are unchanged, so
every recorded `sha256` and `byteCount` still resolves.

**The route file.** `packages/openclinxr/rest/src/routes/runtime-evidence-routes.ts` is a frozen write
root of this card and does not appear in `implementation.changedFiles`, because this task did not
change it: the route half landed in `1da9ce04` under SC-01's commit, before the ownership defect was
corrected by superseding SC-01R with this card. SC-01's own report excludes that file for the same
reason, so it is attributed in exactly one place — here — rather than claimed twice or by neither.
The implementer verified the route's behaviour by measurement instead of editing on top of it, which
is the correct handling and is why `changedFiles` stays accurate.
