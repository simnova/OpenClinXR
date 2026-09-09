# Scene closure task contracts

Status: staged planning package. See [acceptance](./acceptance.md). Board IDs and release sequence are recorded in the package index once cards are created.

## Common worker contract

Implementation is NOT authorized by this document alone. Cards stay Idle/backlog until explicitly released. Work only from the board contract and reachable committed acceptance revision. Future workers use their own worktree/ports/artifact paths; integrate serially. Keep shared package exports/build configuration current before testing cross-package consumers. Overlapping write roots force serialization even if a lane label differs.

Each card lists baseline command entrypoints that exist today, not sufficient tests as they currently stand. Extend them or add appropriate production-path integration/browser tests. Run the new checks as well as listed regression commands, demonstrate the defect before and the fixed behavior after (or a remove-the-fix counterweight), and record exact command/results in the evidence report. `exists:` only proves the report exists; independent acceptance must inspect its evidence. No `it.fails`/skip left on the completed acceptance path, vacuous fixtures, helper-only/source-string assertions, a clip flag or a status screenshot can replace the named normal-runtime outcome.

Contracts/acceptance/rubric cannot be weakened by implementation workers. Record a genuine scope conflict and request owner correction before proceeding. Failed tests cannot be reclassified as out of scope when they implement the A rows owned by the card. `notTested` describes explicit external claim boundaries only, never the required outcome. No empty required sets for this nonempty prototype. Preparation leaves all cards Idle/backlog. Planting is an execution-release action because existing automation can dequeue planted work; it is prohibited during this preparation. Future execution requires explicit release.

All code tests and artifacts below are FUTURE implementation deliverables. Planning does not add product code, test implementations, dummy media or fake evidence. Raw evidence stays outside auto-published docs; card reports under docs must contain only public-safe summaries and authorized artifact references. A final report must name how an independent reviewer retrieved and checked the originals.

## SC-P — One verified encounter and its website proof

**Objective:** close A01–A12 on one persisted `scene_closure_supine_bedside_v1` encounter and its website package, only after independent SC-09 review retrieves and plays the source video and edited site media, verifies the full matrix on that same run, and repeats decisive counterweights. Child Landed statuses are insufficient.

**Owner:** independent integrator. **Depends on:** none (non-executable parent). **Children:** SC-00 through SC-09 only. SC-10 is a separate sibling after SC-09; research HOLD cannot block or falsely close baseline acceptance.

**Prepared state:** Idle/backlog; do not plant. No worker session or worktree is minted. Final machine gates include the actual SC-09 evidence report and `pnpm pages:sync-validate`; neither alone substitutes for direct full-outcome review. Final source retrieval, same-run video/site lineage and A01–A12 acceptance are required card behavior, not optional prose.

**Write scope:** future public-safe SC-09 final acceptance summary only, not runtime implementation. Explicit public release, clinical and worn-headset claims need their own evidence/authorization.

## SC-01 — A persisted synthetic encounter determines the room that UI-XR actually loads

**Objective:** Author and persist scene_closure_supine_bedside_v1 through the normal review, catalogue, factory and bundle handoff so its approved version, actors, room, exact support and required/optional/absent equipment control the loaded main UI-XR scene without scenarioBank overrides.

**Role:** implementation-planning-lead with scenario authoring/API specialist. **Depends on:** none. **Factory step:** room_generate.

### Required behavior

- A01: Use existing ScenarioCatalogPort/authored-first lookup. New persisted ID and changed authored version must reach normal compiled/bundled/main-UI consumer; editing fixtures or injecting a bundle in the recorder cannot satisfy this.
- Explicitly preserve patient_margaret_ellis_v1 and senior_resident_ward_v1 identities, authored supine support/frame and physician start/destination in the SAME synthetic encounter. Preserve original Ward case and schedule. Create the shared versioned selected-case/asset manifest at tools/openclinxr/factory/scene-closure-case-source.ts as authoring input, never a runtime fixture lookup. Its supported producer must persist/review/compile it. Pin selected existing room/assets; reviewed synthetic schedule and setup are separate from borrowed clinical facts.
- Connect contents binding to real producer and mount paths. Required bindings carry source activity/rule; alias precedence is explicit. Optional and intentionally absent decisions remain authoritative, including the current unconditional ED ECG/IV defaults; multiple copies retain distinct realized IDs.
- Add production-boundary regression tests and normal-workflow browser evidence for save/load/edit/compile/load, including a wholly new scenario ID. Evidence identifies persisted revision, selected version and loaded entities. A visual-review-only learner_use_blocked or metadata_only fallback is not positive handoff proof.

