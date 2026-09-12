# Scene closure: source and recording hardening

2026-09-12. Supplemental implementation and owner-review context for the **existing SC-07–09 revision-2 cards**. This is preparation, not encounter acceptance. No uninterrupted encounter recording, media/site playback review, final acceptance, clinical validation or worn-headset proof is supplied by this document or by verifier unit tests.

## Ownership and frozen contracts

Keep the existing card IDs and acceptance scopes:

| Card | Exact task title | ID | Dependency |
|---|---|---|---|
| SC-07 | An uninterrupted normal-workflow recording proves the complete encounter and its refusals (r2) | `tsk_93b6e2aa66b6c3fa` | SC-06 |
| SC-08 | The existing website presents a cleared edit of the verified encounter (r2) | `tsk_b5f68748d9a0a109` | SC-07 |
| SC-09 | Independent acceptance closes the complete encounter and website only on direct evidence (r2) | `tsk_8057277d5d26df4f` | SC-08 |

Parent `tsk_a472e9e65c9bb214` remains non-executable and must not close from child Landed counts. SC-10 is separate research. The bounded case-owned bedside approach does **not** depend on completion of the separate canonical MotionProgram GLB bake or 4-target × 3-rig program.

Read [tasks-v2.md](./tasks-v2.md), [acceptance-v2.md](./acceptance-v2.md), [proof-contract-v2.md](./proof-contract-v2.md) and [delegation-v2.md](./delegation-v2.md). Those four documents stay frozen at `c3f3f3007dc95f85aa6f4dd710c8da5205d03f50`; landed upstream reports pin their hashes. Do not rewrite them, cosmetically update their hashes or invalidate good historical evidence merely to attach this supplement. Authority comes from the supported owner-authored board contract incorporating applicable context; a repo link alone does not amend a planted card.

## Why this preparation is needed

The five-round Grok 4.6 review found that the actual exported SC-07 and SC-09 verifier cores accepted synthetic good-report-shaped inputs after an implementation-source digest or path was changed. Those accepted controls had observation/text artifacts but no video. Missing artifact bytes correctly failed. These are independently reproducible **verifier validation escapes**, not evidence that a real encounter was falsely accepted. SC-08 had the same nonempty-source-list pattern by inspection and needs equivalent controls.

The existing cards already require same-run source identities, uninterrupted real video, decoding, independently watched review and final direct evidence. Strengthen enforcement inside their existing proof roots rather than creating generic freshness or graph-repair product cards.

## Owner preflight before release

1. Fresh-sync the OpenClinXR project `prj_9b390b99b443a964`; retrieve full SC-07–09 cards and parent. Confirm Idle state, dependencies, no session/lease collision, exact write roots, every completion command and accepted upstream reports. Do not mutate active contracts or use operational `tasks.next` as inventory.
2. Read repository policy and the frozen documents. Resolve the accepted persisted case, compiled bundle, mounted support/actors, selected cleared assets, clip/rig, freeze and actual approach/solver consumers. Verify upstream evidence against bytes and observed behavior, not its status label alone.
3. Review all hardening source/tests and decide whether requirements fit each existing scope. Resolve any needed scope amendment through the owner while Idle, using an actually supported interface. The observed MCP `tasks.update` schema does **not** expose objective/body, write-root, done-when or `depIds` editing; do not report unsupported updates as successful.
4. Verify retained contract text with a fresh full `tasks.get`. Body regeneration can discard arbitrary sections. Where an owner interface supports editing, use retained objective/known-good/out-of-scope fields to incorporate this file at a pinned commit/hash; read back the result. Comments are audit notes, not a contract amendment or steering to an executing worker. A supported mailbox handoff can notify the eligible future owner of this supplemental implementation context; it cannot override the frozen contract, silently widen scope or amend a live planted card. Preparation leaves these cards Idle/backlog until their existing authorized execution handoff.
5. Before capture, specify authorized storage, retrieval method/access policy, retention owner/period and encoding/storage budget. Retain originals on the existing local volume outside disposable worktrees unless another already authorized store is available. No new paid/cloud/public upload or Pages release follows from this preparation.
6. Establish the **first real broken-behavior baseline** on the applicable unchanged dependency baseline or a controlled remove-the-fix variant. Save the observable assertion failure, unchanged known-good control and fixed result together. An import error, missing report/file, unavailable fixture/server or `it.fails` is not the required behavior RED.

