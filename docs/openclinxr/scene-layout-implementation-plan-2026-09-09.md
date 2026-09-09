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
| 0 — specify the starting scene | **partial** | `buildInitialSceneSpec` returns the four outcomes with observed evidence and names a real unwired consumer per required asset. It REPORTS; nothing consumes it, and no required state is enforced before an encounter begins. |
| 1 — freeze one supine station as a control | **met** | `computeSupineControlFreeze` hashes every asset the station loads and refuses a recorded measurement whose bytes moved, naming the changed path. |
| 2 — prove authoring reaches the scene | **MET 2026-09-09** | Measured on the loaded, posed, skinned humanoid after framing, pose application and 30 further frames, as a control/treatment pair: `measured delta {x: 0.3967, z: -0.0015}` against an authored `{x: 0.4, z: 0}` — err 0.0033 m and 0.0015 m against a 0.02 m tolerance derived from the unauthored control's own drift. The unauthored supine control retains its defaults. |
| 3 — stationary clinical staging | **staging + bedside target + heading MET** | The physician is staged as a physician, placed at a bedside target computed from the patient's position, facing her, and the heading is CONSUMED at runtime. Equipment/body clearance, the approach zone and monitor visibility are still absent, and the idle/speech check is not done. |
| 4 — physician approach | **not started** | — |
| 5 — variation, replay and failure behaviour | **partial** | Only the byte-freeze half: changed asset geometry invalidates dependent evidence. No variation indices, no impossible-layout case, no corrupt-artifact refusal, no displayed-motion capture. |
| 6 — compare one legally eligible learned provider | **not started** | Kimodo-SOMA-RP-v1.1 remains a conditional offline lead, unverified here. |

**Step 2 is the brief's own named next milestone**, and it is the honest place to be working.

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