### Counterweights

- Unknown/unreviewed binding refuses; reordered asset list keeps identity/binding stable; deliberately absent ECG/IV is not injected; two copies do not collapse; stale fixture version cannot override persisted version; misidentified physician is named/refused.

### Scope and limits

UI-XR edits in SC-01 are limited to scenario/bundle selection and loading. Do not edit runtimeActorPlacement or the supportedActorPlacementPosition call; SC-03 owns those changes. A04/A05 stay OPEN. This card establishes case-to-scene delivery, not full initial-state admission or motion. Those remain mandatory in SC-02/03/05. Do not implement a second catalogue, generalized room synthesis or inferred clinical setup. Freeze exact selection for SC-04; changes after pinning invalidate dependent evidence.

### Write roots

- `packages/openclinxr/shared-schemas`
- `packages/openclinxr/scenario-runtime/src/scenario-catalog.ts`
- `packages/openclinxr/asset-registry`
- `packages/openclinxr/ui-route-admin`
- `apps/api/src`
- `tools/openclinxr/factory`
- `tools/openclinxr/dark-factory/multi-case-runner.ts`
- `packages/openclinxr/xr-station/src/station-equipment.ts`
- `apps/ui-xr/src/main.ts`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-01.md

### Minimum regression commands

- `pnpm exec vitest run apps/api/src/scenario-promotion-path.test.ts apps/api/src/encounter-runtime-handoff.test.ts packages/openclinxr/asset-registry/src/the-scene-contents-bind-or-refuse.test.ts`
- `pnpm exec vitest run tools/openclinxr/factory/the-placement-node-carries-the-authored-offset.test.ts`

**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-01.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

## SC-02 — Observed requirements control actual API/UI encounter entry and scheduled effects

**Objective:** Replace positional consumer labels with actual run-bound capability observations and make every required starting predicate control the existing encounter admission owner and ordered event execution.

**Role:** runtime/API integration specialist with adversarial state-machine reviewer. **Depends on:** SC-01. **Factory step:** dialogue_runtime.

### Required behavior

- A02/A03: Fix the reproduced runtime-owned requiredStates hole. Every required unsatisfied/pending/unknown outcome blocks actual acceptance through API and UI, not only a pure helper. The nonempty prototype cannot pass because requirements or observations were omitted.
- Observe capability and actual realized instance/version; bind evidence to active run/session, case/requirement revision and observation freshness. Reject client-authored success, wrong-run/stale/replaced observations. List index or supplied asset ID is not a consumer acknowledgment.
- Separate initial predicate connected=false from later learner goal connected=true. Verified disconnected can satisfy the initial state without completing the goal; unknown/pending does not prove incompleteness. Preserve case-owned physiology/state and pure spec-module lifecycle boundary.
- Gate ScenarioRuntime.startEncounter, the API start-encounter route and initializeRemoteTraceSession in UI-XR through the EXISTING transition owner and normal endpoint: pending-to-ready yields one valid transition with actual time, snapshot before due-zero effects, no new phase/reset/duplicate START_ENCOUNTER. Wire timing caller, apply scheduled effect, record acknowledged execution, handle duplicate tick/retry and failed effects without marking them irretrievably complete first.
- Post-admission removed/replaced required assets or changed predicates invalidate acceptance and signal execution stop/refusal; SC-05 consumes this signal. Demonstrate delayed load, direct API bypass attempt, successful entry and an effect-failure retry through production owners.

### Counterweights

- Present asset + runtime required unsatisfied/pending/unknown each refuses; replay another session acknowledgment refuses; reordered monitor retains consumer; satisfied learner GOAL before start refuses while observed initial connected=false succeeds; failed effect retries without duplicate successful effect or clock reset.

### Scope and limits

