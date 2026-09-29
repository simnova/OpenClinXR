# Lens refit: poses 01/02 FOV + eye re-fit to v2 references (2026-09-29)

Reference set (ONLY): `docs/openclinxr/room-realism/imagine-multiview-v2/`
(1280x720 each). The older `imagine-multiview/` directory is STALE and was not
used for any number in this file.

Room truth (measured on the baked GLB, not assumed): walls x +/-2.15,
floor y=0, ceiling y=2.4, door leaf center x=+0.25 (0.95 wide, y 0-2.1) in the
-z wall (pygltflib bounds on `ward-chain.work.glb`, sha256 bff6c6658dbc6b5c,
seed 205, footprint 4.3 x 3.9 x 2.4 m, all three chain stages cache-hit per
`/tmp/room-dims-chain-rerun-0929/ward-chain-report.json`). No geometry changed
in this job; only `hand-placed-poses.json` poses 01/02.

## Method (pixel/luminance, reproducible)

All images 1280x720. Instruments (numpy/PIL, no eyeballing):
- Back-wall left/right corner x: mean |d/dx| over row bands y 350-550
  (floor band) and y 150-300 (upper band), 3px box smooth, argmax in a
  side window; door casing excluded for ref 01 (peak at x=859 is casing).
  Pose 02's left corner cross-checked by per-row argmax tracking y 180-520
  (straight-line test) and an R-channel paint-transition scan, because a
  specular streak on the side wall outscores the true corner in a plain
  band average (caught at x=277 pre-fix, x=232 iter2).
- Wall top (ceiling junction) y: mean |d/dy| over central x, full y-profile;
  the LAST strong line before featureless wall is the junction; earlier
  strong lines are ceiling T-bar grid (verified against 3x top-band strips).
- Wall bottom y: same; baseboard-top and floor-junction reported separately
  where resolved (double edge).
- Skepticism audit: 50/50 overlay blends (`*-overlay.png`) plus side-by-side
  sheets for all six poses; corner zooms at 2x for the weak 02-left corner.

Gate (stated before fitting): back-wall corners within **+-3pp** of reference
(38 px; corner-pick noise +-1.5pp plus AI-reference inconsistency), wall
top/bottom within **+-5pp** (weaker edges, T-bar confusion).

## Reference frame fractions (measured)

Ref 01 (`imagine-multiview-v2/01-toward-door.jpg`):
- L corner: floor-band x=311 (0.243), upper-band x=333 (0.260); mid 0.252.
- R corner: x=941/942 both bands (0.735). Door leaf spans ~700-850,
  center ~775 (0.605), width 150 px (R-B maple profile).
- Wall top (junction): y~156 (0.217); T-bar line at y=106 is NOT the wall.
- Wall bottom: base top y~553 (0.768), floor junction y~564 (0.783).
- Back-wall span 630 px (0.492W), height ~397 px (0.551H).

Ref 02 (`imagine-multiview-v2/02-toward-bed-wall.jpg`):
- L corner: x=226-230 at every row y 180-520 (straight, 0.178).
- R corner: x=1050/1051 (0.820).
- Wall top (junction): y~158 (0.219); T-bar line at y=134 is NOT the wall.
- Wall bottom: base top y~559 (0.776), floor junction y~576 (0.800).
- Span 822 px (0.642W), height ~417 px (0.579H).

## Pre-fix runtime (committed poses, fresh capture vs chain GLB bff6c665)

`captures-pre/` ( Pose 01 fov 70 eye [-0.42,1.6,1.62] look [-0.42,1.15,-1.95];
pose 02 fov 48 eye [0,1.85,-1.9] look [0.3,1.7,1.95] ):
- 01: L 0.306/0.298, R 0.787/0.799 (both ~+5pp right of ref); top ~0.251
  (+3.4pp); floor junction ~0.726 (-5.7pp). Span already matched (0.491 vs
  0.492) -- the defect was bodily right-shift plus vertical compression
  (wall band 0.451H vs ref 0.551H), not width.
