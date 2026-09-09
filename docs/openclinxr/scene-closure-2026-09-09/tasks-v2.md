# Scene closure worker contracts — delegation revision 2

Supersedes the first SC card set. [Acceptance](./acceptance-v2.md), [proof contract](./proof-contract-v2.md), [delegation protocol](./delegation-v2.md). Actual IDs are in the current [board manifest](./board-manifest.md).

## Common execution contract

Implementation release is controlled by the user handoff, not this document. Keep cards Idle/backlog during preparation. When the user assigns an executing owner to this package, that instruction authorizes that owner to release eligible package tasks under the documented board protocol; no additional per-card permission is required. Do not execute unrelated board work.

Every worker must read the pinned acceptance-v2.md, proof-contract-v2.md and its card. Baseline regressions are preserved, but cannot close new behavior. New named behavior tests, an expected-failure-marker check, verifier unit tests and a direct actual-evidence verifier are separate mandatory gates. Missing future files fail until the owning worker creates them; no test/product implementation is included in this preparation. Establish the real broken-behavior control first, then fix it. An absent report is not a behavioral counterexample.

The direct verifier cannot emit success from a fixture, report-authored status flag, missing input, empty sample set or merely successful child statuses. It must resolve actual source/artifact identities and required observations/negative controls under the frozen proof contract. A reviewer inspects the implementation of each new verifier and test before trusting its green result. The owner then reruns every actual doneWhen against the integrated source revision and evidence inputs before proofs.set; that API records an attestation and does not execute checks.

Keep worktrees and evidence job paths isolated. Default to serial execution of this package; overlap detection remains mandatory if independent branches are run concurrently. No threshold/contract weakening, credential or hidden-data export, public Pages push, or clinical/headset claims without their distinct evidence. Technical acceptance can honestly state qualified clinical review pending; it cannot silently claim it. A new required defect is repaired under the failed row's original scope with reviewer rerun; do not abandon the parent or hide it in notTested.

## SC-P — One verified encounter and its website proof (r2)

Non-executable parent of SC-00 through SC-09; SC-10 is a sibling depending on SC-09. Close only after the independent owner verifies every A01–A12 row on the complete normal-workflow run, retrieves and plays originals and site edit, repeats decisive negatives and verifies replay. No closure from child counts or a report's presence. The parent directly reruns the SC-09 actual-evidence verifier and the normal final acceptance test, plus Pages regression checks. SC-09's proof root/report are the parent's read-only verification inputs; it writes only its public-safe final receipt. The parent is never planted or dispatched as a worker. Clinical/headset claims and public deployment remain separate; preparation status is not a permanent exemption from A01–A12.

## SC-01 — A persisted synthetic encounter determines the room that UI-XR actually loads (r2)

**Objective:** Author and persist scene_closure_supine_bedside_v1 through the normal review, catalogue, factory and bundle handoff so its approved version, actors, room, exact support and required/optional/absent equipment control the loaded main UI-XR scene without scenarioBank overrides.

**Role:** implementation-planning-lead with scenario authoring/API specialist. **Depends on:** none. **Factory step:** room_generate.

### Required behavior

- A01: Use existing ScenarioCatalogPort/authored-first lookup. New persisted ID and changed authored version must reach normal compiled/bundled/main-UI consumer; editing fixtures or injecting a bundle in the recorder cannot satisfy this.
- Explicitly preserve patient_margaret_ellis_v1 and senior_resident_ward_v1 identities, authored supine support/frame and physician start/destination in the SAME synthetic encounter. Preserve original Ward case and schedule. Create the shared versioned selected-case/asset manifest at tools/openclinxr/factory/scene-closure-case-source.ts as authoring input, never a runtime fixture lookup. Its supported producer must persist/review/compile it. Pin selected existing room/assets; reviewed synthetic schedule and setup are separate from borrowed clinical facts.
- Connect contents binding to real producer and mount paths. Required bindings carry source activity/rule; alias precedence is explicit. Optional and intentionally absent decisions remain authoritative, including the current unconditional ED ECG/IV defaults; multiple copies retain distinct realized IDs.
- Add production-boundary regression tests and normal-workflow browser evidence for save/load/edit/compile/load, including a wholly new scenario ID. Evidence identifies persisted revision, selected version and loaded entities. A visual-review-only learner_use_blocked or metadata_only fallback is not positive handoff proof.
- Completion gate: create/extend apps/api/src/the-persisted-scene-reaches-the-normal-xr-consumer.test.ts with the exact ordinary it title SC-01-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-01/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-01.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- Unknown/unreviewed binding refuses; reordered asset list keeps identity/binding stable; deliberately absent ECG/IV is not injected; two copies do not collapse; stale fixture version cannot override persisted version; misidentified physician is named/refused.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

Existing authored-first ScenarioCatalogPort and scenario-promotion-path tests are retained. New persisted ID must differ from fixture cases; intentionally absent equipment is the negative control. Do not treat metadata_only/learner_use_blocked bundles as a working learner encounter.

### Scope and limits

UI-XR edits in SC-01 are limited to scenario/bundle selection and loading. Do not edit runtimeActorPlacement or the supportedActorPlacementPosition call; SC-03 owns those changes. A04/A05 stay OPEN. This card establishes case-to-scene delivery, not full initial-state admission or motion. Those remain mandatory in SC-02/03/05. Do not implement a second catalogue, generalized room synthesis or inferred clinical setup. Freeze exact selection for SC-04; changes after pinning invalidate dependent evidence.

### Write roots

