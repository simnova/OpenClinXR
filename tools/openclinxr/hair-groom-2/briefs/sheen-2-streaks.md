# BRIEF::hair-groom-2-sheen-2-streaks | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/sheen-light-match.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/sheen2/<sub>
OP::2026-11-09 "Yes, run it" (darken the hair and add strand-level streaks to the highlight).
START::r10 B runtime (EV/r10/rt-tw35ta15sm2) with the fitted rig EV/sheen/fitted-rig.json held FIXED (commit 474d2b3a7). Sheen measures and tables: EV/sheen/sheen-table*.json, l5-scores.json, tools under EV/sheen/tools.

## DEFECT (sheen round, fitted rig)
H1::brightness: r10 peak L 0.42-0.58 vs target 0.25-0.33; base 0.25-0.27 vs 0.09-0.13. Albedo scale lowers base only; specular sets peak.
H2::highlight form: one smooth crescent (side 1.8 runs/row, band width 0.07) vs target fine strand streaks (12 runs/row, width 0.53, band row 0.49).
H3::producer-unreported, seen at 1:1 in sheen/strips/crown-side.png fitted panel: blocky vertical bands behind the ear (card texture cells visible once brighter).

## TASK
S1::joint material fit on the fitted rig: albedo scale x specular x roughness x anisotropy strength (KHR_materials_anisotropy) x specular colour, small grid then refine. Score with the sheen metrics on hair only (peak, base, contrast, band row/width, runs/row, hue). Report the Pareto points, not one number.
S2::streaks: give the highlight per-strand variation at source. Candidates: per-member brightness / specular jitter baked into the atlas (an extra channel or albedo variation per member in atlas_from_members.py), an anisotropy-direction or roughness map from member ids, per-member tangent jitter. Procedural, seeded, opt-in, defaults byte-identical. Prefer three.js built-in material inputs that GLTFLoader already reads (cite the loader path); no custom shaders unless no built-in input can do it.
S3::H3: find whether the blocks are atlas cell edges, mip/alpha, or card overlap; fix if it is cheap at source.
S4::every point: crops under the fitted rig (head_crops --light-rig) AND under default lighting (the default view must not get worse at 1:1), drawn tris unchanged, GPU texture bytes (an extra map costs memory: report it).

## GATE
G1::best point closer to target than r10 on peak, base AND runs/row in the side view, and on peak/base in every view; numbers per view.
G2::1:1 strips per view: target | r10 fitted | best S1 | best S1+S2, plus default-light strips r10 | best.
G3::geometry and rubric numeric unchanged (32/32 on r10 B; material-only changes should not move grade.py, confirm).

## RESULT envelope (<= 250 words): RESULT / BEST (params) / SHEEN per view target vs r10 vs best / S2 method / H3 / COST (texture bytes) / COMMIT / CHANGED / STILL / HARM / NOT TESTED.
END_BRIEF
