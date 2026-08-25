# Post-mortem: four commits polished an asset nothing loads, and two reviewers confirmed it

**Date:** 2026-08-25 · **Raised by:** operator · **Authors:** orchestrator (Claude) + peer reviewer (codex gpt-5.6-sol)

> The shortest honest summary: **we verified the answer without verifying that the question belonged
> to the product.**

## 1. What happened

On 2026-08-24, between 19:21 and 23:28, four commits improved
`apps/ui-xr/public/generated-humanoids/peds_fever_patient_child.glb`.

| time | commit | slice |
|---|---|---|
| 19:21 | `3dd48fa2` | #653 provenance — **emitted the asset as a side effect** |
| 20:36 | `8acada40` | #656 garment hem weld |
| 22:06 | `a0558484` | #659 shoe sole-plane anchor, foot-outside 0.378 → 0.000 |
| 23:28 | `5a7b3460` | #660 flat sole strip |

That asset is referenced by **no runtime source**. A whole-repo grep finds only its own sidecars,
three model-vetting staging reports, and three evidence contracts. `humanoid-runtime-asset-url.ts`
and `actor-casting.ts` never name it. No learner has ever loaded it.

Nobody chose to create it. `3dd48fa2` was a provenance slice; running the bake dropped a new
Anny-derived GLB into learner-public storage, and three contracts latched onto it as a hardcoded
subject list — `a-shoe-contains-the-foot-it-is-on.test.ts:106`,
`a-generated-shoe-has-a-sole.test.ts:120,143`, `a-generated-garment-is-not-full-of-holes.test.ts`.
Both shoe contracts label it the "GENERATED" rail in their own header tables, so the authors were
rail-aware and still picked instances the runtime never resolves.

## 2. The direction already existed, in the canonical state file, in the operator's own words

This is the sharpest fact and it removes any defence of ignorance. `PROJECT_STATUS.md:83`, dated
2026-08-14, ten days before these commits:

> **DIRECTION 2026-08-14 (Patrick): MPFB2 IS THE LEARNER RAIL THROUGHOUT.** Anny stays as reference +
> comparator only — do not delete it, **do not polish its eyes/arm-weights/shoes**. […]
> **NOT assigned: #3 Anny blob shoes (those actors leave the rail)**

Two of the four commits polished Anny shoes. The instruction was canonical, current, and specific to
the exact artifact class, and neither reviewer consulted it.

## 3. How it escaped the orchestrator