No new phase does not exclude enforcement. Keep pure specification code pure and enforce at existing runtime/API/UI owners. Do not pre-apply events in a planner or create a parallel clock/state store. Helper tests and method existence alone cannot close this card.

### Write roots

- `packages/openclinxr/shared-schemas`
- `packages/openclinxr/scenario-runtime`
- `packages/openclinxr/domain`
- `packages/openclinxr/session-state`
- `packages/openclinxr/xr-capture-evidence`
- `packages/openclinxr/xr-asset-loading`
- `apps/api/src`
- `apps/ui-xr/src`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.md

### Minimum regression commands

- `pnpm exec vitest run packages/openclinxr/scenario-runtime/src/the-scene-spec-gates-promotion.test.ts packages/openclinxr/scenario-runtime/src/the-planner-stays-inside-its-boundary.test.ts packages/openclinxr/scenario-runtime/src/a-scheduled-event-fires-once-at-its-second.test.ts`
- `pnpm exec vitest run apps/api/src/scenario-promotion-path.test.ts apps/api/src/encounter-runtime-handoff.test.ts`

**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-02.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

## SC-04 — The exact demonstration assets have trustworthy provenance and compatible rights

**Objective:** Pin and clear the selected encounter asset/motion set for adopted/shipped use and separately for rendered public demonstration; repair selected provenance from derivation evidence and replace incompatible or unresolved motion without dropping walking.

**Role:** asset-pipeline-lead plus licence specialist. **Depends on:** SC-01. **Factory step:** motion_retarget.

### Required behavior

- A06: Enumerate the actually selected room, support, patient/physician, clothing/textures, equipment, clip and any voice/audio. Pin code/weights/data/body/dependency and output rights where applicable. Separate source/shipped adoption from rendered-public clearance; link exact first-party terms and modifications.
- Resolve selected hash mismatches using reproducible derivation or justified rebuild, never by replacing a recorded hash solely to match unexplained bytes. Preserve cleared unchanged assets. Existing physician matched in the baseline review; 8/13 other sidecars mismatched, not a mandate to regenerate all 13.
- Resolve conditional CMU walk terms against strict permissive/non-copyleft policy and publication rights. Unresolved/incompatible terms mean use cleared or project-authored motion with equivalent approach behavior. Do not convert commercial permission into a permissive label or transfer another demo UUID clearance.
- SC-04 owns approved substitutions in tools/openclinxr/factory/scene-closure-case-source.ts after SC-01. Re-run the supported authoring producer and case/bundle compilation, verify actual loaded selection, increment version and invalidate descendants; sidecar-only or runtime overrides are forbidden. Deliver the selected asset/rig/clip manifest and separate explicit public-render decision used by capture and website gates. Verify retarget/graft preserves mesh/limb integrity and expected canonical mapping; installed MPFB GPL build-tool distinction remains, not a new AGPL fix.

### Counterweights

- Stale hash, unknown subcomponent rights, substituted clip and rewritten-only provenance refuse; exact cleared unchanged assets pass; no automatic blanket clearance from an MIT repository or from a public video.

### Scope and limits

Do not rewrite the injected-drive displayed-walk capture to bless movement; SC-04 may change only the listed bound-clip/graft measurement tests. No whole-catalogue cleanup, hardware purchase or new model adoption. Public rights are a prerequisite, not permission to publish. Changing selected bytes invalidates rubric/capture descendants; communicate updated manifest before their release.

### Write roots

- `apps/ui-xr/public/generated-humanoids`
- `apps/ui-xr/public/xr-assets`
- `docs/openclinxr/asset-licence-records`
- `docs/openclinxr/third-party-asset-licence-ledger.md`
- `tools/openclinxr/factory/graft-bound-clip.ts`
- `tools/openclinxr/factory/scene-closure-case-source.ts`
- `tools/openclinxr/evidence/licence`
- `tools/openclinxr/evidence/foot-plant/the-bound-walk-plants-its-feet.test.ts`
- `tools/openclinxr/factory/graft-bound-clip.test.ts`
- `packages/openclinxr/factory-stations/src/motion_retarget`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-04.md

### Minimum regression commands

- `pnpm exec vitest run tools/openclinxr/evidence/licence/the-mpfb-record-matches-the-installed-release.test.ts tools/openclinxr/factory/graft-bound-clip.test.ts`
- `pnpm exec vitest run tools/openclinxr/evidence/foot-plant/the-bound-walk-plants-its-feet.test.ts`

