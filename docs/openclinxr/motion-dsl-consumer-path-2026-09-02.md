# Motion DSL: does it get a consumer, and at what price

Measured 2026-09-02 against main `2de4918d`, over four adversarial review rounds. Every path and
number was re-measured here before being written down.

## Recommendation

**Do not wire the Motion DSL to make a patient flinch when touched. Ship a deterministic runtime
touch gesture, and add a `motion_compile` station only if offline case-authored animation generation
is itself a product requirement.**

`packages/openclinxr/motion-compiler` compiles authored touch responses into deterministic bone
tracks and nothing consumes its output. Wiring it to the learner costs eight to nine steps across two
packages, a new D9 station, a glTF packer, a promotion protocol out of a gitignored evidence root, a
runtime posture problem and a cast-resolver bypass. That is a platform project. The product
requirement it would serve is one visible gesture.

The cheaper route is already stubbed in the runtime, with a comment naming the seam:

```
// Slice F seam: animation-driven today; a "physics" mode later gates the baked
// replay (applyPhysicsBoneTransforms) on this hit without changing the caller.
function respondToTouch(actorId, config, mode: "animation" | "physics"): boolean {
  if (mode === "physics") return false;                                    // main.ts:6773
  return playOneShotResponseClip(actorId, config.responseClip);
}
```

`respondToTouch` already receives the case-derived region, response kind, force threshold and actor
id. A deterministic transient gesture there maps laterality to an arm, `responseKind` to a small
committed gesture table, scales duration and amplitude from `forceThreshold`, resolves canonical
bones against the cast-selected humanoid, applies a short attack/hold/release delta in the existing
per-frame update, and restores the pre-touch pose. The runtime already resolves canonical landmarks
across rig families — `applyHumanoidJointRotationsByAlias` turns `upper_armL` into MPFB2's
`upperarm01L` (`apps/ui-xr/src/clinical-idle-posture.ts:342`) — and a capture-only path already
applies per-frame bone deltas (`physics-touch/apply-physics-bone-transforms.ts:65`). Reuse the
mechanical pattern, not the fenced physics product (`main.ts:239`).

This satisfies D9's no-LLM production constraint, avoids every item in the paragraph above, and
avoids the mixer exclusion that blocks supine actors entirely (`main.ts:7511`). It does not make the
Motion DSL a consumer and must not pretend to.

**What parking costs.** Roughly 10,000 lines stay unconsumed and keep their dependency and test
maintenance. The six planted REDs become experimental debt rather than production blockers, and must
be reclassified so nobody dequeues them as if the learner were waiting. Offline compilation, if ever
wanted, still owes the profile, packer, gate and promotion work below. The project gives up
compiler-versioned reusable baked motion for now. Sunk implementation is not a reason to add a
station, a packer, a promotion protocol and a runtime bypass to rescue it.

## The orphan, measured

Nothing outside the package imports it; `factory-stations` declares no dependency on it; its one
apparent consumer is the string `adapter: "@openclinxr/motion-compiler"` in a plan payload
(`factory-stations/src/motion_retarget/run.ts:19`), with no import and no call; and the Blender stage
that payload names takes `--actor --clip --map --output --report`, a named-clip BVH retarget. Neither
profile deriver is exported from `src/index.ts`.

```
ScenarioMotionCompileInput        authored touch responses + optional placement
  -> planMotionProgram            deterministic-scenario-motion-planner.ts:31   VALIDATES its IR
     -> MotionProgram             openclinxr.motion-program.v1
  -> compileMotionProgram         compile-motion-program.ts:88                  NO VALIDATION GATE
     -> CompiledMotionClipV1      clipId, source, targetRig, compileIdentity, tracks
  -> (nothing)
```

The compile entry says so itself: *"NO VALIDATION GATE: this entry forwards, it does not judge"*
(`compile-motion-program.ts:15`). Calling this a complete validated compiler, as an earlier draft
did, is indefensible with two primitives missing, no constraints emitted, no evidence gates and
composed tracks unvalidated.

## Rejected alternatives

