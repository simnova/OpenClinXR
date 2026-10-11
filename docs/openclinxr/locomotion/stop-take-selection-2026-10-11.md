# Stop-take selection (sweep 1-8, root-travel yaw fix) — 2026-10-11

## Outcome

NOT SHIPPED. The selected takes engage on all three rigs and arrive at or under
baseline, but whole-run stance slide and stop-window stance step exceed the bars on
every rig. Shipped GLBs untouched; no provenance freeze regen needed; no capture run.

## Why a sweep

S1's distance-indexed stop runtime engages on all rigs with exact prescription, but the
seed-42 Kimodo takes veered (stance-advance yaw corrections 15-176 deg) and the nurse's
lateral veer pulled the stance lock 0.258 m off. One seed per rig was the experiment;
this slice sweeps seeds 1-8 per rig and ships the best by a pre-stated rule.

## Yaw-metric fix (handback correction)

The station measured clip yaw from stance-foot advance, which keys off the longest
contact window — on a one-shot take that is the 2 s hold — and mis-reported yaw by
110-180 deg (nurse seeds 2-4). The station
(`tools/openclinxr/factory/kimodo-loop/kimodo_stop_oneshot_station.py`) now computes
the correction from NET ROOT TRAVEL over the walk+decel span (Hips XY chord in the
exported joint positions, glTF-convention yaw `atan2(dx, -dy)`). All 24 takes bound
single-pass with applied corrections -0.25 to -1.28 deg. Existing takes were rebound
from their `joints.json` via `--skip-generate` (no regeneration); the chord measured
on the bound GLB lands within ~1 deg of convention (foot-lock bake noise).

Selection uses facing error instead of |yaw correction|: mean |wrapped angle| between
pelvis forward (hips/thigh basis, as the bind stage defines it) and the root chord,
over the walk span. Rule, stated before the assay: per rig, minimise facing error
among takes with lateral drift from the take's own chord <= 0.05 m, stance slide
median <= 0.02 m, and runtime wiring engaged; fallback min-lateral-drift, flagged.

## Sweep table

`chordYaw` = bound root chord over [0, 3.2]s (deg). `facingErr` = facing error over
[0, 2]s (deg). `lateral` = max across-track deviation from own chord (m). `slideMed`
= stance slide median via `measure_stop_oneshot.ts` (m). `rMax` = wiring Rmax via
production `runApproach` (m). `*` = selected. Full rows:
`.openclinxr/evidence/stop-takes/sweep.json`.

| rig | seed | chordYaw | facingErr | lateral | slideMed | rMax | trig | sel |
| physician | 1 | -0.48 | 0.96 | 0.0392 | 0.0145 | 2.547 | True | |
| physician | 2 | +0.62 | 0.44 | 0.0714 | 0.0125 | 2.608 | True | |
| physician | 3 | -0.01 | 0.66 | 0.0740 | null (0 windows) | 1.771 | True | |
| physician | 4 | +1.20 | 0.61 | 0.0246 | 0.1125 | 2.410 | True | |
| physician | 5 | -0.19 | 0.67 | 0.0553 | 0.0192 | 2.528 | True | |
| physician | 6 | +0.19 | 0.60 | 0.0490 | 0.2091 | 1.860 | True | |
| physician | 7 | -0.90 | 1.12 | 0.0500 | 0.0185 | 2.393 | True | |
| physician | 8 | -0.80 | 0.92 | 0.0405 | 0.0183 | 1.775 | True | * |
| nurse | 1 | -0.73 | 0.86 | 0.0638 | 0.0092 | 2.888 | True | |
| nurse | 2 | +0.62 | 0.38 | 0.0694 | 0.0055 | 3.107 | True | |
| nurse | 3 | -0.75 | 1.51 | 0.0361 | 0.0062 | 2.152 | True | * |
| nurse | 4 | +0.92 | 0.38 | 0.0124 | 0.0508 | 2.774 | True | |
| nurse | 5 | -0.41 | 0.90 | 0.0325 | 0.2073 | 2.234 | True | |
| nurse | 6 | +0.11 | 0.52 | 0.0511 | 0.2231 | 2.212 | True | |
| nurse | 7 | -0.85 | 1.13 | 0.0560 | 0.0163 | 2.803 | False | |
| nurse | 8 | -0.87 | 0.83 | 0.0512 | 0.0265 | 2.094 | True | |
| child | 1 | -0.78 | 0.91 | 0.0431 | 0.0186 | 1.667 | True | |
| child | 2 | +0.57 | 0.85 | 0.0444 | 0.0040 | 2.308 | True | |
| child | 3 | -0.69 | 1.19 | 0.0203 | 0.0101 | 1.514 | True | |
| child | 4 | +0.63 | 0.46 | 0.0079 | 0.0153 | None | False | |
| child | 5 | -0.39 | 0.65 | 0.0181 | 0.0126 | 1.651 | True | |
| child | 6 | +0.05 | 0.64 | 0.0369 | 0.0117 | 1.641 | True | * |
| child | 7 | -0.77 | 1.10 | 0.0372 | 0.0183 | 1.618 | True | |
| child | 8 | -0.86 | 1.14 | 0.0363 | 0.0154 | 1.656 | True | |