**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-04.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

## SC-00 — Independent controls freeze the measurement rubric before runtime motion is graded

**Objective:** Create and independently approve an executable, versioned geometry/motion/evidence rubric tied to the selected assets, with good/broken controls and numeric tolerances before downstream placement/motion acceptance.

**Role:** independent measurement/QA specialist and visual reviewer. **Depends on:** SC-04. **Factory step:** instrument.

### Required behavior

- A08 prerequisite: independent reviewer, not the motion implementer alone, fixes support, signed floor contact/penetration, swept collision, foot-slide, heading/arrival, anatomy/skin and timestamp/sample sufficiency thresholds before SC-03/05 release. Record asset/rig/frame hashes, rationale and actual numeric thresholds in the rubric.
- Acceptance contract caps arrival error at 0.05 m and settled yaw error at 10 degrees with two seconds stopped observation. Other thresholds cannot be chosen after seeing implementation failures or inflated to admit obvious visible defects; changing a rubric requires independent review and all controls rerun.
- Controls must include known-good support, intentionally sliding/penetrating foot, missing contact windows, zero skinned samples, absent actor, thin obstacle between old waypoint samples, wrong support/frame and clip flag without motion. Signed contact height must be relative to the selected floor; unsupported geometry explicitly refuses.
- The verifier must consume measured output and reject malformed/stale/wrong-run evidence. Controls may test the measurement instrument independently, but cannot be presented as normal-runtime success. Document how SC-07 observes production without injecting actor behavior.

### Counterweights

- Each broken control fails its named metric; good controls pass; deleting a metric/sample or claiming no contacts must fail rather than evade grading; oracle cannot accept its own pre-filled success flag.

### Scope and limits

Instrument-only is intentional for this prerequisite; it closes no full encounter requirement by itself. Do not fix runtime code or start learned inference here. New instrument tests are created by this FUTURE task; this planning package contains no implementation/tests.

### Write roots

- `tools/openclinxr/evidence/scene-closure`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.md

### Minimum regression commands

- `pnpm exec vitest run tools/openclinxr/evidence/foot-plant/the-runtime-displays-the-walk.test.ts tools/openclinxr/evidence/foot-plant/the-walk-clip-plants-its-feet.test.ts tools/openclinxr/evidence/foot-plant/the-bound-walk-plants-its-feet.test.ts`

**New acceptance-test entrypoint to create in this task:** `tools/openclinxr/evidence/scene-closure/the-measurement-rubric-rejects-broken-controls.test.ts`. Run it as an ordinary passing Vitest test after implementation; listed legacy foot-plant tests remain regression/negative controls and must not be rewritten to bless injected movement.

**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-00.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

## SC-03 — The patient remains supported by the exact mounted instance and every slot preserves intent

**Objective:** Connect exact observed support geometry and identity to live patient composition and acceptance, preserving persisted placement and heading through mount, slot repair, framing and animation.

**Role:** XR systems architect / placement integration specialist. **Depends on:** SC-02, SC-00. **Factory step:** staging.

### Required behavior

- A04/A05: live caller supplies required support ID, actual mounted geometry/version and readiness to the existing acceptance owner. Delayed exact mount stays pending; wrong instance cannot substitute; invalid authored offset refuses real acceptance rather than warning-and-success.
- Compose world-metre support tangent/normal offsets in a defined orthonormal frame with no double scale; standing uses named floor frame. Preserve outer slot vs loaded child transforms and authored provenance through slot repair, framing, pose, idle and speech; selected actor heading survives repair on all relevant slots.
- Use persisted/frozen case intent rather than scenarioBank fallback over authored cases. Measure the actual posed/skinned patient and named support after frame updates; keep an unauthored supine control stable and distinguish it from a vacuous equal-default assertion.
- Edit a valid support-relative offset through the normal authoring path and measure the expected world delta on the loaded posed/skinned patient after framing and subsequent animation updates while the unauthored control remains unchanged. Mount replacement/removal invalidates support observation and stops/refuses dependent motion/acceptance. Explicit missing physician is reported, not substituted. Connect readiness results, not only expose helper options: runtimeActorPlacement must pass supportInstanceId and observed mounted IDs and consume pending/refused readiness. Consume headingRadians on primary_patient and clinical_team as well as additional_cast, preserving it through repair.