- packages/openclinxr/shared-schemas
- packages/openclinxr/scenario-runtime/src/scenario-catalog.ts
- packages/openclinxr/asset-registry
- packages/openclinxr/ui-route-admin
- apps/api/src
- tools/openclinxr/factory
- tools/openclinxr/dark-factory/multi-case-runner.ts
- packages/openclinxr/xr-station/src/station-equipment.ts
- apps/ui-xr/src/main.ts
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-01.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-01
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-01.json

### Exact doneWhen gates

```text
run:pnpm exec vitest run apps/api/src/scenario-promotion-path.test.ts apps/api/src/encounter-runtime-handoff.test.ts packages/openclinxr/asset-registry/src/the-scene-contents-bind-or-refuse.test.ts
run:pnpm exec vitest run tools/openclinxr/factory/the-placement-node-carries-the-authored-offset.test.ts
run:pnpm exec vitest run apps/api/src/the-persisted-scene-reaches-the-normal-xr-consumer.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts apps/api/src/the-persisted-scene-reaches-the-normal-xr-consumer.test.ts SC-01-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-01/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-01/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-01.json --scope packages/openclinxr/shared-schemas --scope packages/openclinxr/scenario-runtime/src/scenario-catalog.ts --scope packages/openclinxr/asset-registry --scope packages/openclinxr/ui-route-admin --scope apps/api/src --scope tools/openclinxr/factory --scope tools/openclinxr/dark-factory/multi-case-runner.ts --scope packages/openclinxr/xr-station/src/station-equipment.ts --scope apps/ui-xr/src/main.ts --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-01.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-01 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-01.json
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-01.md
changed:tools/openclinxr/factory/scene-closure-case-source.ts
```

## SC-02 — Observed requirements control actual API/UI encounter entry and scheduled effects (r2)

**Objective:** Replace positional consumer labels with actual run-bound capability observations and make every required starting predicate control the existing encounter admission owner and ordered event execution.

**Role:** runtime/API integration specialist with adversarial state-machine reviewer. **Depends on:** SC-01. **Factory step:** dialogue_runtime.

### Required behavior

- A02/A03: Fix the reproduced runtime-owned requiredStates hole. Every required unsatisfied/pending/unknown outcome blocks actual acceptance through API and UI, not only a pure helper. The nonempty prototype cannot pass because requirements or observations were omitted.
- Observe capability and actual realized instance/version; bind evidence to active run/session, case/requirement revision and observation freshness. Reject client-authored success, wrong-run/stale/replaced observations. List index or supplied asset ID is not a consumer acknowledgment.
- Separate initial predicate connected=false from later learner goal connected=true. Verified disconnected can satisfy the initial state without completing the goal; unknown/pending does not prove incompleteness. Preserve case-owned physiology/state and pure spec-module lifecycle boundary.
- Gate ScenarioRuntime.startEncounter, the API start-encounter route and initializeRemoteTraceSession in UI-XR through the EXISTING transition owner and normal endpoint: pending-to-ready yields one valid transition with actual time, snapshot before due-zero effects, no new phase/reset/duplicate START_ENCOUNTER. Wire timing caller, apply scheduled effect, record acknowledged execution, handle duplicate tick/retry and failed effects without marking them irretrievably complete first.
- Post-admission removed/replaced required assets or changed predicates invalidate acceptance and signal execution stop/refusal; SC-05 consumes this signal. Demonstrate delayed load, direct API bypass attempt, successful entry and an effect-failure retry through production owners.
- Completion gate: create/extend apps/api/src/the-observed-scene-gates-entry-and-due-zero-effects.test.ts with the exact ordinary it title SC-02-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-02/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- Present asset + runtime required unsatisfied/pending/unknown each refuses; replay another session acknowledgment refuses; reordered monitor retains consumer; satisfied learner GOAL before start refuses while observed initial connected=false succeeds; failed effect retries without duplicate successful effect or clock reset.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

Prior tsk_e97804d9ab7be894 explicitly reported rather than enforced requirements; tsk_863df7eccab8d6e9 only made readiness truthful; tsk_dbb2a9b35361d60b excluded second-zero ordering. A present asset with runtime-owned unsatisfied/pending/unknown requirement still exposes the admission gap at baseline. Preserve an ordinary satisfied transition and observed initial connected=false control.

### Scope and limits

No new phase does not exclude enforcement. Keep pure specification code pure and enforce at existing runtime/API/UI owners. Do not pre-apply events in a planner or create a parallel clock/state store. Helper tests and method existence alone cannot close this card.

### Write roots

- packages/openclinxr/shared-schemas
- packages/openclinxr/scenario-runtime
- packages/openclinxr/domain
- packages/openclinxr/session-state
- packages/openclinxr/xr-capture-evidence
- packages/openclinxr/xr-asset-loading
- apps/api/src
- apps/ui-xr/src
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-02
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.json

### Exact doneWhen gates

```text
run:pnpm exec vitest run packages/openclinxr/scenario-runtime/src/the-scene-spec-gates-promotion.test.ts packages/openclinxr/scenario-runtime/src/the-planner-stays-inside-its-boundary.test.ts packages/openclinxr/scenario-runtime/src/a-scheduled-event-fires-once-at-its-second.test.ts
run:pnpm exec vitest run apps/api/src/scenario-promotion-path.test.ts apps/api/src/encounter-runtime-handoff.test.ts
run:pnpm exec vitest run apps/api/src/the-observed-scene-gates-entry-and-due-zero-effects.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts apps/api/src/the-observed-scene-gates-entry-and-due-zero-effects.test.ts SC-02-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-02/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-02/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.json --scope packages/openclinxr/shared-schemas --scope packages/openclinxr/scenario-runtime --scope packages/openclinxr/domain --scope packages/openclinxr/session-state --scope packages/openclinxr/xr-capture-evidence --scope packages/openclinxr/xr-asset-loading --scope apps/api/src --scope apps/ui-xr/src --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-02 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.json
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.md
```

