# RUBRIC::hair-groom-2-accuracy v2 | FORMAT::DENSE_v1
TARGETS::tools/openclinxr/hair-groom-2/targets/target-{front,three_quarter,profile}-a1.png (operator-supplied 2026-11-07, aisha body, grey studio, 1024²). target-back-a1.png is reference only (no back render in a round).
LOOK::dark brown sleek straight hair, narrow centre part, flat to the scalp from front hairline over the crown, tucked behind both ears (ears visible), falls behind both shoulders, tips below the frame bottom of the profile target.
SUCCESS::score ≥ 27 of 29 (93%) [op:2026-11-07 "keep going until 90% accurate"; v1 was ≥ 26 of 28, C1 added, 26/29 = 89.7% < 90%], scored by a grader that did not produce the round.
INPUT::a round dir with front.png, three_quarter_left.png, side.png (1024², Cycles) + stats.json + strands.npz.
SUPERSEDES::v1 (target tools/openclinxr/evidence/hair-eval/fixtures/target.png, front only, hair in front of the shoulders, ears hidden).

## RULES
R1::grade at native resolution; crop and paste 1:1 to inspect; never upscale to discover.
R2::each item PASS|FAIL with the rows/cols looked at and, where numeric, the measured value. Numeric items come from grade.py (see INSTRUMENT); the grader scores the visual items (A8, B1, B3, B4, B6, B2 split-streak half).
R3::front items compare with target-front-a1; three-quarter items with target-three_quarter-a1; side items with target-profile-a1. Compare hair only; garment and background differ.
R4::producer's self-report is evidence, never the score.
R5::every threshold carries its source in parentheses; "target" values are measured by grade.py on the a1 target through the same code path as the round.

## FRONT (12) vs target-front-a1
A1 centre_part::part width at the hairline / jaw width ≤ 2x the target's (target 0.065 = 17.6 px part over 271 px jaw; v1 multiple kept).
A2 no_fringe::hair px in the centre 40% of jaw width, from 0.1 jaw width below the midline hairline down to brow-10, ≤ 1% of the band (target 0.00%).
A3 length::side-view hair bottom z within ±25 mm of the target's 1.171 m (v1 tolerance; target derivation in I2). Tips longer than the target band fail as well as shorter.
A4 behind_shoulders::hair px over each chest/shoulder box (canonical rows 660-900, cols 250-420 / 600-780) ≤ 1% of the box (target 0.00% / 0.00%).
A5 colour::hair mean luminance within ±0.05 of the target AND hair mean R-B within ±50% of the target's (target lum 0.134, R-B 0.070; ±0.05 is the v1 tolerance; ±50% R-B fails a neutral grey or black: R-B 0.035 or less).
A6 silhouette_width_mouth::hair outline width / jaw width at the mouth row within ±15% of the target ratio (target 1.531; v1 tolerance).
A7 ears_tucked::both ears visible with hair behind them: skin px in each ear box ≥ 50% of the target's AND hair px in the strip lateral of each ear ≥ 50% of the target's (target ear skin L 1697 R 1350 px; lateral hair L 1541 R 1499 px).
A8 no_face_strands::no strands cross eyes, nose or mouth (target: none).
A9 silhouette_width_shoulder::hair outline width / jaw width at canonical row 590 (above the shoulder top) within ±15% of the target ratio (target 1.605; same tolerance as A6). Replaces v1 tip_line: the target's front tips are hidden behind the shoulders.
A10 strand_detail::high-pass RMS in the head hair mask ≥ 50% of the target's (target 0.0257; v1 ratio kept).
A11 no_bare_scalp::skin px bracketed by hair above the ears (part band excluded) ≤ 300 (target 120; 300 = 2.5x target).
A12 no_colour_cast::< 2% of hair px chromatic and > 25° off the hair median hue (target 0.08%; v1 threshold).