### Counterweights

- Slow support, same-kind wrong support, post-acceptance replacement, invalid normal offset, malformed frame, changed GLB scale, slot-kind repair, authored vs unauthored controls all exercise actual consumer behavior.

### Scope and limits

Do not change settled placement to hide bad animation or substitute primitive ED bounds for explicit generated support. SC-05 owns travelling physician; SC-03 must leave a measured stable patient and correct actor/heading identities.

### Write roots

- `packages/openclinxr/asset-registry`
- `packages/openclinxr/xr-runtime-state`
- `packages/openclinxr/xr-station`
- `packages/openclinxr/xr-station-room`
- `packages/openclinxr/xr-asset-loading`
- `packages/openclinxr/xr-scene`
- `packages/openclinxr/xr-pose`
- `apps/ui-xr/src`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-03.md

### Minimum regression commands

- `pnpm exec vitest run packages/openclinxr/asset-registry/src/an-authored-offset-needs-a-frame.test.ts packages/openclinxr/asset-registry/src/authored-intent-is-not-substituted.test.ts packages/openclinxr/xr-runtime-state/src/a-resolved-placement-says-where-it-came-from.test.ts`
- `pnpm exec vitest run packages/openclinxr/xr-runtime-state/src/the-sway-composes-onto-the-heading.test.ts apps/ui-xr/src/the-composition-call-site-is-live.test.ts`

**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-03.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

## SC-05 — The case-selected physician walks to the measured bedside target and stops in UI-XR

**Objective:** Drive the existing approach planner/executor and cleared clip through normal case-owned runtime execution using mounted patient/equipment geometry, with measured arrival, contact quality and invalidation-to-stop.

**Role:** motion/runtime integration specialist with XR and visual QA reviewer. **Depends on:** SC-03. **Factory step:** staging.

### Required behavior

- A05/A07/A08: normal encounter selects explicit physician ID/start/target; execute existing plan/executor and cleared clip without recorder globals, direct test executor calls or learner locomotion. Correct actor appears in same supine encounter and stops at accepted target facing patient.
- Resolve case-authorized side/standoff/monitor view/workspace from actual patient, support, equipment and actor geometry. Check swept occupancy, including between-waypoint thin obstacles; no empty obstacle list or hardcoded ED position can establish safety.
- Bind accepted plan to current observed geometry/run/version; refuse forged/stale clear plan. Required state/support/obstacle change during travel stops/invalidate execution. Blocked explicit side and missing physician refuse rather than nurse/side substitution.
- Use SC-00 frozen rubric on actual loaded skeleton/skin across timestamps, stance/transition/stop intervals. Arrival <=0.05 m, settled yaw <=10 degrees and two-second stop; no obvious limb damage/sliding/penetration admitted by weakening thresholds. Preserve patient support, speech/gaze layering, chain ownership and interruption/replay identity.
- Record normal-workflow browser measurements as well as extended production-boundary tests. Existing injected-drive toe-span video or offline bound-clip percentages cannot close runtime arrival/contact requirements.

### Counterweights

- Missing physician, nurse occupying first clinical slot, blocked authored side, thin obstacle, plan/geometry revision mismatch, support removed mid-walk, clipPlayed without limb motion and continuing motion after stop each fail named acceptance.

### Scope and limits

No general navigation, clinical procedure hand contacts, streaming-model dependency or live patient animation required. Do not infer clinical standards from proxy dimensions; request review of selected task thresholds and state evidence limits.

### Write roots

- `packages/openclinxr/asset-registry`
- `packages/openclinxr/xr-runtime-state`
- `packages/openclinxr/xr-humanoid-animation`
- `packages/openclinxr/xr-asset-loading`
- `packages/openclinxr/xr-station-room`
- `packages/openclinxr/xr-dialogue`
- `packages/openclinxr/xr-pose`
- `apps/ui-xr/src`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-05.md

### Minimum regression commands

