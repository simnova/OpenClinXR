# BRIEF::hair-groom-2-groom-r8-margins | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/groom-r5-shape.md (and through it groom-loop.md, groom-r1.md) except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/groom-r8/<sub>
START::groom code at HEAD and recipe groom/recipes/straight_centre_part_collarbone.json as of fb94865dd (groom-r7/s1, grades/r7-s1-v4 = 41/41).
OP::2026-11-08 "still hair shape has some issues that might be better to tackle first"; "then work on optimizing it".

## WHY
Cards built from r7/s1 (grades/cards-r7-s1-v4, 40/41) fail S3 and pass S1 by 0.31 mm. The strands themselves sit near both limits: S3.back 9.6 deg (limit 10), S1 band 950 -22.2 mm (limit 25). Card conversion costs ~2.5 mm on S1 and ~2-4 deg on S3 (cards L250 11.51, R250 13.70, R550 11.86). Every geometry cost cut in cards-opt1 (EV/cards-opt1/rounds.tsv: L1, st16, k650) failed S1 band 950. So the strand outline needs margin before cards can be cheaper.

## TASK
T1::move the strand outline toward the target at S3 bands L250/R250/R550 (back view) and S1 band 950 (side view), procedural/recipe only (M2 of groom-r5 holds: no per-point edits matched to the target). Read grade/shape_landmarks.json and probe_v4.py to see exactly what S1 and S3 measure.
T2::then rebuild cards with the cards-r7/s1 recipe (cards/run_cards.sh, see commit 33d5a2719 message and EV/cards-r7/s1) from the best strand sub-round, and score that card round too.

## GATE
G1::strand round v4 41/41 with S3 every band ≤ 8.0 deg and S1 every band |offset| ≤ 20 mm (each limit minus the measured card-conversion cost above, rounded); no item that passed in r7-s1-v4 fails.
G2::card round from it: v4 + I19 ≥ 40/41, S1 margin ≥ 3 mm, S2 flip margin ≥ 3 px (grade method in grades/cards-r7-s1-v4/s2).
G3::all four views per sub-round; 3-up sheets with cards/sheet3.py.

## ITERATION
Up to 6 sub-rounds. Commit code per landed sub-round (only files you change under tools/openclinxr/hair-groom-2/groom/ and cards/). If git reports index.lock, wait 5 s and retry; a grader may be reading the same worktree.

## RESULT envelope (≤ 250 words) as groom-loop, plus S1/S3 per band strand and card values, and the card round score.
END_BRIEF
