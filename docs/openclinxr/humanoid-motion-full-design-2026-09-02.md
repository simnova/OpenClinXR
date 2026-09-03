# Humanoid motion: full functional design

Measured against main `ef8132a1` and `three@0.184.0`, through four adversarial review iterations.
`humanoid-motion-architecture-brief-2026-09-02.md` is the source ledger for the clinical anchors and
is otherwise **SUPERSEDED**: its schema, its `magnitude`-drives-both-things model, its `onDemand`
block, its weighted IK alpha and its "two stages" framing were all rejected here. Do not implement
from it.

**Before committing to per-encounter GLB baking, prove on one content-addressed seated MPFB actor
that a baked-track backend beats a deterministic runtime-goal backend on visible quality, replay and
dark-factory throughput.**

Terms, because the estimates use all four: an **epic** is this document; a **card** is one board item
that lands green and shows a skeptic something; a **lane** is one worker inside a card; a **slice** is
one bounded owner with one principal write root.

## The unproven commitment

Everything below assumes case-authored dynamic behaviour compiles into fixed animation tracks packed
into a per-encounter GLB. That is the part no measurement supports, and there is a materially
different architecture:

| | baked tracks | runtime goals |
|---|---|---|
| artifact | a new GLB per encounter | content-addressed JSON plus a rig capability descriptor |
| rock | keyed pelvis and lumbar tracks | a pelvis oscillator |
| clutch | keyed arm tracks | a hand-to-live-body-region goal with a hold constraint |
| pulse presentation | impossible; the learner hand is not known at bake | a wrist goal relative to the live learner hand |
| invalidation | every actor correction restales the whole descendant chain | the descriptor survives an actor rebake |

The runtime-goal backend removes the per-case packer and most rebake invalidation. It does not remove
the hard half: controller, input lifecycle, IK, contact, rig limits, deterministic replay, visual
grading. **Run the comparison on seated rock-plus-clutch and pulse presentation before authorising
the rest of this document.**

## What kills this, if it dies

Asset-identity churn, not size. Binding motion to actor bytes, rig, proportions, posture, support and
reference rest is correct, and it means every upstream humanoid correction legitimately invalidates
`actor -> seated rest -> additives -> gate report -> packed GLB -> runtime binding -> visual capture`.
Automated rebakes do not automate the human judgment that approves hand placement, chair penetration
and shoulder deformation. Freeze a content-addressed actor revision before each motion milestone and
make invalidation requeue every descendant automatically, or the board will keep turning valid motion
cards back into stale evidence.

## Package boundaries, which constrain everything else

**There is a real dependency cycle and it is not optional to solve.** `shared-schemas` depends on
`@openclinxr/factory-stations`; `motion-compiler` depends on `asset-registry`, which depends on
`shared-schemas`. So `factory-stations -> motion-compiler` closes the loop. The existing
`motion_retarget` station avoids this only because `@openclinxr/motion-compiler` is an inert string
in its plan payload (`factory-stations/src/motion_retarget/run.ts:11`). The adapter therefore runs
across a subprocess or CLI boundary, or it lives somewhere else. Pick one in the card, not at
implementation time.

**Two station systems are not one.** `factory-stations` has its own catalog
(`factory-stations/src/catalog.ts:9`); the D9 chain is a separate hardcoded array with private runner
functions (`multi-case-runner.ts:98`, invoked in order at `:1285`). Adding an entry to the first does
not put it in the second.

**Topology is undecided and the two options are different architectures.** Either an eleventh
terminal station after `world_compile`, or `world_compile` changes to consume and pack the motion
output. Compiling before `world_compile` recreates the measured wrong-file binding, because that
station re-invokes `orchestrate_character.py` and writes a new GLB. One worker cannot own both
options under one set of write roots; decide in the brief.

## Runtime

```
0  motion controller     base state, phase transitions, overlay ramps, goal issue and release
1  mixer.update()        base NORMAL, everything else ADDITIVE at commanded weights
2  support + body facing root plant and actor yaw, BEFORE IK since both move the shoulder frame
3  limb IK               solved from the final shoulder frame, at solver blend 1
4  contact correction    palm orientation and grasp
5  head and eye gaze     only chains genuinely local to the head
```

Body facing precedes IK because `orientHumanoidTowardGazeTarget` rotates the entire actor root
(`main.ts:9106`). The current physics function cannot be pass 4: it loops a precomputed artifact by
wall-clock modulus and overwrites spine, chest, clavicles and upper arms from saved binds
(`apply-physics-bone-transforms.ts:56`, `:67`, `:100`).

### The mixer

