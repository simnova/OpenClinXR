# Unlock plan: Worldview program card + five blocked Planted cards

Measured 2026-08-31 against board revision 1774 (`bb-r1774-cef5f513`). Tree facts restamped to
`74d02b72`; the first draft measured `05120405` and the delta is GitHub Pages copy, not D9
stations.

Revised three times on 2026-08-31: after a four-round adversarial review on gpt-5.6-sol (codex thread
`01a05836-f239-75e3-8420-d7ab012a82db`), then after a peer review by Grok (session
`01a0519a-b8c6-7081-afc0-9d5f00736b24`) recorded in
`docs/openclinxr/blocked-card-unlock-plan-review-2026-08-31.md`. Claims withdrawn in each pass
are recorded rather than deleted, because each would otherwise be re-derived. A third pass followed
a further four rounds on the same codex thread, and a fourth applied Grok's hybrid-shape notes in
`docs/openclinxr/hybrid-board-and-unlock-plan-notes-2026-08-31.md`.

## Landed while this plan was being written

| what | where |
|---|---|
| worker output preserved before any close | `a7d9a1f2` on `wt/bothy-tsk_27baa1ed86266d7b`, six files |
| successor RED planted on main | `08d9ce84`, 3 unflipped `it.fails` plus one inverted guard that passes |
| Idle pointer parent | `tsk_ac774b8b0116550d`, `kind=parent`, empty `doneWhen`, not plantable |
| Planted child carrying the slice | `tsk_b4089f2d0cb08e58`, lane A, `factory_step=instrument`, `unblocks=dialogue_runtime` |

`briefFromIssue` accepts all five of the child's proofs. Destructive probes were run before the
plant and their substitutions were confirmed matched: lowering the near plane to 0.001 fails the
inverted guard and reverting restores it; an honest resolved report gives 4 passed; a 0.0948 m
distance, a `firstHitKind` of `"anchor"`, a `firstHitVisible` of false, and a gown mesh at a safe
distance each fail their own clause.

Correction to this plan's own D9 column: the board schema has no `render` step
(`factory_step` options are body_param, clothing_consume, clothing_generate, motion_retarget,
lip_sync, room_generate, equipment_generate, staging, dialogue_runtime, instrument). The honest
classification for the camera lane is `instrument` unblocking `dialogue_runtime`, because the defect
is in the evidence capture harness and what it unblocks is seeing the speaking runtime.

## Headline

The six cards named in the ask are board hygiene. Counted against the ten-station
`DARK_FACTORY_CHAIN_STATIONS` chain (`tools/openclinxr/dark-factory/multi-case-runner.ts:87`),
none of the six advances a station as currently written. Two product lanes came out of the
review instead, and they are independent of each other:

| lane | defect | vehicle |
|---|---|---|
| speak-fixture camera | the still camera accepts a candidate 5 mm inside the near plane | new card, spec below |
| gown surface | interior edge sharpness floor in the skirt, cause undetermined | issue 750, `wt/issue-750` |

The repository also cannot currently state how many cases traverse its own D9 chain. The
checked-in rollup is dated 2026-08-11, covers an eight-station chain against today's ten, and
carries `generatedAt` with no commit stamp
(`.openclinxr/evidence/issue-288/multi-case-rollup.json:3`;
`tools/openclinxr/dark-factory/multi-case-runner.ts:131`). Unlocking six cards out of 275 while
that number is unknown is board-state throughput standing in for product throughput.

---

## Withdrawn from the first draft

| claim | measured |
|---|---|
| ui-admin carries 25 planted REDs | 0 `it.fails(` call sites. All 26 matches are prose inside immutable diagnosis headers. The canonical scanner strips comments and string bodies before counting (`packages/openclinxr/agent-loop/src/done-when-live.ts:20`) |
| nothing reads `measuredAgainstCommit` | `tools/openclinxr/evidence/the-darkness-gate-knows-which-tree-it-measured.test.ts:94` asserts stamp equality and refuses a stale stamp at line 118. It fails right now: expected `d71397b7`, received `ec5cbd42` |
| the stamp is stale because the artifact was edited later | the stamp is the newest commit touching `RUNTIME_PATHS = ["apps/ui-xr/src/main.ts"]`, not the artifact's own commit (`tools/openclinxr/evidence/station-luminance-sweep.ts:40`). An evidence commit newer than its measured runtime commit is normal |
| plant three cards now, then add clauses | `done_when` is frozen after Planted (bothy-board skill, Contract section). Every clause correction happens before the plant |

