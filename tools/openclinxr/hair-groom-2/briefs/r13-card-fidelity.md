# BRIEF::hair-groom-2-r13-card-fidelity | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/r12-margins-su18.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/r13/<sub>
START::strands r12/strands/lh (seed) + lhg (seed+1) = su18 + lengthMm front 715, temples 695 [producer: 31/32 numeric both seeds, A3 censored; recipe in EV only, not committed]. Card recipe B (r10/tw35ta15sm2). Shipped pick stays r10 B until a card build here passes.
WHY::two card-stage rounds missed (r11 26-29/32, r12 29/32). The grok peer consult (D5) was not available: grok CLI not signed in. r12 measured the conversion costs; this round attacks them at source.

## DEFECT (r12 measured card-conversion cost on su18/lh)
K1::S1 band 950 -7.4 mm: --tip-spread-all draws tips 0-6 mm behind the strands. Cut-members-only spread passes S1 950 (-23.6).
K2::S4.front +5.8 deg: station chord sag across the crown. Station-power 1.5 cut S4.front 11.0 -> 6.9 but D5 -> 24.
K3::S3 R250 +4.8 deg; B5.side 163-168 tip columns (need 170).

## TASK
T0::commit the lh recipe change if it lands in the final pick (recipe JSON under groom/recipes/, option already exists).
T1::K1: restrict tip spread to cards whose tips are not on the side/back silhouette (silhouette-facing test as in fringe_subset.py), or spread forward along the strand instead of shortening behind it. Keep the runtime ragged tail (r10 C2 rows 840-866).
T2::K2: place stations by curvature / chord error to the strand polyline (max chord deviation in mm) instead of a power law, so crown cards follow the scalp without adding stations elsewhere; check D5 on every point.
T3::K3: locate the cards on R250 and the side hem tip columns (ray probe as r10/v1) and fix the conversion step responsible.
T4::every point: v4 + I19 numeric at seed and seed+1 card builds, drawn tris, notch counter, runtime crops for the pick.

## GATE
G1::cards 41/41 (numeric 32/32 + self visual 9/9 native res) at seed and seed+1; S1 margin >= 3 mm; drawn tris <= 66,000; notch <= 70 px; runtime tail still tapered.
G2::if G1 misses after 6 sub-rounds, report the per-item conversion cost table (strand value, card value, delta) for the best point and stop.

## RESULT envelope (<= 250 words): RESULT / SUBROUNDS / BEST / SELF_SCORE / K1-K3 one line each with numbers / COST / COMMIT / CHANGED / STILL / HARM / NOT TESTED.
END_BRIEF
