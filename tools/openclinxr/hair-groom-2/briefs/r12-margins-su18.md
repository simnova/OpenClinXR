# BRIEF::hair-groom-2-r12-margins-su18 | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/r11-side-seed.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/r12/<sub>
START::strands r11/su18 + su18g (recipe + earTuck.settleYMm 18, a4d2fde8e) [grades/r11-strands-v4: 41/41 at both seeds; thinner margins than groom-r9/s1]. Card recipe B (r10/tw35ta15sm2: twist 35, cut-tip-spread 0.15 --tip-spread-all, sm2) [grades/r10-v4 41/41, current shipped pick]. Card chains on su18 (r11/b18sm2, b18gsm2, b17gsm2) score 26-29/32.

## DEFECT (grades/r11-strands-v4, r11 producer)
M1::strand margins narrowed vs groom-r9/s1: S1 band 950 0 -> 7.9 mm, bands 750/800/850 7.3/3.7/4.4 -> 9.6/5.7/5.7 mm; I7/A3 tip median 1.8 -> 0.6 mm to the 1.196 m edge; D3 0.25 -> 0.62%; S3 L800 6.0 -> 7.5.
M2::card conversion on su18 fails S1 950 (-25.03), A3 (+25.2), S3 R250 (10.7), S4.front (11.0), E1.R (0.44), B5.side (169).
M3::side ledge on the collar unchanged (grader: drop at c610-615, flat rows 638-646 to c665, same as s1); the r11 producer claimed V2 gone. su18g side see-through comb rows 580-635 cols 605-655 (457 skin px vs 167 in s1).
M4::su18 back: 3-5 loose strands outside left outline rows ~710-830 cols ~303-323.

## TASK
T1::strands: restore margins on su18 at both seeds to at least groom-r9/s1 values (S1 per band, I7, D3) without losing seed robustness (B5.side >= 170 tip cols at seed and seed+1). Procedural/recipe; find what the settle change moved (tip length, hem rise, layer push) rather than re-tuning blind.
T2::cards: measure the card-conversion cost per item on su18 (S3 R250, S4.front, E1.R, S1 950, A3) and fix the conversion causing it at its source (which cards, which stage: clustering, twist limit, tip spread, simplify).
T3::M3/M4 at native resolution with crop coords before/after; resolve the V2 disagreement with one measurement both sides accept (r10/v2edge.py on strands AND cards, same rows/cols).

## GATE
G1::strands 41/41 at seed and seed+1; margins in M1 no worse than groom-r9/s1.
G2::cards (B recipe or better) 41/41 at seed and seed+1 strands; S1 margin >= 3 mm; drawn tris <= 66,000; notch <= 70 px.
G3::runtime crops (--body-frame 1.5) for the seed card build; rtm7b counts.

## RESULT envelope (<= 250 words): RESULT / SUBROUNDS / BEST / SELF_SCORE / M1-M4 one line each with numbers / COST / COMMIT / CHANGED / STILL / HARM / NOT TESTED.
END_BRIEF