- `pnpm exec vitest run packages/openclinxr/asset-registry/src/the-approach-path-stops-at-the-target.test.ts packages/openclinxr/asset-registry/src/the-executor-arrives-and-feet-are-measured.test.ts`
- `pnpm exec vitest run packages/openclinxr/xr-humanoid-animation/src/the-locomotion-drive-plays-a-clip.test.ts packages/openclinxr/xr-runtime-state/src/the-sway-composes-onto-the-heading.test.ts`

**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-05.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

## SC-06 — Frozen scene and motion decisions replay and invalidate through the real consumer

**Objective:** Connect deterministic layout variation and existing durable review/replay owners so the accepted encounter reopens from versioned case/assets/solver/clip decisions and rejects stale or corrupt evidence.

**Role:** persistence/replay integration specialist. **Depends on:** SC-05. **Factory step:** staging.

### Required behavior

- A09: persist case/content IDs, support/actor/equipment instances, actual bytes, clip/rig/solver revisions, seed/index, resolved target/path/layout, acknowledgment snapshot, actual event order and run identity using existing review/replay boundaries.
- Reopen through normal consumer: same frozen version reproduces accepted geometry/arrival within the frozen rubric, multiple allowed indices explore authorized choices, impossible authored intent fails with named conflicts. Do not just hash an unused layout helper.
- Change/remove/corrupt selected case/bundle/GLB/clip/rig/solver evidence and prove consumer refuses stale acceptance; missing/corrupt/changed are distinguished. Repair requires fresh observation/revalidation, not overwriting sidecars.
- Keep server-only hashing/generation outside browser entry or provide explicit browser-safe interface. No second replay/state database; include dialogue turn identity when applicable.

### Counterweights

- Same run manifest, changed geometry, stale plan, removed or corrupt artifact, different solver revision, impossible layout and authored side vs varied side; no clinical hidden facts in exported evidence.

### Scope and limits

Reproducibility claims cover recorded versioned decisions and measured replay, not bit-identical learned inference/physics. Global unrelated provenance debt stays separately recorded.

### Write roots

- `packages/openclinxr/asset-registry`
- `packages/openclinxr/scenario-runtime`
- `packages/openclinxr/session-state`
- `packages/openclinxr/review-workflow`
- `apps/api/src`
- `apps/ui-xr/src`
- `tools/openclinxr/evidence/supine-control-freeze`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.md

### Minimum regression commands

- `pnpm exec vitest run packages/openclinxr/asset-registry/src/the-layout-varies-and-refuses.test.ts tools/openclinxr/evidence/supine-control-freeze/the-supine-control-station-is-frozen-by-asset-bytes.test.ts tools/openclinxr/evidence/supine-control-freeze/a-corrupt-artifact-is-refused.test.ts`
- `pnpm exec vitest run tools/openclinxr/evidence/the-client-entry-does-not-reach-node-builtins.test.ts`

**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-06.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

## SC-07 — An uninterrupted normal-workflow recording proves the complete encounter and its refusals

**Objective:** Produce a durable reviewed evidence package from the actual persisted-case main UI-XR workflow, correlating uninterrupted video, measured acceptance, negative controls and replay on the local M1 Max 64GB.

**Role:** independent browser-evidence/measurement engineer plus visual reviewer. **Depends on:** SC-06. **Factory step:** instrument.

### Required behavior

- A08/A10: recorder starts before activation and continues through real contents/state readiness, entry, supine support, physician approach/arrival and stopped observation. Capture exact normal persisted case/bundle, no visual-review-only/static fallback and no metadata-only scaffold.
- Recorder uses only normal inputs/camera controls plus read-only telemetry. It must not set readiness, actor transforms, pedsDrive/other locomotion globals, invoke executor or inject a plan. Add verifier controls that detect/deny bypass paths rather than making hidden exceptions.
- Video, measurements and replay share run identity, code/case/bundle/asset/clip/rig/solver hashes, actor/support/instance IDs, timestamps and phase/domain time. Report capture gaps and actual M1 hardware/runtime memory/frame/timing evidence; classify desktop evidence without Quest claims.
- Run frozen SC-00 verifier on actual displayed skeleton/skin, support/contact/sweep/arrival/heading/stop measurements; independent visual reviewer watches uninterrupted source and checks anatomy/scale/contact/equipment/quality. Negative recordings cover unsupported required state, wrong/missing support, blocked route and approved recovery/replay.
- Before capture, pin an existing authorized evidence-storage location, access policy, retention owner and retention period. Use the existing local volume outside disposable worker trees unless a different authorized store is available; no new cloud/paid/public upload is authorized. Retain original videos/reports there, verify independent retrieval and document retention/retrieval/hash. Produce sanitized public-proof derivative and summary with exact lineage, without hidden facts/tokens/personal data. Raw ignored local files and promised URLs cannot close delivery.

