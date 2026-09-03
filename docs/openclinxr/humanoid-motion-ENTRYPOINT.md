# Humanoid motion: cold-start entrypoint

**Read this first. It is the only file you need to open before deciding what to do.** Written
2026-09-02 for a session that has none of the conversation that produced it, possibly on a different
model.

## The one-line state

A complete design exists for case-driven humanoid motion, nothing is built, and **the design's own
headline says do not build it yet** — run a bake-off first, because roughly 48 slices depend on an
architectural choice nobody has measured.

## What the product needs, in the operator's words

> "a catalog of animations baked into the glb that can be transitioned from one to another
> dynamically based on interactions in the encounter … coupled with respond to touch and physics
> would drive full interactivity with the humanoids which includes interactions that don't have
> pre-determined animations (e.g. reaching out to the humanoid to hold their hand to take their
> pulse), but also to account for unique dsl driven animations per encounter (actor rocking back and
> fourth sitting while holding their stomach in discomfort due to a bad stomach ache)"

Three problems, three mechanisms: recorded clips layered properly; live IK for contact nobody can
pre-record; per-encounter compiled behaviour for case-specific idiosyncrasy.

## Where to read, in order

| # | file | status |
|---|---|---|
| 1 | `humanoid-motion-full-design-2026-09-02.md` | **AUTHORITATIVE.** The design, four review iterations, commit `7608ffb3` |
| 2 | `humanoid-motion-architecture-brief-2026-09-02.md` | **SUPERSEDED** except as the source ledger for clinical anchors. Its schema, its `magnitude` model, its `onDemand` block and its weighted IK alpha were all rejected. Do not implement from it |
| 3 | `motion-dsl-consumer-path-2026-09-02.md` | Historical. Its "park the compiler" recommendation was overturned when the operator supplied the requirement above |
| 4 | `blocked-card-unlock-plan-2026-08-31.md` | Unrelated subject, same session. Carries the `planted()` versus `live:` trap that applies to any motion-compiler card |

## Do this, in this order

1. **Run the bake-off.** Board card below. Baked tracks versus a deterministic runtime-goal backend,
   on one seated MPFB actor, on rock-plus-clutch and pulse presentation. A negative result closes it.
2. **Settle the nine open decisions** listed at the end of the design. A worker may not make them.
3. **Then card A**, factory to final GLB to Model Vetting, per the design's Execution section.

## Five measurements that will change your design if you forget them

1. `shared-schemas` depends on `factory-stations`, so `factory-stations -> motion-compiler` closes a
   real dependency cycle. The adapter needs a subprocess or CLI boundary, or a different home.
   **CONFIRMED and sharpened 2026-09-03, plus a THIRD option the design does not list.** The cycle is
   real and tighter than stated: `motion-compiler`'s transitive `@openclinxr` closure is
   `asset-registry, factory-stations, scenario-fixtures, shared-schemas`, so it ALREADY reaches
   `factory-stations`, and `factory-stations -> motion-compiler` is a direct back-edge rather than a
   two-hop chain.
   But the edge that closes it is a **compat shim**. `shared-schemas/src/factory-stations.ts` is 15
   lines whose own header reads *"Compat re-export. Catalog + bakers live in
   `@openclinxr/factory-stations`. Admin cards may keep this import for one cycle."* It is the ONLY
   thing making `shared-schemas` depend on `factory-stations` (2 import lines, one file), and
   `factory-stations` itself has no `@openclinxr` dependencies at all.
   It has exactly TWO live consumers, both the admin cards it named:
   `apps/ui-admin/.../FactoryStationCards.tsx` and
   `the-factory-station-cards-derive-from-schema.test.tsx`. A third consumer,
   `plan-equipment-would-invoke.ts`, already imports from `@openclinxr/factory-stations` directly, so
   the target pattern is in the tree.
   **So the cheapest break is: repoint those two admin files at `@openclinxr/factory-stations`, delete
   the shim, and the cycle is gone** — no subprocess, no CLI boundary, no re-homing the adapter. The
   shim declared its own expiry of "one cycle" and outlived it.
   This stays an operator decision (it is a package boundary, listed under Open decisions), but it is
   now a three-way choice with a measured cheapest option rather than a two-way one.
2. `CCDIKSolver` solves the full target then slerps each joint (`CCDIKSolver.js:248`), so
   `blendFactor` is **not** fractional reach. Limit the target and solve at blend 1.
3. `AnimationMixer` in `three@0.184.0` has zero occurrences of `mask`. Partial-body masking is
   compile-time only.
4. `main.ts` has exactly one `addEventListener("select")` and no grasp lifecycle, so every `release`
   and `aborted` transition in the maneuver protocol is fiction today. **Re-measured 2026-09-03 and
   the absence is POLICY, not an oversight — do not file a card to close it.** `apps/ui-xr/src` has
   **zero** occurrences of `grasp`, `hold`, `release`, `aborted`, `squeeze`, `selectstart` or
   `selectend`; the single `select` listener is an instantaneous tap, so there is no sustained
   contact to begin, hold or end. But `apps/ui-xr/src/static-assets.test.ts:1201` is a LIVE PASSING
   guard — *"enforces physics-touch pre-production fence: no rapier/physics-touch-contract deps,
   static artifact only, promotion false"* — that forbids the runtime from depending on
   `@openclinxr/physics-touch-contract` at all. The grasp semantics DO exist on the domain side
   (`arena/physics-touch-contract/src/scenarios/passive-rom.ts` models a grasped arc,
   `positioning.ts` a guided contact with dwell and release); they are fenced off from the runtime on
   purpose. Wiring them is a fence-lifting decision for the operator, not a slice.