- 02: L ~0.23 (streak-polluted estimate), R ~0.906 (+8.6pp); top ~0.279
  (+6pp); NO baseboard/floor in frame (wall runs off bottom). Raised 1.85 m
  eye 5 cm off the door wall, level gaze.

## Iteration log (render, measure, compare, repeat; 6 full captures)

- iter1: 01 look x -0.42->-0.08 (pan right ~5.4deg) => corners within 1.6pp.
  02 eye to 1.6 m, fov 48->66, look x 0.3->0.45 => L overshot to 0.335
  (wide FOV shrinks span toward center from the oblique eye).
- iter2: 01 look y 1.15->1.22 (split vertical residual) => all inside.
  02 fov 66->50, look x 0.45->0.0 => span/vertical restored (true L corner
  identified at 0.207 via per-row tracking; band-average peaks were streak).
- iter3: 02 fov 50->54 => R/T/B inside, L +2.9pp (edge of gate).
- iter4: 02 look x 0.0->+0.06 => L moved the wrong way (+3.8pp); sign of the
  look-x transfer recorded from data, pinhole (verified <=1pp against renders
  on mesh bounds) used for sensitivities instead of hand angles.
- iter5: 02 fov 54->58, look x back to 0.0 => R/T/B inside, L +4.9pp.
- iter6: 02 fov 58->56, eye z -1.7->-1.5 (per numerical sensitivities) =>
  all inside (below).

Unconstrained numerical fitting was tried and REJECTED: it drives the eye
into walls/ceiling (x=-2.05, y=2.3, fov 80) to force all four targets --
degenerate. Hand-iteration with measured transfer won.

## Final values (committed in `hand-placed-poses.json`, poses 01/02 only)

- 01: eye [-0.42, 1.6, 1.62], look [-0.08, 1.22, -1.80], fov 70.
- 02: eye [-0.30, 1.60, -1.50], look [0.00, 1.25, 1.80], fov 56.
- 03/04/05/06: byte-identical to the committed values (their captures
  reproduce sha-identical across every run in this job).

Final measured deltas vs reference (pp = percentage points of frame):
- 01: L -0.1, R +0.1 (corners); top +4.4 (junction y~188 vs ref 156);
  bottom -3.9 (floor junction y~536 vs ref 564). All inside gates.
- 02: L +2.6 (per-row mid 0.204 vs ref 0.178); R +1.0/+2.3; top -1.1
  (junction y~150 vs ref 158); bottom +0.6 (junction y~580 vs ref 576).
  All inside gates.

Bounds clearance (room 4.3 x 3.9 x 2.4, walls x +/-2.15 y 0-2.4 z +/-1.95):
- 01 eye clearances >= 0.23 m; look z -1.80 clears door wall by 0.15 m
  (was exactly ON the wall at -1.95).
- 02 eye clears door wall by 0.45 m (was 0.05 m); look z 1.80 clears bed
  wall by 0.15 m (was exactly ON the wall at 1.95).

Residuals disclosed (not gated, not fixed -- room aspect vs AI-reference
aspect makes all six numbers unmatchable at once): 01 door leaf renders at
frame ~0.52 vs ref ~0.605 (kept the 0.25 m door pin; AI drew it elsewhere);
01 wall band 0.48H vs ref 0.55H; troffer renders larger than ref (eye sits
~1 m from its edge); specular wedge on 02's left wall is a material/lighting
trait that polluted early metrology (documented above).

## Files (all under `docs/openclinxr/room-realism/lens-refit/`)

- `captures/`: final six PNGs + `stage2-multiview.json` (poses, bytes, sha256;
  GLB bff6c6658dbc6b5c). 01 sha 2df816cef77e, 02 sha 25548cb9d2ce.
- `captures-pre/`: pre-fix six PNGs + manifest (same GLB, committed poses).
- `0{1..6}-*-side-by-side.png`: v2 reference LEFT, runtime RIGHT (all six).
- `01-toward-door-overlay.png`, `02-toward-bed-wall-overlay.png`: 50/50 audit.
- `side-by-side.py`: sheet/overlay builder. `MEASUREMENT.md`: this file.