### Counterweights

- Wrong actor, no skinned body, no contacts, nonmonotonic timestamps, flag-only motion, stale source hash, corrupted recording, review-only handoff and injected movement are rejected; reviewer must be able to retrieve and play all required artifacts.

### Scope and limits

Do not edit product movement to stage the film. If runtime fails, return the failing A row to its owner; this card is not permission to fake it. Budget/record storage and avoid committing raw or uncleared footage under docs. No public release.

### Write roots

- `tools/openclinxr/evidence/scene-closure`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-07.md

### Minimum regression commands

- `pnpm exec vitest run tools/openclinxr/evidence/foot-plant/the-runtime-displays-the-walk.test.ts`
- `pnpm exec vitest run tools/openclinxr/evidence/the-client-entry-does-not-reach-node-builtins.test.ts`

**New acceptance-test entrypoint to create in this task:** `tools/openclinxr/evidence/scene-closure/the-normal-workflow-walk-is-recorded.test.ts`. Run it as an ordinary passing Vitest test after implementation; listed legacy foot-plant tests remain regression/negative controls and must not be rewritten to bless injected movement.

**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-07.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

## SC-08 — The existing website presents a cleared edit of the verified encounter

**Objective:** Integrate a polished accessible demonstration into the existing static Pages website using the same accepted run, verified media lineage and public-output clearance, with local/review-branch playback evidence.

**Role:** frontend/accessibility specialist with evidence/publication reviewer. **Depends on:** SC-07. **Factory step:** instrument.

### Required behavior

- A11: extend docs/index.html/styles.css, not a new app/site. Short edited demonstration and poster derive from SC-07 accepted run with source hashes and edit ranges; caption claims reflect footage and accepted capability only.
- Offer accessible keyboard-operable playback, reviewed captions/transcript, poster, responsive layout, reasonable preload/compressed size and no forced audible autoplay. Set justified encoding/size/performance budget before media commit. Link full sanitized proof and concise limitations.
- Verify actual browser playback, seeking, captions, desktop/mobile layout and artifact link retrieval, with watched visual evidence. HTML string checks and pages validator alone are insufficient. Missing/replaced media or lineage mismatch blocks acceptance.
- Verify selected source and rendered-public rights from SC-04, publication sanitization from SC-07, and synthetic sentinel exclusion across ALL artifacts entering docs. Clearly label desktop demonstration and avoid clinical/Quest/autonomy claims not established.
- Deliver website integration and public package ready for separate release. Pages deploys all docs on qualifying main push: keep preview/review branch until explicit release authorization; do not change workflow to bypass this boundary. Record unpublished vs deployed status truthfully.

### Counterweights

- Missing caption file, broken video URL, stale substituted source, edit of a different run, raw trace/sentinel in docs, inaudible-only instruction inaccessible without transcript, mobile overflow and playback failure each detected.

### Scope and limits

No new website framework, paid media host or implicit production deployment. Permission to implement a website task is not permission to claim clinical validation or silently expose raw evidence. Authorized publication later requires deployed URL playback verification.

### Write roots

- `docs/index.html`
- `docs/styles.css`
- `docs/assets`
- `docs/openclinxr/videos`
- `tools/openclinxr/evidence/check-github-pages-site.ts`
- `tools/openclinxr/evidence/check-github-pages-site.test.ts`
- `tools/openclinxr/evidence/sync-github-pages-evidence-links.ts`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.md

### Minimum regression commands

- `pnpm pages:sync-validate`
- `pnpm exec vitest run tools/openclinxr/evidence/check-github-pages-site.test.ts`

**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-08.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

## SC-09 — Independent acceptance closes the complete encounter and website only on direct evidence