## SC-04 — The exact demonstration assets have trustworthy provenance and compatible rights (r2)

**Objective:** Pin and clear the selected encounter asset/motion set for adopted/shipped use and separately for rendered public demonstration; repair selected provenance from derivation evidence and replace incompatible or unresolved motion without dropping walking.

**Role:** asset-pipeline-lead plus licence specialist. **Depends on:** SC-01. **Factory step:** motion_retarget.

### Required behavior

- A06: Enumerate the actually selected room, support, patient/physician, clothing/textures, equipment, clip and any voice/audio. Pin code/weights/data/body/dependency and output rights where applicable. Separate source/shipped adoption from rendered-public clearance; link exact first-party terms and modifications.
- Resolve selected hash mismatches using reproducible derivation or justified rebuild, never by replacing a recorded hash solely to match unexplained bytes. Preserve cleared unchanged assets. Existing physician matched in the baseline review; 8/13 other sidecars mismatched, not a mandate to regenerate all 13.
- Resolve conditional CMU walk terms against strict permissive/non-copyleft policy and publication rights. Unresolved/incompatible terms mean use cleared or project-authored motion with equivalent approach behavior. Do not convert commercial permission into a permissive label or transfer another demo UUID clearance.
- SC-04 owns approved substitutions in tools/openclinxr/factory/scene-closure-case-source.ts after SC-01. Re-run the supported authoring producer and case/bundle compilation, verify actual loaded selection, increment version and invalidate descendants; sidecar-only or runtime overrides are forbidden. Deliver the selected asset/rig/clip manifest and separate explicit public-render decision used by capture and website gates. Verify retarget/graft preserves mesh/limb integrity and expected canonical mapping; installed MPFB GPL build-tool distinction remains, not a new AGPL fix.
- Completion gate: create/extend tools/openclinxr/evidence/licence/the-selected-scene-assets-have-cleared-byte-lineage.test.ts with the exact ordinary it title SC-04-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-04/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-04.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- Stale hash, unknown subcomponent rights, substituted clip and rewritten-only provenance refuse; exact cleared unchanged assets pass; no automatic blanket clearance from an MIT repository or from a public video.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

The selected physician sidecar matched baseline; 8/13 comparable other sidecars mismatched, not all 19 GLBs. Existing MPFB build-tool licence label is already corrected. Verify selected exact assets; preserve cleared unchanged bytes and resolve conditional CMU terms without falsely labeling them permissive.

### Scope and limits

Do not rewrite the injected-drive displayed-walk capture to bless movement; SC-04 may change only the listed bound-clip/graft measurement tests. No whole-catalogue cleanup, hardware purchase or new model adoption. Public rights are a prerequisite, not permission to publish. Changing selected bytes invalidates rubric/capture descendants; communicate updated manifest before their release.

### Write roots

- apps/ui-xr/public/generated-humanoids
- apps/ui-xr/public/xr-assets
- docs/openclinxr/asset-licence-records
- docs/openclinxr/third-party-asset-licence-ledger.md
- tools/openclinxr/factory/graft-bound-clip.ts
- tools/openclinxr/factory/scene-closure-case-source.ts
- tools/openclinxr/evidence/licence
- tools/openclinxr/evidence/foot-plant/the-bound-walk-plants-its-feet.test.ts
- tools/openclinxr/factory/graft-bound-clip.test.ts
- packages/openclinxr/factory-stations/src/motion_retarget
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-04.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-04
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-04.json

### Exact doneWhen gates

```text
run:pnpm exec vitest run tools/openclinxr/evidence/licence/the-mpfb-record-matches-the-installed-release.test.ts tools/openclinxr/factory/graft-bound-clip.test.ts
run:pnpm exec vitest run tools/openclinxr/evidence/foot-plant/the-bound-walk-plants-its-feet.test.ts
run:pnpm exec vitest run tools/openclinxr/evidence/licence/the-selected-scene-assets-have-cleared-byte-lineage.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts tools/openclinxr/evidence/licence/the-selected-scene-assets-have-cleared-byte-lineage.test.ts SC-04-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-04/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-04/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-04.json --scope apps/ui-xr/public/generated-humanoids --scope apps/ui-xr/public/xr-assets --scope docs/openclinxr/asset-licence-records --scope docs/openclinxr/third-party-asset-licence-ledger.md --scope tools/openclinxr/factory/graft-bound-clip.ts --scope tools/openclinxr/factory/scene-closure-case-source.ts --scope tools/openclinxr/evidence/licence --scope tools/openclinxr/evidence/foot-plant/the-bound-walk-plants-its-feet.test.ts --scope tools/openclinxr/factory/graft-bound-clip.test.ts --scope packages/openclinxr/factory-stations/src/motion_retarget --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-04.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-04 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-04.json
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-04.md
```

## SC-00 — Independent controls freeze the measurement rubric before runtime motion is graded (r2)

**Objective:** Create and independently approve an executable, versioned geometry/motion/evidence rubric tied to the selected assets, with good/broken controls and numeric tolerances before downstream placement/motion acceptance.

**Role:** independent measurement/QA specialist and visual reviewer. **Depends on:** SC-04. **Factory step:** instrument.

### Required behavior

