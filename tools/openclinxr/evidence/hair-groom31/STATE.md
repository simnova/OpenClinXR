# hair-groom31 STATE (final this round)

Goal: shirt-as-obstacle + gravity settle; clear groom30's insideBody (2638) and earlobe grazers (37).

DONE (all in this round):
- Settle finished: E/build-31-settle/{strands-settled.npz, settle.json}; dropFree mean 7.738/max 106.6/p90 24.09; contact 25.4%->28.1%; lenChange mean 0.03655mm MAX 21.6mm.
- store/strands-31.npz = settled (sha 0a65920c, verified); E/settle31.json fresh; store SHA256SUMS extended.
- Rendered E/renders-31 (Blender 5.1.1, 1024/64spp, seed 7; log /tmp/render31.log).
- shirt-gates31: insideBody crude 93198 (groom30 crude 95836); inside-shirt crude 105365 (groom30 235156); hem R 11735 samples 59.2% behind (groom30 34.0%); hem L 22.8% behind (groom30 7.2%).
- score31 (--ref ctrl --test 31): front 0.7685 / 3q 0.6323 / profile 0.7128 / back 0.7851; insideBody canonical 0 PASS; concha 6674/2483/8239 FAIL; faceMaskFront FAIL.
- cross31: 935 PASS. grad31: opt31 0.4886 PASS (fixed opt30 path to hair-groom30/renders-30; opt30 0.6257).
- earlobe31: 3D 76+69=145 strands FAIL; profile box 5501 FAIL; 3q box 4528 vs target 842 FAIL (fixed renders-30 path).
- det_rebuild31: pass=false — RECIPE MISMATCH (rebuild used --lobe-tuck, build-31 has lobeTuck off), nondeterminism NOT proven. Calibration re-ran EXACT.
- make_sheet31: E/sheet.png + E/crops.png. RESULT.txt + DONE.txt written.
- No .npz in git (store + E/build dirs excluded at add time).

NEXT:
1. Commit: git add E files (no .npz) + strands/*.py; commit --no-verify.
2. Nothing else — card complete with honest GATES_PASS: NO.

OPEN PROBLEMS (for next round, not this one):
- Settle formulation rework needed (not tuning): 3q -0.22, earlobe re-fill, concha flood, nape contact loss.
- Children determinism proof needs exact-recipe rebuild.