One base action in `NormalAnimationBlendMode`; everything else additive at commanded weight. **A
posture transition is the exception**: two Normal base actions crossfading, which is the only place
the one-base rule is relaxed and the controller owns the window. Today every selected clip plays in
Normal at full weight (`main.ts:7557`), which averages, and zero `blendMode` assignments and zero
`makeClipAdditive` calls exist in the repo.

Masking is compile-time: `AnimationMixer` in `three@0.184.0` contains zero occurrences of `mask`.
Additive conversion is against the rest clip, and `makeClipAdditive(targetClip, referenceFrame = 0,
referenceClip = targetClip, fps = 30)` takes `referenceFrame` second, not `referenceClip`.

### IK, and the one thing everyone gets wrong

```
limitedTarget = lerp(startEffectorPosition, requestedTarget, maxCompletion)
solveIK(limitedTarget, blend = 1)
```

**Solver blend stays at 1. Always.** `CCDIKSolver` solves the full target then slerps each joint from
its initial quaternion toward the solved one by `chainBlend` (`CCDIKSolver.js:248`), so a blend of
0.35 is a per-joint rotational blend with no defined relationship to distance along the reach. Ramp
the limited target during approach and release; never ramp the blend.

**The requested arm is not "resolved by weight".** An earlier draft said so and it does not describe
this pass order: the mixer applies overlay weight, then full IK overwrites the chain. Either the
target incorporates the protective pose, or IK output is blended against the pre-IK pose in a
declared later step. Choose in the card; do not leave it as a word.

### Chain ownership

| chain | owner |
|---|---|
| actor root yaw | body facing, pass 2 |
| head and eye | gaze, pass 5 |
| requested arm | IK goal at a limited target |
| other arm | protective overlay at full weight |
| pelvis and lumbar | rock oscillator |

## The motion controller

A motion-policy reducer only. `main.ts` already holds three partial controllers: one-shot clip
ownership with fade and restore (`:6731`), speech lifetime (`:1599`, advanced `:8476`), emotion
interpolation (`:1591`, advanced `:8849`). Those keep their state.

State: posture stable or transitioning with elapsed and duration; per-overlay phase, weight and
target weight; per-chain active maneuver with phase, source, contact id and completion; a monotonic
sequence number. Inputs: the compiled actor-motion definition; ordered runtime events; observations;
and a deterministic `deltaMs` rather than an internal `performance.now()`, so replay reproduces.
Output: one serializable frame command of base weights, overlay weights, an optional body-facing
goal, IK goals, contact goals and trace events.

It replaces rather than joins. `handleClinicalTouch` invokes the clip directly today (`main.ts:6789`)
and must enqueue an event instead. Instantiate beside `emotionExpression` at slot registration
(`:7591`); step it immediately before `mixer.update()` (`:8200`).

### Migration is per actor, as a strangler

Three per-slot modes. `legacy`: only the current executor mutates the mixer. `shadow`: legacy
mutates; the controller consumes the same normalized event and writes to a recording sink, never
calling `clipAction`, `fadeOut` or `play`. `controller`: only the controller mutates.

Tara goes straight to `controller` because she carries no `bodyMechanics.touchResponses`. Touch-
bearing actors stay `legacy` or `shadow` until a later visible card.

The oracle is the observed legacy operation sequence, not a helper both call:

```
touch:   stop, reset, setLoop(LoopOnce,1), clamp, enabled, weight=1,
         fadeOut(exact running non-response action set, 0.1),
         listen(finished, exact action id), play
unrelated finished:  no operation
matching finished:   remove listener, fadeOut(response, 0.12),
                     reset + fadeIn(0.18) + play(exact captured idle set)
```

Counterweights: missing mixer; missing clip; **another response clip wrongly INCLUDED in the restored
idle set** (exclusion is the current correct behaviour, `main.ts:6745`); a `finished` for the wrong
action. Preserve that `handleClinicalTouch` returns true on a region match even when `clipPlayed` is
false (`main.ts:6821`).

The existing browser smoke is not a regression oracle: it accepts `clipPlayed === true`, which a
skeleton that never moves satisfies.

## Authoring — PROPOSED SCHEMA, none of this exists today

`posture`, `protectiveBehavior`, `cooperation` and `examManeuvers` are absent from the closed schemas
(`shared-schemas/src/schemas.ts:288` for actor fields, `:472` for scenario root). The blocks below are
proposals, and each needs a discriminated union with required, optional and forbidden fields per
pattern before a worker sees it.

**Posture has no canonical field yet.** `ActorCardSchema` carries `placement`, not `posture`; the
compiler derives posture from `placement.supportSurface` (`compile-scenario-motion.ts:162`); runtime
environment and scenario rules override the declared value (`actor-posture.ts:130`). Choose one
canonical field and state whether support is a consistency constraint or a derivation input. An
earlier draft asserted "stated on the actor and nowhere else", which is false in both the current and
the proposed model.