- A08 prerequisite: independent reviewer, not the motion implementer alone, fixes support, signed floor contact/penetration, swept collision, foot-slide, heading/arrival, anatomy/skin and timestamp/sample sufficiency thresholds before SC-03/05 release. Record asset/rig/frame hashes, rationale and actual numeric thresholds in the rubric.
- Acceptance contract caps arrival error at 0.05 m and settled yaw error at 10 degrees with two seconds stopped observation. Other thresholds cannot be chosen after seeing implementation failures or inflated to admit obvious visible defects; changing a rubric requires independent review and all controls rerun.
- Controls must include known-good support, intentionally sliding/penetrating foot, missing contact windows, zero skinned samples, absent actor, thin obstacle between old waypoint samples, wrong support/frame and clip flag without motion. Signed contact height must be relative to the selected floor; unsupported geometry explicitly refuses.
- The verifier must consume measured output and reject malformed/stale/wrong-run evidence. Controls may test the measurement instrument independently, but cannot be presented as normal-runtime success. Document how SC-07 observes production without injecting actor behavior.
- Completion gate: create/extend tools/openclinxr/evidence/scene-closure/the-measurement-rubric-rejects-broken-controls.test.ts with the exact ordinary it title SC-00-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-00/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- Each broken control fails its named metric; good controls pass; deleting a metric/sample or claiming no contacts must fail rather than evade grading; oracle cannot accept its own pre-filled success flag.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

Existing displayed-walk and bound-clip tests are instrument/control references, not normal encounter proof. Use known-good measured controls versus signed penetration, missing stance/contact samples, sliding and thin obstacles; do not require SC-05 motion to work before freezing the rubric.

### Scope and limits

Instrument-only is intentional for this prerequisite; it closes no full encounter requirement by itself. Do not fix runtime code or start learned inference here. New instrument tests are created by this FUTURE task; this planning package contains no implementation/tests.

### Write roots

- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-00
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.json
- tools/openclinxr/evidence/scene-closure/the-measurement-rubric-rejects-broken-controls.test.ts

### Exact doneWhen gates

```text
run:pnpm exec vitest run tools/openclinxr/evidence/foot-plant/the-runtime-displays-the-walk.test.ts tools/openclinxr/evidence/foot-plant/the-walk-clip-plants-its-feet.test.ts tools/openclinxr/evidence/foot-plant/the-bound-walk-plants-its-feet.test.ts
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/the-measurement-rubric-rejects-broken-controls.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts tools/openclinxr/evidence/scene-closure/the-measurement-rubric-rejects-broken-controls.test.ts SC-00-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-00/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-00/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.json --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-00 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.json --scope tools/openclinxr/evidence/scene-closure/the-measurement-rubric-rejects-broken-controls.test.ts
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.md
```

## SC-03 — The patient remains supported by the exact mounted instance and every slot preserves intent (r2)

**Objective:** Connect exact observed support geometry and identity to live patient composition and acceptance, preserving persisted placement and heading through mount, slot repair, framing and animation.

**Role:** XR systems architect / placement integration specialist. **Depends on:** SC-02, SC-00. **Factory step:** staging.

### Required behavior

- A04/A05: live caller supplies required support ID, actual mounted geometry/version and readiness to the existing acceptance owner. Delayed exact mount stays pending; wrong instance cannot substitute; invalid authored offset refuses real acceptance rather than warning-and-success.
- Compose world-metre support tangent/normal offsets in a defined orthonormal frame with no double scale; standing uses named floor frame. Preserve outer slot vs loaded child transforms and authored provenance through slot repair, framing, pose, idle and speech; selected actor heading survives repair on all relevant slots.
- Use persisted/frozen case intent rather than scenarioBank fallback over authored cases. Measure the actual posed/skinned patient and named support after frame updates; keep an unauthored supine control stable and distinguish it from a vacuous equal-default assertion.
- Edit a valid support-relative offset through the normal authoring path and measure the expected world delta on the loaded posed/skinned patient after framing and subsequent animation updates while the unauthored control remains unchanged. Mount replacement/removal invalidates support observation and stops/refuses dependent motion/acceptance. Explicit missing physician is reported, not substituted. Connect readiness results, not only expose helper options: runtimeActorPlacement must pass supportInstanceId and observed mounted IDs and consume pending/refused readiness. Consume headingRadians on primary_patient and clinical_team as well as additional_cast, preserving it through repair.
- Completion gate: create/extend apps/ui-xr/src/the-mounted-support-controls-the-posed-patient.test.ts with the exact ordinary it title SC-03-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-03/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-03.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- Slow support, same-kind wrong support, post-acceptance replacement, invalid normal offset, malformed frame, changed GLB scale, slot-kind repair, authored vs unauthored controls all exercise actual consumer behavior.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

Prior tsk_ebdeed78d4e75141 composes authored offset; the later composition-call-site test closes a narrow caller gap. Baseline live runtimeActorPlacement still omits exact support observations and ignores readiness. Preserve unauthored supine and standing positions while testing a changed authored offset, delayed exact support and wrong same-kind instance.

### Scope and limits

Do not change settled placement to hide bad animation or substitute primitive ED bounds for explicit generated support. SC-05 owns travelling physician; SC-03 must leave a measured stable patient and correct actor/heading identities.

### Write roots

- packages/openclinxr/asset-registry
- packages/openclinxr/xr-runtime-state
- packages/openclinxr/xr-station
- packages/openclinxr/xr-station-room
- packages/openclinxr/xr-asset-loading
- packages/openclinxr/xr-scene
- packages/openclinxr/xr-pose
- apps/ui-xr/src
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-03.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-03
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-03.json

### Exact doneWhen gates

