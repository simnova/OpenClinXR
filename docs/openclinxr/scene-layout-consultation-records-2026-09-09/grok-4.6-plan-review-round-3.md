I'll compare the pristine brief to the repo copy, then check the six planted REDs against HEAD before giving a plant verdict.The six named RED files are not on HEAD. Planting now sends workers to write the test and the fix in one pass.

## Brief rewrite

Pristine bytes match: 45,591, sha256 `caf27580d2956310fe463f5bfc36a471844ec6d7a35a0c5bd0249b08938245bb`. Diff vs the repo copy is 122 path-only lines (consultation-record links and `R1`–`R59` stripped of `/Volumes/files/src/openclinxr/`) plus a provenance banner that is not in the received artifact. No claim, line number, or word of the brief body changed meaning. `R34` is still `ed-chest-pain.ts:41` in both copies.

## 1. Planted REDs

None of the six files exist. `pnpm exec vitest run tools/openclinxr/factory/the-placement-node-carries-the-authored-offset.test.ts` prints `No test files found, exiting with code 1`. The other five names grep to zero. A `run:` of a missing file fails; it does not encode a product clause.

Against the clauses as described, if those files were written as `it.fails` today:

**Factory** (`the-placement-node-carries-the-authored-offset.test.ts`). A check that `emitCompileNodes` for `clinic-knee-pain` has no `plantOffsetMeters` FAILS on HEAD (`encounter-materialization-evidence.ts:309-315`). A check that `generatedActorPlacement` uses the actor index also FAILS (`actor-placement.ts:48-50`). The filename sits under `tools/openclinxr/factory/` and names the compile node. A worker can green that file by putting the clinic vector on `spec` only, then touch `actor-placement.ts` and `generated-ed-station-runtime-bundle.ts` with a comment to satisfy `changed:`. Zeros on spec also pass a key-exists assertion. CONFIRMED fail for the node; OVERSTATED as covering the builder.

**Survival** (`the-framing-guard-keeps-seated-and-supine-anchors.test.ts`). Seated keep-XZ PASSES on HEAD (`encounter-actor-framing.ts:133-141`). Supine with a non-standing plant FAILS: it hits `position.set(-0.9, 0, 0.08)` at `:155-159`. Unknown posture FAILS: it is framed. An honest keep-XZ for seated and supine, with unknown refusing, would pass those two. Standing still framed is not in the RED; keep-XZ for every posture would also pass. Frame-loop `baseX` and slot-repair reporting are not in this filename; `changed:` on those two files can be a comment. CONFIRMED fail for supine/unknown; seated clause green today.

**Identity** (`two-copies-of-one-asset-mount-separately.test.ts`). `planStationEquipmentMounts` dedupes (`station-equipment.ts:400-405`). Two IVs → one item FAILS on HEAD. Honest two mounts pass. A report-without-two-meshes also passes unless the test counts scene objects. `Object.fromEntries` (`runtime-bundles.ts:1418`) and `.find` (`:1632`) are not this file. CONFIRMED fail for the station planner only.

**Motion** (`an-owned-chain-survives-the-posture-pass.test.ts`). No ownership carve-out. Owned-bone-survives FAILS. Neighbour-still-overwritten PASSES (both overwritten). Freeze-the-whole-actor fails the neighbour clause. CONFIRMED, and the asymmetric pair is the right counterweight.

**Spec** (`the-scene-spec-reports-an-absent-required-asset.test.ts`). No reporter. Import or call FAILS. Honest unsatisfied-on-absent passes. Report-everything-unsatisfied also passes; the card does not require a present asset to be satisfied. OVERSTATED as a binding of required contents.

**Runtime** (`the-authored-offset-reaches-the-posed-humanoid.test.ts`). `main.ts:846-848` discards seated/supine position. A clinic-knee-pain vector on the posed humanoid FAILS. An ED-only control cannot move (`runtime-bundles.ts:1457` equals `actor-posture.ts:215`). A check of `runtimeActorPlacement`’s return, before framing and plant, is not the posed humanoid. The Map at `main.ts:2838` is not this filename. CONFIRMED fail only if the owner writes clinic + posed-after-frame.

## 2. Applying the fixes

Leaving `encounter-materialization-compile.ts` out is the right call. Placement is not skip-capable (`compile.ts:135-136`); `specAfterOverride` never runs for it. Wiring `generatedActorPlacement` to the case is the outcome path. The lock stays stored-and-inert until a later slice makes Placement skip-capable. Do not claim it. CONFIRMED.

Section 1 of the plan still says a lock “changes the recipe hash” (`scene-layout-implementation-plan-2026-09-09.md:32-41`). Section 2b has the third correction (`:275-285`). A worker who reads the top still gets the second-wrong mechanism. OVERSTATED leftover in §1.

Supine keep-XZ at `:133-141` does not touch the OB/telehealth returns at `:61-120`. Those return first. Hoisting keep-XZ above `:107` would skip the telehealth chair plant. Pin the extension to the existing seated `if`. CONFIRMED safe in that position.

Runtime card `tsk_1fc0c05f84a6a344` takes the `main.ts:2838` Map and does not depend on `tsk_86aebc46ba791e1a`. Wave 3 can start while identity is still in flight, and the Map has no instance id to store. Missing edge.

## 3. Cheap passes on the six r3 cards

| card | cheap pass |
|---|---|
| factory | offset on compile spec only; builder still index-based |
| survival | supine keep-XZ; `baseX` still assigned; repair still silent |
| identity | two rows from `planStationEquipmentMounts`; bundle `fromEntries` still collapses |
| motion | none, if both sides of the pair are asserted |
| spec | every asset unsatisfied; `scenario-runtime/src/index.ts` not in `changed:` |
| runtime | clinic slot position before plant; ED control; Map untouched |

## Plant?

No.

1. Commit the six files as `it.fails` before plant. They are absent; a missing-file `run:` is not a product clause.
2. Factory RED must assert the clinic-knee-pain vectors on `generatedActorPlacement`, not only on the compile node.
3. Runtime RED must use clinic-knee-pain on the posed humanoid after framing and one frame, plus an unauthored discriminator that can actually move. Add `tsk_86aebc46ba791e1a` to that card’s `depIds`.
4. Spec RED must also assert a present required asset is satisfied.

Survival keep-XZ for supine belongs at `:133-141`. The lock stays out of the factory card. Those two calls were right.

NEXT: write those four RED constraints into the six files, commit them failing, then plant.