## Bounded source identity and historical evidence

Require a verifier-owned expected input set, derived from accepted selection and actual production consumers, rather than letting arbitrary report JSON paths decide completeness. It must cover the persisted case/version, compiled bundle, selected patient/physician/equipment/support instance and geometry identities, GLB bytes, locomotion clip, rig mapping, scene freeze, seed/variation index and relevant solver/approach implementation. Include registry/selection inputs actually consumed. A digest of an unused helper does not establish runtime coverage.

Resolve source files independently, read their bytes and compare SHA-256. Validate normalized repository-relative paths; reject absolute paths, traversal, symlink escape and duplicate/conflicting identities. Pin an authoritative execution revision/source checkout plus retained selected artifacts. Bind its identity to video, measured traces, replay and accepted snapshot; self-authored matching report labels do not prove that those bytes were used.

Two policies are distinct:

- **Historical verification:** retrieve the pinned execution revision and selected artifacts that produced the recording. Unrelated later documentation changes must not invalidate an honestly reproducible historical run.
- **Current reuse:** compare the current selected case/bundle/GLB/clip/rig/solver/freeze against accepted execution identities before reusing acceptance or replay. Relevant changes refuse reuse until owner revalidation and affected recapture. Rehashing metadata without rerunning the producer cannot make old footage current.

Matching a bounded input set means those recorded inputs match. It does not mean the entire factory is current. No global refresh service or automatic full-factory rerun is introduced here. Optional faculty “Recorded inputs match / changed / unverifiable” display remains deferred.

## Actual recording, media and review

SC-07 drives only supported normal user inputs/camera controls and read-only telemetry. It must start before activation and retain contents/state readiness, entry, patient support, physician approach/arrival and at least the frozen stopped-observation interval. No injected plan, readiness, actor transform, locomotion global or executor call can stage the result. Runtime defects return to the relevant A-row owner.

Require original actual video plus aligned measured traces, replay and negative recordings. Correlate run identity, source/selected-artifact hashes, actor/support/instance IDs, monotonic timestamps, phase/domain time and accepted state. Measure displayed skinned-body/contact/sweep/arrival/heading/stop behavior under SC-00's frozen rubric; reject empty body/contact/sample sets and generic observations standing in for physical measurements. Record actual M1 Max 64GB runtime, memory/frame/timing/capture gaps honestly; desktop evidence cannot establish Quest readiness.

Artifact SHA-256 checks establish byte identity only. Independently retrieve originals from the retained store, decode actual video streams, check duration/timestamps and required capture coverage, and retain retrieval/decoder observations bound to those bytes. A `video/*` label, fake video header, hash of text or self-authored decode-success flag is insufficient. A distinct named visual reviewer must watch the uninterrupted original and evaluate anatomy, scale, contact, equipment and quality; retain a receipt with artifact identity, watched coverage, review identity and explicit decisions. Automated measurements do not confer clinical credentials.

SC-08 produces a cleared source-derived edit/poster/captions/transcript in the existing Pages site, with source run/hash and edit-range lineage. Actual local/review-browser playback, seeking, keyboard/caption access, desktop/mobile layout and link retrieval must pass. Inspect all exported artifacts for rights and sentinel/private-data exclusion. Keep preview/review branch until separate public-release authorization; qualifying main docs pushes publish Pages.

SC-09 independently retrieves/decodes/watches original and edited media, exercises normal activation/replay/site playback and repeats decisive negatives. Its A01–A12 matrix must identify actual observations and unresolved defects; child statuses and green HTML checks cannot substitute for evidence. Do not repair runtime or lower thresholds while grading.

