# Destructive probe for rubric v3.2 F1 (strand individuality). <blender python> probe_f1.py <scratch-dir> [base-round-dir]
# Base = a passing strand round (default groom-r4/s4), copied. Planted = the copy with a side-view hair region (canonical
# rows 400-600, cols 610-710: the only 200x100 box of r4/s4 side.png with >= 98% hair-mask cover; strands vertical) replaced
# by a smooth card-like band: vertical ribbons separated by 2 px gaps (hard parallel edges along the flow; ribbon width
# 30, 20 and 12 px = 3, 5 and 7 gaps across the 100 px box), coloured with the region's mean chromaticity, scaled so
# the region keeps its mean luminance and its high-pass RMS (L - gaussian 3 px, the A10/B8/I6 filter, over the region
# shrunk by 9 px). Reverted = the unplanted copy. All are graded with grade.py. A shape measure fails the planted copies;
# the v3.2 F1 dark-gap fraction does not move (rubric F1: report-only for that reason).
import json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '../../../..'))
SCR = os.path.abspath(sys.argv[1])
BASE = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(WT, '.openclinxr/evidence/hair-groom-2/groom-r4/s4')
W709 = np.array([0.2126, 0.7152, 0.0722])
REGION, RIBBONS, GAP, SHRINK = (400, 600, 610, 710), (30, 20, 12), 2, 9
IMG, ITEM, VIEW = 'side.png', 'F1.side', 'side'
src = open(os.path.join(HERE, 'grade.py')).read()
ns = {'__file__': os.path.join(HERE, 'grade.py')}
exec(src.split('# ---- per-view measurement')[0], ns)
gblur = ns['gblur']


def copy_round(name):
    d = os.path.join(SCR, name)
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for f in os.listdir(BASE):
        if f.endswith(('.png', '.json', '.npz')) and f != 'measures.json':
            shutil.copy(os.path.join(BASE, f), os.path.join(d, f))
    return d


def region_stats(A):
    L = A @ W709; hp = L - gblur(L, 3.0)
    r0, r1, c0, c1 = REGION; i = (slice(r0 + SHRINK, r1 - SHRINK), slice(c0 + SHRINK, c1 - SHRINK))
    return dict(meanL=float(L[r0:r1, c0:c1].mean()), hpRms=float(np.sqrt(np.mean(hp[i] ** 2))))


def plant(A, RIBBON):
    r0, r1, c0, c1 = REGION
    L = A @ W709; reg = A[r0:r1, c0:c1]
    chroma = reg.reshape(-1, 3).mean(0) / L[r0:r1, c0:c1].mean()
    p = np.where((np.arange(c1 - c0) % (RIBBON + GAP)) < GAP, -1.0, 0.0)
    p = np.tile(p - p.mean(), (r1 - r0, 1))
    i = (slice(SHRINK, r1 - r0 - SHRINK), slice(SHRINK, c1 - c0 - SHRINK))
    hp_p = np.sqrt(np.mean((p - gblur(p, 3.0))[i] ** 2))
    want = region_stats(A)
    Lp = want['meanL'] + p * (want['hpRms'] / hp_p)
    B = A.copy(); B[r0:r1, c0:c1] = np.clip(Lp[..., None] * chroma, 0, 1)
    return B


def grade(d):
    out = subprocess.run([sys.executable, os.path.join(HERE, 'grade.py'), d], check=True, capture_output=True, text=True).stdout
    return json.load(open(os.path.join(d, 'measures.json')))


os.makedirs(SCR, exist_ok=True)
rv = copy_round('reverted')
runs = []
for rw in RIBBONS:
    pl = copy_round('planted-%d' % rw)
    A = np.asarray(Image.open(os.path.join(pl, IMG)).convert('RGB')).astype(float) / 255
    # re-quantised exactly as the stored PNG; the stats are of what grade.py reads
    Image.fromarray(np.round(plant(A, rw) * 255).astype(np.uint8)).save(os.path.join(pl, IMG))
    Bq = np.asarray(Image.open(os.path.join(pl, IMG)).convert('RGB')).astype(float) / 255
    s0, s1 = region_stats(A), region_stats(Bq)
    print('ribbon %d px: region rows %d-%d cols %d-%d mean L %.4f -> %.4f, hp RMS (gauss 3 px) %.4f -> %.4f' % (
        rw, *REGION, s0['meanL'], s1['meanL'], s0['hpRms'], s1['hpRms']))
    runs.append(('planted-%d' % rw, pl))
runs.append(('reverted', rv))
res = {}
for name, d in runs:
    m = grade(d); it = m['numericItems']; f = m['f1']['round'][VIEW]
    res[name] = {k: v['result'] for k, v in it.items()}
    print('%-11s %s %s  q p1 %.3f  | numeric %d/%d' % (name, ITEM, m['f1']['wouldBe'][ITEM], f['qPercentiles']['1'], m['numericPass'], m['numericCount']))
for name, _ in runs[:-1]:
    d = {k: (res[name][k], res['reverted'][k]) for k in res[name] if res[name][k] != res['reverted'][k]}
    print('%s vs reverted, scored items that differ: %s' % (name, d or 'none'))
