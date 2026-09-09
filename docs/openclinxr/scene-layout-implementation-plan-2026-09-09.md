# Scene-layout implementation plan — verified seams and parallel lanes

**2026-09-09 · derived from [the research brief](humanoid-scene-layout-research-brief-2026-09-09.md), verified against `f82e3ed2`**

Four read-only agents checked the brief's source claims against the tree. Every
claim they could test held; several are worse than the brief states, and three
things the brief treats as open are already decided by code. This plan records
what was measured, then splits the work by write-root so lanes run in parallel.

**No code was written for this plan.** Every line number below is a static read.

## 1. What the verification changed

### The placement chain is complete, and its last link is the decisive one

The brief describes a payload disagreement from case to runtime. Confirmed at
every link, with two additions.

| link | file:line | state |
|---|---|---|
| case schema | `packages/openclinxr/shared-schemas/src/schemas.ts:235-241` | `plantOffsetMeters: { x, y, z }`, optional |
| authored data exists | `packages/openclinxr/scenario-fixtures/src/clinic-knee-pain.ts:53,76,99` | `{x:0.4,y:0,z:0}`, `{x:-0.55,y:0,z:0.2}`, `{x:0.9,y:0,z:-0.35}` |
| admin authoring | `packages/openclinxr/ui-route-admin/src/environment-generation-queue-panel.tsx:121-124,455-465` | `plantOffsetMeters?: number`, `InputNumber min={0}` |
| staging station | `packages/openclinxr/factory-stations/src/catalog.ts:203-207` | `type: "number", required: true` |
| compile node | `tools/openclinxr/factory/encounter-materialization-evidence.ts:309-323` | omits the offset; `status: "planned_unsplit"` |
| factory stage | `tools/openclinxr/dark-factory/multi-case-runner.ts:806-807` | `supportSurface: placement.posture`, `plantOffsetMeters: 0` |
| runtime bundle | `tools/openclinxr/factory/generated-ed-station-runtime-bundle.ts:1248-1275` | four hardcoded positions |
| ui-xr | `apps/ui-xr/src/main.ts:846-848` | discards the bundle position for seated and supine |

Two findings beyond the brief.

**The faculty lock is stored and inert.** `PLACEMENT_OVERRIDE_PATHS` includes
`/plantOffsetMeters` (`encounter-materialization-evidence.ts:634`) and
`encounter-materialization-faculty-locks.ts:45-46` treats it as lockable. The
override is never applied to a Placement node at all. `specAfterOverride`
(`encounter-materialization-compile.ts:167-176`) is called only from
`recipeKeyFor` (`:88-95`), and `:136` reads
`const skipCapable = node.family === "EquipVariant" || node.family === "Room"`.
Placement is neither, so it keeps `node.cacheKey` — null from the emitter — and
the patch is neither hashed nor read. A `/plantOffsetMeters` lock sits on the
node and does nothing.

Putting the offset on the emitted spec is a precondition for a future
skip-capable Placement family, not a fix for the lock. See §5: this document
asserted three different mechanisms for this one behaviour before measuring the
gate at `:136`, and each wrong one survived a round of review.

**`min={0}` makes the authored data unrepresentable.** `clinic-knee-pain.ts:76`
authors `x: -0.55`. The admin control cannot express it.

**The last link decides the outcome.** `main.ts:846-848` replaces the resolved
position with a fixture-anchor constant for `seated` and `supine` — precisely the
two `supportSurface` values that are not `"none"`. Even a perfect fix to links 2
through 7 changes nothing visible without this one.

### A staged transform does not survive the frame loop

Three writers erase it, none of them mentioned in the brief.

`apps/ui-xr/src/main.ts:3512-3513` assigns slot yaw every frame:
`patient.rotation.y = Math.sin(now / 1200) * 0.08` (supine-exempt) and
`nurse.rotation.y = Math.sin(now / 900) * 0.12` (no exemption). Any staged
heading is gone on the next frame. The supine exemption immediately above it is
the precedent for how to fix this.

`packages/openclinxr/xr-runtime-state/src/runtime-actor-placements.ts:99-114`
re-anchors `position` and `scale` from `SLOT_PLACEMENT_ANCHORS` whenever
`existing.slotKind !== slotKind`, carrying over only `verticalOffsetMeters`,
`labelPrefix` and `posture`. The file's own header at `:16-17` still says it
"only ADDS missing actorPlacements keys; never overwrites an existing record".
The overwrite increments neither `addedActorIds` nor a changed count, so it is
invisible in `window.__openClinXrActorPlacementSsot`.

`packages/openclinxr/xr-scene/src/encounter-actor-framing.ts` runs after the
placement is applied (called from `actor-staging.ts:115,161,226,266`). The
`position.set` / `rotation.y` / `scale.setScalar` writes at `:69-115` are the OB
and telehealth branches, not an unconditional override; seated actors keep their
XZ at `:133-141`.

The hazard is the ORDER, not the writes. `actor-staging.ts:115` calls
`applyActorFraming(patient, patientActorId)` with no posture argument, and
`patient.userData.openClinXrActorPosture` is stamped seven lines later at `:122`.
The seated guard at `encounter-actor-framing.ts:133-135` reads
`actor.userData.openClinXrActorPosture` or `input.posture` and finds neither
populated, so it cannot fire for the patient and a supine patient is framed as a
floor-standing actor by default. That branch also writes `actor.rotation.y = -0.26`
(`:137`), which makes framing a third heading writer.

`packages/openclinxr/xr-humanoid-animation/src/animation-loop.ts:156` writes
`slot.root.position.x = emotionalSway + dialogueWeightShift` where `:155` and
`:141` use `slot.baseY +` and `slot.baseZ +`. `slot.baseX` is captured and unused.
This is LATENT, not live: the loader zeroes the humanoid child at
`generated-loaders.ts:112-116`, so `baseX` is 0 today. It blocks any future
child-local X offset.

### Three things the brief leaves open are already settled

**`StationActorStagingContext.actorPlacement` exists and is consumed.**
`packages/openclinxr/xr-station-room/src/actor-staging.ts:58`, called at
`:95,140,185,248`, feeding position, scale, posture, labelPrefix and the
loader's `verticalOffsetMeters`. The seam the brief proposes is already there;
what is missing is a heading field to put through it and a resolver that does
not discard the position.

**The affect scale writer cannot reach a mounted support.** `main.ts:3481`
traverses `gltfEnvContainer` only; equipment slots are siblings added directly
to `scene` (`main.ts:3060`), and the fixture stretcher lives in the station shell.
The brief's caveat is unfounded. A different defect is real: `main.ts:3485` calls
`setScalar` with no `obj !== gltfEnvContainer` guard, stomping authored scale
inside that container.

**No placement record carries a heading.** `EncounterRuntimeActorPlacement`
(`packages/openclinxr/asset-registry/src/runtime-bundles.ts:162-171`) is
`slotKind`, `position`, `scale`, `verticalOffsetMeters`, `labelPrefix`,
`posture?`. A grep for `heading|yawDegrees|facingDegrees|rotationDegrees` across
`asset-registry`, `xr-runtime-state`, `shared-schemas` and `tools/openclinxr/factory`
returns zero. Every heading in the scene is hardcoded, in three places:
`actor-staging.ts:210,216` set `spouse.rotation.y = -0.26`,
`encounter-actor-framing.ts:137` sets the same constant on any seated actor, and
`main.ts:3512-3513` assigns a sine sway to the patient and nurse every frame.

### The initial-scene planner has four hard blockers

**`equipment` and `assetNeeds` have no schema link.** `schemas.ts:490` is
`Array(String)`; `schemas.ts:491` is `Array(AssetNeedSchema)` with ids. The
fixture pairs `"12-lead ECG machine"` with `12_lead_ecg_machine_equipment`
(`ed-chest-pain.ts:266` and `:267-326`) by authorial convention only.

**Two copies of one asset are not representable.** Four places key by
`equipmentId` with no instance discriminator: `runtime-bundles.ts:187` (built by
`Object.fromEntries`, so a duplicate silently overwrites), `runtime-bundles.ts:1632`
(`.find`, first match only), `station-equipment.ts:390-404` (an explicit dedupe
`Set`), and `main.ts:2838` (`Map.set` on one slot per id).

**There is no scene-readiness gate.** Phases are
`doorway | encounter | note | review` (`domain/src/station-state.ts:3`) and
`transitionStation` (`:62-102`) takes no readiness input.
`recordBootPhase("station_scene_ready")` (`main.ts:4824`) is telemetry that gates
nothing. `main.ts:2351-2359` issues `startEncounter` on the line after
`startSession`, with no intervening await.

**`status: "loaded"` is not a readiness signal.**
`xr-asset-loading/src/generated-loaders.ts:447-462` reports `status: "loaded"`
with `fallbackActive: true` and returns early, skipping the lines that hide the
primitive fallback (`:463-465`) and attach the real mesh (`:466`). Any readiness
check must read the pair.

Two capabilities exist and are unwired, which is useful rather than a blocker:
`StationRunOptions.doorway` (`station-state.ts:36-39,57`) is tested and never
passed (`scenario-runtime.ts:101`), and
`MultiActorClinicalSession.spatialState.objectTransforms`
(`session-state/src/session-core.ts:127`) is initialised `{}` and read only by a
cloner (`durable-records.ts:61`).

**The authored event schedule reaches no dispatcher.**
`getScheduledEventsDue` (`domain/src/station-state.ts:104-111`) is called only by
`station-state.test.ts`. The other `eventSchedule` readers use `.length > 0` as a
boolean or do a tag lookup.

### The motion lane is wired end to end and structurally always drops

`conversation-policy/src/emotion-performance-mapper.ts:247` returns
`gestureClipIds: []`, deliberately (`:60-65`). Playback consumes index 0 only
(`xr-dialogue/src/actor-turn-playback.ts:206`) behind an approved-name gate
(`:208-210`), so every mapper-produced plan drops as `no_approved_gesture_clip`.
A multi-clip or goal-based executor needs a new lane on
`ActorTurnPlaybackAdapters` (`:59-65`), not a longer array.

`motion_retarget/run.ts:19` names `adapter: "@openclinxr/motion-compiler"` as a
plan string; repo-wide that specifier appears on that line and nowhere else — no
import, no dependency, no call. Blender output does reach the runtime, but as
named clips through `playOneShotResponseClip` (`main.ts:4146`), not through the
compiler.

The recorded bake-off returned `verdict: "other"`
(`tools/openclinxr/evidence/motion-backend-bakeoff/report.json:67`): the
CCDIKSolver reported a `wristR` residual of 0.0000 m for the chain that rendered
the right arm absent through a torn shoulder. Effector residual is disqualified
as an acceptance measure.

## 2. Lanes

Write roots are disjoint within a wave. `apps/ui-xr/src/main.ts` is the measured
serialization point — 91 excess-writer events over 17 days, consumed by 21 of 42
packages — so exactly one card may hold it at a time, and it is the last wave.

### Wave 1 — four concurrent, one paired

S2 and S7 are NOT disjoint: S2 must edit
`shared-schemas/src/the-factory-station-schemas-validate.test.ts`, because
`shared-schemas/src/factory-stations.ts:5-8` re-exports the catalog S2 changes
and S2's own proof runs the shared-schemas suite. That file sits inside S7's
write root. Either move the fixture into `factory-stations`, or run the two in
sequence.

