# BRIEF::hair-groom-2-groom-r9-back | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/groom-r8-margins.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/groom-r9/<sub>
START::groom-r8/s2 (51ccb4bd6 + 16f74cca9) [grades/r8-s2-v4 = 41/41; grades/r8-cards-o3-v4 = 40/41, FAIL D5 24.0 px vs 23.2].

## DEFECT (grader, native resolution)
B1::back view: diagonal crossing strands at rows 600-720, cols 300-400 (in the strands; the cards inherit them). Tail flares into a pear shape. Grader LOOKS_CLOSER back N, front N; tq Y, side Y.
B2::thin strand margins: B5.side 20.0% (limit 20), D3 0.97% (limit 1; r7 0.32), S4.back 9.8 deg (limit 10), D1 20.4% (limit 21.6; r7 12.8). layerMmPerMm 0.13 or seed+1 flips S1/B5/D1.
B3::cards: D5 24.0 px FAIL (limit 23.2; cards-r7/s1 20.0); S2 flip margin 1 px (gate 3; cards-r7/s1 had 5 with the same card recipe).

## TASK
T1::strands: remove the B1 crossings and the pear flare by finding their cause in the groom (as r8 found the part-away launch), keeping S1/S3 within the r8 G1 limits. Check seed robustness: the chosen recipe must hold 41/41 at seed and seed+1.
T2::cards: card-stage changes are allowed this round (r8 T2 freeze lifted). Fix D5 and the S2 flip margin.

## GATE
G1::strands 41/41 at two seeds; S3 ≤ 8.0, S1 |offset| ≤ 20 mm; D3 ≤ 0.8%, B5.side ≤ 19%, S4.back ≤ 9.0 deg.
G2::cards v4 + I19 41/41 or 40/41 with no item failing that passes in cards-r7/s1; S1 margin ≥ 3 mm; S2 flip ≥ 3 px.
G3::back and side 3-up sheets; describe the B1 region at native resolution before and after.

## RESULT envelope (≤ 250 words) as groom-r8, plus B1-B3 one line each with numbers.
END_BRIEF