## THREE-QUARTER (8) vs target-three_quarter-a1 and SIDE (8) vs target-profile-a1, each view scored separately
B1 temple_coverage::no skin visible through a strand veil at the temple/sideburn. Clean skin in front of the hairline is correct (target shows it); a veil of sparse strands over skin fails.
B2 ear_tucked::skin px in the ear box ≥ 50% of the target's (target tq 6052 px, side 5278 px) AND, visually, no dark split streak or strand gap where hair passes behind the ear.
B3 crown::no bare or sparse patch on the crown or along the part line; the part is a narrow clean line as in the target.
B4 nape::hair continuous from crown to tips behind the ear, no gap at the nape (target: continuous).
B5 tq: behind_shoulder::hair px over each shoulder box (canonical rows 700-900, cols 480-640 near / 230-470 far) ≤ 1% (target 0.00% / 0.00%).
B5 side: tip_line::longest run of adjacent tip columns with bottoms within ±3 px ≤ 20% of tip columns (v1 A9 threshold; target 13.4%, its frame-bottom cut included).
B6 clearance::no hair visibly inside head, neck or shoulder.
B7 no_colour_cast::as A12 (target tq 0.73%, side 0.88%).
B8 strand_detail::high-pass RMS ≥ 50% of the matching target view's (target tq 0.0233, side 0.0294; same ratio as A10).

## PROFILE (1)
C1 part_lift::hair lies flat at the front part: in the side view, the median height of the hair silhouette top above the body's scalp silhouette over body y −0.10 to −0.04 m (front head top, 31 samples at 2 mm) ≤ target + 6 mm (target −2.2 mm, i.e. on the scalp within the frame error; 6 mm ≈ 11 canonical px).

## REPORT
SCORE::n/29 / per item id PASS|FAIL value [rows/cols] / TOP3::the three failing items most likely fixable next and the image region showing each.

## INSTRUMENT (v2, 2026-11-07)
I1::numeric items: `tools/openclinxr/hair-groom-2/grade/grade.py <round-dir> [out-dir]` (Blender python) → measures.json with numericItems (20 items), round_measures and target_measures. Regions are defined once in the canonical frame (the groom renderer's camera, groom.py camera_rig) and mapped into each a1 target by a frame (s, dx, dy) from grade/frames.json; a round uses the identity frame unless it carries frame.json. Known-good: the three a1 targets copied into a round dir with frame.json = the target frames score 20/20 numeric. Ratio items are 1.00 by construction in that run; the absolute thresholds (A2, A4, A11, A12, B5, B7, C1) are the part it tests.
I2::target camera geometry differs from ours (front s 1.255, three-quarter s 1.192 at a different azimuth, profile s 1.056), so the frames come from body landmarks (grade/frame_fit.py). Profile: the shipped body's side face silhouette (grade/body_side.json from grade/body_probe.py) fitted to the target's skin front edge, rows 380-565, gives z = (3285 − row) × 0.000527 m (mean error 1.9 px). Checks: the same fit on r6's side render recovers our camera (k 0.000558 vs 0.000557 m/px, centre z 1.4620 vs 1.4623 m); the eye bone (z 1.5532 m) predicts target row 337.8, measured 340.3. A3 target: the target's hair is still 33 px wide at its last row (1023, z 1.192 m), so its bottom is censored; the per-row hair count over the last 60 rows (slope −0.336 px/row) reaches the 20-canonical-px rule at row 1062 → 1.171 m. The target tips therefore sit at or below 1.192 m; the pass band 1.146-1.196 m is the extrapolated value ±25 mm.
I3::front frame: jaw-edge fit of r6 front to the target (rows 440-574, mean error 4.4 px). Three-quarter frame: least squares on four hand-measured landmarks (pupils, lip line, chin; residual ≤ 3 px rows, ≤ 10 px cols, the col error from the azimuth difference).
I4::masks: skin is calibrated per image on a canonical cheek box (chromaticity within 0.08 of the box mean, luminance ≥ 0.68x and R-B ≥ 0.6x the box mean); hair = luminance < 0.47, not skin, not green garment. A fixed R-B rule cannot separate the target's skin (lum ~0.63) from warm-cast render highlights (lum ~0.55, same chromaticity). Jaw width (canonical row 470, below both ear lobes) replaces v1's cheek-row face width, which the visible target ears would widen.
I5::A12/B7 count chromatic hair pixels only: saturation ≥ 0.10 and max channel ≥ 0.04 (near-black pixels in the target's neck cavity carry noise hue; without the 0.04 gate the tq target scored 2.6%).
I6::A10/B8 high-pass: luminance minus gaussian sigma 3 px at native resolution, RMS over the 3 px-eroded hair mask (front: face box excluded, canonical rows 60-1000).
I7::the garment signed distance in stats.json is not used (open cloth); clearance is body-only. strands.npz tip z (median/p10/p90) is reported beside A3 and not scored.