| card | write roots | why first |
|---|---|---|
| **S1 heading field** | `asset-registry/src/runtime-bundles.ts` | nothing downstream can express a heading; unblocks S5 and S6 |
| **S2 authored vector** | `ui-route-admin/src`, `factory-stations/src/{catalog,staging,apply-station-payload}` | the payload disagreement; unblocks S4 |
| **S3 readiness pair** | `xr-asset-loading/src/generated-loaders.ts`, `xr-capture-evidence/src` | every later acceptance check depends on a truthful ready signal |
| **S7 scene spec schema** | `shared-schemas/src` | the equipment/assetNeeds binding blocks the planner |
| **S9 event dispatcher** | `scenario-runtime/src`, `domain/src` | independent of placement entirely |

### Wave 2 — four concurrent

| card | write roots | depends on |
|---|---|---|
| **S4 factory resolves from the case** | `tools/openclinxr/factory`, `tools/openclinxr/dark-factory`, `asset-registry/src/actor-placement.ts` | S2 |
| **S5 transform survives the loop** | `xr-humanoid-animation/src/animation-loop.ts`, `xr-runtime-state/src/runtime-actor-placements.ts`, `xr-scene/src/encounter-actor-framing.ts` | S1 |
| **S8 equipment instance identity** | `asset-registry/src/runtime-bundles.ts`, `xr-station/src`, `xr-asset-loading/src` | S1 (same file) |
| **S10 motion executor contract** | `xr-humanoid-animation/src`, `xr-pose/src` | S5 (same package) |

S5 and S10 share `xr-humanoid-animation`; S1 and S8 share `runtime-bundles.ts`.
Each pair is sequential within its own thread, so wave 2 is two threads of two,
not four independent workers.

### Wave 3 — one, serial

**S6 runtime applies the offset and the heading.** `apps/ui-xr/src/main.ts`,
`xr-station-room/src/actor-staging.ts`, `asset-registry/src/actor-posture.ts`.
Depends on S1, S4 and S5. This is the card that makes the chain visible.

### Realistic concurrency

Five in wave 1, then two threads, then one. Peak five, which sits inside the
eight-worker ceiling measured on 2026-09-08 (median 54 turns per completed
dispatch across 754 ledger records; integration is serial because `integrate.ts`
merges on main without a lease).

## 2b. The cards

PLANTED on BothyBoard project OpenClinXR. All twelve were planted; the transform card
carries two REDs.

**ALL TWELVE LANDED ON MAIN, 2026-09-09.** Each was verified at its own sha with a two-sided
probe, not from a worker's report: the fix reverted must make the RED fail, and restored must
make it pass. Every worker branch was checked against its card's declared write roots and its
immutable header before merging.

| card | id | commit | wave | lane | planted RED |
|---|---|---|---|---|---|
| event dispatcher | `tsk_dbb2a9b35361d60b` | `517e1e2e` | 1 | B | `scenario-runtime/src/a-scheduled-event-fires-once-at-its-second.test.ts` |
| heading field | `tsk_2e5ce1243b155be0` | `5cce921b` | 1 | A | `asset-registry/src/a-runtime-actor-placement-carries-a-heading.test.ts` |
| readiness pair | `tsk_863df7eccab8d6e9` | `cccf91dc` | 1 | A | `xr-capture-evidence/src/a-suppressed-slot-is-not-ready.test.ts` |
| supine control freeze | `tsk_f450619f3b195514` | `82e12960` | 1 | A | `tools/openclinxr/evidence/supine-control-freeze/the-supine-control-station-is-frozen-by-asset-bytes.test.ts` |
| equipment binding | `tsk_407803cded5714f0` | `52e389fb` | 1 | B | `scenario-fixtures/src/every-authored-equipment-string-is-classified.test.ts` |
| authored vector | `tsk_9da016db6e03034b` | `05d9bb9a` | 1 | B | `factory-stations/src/the-staging-station-takes-a-signed-plant-vector.test.ts` |
| transform survival | `tsk_c8a183614fc7f514` | `be07e9b3` | 2 | A | `xr-scene/src/the-framing-guard-keeps-seated-and-supine-anchors.test.ts` **and** `xr-humanoid-animation/src/the-frame-loop-composes-position-x-from-its-base.test.ts` |
| motion ownership | `tsk_4ff976a4b0e81bf3` | `f3ae7d79` | 2 | A | `xr-humanoid-animation/src/an-owned-chain-survives-the-posture-pass.test.ts` |
| runtime consumption | `tsk_ebdeed78d4e75141` | `2f1b4373` | 3 | A | `apps/ui-xr/src/the-authored-offset-reaches-the-posed-humanoid.test.ts` |
| factory resolution | `tsk_c42ae6e3c6b93620` | `ad2f1539` | 2 | B | `tools/openclinxr/factory/the-placement-node-carries-the-authored-offset.test.ts` |
| equipment identity | `tsk_7ae68eac956a4163` | `7dddc571` | 2 | A | `xr-station/src/two-copies-of-one-asset-mount-separately.test.ts` |
| scene specification | `tsk_e97804d9ab7be894` | `f037e585` | 2 | B | `scenario-runtime/src/the-scene-spec-reports-an-absent-required-asset.test.ts` |

### A cross-package RED measures `dist/`, and the first probe of two cards was vacuous

Every workspace package's `exports` map points at `dist/`, so a RED in package A that
imports `@openclinxr/B` loads B's LAST BUILD. Reverting B's `src/` and re-running A's RED
therefore changes nothing, and the probe passes in BOTH directions — which looks like a
robust fix and is no measurement at all.

Measured twice in one hour. Removing the ownership carve-out from
`xr-pose/src/clinical-idle-posture.ts` left the motion RED at 3/3; with
`pnpm --filter @openclinxr/xr-pose build` inserted between the edit and the run, 2 of 3
failed. Reverting `asset-registry/src/actor-posture.ts` left the runtime RED green until
the same rebuild, after which 7 of 8 failed.

`verify-fix.sh` now rebuilds unconditionally rather than only when `dist/` is absent.

### Two clauses I planted could not be satisfied honestly, and the implementations proved it

Both are in the equipment-identity card, both found by reading what passed rather than by any
gate, and both are the same defect: **a fixture that does not exhibit what its clause asserts
turns the clause into the design target, and the cheapest way to satisfy it is a wrong
implementation.**

| clause | as planted | what passed it |
|---|---|---|
| (2) | queried `iv_stand_equipment#1` and `#2` against a bundle built from `ecg_cart_equipment` alone, and demanded both defined and distinct | a resolver returning the Nth manifest entry IGNORING the asset id, so two absent ids resolved to two different assets' placements and "distinct" was satisfied by accident |
| (4) | asserted a collapsed row for `iv_stand_equipment` against a fixture of ten `ecg_cart_equipment` copies | a HARDCODED `iv_stand` row appended whenever the bundle held more than one item — the collapse-detection surface lying about what collapsed |

Both clauses now name the asset the fixture ships, and each carries a counterweight asserting
the absent case is absent. The `expect(true).toBe(true)` placeholder in clause (4) is removed.

The two-sided gate cannot catch this class. A clause that is unsatisfiable-but-passable fails
before the fix and passes after it, exactly like a good clause; only reading the implementation
that satisfied it reveals which one it was.

### Ceilings raised for contracted exports, and one tightened

| package | ratchet | before | after | for |
|---|---|---|---|---|
| `xr-capture-evidence` | rootEntrypointExports | 38 | 39 | `sceneAssetSlotIsReady` |
| `domain` | rootEntrypointExports | 28 | 30 | `getScheduledEventsDue` and its type |
| `shared-schemas` | rootEntrypointExports | 71 | 74 | the equipment binding trio |
| `xr-pose` | rootEntrypointExports | 45 | 47 | `boneIsOwned`, `OwnedChain` |
| `asset-registry` | rootEntrypointExports | 221 | 223 | `composeSupportedActorWorldPosition` and its refusal type |
| `xr-runtime-state` | rootEntrypointExports | 123 | 128 | the placement evidence and the composition seam |
| `ui-route-admin` | SIZE_FREEZE (panel) | 595 | **575** | tightened, after the authoring row was extracted |
| `apps/ui-xr` | app maxLines | 6083 | **6046** | tightened, after the composition moved to `xr-runtime-state` |

The context-field budget refused two members the motion card's first draft added to
`HumanoidAnimationRuntimeContext` (37 > 35) and was right: with ownership claimed on the
ACTOR, the frame loop needs no new context members and `types.ts` is byte-identical to main.

### The card table as originally planted

| card | id | wave | lane | planted RED |
|---|---|---|---|---|
| heading field | `tsk_2e5ce1243b155be0` | 1 | A | `asset-registry/src/a-runtime-actor-placement-carries-a-heading.test.ts` |
| authored vector | `tsk_9da016db6e03034b` | 1 | B | `factory-stations/src/the-staging-station-takes-a-signed-plant-vector.test.ts` |
| readiness pair | `tsk_863df7eccab8d6e9` | 1 | A | `xr-capture-evidence/src/a-suppressed-slot-is-not-ready.test.ts` |
| equipment binding | `tsk_407803cded5714f0` | 1 | B | `scenario-fixtures/src/every-authored-equipment-string-is-classified.test.ts` |
| event dispatcher | `tsk_dbb2a9b35361d60b` | 1 | B | `scenario-runtime/src/a-scheduled-event-fires-once-at-its-second.test.ts` |
| supine control freeze | `tsk_04c747d251933519` | 1 | A | `tools/openclinxr/evidence/the-supine-control-station-is-frozen-by-asset-bytes.test.ts` |
| factory resolution | `tsk_c42ae6e3c6b93620` | 2 | B | `tools/openclinxr/factory/the-placement-node-carries-the-authored-offset.test.ts` |
| transform survival | `tsk_c8a183614fc7f514` | 2 | A | `xr-scene/src/the-framing-guard-keeps-seated-and-supine-anchors.test.ts` **and** `xr-humanoid-animation/src/the-frame-loop-composes-position-x-from-its-base.test.ts` |
| equipment identity | `tsk_7ae68eac956a4163` | 2 | A | `xr-station/src/two-copies-of-one-asset-mount-separately.test.ts` |
| motion ownership | `tsk_4ff976a4b0e81bf3` | 2 | A | `xr-humanoid-animation/src/an-owned-chain-survives-the-posture-pass.test.ts` |
| scene specification | `tsk_e97804d9ab7be894` | 2 | B | `scenario-runtime/src/the-scene-spec-reports-an-absent-required-asset.test.ts` |
| runtime consumption | pending its RED | 3 | A | `apps/ui-xr/src/the-authored-offset-reaches-the-posed-humanoid.test.ts` |

### The plant mechanism: `it.fails` plus `live:`, and why a bare `run:` was not enough

The set was unplantable because every card named a planted RED that did not exist, and because a
plain failing test would have turned four package suites red for reasons outside the card being
graded. Four true circular blocks were mapped: the ui-xr suite (blocking readiness, transform,
identity and motion, while only the last card fixes it), scenario-runtime, shared-schemas, and
xr-humanoid-animation.

The repo's own convention dissolves all four, and 347 files already follow it. A plant written as
`it.fails(...)` PASSES while the defect stands, so package suites stay green, and ERRORS once the
defect is fixed, which forces conversion to `it(` in the same change.

`board-brief.ts:490-543` enforces the other half. Probed directly on 2026-09-09 with a synthetic
plant: a card whose `run:` names a file containing `it.fails` is REFUSED unless a `live:<path>` rule
covers it, because "vitest counts an expected-fail as a PASS, so that run: exits 0 on an UNTOUCHED
tree". Every card now carries both.

### Every RED passed a two-sided gate before it was committed

`.openclinxr/scene-layout-reds/gate.sh` runs each file twice:

- as written (`it.fails`) it MUST PASS, so the plant does not turn main red;
- with `.fails` stripped it MUST FAIL, or the clauses assert nothing.