```text
run:pnpm exec vitest run packages/openclinxr/asset-registry/src/an-authored-offset-needs-a-frame.test.ts packages/openclinxr/asset-registry/src/authored-intent-is-not-substituted.test.ts packages/openclinxr/xr-runtime-state/src/a-resolved-placement-says-where-it-came-from.test.ts
run:pnpm exec vitest run packages/openclinxr/xr-runtime-state/src/the-sway-composes-onto-the-heading.test.ts apps/ui-xr/src/the-composition-call-site-is-live.test.ts
run:pnpm exec vitest run apps/ui-xr/src/the-mounted-support-controls-the-posed-patient.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts apps/ui-xr/src/the-mounted-support-controls-the-posed-patient.test.ts SC-03-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-03/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-03/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-03.json --scope packages/openclinxr/asset-registry --scope packages/openclinxr/xr-runtime-state --scope packages/openclinxr/xr-station --scope packages/openclinxr/xr-station-room --scope packages/openclinxr/xr-asset-loading --scope packages/openclinxr/xr-scene --scope packages/openclinxr/xr-pose --scope apps/ui-xr/src --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-03.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-03 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-03.json
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-03.md
```

## SC-05 — The case-selected physician walks to the measured bedside target and stops in UI-XR (r2)

**Objective:** Drive the existing approach planner/executor and cleared clip through normal case-owned runtime execution using mounted patient/equipment geometry, with measured arrival, contact quality and invalidation-to-stop.

**Role:** motion/runtime integration specialist with XR and visual QA reviewer. **Depends on:** SC-03. **Factory step:** staging.

### Required behavior

- A05/A07/A08: normal encounter selects explicit physician ID/start/target; execute existing plan/executor and cleared clip without recorder globals, direct test executor calls or learner locomotion. Correct actor appears in same supine encounter and stops at accepted target facing patient.
- Resolve case-authorized side/standoff/monitor view/workspace from actual patient, support, equipment and actor geometry. Check swept occupancy, including between-waypoint thin obstacles; no empty obstacle list or hardcoded ED position can establish safety.
- Bind accepted plan to current observed geometry/run/version; refuse forged/stale clear plan. Required state/support/obstacle change during travel stops/invalidate execution. Blocked explicit side and missing physician refuse rather than nurse/side substitution.
- Use SC-00 frozen rubric on actual loaded skeleton/skin across timestamps, stance/transition/stop intervals. Arrival <=0.05 m, settled yaw <=10 degrees and two-second stop; no obvious limb damage/sliding/penetration admitted by weakening thresholds. Preserve patient support, speech/gaze layering, chain ownership and interruption/replay identity.
- Record normal-workflow browser measurements as well as extended production-boundary tests. Existing injected-drive toe-span video or offline bound-clip percentages cannot close runtime arrival/contact requirements.
- Completion gate: create/extend apps/ui-xr/src/the-normal-encounter-physician-approaches-and-stops.test.ts with the exact ordinary it title SC-05-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-05/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-05.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- Missing physician, nurse occupying first clinical slot, blocked authored side, thin obstacle, plan/geometry revision mismatch, support removed mid-walk, clipPlayed without limb motion and continuing motion after stop each fail named acceptance.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

Existing approach/executor/clip code and authored-side refusal remain useful. Prior displayed walk used __openClinXrPedsDrive, so it cannot prove normal activation. Zero/absent skeleton samples or clipPlayed=true must fail; preserve the supported patient and test two seconds genuinely stopped.

### Scope and limits

No general navigation, clinical procedure hand contacts, streaming-model dependency or live patient animation required. Do not infer clinical standards from proxy dimensions; request review of selected task thresholds and state evidence limits.

### Write roots

- packages/openclinxr/asset-registry
- packages/openclinxr/xr-runtime-state
- packages/openclinxr/xr-humanoid-animation
- packages/openclinxr/xr-asset-loading
- packages/openclinxr/xr-station-room
- packages/openclinxr/xr-dialogue
- packages/openclinxr/xr-pose
- apps/ui-xr/src
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-05.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-05
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-05.json

### Exact doneWhen gates

```text
run:pnpm exec vitest run packages/openclinxr/asset-registry/src/the-approach-path-stops-at-the-target.test.ts packages/openclinxr/asset-registry/src/the-executor-arrives-and-feet-are-measured.test.ts
run:pnpm exec vitest run packages/openclinxr/xr-humanoid-animation/src/the-locomotion-drive-plays-a-clip.test.ts packages/openclinxr/xr-runtime-state/src/the-sway-composes-onto-the-heading.test.ts
run:pnpm exec vitest run apps/ui-xr/src/the-normal-encounter-physician-approaches-and-stops.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts apps/ui-xr/src/the-normal-encounter-physician-approaches-and-stops.test.ts SC-05-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-05/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-05/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-05.json --scope packages/openclinxr/asset-registry --scope packages/openclinxr/xr-runtime-state --scope packages/openclinxr/xr-humanoid-animation --scope packages/openclinxr/xr-asset-loading --scope packages/openclinxr/xr-station-room --scope packages/openclinxr/xr-dialogue --scope packages/openclinxr/xr-pose --scope apps/ui-xr/src --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-05.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-05 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-05.json
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-05.md
```

## SC-06 — Frozen scene and motion decisions replay and invalidate through the real consumer (r2)

**Objective:** Connect deterministic layout variation and existing durable review/replay owners so the accepted encounter reopens from versioned case/assets/solver/clip decisions and rejects stale or corrupt evidence.

**Role:** persistence/replay integration specialist. **Depends on:** SC-05. **Factory step:** staging.

### Required behavior

