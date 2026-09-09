I'll review the plan as an adversarial peer: first the documents and cards, then I'll verify the load-bearing claims against the tree rather than the plan's citations.Next I’ll fetch the eleven cards and read the cited source files so I can check the claims against the tree, not the plan.I’ll now read the load-bearing source files the plan cites, starting with the placement chain and the four claims you flagged.The seated/supine path does replace the bundle position; next I’ll check whether the posture helpers already compose an offset, and follow the faculty-lock resolution.The placement-chain diagnosis is mostly true. The wave-1 split and several `done_when` blocks are not, and those would ship the wrong work if planted as written.

## 1. Measured claims

**`main.ts:846-848` discards seated/supine position.** CONFIRMED, and the story is larger than those three lines. `runtimeActorPlacement` at `apps/ui-xr/src/main.ts:846-848` replaces bundle `position` with `familyChairWorldPosition ?? seatedActorWorldPosition({})` or `supineActorWorldPosition({})`. Those helpers take only a fixture origin (`packages/openclinxr/asset-registry/src/actor-posture.ts:204-229`); they have no offset argument. The call site passes `{}`. `verticalOffsetMeters` is replaced on the same path (`main.ts:839-842`). Nothing upstream composes `plantOffsetMeters` into that result. The default ED local bundle already stores `{x:-0.9,y:0,z:-0.1}` (`runtime-bundles.ts:1457`), which equals `DEFAULT_STRETCHER_POSITION` (`actor-posture.ts:215`), so the unauthored ED control is currently a no-op on XZ. The discard still kills any authored delta that reached the bundle.

**Slot repair overwrites and reports neither added nor changed.** CONFIRMED. `runtime-actor-placements.ts:102-114` rewrites `position`/`scale` from `SLOT_PLACEMENT_ANCHORS` when `slotKind` differs. `addedActorIds` is pushed only at `:114` when `!existing`. The published evidence type (`:121-125`, `:134-139`) has `declaredActorIds` and `addedActorIds` only. Header `:15-16` is false.

**`animation-loop.ts:156` is latent because the loader zeroes the child.** CONFIRMED for the standing/seated branch. `slot.root` is the humanoid child (`humanoid-animation.ts:116`). The loader sets `humanoid.position.set(0, effectiveVerticalOffset, 0)` (`generated-loaders.ts:112`). The non-supine branch assigns `position.x` without `baseX` (`animation-loop.ts:156`) while Y/Z/scale compose from bases. Supine plant can move child X before bases are captured (`applyAndPlantSupineOnDeck` at `humanoid-animation.ts:93-99`); that branch restores `baseX` via `holdSupinePlantFrame` (`animation-loop.ts:148-152`). The latent claim holds where the bug lives.

**Faculty lock is decorative because `/plantOffsetMeters` resolves against `node.spec`.** OVERSTATED. Emitter spec has no such key (`encounter-materialization-evidence.ts:309-315`). `specAfterOverride` upserts the pointer onto a copy (`encounter-materialization-compile.ts:167-176`), so a lock with `overridePath: "/plantOffsetMeters"` still changes the recipe hash. Faculty can lock a field the emitter never writes. No Placement baker reads it (`status: "planned_unsplit"`). Decorative as preservation of authored content; not decorative as an override inject.

**Framing always rewrites after placement (`encounter-actor-framing.ts:69-115`).** OVERSTATED. Those lines are the OB and telehealth branches. Seated actors keep XZ (`:133-141`). Patient and clinical stamp `openClinXrActorPosture` after framing (`actor-staging.ts:115` then `:122`; `:161` then `:167`). The file header records that on purpose (`actor-staging.ts:8-11`). `skipFraming` is capture-mode only (`main.ts:2270-2271`). Default runtime therefore frames a supine patient as floor-standing because the seated guard never sees posture.

Other load-bearing citations that held: case vector schema `schemas.ts:235-241`; clinic vectors `clinic-knee-pain.ts:53,76,99`; admin scalar + `min={0}` `environment-generation-queue-panel.tsx:123,459-460`; station schema `catalog.ts:203-207`; factory `plantOffsetMeters: 0` and `supportSurface: placement.posture` `multi-case-runner.ts:806-807`; four hardcoded bundle positions `generated-ed-station-runtime-bundle.ts:1248-1275`; per-frame outer yaw `main.ts:3512-3513`; `actorPlacement` consumed `actor-staging.ts:58,104,149`; no heading field `runtime-bundles.ts:162-171` (grep of those four trees: 0 hits); equipment string vs id `schemas.ts:490-491` and `ed-chest-pain.ts:266-326`; `getScheduledEventsDue` callers only its test (repo grep); `status:"loaded"` + `fallbackActive:true` early return `generated-loaders.ts:447-462`; `gestureClipIds: []` `emotion-performance-mapper.ts:247`; motion adapter string `motion_retarget/run.ts:19`; bake-off `verdict:"other"` `report.json:67`; `main.ts` excess-writer 91 over 17 writer-days from `git log --since=2026-08-01` using `parallelism-report.ts`’s metric.

`ed-chest-pain.ts:41` as the unauthored control is a sloppy cite (`actors: [`). The file has zero `placement:` keys. Claim true, line wrong.

S3’s card labels `scene-manifest-evidence.ts:192-202` a readiness predicate. WRONG: that function is `shouldSuppressGeneratedEquipmentModel`. Aggregate `fallbackActiveCount` already exists (`scene-asset-evidence.ts:68`); `loadedCount` at `:65` still counts suppressed slots as loaded.

CANNOT CHECK: “21 of 42 packages”, eight-worker ceiling, 754 ledger records.

