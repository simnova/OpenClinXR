I'll review the replacements against the tree: first the corrected plan and the eleven new cards, then the claims that changed.Several cards look thinner than the plan claims. I’ll verify the faculty-lock path, the framing/stamp-order interaction, and whether the new `done_when` lines actually fail on HEAD.The replacements close the round-1 collisions. Three mechanism errors are still in the operative text, and five cards are still too thin to plant.

## 1. New errors in the corrections

**Faculty lock: a Placement lock changes the recipe hash.** WRONG. `specAfterOverride` is used only inside `recipeKeyFor` (`encounter-materialization-compile.ts:88-95`). `planEquipOrRoomWouldInvoke` calls `recipeKeyFor` only when `family` is `EquipVariant` or `Room` (`:135-136`). Placement falls through to `planEquipmentWouldInvoke`, which returns `wouldInvoke: null` for any non-Equip family (`plan-equipment-would-invoke.ts:15-17`). The comment at `compile.ts:128` matches the code: placement stays `wouldInvoke` null and keeps `node.cacheKey` (null from the emitter). A lock on `/plantOffsetMeters` is stored on the node. It does not hash, bake, or move a humanoid. Putting the key on the emitted spec is necessary for a future skip-capable Placement baker. It is not sufficient, and S4 cannot add that baker: `encounter-materialization-compile.ts` is not in `tsk_d52f5925ae08dba5` write roots.

**Framing paragraph (patient `:115` vs `:122`).** CONFIRMED for the patient. OVERSTATED as patient-only. Clinical is the same stamp-after-framing (`actor-staging.ts:161` then `:167`). Family and additional_cast already stamp first (`:222-226`, `:263-266`). `cue-evidence.ts:144` reads `userData.openClinXrActorPosture` at the wrapper, so the two-arg `applyActorFraming` call carries no posture for patient or clinical.

**S5 “refuse unknown” then S6 stamp reorder.** WRONG as a sequence. The seated keep-XZ guard is seated-only (`encounter-actor-framing.ts:133-141`). After S6 stamps `supine` before framing, that guard misses and the patient hits `position.set(-0.9, 0, 0.08)` at `:155-159`. S5-alone (unknown → do not frame) keeps the stretcher plant. S6 then restores today’s standing frame. They stay two cards if S5’s RED is keep-XZ for seated and supine (unknown still refuses). They should not merge: S6 holds `main.ts`.

**Section 2 still asserts “21 of 42 packages” and the eight-worker / 754 figures** (`scene-layout-implementation-plan-2026-09-09.md:178-180,220-223`) after §5 marks them unverified. OVERSTATED leftover. I still have not checked those three numbers. I agree they do not belong in the verified set.

**Wave-1 copy disagrees with itself.** “four concurrent, one paired” (`:182`), then “Five in wave 1” (`:220`), then the table still lists S2 and S7 as concurrent with directory roots. The cards already narrowed those roots. Stale plan, not a new card bug.

**Last-link paragraph** (`:46-49`) still omits the unauthored no-op that §3 now records. OVERSTATED in §1 only.

## 2. Cheap passes on the replacements

No replacement `done_when` is a test that fails on HEAD. Every “RED must fail on HEAD” is still a worker instruction. `run:` suites I grepped are green today.

| card | cheap pass | honest fail? | counterweight |
|---|---|---|---|
| S1 heading | `heading?: 0` on `runtime-bundles.ts:1457-1459` | typecheck if required | prose |
| S2 vector | touch the panel without dropping `min={0}`; widen catalog to accept scalar and object | yes, if catalog refuses `0.1` | prose (regex named, not replaced in-tree) |
| S3 ready | fix `loadedCount` only; leave loader `status:"loaded"` | yes, if a test asserts suppressed is unready | prose |
| S7 bind | comment in `schemas.ts` | no TREE unmatched-report | prose |
| S9 dispatch | `tick(30)` helper, no session clock | yes, if 29/30/31 is planted | prose |
| S4 factory | zeros on spec; `generatedActorPlacement` still index-based; bundle file not in `changed:` | `changed:` three files, not case-derived | **absent from the card body** |
| S5 survive | compose `baseX` while tests use 0; refuse-unknown only | yes, if nonzero `baseX` is planted | prose |
| S8 identity | instance id in two files; `main.ts` `Map.set` and `.find` at `runtime-bundles.ts:1632` stay | no, fourth site is out of write roots | **absent** |
| S10 motion | fourth `userData` flag | no integrity RED | **absent**; `xr-pose/src` is still a directory root |
| S11 spec | new stub files, not exported | no | **absent** |
| S6 runtime | compose offset, stamp first, skip yaw; unauthored control still a no-op | no discriminator in the card | **absent** |

S1, S2, S3, S5, S7, S9 now have measured text. S4, S6, S8, S10, S11 do not, against the plan’s claim that every card gained it (`:247-248`).

## 3. Waves

S2 ∩ S7 write collision is gone: S2 holds `the-factory-station-schemas-validate.test.ts`; S7 is `schemas.ts` / `validators.ts` / `index.ts`. CONFIRMED on the replacement `writeRoots`. They can run concurrent. S9 ∩ S11 is gone: S11 `depIds` include `tsk_4d495eb216687476`, and the files no longer overlap.

S4 still depends only on S2. S1 says the factory card populates `generatedActorPlacement` heading (`tsk_c28354df7d5d3963` body). S4’s objective never mentions heading. Missing edge, or missing sentence on S4.

S3 and S8 both list `generated-loaders.ts`. The board’s non-overlapping-roots rule will serialize them if S3 is still in flight. Not a silent overwrite.

S5 wave 2 / S6 wave 3 is the right split only with a supine keep-XZ on S5. Merging them would put `main.ts` in the survival card and re-serialize the 91-writer file for work that does not need it.

## 4. Wrong result if planted now

S4 worker will wire `generatedActorPlacement` to the case and never touch compile, then report the faculty lock real. Positions can move. The lock still will not.

S5 worker will refuse unknown posture. S6 worker will stamp `supine` and the standing frame will fire. The survival card’s own patient fix undoes itself.

S8 worker will find the fourth collapse site in `main.ts:2838` and either stop or edit S6’s file.

S11 worker will add `shared-schemas/src/initial-scene-spec.ts` that `index.ts` does not export (`shared-schemas/src/index.ts:8-24` is a named list; `package.json` exports only `"."`). The spec is unreachable from `@openclinxr/shared-schemas`.

S6 worker will keep the unauthored ED control, which cannot move (`runtime-bundles.ts:1457` equals `actor-posture.ts:215`). Green about nothing.

## Plant?

No.

1. S4: add `encounter-materialization-compile.ts` or drop “baker reads the patched spec”; say heading belongs here and depend on S1; put `generated-ed-station-runtime-bundle.ts` on `changed:`; put the measured chain in the body.
2. S5: RED is keep-XZ for seated and for supine; unknown refuses. Do not merge with S6.
3. S8: drop the `main.ts` Map from “four sites”, or give that site to S6.
4. S11: add `shared-schemas/src/index.ts` to write roots.
5. Write measured + a planted `it.fails` into S4, S6 (discriminator), S8, S10, S11. Until those exist, every `run:` on those cards is green on HEAD.

I would plant after that list, not after a third prose pass.