| alternative | why it fails |
|---|---|
| bake the compiled clip into the actor GLB under the case-authored `responseClip` name | the planner discards the name (`compile-scenario-motion.ts:189`); one program per scenario compiles to one clip (`:223`, `compile-motion-program.ts:112`) while the runtime wants one per row; `clipId` is a content hash, not an alias (`:158`) |
| own the manifest in `asset-registry` | `animation_clip_manifest` is an expected-output STRING in an admin work order (`asset-registry/src/index.ts:1369`) that forbids materialising production assets (`:1407`). Nothing produces it. And `motion-compiler` already depends on `asset-registry`, so the compiler invocation cannot live there without a cycle |
| fold the production step into `rigging` | `rigging` is a private function in `multi-case-runner.ts:572` with no catalog entry, and a missing primitive or alias collision would surface as a rigging failure, destroying the station table's diagnostic value |
| bind the manifest to the rigging GLB | `world_compile` re-invokes `orchestrate_character.py` and writes a NEW GLB into `bakeOutDir` (`multi-case-runner.ts:1103`), so a stage-rig manifest names the wrong file |
| point `actor.model` at a case-scoped composite | `resolveHumanoidVariantOrCastPath` prefers the scenario casting table over the supplied fallback (`humanoid-runtime-asset-url.ts:417`) |

## If the DSL path is taken anyway

These are the contracts it owes. They are recorded so the decision is informed, not so the path is
recommended.

### Refusals

1. **The bank authors one clip name for every region.** All 24 shipped touch rows across six regions
   name `openclinxr_role_patient_guard_withdraw_rlq`.
2. **Two of four `responseKind` values map to absent primitives.** `passive_rom -> brace` and
   `positioning -> posture_shift` (`compile-scenario-motion.ts:134`) against `PRIMITIVE_IDS =
   guard_body_region, clutch_body_region, reach_target, look_at, cough_recoil`
   (`primitive-registry.ts:29`). Every shipped row is `guarding`, which is why nothing has failed.
3. **The planner emits `constraints: []`** (`compile-scenario-motion.ts:215`), so "no declared
   contacts failed" is a green contact gate. The values are not derivable: `ContactConstraint` needs
   tolerances, window fractions, penetration policy and preservation behaviour
   (`motion-program.ts:67`); `TouchResponse` supplies only `forceThreshold`.
4. **Rig identity is self-description.** The compiler hashes the caller-supplied profile and copies
   its optional `rigFingerprint` through (`compile-motion-program.ts:99`, `:156`); the fingerprint
   covers joint names and bind positions only (`derive-skeleton-profile.ts:218`).
5. **A correctly named clip can still never play.** Supine actors get no mixer (`main.ts:7511`);
   seated actors only under the seat-safe carveout (`main.ts:7526`).
6. **Name collisions are silent**, and a response name colliding with an idle name also removes that
   idle from role playback (`main.ts:7520`).
7. **Re-bake behaviour is undefined**, NOT TESTED: whether Blender overwrites a same-named action or
   suffixes it `.001`.
8. **`clipId` does not cover the tracks.** It hashes `motionProgramHash::skeletonProfileHash`
   (`compile-motion-program.ts:158`), so a broken primitive can emit different bytes under the same
   id. Any binding that must detect mutated motion has to digest the artifact, not the id.

### The effector contract, which is the serialization point

Effector selection is not underdetermined; the current profile seam contradicts the tree's own
answer. The ACTION owns canonical intent, `handL | handR | head | pelvis` (`motion-program.ts:35`),
and the planner picks `handL` for left regions, `handR` for right and midline
(`compile-scenario-motion.ts:145`). The rig deriver deliberately omits `effectorBone` because the
request chooses the effector (`the-skeleton-profile-comes-from-a-real-rig.test.ts:114`), and
`resolvePoseBone` already maps canonical names onto a specific rig
(`asset-registry/src/pose-bone-resolver.ts:96`), with `handL -> wristL` for MPFB2 (`:43`) and
`handL -> mixamorig:LeftHand` for Mixamo (`:74`).

**Never add a scalar `effectorBone` to the profile.** `compileMotionProgram` hashes the whole profile
(`:99`), so one rig would acquire different `skeletonProfileHash` values depending on which hand a
case asks to move. That is identity contamination and it silently breaks every downstream binding.
The composed profile carries both canonical-to-actual chains and each primitive resolves
`action.effector` through them. Three primitives violate this today: `guard_body_region` ignores
`action.effector` and requires the scalar (`primitives/guard-body-region.ts:94`), `reach_target`
hardcodes the right arm (`reach-target.ts:29`), and `clutch_body_region` falls back to `handR`
(`clutch-body-region.ts:68`).