## Execution handoff to the hardened proof code

The card-local `proofs/sc-07`, `sc-08` and `sc-09` implementations expose `closure-inspection.ts`; consult each current `report-schema.ts` and its ordinary behavior/verifier tests before producing real reports. `implementation.productSourceCommit` identifies the grader/source-change revision and `implementation.inputs` supplies independently checked grading/change digests. Capture authority is separate: `recordingBinding.executionSourceCommit` pins the full immutable execution revision and `executionInputs` supplies the finite exact producer/runtime input set, including the actual main UI consumer. Producer and original/edited watch/edit receipts bind to this capture revision; producer receipt inputs match `executionInputs`, not grader files. The supplemental `recordingBinding` references retained artifact IDs, not arbitrary filesystem paths:

- `claimMode`: explicit `historical` or `current-replay` policy.
- `runId`, `videoArtifactId`, `traceArtifactId`, `runReceiptArtifactId` and `watchReceiptArtifactId`: original media, aligned measurements, producer identity and distinct review.
- `bundleArtifactId`, `acceptedPlanArtifactId` and `caseArtifactId`: retained selected producer outputs whose bytes/parsed identities must agree with the recording.
- For SC-08 and SC-09, `editedVideoArtifactId`, `editReceiptArtifactId` and `editedWatchReceiptArtifactId` are required: the edit must decode, identify the original source run/hash, carry nonempty edit ranges within the decoded source and retain distinct independent retrieval/full-watch evidence for its own bytes.

The CLI resolves artifacts using the existing owner evidence registry and reads pinned source bytes through Git, without requiring that historical execution commit to equal today's HEAD. Current-replay checks only the bounded actual execution input set. Later grader or unrelated documentation edits do not make the recorded runtime stale; grading/change bytes are checked independently at their grading revision. The finite execution set also hashes six actual station geometry consumers under `packages/openclinxr/xr-station/src/`: `station-environment.ts`, `station-stretcher.ts`, `station-equipment.ts`, `station-architecture-fixtures.ts`, `station-equipment-builders.ts` and `station-equipment-families.ts`. Changed support geometry must invalidate current replay even if support IDs remain equal; this producer-owned bounded policy is not exhaustive repository dependency capture. The selected bundle contains patient, physician, nurse and family actors: all four selected GLB digests are checked. The physician GLB's actual 137-joint skin and selected clip are inspected; the retrieved accepted plan must semantically match the pinned generated JSON-only freeze (object-property order is immaterial) and its case/version and `variation.seed` must agree with the recording. `acceptedPlanArtifactId` must retrieve the **entire** frozen producer record, not a slim identity subset; recorded `environmentId`, `supportInstanceId` and `supportContentId` are bound to its environment/support instance.

The retained trace declares `clock: "video-relative-ms"` and `headingUnit: "radians"`; `recorderStartedAtMs` is zero and all capture/activation/arrival/stop timestamps are offsets from the first video frame. Video inspection requires both `ffprobe` and `ffmpeg`: `ffprobe -count_frames` decodes/counts frames, and an additional strict full-stream `ffmpeg -v error -xerror -err_detect explode` decode strengthens failure handling. Selected-video frame timestamps and per-frame durations derive actual video coverage, with finite monotonic frame clocks; container/audio duration cannot extend the claimed recording. Nonzero status, error stderr, missing frames and media whose resolved path or hash changes around decoding are refused. The producer/reviewer receipts are retained inputs which the owner must genuinely obtain, not manufacture from an expected fixture. Before capture, confirm the bounded selection against actual production consumers; resolve mismatches under owner scope rather than omitting hashes. These checks validate recorded provenance/review claims. They do not independently establish that a person watched footage or fully apply SC-00's anatomy, skin/contact, sweep and visual-quality rubric; those actual measurements/review remain owning-card execution deliverables.

