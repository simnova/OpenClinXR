# BRIEF::hair-groom-2-cards-r7 | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/cards-r4.md (W, ITERATION rules, G2-G5, RESULT envelope) except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/cards-r7/<sub>
START::cards-r6/s2 at 4d680ed7d [grades/cards-r6-s2-v4 = 40/41 independent, SUCCESS; PICK r6/s2]. Strand source groom-r7/s1.
OP::2026-11-08 "keep iterating and trying and judging the output to find the most realistic match, then work on optimizing it". This is the last realism round before the cost step.

## DEFECT (grades/cards-r6-s2-v4; re-measure before acting)
D1::S2 passes on one pixel. Row 323 coverage 0.522 (12/23 px); one more skin px gives -6.9 mm FAIL. Clustering is identical to r5/s6; brief cards-r6 M1 (cluster sideburn roots separately) was not done. Mapped by strand id, 492 sideburn strands sit on 32 cards (arc p50 43.8 mm), 18 under 60 mm carrying 189 strands.
D2::S1 band 950 -24.70 mm, margin 0.30 mm (limit 25).
D3::S3 L250 11.65, R250 13.70, R550 11.97 deg (limit 10; r7 strands 9.6). Only failing item.
D4::runtime highlight weak: front Lmax 0.652, L>0.8 0 px (r5/s6: 0.995, 41 px). Back has none.
D5::runtime soft edges N in front and tq.

## METHOD
M1::D1: do cards-r6 M1 now (root-region clustering for sideburn/temple). Target S2 end within ±7% of 14.4 mm (half the rubric tolerance, so a 1-px change cannot flip it); measure the flip margin the grader used (add/remove 1 skin px at the end row).
M2::D2/D3: S3 is the outline angle at bands 250/550 in the back view; find which cards set that outline (card centroids on the silhouette) and fix their placement from strand data. Target S1 margin ≥ 3 mm.
M3::D4: restore a visible strand highlight at temples/crown without the r5 artifacts (keep side rear L>0.35 ≤ 1000 px, tq behind-ear L>0.5 ≤ 20 px, tq tips L>0.8 ≤ 5 px). Report Lmax and L>0.8 px per view.
M4::D5 only if cheap; otherwise record why.

## GATE
G1::v4 + I19 self-score ≥ 40/41, no item newly failing vs r6/s2, S2 flip margin ≥ 2 px, S1 margin ≥ 3 mm.
G3::runtime crops all four views, checklist as cards-r4 plus M3 counts.

## RESULT envelope (≤ 250 words) as cards-r4, plus D1-D5 one line each with numbers.
END_BRIEF