Withdrawn in the second pass, on the peer review:

| claim | measured |
|---|---|
| rescope `tsk_27baa1ed86266d7b`, then plant it | that card is already `factory=Planted`, so its `done_when` is frozen. Steps 4 and 5 of the first action table were a frozen-contract rewrite, stated one paragraph after the plan recorded the freeze rule about a different card |
| retire issue-750, then put the gown RED on a board card | issue 750 is OPEN on GitHub with a live worktree `wt/issue-750` at `26742047`. The gown lane already has an owner; a second `live:` owner on that file is the collision the plan itself forbade |
| `changed:tools/openclinxr/asset-pipeline/anny/automate_blender.py` | the gown RED's own header says CAUSE NOT DETERMINED and lists three unranked readings. The issue-750 worktree names candidate A, whole-shell subdivision, as the skirt floor mechanism. Pinning a generator before a control/treatment presupposes the cause |
| `integrate.ts` acquires at 603 and releases at 724 | 604 and 725. My own grep had it right and I copied the consult's numbers over it |

Withdrawn in the third pass, on a further consult (rounds 5 to 7 of the same codex thread):

| claim | measured |
|---|---|
| the speak-fixture stills show a shredded gown, so the card advances the rigging station | the capture violates the near plane and does not repeat. `wt/bothy-tsk_27baa1ed86266d7b` holds a second capture of the same fixture whose speaking still shows a smooth teal garment at chest framing, no shards on the torso. Two captures of one fixture, one shattered and one smooth, so the pixels cannot carry a geometry claim |
| there is one product lane | there are two, and they are independent. Fixing the camera leaves the gown RED red; fixing the gown leaves the camera 9.5 cm from torso geometry |

The gown geometry defect survives that withdrawal on independent evidence.
`tools/openclinxr/evidence/garment-decile-sharpness.ts:45` reads the shipped GLBs directly,
derives face normals from vertex positions at line 57, and counts interior edges past 60 degrees
at line 102. No PNG and no raycaster enters that computation. Re-run on `74d02b72`: 3 passed, 2
expected fail. The claim it supports is an abnormal sharp-edge floor in the skirt, not visible
shredding, and the RED's own header says CAUSE NOT DETERMINED.

The first draft's conclusion that the sweep is stale survives. Its mechanism and its remedy did
not: the freshness instrument it proposed building already exists and is already red.

A fifth defect was found in the first draft's own contract proposal. A `live:` rule passes only
at zero remaining `it.fails` in the named file
(`packages/openclinxr/agent-loop/src/done-when-rules.ts:386`), so putting `live:` on
`the-luminance-gate-only-claims-what-it-can-see.test.ts` would have obliged an instrument card to
flip three unrelated product REDs before it could land.

---

## Part 1 — `tsk_7ca4dfcdfb49a622` "Worldview program"

Planting the parent buys nothing. `tasks.next` excludes parents before it evaluates any
contract, and this card has 31 children.

All 31 children are terminal except one.

| status | factory | count | note |
|---|---|---|---|
| done | Landed | 22 | W1–W19 including both W14 halves |
| cancelled | Idle | 8 | 5 misfiled on Harbor `prj_00cce0fc`, 3 duplicate/overlap |
| backlog | Idle | 1 | `tsk_a7d424f578774db9` probe:reds for ui-admin |

The 8 cancellations are not lost work. W15 `0e6cdb1e`→`de200f79`, W16 `8e8c782a`→`7e3e199b`,
W17 `91539b79`→`3007002d`, W18 `f26ca114`→`ba937af8`, W19 `caae38ed`→`4f28fcd8`, all Landed.
W11b/W11s resolved into `4c40946b` plus `250729c0`.

**`tsk_a7d424f578774db9` should be cancelled, not planted.** Its premise is that a `run:` proof
over a planted RED passes on an untouched tree, so 22 worldview cards may be green about
nothing. That concern is real and it is answered for the present tree: ui-admin has zero
executable REDs and `pnpm --filter @openclinxr/ui-admin test` passes 151 tests across 36 files.
A current-state probe has zero clauses to probe. The repo already carries a prose-stripping RED
inventory in `tools/openclinxr/openclaw/openclaw-sweep.ts:55`.

The historical question — did each child flip its own RED at its own landing commit — cannot be
settled from current main, and answering it produces no product action. If the audit returned
"3 of 22 were green by construction", nothing in the repo changes: it would not prove those
three implementations wrong, and the `live:` rule already closes the hole going forward. That
audit was proposed during review and withdrawn during review under the anti-toil gate
(`agents/rules/GUARD_DRIFT.md:13`).