Twelve REDs, thirteen files. What the gate and the lint gate caught, none of which a one-sided
check would have found:

| defect | where |
|---|---|
| tautological clauses that pass before AND after the slice | heading (2 clauses), equipment identity (2 clauses) |
| a green CONTROL crashing because an actor stub lacked `scale.setScalar` | transform survival |
| a clause marked `it.fails` that is really a control and must stay green | factory resolution, transform survival |
| a helper unreachable from its package entrypoint | event dispatcher, `domain/src/index.ts:15-19` |
| a RED in a package that cannot import what it needs | equipment binding, transform survival |
| a RED statically importing the module its own slice creates | supine control freeze, caught by knip |
| a duplicate object key silently dropped by JS, so the fixture tested nothing | equipment identity |
| `@openclinxr/*` specifiers from `tools/`, where the convention is relative paths | factory resolution |

### Two corrections to this document, from re-reading the brief after the workers launched

**The scene-spec outcome vocabulary is four values, not a boolean.** Brief §3: each required
starting-state check returns "satisfied, unsatisfied, pending or unknown with observed evidence.
Pending means an identified consumer is still loading; unknown means no adequate observation yet.
Neither permits required-state promotion." A boolean collapses pending and unknown into false.

**Brief §7 step 1 had no card at all.** "Freeze one existing supine station as a control ... record
asset hashes." Without it, every "the unauthored control did not move" claim rests on values that
could drift because an asset changed rather than because the code did. That is now a twelfth card.

### The board's dequeue is jammed, and the cards were routed around it

`tasks.next` returns `{task:null}` for every ready card. The project's `maxInFlight` is 2 and two
cards unrelated to this work — `tsk_298d0ead7dc551e4` and `tsk_8b737c43e8e9cbc4` — have held both
slots at `factory=Dispatched, status=review` since 2026-09-04. `tasks.release` refuses both with
"Task is not on an active lease": the lease expired but the factory state did not follow it.

The first was verified in an isolated worktree at current main, built, with dependencies installed:
it merges cleanly, `session-state` passes 24 tests, and `exam-assembly` fails 3 with
`advanceExamFormRunBreak is not a function` — a 90-commit drift, not a broken main, since the same
suite passes on main without the merge. It was not attested, and the finding is recorded on the
card.

Fix workers are dispatched directly into per-card worktrees instead. Reopening the normal dequeue
needs either a rebase-and-land of those two cards or a higher `maxInFlight`.

## 2c. Status against the BRIEF, which is not the same as status against the cards

Twelve cards landed. That is not the brief, and conflating the two is the error this section
exists to prevent: the cards were my decomposition of one part of §7, and a green card table
says nothing about the six steps it never covered.

Measured against `§7 Prioritized prototype and acceptance`:

| step | state | what is actually true |
|---|---|---|
| 0 — specify the starting scene | **MET within its own scope** | `buildInitialSceneSpec` returns the four outcomes with observed evidence, and `initialSceneSpecPermitsPromotion` now READS it: only `satisfied` promotes, `pending` and `unknown` are refusals, and every blocker is named with its consumer and evidence. It does not gate a phase, which step 0's own out-of-scope forbids. |
| 1 — freeze one supine station as a control | **met** | `computeSupineControlFreeze` hashes every asset the station loads and refuses a recorded measurement whose bytes moved, naming the changed path. |
| 2 — prove authoring reaches the scene | **MET 2026-09-09** | Measured on the loaded, posed, skinned humanoid after framing, pose application and 30 further frames, as a control/treatment pair: `measured delta {x: 0.3967, z: -0.0015}` against an authored `{x: 0.4, z: 0}` — err 0.0033 m and 0.0015 m against a 0.02 m tolerance derived from the unauthored control's own drift. The unauthored supine control retains its defaults. |
| 3 — stationary clinical staging | **MET** | Staged as a physician, clear of the measured deck, facing the patient, heading consumed, clearance / approach corridor / monitor visibility reporting against measured bounds with controls, and the idle sway COMPOSES onto the persistent heading within a bounded allowance. What is NOT claimed: none of it is measured on a loaded humanoid the way step 2 is, and clinical correctness of any position remains a clinician's call. |
| 4 — physician approach | **MET 2026-09-09** | Bounded path, continuous-path collisions, final pose, a goal executor that stops at the target and refuses an unproven plan, and a foot-sliding measurement. The failing number is fixed at its cause: a retargeted CMU walk is bound to the shipped physician, grafted in without the Blender round trip that eats eyebrows, and the locomotion drive plays it instead of sliding the root. Foot slide on the shipped rig is 2.6% / 8.1% of root travel at the runtime's own contact height, against the root-driven executor's 100%. The patient stays statically supine, as step 4 requires. |
| 5 — variation, replay and failure behaviour | **MET 2026-09-09** | Changed asset geometry invalidates dependent evidence; variation indices are seeded, reproducible and actually explore; an impossible layout is refused with every candidate named; a corrupt or removed artifact is refused with the four cases distinguished. Displayed motion is now measured on the loaded, posed, skinned physician: the driven toe spans 1.089 m over 60 frames against a drive-off control of 0.0385 m (28x), every sampled leg joint moves, and the `clipPlayed` flag decides nothing — a flag set with no motion reads `unsatisfied`. |
| 6 — compare one legally eligible learned provider | **CLOSED, negative** | `reject_measured`: the code says a 77-joint skeleton, the checkpoint says 30. The manifest filter fails on a measured contradiction, so the baseline is retained. A negative cagematch result closes the item, which is what the brief says. Record: `kimodo-soma-rp-v11-cagematch-2026-09-09.md`. |

**All seven steps of §7 now have a state, and none is partial.** Steps 0-5 are met within their
stated scopes; step 6 is closed negative with the baseline retained, which the brief says is a
successful cagematch outcome.

**What is NOT claimed, and each is stated where its evidence sits rather than here:** clinical
correctness of any position or gait (a clinician's call, per the brief's own deliverables line);
Quest performance (needs a worn-headset measurement); step 3's staging measured on a loaded humanoid
the way step 2 is; and the eight shipped humanoids whose provenance names a sha256 that does not
match their bytes, frozen as debt rather than repaired by rewriting the hashes.

### The instrument step 2 needs, and why it is an instrument rather than a contract

`tools/openclinxr/evidence/authored-offset-on-the-posed-humanoid.ts` boots ui-xr portless, drives
the two controls the brief names — the AUTHORED clinic placement and an UNAUTHORED supine station —
and samples the patient **twice**: once when the runtime reports its assets settled, and again after
a further 30 frames, because "subsequent frame updates" is a requirement and a placement that is
correct at settle and gone six frames later has not survived.

It samples two things per station, and the pair is the point:

- the **actor slot Group** world position — the container;
- the **CPU-skinned mesh world bounds centre** — the figure a learner sees.

The brief names the failure that separates them: *"Writing world coordinates into local bases is not
a fix."* A slot that moves while its humanoid child compensates in local space satisfies any
slot-only assertion while the figure stays put, so both are recorded and allowed to disagree in the
artifact rather than silently agreeing in a boolean.

The skinning math is not new. It was already proven inside `inpatient-supine-staging.ts`, which the
brief cites as the existing staging instrument [R26], and it is now
`lib/skinned-world-sampling.ts` — one implementation consumed by both, because two copies of a
100-line CPU-skinning routine drift and the drift is silent: both keep returning plausible numbers.
That instrument's own suite is the extraction's proof.

### First run: the instrument reported green about the wrong humanoid

Run 1 (`2026-09-09T11:08:48Z`) navigated to both control stations and returned `satisfied` for
both. It was wrong, and the way it was wrong is the finding.

| scenario | patient the CASE declares | patient the RUNTIME staged | skinned centre |
|---|---|---|---|
| `clinic_knee_pain_return_to_play_v1` | `patient_jordan_cole_v1` (seated, chair) | **`patient_robert_hayes_v1`** | x −0.3769 z −0.2902 |
| `ed_chest_pain_priority_v2` | `patient_robert_hayes_v1` | `patient_robert_hayes_v1` | x −0.4052 z −0.3889 |

Navigating to the clinic scenario staged the **ED** patient. `main.ts:641` binds
`createEdChestPainLocalLearnerRuntimeAssetBundle()` and the runtime only RECORDS a
`scenario_mismatch` reason (`main.ts:705-715`) rather than materializing the selected case, so the
cast stays the ED cast whatever the URL asks for. `selectedScenarioId()` reads the parameter
(`main.ts:1007-1016`); the bundle does not follow it.

**Consequence for the brief: step 2's AUTHORED half cannot be exercised in the runtime at all
today.** The only case that authors a plant offset is the clinic scenario, and the runtime will not
stage its cast. That is upstream of the composition the runtime card landed, and it is a larger
blocker than anything the twelve cards addressed.

**And the classifier reported `satisfied` anyway**, because it looked up an authored offset for
`patient_robert_hayes_v1`, found none — that actor authors none — and took the unauthored-control
branch. A measurement that cannot tell which humanoid it measured is worth less than no
measurement. The missing counterweight is now the FIRST check in `classify`: the staged actor id is
compared against the one the case declares, and a mismatch returns `unsatisfied` naming both ids,
because per the brief an unsupported required state is unsatisfied rather than unknown.

The drift figures are the part of run 1 that stands: 0.0081 m and 0.0034 m of skinned-centre
movement across 30 further frames, on a figure the frame loop rewrites every frame. Small, real,
and now measurable.

### The pinned-bundle blocker is removed, and the next link is now visible

The cast table already resolves per scenario (`resolveScenarioActorCast`, called at
`runtime-bundles.ts:707`). The builder ignored its actor ids and hardcoded ED literals, and the
ui-xr boot path bound three more by literal id, so every non-ED case staged the ED cast.

Both now follow the case: `resolveBundleCastActorIds` maps the cast's roles onto the three runtime
slots (`cast-actor-ids.ts`), and the boot bindings resolve through `findRuntimeActorAssetByRole`.
Roles come as a LIST because the same slot is cast differently — `nurse` in the ED cast,
`medical_assistant` in the clinic cast. The ED literals remain as fallbacks, so a cast missing a
role keeps today's behaviour instead of losing an actor, and the ED path is unchanged:

    ed_chest_pain_priority_v2          -> patient_robert_hayes_v1, nurse_maria_alvarez_v1, spouse_anna_hayes_v1
    clinic_knee_pain_return_to_play_v1 -> patient_jordan_cole_v1, medical_assistant_rui_park_v1, parent_lena_cole_v1

**Run 3, on the loaded humanoid:** the clinic station stages `patient_jordan_cole_v1` for the first
time, and its authored offset `{x: 0.4, z: 0}` is now recorded against the right figure.

**The next link is in the same measurement, and it is why step 2 is still not met.** The clinic
patient sampled at `posture=standing`, x −0.9126 — the ED stretcher default. The clinic case
authors `supportSurface: "chair"`, and the composition landed by the runtime card only applies to
seated and supine, so a patient resolved as standing passes straight through it. The scene manifest
is still `createEdChestPainRuntimeSceneManifest`, pinned like the cast was.

So the chain now reads: cast follows the case (**fixed**) -> scene manifest and posture follow the
case (**next**) -> composition applies (**landed**) -> the frame loop preserves it (**landed**).
The instrument reports `unknown` for that row rather than guessing, because it does not resolve the
fixture anchor a station composes onto and no verdict is possible without it.

### The posture link, and what the final step-2 verdict still needs

The scene manifest keyed its placements by ED literal actor ids with hardcoded postures, so a
non-ED case matched no entry, fell back to the ED defaults, and resolved every actor as standing.
That mattered because the composition applies only to seated and supine: a patient wrongly
resolved as standing passes straight through it, so the authored offset could not reach the figure
however correct the composition was.