**Objective:** Audit every A01-A12 requirement against the actual integrated run and website package, reproduce critical negative controls and record explicit pass/fail/remaining claim boundaries before parent closure.

**Role:** independent adversarial integrator + visual/accessibility reviewer. **Depends on:** SC-08. **Factory step:** instrument.

### Required behavior

- Independently inspect normal authored-case consumer chain, run startup and motion, play source and edited recordings, reopen replay, inspect mounted IDs/hashes/measurements and actual website playback. Verify the declared restricted storage location/access/retention and independent retrieval of originals. Use the frozen rubric, not child success labels.
- Repeat decisive counterweights: present asset with runtime failed state; wrong-run observation; exact support delayed/replaced; selected physician absent; thin obstacle/stale plan; corrupt replay/video; wrong media lineage. Any failure keeps relevant A rows and parent open and is returned to owner.
- Produce an A01-A12 evidence matrix with exact versions, retrieved artifacts, measurements and review decisions, including named visual review. Clinical usefulness and worn-headset readiness cannot be claimed without corresponding qualified/human evidence; public release status remains distinct.
- Parent technical closure requires all A01-A12 technical/website deliverables and no unresolved required defect. Record A13 research status separately; no model availability or paper contradiction can masquerade as executed quality evaluation.

### Counterweights

- All child cards landed but missing run/video; site strings correct but video fails; negative helper tests pass but real API bypass works; source/edited run mismatch; any of these must prevent closure.

### Scope and limits

Independent review only; do not edit production code or thresholds while grading. Reopen/return owner tasks with evidence rather than shrinking requirements. This is not a publication authorization or clinical credential.

### Write roots

- `tools/openclinxr/evidence/scene-closure`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-09.md

### Minimum regression commands

- `pnpm exec vitest run packages/openclinxr/scenario-runtime/src/the-scene-spec-gates-promotion.test.ts packages/openclinxr/scenario-runtime/src/the-planner-stays-inside-its-boundary.test.ts`
- `pnpm pages:sync-validate`

**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-09.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

## SC-10 — A pinned learned-motion candidate receives an honest eligibility and execution assessment

**Objective:** Preserve the research lane with exact version/rights/interface screening and, only when eligible and executable, compare one candidate against the connected baseline; distinguish holds from measured failures.

**Role:** motion research/compatibility specialist with licence reviewer. **Depends on:** SC-09. **Factory step:** motion_retarget.

### Required behavior

- A13: inspect exact code commit/checkpoint/body/encoder/data/output terms and pinned skeleton mapping for a candidate such as Kimodo-SOMA, not similarly named ports. Resolve README77/model-card30 revision relationship before claiming incompatibility; document what direct metadata proves and what still needs execution.
- Verify local M1 dependency/installation path without claiming CPU encoder offload establishes motion inference. Paid/remote execution or new gated terms require separate existing authorization. Do not download or execute ineligible models merely to finish a card.
- If eligible and available, compare same frozen case/rig/target with SC-06 baseline using SC-00 quality/constraint rubric, memory/latency/retarget/integration cost and actual displayed result. If no candidate is eligible, record precise first-party reason and baseline retention. Ambiguous/unavailable remains HOLD, not reject_measured or completed quality comparison.
- Return screened/executed/held distinctions, versioned evidence and next unblock. Research HOLD does not block honest baseline demonstration but remains visible and cannot be falsely closed as a measured cagematch.

### Counterweights

- Wrong Kimodo project, mismatched revision, inferred skeleton from uninspected weights, unknown data rights and no-inference performance claims all fail review.

### Scope and limits

No automatic learned-provider adoption, hardware purchase or required streaming runtime replacement. Core parent is A01-A12; this separately tracked A13 research lane must report its real outcome.

### Write roots

- `tools/openclinxr/evidence/scene-closure-research`
- docs/openclinxr/scene-closure-2026-09-09/evidence/sc-10.md

### Minimum regression commands



**Required evidence report (future, not a link to an existing artifact):** docs/openclinxr/scene-closure-2026-09-09/evidence/sc-10.md. The report must attach the actual case/run/measurement/browser evidence for this card, controls, exact revisions, verdicts and remaining boundaries; file existence alone cannot close it.

