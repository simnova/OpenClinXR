# 10 front-only hairline ramp at 12 mm (operator decision 2026-11-10; from queue/09)

Status: probe10 done, rule committed before the build.

## Gap direction (measured fact, from queue/09)
At 12 mm with today's ramp (full raise to azimuth 40 deg, 0 at 70 deg) the front hairlineRow is 238 (target 236, pass) and
3q is 21.03 vs bar 19.85 (FAIL): the 3q render loses hair the 3q target has at rows 246-308, cols 440-551.

## Parameter
groom.py build_scalp: `scalp.frontHairlineRampDeg` [full, zero], default [40, 70] = queue/09 behaviour (same arithmetic:
(70 - az) / (70 - 40) = (70 - az) / 30). Validated 0 <= full < zero <= 180.
Recipe: groom/recipes/straight_centre_part_collarbone_aisha_fh12r7-14.json = card09 groom-fh12 recipe + ramp [7, 14].

## probe10 (CPU; .openclinxr/opt/hair-groom-2/probe10/probe10.py, result.json, untracked)
Camera: camera-fit-to-bounds.ts frameCamera, three_quarter_left direction (+0.707, 0, +0.707), bounds from card09 render-fh0
crop-report. Validation (probe08 method, fh0 strand points vs fh0 hair-only render |hair - empty| > 3/255): 3q IoU .955,
front .970 (VOID below .90).
Body surface hit by ray-cast through each pixel (mpfb-ob-patient-aisha.glb), azimuth in the groom head frame (fh0 headFrame):
| pixel set (3q, rows 246-308, cols 440-551) | pixels | surface az p10 / med / p90 (deg) | surface z p10 / med / p90 (mm) |
|---|---|---|---|
| target hair | 3703 | 17.7 / 46.5 / 62.5 | 79.0 / 100.5 / 112.8 |
| target hair, in fh0, lost in fh12 | 864 | 7.9 / 30.0 / 53.6 | 73.6 / 97.1 / 110.4 |
| target hair, in fh0, lost in fh16 | 1581 | 10.9 / 34.1 / 54.8 | 74.6 / 96.8 / 111.2 |

Root attribution: of the 2,378 fh0 roots that today's 12 mm ramp removes, 573 have a strand that projects into the lost-12
pixels. Their root azimuth: p5 2.4, p10 4.3, p25 8.3, median 16.6, p75 24.7, p95 32.6 deg; per 10 deg bin 171 / 165 / 173 /
64 / 0 (40+). The 40-70 deg taper contributes none: the lost 3q hair is front hair (az 0-33) draping across the temple.
Front measurement: the body surface under the front part-measure columns (front view rows 230-256, cols 500-524) is at
azimuth p95 6.9 deg, median 3.5.

## Ramp choice (from probe10, before any build)
Full raise to 7 deg (front measurement band p95 6.9, rounded up); linear to 0 at 14 deg (taper width = full width).
On the fh0 roots at 12 mm (simulation, no regrow):
| ramp | roots removed | removed of the 573 that reach lost-12 pixels | front cols 500-524 roots removed (of 2,806) |
|---|---|---|---|
| [40, 70] (card 09) | 2,378 | 573 | 297 |
| [7, 14] (card 10) | 423 | 148 | 297 |

## Tris (fixed before the render)
Final hair tris = 2 x simplify trianglesOut (fh0 31,512 -> 63,024; fh12 31,596 -> 63,192). trisMax 63,024.
Rule: stage 2 simplify uses --tol-mm 2.00; if 2 x trianglesOut > 63,024, the smallest tol in 2.01..2.05 (step .01) that fits,
picked on the stage-1 cards before the donor re-render; recorded in card10/chain/tol.txt. None fits -> stop and report.
Measured response on the card09 fh12 cards: tol 2.00 63,192; 2.05 62,560; 2.10 61,892.

## Rule (card 10; amendment-1 shape from queue/09)
- Build: real groom re-run, seed from the recipe, `--samples 128 --views front,three_quarter_left,side,back`; then
  cards -> atlas -> calib -> donor -> simplify (tris rule) -> sheen -> transplant -> tint, g2 settings (card09 chain.sh).
  Every stage sha in card10/chain/stages.tsv.
- Default check first: groom.py with this change on card09/groom-fh12/recipe.json must reproduce positionsSha256
  cb4963b0 (card09 groom-fh12); mismatch -> stop, no build.
- PASS = front hairlineRow (score_trial v2, measure_band) in 230-242 (236 +- 6) AND every other view
  D_v(fh12r) <= D_v(fh0) + delta_v: 3q <= 19.8509, side <= 20.3260, back <= 8.2274 (fh0 = card09/render-fh0/score.json;
  delta_v = noise-floors-registered.json / objective-v2 delta_seed_v) AND tris <= 63,024.
- ship_a4 --bars v2: information only.
- One build. FAIL -> stop and report; no further ramp without a CEO decision.
- Not tested by probe10: occlusion of the reaching strands by nearer hair; the regrown groom (dart throwing and Interpolate
  re-spread every root); overhang into the front columns from roots at 7-14 deg that keep their place.
