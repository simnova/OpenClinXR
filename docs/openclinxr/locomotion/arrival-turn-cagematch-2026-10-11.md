# Arrival-turn cagematch: arrive already facing the patient (2026-10-11)

Verdict: REJECT. No runtime code changed. Evidence: `.openclinxr/evidence/arrival-turn/`
(`control.json`, `geometry.json`, `report.json`).

## Why this slice exists

Across four approaches (walk→stop clip switch, inertialization, Kimodo transition
table, whole-approach takes), the slide that fails every rig concentrates in the
in-place arrival turn. On the SC-05 bedside route (straight, 1.306 m) the actor must
turn 63.6 deg at arrival; the runtime settling turn at that angle slides 0.12–0.14 m
per window, and Kimodo-baked turns drag the pivot foot 0.10–0.25 m
(`approach-take-2026-10-11.md`). Walking straight slides only 0.02–0.04 m
per frame-step. Hypothesis: make the walked path end facing the patient, leaving
little or no in-place turn.

## Prior-art diagnosis (wt/turn-freeze, commits 51c0a26cb, 13f19d313, 2f8080585)

Commit 2f8080585 bent the walked path into a circular arc "from start point+tangent
through the target point" and turned the slot to the curve tangent at each footfall,
pivoting about the planted toe. Measured result: no residual-turn gain (61.6 vs
62.3 deg) and the nurse got worse.

Reconstructed from the live SC-05 intent (start −1.95/1.72, target −0.78/1.14,
chord heading 116.37 deg, target facing 180 deg, required turn 63.63 deg): with zero
bias the construction is degenerate — the target lies exactly on the start-tangent
line, so the circle has infinite radius and the "curve" is the straight line. With
the shipped 0.02 bias the circle has radius 29.4 m and delivers 1.27 deg of the
required 63.63 deg, leaving 62.36 deg residual. A 10x bias increase (0.1) still
delivers only 6.36 deg. An arc pinned by start point + start tangent + end point has
its END TANGENT fixed by that geometry (end tangent 117.64 deg at shipped bias, vs
the 180 deg facing), not by the target facing, so the arrival heading is
unconstrained and the residual turn cannot shrink. The expectation is confirmed:
the arc's end tangent is a geometric byproduct, and no bias value spends curvature
where the facing needs it. Full sweep in `geometry.json` `priorArtArc`.

## Candidate A (control): current main, straight route + settling turn

Headless SC-05 assay (`tools/.../foot-plant/arrival-turn-cagematch.ts`: production
`runApproach` + `computeTurnQuality`; rows bit-identical to the approach-take
`assay.json` CONTROL rows on the same commit):

| rig | residual (deg) | settling slide (m) | whole slide (m) | walk slide (m) | max toe step (m) | arrival err (m) | yaw err (deg) |
|---|---|---|---|---|---|---|---|
| physician | 62.67 | 0.1200 | 0.1200 | 0.0997 | 0.0679 | 0.1588 | 0.00 |
| nurse | 62.15 | 0.1360 | 0.1364 | 0.1364 | 0.1172 | 0.1302 | 0.00 |
| child | 62.95 | 0.0827 | 0.4580¹ | 0.0569 | 0.4036 | 0.1382 | 0.00 |

¹ Whole-run episode anchor spans the walk→settling boundary (max single-frame toe
step 0.4036 m, reproduced bit-identically from the take-assay control). Phase split
is the cleaner read: child max-of-phases 0.0827 m.

## Candidate B: end-heading-constrained curve (Dubins CSC, geometry only)

Minimum radius from the gait: R_MIN 1.3216 m = measured step length 0.6920 m
(walk speed 0.8517 m/s × half the decoded 1625.0 ms clip period) divided by the
per-phase yaw budget SETTLING_CLIP_TURN_MAX_PHASE_RADIANS (30 deg,
`clip-driven-settling-turn-mod.ts:83`). Turn-center Dubins solver, every family
closure-verified to 0.0 mm / 0.0 deg; swept resample every 0.04 m through the
public `bedsideClearanceViolations` (same spacing as `sweptRouteViolations`):

- At R_MIN the shortest closing path is RSL 4.15 m (arc 106.6 deg), deviating
  1.21 m laterally through the stretcher (0.234 m overlap). FAIL on fixtures —
  a violating path is a fail for the rig, not a reason to ignore fixtures.
- Radii 0.75/1.0 m loop the same way (3.72/4.00 m winners, stretcher violations).
- The only compact violation-free fit is R 0.5 m (LSR 1.46 m, lateral 0.28 m),
  but it demands 79.3 deg footfall pivots — 2.6x over the phase budget. Below
  R_MIN is not candidate B; it relocates the in-place turn into two footfalls
  instead of removing it.

## Candidate C: pushback / pre-arrival waypoint (geometry only)

- C1 (start pushed back 0.5/1.0/1.5 m along the entry heading, Dubins at R_MIN):
  winners RSL 5.48/6.56/7.51 m, lateral 1.53/1.77/1.94 m. Only the 7.51 m room
  tour is violation-free. FAIL.
- C2 (waypoint on the facing ray 0.5/0.75/1.0 m behind the target): both legs
  swept-clean at every d, but the corner at the waypoint is 86.1/98.3/109.7 deg —
  larger than the 63.6 deg turn it replaces, and shrinking d degenerates to the
  control. FAIL analytically.

## Decision

REJECT. The room cannot fit an end-heading-constrained curve inside the gait yaw
budget, and the alternatives enlarge the turn they replace. No runtime code was
changed (no flag, no new modules); control rows stand as the known-good column.
Next: the turn slide must be attacked at the settling mechanism itself (per-step
pivot budget vs clip stance windows), not by re-routing the walk.