Close the program after cancelling that child.

---

## Part 2 — the five blocked Planted cards

### `tsk_27baa1ed86266d7b` speak-fixture stills — preserved, then superseded

**Work was at risk and is now preserved.** `wt/bothy-tsk_27baa1ed86266d7b` held six modified
files uncommitted, including three regenerated stills, the reframed capture script and a flipped
RED. The worker ledger records that session at 80 turns with `proofsOk: true`. Any close-and-reap
would have destroyed untracked binary output. Committed at `a7d9a1f2` on that branch, all
pre-commit guards green. Neither this plan's earlier draft nor the peer review knew it existed.

That worktree is diagnosis, not an answer. Its own JSON records:

| still | camera z | firstHitDistance | firstHitMeshName |
|---|---|---|---|
| rest | 0.72 | 0.7252 | `openclinxr.ed_chest_pain_priority_v1.phoneme-mouth-cue.patient` |
| speaking-1 | 0.45 | 0.0948 | `openclinxr_real_garment_from_phenotype_hospital_gown` |
| speaking-2 | 0.45 | 0.0952 | `openclinxr_real_garment_from_phenotype_hospital_gown` |

The camera near plane is 0.1 m (`apps/ui-xr/src/main.ts:3331`). Both speaking frames sit about
5 mm inside it, so the renderer clips the first gown surface. The flipped test asserts
`firstHitActorId` and `occluder === false` only, so it greens with the camera inside the gown.

The mechanism is exact. `STILL_CAMERA_OFFSETS` is ordered z=0.72, z=0.72, z=0.72, z=0.45, z=0.90,
and the loop accepts the first candidate whose `firstHitActorId` matches the patient
(`ui-xr-viseme-drive-capture.ts:1766`). The gown inherits the patient actor id, so the z=0.45
candidate accepts and the z=0.90 candidate is never reached.

Reordering the list does not fix it. `reframeForStill` tries a separately hard-coded z=0.72 first
and then iterates `STILL_CAMERA_OFFSETS.slice(1)`, so promoting z=0.90 to element zero would skip
it. Ordering is policy; the acceptance predicate is the defect.

A deeper defect sits under that. With `ANCHOR_OVERRIDE` set, the capture skips the deformed
skinned-face intersection because bind space and render space disagree
(`ui-xr-viseme-drive-capture.ts:585`), and when the anchor is nearest it overwrites the result
with the anchor's own label rather than a measured triangle
(`ui-xr-viseme-drive-capture.ts:752`). So even the rest frame's mouth-cue hit at 0.7252 m may be
a synthesized label rather than an intersection. Any successor must record `firstHitKind` and
require `"triangle"`, or it can green while no face is rendered.

The card itself is `factory=Planted` and frozen. Close it only once the successor below exists,
and record in the close comment that its contract asserted actor ownership rather than head
framing.

### Successor card, to create Idle then plant

Title: speak-fixture speaking stills hit a real head cue beyond the camera near plane.

Objective: every speak-fixture still selects a camera candidate whose measured first triangle hit
is a render-space head cue lying strictly beyond the live camera near plane, with every attempted
candidate recorded. If no candidate qualifies, write the diagnostic report and stop, without
lowering the near plane and without accepting actor ownership as visibility.

Write roots: `tools/openclinxr/evidence/ui-xr-viseme-drive-capture.ts`, the new test file, the
new candidate report, `tools/openclinxr/evidence/ui-xr-speak-fixture-live.json`,
`tools/openclinxr/evidence/speak-fixture-stills/`. Do not grant `apps/ui-xr/src/main.ts`;
lowering the product near plane is the cheap green this contract exists to refuse.

Author before planting:
`tools/openclinxr/evidence/the-speak-fixture-camera-clears-the-near-plane-and-hits-the-head.test.ts`,
carrying unflipped `it.fails` clauses that the committed `a7d9a1f2` output fails on both speaking
frames.

```text
live:tools/openclinxr/evidence/the-speak-fixture-camera-clears-the-near-plane-and-hits-the-head.test.ts
run:pnpm exec vitest run tools/openclinxr/evidence/the-speak-fixture-camera-clears-the-near-plane-and-hits-the-head.test.ts --reporter=dot
min-bytes:tools/openclinxr/evidence/speak-fixture-camera-candidate-report.json:512
```