5. Primitives emit track times in MILLISECONDS while the composer copies the maximum into a field
   named `durationSeconds`. A packer trusting the name makes a 900 ms clutch a 900-second clip.

## Two traps specific to this package

**A `live:` rule on any `motion-compiler` test passes vacuously.** The package uses a `planted()`
wrapper, so `countPlantedItFails` reports 0 while six REDs are live. Use
`run:pnpm --filter @openclinxr/motion-compiler probe:reds`, and note that it exits 0 while reporting
6/6 still RED, so it is a fingerprint gate rather than a completion gate.

**~~`the-llm-planner-cannot-emit-bone-tracks.test.ts:470` fails for real~~ — FIXED 2026-09-03 at
`e7a92847`.** `6d51728e` made `evaluateScenarioPublicationReadiness` consult a trusted verifier, which
is correct and deliberately fail-closed; what it left behind was a consumer whose known-good column
still measured the old self-declared behaviour. The clause now supplies a verifier to both halves.
The suite is 65 passed | 5 expected fail. Left here rather than deleted so a reader who remembers the
warning knows it was cleared, not forgotten.

## A seated rest EXISTS on the MPFB rail, and was destroyed — measured 2026-09-03

The design's "Not tested" asks whether a seated rest exists or can be baked for either rail. It was
baked. A CC0 `Sitting_Talking` clip from Mesh2Motion was retargeted onto the shipped 137-joint MPFB
rig — 46 bones driven, 25.875 rad total delta — committed at `f2e7552f` (08-22), and deleted the next
day by `8d7b3f19`, a salvage commit rebaking that GLB for an unrelated phenotype fix. Three later
commits rewrote the file again; none restored it.

`seated_clip_bind_stage.py` works and NOTHING CALLS IT, so any rebake drops the clip permanently.
`the-asset-adjacent-bind-report-names-the-shipped-clip.test.ts` has been RED on main since, unnoticed.
Board card `tsk_ef2f9ee4d551b870`.

Also measured, on all 89 GLBs in the tree: 56 carry an animation, 18 distinct clip names, **zero**
seated or rest clips; the most-shipped posture clip is named `_standing`. Deviation from each clip's
own frame 0 is at most 3.67 deg (Anny) and 5.73 deg (MPFB `ClinicalIdleConversation`), 4 of 137
channels moving, zero translation. The catalogue is near-static poses. `openclinxr_role_parent_anxious_fidget_guard`
at 21.98 deg is the known-good showing that is not a rig ceiling. **The mixer layer converts clips to
additive by subtracting frame 0, so on this catalogue it has almost nothing left to layer.**

## The IK joint limits cannot be checked by any caller — measured 2026-09-03

The design's "Not tested" asks whether stock joint limits port across the Anny and MPFB2 rails. The
CHAIN half was answered and fixed (`c7e85634`: `solveArmChain` now skips the `*02` twist segments, so
MPFB resolves `wrist.L -> lowerarm01.L -> upperarm01.L`). The LIMIT VALUES half **cannot be answered
from the solver's public surface**, and that is itself the finding.

`SHOULDER_BEND_LIMIT_RAD = 2.0` (114.6 deg) and `ELBOW_BEND_LIMIT_RAD = 2.7` (154.7 deg) are applied by
`clampBend(u, eHat, ...)` — the angle between the solved WORLD direction and the REST direction, not a
clinical joint ROM. `SolvedArmPose` returns only `shoulderLocal`, `elbowLocal` and `wristLocal`: three
node-local quaternions, no world directions, no effector position, and no signal that a clamp fired or
that reach was degraded.

**A proxy will mislead you here, as it misled me.** Sweeping 504 targets over the reachable volume of
the shipped MPFB rig gives `max shoulderLocal 176.5 deg` against a 114.6 deg limit, which reads as a
clamp that never binds. It is not the same angle: `shoulderLocal` maps `eHat` onto `uLocal` in the
PARENT frame, while the clamp constrains `u` against `eHat` in WORLD space, and the two differ by
`parentQ` whenever the parent is rotated. The measurement is real and it does not answer the question.

What would settle it: expose whether a clamp fired (or the residual reach error) on `SolvedArmPose`, or
run forward kinematics in the test and compare the effector's world position against the target for
targets known to be within arm's length. Until one of those exists, no caller and no test can tell
whether these limits ever bind, which is a testability gap rather than a known defect.

Not carded. The limits may well be fine; nothing here shows otherwise.

## What the clinical research settled

Do not derive a pain behaviour from demeanor, emotion or phenotype. A gastroenteritis case and a
peritonitis case must not share a derived clutch. The vocabulary already exists in Keefe & Block
(1982), EmoPain (hesitation: movement broken into stages) and CPOT (muscle tension 2: inability to
complete). Anchor the schema on those rather than house enums. Sources are in document 2.

A live defect this surfaced: `TouchResponse.responseKind: guarding` overloads the Keefe visible motor
pattern and abdominal wall rigidity (SNOMED `249545003`), which are different findings and one of
them is a teaching point.

## How this was produced, so you can judge it

Four adversarial review iterations on codex (`gpt-5.6-sol`, thread
`01a05836-f239-75e3-8420-d7ab012a82db`, resumable with `codex exec resume`), plus one Grok deep
research pass (`grok-4.6` with `--tools web_search,web_fetch`; `grok-4-multi-agent` refuses
client-side tools without beta access). Every claim the reviewers made was re-measured against the
tree before it entered a document; the ones that did not survive are recorded as withdrawn.

The design reversed twice. It first recommended parking the compiler, then adopted a three-layer
split, then had that split refuted on four counts. Treat its current form as the fourth draft, not
as settled truth.
