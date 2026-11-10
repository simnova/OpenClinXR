# 08 front root region vs target hairline in the driver frame (CEO 10:00, 2026-11-10; candidate ii)

Status: run 2026-11-10, verdict CAUSE (median front-most root row 250.5 >= 246). Rule committed before the probe (cabd982db).

## Gap direction (measured fact, stated before the rule)
The direction of the front hairline gap was not measured before queue/04-07; all four tested coverage loss (root position,
root alpha, MASK cutoff, edge-on). Measured after them (queue/07, 192073322): front cols 500-524, rows 236-248 are hair-dark in
the incumbent render (L .21-.25) and skin in the v2 target (L .40-.63). Rendered hair reaches 12-17 px further DOWN the
forehead than the target (hairlineRow 253 vs 236). Every later hairline card states the direction as a measured fact first.

## Hypothesis
Strand roots on the runtime body (ob_patient_aisha, 7,006 verts) sit lower on the forehead than the target person's hairline
(parent_tara_johnson, 15,949 verts) after fit-head registration, so the hair overshoots because its roots do.

## Probe (CPU; one body-only render allowed)
1. Projection: the front-view camera of render_trial.sh / batch.ts (renderHeadFocusCrops, --body-frame 1.5, 1024 px) as a
   3D -> crop-pixel map, derived from the harness code. Validation: project the incumbent GLB hair triangles and compare
   with the hair-only render's coverage (probe06/cut-85/ts-cut-85-front-hair.png vs -empty.png, |diff| > 3/255).
   VOID if silhouette IoU < .90 (fit-head head IoU .895-.985 is the registration quality the targets already carry).
2. Root rows: project every strand root (EV/groom-r9/s1/strands.npz) into the front crop. Per crop column in 500-524, the
   front-most root row = the largest row (lowest on the forehead) among roots projecting into that column, front surface
   only (roots on the visible side of the head). Report the median over the 25 columns, and p10/p90.
3. Nohair darkening: compare the L .38-.39 band (rows 236-250, cols 500-524 of probe06/cut-85/nohair-front.png) with
   (a) the scalp-tint footprint (p2 tint.json / scalp_tint.py output for the incumbent, projected the same way) and
   (b) a body-only front render of mpfb-ob-patient-aisha.glb with hideHair (no tint). Report which one the band follows.

## Rule (fixed before the probe; bounds from CEO 10:00)
- CAUSE: median front-most root row >= 246 (roots alone account for >= 10 of the 12-17 px overshoot from target 236).
  Next card: move the front root region up on Aisha's scalp in the groom (upstream of the optimizer), scored with v2 in all
  4 views, rule fixed first.
- NOT THE CAUSE: median < 246. Next: candidate (i) overhang (front cards/strands hanging below their roots), no further
  decision needed.
- Nohair band: reported as tint footprint, body texture, or other (free text), with the measured rows of each.

## Result (probe08; raw .openclinxr/opt/hair-groom-2/probe08/result.json, untracked)
Camera from the harness code (packages/openclinxr/xr-scene/src/camera-fit-to-bounds.ts frameCamera, probe06 crop-report
focusRegion): fov 35, pos (0, 1.5987, 1.3681), distance 1.304 m, 0.803 mm/px. Validation IoU (projected incumbent hair
triangles vs hair-only render coverage): .994 (triangles), .990 (atlas alpha >= .05). No correction fitted.
Front-surface strand roots (groom-r9/s1, 2,387 in cols 500-524): front-most root row median 250.5, p10 248.1, p90 254.0.
250.5 >= 246: the roots alone sit 14.5 px (~11.6 mm at 0.803 mm/px) below the target hairline row 236.
Nohair band: the untinted body render (probe08/body0) is L .575-.611 over rows 226-262; the incumbent nohair is darker by
> .05 L from row 200 to 254, lower edge median 252.5. A projected scalp-tint footprint (front roots, sigma .6 and 3 mm, an
image-plane approximation of scalp_tint.py) has its lower edge at 252.5; per-column correlation with the band edge .97,
mean offset +.64 px. The band is the scalp tint, not body texture; it follows the roots, so the fix is in the groom root
region, and the tint moves with it.
Not tested: roots against the target in 3D (only crop rows vs 236); occlusion (front-facing normals only); whether raising the
roots closes the overshoot (overhang (i) not measured); other views; the UV-space tint raster.
