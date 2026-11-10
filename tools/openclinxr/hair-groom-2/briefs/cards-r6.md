# BRIEF::hair-groom-2-cards-r6 | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/cards-r4.md (W, ITERATION rules, G2-G5, RESULT envelope) except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/cards-r6/<sub>
START::cards-r5/s6 recipe at 83d9464a3 [grades/cards-r5-s6-v4 = 38/41 independent; PICK r5/s6]. Strand source groom-r7/s1.
OP::2026-11-08 "keep iterating and trying and judging the output to find the most realistic match, then work on optimizing it".

## DEFECT (from the independent grade grades/cards-r5-s6-v4; re-measure before acting)
C1::S2 sideburn -21.8 mm (ends -7.4 mm vs 14.4 target). Grader probe_s2_members.txt: all 492 r7 sideburn-patch strands sit on 584-611 mm cards; none on the 48 short cards (<100 mm). The clustering merges sideburn roots into long hang cards, so --short-split never touches them.
C2::S3 back outline L250 11.57, R250 13.80, R550 12.15 deg (limit 10; r7 strands 9.6).
C3::S1 vs S4.front trade on --edge-fade (0.25: S1 -25.05 mm FAIL, S4.front PASS; 0.15: S1 PASS, S4.front 10.43 FAIL). Find a mechanism that passes both (e.g. fade per region, or fix the crown card placement instead of fading).
C4::runtime artifacts (aisha-cards-r5-s6.glb): side grey-white sheet down the rear edge r560-851 c580-645 (1896 px vs 514 in r4); tq bright patch behind ear top r260-319 c520-589; tq tip glints r446-480 c611-642 lum 1.0. Likely sheen on edge-on/grazing cards; keep the strand highlight at the temples and crown.
C5::runtime soft edges N in front/tq/side (Y only in back) with MASK 0.85 core + BLEND fringe. Find why the fringe is not visible (fringe alpha range, sort, depthWrite) and fix.

## METHOD
M1::C1 first: cluster sideburn/temple roots separately (by root region from shape_landmarks or scalp UV), so those strands get their own short cards. Automation only (D1).
M2::C4: attenuate sheen by view-independent data you already have (alpha, card normal vs outward field, a per-vertex mask), not per-pixel hand edits.
M3::render runtime head crops for every landed sub-round (cards/head_crops.ts).

## GATE
G1::rubric v4 + I19 self-score. SUCCESS ≥ 39/41 and S1, S2, S3, S4.front each PASS or improve vs r5/s6 with none newly failing vs r5/s6.
G3::runtime checklist per view as cards-r4, plus the C4 regions measured (px count above lum 0.8) vs r5/s6.

## RESULT envelope (≤ 250 words) as cards-r4, plus C1-C5 one line each with numbers.
END_BRIEF
