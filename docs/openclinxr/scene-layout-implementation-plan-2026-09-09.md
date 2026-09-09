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

**The faculty lock preserves nothing.** `PLACEMENT_OVERRIDE_PATHS` includes
`/plantOffsetMeters` (`encounter-materialization-evidence.ts:634`) and
`encounter-materialization-faculty-locks.ts:45-46` treats it as lockable. The
override IS applied: `specAfterOverride`
(`encounter-materialization-compile.ts:167-176`) copies `node.spec` and upserts
the pointer, so a lock changes the recipe hash. What it cannot do is preserve an
authored value, because the emitter never writes the key (`:309-315`) and no
Placement baker reads the patched spec while the node is `planned_unsplit`.
Putting the offset on the spec is necessary and not sufficient; a baker has to
read it. See §5 — this document asserted the wrong mechanism twice.

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

Created Idle on BothyBoard project OpenClinXR, not planted. Planting makes a card
dequeuable and the operator asked that no implementation begin.

| card | id | wave | lane | step |
|---|---|---|---|---|
| A runtime actor placement can express a heading | `tsk_71dad3085692b470` | 1 | A | staging |
| The authored plant offset stays a vector from admin to the staging station | `tsk_61a405f61ea64f71` | 1 | B | staging |
| A suppressed placeholder GLB cannot report itself ready | `tsk_3c4e9d81485e7f70` | 1 | A | instrument |
| Authored equipment strings bind to asset ids under a reviewed precedence | `tsk_35401f4021b670ba` | 1 | B | room_generate |
| An authored scheduled event reaches a runtime dispatcher | `tsk_0123a475c3f8d9e1` | 1 | B | dialogue_runtime |
| The factory resolves actor placement from the case, not from the actor index | `tsk_ec6bf10b129255c2` | 2 | B | staging |
| A staged transform survives slot repair, framing and the frame loop | `tsk_f90bdaad8fde5699` | 2 | A | staging |
| Two copies of one equipment asset are representable in a room | `tsk_0d28bbd5c3e8d209` | 2 | A | equipment_generate |
| A motion executor declares which chains it owns and survives the frame loop | `tsk_4ca2eaa621ac1eb5` | 2 | A | motion_retarget |
| One encounter produces a reviewable initial scene specification | `tsk_cad38802047f3c8d` | 2 | B | room_generate |
| The runtime applies the authored offset and a heading to the mounted humanoid | `tsk_6e7efa907065fe8c` | 3 | A | staging |

Dependencies recorded on the cards: the factory card waits on the authored
vector, the survival card and the equipment-identity card wait on the heading
field, the motion card waits on the survival card, the scene specification waits
on the readiness predicate and the equipment binding, and the runtime card waits
on three.

Two dependencies are MISSING from the cards as created and must be added when the
set is recreated. The scene specification must wait on the event dispatcher —
both write `scenario-runtime/src`, and without the edge the board can dequeue
them concurrently. And the heading card cannot populate the production builder:
`generatedActorPlacement` lives in `asset-registry/src/actor-placement.ts:24-59`,
inside the factory card's write root, so the heading card extends the type and
the hardcoded literals only, and the field must stay optional or every
constructor in `runtime-actor-placements.ts`, `actor-staging.ts` and
`generated-ed-station-runtime-bundle.ts` breaks.

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
[round 1](scene-layout-consultation-records-2026-09-09/grok-4.6-plan-review-round-1.md).
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
