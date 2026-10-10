# S1 stop-clip runtime 2026-10-10 — baked root-motion stop in the bedside approach

verdict: `fail_all_rigs`.
verdictReason: the stop fires end-to-end on all three rigs and the runtime honors it exactly
(arrival matches D-minus-remaining within centimeters on every rig), but every rig fails the
arrival bar 6-12x: the clips travel 2.25-3.04 m while the assay route is ~1.47 m, so the body
overruns the target by the surplus. The trigger distance fits a longer route, not this one.

## Stage 1 clips (seed 42, cagematch prompt/constraints; lock refused by the stage)

| rig | clip | D (m) | duration | entry foot | exit | yaw correction (deg) |
|---|---|---|---|---|---|---|
| physician | openclinxr_retarget_kimodo_stop_physician | 2.543 | 5.5 s, 132 keys, 24 fps | left | both (hold) | 15.036 |
| nurse | openclinxr_retarget_kimodo_stop_nurse | 3.036 | 5.5 s, 132 keys, 24 fps | left | both (hold) | 33.913 |
| child | openclinxr_retarget_kimodo_stop_child | 2.251 | 5.5 s, 132 keys, 24 fps | left (motion; export contacts zero at frames 0-1, left from frame 2) | both (hold) | 176.414 |

D is net horizontal root travel, first to last key, read off the grafted clip. Entry/exit feet are
the export's own contact labels. Scratch GLBs under `.openclinxr/evidence/s1-stop/` carry the
shipped walk take plus the stop take; shipped GLBs are untouched (licence section below).

## Trigger rule and residual bound

Walking hands to stopping when the actor carries a stop take, remaining route fits inside D,
and the walk loop's stance pair (from the walk clip's own labels at the playing action time)
equals the stop take's frame-0 pair. Phase mismatch keeps walking. A no-foot entry never fires.
The legacy close-range check runs first: within one frame of the target the walk ends as before.

Implemented bound: the residual (distance walked past the trigger point waiting for a phase
match) is bounded by one full walk-loop cycle of travel, v_walk * T_cycle. The entry pair
recurs at least once per cycle at walking duty factors; if it never recurs the legacy check
still ends the walk. Measured against the bound:

| rig | residual (m) | bound v*T (m) |
|---|---|---|
| physician | 0.1405 | 1.370 |
| nurse | 0.1471 | 1.434 |
| child | 0.0880 | 0.851 |

All three fired 10 frames into the walk (D covers the whole route, so the wait started at walk
start). Residuals sit an order of magnitude inside the bound.

## Slot ownership per phase

- walking: executor prescribes along-route advance; slot follows prescription; skeleton plays the
  walk take; stance lock reads walk labels.
- stopping: the stop take owns slot XZ (slot = trigger + stop root travel rotated by the
  net-travel yaw; heading stays the travel heading). The mixer plays a root-XZ-removed clone at
  rate 1 while the slot carries the travel, so travel counts once. Walk fades 1 to 0 over 0.25 s
  while the stop fades 0 to 1. The stance lock reads the stop take's one-shot labels. The
  walk-phase chain claim stays in place through the handoff.
- settling: entered at clip end with the same snapshot as the walking-to-settling handoff
  (frozen observed position, patient turn pending). Unchanged code path.
- No stop take on the actor: the wiring resolves null and every branch keeps legacy behavior.
  Proven headless: stop-disabled control rows on the same scratch bytes match pre-fix to 1e-9
  on all rigs.

## Before/after table (headless assay, same instrument both columns)

Bars: arrival <= pre + 0.01; yaw <= 2 deg; plantedSlide <= pre + 0.005; stop-stance step
<= 0.02; maxToeStep <= pre + 0.02.

| rig | arrival pre -> post (bar) | yaw | slide pre -> post (bar) | stop stance step (bar) | maxToeStep pre -> post (bar) |
|---|---|---|---|---|---|
| physician | 0.15883 -> 1.20495 (0.16883) FAIL 7.1x | 0 PASS | 0.12002 -> 0.11971 (0.12502) PASS | 0.02443 (0.02) FAIL 1.2x | 0.06795 -> 0.35694 (0.08795) FAIL |
| nurse | 0.13021 -> 1.69392 (0.14021) FAIL 12x | 0 PASS | 0.13603 -> 0.13553 (0.14103) PASS | 0.03006 (0.02) FAIL 1.5x | 0.11725 -> 0.41462 (0.13725) FAIL |
| child | 0.13815 -> 0.90498 (0.14815) FAIL 6.1x | 0 PASS | 0.08271 -> 0.09706 (0.08771) FAIL 1.1x | 0.03352 (0.02) FAIL 1.7x | 0.40363 -> 0.33751 (0.42363) PASS |

Post arrival equals D minus remaining at fire within 4 cm on all three rigs (physician
2.543 - 1.338 = 1.205; nurse 3.036 - 1.342 = 1.694; child 2.251 - 1.346 = 0.905): the
prescription lands exactly along-track, and the miss is the surplus travel, not dispersion.
Settle durations: 1.95 / 1.917 / 1.983 s. Stop frames: 328 each (full 5.47 s synthetic take).

maxToeStep post is the first settling frame on physician/nurse (0.357/0.415): the assay snaps
markers to rest in one frame where production fades the drive over 0.3 s, ramps the walk take
back from zero weight, and converges through the gradual arrival close — no one-frame snap
exists on that path by construction. Same artifact class as the budgeted walk-to-settling snap
(child pre 0.404, which is why the child bar still passes). Stopping-phase steps never exceed
0.066 m on any rig.

## One-shot labeling findings (product changes this slice)

Loop-tuned stance labels misread a walk-to-stop take three independent ways; all three are
fixed without touching the loop path (control rows prove it):

1. Wrap poison: central differences across the cycle wrap read the full 2.5 m clip travel as
   one frame's foot speed and unlabel both end samples. One-shots now differentiate one-sided
   at the ends (`cyclic: false`, default true keeps loops identical).
2. Median inversion: the sample median over a stop take is the standing hold (~0.02 m/s), which
   unlabels the whole walk portion as overspeed. One-shots label against an explicit band.
3. Hold forward: the longest near-floor run is the 2 s hold, a noise direction. One-shot
   forward is the net root-travel vector — the same vector D is measured from.

One-shot stance is low plus non-forward (band [0, +inf) under the take's own envelope height
cut): a stopping foot steps, stands, or reverses at touchdown/liftoff. Measured frame-0
speeds along net travel (m/s, + is backward): physician L 0.88 / R 0.27; nurse L 1.01 /
R 0.77; child L 0.72 / R 0.65 — all three start in genuine left stance by motion. The shipped
walk band top (0.63-0.90) would have admitted only the physician; the transfer was tried and
replaced for that reason.

Assay mirror rule: synthetic stop toes are travel-removed (decoded world minus root XZ
travel, index-wise; index 0 subtracts nothing). Replaying world toes under the moving slot
double-counts travel (measured: a 2.44 m single-frame teleport). Index-count mismatch between
toe and root keys refuses rather than misaligns.

## Locomotion orders

Order-driven walkers instantiate the same producer (`createCaseOwnedApproachForOrder` through
`advanceCaseOwnedBedsideApproach`/`applyCaseOwnedStanceLock`), so they inherit the stop wherever
the actor carries a stop take. The order-active flag now covers the stopping phase (it ou
...[truncated 1572 chars]