## 2. Lane split

Declared wave-1 write roots are disjoint. Actual work is not.

**S2 ∩ S7 (hard).** `tsk_61a405f61ea64f71` must edit `packages/openclinxr/shared-schemas/src/the-factory-station-schemas-validate.test.ts` because `shared-schemas/src/factory-stations.ts:5-8` re-exports the catalog S2 is changing, and S2’s `done_when` runs `pnpm --filter @openclinxr/shared-schemas test`. That file sits inside S7’s write root `shared-schemas/src`. Integrate of those two cards contends on one test fixture.

**S9 ∩ S11 (missing dep).** Both write `packages/openclinxr/scenario-runtime/src`. S11 (`tsk_cad38802047f3c8d`) depends on S7 and S3 only. After those land, BothyBoard can dequeue S11 while S9 (`tsk_0123a475c3f8d9e1`) is still in flight.

**S1 production builder lives in S4.** Heading populated by `generatedActorPlacement` requires `actor-placement.ts` (`actor-placement.ts:24-59`), which is S4’s write root, not S1’s. S1 can only annotate the type and the hardcoded `runtime-bundles.ts:1457-1459` literals. `packages:typecheck:agent` forces `heading` to stay optional; required would break constructors in `runtime-actor-placements.ts`, `actor-staging.ts`, and `generated-ed-station-runtime-bundle.ts`.

S3’s `ui-xr` tests import `@openclinxr/asset-registry/runtime-bundles`. Optional heading does not collide. Required heading would.

## 3. Contracts

| card | cheap pass that still greens | honest fail possible? |
|---|---|---|
| S1 heading | add `heading?: number`, one fixture literal, no builder | typecheck fails only if required |
| **S2 vector** | change `catalog.ts` only; admin `InputNumber min={0}` stays; `the-worldview-placement-nodes-author-plant-and-support.test.tsx:33` is a regex for `plantOffset` and is already green | factory-stations VALID `0.1` will fail if the schema refuses a scalar; the admin test will not |
| S3 ready | predicate in `xr-capture-evidence` only; `changed:` is the directory, not `generated-loaders.ts`; `loadedCount` keeps lying | yes, if a test asserts suppressed is unready |
| S7 bind | comment in `schemas.ts`; directory `changed:` | no TREE rule that unmatched strings are reported |
| S9 dispatch | one `startSession` call at t=0; directory `changed:`; ordering/idempotence is prose | domain tests already pass |
| S4 factory | put `{x:0,y:0,z:0}` on spec; card has no counterweight in the board body | `changed:` two files forces an edit, not a case-derived value |
| **S5 survive** | report `changedActorIds` in `runtime-actor-placements.ts`; `changed:` names only that file; framing and `animation-loop.ts` can stay | counterweight (nonzero `baseX`) is prose |
| S8 identity | stop collapsing in `station-equipment.ts`; `Object.fromEntries` at `runtime-bundles.ts:1418` still overwrites | `changed:` does not require the bundle key |
| S10 / S11 / S6 | seam, JSON spec, or `main.ts` tweak; counterweights absent or prose; S6 `changed:` is only `main.ts` | S6 can leave `actor-staging.ts` stamp order and `actor-posture.ts` offset-less |

S2’s card lists three fixtures “that will go red.” The admin one will not. That is the cheapest pass the card’s own counterweight was meant to block.

## 4. Missing (wrong result if left out)

S5 will copy the seated framing guard and miss the patient. Stamp-after-framing is documented in `actor-staging.ts:8-11` and is out of S5’s write roots. S6 is the card that owns `actor-staging.ts`, and it runs later. A wave-2 “framing no longer discards” landing can be true for family and false for the supine patient.

S6 still has to stop `patient.rotation.y` / `nurse.rotation.y` every frame (`main.ts:3512-3513`). S5 does not touch `main.ts`. Heading that survives framing dies on the next tick until S6. That dependency is declared. The stamp-order hole is not.

S4’s known-good says putting the offset into spec makes the faculty lock real. `specAfterOverride` already injects it. S4 still has to make a baker read it, or the lock remains a hash twitch.

Five Idle cards (S4, S6, S8, S10, S11) have no measured block and no counterweight in the board body. A worker executing the card, not the plan, will not see the four collapse sites or the `baseX` trap.

## Before any plant

1. Give S2 write access to `shared-schemas/src/the-factory-station-schemas-validate.test.ts`, or move that fixture into `factory-stations`. Add a TREE proof that `InputNumber` accepts signed components and that a scalar payload is refused. Drop the admin regex test as a red.
2. Point S5 `changed:` at `encounter-actor-framing.ts` and `animation-loop.ts` as well. Put a planted RED that sets nonzero `baseX` and asserts it after a frame. Tell S5 to stop `position.set` without reading `openClinXrActorPosture`, or pull the patient/clinical stamp reorder into S5.
3. Add S9 as a dependency of S11.
4. Either add `actor-placement.ts` to S1 or state that S1 only extends the type and the hardcoded `runtime-bundles.ts` literals, with S4 owning builder population.
5. Put the missing measured/counterweight text onto S4, S6, S8, S10, S11. Replace directory `changed:` with the file that must carry the fix. Encode S9 ordering/idempotence and S7 unmatched-report as `run:` tests that fail on HEAD.

The chain map is good enough to build from. The cards are not. Planting this set as Idle-to-Planted would let S2 skip the admin control, let S5 report an overwrite it still performs, and let S9 and S11 share `scenario-runtime/src` without a dep.

NEXT: rewrite those five proofs, then plant.