Placements are now keyed by the case's cast and posture comes from the authored support surface
(`case-actor-placements.ts`). `chair` seats, `stretcher`/`bed` lay supine, and `none`, unknown or
absent all stand — unknown deliberately degrades to the pass-through rather than refusing a
scenario, because the case schema takes free text and the refusal that matters (a nonzero NORMAL
offset) belongs to `composeSupportedActorWorldPosition` and is not duplicated.

    ed_chest_pain_priority_v2          patient supine   nurse standing   spouse standing   (unchanged)
    clinic_knee_pain_return_to_play_v1 patient SEATED   MA standing      parent SEATED

**Run 4, live:** `clinic_knee_pain_return_to_play_v1: patient_jordan_cole_v1 posture=seated`. The
chain now runs end to end — cast follows the case, manifest and posture follow the case, the
composition applies, the frame loop preserves it.

**The verdict is still `unknown`, and the reason is a real design constraint rather than missing
plumbing.** The instrument samples the SKINNED CENTRE, which carries the body's own offset from
its origin. Comparing that centre against `anchor + authoredOffset` would be comparing two
different quantities and would need a fudge term to agree — the shape of a threshold fitted to
clear an observation.

The sound comparison is a CONTROL/TREATMENT PAIR: sample the same station twice, once with the
authored offset and once without, and require the DELTA between the two skinned centres to equal
the authored offset. The body-origin bias is identical in both samples and subtracts out exactly,
so no fudge term is needed and nothing is re-derived from the code under test. That needs a way to
override the authored offset at capture time — a URL parameter or a fixture switch — which is the
next slice, and it is small.

Until then `unknown` with the reason recorded is the honest verdict, and it is what the brief's own
outcome vocabulary is for: "unknown means no adequate observation yet", and it does not permit
promotion.

### Step 2 now has a REAL verdict, and it is `unsatisfied`

The control/treatment pair is implemented: `openclinxrSuppressAuthoredPlantOffset=1` makes
`authoredPlantOffsetMeters` return undefined at capture time, so the same station can be sampled
with the offset and without it. The body-origin bias in the skinned centre is identical in both
samples and subtracts out exactly, so the delta between them is the authored offset and nothing
else — no fitted term, and nothing re-derived from the code under test.

The tolerance is 0.02 m, taken from the UNAUTHORED control's own measured frame-to-frame drift
(0.0011–0.0081 m across four runs, worst case 0.0081), rounded up. It is ambient movement of a
figure the frame loop rewrites every frame, measured before this comparison existed.

**Run 5:**

    clinic_knee_pain_return_to_play_v1  unsatisfied  patient_jordan_cole_v1  posture=seated
      measured delta {x: -0.0080, z: -0.0035} vs authored {x: 0.4, z: 0}
      err x = 0.4080, z = 0.0035, tolerance 0.02
    ed_chest_pain_priority_v2           satisfied    patient_robert_hayes_v1 posture=supine
      unauthored control held, 0.0052 m drift across 30 further frames

**The offset does not move the figure at all.** −0.008 m is drift, not displacement: suppressing a
0.4 m authored offset changes the humanoid's world position by nothing measurable.

This is the answer step 2 asks for, and it is the first time the question has been answerable. It
is worth being precise about what changed: the earlier `unknown` verdicts were not this result.
They meant the instrument could not tell, and telling required the control pass.

### The next link, and the evidence that names it

The composition is reached — posture is seated and `supportedActorPlacementPosition` runs — so the
break is downstream of it. The strongest candidate is already documented in this repo, by the
transform card: `runtime-actor-placements.ts:102-114` REWRITES `position` from
`SLOT_PLACEMENT_ANCHORS` when `slotKind` differs. That card made the rewrite REPORT itself
(`rewrittenActorIds`) and deliberately kept the behaviour, because suppressing it reintroduces
#136.

So the composed position is very likely computed correctly and then overwritten by slot repair. The
next measurement is cheap and decisive: read `rewrittenActorIds` off the published actor-placement
evidence during the same capture and check whether the clinic patient is in it. That is a
prediction, not a finding, and it is recorded as one.

### Which node was measured, and the prediction that was wrong

The instrument now records the sampled node and its ancestors, because "which node am I measuring"
is unanswerable from a bare transform and run 5 produced a transform that matched nothing.

    node: openclinxr.ed-chest-pain.patient-robert-hayes -> openclinxr.ed-chest-pain.station-root
    slot: {x: -0.9, y: 0, z: 0.08}   — IDENTICAL in the authored and suppressed passes

That is the right node: `actor-staging.ts:103` names it, `:104` sets its position from the runtime
placement, and `:122-123` stamps its posture and actor id. It is a direct child of the station
root, so its world transform is its local one.

**The slot-repair prediction was WRONG.** `SLOT_PLACEMENT_ANCHORS.primary_patient` is
`{x: -0.72, y: 1.06, z: -0.12}` and the measured slot is `{x: -0.9, y: 0, z: 0.08}`, so the
re-anchor at `runtime-actor-placements.ts:102-114` did not touch this actor. Recorded as wrong
rather than quietly dropped: it was published as a prediction one commit earlier.

**What the measurement says instead.** x = -0.9 is the manifest's raw position. Had the seated
branch run, the position would be the seated anchor -0.4 (with no authored offset) or 0.0 (with
it). Neither appears, so `supportedActorPlacementPosition` took its STANDING pass-through, even
though the same placement object's posture reads `seated` — that is what stamps
`userData.openClinXrActorPosture`, and the instrument sampled `posture=seated`.

So one object carries a seated posture and a standing-derived position. Checked directly and NOT
the explanation: `resolveActorPosture({declared: "seated", …})` returns `seated` for every
environment tried, and `supportedActorPlacementPosition({posture: "seated", …})` returns
`{x: 0, y: 0, z: -0.2}` — anchor -0.4 plus the authored 0.4. Both halves behave correctly in
isolation.

**The next probe, and it is cheap:** read the composed placement in the page rather than inferring
it from a transform — the runtime already publishes actor-placement evidence, so the same capture
can report what `runtimeActorPlacement` actually returned for this actor. That distinguishes "the
composition was never called" from "it was called and its result was overwritten", which is the
one question the current evidence cannot settle.

### Step 2 is MET, and the last link was an ORDERING

The in-page probe settled the question the transforms could not. `actor-staging.ts` now stamps the
resolved placement on the actor, so the instrument reads what the runtime COMPUTED instead of
inferring it:

    authored pass   resolved {x:  0.0, z: -0.2}  posture seated    (anchor -0.4 + authored 0.4)
    control pass    resolved {x: -0.4, z: -0.2}  posture seated    (anchor, offset suppressed)

The composition was correct all along and differed by exactly the authored 0.4 m — while both
passes sampled the humanoid at x -0.9. So it was computed, applied, and then discarded.

**The discard was `encounter-actor-framing.ts:178`**, which sets `actor.position.set(-0.9, 0, 0.08)`
for any patient — the measured value exactly. The seated/supine guard at `:140` should have
returned before reaching it, and it reads `userData.openClinXrActorPosture`. That stamp happened
SEVEN LINES AFTER `applyActorFraming` was called, so the guard read `""` on every run and fell
through to the floor-standing frames.

The guard's own comment recorded the hazard — *"the posture is stamped AFTER framing runs
(actor-staging.ts:115 against :122), so an empty string reaches here routinely"* — and the runtime
card's spec named it as a required change. It never landed. The fix is moving one line above one
call.

**Run 8, on the loaded humanoid:**

    clinic_knee_pain_return_to_play_v1  SATISFIED  measured delta {x: 0.3967, z: -0.0015}
                                                   vs authored {x: 0.4, z: 0}
                                                   err x 0.0033, z 0.0015, tolerance 0.02
                                                   slot now {x: 0, y: 0, z: -0.2}
    ed_chest_pain_priority_v2           SATISFIED  unauthored control retains defaults, 0.0046 m drift

The authored offset reaches the posed, skinned humanoid after framing, pose application and 30
further frames. That is what §7 step 2 asks for.

**What this does not claim.** Nothing about clinical correctness of the position, Quest
performance, motion quality, or any station beyond these two — the artifact carries those in
`notEvidenceFor`. Steps 3, 4 and 6 have not started, and step 5 remains partial.

### Step 3's first requirement: the physician is reported, not substituted

The brief is specific: *"Verify that fixed slot assignment stages the intended physician ID; if
omitted, report that outcome rather than substituting another clinical actor."*

Measured across the shipped scenario bank: exactly one case casts a physician.

    ward_delirium_med_rec_v1
      cast    patient=patient_margaret_ellis_v1, family=daughter_lena_ellis_v1,
              physician=senior_resident_ward_v1, nurse=ward_nurse_patel_v1
      staged  patient, nurse, family_member   — the physician is dropped

Four cast, three staged. The clinical slot takes the nurse and the physician disappears with no
record, so a learner meets a ward nurse where the case wrote a senior resident. The omission is a
known limit — the local bundle has three humanoid slots — but the SILENCE is not, and silence is
the half the brief names.

`unstagedCastActors` now returns every cast actor the bundle does not stage, with its role and a
reason, and `every-cast-actor-is-staged-or-reported.test.ts` consumes it: clause (1) requires every
shipped cast actor to be staged or named, clause (2) pins the ward physician specifically, and
clause (3) is the counterweight — the fully-staged ED cast must report NOTHING, so the report
cannot degenerate into a constant that names actors everywhere and means nothing.

This does not stage the physician. A fourth humanoid slot is its own slice, and claiming otherwise
would be the overclaim the brief's own acceptance language guards against.

### The physician is staged, in a slot that existed all along

Reporting the omission was the first half; this is the second. `RUNTIME_SLOT_KINDS` has always
listed `additional_cast` and `actor-staging.ts:267` has always read it — the bundle simply never
supplied a fourth actor, so a cast of four lost one.

    ward_delirium_med_rec_v1
      before   patient, nurse, family_member                    physician dropped
      after    patient, nurse, family_member, PHYSICIAN         nurse keeps her slot
    ed_chest_pain_priority_v2
      before   patient, nurse, family_member                    unchanged
      after    patient, nurse, family_member                    unchanged

Physician-first is the selection rule, not a tiebreak: the clinical slot takes `nurse` by role
order, so without it the physician is precisely the actor that gets dropped. Any other leftover
cast actor fills the slot when no physician is cast, and the slot stays empty when the cast has
only three.

The actor is staged **as a physician** — `role: "physician"`, added to the published role union
beside `consultant` and `interpreter`. Relabelling it `other` would satisfy a presence check while
losing the thing step 3 is about. The test asserts the role and asserts the nurse is still staged,
because "the physician appears" is also satisfiable by displacing her.

`unstagedCastActors` now returns `[]` for that case, and its counterweight still holds: a report
that named actors everywhere would pass the presence clauses and mean nothing.

Shrink-only budgets forced a third split of `runtime-bundles.ts` — `bundle-actors.ts` takes the
actor list, which is the "shape" half of the builder/validate/shape separation that file's freeze
note asks for. It stands at 1,622 lines against a 1,638 ceiling, down from 1,720 at the start of
this effort.

### The bedside target, the heading, and the field that was inert for three cards

Step 3 asks the physician to stand "at a case-specified bedside target oriented toward the
patient, with the proposed persistent heading consumed".