## Negative controls that must remain executable

| Controlled failure | Required result |
|---|---|
| False implementation digest, altered/unsafe source path, omitted expected selected input | Refuse source identity/coverage |
| Missing video, mislabeled text, fake/undecodable media, omitted start or stop interval | Refuse recording acceptance |
| Video/trace/replay or source/edit from different runs | Refuse correlation/lineage |
| Empty contact/body/sample set, generic flag-only motion observation | Refuse measured acceptance |
| Changed selected case/bundle/GLB/clip/rig/solver/freeze with unchanged old footage | Refuse current reuse |
| Unrelated later docs commit with intact pinned execution checkout/artifacts | Preserve honest historical verification |
| Rewritten metadata hashes without producing a new execution | Refuse fabricated freshness |
| All children Landed but no independently retrieved/watched run or failed site playback | Keep SC-09 and parent open |
| Runtime failed required state, wrong/replaced support, absent physician, thin obstacle/stale plan, bypass/injected driver | Refuse or safely stop; return exact failed A row to its owner |
| Missing captions/media, inaccessible controls, mobile overflow, raw/sentinel export | Refuse website acceptance |

Synthetic verifier controls are unit tests only. Never serialize their plausible samples into `evidence/sc-07.json`, `sc-08.json` or `sc-09.json` to satisfy the actual completion CLI.

## Tests and final go/no-go

Retain every exact completion command and regression from the full card and [tasks-v2.md](./tasks-v2.md). These ordinary behavior tests must contain real assertions with the exact titles:

| Card | Test path | Exact `it` title |
|---|---|---|
| SC-07 | `tools/openclinxr/evidence/scene-closure/the-normal-workflow-walk-is-recorded.test.ts` | `SC-07-required-behavior` |
| SC-08 | `tools/openclinxr/evidence/scene-closure/proofs/sc-08/the-reviewed-site-media-plays.test.ts` | `SC-08-required-behavior` |
| SC-09 | `tools/openclinxr/evidence/scene-closure/the-final-acceptance-rejects-incomplete-evidence.test.ts` | `SC-09-required-behavior` |

Run each with `pnpm exec vitest run <path>` and `pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts <path> <exact-title>`. Run the respective `proofs/sc-07`, `sc-08` and `sc-09/verifier.test.ts` unit suites separately. No skipped/todo/expected-failure marker, marker-only body, empty loop or missing-report assertion alone closes required behavior.

Preparation's focused source/media hardening regression uses these six suites:

```sh
pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-07/closure-inspection.test.ts tools/openclinxr/evidence/scene-closure/proofs/sc-07/verifier.test.ts tools/openclinxr/evidence/scene-closure/proofs/sc-08/closure-inspection.test.ts tools/openclinxr/evidence/scene-closure/proofs/sc-08/verifier.test.ts tools/openclinxr/evidence/scene-closure/proofs/sc-09/closure-inspection.test.ts tools/openclinxr/evidence/scene-closure/proofs/sc-09/verifier.test.ts
```

The preparation run passed 82 hardening tests across these six suites. The separate SC-06 verifier compatibility suite passed 33 tests, for 115 passing tests across seven suites (`pnpm exec vitest run tools/openclinxr/evidence/scene-closure/proofs/sc-06/verifier.test.ts` adds that compatibility gate). A short decoder smoke control containing 0.5 seconds of video plus two seconds of audio correctly measured five video frames spanning 0.5 seconds and rejected incorrect hashes/text; that tooling control is not encounter footage. The standalone SC-00 baseline suite was attempted but inherited configuration prevented test discovery; this is a recorded limitation, not a waiver of its frozen execution gates. Its temporary isolated TypeScript configuration worked around unresolved workspace configuration references; the original configuration was restored and the workaround is not a product change, required behavioral RED or permission to weaken execution checks. The exact ordinary normal-recording, actual-site-playback and final-acceptance tests above remain **future owning-card execution deliverables**; they were not replaced with synthetic verifier tests or fake successful recordings.

