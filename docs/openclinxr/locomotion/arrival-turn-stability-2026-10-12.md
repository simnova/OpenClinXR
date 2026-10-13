# Arrival turn stability (2026-10-12)

Physician, stepping arrival turn (shipped default), SC-05 bedside scene and the 6 m proving
ground. Verdict: **adopt with limits**. The body-position runaway in the turn is removed and
arrival now repeats; the leg-solver snaps and the bimodal planted-foot yaw are unchanged and
go to their own slice.

## Cause

`advanceSteppingTurn` re-pinned the stance foot on every pass by translating the actor slot so
the stance toe returned to its target (`stepping-turn-execution-mod.ts`, the per-pass pin). The
toe world position it read is a descendant of the slot the same pin moved on the previous
pass, so the correction fed itself. Two identical-build SC-05 runs, traced per frame: yaw and
dip terms differed by exactly 0, the pin carried all slot difference, per-frame gain 3.26 /
1.93 / 1.50 / 2.71. A 0.1-0.2 mm difference at walk start (the capture lets a varying number
of real frames pass before its fake clock holds; a live session has the same jitter) grew to
0.35 m by arrival.

The entry into settling was already bit-identical across runs (clip time 1.4759, labels,
entry yaw 117.2872 deg, residual 62.7128 deg, predicted first swing): the entry-phase and
pivot-choice explanation in `walk-transitions-2026-10-12.md` is refuted.

## Fix

The slot is pivoted rigidly about an anchor taken from the turn plan's own stance value for
the planted window and held in world space (`stepping-turn-slot-pivot-mod.ts`), with no read
of the live skeleton in the slot update. `?steppingTurnLegacyPin=1` restores the old pin for
A/B. The leg hinge reuses the previous bend plane in the near-straight band and holds still
there instead of bowing up.

## Six runs each, same build (control = origin/main 1ed4e6a5b)

SC-05, stepping turn on. "fix" is the landed commit, re-captured by the orchestrator
(`.openclinxr/evidence/settle-entry/verify-sc05-summary.json`).

| metric | control | fix |
|---|---|---|
| lateral arrival error, mean / sd / range (m) | 0.191 / 0.141 / -0.052..0.304 | 0.015 / 0.0002 / 0.015..0.016 |
| along-route arrival error, mean / sd (m) | -0.030 / 0.011 | -0.023 / 0.0002 |
| planted foot | right x5, left x1 | right x6 |
| planted-foot yaw, mean / sd (deg) | -8.7 / 4.9 | -10.6 / 1.3 |
| largest one-frame leg rotation, range (deg) | 16.5..85.1 | 16.5..84.2 |
| stance-foot slide per window, max, range (m) | 0.0005..0.0167 | 0.0013..0.0213 |
| settling duration (s) | 1.567 | 1.567 |

Proving ground (worker capture of the same commit): arrival sd 0.0001 m lateral and along
(control 0.072 / 0.078); mean arrival 0.038 lateral, -0.047 along (control 0.010 / 0.008,
means of a 7 cm spread).

## Limits

- Leg rotation snaps of up to 84 deg in one frame remain and vary run to run (16.5 to 84.2):
  the leg solver itself is still input-sensitive. Three further solver changes were tried on
  branch `settle-entry-solver-iterations` and oscillated (34, 87, 60 deg); none is landed.
- An earlier six-run capture of this same commit read planted foot left in 2 of 6 and snaps
  of 16..34 deg, so six runs under-sample the leg-side variation.
- Mean arrival is 1.5 cm lateral and 2.3 cm along on SC-05: repeatable, not zero.
- Stance-foot slide per window reaches 2.1 cm (control 1.7 cm).
- Not tested: nurse, child, other scenes, 60 fps, headsets.
