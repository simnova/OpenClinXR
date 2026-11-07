# hair-groom34 STATE (worker, foreground) - CLOSED

Goal in one line: symmetric ear proxy + per-side gates; mirrored build; root-mask sweep; groom34 passing all gates both sides.

DONE (all steps executed; VERDICT FAIL, measured):
- CAL: calibrate31.py EXACT (groom8a 0.7446/0.8261/0.8543/0.8579, deltas 0).
- 1a PROXY: hair-groom/strands/ear_proxy.py; store ear-proxy.npz; E/ear-proxy.json, ear-coverage.png, ear-overlay33-xpos/-xneg.png.
- 1b GATES: hair-groom/strands/gates34.py + E/run_gates34.py; E/cameras-mirror34.json, E/cameras-ear34.json.
- RENDERS groom33: E/renders-33neg + E/renders-33ear (Blender quit cleanly).
- 1c/1d: E/before.json + E/before-sheet.png (groom33 numbers in RESULT.txt).
- STEP2: mirror34.py fixed (donor-mirror roots; guides-8amirror.npz ref); E/mirror-stats.json, mirror-ref-stats.json, mask{10,15,20}-stats.json.
- STEP3 sweep + full mask20: E/gates-{nomask,mask10,mask15,mask20}.json, E/iou-mask.json (+profile 0.8265/back 0.8925 computed identical-def), E/metrics-cross34.json (941), E/metrics-grad34.json (opt34 0.3712), det rebuild bit-exact sha 5e6814ba18206707.
- OUTPUTS: E/before.json, E/sheet.png (symlinks renders-34{,-neg,-ear} -> mask20), E/ears.png (1:1, groom33 vs mask20), E/RESULT.txt (VERDICT FAIL, all gates, VISUAL), E/DONE.txt.
- No .npz in git: store lives /Volumes/files/openclinxr-assets/store/hair-groom34/.

KEY NUMBERS (mask20 = candidate): shell 4914/12191 segs; column 22/553 str; concha-xneg 7702/195/10584; 3q-xneg box 1146px; prof-xneg box 12px; gt30 2094; IoU +x 0.7838/0.8501/0.8265/0.8925; mirrorIoU 0.8997/0.9294; crossings 941; gradAniso 0.3712; det MATCH.
NEXT: commit `git add tools/openclinxr/hair-groom tools/openclinxr/evidence/hair-groom34 && git commit --no-verify -m "feat(hair-groom): symmetric ear proxy, per-side gates, mirrored build"` (no .npz). Then end turn.
OPEN (for next card): guide-ROUTING defect - far roots (48-98mm) route across shell; entries y~-52 z~1540 front-mid ear; gt30 = back curtain |x|~45. Fix in routing/root class. Asymmetric lobe-drop/sideburn-cap stages suspect on side -1 (unmeasured).