The browser capture stays out of the proof rules. `pnpm local:voice:ui-xr-speak-fixture` launches
Vite and Chromium behind two 180-second waits and a 30-second bridge wait, samples for several
seconds of wall clock, and overwrites tracked PNGs and JSON as it runs
(`ui-xr-viseme-drive-capture.ts:1677`, `:1799`, `:1886`). Its scripted ceiling is around seven
minutes against a 15-minute evaluator budget (`done-when-rules.ts:235`), and the post-merge
re-run has no timeout at all (`integrate.ts:784`). The worker runs the capture once as
production work and commits its output; the proofs read that output.

`exists:` on the candidate report would be satisfied by an empty file, and `live:` only proves
the markers are gone rather than tying them to the report. The RED must parse the report and
assert its shape and populations directly: every attempted offset present, each with offset,
camera near, status, first-hit mesh, actor, distance, kind, and rejection reason.

There is deliberately no unconditional `changed:`. A `changed:` on the capture producer would
forbid the honest report-and-stop branch the objective permits. On a successful landing the diff
carries the producer and the flipped RED; on a no-candidate result the worker writes the report,
leaves the RED unflipped, and reports blocked.

The threshold is the renderer's own `camera.near`, read live per frame rather than copied as a
constant, which makes it independent of the observed 0.0948 failure. Rest at 0.7252 m against a
mouth-cue name is the known-good column. No numeric "good portrait distance" threshold exists
yet; do not invent one. A candidate sweep with native grades is what would derive it.

**A head-cue predicate alone is not enough, and this is the trap to design against.**
`phoneme-mouth-cue` is a 13 x 3 x 1.4 cm `BoxGeometry` proxy (`apps/ui-xr/src/main.ts:6474`),
`runtime-jaw-viseme-target` is another box (`:6547`), and `updateHumanoidSpeechCue` sets
`mouthCue.visible = false` whenever there is no active speech (`:8476`). So the rest frame's
mouth-cue hit is a hit on an invisible proxy, and a worker can satisfy mesh name, triangle kind,
`subjectInFrame` and a 0.1001 m standoff while the rendered face is cropped, occluded, or
absent. `subjectInFrame` tests one projected point (`ui-xr-viseme-drive-capture.ts:505`). The RED
needs renderer-congruent face evidence, and the native pixel grade stays a mandatory pre-land
step rather than a courtesy.

Not tested by this card: learner-runtime camera placement outside the dev fixture, headset
appearance, gown topology or issue 750, and whether a technically valid head-cue hit produces an
acceptable portrait. That last one stays a pixel grade.

### Gown surface lane — issue 750

Issue 750 is OPEN on GitHub. Its local brief carries `live:` and `run:` on
`the-gown-shell-is-not-sharp-where-no-fold-runs.test.ts` plus
`exists:tools/openclinxr/evidence/issue-750/gown-vs-clean-shell.json`, and worktree
`wt/issue-750` sits at `26742047` with a committed diagnosis leg naming whole-shell subdivision
as the skirt floor mechanism. That worktree is 275 commits behind `74d02b72`. Continue there. Do
not open a second board card carrying the same `live:` target.

The RED has 2 `it.fails` call sites, relative ceilings against two clean comparators, and
counterweights refusing a degraded comparator. Both gown GLBs are tracked, so a `changed:` on
them has a land path. Do not pin a producer file in that contract until a control/treatment on
one asset shows that file moving the sharpness numbers.

### `tsk_997716b5f42b8930` luminance gate — leave blocked, re-run the sweep first

The sweep on disk is stale and the existing freshness gate already says so. Re-run it at
the then-current HEAD with `pnpm exec tsx tools/openclinxr/evidence/station-luminance-sweep.ts`; the writer
emits the runtime stamp itself (`station-luminance-sweep.ts:85`). The current medians of 0 for
`primary_care_dyslipidemia_joint_pain_v1` and 2 for `peds_fever_v1` are readings of an older
runtime and are not evidence about the current product. Do not re-scope the card until a fresh
reading plus a native grade names a reproducible defect and a renderer write root.

Both stations this card lists as known-good have moved: `primary_care` from 23 to 0,
`ward_delirium` from 84 to 28. `ed_stroke_alert_handoff_v1`, whose "median 0" blocked the card,
reads 24 in the stale artifact. That number came from a re-run that was never landed.

### `tsk_2c7219bfbba6691e` camera sign flip — close it

