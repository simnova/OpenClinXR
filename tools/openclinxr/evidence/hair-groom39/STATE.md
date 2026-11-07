# groom39 STATE (E dir; store .npz NOT in git)

Goal (one line): test whether the ear-shell defect comes from children
blending guides from different ear regions (partition premise).

DONE (card complete — VERDICT: PREMISE FALSE, no build):
- Tree check: nothing staged/tracked-modified; HEAD 4bffb4d1f already is
  the groom38 collide commit, so the brief's FIRST commit was a no-op.
- Read prior art groom39.md (XGen region maps / Houdini Guide Partition).
- STEP 1 probe ran clean: E/premise39.py + E/classify39.py +
  E/breakdown39.py; E/premise39.json, E/breakdown39.json, E/RESULT.txt,
  E/DONE.txt written. Shell counts reproduce groom36 (2134/2043 segs,
  1136/1036 strands) via residual38.shell_mask + gates34 (import).
- Classes (2741 guides, +x computed, -x mirrored, pair dev 0.0 mm,
  direct/transfer agree 1366/1366): FRONT 1726, OVER 305, BEHIND 0,
  NONE 694, OTHER 16 (10 grazing + 6 lateral hug; none in shell sets).
  Planes: YF=-0.0462533, YB=-0.0907587, ZT=1.5532659, ZL=1.5082972.
- MIXED shell strands: +x 423/1136 = 37.2%, -x 421/1036 = 40.6% —
  both below the half line. Single-class shell strands all
  single-FRONT (713/615). STOP per card; no STEP 2 build, no renders.

ON DISK: E/hair-groom39/{premise39.py,classify39.py,breakdown39.py,
premise39.json,breakdown39.json,premise39.log,breakdown39.log,
RESULT.txt,DONE.txt,STATE.md}. No .npz in git (none written).

NEXT: commit `git add tools/openclinxr/hair-groom
tools/openclinxr/evidence/hair-groom39 && git commit --no-verify -m
"feat(hair-groom): ear region partition probe (premise false, no build)"`
(no .npz). Then turn ends (E/DONE.txt exists).

OPEN: none for this card. Future fixes must address intra-FRONT blend
geometry, not region membership (see RESULT.txt REMAINING).