- A09: persist case/content IDs, support/actor/equipment instances, actual bytes, clip/rig/solver revisions, seed/index, resolved target/path/layout, acknowledgment snapshot, actual event order and run identity using existing review/replay boundaries.
- Reopen through normal consumer: same frozen version reproduces accepted geometry/arrival within the frozen rubric, multiple allowed indices explore authorized choices, impossible authored intent fails with named conflicts. Do not just hash an unused layout helper.
- Change/remove/corrupt selected case/bundle/GLB/clip/rig/solver evidence and prove consumer refuses stale acceptance; missing/corrupt/changed are distinguished. Repair requires fresh observation/revalidation, not overwriting sidecars.
- Keep server-only hashing/generation outside browser entry or provide explicit browser-safe interface. No second replay/state database; include dialogue turn identity when applicable.
- Completion gate: create/extend apps/ui-xr/src/the-normal-consumer-replays-and-invalidates-the-frozen-scene.test.ts with the exact ordinary it title SC-06-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-06/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- Same run manifest, changed geometry, stale plan, removed or corrupt artifact, different solver revision, impossible layout and authored side vs varied side; no clinical hidden facts in exported evidence.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

Existing seeded layout/refusal and supine byte-freeze helpers are retained. Distinguish real consumer reopening from rehashing a fixture; unchanged scoped case/asset/solver inputs are the known-good control and corrupt/stale actual dependencies must invalidate.

### Scope and limits

Reproducibility claims cover recorded versioned decisions and measured replay, not bit-identical learned inference/physics. Global unrelated provenance debt stays separately recorded.

### Write roots

- packages/openclinxr/asset-registry
- packages/openclinxr/scenario-runtime
- packages/openclinxr/session-state
- packages/openclinxr/review-workflow
- apps/api/src
- apps/ui-xr/src
- tools/openclinxr/evidence/supine-control-freeze
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-06
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.json

### Exact doneWhen gates

```text
run:pnpm exec vitest run packages/openclinxr/asset-registry/src/the-layout-varies-and-refuses.test.ts tools/openclinxr/evidence/supine-control-freeze/the-supine-control-station-is-frozen-by-asset-bytes.test.ts tools/openclinxr/evidence/supine-control-freeze/a-corrupt-artifact-is-refused.test.ts
run:pnpm exec vitest run tools/openclinxr/evidence/the-client-entry-does-not-reach-node-builtins.test.ts
run:pnpm exec vitest run apps/ui-xr/src/the-normal-consumer-replays-and-invalidates-the-frozen-scene.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts apps/ui-xr/src/the-normal-consumer-replays-and-invalidates-the-frozen-scene.test.ts SC-06-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-06/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-06/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.json --scope packages/openclinxr/asset-registry --scope packages/openclinxr/scenario-runtime --scope packages/openclinxr/session-state --scope packages/openclinxr/review-workflow --scope apps/api/src --scope apps/ui-xr/src --scope tools/openclinxr/evidence/supine-control-freeze --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-06 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.json
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.md
```

## SC-07 — An uninterrupted normal-workflow recording proves the complete encounter and its refusals (r2)

**Objective:** Produce a durable reviewed evidence package from the actual persisted-case main UI-XR workflow, correlating uninterrupted video, measured acceptance, negative controls and replay on the local M1 Max 64GB.

**Role:** independent browser-evidence/measurement engineer plus visual reviewer. **Depends on:** SC-06. **Factory step:** instrument.

### Required behavior

- A08/A10: recorder starts before activation and continues through real contents/state readiness, entry, supine support, physician approach/arrival and stopped observation. Capture exact normal persisted case/bundle, no visual-review-only/static fallback and no metadata-only scaffold.
- Recorder uses only normal inputs/camera controls plus read-only telemetry. It must not set readiness, actor transforms, pedsDrive/other locomotion globals, invoke executor or inject a plan. Add verifier controls that detect/deny bypass paths rather than making hidden exceptions.
- Video, measurements and replay share run identity, code/case/bundle/asset/clip/rig/solver hashes, actor/support/instance IDs, timestamps and phase/domain time. Report capture gaps and actual M1 hardware/runtime memory/frame/timing evidence; classify desktop evidence without Quest claims.
- Run frozen SC-00 verifier on actual displayed skeleton/skin, support/contact/sweep/arrival/heading/stop measurements; independent visual reviewer watches uninterrupted source and checks anatomy/scale/contact/equipment/quality. Negative recordings cover unsupported required state, wrong/missing support, blocked route and approved recovery/replay.
- Before capture, pin an existing authorized evidence-storage location, access policy, retention owner and retention period. Use the existing local volume outside disposable worker trees unless a different authorized store is available; no new cloud/paid/public upload is authorized. Retain original videos/reports there, verify independent retrieval and document retention/retrieval/hash. Produce sanitized public-proof derivative and summary with exact lineage, without hidden facts/tokens/personal data. Raw ignored local files and promised URLs cannot close delivery.
- Completion gate: create/extend tools/openclinxr/evidence/scene-closure/the-normal-workflow-walk-is-recorded.test.ts with the exact ordinary it title SC-07-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-07/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-07.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- Wrong actor, no skinned body, no contacts, nonmonotonic timestamps, flag-only motion, stale source hash, corrupted recording, review-only handoff and injected movement are rejected; reviewer must be able to retrieve and play all required artifacts.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

Legacy injected-drive footage can be a negative/control reference only. The new test and verifier require actual uninterrupted normal-activation recording with same-run timestamps, skeleton observations, independently retrieved originals and decode receipts.

### Scope and limits

Do not edit product movement to stage the film. If runtime fails, return the failing A row to its owner; this card is not permission to fake it. Budget/record storage and avoid committing raw or uncleared footage under docs. No public release.

### Write roots

- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-07.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-07
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-07.json
- tools/openclinxr/evidence/scene-closure/the-normal-workflow-walk-is-recorded.test.ts

### Exact doneWhen gates

