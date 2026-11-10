# Destructive probes for the rubric v3 numeric items (D1-D5, E1). <blender python> probe_v3.py <scratch-dir> [r3-round-dir]
# Each probe plants one violation into a copy of a passing input, grades it with grade.py, and grades the unplanted
# copy again (revert). Pass base for D1-D5: the four a1 targets copied into a round dir with frame.json = the target
# frames (the I1 self-score). Pass base for E1: no in-tree groom has sideburn roots, so the base is a copy of the r3
# strands.npz with roots added in the above-ear and sideburn patches at the reference-patch density (both sides).
import json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '../../../..'))
SCR = os.path.abspath(sys.argv[1])
R3 = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(WT, '.openclinxr/evidence/hair-groom-2/groom-r3/s6')
TG = os.path.join(WT, 'tools/openclinxr/hair-groom-2/targets')
FR = json.load(open(os.path.join(HERE, 'frames.json')))
W709 = np.array([0.2126, 0.7152, 0.0722])


def grade(d):
    subprocess.run([sys.executable, os.path.join(HERE, 'grade.py'), d], check=True, capture_output=True)
    return json.load(open(os.path.join(d, 'measures.json')))['numericItems']


def target_round(name):
    d = os.path.join(SCR, name)
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for src, dst in (('front', 'front'), ('three_quarter', 'three_quarter_left'), ('profile', 'side'), ('back', 'back')):
        shutil.copy(os.path.join(TG, 'target-%s-a1.png' % src), os.path.join(d, dst + '.png'))
    json.dump({v: {k: FR[v][k] for k in ('s', 'dx', 'dy')} for v in ('front', 'three_quarter', 'side', 'back')},
              open(os.path.join(d, 'frame.json'), 'w'))
    return d


fb = FR['back']; s, dx, dy = fb['s'], fb['dx'], fb['dy']
R_ = lambda r: int(round(s * r + dy)); C_ = lambda c: int(round(s * c + dx))


def plant_d1(A):   # X seam: thin dark strands at +-25 deg converging on the midline, canonical rows 300-560
    L = A @ W709
    for r in range(R_(300), R_(560)):
        for c in range(C_(440), C_(584)):
            u = (c - C_(512)) * np.sign(c - C_(512) + 0.5)          # distance from the midline
            if int(round(u - 0.466 * (r - R_(300)))) % 7 == 0:       # tan 25 deg
                A[r, c] = A[r, c] * 0.25 + 0.75 * np.array([0.33, 0.26, 0.20])
    return A


def plant_d2(A):   # translucent sheet: 40 px outside the left opaque edge set to a 50/50 hair-backdrop mix, rows 760-1023
    L = A @ W709
    hair = np.array([0.10, 0.08, 0.07])
    for r in range(R_(640), 1024):
        c = C_(512)
        while c > 0 and (L[r, max(0, c - 4):c] < 0.2).any():
            c -= 1
        lo = max(0, c - int(round(40 * s)))
        A[r, lo:c] = 0.5 * A[r, lo:c] + 0.5 * hair
    return A


def plant_d3(A):   # shoulder shelf: three 12 px layers inside the hair darkened to 0.5x (two horizontal edges each),
    for rc in (590, 625, 660):    # canonical rows 590/625/660; the hair stays dark, so the opaque-hair mask keeps them
        r = R_(rc); h = int(round(12 * s))
        A[r:r + h, C_(380):C_(640)] *= 0.5
    return A


def plant_d4(A):   # copper rim: outer 30 px of each crown edge, canonical rows 170-300, tinted copper
    L = A @ W709
    for rc in range(170, 300):
        r = R_(rc); cs = np.where(((A[r].max(-1) - A[r].min(-1)) >= 0.015) & (L[r] < 0.6))[0]
        if len(cs) < 10:
            continue
        w = int(round(30 * s))
        for lo, hi in ((cs.min(), cs.min() + w), (cs.max() - w, cs.max())):
            A[r, lo:hi] = 0.5 * A[r, lo:hi] + 0.5 * np.array([0.55, 0.30, 0.14])
    return A


def plant_d5(A):   # pale scalp dot: 30 canonical px disc of scalp colour 15 px below the crown top
    L = A @ W709
    top = int(np.where((L[:, C_(512) - 20:C_(512) + 20] < 0.47).any(1))[0].min())
    rc, cc, rad = top + int(round(18 * s)), C_(512), 15 * s
    yy, xx = np.mgrid[0:1024, 0:1024]
    m = (yy - rc) ** 2 + (xx - cc) ** 2 <= rad ** 2
    A[m] = np.array([0.62, 0.52, 0.47])
    return A


