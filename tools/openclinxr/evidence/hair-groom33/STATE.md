# hair-groom33 STATE (final this round)

Goal (one line): build-31's exact children recipe WITHOUT --lobe-sweep-postcap, render/score/gate it.

DONE (all in this round):
- STEP 1: calibrate31.py rerun EXACT (groom8a 0.7446/0.8261/0.8543/0.8579, deltas 0).
- STEP 2: built store/hair-groom33/strands.npz (sha 4034cf7b...70c89) + build.json +
  inputs-opened.txt + SHA256SUMS. lobePostSweep OFF, capReproject on/0-inside, shirtKeepout on.
- STEP 3: Blender 5.1.1 renders-33 (1024/64spp/seed7, E/render33.log). Scored: score31-33
  (front 0.7997 / 3q 0.8514 / profile 0.8375 / back 0.7753; insideBody 0; concha 0/0/0;
  faceMaskFront PASS 3131<=3424.9; ctrl row bit-identical), earlobe-gate31 (3D 26+11=37;
  img 3q 841 / profile 0), shirt-gates33 (insideShirt 79360; hem L 0.0728 / R 0.3525),
  metrics-grad31 (opt33 0.6255; opt30/opt31 repro exact), metrics-cross33 (935).
- STEP 4: segments gt30 groom33 1789 = groom30 (nearHz 230 = 230; max 90.6mm) vs build-31 36197/29578.
- STEP 5: det-33.json pass=true (sha identical, maxAbsDiff 0.0mm).
- OUTPUT: E/sheet.png + E/crops.png (rows target|groom30|groom33; visual read in RESULT.txt),
  E/RESULT.txt (VERDICT sweep-confirmed/1-gate-miss, honest GATES_PASS: NO).

ON DISK: E = STATE.md, build33.log, render33.log, score33/earlobe33/grad33/cross33/shirt33/det33 logs,
run_score33/run_earlobe33/run_grad33/run_cross33/run_shirt33/det_rebuild33/make_sheet33 .py,
score31-33.json, earlobe-gate31.json, shirt-gates31.json (repro) + shirt-gates33.json,
metrics-grad31.json, metrics-cross33.json, det-33.json, renders-33/ (18 PNG + opened.txt +
render-times.json), sheet.png, crops.png, RESULT.txt, DONE.txt.
Store hair-groom33/ = strands.npz + build.json + inputs-opened.txt + SHA256SUMS (NOT in git).

NEXT: commit `git add tools/openclinxr/evidence/hair-groom33` (no .npz in E to exclude) --no-verify.

OPEN PROBLEMS: profile IoU 0.8375 < 0.84 by 0.0025 (profile-bot hem miss depth 18.0 vs 14.8,
+654 miss px at identical excess) — next card's only gap; everything else at groom30 parity.