The nondeterminism it names landed under #638.
`tools/openclinxr/evidence/the-room-camera-lands-in-the-same-place-twice.test.ts` carries 0
`it.fails` call sites; its clauses at lines 44 and 81 are ordinary `it()`. Re-scoping this card
to a defect that is already fixed and tested would be contract manufacture. Its
`failedTreatments` entry (widening `scoreTieBandMeters` 0.05 to 0.44, fitted to a measured 0.22
gap) stays on the record.

### `tsk_475bac1eecc4f387` Codex bridge pilot — close as superseded

Do not spend a card unlocking it. Reap worktree `bothy-tsk_475bac1eecc4f387` at close.

### `tsk_c2822f728a7dde77` Codex bridge hardening — leave blocked, preserve the branch

Commit the WIP on `wt/bothy-tsk_c2822f728a7dde77` to its branch before any resume, because a
`dispatch()` resume resets the worktree before it reattaches the session and untracked bytes do
not survive that.

Do not plant `tsk_f500b82767fc7452` merely to turn this chain green. It advances no D9 station.
When it is eventually planted, three contract defects must be fixed first:

1. `live:only-one-integrator-mutates-main-at-a-time.test.ts` is already satisfied. That file has
   0 `it.fails` call sites, so the clause passes before the card does any work. Its one
   integration clause checks that `integrate.ts` contains the strings `acquireIntegrationLock`
   and `releaseIntegrationLock` (lines 190–194) and nothing more.
2. The 50-iteration threshold is fitted. The tree records 8 failures in 8 runs pre-fix and 4 in
   8 on remeasurement (`only-one-integrator-mutates-main-at-a-time.test.ts:47`); the card's
   "5 in 6" is unverifiable from the tree. Taking the weaker auditable rate p = 4/8 and a stated
   99% regression-detection target gives n = 7, since 0.5^7 = 1/128 = 0.78%. Fifty iterations
   times eight processes is 800 process launches, extrapolating to 60–120 s per proof execution
   and 3–6 minutes per land across worker, merge and post-merge verification. Seven is the
   regression contract; fifty is a soak test and belongs on a scheduled lane, not in a land
   proof. Cutting 50 to 7 costs detection of rarer races: a 5%-frequency race drops from 92.3%
   to 30.2%, a 1%-frequency race from 39.5% to 6.8%. Name that loss in the contract or keep the
   soak lane.
3. Lost ownership is uncovered, behaviourally and in tests. `integrate.ts` imports only acquire
   and release (line 4), acquires at 604, mutates shared main through merge, commit, rebuild,
   proof re-run, event and board write, then releases blindly in `finally` at 725. It never
   calls `renewIntegrationLock`, never re-checks ownership, and never reads release's return
   value. `integration-lock.ts` contains zero occurrences of the string `token`; `LockResult` is
   `{acquired, heldBy?, stoleFrom?}` (line 81), so release and renewal authenticate on a
   caller-supplied owner string. The 128-bit opaque handle the card's `knownGood` requires does
   not exist yet.

A `live:` rule on the absent `integration-lock.stress.test.ts` evaluates and fails with
`missing <path>` (`done-when-rules.ts:403`). `briefFromIssue` does not reject the absent path
(`tools/openclinxr/openclaw/board-brief.ts:261`), but `audit-board-graph.ts:99` treats a Planted
card whose `live:` target is absent as mechanically defective. Commit the stress file with real
REDs before planting.

---

## Ordered actions

Item 0 is done. `a7d9a1f2` on `wt/bothy-tsk_27baa1ed86266d7b` preserves six files that a close
would have destroyed.

Execution order is not the order the cards were discussed. Running the census first delays both
product lanes without settling either, and running the sweep first dirties tracked
`station-luminance-sweep.json` on main (`station-luminance-sweep.ts:85`) underneath the plant
commit that has to land next.

