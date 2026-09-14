# Current-actor comparison proposal (conditional; not authority)

Not a bake-off winner and not permission to capture. Owner releases MR-02 only after MR-01 review
and the open decisions that would make a fair experiment.

## Jobs (compare separately)

1. **Static authored rock-plus-clutch and actual pulse presentation** on the current supported MPFB actor.
   Both arms need real behaviour/goal definitions and valid seat/rest/support.
   A missing pulse goal must not count as pulse success (`report.json` already records that omission).
2. **Moving simulated target** in the isolated harness (D3). Probes live-target response.
   A baked-only miss here is not a global backend loss. No production learner grasp.
3. **Bounded correction over a recorded clip**, only if catalog coverage and rights allow.
   Deterministic selection + inertialized transitions before matching.
   LaFAN1 NC/ND is ineligible for unrestricted adoption.

## Bindings

Actor bytes, canonical rig/bone map, geometry, rest, proportions, joint limits, descriptor
schema/data, support, harness, source revision, event sequence, seed, explicit clock/deltaMs.
Changed capability/rest/geometry invalidates goals even if JSON survives.

## Metrics (engineering, predeclared later)

FK positions, joint interior angles, limb lengths, residual, contact normal/clearance,
support/floor for that posture, transition validity, skin deformation, native sequences.
Residual zero alone cannot pass. Do not invent clinical ROM or copy standing-foot thresholds
onto arm contact. Missing behaviour / identity mismatch / invalid geometry => inconclusive.

## Resource fence

Own worktree, evidence dir, ports. Coordinate GPU/browser with Planted floor
`tsk_a775eb9e466328a0` and SC-07 r2 `tsk_93b6e2aa66b6c3fa`. Frozen scene-closure acceptance
stays frozen. No public marketing.