```yaml
protectiveBehavior:                 # one pattern per block; rock and clutch share nothing
  - pattern: clutch
    scheme: { system: keefe, version: 1982, code: rubbing }
    site: abdomen_epigastric        # the ComplianceRegion enum, verbatim
    effectors: [handR]
    expression: 0.7                 # overlay weight only
  - pattern: rock
    scheme: { system: emopain, version: 2016, code: guarding }
    axis: sagittal                  # frame UNDECIDED
    periodSeconds: 2.4
    amplitude: ???                  # expression is weight, not amplitude — UNDECIDED
    expression: 0.5

cooperation:
  default: full                     # full | incomplete | refuse
  byManeuver:
    radial_pulse|right:             # key join rule UNDECIDED; do not invent one
      outcome: incomplete
      maxCompletion: 0.35           # fraction of the reach path, authored
      hesitate: true
      returnToProtect: true
```

`expression` is how visible a behaviour is; `cooperation` is how far the patient goes when asked. No
numeric relationship between them is asserted, and `incomplete` without `maxCompletion` or
`maxAngleDeg` refuses at compile. The earlier `ceiling = 1 - magnitude` was invented and is deleted.

`maxCompletion: 0.35` has no approved provenance. The scenario review block is four status fields
(`schemas.ts:477`) and does not record authorship of a number. Treat that value as UNVERIFIED until a
faculty authoring path exists.

Scenario root carries only the binding — maneuver id, patient actor, side, tool role, trace tag — and
the maneuver PROTOCOL lives in a versioned catalog, not in cases. Cooperation modifies transitions
and adds two states, `limited_hold` and `refused`, which must appear in the chart rather than as
prose.

**The input seam does not exist.** `main.ts` has exactly one `addEventListener("select")` (`:5424`)
and no grasp start, update, end or contact-loss stream. Every `release` and `aborted` transition is
fiction until that lands.

### The derivation boundary

Author states site, laterality, pattern, expression and cooperation limits. The system may derive
EMOTE Effort from demeanor, breathing rate from phenotype, facial expression from emotionPolicy. The
system may never derive a pattern from demeanor, emotion or phenotype: a gastroenteritis case and a
peritonitis case must not share a derived clutch.

`TouchResponse.responseKind: guarding` overloads the Keefe motor pattern and abdominal wall rigidity
(SNOMED `249545003`). Split before reusing the word.

## Compile defects that block lowering today

- `clutch_body_region` ignores `site` (fixed delta, no region anchor, `:17`; site survives as a label
  at `:121`) and ignores intensity, so `expression` would not alter it.
- It reads scalar `skeletonProfile.effectorBone` rather than the action's effector (`:68`), as does
  `guard_body_region` (`primitives/guard-body-region.ts:94`).
- **Units:** primitives emit MILLISECONDS (`clutch-body-region.ts:91`) while the composer copies the
  maximum into `durationSeconds` (`compile-motion-program.ts:149`).
- Duplicate tracks are appended and sorted (`compile-motion-program.ts:112`); the validator that
  knows they are ambiguous (`canonical-motion-contract.ts:132`) is never called by composition.
- `passive_rom` and `positioning` lower to `brace` and `posture_shift`, neither in `PRIMITIVE_IDS`.

## Execution

### Two cards, and the split is forced

| card | exclusive write roots | requires | acceptance |
|---|---|---|---|
| A: factory to final GLB to Model Vetting | the motion station under its chosen package, controlled edits to the D9 chain, `tools/openclinxr/factory/motion-*`, Model Vetting playback and evidence | nothing | station artifact digest equals the digest Model Vetting loads; composited base plus additive shows upper-body motion with stable chair contact |
| B: final GLB to controller to UI-XR | `apps/ui-xr/src/humanoid-motion-controller.ts`, controlled `main.ts` integration, `humanoid-runtime-asset-url.ts`, asset-registry casting and bundles, runtime evidence | A | station artifact digest equals the digest ordinary UI-XR loads for `parent_tara_johnson_v1`; Tara moves while seated and returns to rest; touch still works |

Splitting further orphans: a station-only card produces bytes nothing loads; a path-only card points
at an absent artifact or is bypassed, since the peds parent path is a hardcoded constant
(`humanoid-runtime-asset-url.ts:75`) and casting wins over fallbacks (`:417`); a shadow-only card
changes no visible behaviour. Publication additionally asserts `learnerRuntimeUseEnabled: false` as a
literal (`publish-generated-learner-runtime-bundle.ts:35`, `:112`), so delivery is gated by design.

Card A holds three lanes against one frozen station output schema — Blender rest and additive
materialisation, D9 integration, packer plus composited evidence. **That schema is undefined**:
filenames, path rules, actor multiplicity, manifest version, digest algorithm, rig and rest
identities, gate report shape, error semantics, and which GLB is "the sole final" all need deciding
in the brief.