### The clipId RED cannot be flipped, and the bank must not move first

`the-resolved-clip-id-is-what-the-compiler-produces.test.ts` clause (2) requires
`compiled(region) === bankClipForRegion(region)[0]` for `abdomen_rlq` and `chest_L`, then requires
those two compiles to differ. All 24 rows name one clip, so the requirements contradict. Repair the
oracle to `logicalName -> compiledClipId` first; it needs no data change. Its upstream,
`scenario-fixtures/src/the-touch-response-clip-follows-the-region.test.ts`, still carries three
unflipped REDs. Nine planted clauses sit on this path across two packages, not six.

Renaming five regions while the runtime does exact-name lookup and returns false on a miss
(`main.ts:6731`) converts "wrong flinch" into "no flinch". The bank change is developable early and
landable only atomically with a delivery path.

### Order

1. correct the clipId oracle, keep it RED
2. the effector and profile identity contract — **everything downstream depends on this interface**
3. per-row planning and compilation, plus unsupported-kind refusal
4. a new eleventh `motion_compile` station (never `rigging`)
5. bank routing — written here, landed with 7
6. six deterministic gates plus the `CompiledMotionClipV1 -> MotionClipFixture` measurement adapter
7. pack an explicitly **unpromoted** candidate
8. load that candidate through the real runtime and run `runtime_smoke`
9. promote atomically on the combined verdict

Steps 7 to 9 are three steps, not one. An earlier draft had gates accepting before the pack, which is
impossible: `runtime_smoke` is one of the seven required gate ids
(`the-motion-evidence-gates-refuse-a-bad-clip.test.ts:141`), so either the report accepts before its
last gate ran or promotion precedes its final gate. Both are false contracts.

The first shared-file serialization is `multi-case-runner.ts`, which steps 4 and 7 both edit. One
integration worker owns that file; separate workers may own the adapter and packer as libraries.

### Adding a station: what breaks

The checked-in evidence is historical, not current: `issue-286/pipeline-station-table.json:4` and
`issue-288/multi-case-rollup.json:93` both record eight stations while the live runner has ten.
Adding an eleventh does not invalidate those observations; rerunning over them would falsify their
provenance.

- `dark-factory-station-table.test.ts:88` pins length eight and forbids extra ids. Freeze it as v1.
- `dark-factory-multi-case.test.ts:79` compares the generated sequence to the same exported constant,
  so it is not an independent ordering oracle. Add a literal one.
- **That test writes over `.openclinxr/evidence/issue-288/multi-case-rollup.json`**
  (`dark-factory-multi-case.test.ts:66`, `multi-case-runner.ts:1424`). An eleven-station run can
  silently rewrite the eight-station historical evidence. Redirect it before touching the chain.
- The multi-case contract asserts no throughput target and treats `error` and `not_run` as acceptable
  (`dark-factory-multi-case.test.ts:17`). A worker can insert `motion_compile`, return `not_run` for
  every case, and pass. Require `deterministic` for every case that reached a rig and carries
  supported rows; `absent` only where no rows apply; all-`not_run` must fail.
- Introduce `chainVersion` rather than widening `openclinxr.dark-factory-station-table.v1`
  (`multi-case-runner.ts:123`).
- The current frontier must be re-measured: `fullyDeterministic`, `deterministicStationCount` and the
  first blocked station are computed from the ordered rows (`multi-case-runner.ts:1386`).
- Incidental: the rigging partial-success message divides the artifact count by four
  (`multi-case-runner.ts:628`). Adding a manifest makes that arithmetic false.

Two artifact mechanics bound the station before it is written. An error row returns
`artifactPaths: []` by construction (`multi-case-runner.ts:623`) and the evidence contract requires
zero on non-deterministic rows (`dark-factory-multi-case.test.ts:112`), so a retained diagnostic needs
a separate `diagnosticArtifactPaths` field. And appending a path is not wiring:
`resolveChainArtifactPaths` maps only body OBJ and wardrobe GLB node ids
(`multi-case-runner.ts:1012`).

