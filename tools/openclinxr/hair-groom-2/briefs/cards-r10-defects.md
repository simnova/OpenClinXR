# BRIEF::hair-groom-2-cards-r10-defects | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/groom-r9-back.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/r10/<sub>
START::strands groom-r9/s1 (4dd343917), cards groom-r9/cards-mr8 + simplify_cards.py --tol-mm 2 (a3b9dbc36) = cards-opt2/sm2 [grades/cards-opt2-v4: 41/41, indistinguishable from mr8, 62,996 drawn tris; PICK sm2]. Runtime: head_crops --body-frame 1.5 (8359c9e3a); 2048 atlas.

## DEFECT (graders, native resolution)
V1::back black notch in the cards near row ~600 col ~335: 234 px at sm2 (mr8 229, r8 67; k600 gave 70).
V2::side view stepped tips at the shoulder (runtime and offline).
V3::back tail ends flat and opaque at runtime; below row 800 the strand tail narrows to a V where the target has parallel sides.
V4::seed robustness: groom-r9 seed+1 (h11g) is 40/41, B5.side 22.5%.
V5::thin margins on sm2: S3 L550 9.25 (limit 10), A3 0.8 mm, S4.front 9.8, S4.back 9.8.

## TASK
T1::find the cause of V1 (which cards/members produce the dark gap; atlas cell or geometry) and fix at its source.
T2::V2/V3 at the tip stage: tip alpha taper, member-reach ends, strand tip length spread. Procedural only.
T3::V4: the recipe must hold 41/41 at seed and seed+1 (strands) before the card stage.
T4::every landed sub-round: strands, cards, sm2 simplification, runtime crops (--body-frame 1.5), rtm7b counts.

## GATE
G1::cards (after sm2) v4 + I19 41/41; no margin in V5 shrinks; drawn tris ≤ 66,000.
G2::V1 ≤ 70 px; V2, V3 described before/after at native resolution with crop coords.
G3::strands 41/41 at two seeds.

## RESULT envelope (≤ 250 words): RESULT / SUBROUNDS / BEST / SELF_SCORE / V1-V5 one line each with numbers / COST / COMMIT / CHANGED / STILL / HARM / NOT TESTED.
END_BRIEF