**Model Vetting needs work before card A can prove anything.** It selects one clip and plays one
`AnimationAction` (`model-vetting-studio/src/candidate-capture.ts:328`), so it cannot demonstrate
base plus overlay, and its own claim scope is isolated-model evidence.

### The clause that catches a green-and-empty landing

The likely false success is a moving GLB that Model Vetting plays while UI-XR still loads the
checked-in candidate, citing the seated policy test, which only verifies the checked-in file contains
the named clip (`the-seated-parent-is-seated-and-her-clip-plays.test.ts:79`).

> The SHA-256 of the bytes loaded at the card's own delivery point MUST equal the SHA-256 of the sole
> final GLB emitted by the motion station from a clean D9 evidence root. The loaded GLB MUST contain
> the manifest-bound base and additive clip identities. Across live frames the upper-body pose MUST
> change above a stated threshold while pelvis-to-seat contact stays within a stated tolerance, and
> MUST return to the reference rest. Removing or replacing the station artifact MUST make launch or
> capture refuse. Markers, source inspection, `clipPlayed` and checked-in candidates are inadmissible.

Delivery point is Model Vetting for card A and ordinary UI-XR for card B. **The threshold and
tolerance are not stated here on purpose**; a worker choosing its own is the failure this clause
otherwise invites, so they are authored in the brief against a measured control.

### Dependency order

```
A (factory) ─> B (controller + UI-XR) ─> rest identity + delivery ─> posture transitions
                                    └─> compiler repair ─> one protective behaviour end to end
                                                       └─> maneuver protocol + INPUT SEAM
                                                            └─> radial pulse ─> ROM + physics
                                                                             └─> rig expansion
```

Compiler repair is a prerequisite for protective behaviour, not a parallel nicety, because of the
unit bug and the ignored effector. The input seam gates everything from the maneuver protocol
rightward and does not exist.

### Size

About 48 slices, range 40 to 59, NOT TESTED — Blender correction cycles and the rig-by-posture-by-
support matrix are not settled by the tree. Roughly 28 to 34 are unavoidable for the stated
requirement; the remainder is the price of the general solution.

Five visible outcomes carry most of the perceived interactivity: Tara stays seated while speaking and
nodding; palpation produces a region-driven guard without losing dialogue or trace; rocking and
clutching persist through speech; the patient presents a wrist including refusal and incomplete
compliance; passive ROM supports acquire, hold, contact loss, release, abort and return to protect.
Everything invisible rides inside one of those five, never as a product outcome of its own.

## Reproduction

```bash
pnpm --filter @openclinxr/motion-compiler probe:reds      # 6 REDs, each for its recorded reason
pnpm --filter @openclinxr/motion-compiler test            # 1 real failure, see below
node -e '…'  # GLB animation inventory: parse the JSON chunk, list animations[].name
git show ef8132a1:apps/ui-xr/src/main.ts | sed -n '7557p' # the all-clips-Normal line
```

Line numbers in this document are against `ef8132a1` and the tree moves under concurrent agents;
prefer `grep` for the named symbol over a line number.

## Open decisions, none of which a worker may make alone

Posture's canonical field. Station topology, eleventh station or `world_compile` change. The adapter's
package, given the cycle. Rock amplitude and axis frame. The cooperation key join. Whether IK output
blends against the pre-IK pose. The station output schema. Threshold and tolerance values. The
provenance path for authored cooperation limits.

## Not tested

Whether the runtime-goal backend outperforms baked tracks, which is the bake-off above. Whether stock
`CCDIKSolver` joint limits port across the Anny and MPFB2 rails. Whether a seated rest exists or can
be baked for either rail at visual parity. The slice estimate. Whether `ClinicalIdleConversation`
retains visible motion through additive conversion against a seated rest.

**Answered 2026-09-03, see the entrypoint:** a seated rest DOES exist for the MPFB rail — a CC0
Mesh2Motion `Sitting_Talking` bound to the shipped 137-joint rig at `f2e7552f` — and was destroyed the
next day by an unrelated rebake. Card `tsk_ef2f9ee4d551b870`. And on the additive question: no shipped
clip deviates more than 5.73 deg from its own frame 0, so additive conversion against a rest pose has
nearly nothing to preserve. Both were measured across all 89 GLBs, not argued.

Separately: ~~`the-llm-planner-cannot-emit-bone-tracks.test.ts:470` fails for real~~ — FIXED at `e7a92847`. `6d51728e` made
`evaluateScenarioPublicationReadiness` require an `attestationVerifier`; the motion test passes none,
so its known-good column blocks. It will confuse the next person who runs this suite.
