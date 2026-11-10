# Round 3, zoom-out (Goldfish), raw findings, unresolved

- R3Z1 Major [P0-P2] no viewer-visible change before P3; anti-toil rule. Fix: ship a cheap visible step first (A2C on existing MASK; hairline/part).
- R3Z2 Major [P4 order] hairline and part wedge dominate the face region and depend on neither P2 nor P3. VERIFIED by eye (sheen3b strips). Fix: move P4 ahead or in parallel.
- R3Z3 Major [card gate] abs(card - strand) <= seed spread over ~40-50 metric/view/rig cells at the two-seed noise floor will stall like r11-r14. UNVERIFIED until spread measured. Fix: grader ranks cards closer to strands than BEST3 per view, tolerance max(seed spread, fixed floor), round cap per metric.
- R3Z4 Major [P1/OP5] targets are CG renders of the same MPFB Aisha (neck seam, horizon floor; VERIFIED); a scene file would give light, BSDF, maybe groom. Fix: OP5 blocks the P1 sweep.
- R3Z5 Major [K5/P2] unique 16x170 px cells (14 px inner) per card, 1410 cards, median width 9.9 mm: ~1.4 px/mm across strands, ~0.5 px/mm along; crops sample ~1.9 px/mm, so atlas is magnified in every graded view and may explain the streak deficit blamed on R-b. cards_from_strands.py:92-93, :360; r10/tw35ta15sm2/cards.npz. Numbers VERIFIED, effect UNVERIFIED. Fix: texel-density row; probe a shared clump-texture atlas (8-16 textures, 128+ px across) vs BEST3 before P2 commits to unique cells.
- R3Z6 Major [gallery] strips mix tight target crop with wider render panels and different backgrounds; eye comparison impossible. VERIFIED (sheen3b/strips). Fix: strips at frames.json px/mm and matched background, in P1.
- R3Z7 Nit [P3 step 0a] the no-map control at spec .15 is independent of P1/P2. Fix: run now.
- R3Z8 Nit [Problem] strand volume over crown/temple may be short of target; P0 freezes it as truth. UNVERIFIED. Fix: grader judges strands vs target volume before P0 freeze.
