# BRIEF::hair-groom-2-cards-r4 | FORMAT::DENSE_v1 | ROLE::worker
W::/Users/patrick/.grok/worktrees/src-openclinxr/hair-groom-2 (branch wt/hair-groom-2)
EV::W/.openclinxr/evidence/hair-groom-2/cards-r4/<sub>
START::groom round groom-r7/s1 [grades/r7-s1-v4 = 41/41, PICK r7]; card pipeline tools/openclinxr/hair-groom-2/cards/ at HEAD (run_cards.sh, ATLAS=members, cards-r3 recipe: 1,200 cards, 16x204 cells in a 2048 atlas, alpha 1-(1-coverage)^3, blend cutoff 0.2, shadow rays 0.2x alpha).
OP::2026-11-08 "keep iterating and trying and judging the output to find the most realistic match, then work on optimizing it". OP 2026-11-07 on cards-r2: "looks like clumps of hair ribbons ... lost the "individual strands" feeling".

## DEFECT (measured; re-measure before acting)
R1::alpha is binary at runtime. aisha-cards-r3.glb hair_cards alphaMode MASK cutoff 0.2; 81.5% of non-zero atlas alpha is 0.2-0.99, all of it rendered fully opaque. Offline render also cuts at 0.2.
R2::flat value inside a card. Kept atlas px RGB sd 5.6/5.0/5.0 of 255 on mean (93, 85, 80): strands merge into a sheet.
R3::no strand-direction shading. No tangent/flow map; runtime specular reads as square tiles because transplant_library_hair.py drops KHR_materials_specular (donor GLB has it).
R4::runtime atlas resized 2048 -> 1024 (cells 8x102 px).
R5::grader cards-r3: sideburn renders as 3-4 opaque blades (tq r300-360 c575-640, side r320-390 c470-520); back reads as a smeared sheet (high-pass 0.0063 vs strands 0.0099); front part ladder 24-34 px (rows 156/170/198).

## METHOD (research first, D5; automation, not hand-authored geometry, D1)
M1::offline: render cards with true alpha blending of the baked partial alpha (no cutoff on colour), so the offline round shows what a soft-alpha runtime would.
M2::bake per-strand value variation and inter-strand self-shadow into each cell (from the member strands' own render, not noise), so R2 sd rises toward what the strand round shows in the same crop.
M3::runtime GLB: keep the 2048 atlas; carry material extensions through transplant_library_hair.py (tools/openclinxr/asset-pipeline/makeclothes/, shared tool: change it additively, keep existing callers' output byte-identical when the new flag is off); add a strand-direction (anisotropy) map via KHR_materials_anisotropy if three.js in apps/ui-xr reads it, else record why not; soft edges at runtime via alpha-to-coverage or a two-pass (opaque core MASK + BLEND fringe) material split — pick by what three.js in this repo supports, cite the file.
M4::sideburn and back: bake those clusters from strands like the rest; narrower cards where member strands are few.

## GATE
G1::rubric v4 self-score on the offline card round (grade.py; card-round instrument rules I13/I15 apply). SUCCESS ≥ 37/41 and no item that passed in grades/cards-r3-s6-v4 or grades/r7-s1-v4 fails, except items r7-s1-v4 passes only through groom features cards cannot carry — name any such item with the measurement.
G2::F1 (report-only) on front/tq/side: record vs cards-r3 6.57/1.49/2.17% and strands r7/s1 (measure it).
G3::runtime head crops (cards/head_crops.ts) of the new GLB in all available views at native 1024; write a per-crop checklist: soft edges visible Y/N, square specular tiles Y/N, sideburn blades Y/N, part ladder px.
G4::determinism: two runs, same hashes for cards.npz, atlas, donor GLB.
G5::runtime cost recorded: tris, cards, atlas bytes, material count, draw calls (for the later optimisation step).

## ITERATION
Up to 6 sub-rounds. Commit code per landed sub-round (only files you change). Never commit in /Volumes/files/src/openclinxr or /Volumes/files/src/OpenClinXR; never --no-verify, push, RUST_LOG, stash, reset, switch branches. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## RESULT envelope (≤ 250 words)
RESULT::cards-r4 / SUBROUNDS / BEST / SELF_SCORE n/41 with FAIL ids / F1 / runtime checklist / G4 / COST / COMMIT / CHANGED one line each / STILL / BRIEF_MISSING / HARM / NOT TESTED
END_BRIEF
