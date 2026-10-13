# Slide-phase foot-slide baseline (2026-10-13)

Instrument: `tools/openclinxr/evidence/slide-phase/slide-phase-analyze.ts`, reading
`settle-entry-capture` v1 records (`--vehicle=sc05`, `--vehicle=loco`).
Contact band is the production constant `FOOT_CONTACT_HEIGHT_METERS` (0.06 m),
imported, never retyped. All phase boundaries come from the record's own
`phase`/`stanceFoot` columns. Full aggregation expressions live in the tool header;
each row below names its expression on first use.

## Baseline (main, this build)

SC-05 bedside approach, 6 runs, 1.31 m route:

| quantity (expression) | mean | sd | range |
|---|---|---|---|
| 1a. start transient, left toe path walk-start to first lift `SUM \|toe[i+1]-toe[i]\|_xz` | 0.2855 m | 0.0005 m | [0.2849, 0.2859] m |
| 1b. start transient, right toe, same expression | 0.0000 m | 0.0000 m | [0.0000, 0.0000] m |
| 1c. first stance foot (left) during first step, same path sum | 0.0000 m | 0.0000 m | [0.0000, 0.0000] m |
| 2. walking slide per metre walked `SUM window span-from-base / slot XZ path` | 0.3262 m/m | 0.0005 m/m | [0.3257, 0.3266] m/m |
| 2 detail. walking window-span sum `SUM MAX_i \|toe[i]-toe[base]\|_xz` (3 windows/run) | 0.3549 m | 0.0005 m | [0.3544, 0.3554] m |
| 2 detail. root path walked (slot XZ path over walking frames) | 1.088 m | 0.000 m | [1.088, 1.088] m |
| 3. settle, planted-toe travel walk-exit to turn-start, per toe | 0.0000 / 0.0000 m | 0.0000 m | [0.0000, 0.0000] m |
| 4. turn, pivot-foot (first turn window stance: left) max window span | 0.0003 m | 0.0001 m | [0.0002, 0.0004] m |
| 5a. end stance toe separation, body frame: lateral `(R-L).right` | -0.1933 m | 0.0007 m | [-0.1944, -0.1925] m |
| 5b. end stance toe separation, body frame: fore-aft `(R-L).fwd` | -0.0227 m | 0.0001 m | [-0.0229, -0.0225] m |
| 5c. pelvis yaw error vs target `atan2(sin,cos)` | 0.00 deg | 0.00 deg | [0.00, 0.00] deg |
| 5d. both toes inside contact band | yes (6/6) | — | — |

Loco proving ground, 3 runs, 6.00 m route:

| quantity (expression) | mean | sd | range |
|---|---|---|---|
| 1a. start transient, left toe path | 0.2843 m | 0.0009 m | [0.2833, 0.2849] m |
| 1b. start transient, right toe | 0.0000 m | 0.0000 m | [0.0000, 0.0000] m |
| 1c. first stance foot during first step | 0.0000 m | 0.0000 m | [0.0000, 0.0000] m |
| 2. walking slide per metre walked (16 windows/run) | 0.3570 m/m | 0.0007 m/m | [0.3565, 0.3578] m/m |
| 2 detail. walking window-span sum | 2.0799 m | 0.0043 m | [2.0770, 2.0848] m |
| 2 detail. root path walked | 5.826 m | 0.000 m | [5.826, 5.826] m |
| 3. settle L / R | 0.0004 / 0.0000 m | 0.0001 m | [0.0003, 0.0005] m |
| 4. turn max window span (pivot left) | 0.0005 m | 0.0001 m | [0.0004, 0.0007] m |
| 5a. end lateral | -0.1896 m | 0.0000 m | [-0.1896, -0.1895] m |
| 5b. end fore-aft | -0.3697 m | 0.0000 m | [-0.3697, -0.3697] m |
| 5c. yaw error | 0.00 deg | 0.00 deg | [0.00, 0.00] deg |
| 5d. both toes inside contact band | yes (3/3) | — | — |

Reading: the walking phase slides ~0.33-0.36 m per metre walked on both vehicles;
the stepping turn is pinned (~0.0003-0.0005 m); the settle gap between walk exit
(first settling frame with null stance) and turn start carries nothing measurable.
Loco ends with feet 0.37 m staggered fore-aft (record loco-run0 frame 175:
L z=1.010, R z=1.380, both planted); SC-05 ends nearly together.

## Validation

a. Synthetic record with a planted 0.05 m slide in one walking stance window,
zero elsewhere: tool reports 0.0500 in that window (window sum 0.0500,
slide/m 0.0909 over the 0.55 m synthetic root path) and 0.0000 in settle,
both turn windows, and the frozen walking window. Unit test
`slide-phase-analyze.test.ts` prints the planted `leftToe.x` ramp before/after
to show the plant applied. Pass.

b. Ungated replica of `settle-entry-analyze` windowSlidesM agrees with that tool
on the same 6 SC-05 runs to 0.0 m on every run (per-run diff 0.00e+00; aggregate
max 0.0011 m both). The band-gated turn number is smaller (0.0003 m) because
early settling frames carry a stance label while the toe is still airborne
(e.g. sc05-run0 frame 26: stance=left, leftToe.y=0.101 > 0.06): the label-only
span counts that height as slide, the planted gate does not. The published
0.28 m whole-run figure predates this build; on current main the same
instrument reads ~0.001 m settling max.

c. Same-build run-to-run (sc05-run0 vs sc05-run1) absolute diffs: startL
0.0009, walkSum 0.0001, rootPath 0.0000, slide/m 0.0001, turnMax 0.0001,
lateral 0.0019, fore-aft 0.0004 m; all others 0.0000; band yes/yes.

## Limits

Records begin mid-route (`travelledMeters`=0.137 at frame 0, `preWalk` empty:
the first probe already reads `phase=walking`), so quantity 1 is the
recording-start transient, not the standing-start first step; the leading
"first step" is a one-frame edge fragment and reads 0.0000 on every run.
Turn start is the first settling frame with non-null `stanceFoot`; the settle
gap is the single null-stance settling frame. No quantity needed a missing
column: `missing` is empty on all 9 runs.

No acceptance thresholds and no bars in this slice.

NOT TESTED: nurse/child actors; headsets; 60 fps clock; the true standing-start
transient (no record covers it); screenshot/video evidence (none captured).