Only after actual evidence production, run each literal direct `verify.ts --report ... --scope ...` invocation from its frozen task, retaining **every scope argument**. Missing real completion reports must fail; their absence is an honest preparation boundary. Owner integration reruns source/artifact identities, each direct CLI and all regressions on the accepted integrated tree, inspects implementation/tests and retrieves/watches evidence before attestation. SC-P reruns SC-09's exact direct command and Pages regression checks and reads the full independent matrix. Any required unresolved A01–A12 defect is a no-go.

## Separate motion scheduling repair

Existing Harbor card `tsk_a1dc1f54954adace` requests persistent dependency editing, but its observed write roots/proofs were malformed. A working owner edit interface and scheduler behavior are not verified. The observed MCP schema lacks `depIds` editing. Record the blocker on the OpenClinXR parent; do not modify foreign-project Harbor cards without explicit scope. Do not recreate canonical OpenClinXR motion cards or treat cancelled dependencies as automatically satisfied.

The five-round review observed this **semantic candidate map**; the repair owner must fresh-read cards, confirm Landed successors, inspect exact source coverage and rerun controls before any in-place update:

| Cancelled dependency | Candidate coverage/action |
|---|---|
| `tsk_c11148d988b26c73` | Seed successor `tsk_89fca85c7700ae13` |
| `tsk_7d0c944a06073c99` | Contact-consumer successor `tsk_e2dc5ac27d6e98f7` |
| `tsk_89c9db40936bc177` | M2 guard successor `tsk_744eea9a35614caf` |
| `tsk_edd59d0568ed36e0` | Closed planner schema already on main: no task successor; drop edge **only after exact original controls are verified** |
| `tsk_fde1304dfdabd319` | Authored-source binding already on main: same conditional edge removal |

Affected observed open edges: `tsk_c0d67f74a7891719` → seed/contact; `tsk_9dc69fa037b495dd` → contact; `tsk_577e9d35c47b800d` → schema/source-binding; `tsk_b018bba2eb02b6aa` → guard. Preserve IDs, live dependents, proofs and sessions. Once an authorized persistent edit interface exists, update serially, fresh `tasks.get` after each, and audit acyclicity, no new dangling edges and no orphaned cards. Audit comments claiming a swap are not persisted dependency changes. The remaining GLB bake is product work after scheduling repair, not an encounter closure prerequisite.

## References and status cautions

- The five-round consultation is recorded in the owner's Codex workspace as `openclinxr-factory-closure-grok-five-round-review-2026-09-12.md`; this repo supplement carries the durable delegation requirements so workers do not require that external workspace file.
- Official [ffprobe documentation](https://ffmpeg.org/ffprobe.html), [ffmpeg documentation](https://ffmpeg.org/ffmpeg.html) and [codec error-detection options](https://ffmpeg.org/ffmpeg-codecs.html) describe probing/frame counting, decoding and strict error handling. The additional full-stream check strengthens decoder/error controls; it does not establish visual quality or clinical usefulness.
- [Bazel action inputs](https://bazel.build/remote/caching), [Nx declared inputs](https://nx.dev/docs/concepts/how-caching-works) and [SLSA artifact verification](https://slsa.dev/spec/v1.2/verifying-artifacts) support distinguishing declared input coverage, artifact identities and provenance expectations. These are design references, not a build-system migration or compliance claim.
- At review revision 4384, ready containment `tsk_a5c344d14f44970c`, family lower garment `tsk_faf25f17211932e2` and street waistband `tsk_f6fb6619d0464189` had their own owners. The earlier nurse-trouser card `tsk_3429307aeae2fc79` was cancelled; do not restage the corrected nurse-shell premise. Selected-encounter acceptance failures determine actual blockers, not blanket dependency on all garment work.
- The earlier stale rollup failure reads issue-288, not the later factory-run record. The published record matched its two declared hashes at review. Neither record establishes full-factory currency.
