# groom36 STATE (evidence dir; store .npz NOT in git)

Goal (one line): route +x guides against the inflated 3 mm ear shell,
then exact-mirror guides+roots, then children on the symmetric set.

DONE (all steps complete this round):
- STEP1 guide gate verified: guide segs in +x shell 0, -x shell 0
  (guides-36routed.npz + guides-36.npz curves_head, gates34 def).
- STEP2 symmetry verified: construction 0.0 mm all 1366 guide + 6752
  root pairs; new-1264=orig2507, new-541=orig1061, new-2639=mirror(2507).
- STEP3: build-36 sha dc1e2df2 == build-36det sha (determinism PASS).
- Renders: std/profback/neg/ear all rc=0, ALLDONE in render36-chain.log.
- Gates: gates-36full.json (imgStd/imgMirror/mirrorIou), iou-36.json
  (front 0.7794 FAIL / 3q 0.8489 PASS / profile 0.8326 FAIL /
  back 0.8911), metrics-grad31.json opt36 0.3471 PASS,
  groom8a-calc36-calib.json delta 0 PASS, metrics-cross36.json 1029 FAIL.
- E/sheet.png, E/ears.png written; visual read in RESULT.txt.
- E/RESULT.txt (VERDICT FAIL, gate table, residual, scope), E/DONE.txt.

NUMBERS: shell segs +x 2134 / -x 2043 FAIL; column 53/56 FAIL;
concha 0/0/0 both PASS; insideBody 0 PASS; gt30 2970 FAIL (cap 1789);
profile box +x std 0 / -x mirror 0 PASS; 3q box +x 281 / -x 357 PASS;
mirror IoU 0.9731/0.9717; crossings 1029 FAIL (cap 935).

ON DISK: store/hair-groom36/{step1/, guides-36.npz, roots-36.npz,
pool-ref-36.npz, build-36/, build-36det/}; E/hair-groom36/ complete.

NEXT: commit (hair-groom + evidence, no .npz) and end turn.

OPEN: zero-gates fail at child level (shell/column/gt30/crossings);
no new fix per card; next card owns the interpolation-blend fix.
