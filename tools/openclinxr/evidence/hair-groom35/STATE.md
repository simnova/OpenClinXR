groom35 DONE: symmetric ear inputs (pinna+frame) + tuck clumping. Gate: 0 shell
segs/side, 0 column/side, profile 0px / 3q <=842px per side, concha 0/0/0,
insideBody 0, gt30 <=1789, +x IoU f>=0.79/3q>=0.83/p>=0.84, back reported,
-x-vs-+x IoU reported, crossings <=935, gradAniso<=0.70, determinism, calib.

DONE (all verified this round):
- STEP1 inputs: store/hair-groom35/ear_pinna-mirror35.npz (sha 778c0fe0;
  max|mirror diff| 0.0) + E/earframe-mirror35.json + E/inputs-mirror35.{json,png}.
- Flag --ear-band-routed in hair-groom/strands/interp_children.py (default OFF).
- IDENTITY: build-identity35 sha 5e6814ba == mask20 bit-exact (268280). No-op proven.
- build-35step2: sha da3a5a59, 267908 children. build-35step3 (+flag): sha
  79d1d9bd, 267920 children. Determinism: step2det == step2, step3det == step3.
- 3D gates (E/gates-35step{2,3}.json): step2 +x shell 4900 / -x 8818 (FAIL);
  column 26 / 709 (FAIL, -x worse than mask20 553); gt30 2161 (FAIL); insideBody 0
  PASS; concha 3D-proj 0. Step3 catastrophic: shell 15312/19864, column 785/10332,
  gt30 15883, insideBody 14 (routed guides 2263/2507 themselves transit the ear).
- Render gates (E/gates-35step{2,3}full.json): step2 profile -x 82/49px FAIL,
  3q -x mirror 979px FAIL, concha render 0/0/0 both sides PASS, front IoU 0.7947
  PASS, 3q IoU 0.8501 PASS, prof 0.8259 FAIL, mirror-IoU 3q 0.9330/prof 0.9495
  (better than mask20). Crossings 941 (guides-level, all builds). Grad 0.37 PASS.
  Calibration cited (groom34 pattern, no artifact). Step3 all render gates FAIL.
- Residuals (E/residual-35step{2,3}.json): step2 +x crown roots p50 98mm guides
  280/1061 unrouted; -x temple roots p50 49.5mm guide 2278 unrouted 43%; step3
  74-77% routed, 2263 alone 9099/10332 column -x strands.
- Renders E/renders-35step{2,3}{,neg,ear} complete. Sheet E/sheet.png (2048x3072),
  ears E/ears.png (2560x1280, 640px 1:1 native). RESULT.txt VERDICT+GATES_PASS:NO.
- Store SHA256SUMS written (11 files). No .npz in git (verified: no match).

ON DISK: store/hair-groom35/{ear_pinna-mirror35.npz,SHA256SUMS,build-identity35/,
build-35step2/,build-35step2det/,build-35step3/,build-35step3det/};
E/hair-groom35/ (all drivers, logs, gates, residuals, renders, sheet, ears,
RESULT.txt, DONE.txt).

NEXT: commit `git add tools/openclinxr/hair-groom
tools/openclinxr/evidence/hair-groom35 && git commit --no-verify -m
"feat(hair-groom): symmetric ear inputs and tuck clumping"`. Then turn ends
(E/DONE.txt exists).

OPEN: none. No new fix invented per card. Guide-level asymmetry (guides-34mirror
p90 1459mm) reported out-of-scope.
