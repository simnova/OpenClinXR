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

## Slide decomposition and fix attempt — 2026-10-11 (no ship)

The selected takes stance-slide <= 0.02 m offline, yet the runtime assay showed
whole-approach slide 0.158-0.204 m and stop-window stance step 0.054-0.085 m.
Measured before changing anything (`.openclinxr/evidence/stop-takes/slide-decomposition.json`,
lock-off via a temporary diagnostic since reverted).

Per rig x phase x lock (slideM median / maxStanceStepM, metres; settling includes arrived):

| rig | lock | crossfade | stopping | settling |
| physician 8 | on | 0.5719 / 0.0833 | 0.0364 / 0.0083 | 0.0226 / 0.0354 |
| physician 8 | off | (no labels) | 0.0182 / 0.0024 | no band windows |
| nurse 3 | on | 0.3149 / 0.0679 | 0.0647 / 0.0118 | 0.0294 / 0.0294 |
| nurse 3 | off | (no labels) | 0.0257 / 0.0040 | 0.0860 / 0.0533 |
| child 6 | on | 0.1580 / 0.0536 | 0.0246 / 0.0050 | 0.0251 / 0.0278 |
| child 6 | off | (no labels) | 0.0093 / 0.0017 | 0.3327 / 0.0349 |

Lock-off arrivals: 0.011-0.016 (vs 0.024-0.125 lock-on). Lock-off settled yaw: ~62-63
deg on all rigs — the settling turn is load-bearing for the residual bar.

Stopping phase, lock off, planted-toe world travel vs the same toe in the bound clip
at the same clip times (per contact window): physician 0.0182/0.0098 vs 0.0321/0.0117;
nurse 0.0198/0.0318/0.0257 vs 0.0062/0.0054/0.0075; child 0.0082/0.0093 vs 0.0164/0.0091.
The runtime reproduces the take within ~1-3 cm per window.

Component verdict:

- Crossfade pose mix (take-side): 0.16-0.57 m stance travel over the 16-frame
  walk-to-stop morph; all stopStep maxima live here. Lock on/off single-frame steps
  identical (nurse 0.0764 both) — no minimal runtime fix (entry phase mismatch).
- Settling turn pivot/pin (load-bearing): slot travel 0.15-0.22 m with lock vs 0.0
  without; pivot arcs are by-construction turn motion and the turn is required for
  the residual bar. Not removable.
- Stopping pin: exonerated — slot travel identical lock on/off (e.g. 1.0667 vs
  1.0617); forward drift is deliberately uncorrected (no-backward clamp), lateral
  only. Stopping slide stays 0.02-0.06.
- Procedural slot advance vs take root path: minor (+1-3 cm per window, above).
- Settle morphs (blend 0.7-0.9 m over 18 frames; consumer rest morph 0.26 m):
  structural production mixer behavior.

Fixes applied (same component: settling-phase post-stop handling), each gated so
walk-only control rows stay bit-identical, each with a failing-first unit test:

- Arrived close re-target (`recaptureStopRestStance`): re-capture rest from the
  take's hold pose at stopping-to-settling instead of converging stop-planted feet
  into walk-start rest. Arrived stillness improved ~8x (settling bucket
  0.19/0.18/0.08 to 0.023/0.029/0.025).
- Settling-turn pin stand-down (`postStop` gate): skip pin/lift when settling after
  a stop with residual already under tolerance. Signalled by the executor's stop
  clip time, which persists through settling/arrived — `stopFired` is unusable
  (wiring resolves a frame after the entry branch fires, so it stays null).

Re-measured assay: bars still fail on every rig (slide 0.204/0.181/0.158;
stopStep 0.085/0.070/0.054). The assay's slide bar grades the settling TURN phase
(load-bearing) and its stopStep bar grades the crossfade morph (take-side);
neither fix moves them. Ship decision: NO SHIP, second confirmation. Shipped GLBs
untouched; no provenance freeze regen; no capture.

Deeper follow-ups: take entry-phase alignment (crossfade), turn-pivot cost
(residual bar's price), footfall-bias spread (documented arrival keeper, do not
touch for slide).
