# hair-groom38 STATE.md (worker card, 2026-10-19) — FINAL

Goal: shape-preserving ear collide on groom36 children; PRIMARY shell segs = 0/side.

DONE (all): ear_collide.py run 40 iters -> build-38 + build-38det, both sha 2f919fca05c2d5d7 (determinism PASS, two independent runs). calib PASS. gates-38full.json: shell 1934/1788 FAIL; column 0/0 PASS; gt30 2973 FAIL(+3); insideBody 0 PASS; concha -x 1/18 FAIL (regression); ear boxes profile 0/0, 3q 283/353 PASS; mirrorIoU 0.9734/0.9718. iou-38.json: front 0.7795 FAIL, 3q 0.8488 PASS, profile 0.8325 FAIL, back 0.8911. facefront-38.json: 2044/2062 both = 36 PASS; subLobe 124/120 (36: 153/153). residual-38.json: 1047/928 strands; blockers anteriorExit 1212/1135 + fleshTrapped 1189/1137 segs; seam 34/45 segs; rootProxy p50 40.4/40.6mm. cross 1029 FAIL. gradAniso 0.3471 PASS. length max 12.15/11.89 FAIL; bend max 9.49/10.97. sheet.png + ears.png written, visually read (no 37-style loops). RESULT.txt, DONE.txt written. SHA256SUMS in store.

ON DISK: E38/* (no .npz in git); store/hair-groom38/{build-38,build-38det,SHA256SUMS}.