```text
run:pnpm exec vitest run tools/openclinxr/evidence/foot-plant/the-runtime-displays-the-walk.test.ts
run:pnpm exec vitest run tools/openclinxr/evidence/the-client-entry-does-not-reach-node-builtins.test.ts
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/the-normal-workflow-walk-is-recorded.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts tools/openclinxr/evidence/scene-closure/the-normal-workflow-walk-is-recorded.test.ts SC-07-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-07/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-07/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-07.json --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-07.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-07 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-07.json --scope tools/openclinxr/evidence/scene-closure/the-normal-workflow-walk-is-recorded.test.ts
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-07.md
```

## SC-08 — The existing website presents a cleared edit of the verified encounter (r2)

**Objective:** Integrate a polished accessible demonstration into the existing static Pages website using the same accepted run, verified media lineage and public-output clearance, with local/review-branch playback evidence.

**Role:** frontend/accessibility specialist with evidence/publication reviewer. **Depends on:** SC-07. **Factory step:** instrument.

### Required behavior

- A11: extend docs/index.html/styles.css, not a new app/site. Short edited demonstration and poster derive from SC-07 accepted run with source hashes and edit ranges; caption claims reflect footage and accepted capability only.
- Offer accessible keyboard-operable playback, reviewed captions/transcript, poster, responsive layout, reasonable preload/compressed size and no forced audible autoplay. Set justified encoding/size/performance budget before media commit. Link full sanitized proof and concise limitations.
- Verify actual browser playback, seeking, captions, desktop/mobile layout and artifact link retrieval, with watched visual evidence. HTML string checks and pages validator alone are insufficient. Missing/replaced media or lineage mismatch blocks acceptance.
- Verify selected source and rendered-public rights from SC-04, publication sanitization from SC-07, and synthetic sentinel exclusion across ALL artifacts entering docs. Clearly label desktop demonstration and avoid clinical/Quest/autonomy claims not established.
- Deliver website integration and public package ready for separate release. Pages deploys all docs on qualifying main push: keep preview/review branch until explicit release authorization; do not change workflow to bypass this boundary. Record unpublished vs deployed status truthfully.
- Completion gate: create/extend tools/openclinxr/evidence/scene-closure/proofs/sc-08/the-reviewed-site-media-plays.test.ts with the exact ordinary it title SC-08-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-08/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- Missing caption file, broken video URL, stale substituted source, edit of a different run, raw trace/sentinel in docs, inaudible-only instruction inaccessible without transcript, mobile overflow and playback failure each detected.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

Existing docs/index.html and docs/styles.css are the production website. pages:sync-validate is a regression check, not playback evidence. Use the cleared source run for edit/poster/captions and test actual browser playback/seek and same-run lineage.

### Scope and limits

No new website framework, paid media host or implicit production deployment. Permission to implement a website task is not permission to claim clinical validation or silently expose raw evidence. Authorized publication later requires deployed URL playback verification.

### Write roots

- docs/index.html
- docs/styles.css
- docs/assets
- docs/openclinxr/videos
- tools/openclinxr/evidence/check-github-pages-site.ts
- tools/openclinxr/evidence/check-github-pages-site.test.ts
- tools/openclinxr/evidence/sync-github-pages-evidence-links.ts
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-08
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.json

### Exact doneWhen gates

```text
run:pnpm pages:sync-validate
run:pnpm exec vitest run tools/openclinxr/evidence/check-github-pages-site.test.ts
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-08/the-reviewed-site-media-plays.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts tools/openclinxr/evidence/scene-closure/proofs/sc-08/the-reviewed-site-media-plays.test.ts SC-08-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-08/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-08/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.json --scope docs/index.html --scope docs/styles.css --scope docs/assets --scope docs/openclinxr/videos --scope tools/openclinxr/evidence/check-github-pages-site.ts --scope tools/openclinxr/evidence/check-github-pages-site.test.ts --scope tools/openclinxr/evidence/sync-github-pages-evidence-links.ts --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-08 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.json
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.md
changed:docs/index.html
```

## SC-09 — Independent acceptance closes the complete encounter and website only on direct evidence (r2)

**Objective:** Audit every A01-A12 requirement against the actual integrated run and website package, reproduce critical negative controls and record explicit pass/fail/remaining claim boundaries before parent closure.

**Role:** independent adversarial integrator + visual/accessibility reviewer. **Depends on:** SC-08. **Factory step:** instrument.

### Required behavior

- Independently inspect normal authored-case consumer chain, run startup and motion, play source and edited recordings, reopen replay, inspect mounted IDs/hashes/measurements and actual website playback. Verify the declared restricted storage location/access/retention and independent retrieval of originals. Use the frozen rubric, not child success labels.
- Repeat decisive counterweights: present asset with runtime failed state; wrong-run observation; exact support delayed/replaced; selected physician absent; thin obstacle/stale plan; corrupt replay/video; wrong media lineage. Any failure keeps relevant A rows and parent open and is returned to owner.
- Produce an A01-A12 evidence matrix with exact versions, retrieved artifacts, measurements and review decisions, including named visual review. Clinical usefulness and worn-headset readiness cannot be claimed without corresponding qualified/human evidence; public release status remains distinct.
- Parent technical closure requires all A01-A12 technical/website deliverables and no unresolved required defect. Record A13 research status separately; no model availability or paper contradiction can masquerade as executed quality evaluation.
- Completion gate: create/extend tools/openclinxr/evidence/scene-closure/the-final-acceptance-rejects-incomplete-evidence.test.ts with the exact ordinary it title SC-09-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-09/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-09.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- All child cards landed but missing run/video; site strings correct but video fails; negative helper tests pass but real API bypass works; source/edited run mismatch; any of these must prevent closure.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

