# RUBRIC::hair-groom-2-accuracy | FORMAT::DENSE_v1
TARGET::tools/openclinxr/evidence/hair-eval/fixtures/target.png (512x512, front only)
SUCCESS::score ≥ 26 of 28 (≥ 90%) [op:2026-11-07 "keep going until 90% accurate"], scored by a grader that did not produce the round.
INPUT::a round dir with front.png, three_quarter_left.png, side.png (1024², Cycles) + stats.json + strands.npz.

## RULES
R1::grade at native resolution; crop and paste 1:1 to inspect; never upscale to discover. Downscale the 1024 front to 512 only for side-by-side with the target.
R2::each item PASS|FAIL with the rows/cols looked at and, where numeric, the measured value. Numeric items are measured with numpy/Pillow (Blender python, see brief), not eyeballed.
R3::the target shows a different face; compare hair only. Front items compare with the target; three-quarter and side items are defect checks (target has no such view).
R4::producer's self-report is evidence, never the score.

## FRONT (12)
A1 centre_part::a part at the head midline is visible and its width at the hairline ≤ 2x the target's part width, both measured as face-width ratios.
A2 no_fringe::no hair crosses below the hairline onto the forehead in the centre 40% of face width.
A3 length::hair tip median height within ±25 mm of the clavicle (stats.json) AND rendered tips reach the shoulder line.
A4 front_of_shoulders::hair visibly falls in front of both shoulders (as target).
A5 colour::mean sRGB luminance of hair pixels ≤ target hair mean + 0.05 (measure target hair mask with a luminance < 0.30 rule in the head region).
A6 silhouette_width::hair width / face width at mouth row within ±15% of the target ratio.
A7 no_ear_skin::no ear or scalp skin visible through or beside the hair at the face edge.
A8 no_face_strands::no strands cross eyes, nose or mouth.
A9 tip_line::tip line irregular (no straight horizontal hem over > 20% of hair width).
A10 strand_detail::at 1:1, hair interior shows strand-scale variation (not a smooth shell): high-pass energy in hair region ≥ 50% of target's, same hp filter.
A11 no_bare_scalp::no skin-coloured patch inside the hair silhouette above the ears.
A12 no_colour_cast::< 2% of hair pixels have hue > 25° off the hair median hue (rim casts).

## THREE-QUARTER (8) and SIDE (8), each view scored separately
B1 temple_coverage::no skin visible through a strand veil at the temple/sideburn.
B2 ear_region::no dark split streak or gap where hair passes the ear.
B3 crown::no bare or sparse patch on crown or part line.
B4 nape::hair continuous from crown to tips behind the ear, no gap at nape.
B5 tips::tips reach the shoulder line and are irregular.
B6 clearance::no hair visibly inside head, neck or shoulder.
B7 no_colour_cast::as A12.
B8 strand_detail::as A10, against the front render's own value (≥ 70% of it).

## REPORT
SCORE::n/28 / per item id PASS|FAIL value [rows/cols] / TOP3::the three failing items most likely fixable next and the image region showing each.