| # | action | target | D9 station |
|---|---|---|---|
| 1 | audit | every worktree named for resume or reap; preserve material changes first | NONE |
| 2 | author + probe | the successor RED in a clean plant worktree, then **commit it to main** | render |
| 3 | create, plant, dispatch | the successor card, Idle first so nothing is frozen | render |
| 4 | close | `tsk_2c7219bfbba6691e` (defect landed under #638) while the worker runs | NONE |
| 5 | cancel | `tsk_a7d424f578774db9` (0 executable ui-admin REDs to probe) | NONE |
| 6 | close | `tsk_7ca4dfcdfb49a622` after item 5 | NONE |
| 7 | harvest, grade, integrate | the successor; native pixel grade before land | render |
| 8 | close | `tsk_27baa1ed86266d7b` only after item 7 lands; never rewrite its frozen TREE | NONE |
| 9 | close | `tsk_475bac1eecc4f387` after a final dirty-state audit; reap its worktree | NONE |
| 10 | rebase then continue | issue 750 from its 275-commit-old base; harvest and integrate, or record report-and-stop | rigging |
| 11 | run | `pnpm exec tsx tools/openclinxr/evidence/station-luminance-sweep.ts` at the resulting HEAD | NONE |
| 12 | leave blocked | `tsk_997716b5f42b8930` pending item 11; if a fresh median names a defect, open a NEW card rather than rescoping the frozen one | NONE |
| 13 | leave blocked | `tsk_c2822f728a7dde77`; do not plant `tsk_f500b82767fc7452` | NONE |
| 14 | run | `pnpm exec tsx tools/openclinxr/dark-factory/multi-case-runner.ts --all` | NONE (census) |
| 15 | select | next product slice = `firstNonDeterministicStation` from item 14 | per frontier |

**Item 2's commit step is the failure this plan is most likely to hit.** A dispatched worktree is
created from main, so a plant that is not committed to main leaves the `live:` target missing in
the worker's tree, or collides at integration with the untracked file. That is a measured trap in
this repo (`.agents/skills/orchestrator-dispatch-loop/SKILL.md:89`).

Item 14 is the one aggregate run the anti-toil gate permits, because it closes a specific
implementation-selection gate (`agents/rules/GUARD_DRIFT.md:15`). It runs after a coherent
product batch rather than before one. Record against it: HEAD, command, UTC start and end, exit
code, SHA-256 of the rollup, `generatedAt`, `casesAttempted`, `casesFullyDeterministic`,
`deterministicStationTotals`, `frontierCounts`, and per case `firstNonDeterministicStation` and
`stoppedAtReason`. A green rollup closes none of the six cards. Item 15 is its output, not an
action.

Concurrency: items 4, 5 and 6 are board-only and can run while a worker is dispatched, with 6
after 5. No two integrations may overlap. Do not run the successor capture concurrently with
issue 750, because the capture consumes the exact gown asset issue 750 may change. Do not overlap
the census, the sweep, or an integration on main.

Item 13 no longer asks for a WIP commit. `wt/bothy-tsk_c2822f728a7dde77` is clean; the earlier
instruction was carried over from the first draft and is stale.

## Correction to the peer review

The peer review states that #46 still blocks visual garment appearance claims. Issue 46 is
CLOSED, state reason COMPLETED, closed 2026-08-06. It does not gate the gown lane. The
producer/grader split still applies to any still that is graded, and that comes from
`pixel-grading`, not from #46.

## Claim and scope

Claim: board facts are from revision 1774; tree facts are from `74d02b72` on 2026-08-31.
Measured here: the near plane at `main.ts:3331`; the three per-frame camera z offsets, first-hit
distances and mesh names in the preserved worktree JSON; the `STILL_CAMERA_OFFSETS` order and the
actor-id acceptance predicate; the `ANCHOR_OVERRIDE` skip and label overwrite; the gown RED
re-run at 3 passed and 2 expected fail; issue 750's open state, worktree sha and 275-commit lag;
issue 46's closed state. Both pixel grades are mine, at native 1280x1280: main's speaking-1 shows
radiating shards, the preserved worktree's speaking-1 shows a smooth teal garment at chest
framing with no head.

Consulted (gpt-5.6-sol, seven rounds): the near-plane contamination reading, the two-lane
separation, the successor contract shape, and the synthetic-hit structural finding. Each cited
path was confirmed to exist and each numeric claim was re-measured here before being written
down.

Not tested: the sweep re-run at `74d02b72`; the multi-case runner; a re-run of
`only-one-integrator-mutates-main-at-a-time.test.ts`, so its 4-in-8 rate is taken from its
recorded header; whether whole-shell subdivision is the skirt floor mechanism, which was read
from a worktree commit message; whether a farthest-first candidate order would produce a passing
frame, since untried candidates are not recorded; whether the rest frame's mouth-cue hit is a
real triangle intersection or a synthesized label, which is exactly what the successor card's
`firstHitKind` field exists to settle; the wall-clock of `pnpm local:voice:ui-xr-speak-fixture`,
which is bounded here from its scripted waits rather than observed; and whether near-plane
clipping CAUSED the shard pixels in main's still, which needs a controlled same-state capture
beyond the near plane and is the reason that claim is stated as contamination rather than cause.