### The anti-orphan contract, and why it is still not enough

Step 6 is the component most likely to be built and ignored. Its plant consumes a synthetic
`MotionClipFixture` rather than a compiled clip (`the-motion-evidence-gates-refuse-a-bad-clip.test.ts:149`)
and returns a report (`:206`), and its own header records that it tests no real compiled clip, no
runtime smoke and no production tolerances (`:428`).

The binding rule: promotion refuses unless it receives an accepting report bound to the compiled
artifact. **If only one binding field survives, require the digest of the exact artifact containing
the tracks, recomputed by the promoting step over the bytes it packs.** `compiledClipId` excludes the
tracks, rig identity can be self-described, and both version strings are labels.

That still does not establish honest measurement. Every gate input is a caller-supplied claim:
achieved and target positions, contact points, maximum flexion, one separation number, frame counts,
and a `runtimeLoadedClipName` string. An adapter can emit zero motion and report all of them
consistently. Honest measurement needs independent derivation from track samples plus coverage
invariants: expected effectors present, expected contact windows present, every track sampled, and no
empty-set pass.

## The discriminating test, whichever path is taken

An import is not a consumer. The test is a load-bearing-artifact mutation:

1. Run one real bank case through `runCaseChain`.
2. Require the producing row to list its artifact.
3. Feed that exact artifact into the consuming step.
4. Delete it, or corrupt its identity.
5. Require the consumer to classify `error` and publish nothing.
6. In the valid control, load the published bundle through UI-XR and observe the gesture fire for a
   touch row.

If deletion leaves the station table and the published bundle unchanged, the artifact is a report
nobody reads.

## Open decisions

- **Posture authority.** The motion planner treats absent authored placement as standing
  (`compile-scenario-motion.ts:162`); D9 derives runtime posture later in `staging_placement`
  (`multi-case-runner.ts:751`); the schema says authored placement must never be inferred
  (`schemas.ts:141`). Feeding generated posture back into authored compiler input violates that.
- **Contact tolerances.** Compiler constants versus expanded authoring. The tree cannot settle it.
- **Candidate-to-promotion order**, if the DSL path is taken: steps 7 to 9 above.
- **Whether offline case-authored animation generation is a product requirement at all.** This is the
  decision the recommendation turns on, and it is the operator's.

## Execution trap, for whichever card touches this package

A `live:` rule on any `motion-compiler` test passes vacuously. The package uses a `planted()` wrapper
(`src/planted.ts:34`) that is `it.fails` normally and `it` under `OPENCLINXR_PROBE_REDS=1`, which is
strictly better because it proves each RED fails for its recorded reason. But `countPlantedItFails`
(`agent-loop/src/done-when-live.ts:20`) counts `it.fails(` call sites and reports 0 for every one of
these files while six REDs are live, and the board's brief-time check uses an independent raw regex
(`tools/openclinxr/openclaw/board-brief.ts:261`), so it is blind the same way.

`run:pnpm --filter @openclinxr/motion-compiler probe:reds` is the right fingerprint and coverage
gate. It is **not** a completion gate: it exits 0 while reporting 6/6 still RED. A card needs both
that command and an explicit assertion that its own target clauses are gone. The durable fix is to
teach the shared scanner the registered `planted(...)` form through the AST discovery `probe:reds`
already uses. An existing slice brief already carries the vacuous combination
(`.openclinxr/slices/bothy-tsk_ee30a00193f46e5e/brief.json`).

## Not tested

Whether Blender overwrites or suffixes a same-named action on re-bake; whether the stage-rig and
`world_compile` GLBs reproduce the same rig fingerprint and profile hash, which is the first
integration test the DSL path would owe; whether the seven gates as specified suffice for production
acceptance; the wall clock of per-row compilation across the bank; and whether any producer of an
`animation_clip_manifest` exists outside the paths grepped here.

Separately found and unrelated: `the-llm-planner-cannot-emit-bone-tracks.test.ts:470` fails for real.
`6d51728e` made `evaluateScenarioPublicationReadiness` require an `attestationVerifier` whose absence
credits no reviewer role; the motion test passes none, so its known-good column blocks. Recorded here
only because it will confuse the next person who runs this package's suite.