I verified #659 by hand as duty-3 work, because the supervisor audit structurally cannot see closed
cards (#657). I measured the geometry from the shipped GLBs, found my **first probe was wrong** — I
matched the whole foot band against the left shoe only and got a spurious 0.500 — corrected it, got
0.000 on both actors, and declared the close correct. I then cited that landing as evidence of the
peer orchestrator's competence.

I never ran the one grep that shows the asset has no consumer.

Correcting the first probe almost certainly made this worse. It raised my confidence in the second
result without changing what the result was *about*. I improved the precision of a measurement whose
premise I had never examined.

My own skill file carries the rule I broke. `measure-before-claiming` says *"loaded is not rendered
and rendered is not correct"* and *"a name match is a marker check"*. I applied neither to the
question of whether the subject mattered.

I also own an upstream defect: my #652 retirement contract used
`resolver.includes(name + ".glb")` — a string search over the resolver's **source text** — as its
completion oracle. It could go green after deleting literals while proving nothing about
reachability. Corrected in place at `2d7a65bb`.

## 4. How it escaped the peer reviewer

Asked to verify #659's claim, it independently parsed the GLBs, recomputed the vertex counts,
reported 0/2166 and 0/2162 outside, cited the contract lines and the merge artifact, and concluded
*"leave #659 closed for its numeric contract."*

In its own words: *"I did not independently verify #659 as product work. I independently verified one
operand of its claim."*

The contract itself disclosed the gap. Its `claimScope` is geometry on four named assets, with
runtime appearance explicitly excluded. The reviewer read that boundary as permission to stop rather
than as a reason to refuse product closure. The defensible verdict was available and was not given:
*geometry VERIFIED on the named artifact; learner reachability NOT TESTED; this cannot support
product closure.*

**My framing contributed.** I asked "is this number right", which is a question about an operand. A
supervisor verification has to challenge the premise of a metric, not reproduce it.

## 5. Why every gate passed

Five gates ran on all four commits and every one was green. They were multiple but **not
independent**: each accepted a self-description of product relevance — a path, a declared factory
step, or an attached local proof. None consulted the learner consumer graph.

| gate | what it established | structural blind spot |
|---|---|---|
| pre-commit architecture / alignment / post-slice | required structure, coordination consistency, staged-path policy | no public-asset-to-runtime-consumer invariant |
| dispatch | brief had valid factory vocabulary and executable `done_when` | trusted the brief's declared subject |
| product-lane gate | a changed path matched a product prefix | equated "stored under a product directory" with "consumed by the product" |
| merge-kill | diff nonempty, proofs attached, no suppression | verified proof integrity, not whether its subject was in the live population |
| diff classification | changes under `apps/` classified as product | filesystem location stood in for runtime reachability |

The four briefs were Q5 slices whose completion condition was essentially "run this local evidence
test and modify this generator". They proved exactly what was asked. The request contained the wrong
population.

## 6. The class was already documented, with its own regression test

This is not a new failure mode and not a knowledge gap.

`the-waist-gate-covers-the-shipped-cast.test.ts:5` opens with:

> **`garments-meet-at-the-waist` passes 4/4 on main and measures ZERO of the nine shipped actors.**

Same shape, found earlier while grading #542, from two hardcoded ids. `PROTO_VERIFY_DELEGATION.md`
already states the general rule: *whenever a check names its subjects explicitly, that list is the
thing that will be wrong later.*

So the repository held the doctrine, a prior regression test for this exact class, a live-cast
enumerator, and the retirement direction — before any of these four commits. **This was an
enforcement and review-discipline failure, not a missing-knowledge failure.**

## 7. Other live instances

Measured 2026-08-25. Assets exercised by contracts with **zero** runtime source references:

| asset | contracts | bytes | named as a fixture? |
|---|---|---|---|
| `mpfb-gown-inspect` | 11 | 15,688,336 | yes, `-inspect` |
| `peds_fever_patient_child` | 4 | 6,471,224 | **no** |

The naming convention is the distinguishing feature: an `-inspect` asset announces itself as a
fixture, and `peds_fever_patient_child` is named like a cast member, which is why four commits
treated it as one.

Reachability is stricter than reference-counting, and by that measure more contracts are aimed off
the live cast:

- `a-garment-deforms-like-the-body-under-it.test.ts:49` uses `adult_male_street_casual.glb`; the live
  street cast resolves to MPFB.
- `shoulder-raycast-coverage.test.ts:115` labels `peds_anxious_parent` and `peds_nurse_kevin`
  **PRODUCT**; learner casting resolves the MPFB parent and nurse.
- `the-baked-visemes-are-reachable.test.ts:82` calls `mpfb-peds-parent-aisha.glb` the shipped parent;
  the runtime loads `mpfb-peds-parent-aisha.motion-bind.glb` (`humanoid-runtime-asset-url.ts:83`).
  A latent false-green — the base can pass while the asset learners load drifts.
- `a-case-authored-iris-reaches-the-shipped-asset.test.ts:82` has the same base-versus-motion-bind
  mismatch.

Invoking the cast resolver over the shipped scenarios yields nine unique live paths, eight of them
from a directory holding nineteen GLBs. **Eleven public GLBs were learner-unreachable in that
enumeration.** That is not eleven defects — some are deliberate comparators and intermediate bases —
but it is proof that the directory name cannot be used as a product oracle.

## 8. The fix

Not another gate. One independent source of truth — actual runtime reachability — inserted into the
gates that already exist.

A `runtime-humanoid-reachability` invariant in the architecture suite, which the pre-commit runner
already invokes with the staged paths. It would have failed `3dd48fa2` at 19:21, because the newly
emitted GLB resolves to zero shipped actor tuples, and it would have failed #656, #659 and #660
independently.

With that in place, product-lane credit becomes unavailable for an unreachable learner-public asset,
merge-kill can consume the same result instead of approximating it, and a geometry proof on a
candidate asset can still exist without masquerading as learner-product progress.

## What each of us should stop doing

**Orchestrator:** stop treating a commit whose subject is a learner-unreachable asset as product
progress, and stop accepting a source-text search as a completion oracle.

**Reviewer:** stop reproducing a metric without auditing how its population was selected, and when a
contract's `claimScope` excludes the product question, say so as a refusal rather than treating it as
permission to stop.

**NOT TESTED:** whether the eleven unreachable GLBs are individually justified. The enumeration is
measured; the per-asset judgement of deliberate-comparator versus orphan is not.