## Selection

- physician seed 8 (facing 0.92; eligible: seeds 1, 8; seed 7 lateral 0.050048 fails the gate strictly).
- nurse seed 3 (facing 1.51; only eligible take — lowest facing takes 2/4 fail lateral/slide gates).
- child seed 6 (facing 0.64; 7 eligible; seed 4 has the lowest facing error but its wiring resolves null so it is not engaged).

No fallbacks; all rigs selected unflagged. Seeds frozen in `sweep.json` (D13).

Notable: physician seed 2 and nurse seeds 2/4 have the lowest facing errors (0.38-0.44)
but curve too much (lateral 0.064-0.071) — the straightness gate binds before facing.
Nurse seed 7 engages its wiring but never triggers in the 12 s run; child seed 4's
wiring resolves null (both excluded by the engaged gate).

## Assay (selected takes, S1 instrument)

`.openclinxr/evidence/stop-takes/assay.json` (stop) and `assay-control.json` (control).
Control rows bit-identical to `post-fix-control.json` (excluding stamps/paths), which
match `pre-fix.json` baselines. Bars against `pre-fix.json`:

| rig | engaged | arrival (<= base+0.01) | resYaw (<= 2 deg) | slide (<= base+0.005) | maxStep (<= base+0.02) | stopStep (<= 0.02) |
| physician 8 | yes (rMax 1.77) | 0.0236 <= 0.1688 PASS | 0.000 PASS | 0.2036 <= 0.1250 FAIL | 0.0861 <= 0.0880 PASS | 0.0847 FAIL |
| nurse 3 | yes (rMax 2.15) | 0.1253 <= 0.1402 PASS | 0.000 PASS | 0.1813 <= 0.1410 FAIL | 0.0764 <= 0.1373 PASS | 0.0702 FAIL |
| child 6 | yes (rMax 1.64) | 0.0405 <= 0.1482 PASS | 0.000 PASS | 0.1582 <= 0.0877 FAIL | 0.0621 <= 0.4236 PASS | 0.0541 FAIL |

Baselines: arrival 0.1588/0.1302/0.1382, slide 0.1200/0.1360/0.0827,
maxStep 0.0679/0.1172/0.4036.

## Ship decision

NO SHIP: slide and stop-window stance step fail on all three rigs. The stop rows beat
S1's committed stop rows on arrival on every rig (0.024/0.125/0.041 vs
0.109/0.258/0.089) and on slide for the nurse, but stopping-phase foot travel
(crossfade + settle morph) stays 5-8 cm over the 0.02 m stop-window bar. The failure
is in take entry continuity, not yaw: residual yaws read 0.000 deg on all rigs.

## Follow-ups (not done here)

- Take entry continuity is the binding constraint; a sweep keyed to crossfade morph
  distance rather than facing error may find shippable takes among the eligible sets.
- Child seed 4 (best facing, wiring null) and nurse seed 7 (wiring ok, never triggers)
  are the two non-engaging takes; their wiring refusal reasons are recorded in
  `sweep.json` but not root-caused.
- ui-xr / licence / architecture suites not run (nothing shipped; shipped bytes proven
  untouched by bit-identical control rows). No browser capture (ship-gated).
