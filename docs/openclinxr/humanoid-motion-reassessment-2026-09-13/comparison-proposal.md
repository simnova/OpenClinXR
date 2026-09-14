# Current-actor comparison proposal (conditional; not authority)

Not a bake-off winner and not permission to capture. Owner releases MR-02 only after MR-01
independent review and the open decisions that would make a fair experiment. If a measurement
will not change a decision, document why and omit it. Omission does not imply the product
capability exists.

Failed treatments that must not be retried as a false fix:

- Historical bake-off verdict `other`: neither clutch succeeded; runtime pulse descriptor had
  no pulse goal. That cannot justify naming `baked_tracks` or `runtime_goals` a winner.
- Editing digest hashes after a later actor rebake. Bind live bytes; recapture produces a new
  report and a new review.
- Keyword/existence/source inspection as a substitute for owner claim-to-consumer review.

## Jobs (compare separately)

1. **Static authored rock-plus-clutch and actual pulse presentation** on the current supported MPFB actor.
   Both arms need real behaviour/goal definitions and valid seat/rest/support.
   A missing pulse goal must not count as pulse success (`report.json` already records that omission).
2. **Moving simulated target** in the isolated harness (D3). Probes live-target response.
   A baked-only miss here is not a global backend loss. No production learner grasp.
3. **Bounded correction over a recorded clip**, only if catalog coverage and rights allow.
   Deterministic selection + inertialized transitions before matching.
   LaFAN1 NC/ND is ineligible for unrestricted adoption.

## Per-job required owner decisions (release gates)

A proposal with unresolved posture/schema/contact/tolerance authority is not dispatch-ready.

| job | required owner decisions before that job may run | omit if |
|---|---|---|
| 1 rock-plus-clutch + pulse | `open-decision-posture-field`; `open-decision-rock-frame`; `open-decision-ik-blend` (full-design-2026-09-02.md:107-110 and :327, not harness.html:370 apply-site); `open-decision-tolerance-authority`; valid seat/rest/support geometry named; pulse goal actually present in the descriptor; live actor/report identity `current-actor-bound` (rebind, do not hash-edit); harness joint/rest/limit identity recorded | owner records that static presentation will not change a retained decision |
| 2 moving simulated target | job-1 identity bindings plus explicit clock/deltaMs and event sequence; confirmation this is an isolated-harness probe, not production learner grasp; physics-touch fence stays down | owner records that live-target responsiveness is not a decision driver |
| 3 bounded clip correction | `catalog-transitions` coverage and rights; `open-decision-cooperation-join` / provenance if cooperation limits are in play; pass order, root authority, contact windows named; deterministic selection/inertialized-transition baseline before matching; no NC/ND datasets | catalog coverage or rights are insufficient; matching remains unproven |

Shared owner gates for any released job: `open-decision-station-topology` and `open-decision-package-adapter` stay unresolved here and must not be decided by the comparison worker. `physics-touch-fence` stays policy unless separately lifted. Provider eligibility stays unknown; no GMR/Kimodo/ARDY/Holden adoption.

## Bindings

Actor bytes, canonical rig/bone map, geometry, rest, proportions, joint limits, descriptor
schema/data, support, harness, source revision, event sequence, seed, explicit clock/deltaMs.
Changed capability/rest/geometry invalidates goals even if JSON survives.

Current live identity (must be re-measured at MR-02 plant, not copied from this proposal):
report actor `b744d3d5…`, disk `8409334c…`, classification `identity-stale`.
MR-02 must fail closed on identity-stale rather than proceed on retained stills.

## Metrics (engineering, predeclared later)

FK positions, joint interior angles, limb lengths, residual, contact normal/clearance,
support/floor for that posture, transition validity, skin deformation, native sequences.
Residual zero alone cannot pass. Do not invent clinical ROM or copy standing-foot thresholds
onto arm contact. Missing behaviour / identity mismatch / invalid geometry => inconclusive.

Keep original controls and all failed runs. Record paired pinned inputs and separate verdicts
per job. Missing behaviour, identity mismatch, invalid geometry or insufficient observations
produces inconclusive/failure, never an inferred winner.

## Conditional release

MR-02 is created only if:

1. Owner independent review of MR-01 is `accepted` with claim-by-claim record and output hashes.
2. Every required owner decision for the chosen job is recorded (not left unknown).
3. Input identity, metric definitions, resource fence, and rights feasibility are established.
4. The measurement could change a retained/reopened decision.

MR-03 leaves are created only from reviewed evidence or an already independently demonstrated
defect. Do not resurrect Idle M-series children under `tsk_784e4714847f900b`.

## Resource fence

Own worktree, evidence dir, ports. Coordinate GPU/browser with Planted floor
`tsk_a775eb9e466328a0` and SC-07 r2 `tsk_93b6e2aa66b6c3fa`. Frozen scene-closure acceptance
stays frozen. No public marketing. No motion implementation in MR-01.