Earlier parent completion overinterpreted narrow component Landed states. The independent countercontrol is all-child-done with missing/incorrect runtime/media evidence: parent must remain open. Do not change product code or grading thresholds.

### Scope and limits

Independent review only; do not edit production code or thresholds while grading. Reopen/return owner tasks with evidence rather than shrinking requirements. This is not a publication authorization or clinical credential.

### Write roots

- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-09.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-09
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-09.json
- tools/openclinxr/evidence/scene-closure/the-final-acceptance-rejects-incomplete-evidence.test.ts

### Exact doneWhen gates

```text
run:pnpm exec vitest run packages/openclinxr/scenario-runtime/src/the-scene-spec-gates-promotion.test.ts packages/openclinxr/scenario-runtime/src/the-planner-stays-inside-its-boundary.test.ts
run:pnpm pages:sync-validate
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/the-final-acceptance-rejects-incomplete-evidence.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts tools/openclinxr/evidence/scene-closure/the-final-acceptance-rejects-incomplete-evidence.test.ts SC-09-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-09/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-09/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-09.json --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-09.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-09 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-09.json --scope tools/openclinxr/evidence/scene-closure/the-final-acceptance-rejects-incomplete-evidence.test.ts
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-09.md
```

## SC-10 — A pinned learned-motion candidate receives an honest eligibility and execution assessment (r2)

**Objective:** Preserve the research lane with exact version/rights/interface screening and, only when eligible and executable, compare one candidate against the connected baseline; distinguish holds from measured failures.

**Role:** motion research/compatibility specialist with licence reviewer. **Depends on:** SC-09. **Factory step:** motion_retarget.

### Required behavior

- A13: inspect exact code commit/checkpoint/body/encoder/data/output terms and pinned skeleton mapping for a candidate such as Kimodo-SOMA, not similarly named ports. Resolve README77/model-card30 revision relationship before claiming incompatibility; document what direct metadata proves and what still needs execution.
- Verify local M1 dependency/installation path without claiming CPU encoder offload establishes motion inference. Paid/remote execution or new gated terms require separate existing authorization. Do not download or execute ineligible models merely to finish a card.
- If eligible and available, compare same frozen case/rig/target with SC-06 baseline using SC-00 quality/constraint rubric, memory/latency/retarget/integration cost and actual displayed result. If no candidate is eligible, record precise first-party reason and baseline retention. Ambiguous/unavailable remains HOLD, not reject_measured or completed quality comparison.
- Return screened/executed/held distinctions, versioned evidence and next unblock. Research HOLD does not block honest baseline demonstration but remains visible and cannot be falsely closed as a measured cagematch.
- Completion gate: create/extend tools/openclinxr/evidence/scene-closure-research/the-research-verdict-matches-the-evidence.test.ts with the exact ordinary it title SC-10-required-behavior (a real test containing the required assertions, not a marker/comment). Use an ordinary non-skipped test of the production boundary or independent instrument/review behavior owned by this card. FIRST demonstrate its decisive broken-behavior control on the unchanged applicable dependency baseline, then implement and prove success. Import/build errors, absent files, missing reports, fixtures alone or expected-failure markers are not that behavioral RED. Test-path existence is a FUTURE execution deliverable, not a prerequisite to staging this card.
- Implement tools/openclinxr/evidence/scene-closure/proofs/sc-10/verify.ts and verifier.test.ts under the frozen proof-contract-v2.md. The direct CLI consumes docs/openclinxr/scene-closure-2026-09-09/evidence/sc-10.json plus retrieved actual evidence; it must never synthesize its own positive evidence or substitute fixtures. Unit tests exercise good/malformed/wrong-run/corrupt controls separately. The landing reviewer reruns the direct CLI against the integrated source tree and real artifact inputs, inspects source/consumer coverage and evidence, and rejects any missing requirement even if all commands pass.

### Negative controls

- Wrong Kimodo project, mismatched revision, inferred skeleton from uninspected weights, unknown data rights and no-inference performance claims all fail review.
- Verifier must exit nonzero for absent report/artifact, fixture fallback in an actual-evidence run, unresolvable hash/identity, missing required control, omitted requirement, skipped acceptance check and report-authored pass flags without observed evidence. Wrong run/source revision and out-of-scope modified files fail.

### Known-good / prior task lesson

Kimodo-SOMA README77/model-card30 relationship remains a pinned-documentation question, not an inference failure. Eligibility assessment can honestly end HOLD with exact first-party reason/next unblock; executed requires actual pinned measurements and display evidence.

### Scope and limits

No automatic learned-provider adoption, hardware purchase or required streaming runtime replacement. Core parent is A01-A12; this separately tracked A13 research lane must report its real outcome.

### Write roots

- tools/openclinxr/evidence/scene-closure-research
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-10.md
- tools/openclinxr/evidence/scene-closure/proofs/sc-10
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-10.json

### Exact doneWhen gates

```text
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure-research/the-research-verdict-matches-the-evidence.test.ts
run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts tools/openclinxr/evidence/scene-closure-research/the-research-verdict-matches-the-evidence.test.ts SC-10-required-behavior
run:pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-10/verifier.test.ts
run:pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-10/verify.ts --report docs/openclinxr/scene-closure-2026-09-09/evidence/sc-10.json --scope tools/openclinxr/evidence/scene-closure-research --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-10.md --scope tools/openclinxr/evidence/scene-closure/proofs/sc-10 --scope docs/openclinxr/scene-closure-2026-09-09/evidence/sc-10.json
exists:docs/openclinxr/scene-closure-2026-09-09/evidence/sc-10.md
```