`bedsideTargetForClinician` computes the standing position from the PATIENT'S OWN position and the
yaw that faces her. Every other heading in this scene is a hardcoded literal — `-0.26` appears at
`actor-staging.ts:210,216` and `encounter-actor-framing.ts:137` for three different actors in three
different rooms — and a constant cannot face a patient the case moved.

    senior_resident_ward_v1  additional_cast
      position {x: -0.15, y: 0.95, z: -0.1}     0.75 m to the patient's right
      headingRadians -1.5707963                 facing her

**The heading is checked by ROTATING THE FORWARD VECTOR**, not by asserting the radian value the
same `atan2` produced. A test that recomputes the number it is checking passes under any
convention, including one that faces the clinician at the wall. Clause (2) is the counterweight:
the two approach sides must produce OPPOSITE headings, which a hardcoded yaw cannot do.

**And `headingRadians` was consumed by nothing.** It has been on the placement type since the
heading card, was populated by the factory card, and no runtime code ever read it — authored,
threaded, and inert across three landed cards. `actor-staging.ts` now applies it, AFTER framing,
because framing writes its own yaw for several branches: an authored heading is a decision about
where an actor looks, a framing default is what happens when nobody decided, and the decision
wins. An actor with no authored heading keeps the framing default untouched.

**What is still missing from step 3**, stated because a partial step read as a whole one is how
this effort went wrong at the start: equipment and body clearance, the unobstructed approach zone,
monitor visibility, and the composed-body-direction check during idle and speech. The patient
anchor inside `bedsideClinicianPlacement` is also still a constant — a case that moves its patient
does not yet move the clinician with her.

### Clearance, the approach corridor, and an assumption of mine the test caught

`bedsideClearanceViolations` reports body-clearance and approach-corridor violations against AABBs
the caller measured off mounted objects. It does not measure them, does not solve, and does not
move anybody. Monitor visibility is deliberately NOT in it: a line-of-sight check needs the
monitor's mounted pose and a head height, and inventing either is the fabrication the brief's
acceptance language guards against.

Thresholds carry their provenance: the 0.3 m standing footprint radius is half a ~0.6 m adult
shoulder breadth, an external anatomical floor rather than a number fitted to make this station
pass; the 0.35 m corridor half-width is that body plus a margin.

**Clause (5) caught a defect in my own bedside target.** It asserts that standing beside the
patient must not report her own support as an obstacle — a check that fired there would be
discarded rather than believed. It failed, and the cause was an assumption I had written into
`bedside-target.ts` and never measured: *"every shipped station lays the patient along Z"*.

Measured instead: `xr-station-room/src/index.ts:325` builds the deck as
`BoxGeometry(2.35, 0.24, 0.92)` at `(-0.42, 0.42, -0.08)`. The patient lies along **X**, so my
0.75 m offset along X put the clinician inside the deck at her head. The standoff is now taken
from the support's measured EDGE along its SHORT plan axis, and the physician stands at
`z = 1.13` against a deck edge of `0.38`.

    senior_resident_ward_v1  additional_cast
      position {x: -0.9, y: 0.95, z: 1.13}   0.75 m clear of the deck edge
      headingRadians 3.1415927                facing the patient

The controls are the shipped station's own geometry, not fixtures invented for the test: the deck
is imported as `ED_STRETCHER_DECK_BOUNDS`, derived from those constructor arguments. The
known-bad cases are the good one moved — an obstacle on the target, and one across the route —
and clause (4) is the counterweight: with no approach origin, no corridor violation may be
invented.

### Monitor visibility, and what a cheap adversarial review was worth

`monitorVisibilityFrom` reports two distinct failures, and a check with only the first is the one
worth being careful about:

1. **Occluded** — something stands between the eye and the screen.
2. **Behind the screen** — nothing occludes the segment and the screen is invisible anyway. A pure
   occlusion check calls this VISIBLE, which is how "monitor visibility" becomes a green box.

The screen normal is taken from the box's thinnest axis, signed toward the room centre: the shipped
monitor is `BoxGeometry(0.8, 0.55, 0.08)` at `(1.7, 1.45, -0.65)`, so it is thin along Z and faces
+Z. A normal taken from the widest axis would point at the ceiling and the wrong-side clause would
pass for the wrong reason, so clause (4) pins it.

Eye height is 1.55 m — between the commonly cited ~1.51 m female and ~1.63 m male adult standing
figures, an external anthropometric floor. One ray to the screen's CENTRE is a lower bound on
visibility: a screen half-blocked by a pole reports visible because its centre is clear. Stated in
the module rather than implied.

**A `muse-spark-1` review found a real defect.** Asked to name ways `bedsideClearanceViolations`
could return no violations when a clinician would in fact be blocked, it returned four critiques in
one call. The actionable one: an XZ-only footprint ignores height in both directions, so a
ceiling-mounted light at y 2.4 reports a body-clearance violation it has no business reporting —
and that class of false positive is how a check stops being believed. Both checks are now gated on
overlap with the standing body's height band (1.8 m, an anthropometric floor), and clause (5) is
the regression net.

Its other three — an omitted `approachFrom` silently skipping the corridor check, a zero-length
approach doing the same, and a sub-margin gap that clears a static footprint but not a turning
shoulder — are recorded, unfixed, and real.

### The sway composed, and step 3's last clause

`main.ts:3484-3485` wrote `actor.rotation.y = Math.sin(now / 900) * 0.12`. That ASSIGNS: a heading
consumed at staging is destroyed on the first frame, so a clinician placed facing the patient faces
wherever the sine happens to be. It is the same defect the transform card fixed for position, one
axis over, and it survived because nothing ever measured a heading after a frame.

Both actors now compose onto a persistent base stamped at staging
(`userData.openClinXrBaseHeadingRadians`, recorded after everything that writes rotation.y there),
and the amplitude is CLAMPED to the allowance rather than trusted — an amplitude beyond it is a
caller error, and obeying it silently would let a future edit turn an actor away from the patient
one frame at a time.

The allowance is 0.2 rad, ~11.5 degrees, derived from the shipped sway amplitudes rather than
invented: the two in the frame loop are 0.08 and 0.12, and the allowance is their sum, so both
compose within it and a third exceeding them both would not.

**Clause (2) is the counterweight and it is the old code**: the assigning form must FAIL the same
check. Without it, clause (1) proves nothing — a check that passes for both the fix and the defect
is measuring neither. Clause (4) pins the wrap: a base just below +pi and an observed heading just
above -pi are 0.02 rad apart, not 6.26, and without wrapping every correct scene across that seam
reports a 359-degree deviation.

**Step 3 is met.** What is not claimed: none of these checks is measured on a loaded humanoid the
way step 2 is — they are pure functions over measured geometry, and wiring them into the live
capture is the obvious next slice. Clinical correctness of any position stays a clinician's call,
which the brief says explicitly and no test here changes.

### Step 4's bounded path, and a review whose first two claims were wrong

`planBedsideApproach` walks a straight polyline from an entry point to the proven bedside target,
sampling every 0.35 m, and reports collisions along the WHOLE route rather than at its endpoints.
Clause (2) is that distinction: a cart mid-route is caught while both endpoints are clear, which is
the case an endpoint-only check passes.

It does not route around anything. A blocked route is REPORTED and the walk stops; returning a
detour would be inventing a path nobody validated, and clause (3) pins every waypoint to the
straight line so a future "helpful" detour fails.

**Three of step 4's clauses are NOT delivered, and the module says so at the top**: no executor
(nothing plays a clip or drives a skeleton), no foot-sliding measurement (it needs a played clip
and foot-contact sampling across frames and cannot come from a polyline), and the patient is
untouched, which step 4 requires until posture-safe animation is separately demonstrated. Clause
(5) asserts the returned plan carries no clip id, duration or foot contacts, so nothing in it can
be mistaken for those measurements.

**The review that followed got two of four wrong, and checking was the point.**

| claim | verdict |
|---|---|
| "point probe, no body radius" | **FALSE.** The probe is a 0.3 m circle (`bedside-clearance.ts:111`), not a point. |
| "tunneling between 0.35 m samples" | **FALSE.** Max distance from a sample is 0.175 m against a 0.3 m radius, and clause (4) exercises a 0.05 m pole at exactly that midpoint. It passes. |
| "height flattened — waypoint y forced to target.y" | **TRUE, and a real defect.** |
| "arrival is position-only" | partly true; the final waypoint IS collision-checked, and "feet cannot fit" is beyond this slice. |