rows = []
base = target_round('probe_base')
b0 = grade(base)
for item, fn in (('D1', plant_d1), ('D2', plant_d2), ('D3', plant_d3), ('D4', plant_d4), ('D5', plant_d5)):
    d = target_round('probe_' + item)
    A = np.asarray(Image.open(os.path.join(d, 'back.png')).convert('RGB')).astype(float) / 255
    Image.fromarray((np.clip(fn(A), 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(d, 'back.png'))
    p = grade(d)
    shutil.copy(os.path.join(TG, 'target-back-a1.png'), os.path.join(d, 'back.png'))   # revert
    rv = grade(d)
    rows.append((item, b0[item], p[item], rv[item]))

# ---- E1 ------------------------------------------------------------------------------------------
bb = json.load(open(os.path.join(HERE, 'body_back.json')))
src = np.load(os.path.join(R3, 'strands.npz'))
P, Lp, off = src['positions'], src['localPositions'], src['offsets']
# head-local -> world: solve the affine map from the round's own points (localPositions = R (positions - origin))
X = np.c_[Lp[::997], np.ones(len(Lp[::997]))]
M, *_ = np.linalg.lstsq(X, P[::997], rcond=None)
rng = np.random.default_rng(7)
add = []
for name, sg in (('L', 1.0), ('R', -1.0)):
    q = Lp[off[:-1]] * 1000 * np.array([sg, 1, 1])
    pb = bb['patches'][name]
    ref = pb['reference']
    nref = np.sum((q[:, 0] >= 40) & (q[:, 1] >= ref['y'][0]) & (q[:, 1] < ref['y'][1]) & (q[:, 2] >= ref['z'][0]) & (q[:, 2] < ref['z'][1]))
    dens = nref / ref['areaMm2']
    for k in ('aboveEar', 'sideburn'):
        b = pb[k]
        n = int(np.ceil(dens * b['areaMm2']))
        y = rng.uniform(*b['y'], n); z = rng.uniform(*b['z'], n)
        x = np.full(n, b['meanAbsXMm'] + 1.0) * sg
        add.append(np.c_[x, y, z] / 1000.0)
add = np.concatenate(add)
loc = np.repeat(add, 2, axis=0); loc[1::2, 2] -= 0.05                      # 2-point strands, tip 50 mm below the root
world = np.c_[loc, np.ones(len(loc))] @ M


def write_npz(d, lp, w, o):
    os.makedirs(d, exist_ok=True)
    np.savez_compressed(os.path.join(d, 'strands.npz'), positions=w, localPositions=lp, offsets=o)
    for f in ('front.png', 'three_quarter_left.png', 'side.png', 'back.png'):
        shutil.copy(os.path.join(R3, f), os.path.join(d, f))


off2 = np.concatenate([off, off[-1] + 2 * np.arange(1, len(add) + 1)])
lp2, w2 = np.concatenate([Lp, loc]), np.concatenate([P, world])
e_base = os.path.join(SCR, 'probe_E1')
write_npz(e_base, lp2, w2, off2)
g_pass = grade(e_base)
# planted violation: delete every root (whole strand) whose root lies in either sideburn patch
roots = lp2[off2[:-1]] * 1000
kill = np.zeros(len(roots), bool)
for name, sg in (('L', 1.0), ('R', -1.0)):
    b = bb['patches'][name]['sideburn']; q = roots * np.array([sg, 1, 1])
    kill |= (q[:, 0] >= 40) & (q[:, 1] >= b['y'][0]) & (q[:, 1] < b['y'][1]) & (q[:, 2] >= b['z'][0]) & (q[:, 2] < b['z'][1])
keep_pts = np.repeat(~kill, np.diff(off2))
off3 = np.concatenate([[0], np.cumsum(np.diff(off2)[~kill])])
write_npz(os.path.join(SCR, 'probe_E1_cut'), lp2[keep_pts], w2[keep_pts], off3)
g_cut = grade(os.path.join(SCR, 'probe_E1_cut'))
g_rev = grade(e_base)   # revert = the unplanted copy
for side in 'LR':
    rows.append(('E1.' + side, g_pass['E1.' + side], g_cut['E1.' + side], g_rev['E1.' + side]))

print('added roots %d (both sides, both patches); sideburn roots deleted %d' % (len(add), int(kill.sum())))
for item, a, p, r in rows:
    print('%-5s base %s | planted %s | reverted %s' % (item, a['result'], p['result'], r['result']))
    print('      planted : %s' % p['value'])
    print('      reverted: %s' % r['value'])