The true one mattered. `overlapsStandingHeight` took the body band from the PROBE POINT'S y, and a
runtime placement carries y 0.95 (the actor slot's own offset), so the band became 0.95-2.75 m: a
0.45 m stool underfoot vanished and a ceiling fixture came back. The band is now measured from an
explicit floor defaulting to 0, and clause (6) checks both directions at once.

Two of four is a useful hit rate for one cheap call, and the two misses cost a grep each. That is
the arithmetic that makes the review worth running — not that the reviewer is right.

### Step 6 closes on a measured contradiction, and on nearly the wrong record

The brief flagged one thing as unverified about `Kimodo-SOMA-RP-v1.1`: *"its README describes
`somaskel77` while the model card describes 30-joint outputs; their exact relationship remains
unverified."* It is now verified, and it is a contradiction.

| surface | states | licence |
|---|---|---|
| `nv-tlabs/kimodo` README | "Model inputs/outputs now use the SOMA **77-joint** skeleton (`somaskel77`)", marked Breaking | Apache-2.0 |
| `nvidia/Kimodo-SOMA-RP-v1.1` model card | Joint Rotations `num_frames x **30** x 3 x 3` | NVIDIA Open Model License, commercial use ready |

That is disqualifying rather than a detail, because the brief requires the MPFB mapping to be
pinned and a retargeting map is a per-joint correspondence. A map cannot be written against an
output that is 30 or 77 joints depending on which document you believe, and one written against the
wrong count produces a skeleton that loads, plays, and is anatomically wrong — the failure class
this repo already paid for with head-down humanoids that passed every mechanical gate.

**A near-miss worth recording.** `kimodo-cpp-cagematch-2026-08-23.md` already carries a
`reject_measured` verdict for "kimodo", and reusing it would have closed step 6 in one grep. It is
a DIFFERENT artifact: that record examines `localai-org/kimodo.cpp`, an unlicensed community C++
port, while the brief names NVIDIA's own repository and weights, which carry Apache-2.0 and the
NVIDIA Open Model License respectively. Same name, ready verdict, wrong subject.

The refusal is on manifest ambiguity, NOT licence — the licence position is materially better than
the port's. It is fixable upstream, and the record names the three things that would reopen it in
the order they would have to be settled.

### Step 5's variation and refusal halves

`resolveBedsideLayout` derives its seed from case, asset revision, solver version and a
non-negative variation index — the PRINCIPLE of the motion seed contract with a layout identity, as
the brief asks, and not an import of it: asset-registry does not depend on motion-compiler, and one
seed spanning two identity sets would make one of them wrong.

The refusals are the contract, not polish. `Math.random()` in the index and `new Date().toISOString()`
in the solver version both throw, because a derivation that accepts whatever it is handed makes
"deterministic" a claim about inputs nobody passes. That reasoning is the motion contract's and is
repeated rather than cross-referenced, because the refusal IS the contract.

**Clause (3) is the counterweight to reproducibility.** A resolver that always returns the same
answer is perfectly reproducible and useless, so eight indices must produce BOTH approach sides.
Clause (1) alone is satisfied by a constant.

**Clause (4) is the impossible layout.** Walls on both sides, and the resolver refuses with all six
candidates named and a reason each, rather than downgrading to a position that violates something.
The seed is still recorded on the refusal: a run that produced nothing stays identifiable. Clause
(6) checks the ordering the brief demands — hard constraints before ranking, so a blocked nearest
standoff yields a farther one rather than the blocked one.

**Two of step 5's clauses remain**: refusing a corrupted or removed artifact, and capturing actual
displayed motion rather than a `clipPlayed` flag. The second needs the executor step 4 does not
have.

### A corrupt artifact was indistinguishable from an absent one

`readSupineControlFreeze` returned `null` for a missing file AND for an unparseable one. Those are
different situations with the same shape, and `null` is exactly what a caller reads as "no freeze
recorded yet, carry on" — so a corrupted control silently became NO control, and the evidence
depending on it kept being trusted.

`requireSupineControlFreeze` distinguishes four outcomes, because a consumer should act differently
on each: `absent` means produce it, `malformed` and `wrong_schema` mean something damaged it and a
re-run cannot be assumed to fix it, and `ok` means use it.

**Clause (4) is the corruption that looks healthy**: right schema, parses cleanly, and an EMPTY
hash map — a freeze that validates every tree and is worth less than no freeze while reporting
success. Clause (5) is the counterweight in the other direction: a well-formed artifact still reads
`ok`, so the refusals are not simply refusing everything.

**The artifact is corrupted for real**, written to its actual path and restored afterwards, not
simulated by handing a bad object to the parser. A test that feeds a hand-made object to a
validator proves the validator works; it does not prove the consumer reads the artifact through it,
which is the half that fails in practice.

**And the first draft of that test proved the point against itself.** It guessed the artifact path
as `.openclinxr/evidence/supine-control-freeze/supine-control-freeze.json`; the consumer actually
reads `.openclinxr/evidence/supine-control-freeze.json`. Every clause corrupted a file nothing reads
and returned `ok` — a test passing while measuring an unrelated file on disk. The path now comes
from the module's own constant.

### Step 0's consumer, and a redundancy the typechecker exposed

`buildInitialSceneSpec` reported and nothing read it — correct and inert, this repo's
characteristic defect. `initialSceneSpecPermitsPromotion` is the read: only `satisfied` promotes,
`pending` and `unknown` are refusals rather than soft passes, and every blocker travels with its
consumer and observed evidence so a refusal does not send the reader hunting for what was waiting
on what.

**It deliberately does not gate a phase.** Step 0's own out-of-scope forbids "creating a
scene-readiness phase, changing the phase machine". A promotion decision nobody can read is the
defect being fixed; a phase gate nobody asked for would be a different one.

`requiredAssetCount` is returned so a caller can tell "everything required is satisfied" from
"nothing was required". Those are different claims and only one is evidence — clause (4) pins the
empty spec as promoting VACUOUSLY rather than special-casing it away.

**tsgo exposed a redundancy while I was writing the test.** Each required-asset row carries BOTH
`satisfied: boolean` and `outcome`, two representations of one fact that can disagree. The brief's
vocabulary is the four outcomes, so the outcome is authoritative — and clause (5) now constructs
the disagreement directly, a row marked `satisfied: true` with `outcome: "pending"`, and requires
the gate to refuse it. A gate reading the boolean would promote it.

That is the "one contract, not two declarations" failure caught before it could bite: the type
should carry one of the two, and until it does, a test pins which one wins.

### The executor, and a measurement that reports its own failure

`stepBedsideApproach` advances a root along the validated polyline at a walking speed and stops at
the goal. It is a GOAL executor, not a clip executor, and the difference is the honest part: this
project ships no locomotion clip — the only approved motion source is Mesh2Motion's seated/talking
BVH — so there is no clip to play.

It **refuses** a plan carrying path violations. Driving an actor along a route that collides would
make step 4's collision measurement decorative, so a route that was never proven clear is not
walked.

**The foot-sliding measurement grades this executor and the verdict is bad:**

    path length 3.660 m | foot slide 3.660 m | contact frames 41 | worst frame 0.110 m

The feet ride the root exactly, because nothing drives the legs. That is recorded as the true state
of the runtime rather than dressed up: the brief refuses a `clipPlayed` flag as evidence, and a
measurement that reports 100% sliding is strictly more useful than a green boolean. The same metric
grades a real clip without changing, and the number drops when one exists.

Two details make the metric legible rather than merely numeric. Slide is SUMMED, not averaged —
averaging hides a pop inside a long clean stretch, and a pop is what a viewer sees, so the worst
single frame is reported beside the total. And `contactFrames` travels with the result, because a
foot that never touches the floor reports zero slide: that is the metric saying it observed
nothing, and it must not look like a pass. Clause (6) pins that distinction.

**What step 4 still lacks** is not a measurement but the thing being measured: a validated
locomotion clip driving the legs. Every clause of step 4 now has an implementation and a number;
one of those numbers says the current implementation is wrong, which is what a measurement is for.

### Does a clip fix the sliding? Measured, not assumed

The root-driven executor slides its feet 100% of the distance travelled. The question blocking step
4 was whether the walk BVH already on disk would fix that. It is answered by measuring the clip
rather than by adopting it and hoping.

Minimal forward kinematics — offsets, ZYX Euler, root translation — over
`cmu_02_01_walk.bvh`. Root travel 59.56 units across 344 frames. Planted-toe slide as a fraction of
that travel:

| contact height | left toe | right toe |
|---|---|---|
| 0.4 | 0.4% (32 frames) | 9.1% (15) |
| 0.6 | 1.4% (70) | 10.1% (41) |
| 0.8 | 2.1% (80) | 11.5% (91) |
| 1.0 | 4.2% (149) | 19.4% (145) |
| 1.2 | 15.3% (230) | 28.3% (188) |

**0.4–11.5% at tight thresholds, against 100% for the root-driven executor.** A sweep rather than
one threshold, because the answer is threshold-sensitive and picking the single value that flatters
the clip would be fitting a number to a conclusion. The rise at 1.0 and above is swing frames being
counted as contact, which is the expected artefact and is why the tight rows carry the claim.

**Two findings that came out of measuring rather than assuming.**

The ANKLE is not the contact point. `LeftFoot` in a CMU rig is the ankle: median height 1.79 units,
only 27 of 344 frames below 1.0. Measured first, it reads as "the feet barely touch the floor" and
would have concluded the clip does not plant at all. `LeftToeBase` reaches -0.55.

The clip is ASYMMETRIC — the right toe slides several times the left at every threshold in the
sweep, so it is a property of the clip, not of the threshold. Recorded because adopting this clip
means adopting that asymmetry, and a reader comparing a future clip needs the number rather than
"it looked fine".

Licence: CMU Graphics Lab mocap is CONDITIONAL, not CC0 — free for research and commercial products,
the data not resellable even converted — and the ledger records it as already used once for a walk
BVH. Usable; the ledger's preference for a CC0 source where one exists is not overridden by this
measurement.

## The initial scene planner's binding step, and why a substring match would have been wrong

§3 step 2, verbatim: *"Case `equipment` currently contains descriptive strings while `assetNeeds`
carries asset IDs; define an explicit reviewed binding and precedence, rather than assuming the
strings are catalogue keys."*

Measured on `ed_chest_pain_priority_v2`:

    authored:  "12-lead ECG machine" · "bedside monitor" · "stretcher" · "IV pole"
               · "oxygen nasal cannula" · "wall clock"
    catalogue: ecg_cart_equipment · bedside_monitor_equipment · stretcher_equipment
               · ed_stretcher_bed_equipment · iv_pole_equipment
               · oxygen_nasal_cannula_equipment · wall_clock_equipment

Two of the six phrases do not resemble their catalogue id at all, and **"stretcher" names two ids**.
A substring matcher binds five of six and silently picks a stretcher, which is the behaviour the
brief forbids in the same sentence it asks for the binding. `bindInitialSceneContents` has no fuzzy
matching: a phrase binds through an explicit reviewed alias or not at all.

**Precedence, stated once:** an `assetNeeds` entry naming a catalogue id outranks a reviewed alias,
because the case author naming the id is a stronger statement of intent than a reviewer's phrase
map. Clause (3) proves the ambiguity disappears when the case resolves it itself.

Five refusals, each from a sentence of the brief: an ambiguous phrase keeps BOTH candidates rather
than collapsing; a phrase with no reviewed alias is unbound and conflicts; an intentionally absent
item stays in the plan bound to nothing and never realized; a requirement with no source activity is
refused before the catalogue is consulted; and a case that both requires and deletes an item reports
that rather than choosing. Multiple copies get distinct realized identities through the existing
`realizedEquipmentPlacementId`, not one id used twice.

Clause (2) is the counterweight: the five unambiguous phrases must still bind, or a binder that
refuses everything would satisfy clause (1) and be useless.

It lives on the `./initial-scene-contents` subpath. asset-registry's root entrypoint ceiling is
shrink-only at 240, and an export added for one consumer's convenience is how a barrel grows.

## §3's authored-intent rules had three requirements with no implementation

The brief's "Authored intent versus resolved placement" is not §7, and three of its sentences were
unimplemented. Each failed silently.

| brief requirement | what happened before | now |
|---|---|---|
| "For standing, name a floor anchor; `none` is not itself a frame." | the standing branch returned the resolved position and DROPPED the offset | refused, naming the missing frame; the resolved position still stands |
| "malformed offsets ... block candidate acceptance/promotion" | `typeof value === "number"` admits NaN and Infinity | refused per axis, before the normal-offset rule so the reason is not misattributed |
| "do not multiply metre offsets by GLB scale again" | no scale term, but nothing said so | an exact-equality clause, so any factor introduced later fails |

The standing case is the one worth stating plainly: an author put a value in the case, saw no
movement in the runtime, and nothing anywhere said why. A silent drop is worse than a refusal
because it looks like the feature working.

Probed three ways: restoring the silent drop fails clause (1); admitting non-finite values fails
clause (3); a 1.05 factor on the x term fails clause (4). Clause (2) is the counterweight that
refusing EVERY standing actor would otherwise satisfy.

## The brief is larger than §7, and §6 named a correction nobody had made

§6, verbatim: *"its extension row says AGPL-3 while its split-license row says GPL-3.0-or-later.
Correct that record against the exact installed release."*

Measured against the installed extension, `Blender/5.1/extensions/user_default/mpfb`, version
**2.0.15**, `blender_manifest.toml` sha256 `b7e1d073…`:

    license = ["SPDX:GPL-3.0-or-later"]

That is the only licence MPFB declares for itself. Exactly three files in the installed tree contain
the string `AGPL` and none of them licenses MPFB: the MakeClothes and MakeSkin **author-selectable
output licence** dropdowns, whose own description says the choice *"will have no practical effect
apart from being included in the written MHCLO file"*, and the `.mhclo` writer that emits it.

**The wrong label had propagated into the shipped assets.** It reached the `licenseChain` of **all
eight** humanoid provenance records under `apps/ui-xr/public/generated-humanoids/` — eight shipped
assets each asserting their build tool is AGPL. Row 24, the retarget_bvh row's aside, MADR 0052's
aside, the regenerated ledger and all sixteen provenance files (public and dist) are corrected.

`the-mpfb-record-matches-the-installed-release.test.ts` gates the class rather than the row: clause
(2) walks every shipped provenance record, clause (3) refuses a fix by deletion (the split-licence
fact and the CC0 asset grant must survive), and clause (4) re-verifies the installed manifest digest
where the extension exists. The step is UNCONDITIONAL in pre-commit because the label arrived
through a generator, so no staged-path shape identifies the commits that can bring it back.

### Step 5 closed: the walk is DISPLAYED on the loaded, posed, skinned physician

    outcome  satisfied      ward_delirium_med_rec_v1      senior_resident_ward_v1

| joint | drive on, span over 60 frames | drive off (control) | ratio |
|---|---:|---:|---:|
| toe1-1.L | 1.089 m | 0.0385 m | 28x |
| toe1-1.R | 1.609 m | 0.0384 m | 42x |
| foot.L | 1.074 m | 0.0387 m | 28x |
| foot.R | 1.588 m | 0.0387 m | 41x |
| lowerleg01.L | 1.192 m | 0.0485 m | 25x |
| upperleg01.L | 1.322 m | 0.0576 m | 23x |
| skinned mesh centre | 6.669 m of path | — | — |

The brief refuses a `clipPlayed` flag by name. The flag IS present
(`playing: true, timeSeconds: 2.48, mode: retargeted_clip_drives_the_leg_chain`) and it decides
nothing: the outcome comes from measured joint displacement, and clause (1) of the test proves a
flag set with no motion reads `unsatisfied`.

**The control is not zero and that is the point.** A standing figure breathes and sways ~3.9 cm, so
the margin is five times the measured control rather than five times nothing.

**Three findings came out of getting this to run.**

**The client entry had a node builtin in it, and apps/ui-xr had stopped booting.** Every page load
died on `Module "node:crypto" has been externalized for browser compatibility` — no scene, no boot
evidence, no frames. `layout-variation.ts` (node:crypto, for the seed digest) was value-exported
from the asset-registry `"."` entry in `b32f4d19`, my own step-5 commit.
`the-client-entry-does-not-reach-node-builtins.test.ts` catches exactly this and **was red the whole
time, because nothing ran it** — and additionally red on two consumer paths that had moved, so a
manual run would have looked like noise. Fixed the same way #715 was: `./layout-variation` is a
node-only subpath. The gate is now step 5 of the pre-commit profile.

**The runtime spells bone names differently from the GLB.** three's GLTFLoader strips `.` from node
names, so the asset's `toe1-1.L` is `toe1-1L` in the scene. The first sampler matched the asset
spelling, found nothing, and reported a physician with no legs. Matching is now on the dot-stripped
name.

**A fixed sleep produced a false finding.** One run reported "no staged actor carries a locomotion
clip" while naming the physician in the staged cast — the humanoid arrived a few seconds after the
station shell resolved. The instrument now waits for the stamp itself, and a timeout there falls
through to the `unknown` branch rather than throwing.

**The ED station reports `unknown`, correctly.** `ed_chest_pain_priority_v2` casts patient, nurse
and spouse and no physician, so nothing there carries the clip. Across the bank,
`ward_delirium_med_rec_v1` is the only scenario whose cast fills the additional slot with a
physician. Substituting another clinical actor is what brief §7 step 3 forbids, so the report names
the staged cast and refuses.

### The locomotion drive now plays the clip, and it used to slide the root

`animation-loop.ts:187` wrote `slot.root.position.z = slot.baseZ + locomotion * 0.6` whenever the
drive asked for locomotion. That IS the ~100% foot slide the approach executor's own metric reports
on itself: nothing animates a leg, so every planted foot travels the whole distance. The runtime's
only locomotion was a translating root.

When an actor carries a retargeted take, the drive now plays it and the clip CLAIMS the leg chain
through `openClinXrOwnedBoneChains` — the seam that already exists so a motion executor can stop the
posture pass rewriting bones every frame. Without that claim `applyIdlePosture` overwrites the legs
each frame and the walk is invisible; probed, and clause (1) fails.

The clip name reaches the loop as SLOT DATA, not as a re-declared prefix.
`isDeliberateSelectionOnlyClip` decides it once in `clip-names.ts`, `xr-asset-loading` stamps
`locomotionClipName` on the slot, and `xr-humanoid-animation` reads it. Neither entrypoint gained an
export, so both shrink-only ceilings are untouched.

Clause (3) is the counterweight that matters: an actor with NO locomotion clip must still slide,
exactly as before. Every peds actor the drive moves today is in that state, and without the clause
this change would have frozen them while clauses (1) and (2) stayed green.

The drive scalar gates PLAYBACK, not speed. The clip's own ground speed is 1.115 m/s measured from
its root track, and rescaling it would put back the sliding this removes.

### An external review at $0.0022 found five real defects in the day's diff

`meta/muse-spark-1.3-contributor` on OpenRouter, the whole day's diff as one prompt, 17,954 prompt
tokens and 2,000 completion. Four of six findings were correct and acted on; the free
nemotron rungs were rate-limited out (`free-models-per-day-high-balance`, resets at the daily
boundary), so the paid rung did the work for a fifth of a cent.

| finding | verdict | what changed |
|---|---|---|
| clauses (4)-(7) read only the landed JSON, so deleting the instrument leaves them green | correct | clause (8) runs `measureBoundClipFootPlant` against a constructed rig with a planted toe and a riding toe |
| `durationSeconds = last.atMs / 1000` assumes the first key is at zero | correct | uses `last - first`; the fixture now starts at 0.5 s so the old form reads 80 fps and fails |
| the graft's `if (!sourceSampler) continue` is the silent drop its own header forbids | correct | a samplerless channel now refuses, like an unresolvable joint |
| the provenance `motionClips` block asserts a frame rate the pipeline never emits | correct | `graft-bound-clip --publish` writes the block from the foot-plant report, so the record cannot disagree with the bytes beside it |
| clause (6)'s 0.4 / 0.25 thresholds sit just under the observed 0.489 / 0.308 | correct in kind | rewritten against the clip's INPUT: root advance per frame is speed/fps = 0.0093 m, and the loose row's worst frame is 33x that |
| clause (2) passes vacuously if no mixer is created | not reachable — `animationClips.length > 0` still builds one | `expect(slot.mixer).toBeDefined()` added anyway; the assertion was weaker than it read |

The first run returned `content: null` after spending all 2,000 tokens on reasoning, which is the
documented Muse behaviour: reasoning cannot be disabled, so `effort: "minimal"` and a larger
`max_tokens` are required.

### Publishing the clip made a standing physician walk, and the fallback is why

`registerGeneratedHumanoidAnimation` plays EVERY glTF clip when no role clip name matches. None
matches this actor: the defaults are `openclinxr_clinical_idle_breathing` and
`openclinxr_conversation_listen_nod` (`clip-names.ts:50`), while the physician GLB carries
`ClinicalIdleConversation`, `ClinicalExpressionMicroTransition` and now the walk. So adding an asset
changed the behaviour of an actor nobody touched: a physician standing at the bedside would loop a
three-metre walk on top of an idle.

`isDeliberateSelectionOnlyClip` excludes the `openclinxr_retarget_` prefix from that fallback. The
prefix is what `motion_bind_stage.py` writes on every retargeted capture, so the exclusion covers
the next bind rather than this one clip. Probed: removing the guard fails all three clauses,
including the counterweight that the actor's own two clips keep playing.

The walk is now present and inert — a consumer must name it. That is the correct state for step 4,
where the approach executor is the thing that should select it.

### The physician can walk in the runtime, and the bind stage cannot be trusted to publish it

The bound GLB was measured against the shipped physician before anything was published, and the
comparison refused the publish:

| mesh | shipped | Blender re-export | delta |
|---|---:|---:|---:|
| eyebrows | 8,953 tris, area 6.44e-4 | 7,918, area 5.40e-4 | **-1,035 tris, -16% area** |
| eyelashes | 395 tris, area 2.62e-5 | 277, area 1.88e-5 | **-118 tris, -28% area** |
| body, garments, hair, shoes | unchanged | unchanged | 0 |

Neither loss is degenerate-face cleanup: both meshes report **zero** zero-area triangles before and
after, so real surface is gone. Publishing the re-export would have shipped a physician that lost
its eyebrows to gain a walk, and every mechanical gate would have stayed green.

**The clip does not need the round trip.** It is animation data addressed to joints that already
exist in the shipped file. Verified before building anything: the bound rig's **137 animated joints
are all present** in the shipped rig, **parent chains are identical**, and every channel carries
absolute local TRS, so a joint's rest transform cannot change the result. Only two rest transforms
differ at all (`breast.L/R`, 0.085 m) and both are animated, so their rest values are overridden.

`tools/openclinxr/factory/graft-bound-clip.ts` copies the clip by joint NAME and refuses rather than
dropping a channel it cannot place. Result: 411 channels onto 137 joints, **41,718 triangles before
and after**, POSITION bytes identical, and the foot-plant instrument reproduces the bound
measurement exactly on the grafted asset (2.55% / 8.11% toe slide, 54 / 32 contact frames, root
travel 3.1971 m). `mpfb-clinical-physician-adult.glb` is now published with the walk clip.

### Eight of thirteen shipped humanoids named a sha256 nobody checked

Found while updating the physician's provenance. `outputSha256` and `outputBytes` are recorded in
every `*.provenance.json`, and **eight of the thirteen** that declare them do not match the asset at
their own `assetPath` — the physician's claimed 21,798,768 bytes against a file of 11,207,936. A
provenance chain that cannot say which bytes it describes documents nothing, and nothing was
checking.

`apps/ui-xr/src/the-shipped-humanoids-hash-to-their-provenance.test.ts` freezes those eight BY NAME
as debt and fails on any new mismatch. It also fails when a frozen record starts matching, so paying
one down forces its removal rather than leaving a stale entry that hides the next regression. The
eight were NOT repaired by rewriting their hashes to whatever is on disk: that would assert the
current bytes are the intended ones, which nobody has verified, and would erase the finding.

### Step 4's foot slide, measured on the rig that would ship — and the clip was playing five times too slowly

The two foot-slide numbers on record were about the wrong things: the root-driven executor's ~100%
(no legs animated) and the CMU BVH's toes in the SOURCE skeleton. Retargeting is where a plant is
normally lost, so the measurement that decides step 4 is on the retargeted MPFB armature.

`tools/openclinxr/evidence/foot-plant/bound-clip-foot-track.ts` walks the glTF node hierarchy and
composes TRS per frame, so no renderer is involved. `footSlideMeters` is IMPORTED from
`approach-executor.ts`, not reimplemented, which is what that module claimed would happen once a clip
existed.

| joint | contact 0.06 m (runtime) | contact 0.10 m | contact 0.15 m |
|---|---|---|---|
| toe1-1.L | **2.6%** of root travel, 54 frames | 48.9%, 197 frames | 76.8% |
| toe1-1.R | **8.1%**, 32 frames | 56.4%, 165 frames | 110.7% |
| foot.L (ankle) | 0%, **0 frames** | 11.5%, 30 frames | 37.8% |
| foot.R (ankle) | 0%, **0 frames** | 1.3%, 18 frames | 39.0% |
| root-driven executor | **100.0%** | — | — |

The toes plant. The ankles never reach the runtime's contact height, which is the same finding the
BVH measurement made in the source skeleton and it survived the retarget: the contact point is the
toe.

**Contact height decides the answer, which is why the report carries a sweep.** At 0.10 m the same
toe measures 48.9% and its worst single frame is 0.308 m. At 120 fps that is 37 m/s for one frame,
so the loose threshold is counting a swing frame as a plant rather than finding a slip.

**And the bind was exporting at the wrong frame rate.** retarget_bvh runs Blender's BVH importer
with `use_fps_scale` off, laying down one key per SCENE frame and never reading the file's
`Frame Time`. The scene sat at Blender's default 24 fps while `cmu_02_01_walk.bvh` declares
`.0083333` (120 fps), so a 2.87 s walk exported as 14.33 s and the rig's ground speed read
**0.223 m/s instead of 1.115**.

That number matters because the executor advances a root at `CLINICIAN_WALK_SPEED_MPS = 1.1`. A clip
five times too slow drags its feet four fifths of the distance however well it plants, so the plant
measurement above would have been true and useless. `_apply_source_frame_rate()` now sets the scene
rate from the clip's own `Frame Time` before the retarget imports it, and the re-bake measures
1.115 m/s — within 1.4% of the executor's constant, which is a coincidence worth recording rather
than a threshold anyone fitted.

Geometry did not move: every slide fraction is identical before and after, because only the time
axis changed. That is the control on the fix.

**The GLB is 11.6 MB under `.openclinxr/` and has no land path**, so the deliverable is
`docs/openclinxr/evidence/bound-clip-foot-plant.json`, which carries the GLB's sha256 and byte
length. A rebake that changes the bytes without re-running the instrument leaves a report naming a
file nobody has, which is visible rather than silent.

**What step 4 still lacks:** playing the bound clip through the executor in the LIVE runtime and
re-measuring on the loaded humanoid. Everything above is measured off the asset, not off the
displayed scene, and the report says so in `notEvidenceFor`.

### The walk is BOUND, the legs are driven, and the clip was lying about its own name

The bind ran on the proven path — `blender --background motion_bind_stage.py`, one MPFB actor plus
one BVH, `mcp.load_and_retarget` through the `retarget_bvh` addon. It was not a new pipeline; the
only reason it had not happened is that nobody had run it with a walk clip.

    verdict ok | 26 bones driven | 345 keyframes each | 11.6 MB GLB

**All eight leg-chain bones are driven**, which is precisely what the root-driven executor lacks:

    upperleg01.L 0.779 rad   upperleg01.R 0.790 rad
    lowerleg01.L 0.745       lowerleg01.R 0.744
    foot.L       0.591       foot.R       0.679
    toe1-1.L     0.515       toe1-1.R     0.628

**And the bind exposed a provenance defect.** `CLIP_NAME` was the CONSTANT
`openclinxr_retarget_cmu_07_01_walk` regardless of `--clip`, so binding `cmu_02_01_walk.bvh`
produced a GLB whose clip asserted it was `07_01`. That has teeth: the capture selector matches on
this NAME (`candidate-capture.ts:757`), so every bound clip was selected as if it were the one clip
anyone had verified. The name now derives from the source file's stem, and the re-run produces
`openclinxr_retarget_cmu_02_01_walk`.

That defect was invisible to every test in the tree because nothing had ever bound a SECOND clip —
a constant is indistinguishable from a correct derivation until the input changes.

**Where this leaves step 4.** The clip is bound to a shipped rig with its legs driven, and the
clip's own toe-slide is 0.4-11.5% of root travel against the root-driven executor's 100%. What is
not yet done is playing that bound clip through the executor in the live runtime and re-measuring
on the loaded humanoid — the step-2-style measurement, which needs the capture harness rather than
another pure function.

### The evidence tools' page-global alias does not exist at runtime

Building the instrument surfaced a defect in the tooling the brief cites. `browser-dom.d.ts`
(landed 2026-09-04) declares `browserPageWindow` so tsgo stops complaining about page globals,
and its own header says *"Runtime behavior is unchanged — types only"*. Nothing defines it in a
page.

Measured 2026-09-09 against a real chromium page, both forms used in this tree:

| form | result |
|---|---|
| evaluate string, `const win = browserPageWindow` | `ReferenceError: browserPageWindow is not defined` |
| typed `page.waitForFunction(() => browserPageWindow…)` | the same ReferenceError |
| `typeof browserPageWindow` | `"undefined"`, no throw — which is why a typeof guard hides it |

The identifier appears in **59 files** under `tools/openclinxr/evidence/`. It is confirmed inside
page callbacks in `inpatient-supine-staging.ts:373` — the instrument the brief cites as [R26] —
and `declared-equipment-mounted.ts:448,481,552`. **The other 56 are not audited**, and no claim
is made about them here.

A typechecker made the wrong thing compile: the alias satisfies tsgo and silently makes the
callback unrunnable, so a tool hangs on its wait or returns its empty-default branch instead of
failing loudly. `globalThis` is the fix in new code — it typechecks in node and IS the window in
the page. For existing callbacks, one line makes them run without editing them:
`await page.addInitScript("globalThis.browserPageWindow = globalThis; globalThis.browserPageDocument = globalThis.document;")`.
This instrument does that on its own page rather than editing 59 files.

**Any evidence artifact under `.openclinxr/evidence/` that predates 2026-09-04 was produced
before the alias existed. Artifacts dated after it, from a tool that uses it, deserve a re-run
before they are trusted.**

**It is deliberately not wired into a gate.** A gate over a measurement nobody has read is how a
green suite starts meaning nothing, which is the failure this whole effort was called to correct.

## 3. Acceptance that cannot pass about nothing

The brief's step 2 names an authored clinic placement
(`clinic-knee-pain.ts:53,76,99` carry the three vectors) and an unauthored supine
station (`ed-chest-pain.ts` contains no `placement:` key at all — the brief's
`:41` cite is `actors: [`).

**The unauthored control cannot currently fail.** The default ED bundle stores
`{x:-0.9, y:0, z:-0.1}` (`asset-registry/src/runtime-bundles.ts:1457`), which
equals `DEFAULT_STRETCHER_POSITION` (`actor-posture.ts:215`). Asserting it did
not move is green whatever happens. It needs a discriminator that would change if
the offset path leaked into it.

Three further rules from what was measured here:

**Do not accept a bundle value as evidence.** The chain's last link overwrites it.
Acceptance samples the posed, skinned humanoid after framing, pose application
and at least one subsequent frame.

**Do not accept effector residual.** The recorded bake-off produced 0.0000 m on a
destroyed limb. Chain integrity and interior joint angle, plus a native-resolution
still, is the standard that run established.

**Do not accept `status: "loaded"`.** Read `fallbackActive` with it.

## 4. Out of scope here

General room synthesis, inventory systems, dynamic task planning, new physiology,
learned-provider adoption, and any hardware recommendation. The licensing
position in the brief stands unchanged: permissive and non-copyleft for adopted
code, weights, data and dependencies, with the MPFB2 record corrected against the
installed release before future clearance.

## NOT TESTED

No build, test or runtime capture was run for this plan. Every claim is a static
read at the cited line. The lane structure is a proposal about write-root
disjointness, not a measurement of worker throughput on this work.

## 5. Round 1 review — corrections to this document

Reviewed by grok-4.6 with the repository, the TypeScript LSP and the BothyBoard
MCP, 2026-09-09. Full record:
[round 1](scene-layout-consultation-records-2026-09-09/grok-4.6-plan-review-round-1.md)
[round 2](scene-layout-consultation-records-2026-09-09/grok-4.6-plan-review-round-2.md)
and [round 3](scene-layout-consultation-records-2026-09-09/grok-4.6-plan-review-round-3.md).
Every correction below was re-verified against the tree before being written here.

**The faculty lock IS applied. My mechanism was wrong, twice.** Section 1 said the
`/plantOffsetMeters` pointer "resolves against `node.spec`, which never carries
that key". I then grepped for an applier, found none, and told the operator that
"nothing applies an override patch, for any path". Both statements are false.
`specAfterOverride` at `tools/openclinxr/factory/encounter-materialization-compile.ts:167-176`
copies `node.spec` and upserts `overridePatch.path` onto it, so a lock on
`/plantOffsetMeters` does change the recipe hash. My grep missed it because I
searched for `patch.path` and `applyPatch`, not `node.overridePatch.path`.

The correct statement: the lock is decorative as PRESERVATION OF AUTHORED
CONTENT, because no Placement baker reads the patched spec while the node is
`status: "planned_unsplit"`. It is not decorative as an override inject. S4's
known-good is wrong in the same way and must say that putting the offset on the
spec is necessary and not sufficient — a baker has to read it.

**Framing runs BEFORE posture is stamped, and the plan does not record it.**
`actor-staging.ts:115` calls `ctx.applyActorFraming(patient, patientActorId)`
with two arguments and no posture; `patient.userData.openClinXrActorPosture` is
set seven lines later at `:122`. The seated guard at
`xr-scene/src/encounter-actor-framing.ts:133-135` reads
`actor.userData.openClinXrActorPosture` or `input.posture`, and at framing time
neither is populated for the patient. So the guard cannot fire, and a supine
patient is framed as a floor-standing actor by default.

That guard's branch also writes `actor.rotation.y = -0.26` (`:137`), so framing
is a third heading writer, not only the two spouse lines section 1 names.

The hazard for the lane split: S5 owns `encounter-actor-framing.ts` and S6 owns
`actor-staging.ts`. A wave-2 fix that makes framing respect posture is true for
the family actor and false for the patient until wave 3.

**Section 1's framing claim was overstated.** `encounter-actor-framing.ts:69-115`
are the OB and telehealth branches, not an unconditional override. Seated actors
keep their XZ at `:133-141`.

**Two citations are wrong.** `ed-chest-pain.ts:41` is `actors: [`; the file
contains no `placement:` key at all, so the claim that it is an unauthored
control is true and the line number is not. And S3's card labels
`xr-capture-evidence/src/scene-manifest-evidence.ts:192-202` a readiness
predicate; that function is `shouldSuppressGeneratedEquipmentModel`. The
aggregate that actually lies is `loadedCount` at
`xr-capture-evidence/src/scene-asset-evidence.ts:65`, which counts suppressed
slots as loaded while `fallbackActiveCount` at `:68` already exists beside it.

**The unauthored supine control is a no-op on XZ today.** The default ED bundle
stores `{x:-0.9, y:0, z:-0.1}` (`asset-registry/src/runtime-bundles.ts:1457`),
which equals `DEFAULT_STRETCHER_POSITION` (`actor-posture.ts:215`). A control
that cannot move is not evidence that the fix left it alone. It needs a
discriminator that would change if the offset path leaked into it.

**One listed fixture will not go red.** S2's card names
`ui-route-admin/src/the-worldview-placement-nodes-author-plant-and-support.test.tsx`
as encoding the scalar. Line 33 is
`expect(panel).toMatch(/supportSurface|plantXyz|plantOffset/)` — a regex over the
panel's source text. `plantOffsetMeters` already matches `plantOffset`, so it is
green today and stays green whatever S2 does. That is precisely the cheap pass
S2's counterweight was written to block, and the card advertises it as a guard.

**Three lane collisions, none of them visible in the declared write roots.**

- S2 must edit `shared-schemas/src/the-factory-station-schemas-validate.test.ts`,
  because `shared-schemas/src/factory-stations.ts:5-8` re-exports the catalog S2
  changes and S2's own proof runs the shared-schemas suite. That file is inside
  S7's write root.
- S9 and S11 both write `scenario-runtime/src`, and S11 depends only on S3 and
  S7, so the board can dequeue S11 while S9 is in flight. S9 must become a
  dependency of S11.
- S1 cannot populate the heading through the production builder:
  `generatedActorPlacement` lives in `asset-registry/src/actor-placement.ts:24-59`,
  which is S4's write root. S1 extends the type and the hardcoded literals only,
  and the heading must stay optional or every constructor in
  `runtime-actor-placements.ts`, `actor-staging.ts` and
  `generated-ed-station-runtime-bundle.ts` breaks.

**Every card's `changed:` target is too wide.** Directory targets mean "some
descendant changed", which a worker satisfies by editing an unrelated file. Each
must name the fix-bearing file. Five cards (S4, S6, S8, S10, S11) also carry the
measured evidence only in this document and not in the card body, and a worker
executes the card.

**Not accepted.** The review could not check the "21 of 42 packages", the
eight-worker ceiling or the 754 ledger records; those are from yesterday's
measurements in this session and stand as recorded, unverified by this reviewer.

### Consequence

The chain map survives review. The cards do not. They are being left Idle and
will be recreated from this document once the review rounds converge, rather
than patched once per round.
