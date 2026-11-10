# Destructive probes for the rubric v4 SHAPE items (S1-S4). <blender python> probe_v4.py <scratch-dir>
# Base = the four a1 targets copied into a round dir with frame.json = the target frames (the I1/I9 self-score). Each
# probe plants one shape violation into a copy of one target view, grades it with grade.py, restores the original
# target image (revert) and grades again. Paint colour = the median of the target's own hair px next to the plant.
import json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '../../../..'))
SCR = os.path.abspath(sys.argv[1])
TG = os.path.join(WT, 'tools/openclinxr/hair-groom-2/targets')
FR = json.load(open(os.path.join(HERE, 'frames.json')))
SL = json.load(open(os.path.join(HERE, 'shape_landmarks.json')))
W709 = np.array([0.2126, 0.7152, 0.0722])
VIEWS = (('front', 'front'), ('three_quarter', 'three_quarter_left'), ('profile', 'side'), ('back', 'back'))


def grade(d):
    subprocess.run([sys.executable, os.path.join(HERE, 'grade.py'), d], check=True, capture_output=True)
    return json.load(open(os.path.join(d, 'measures.json')))['numericItems']


def target_round(name):
    d = os.path.join(SCR, name)
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for src, dst in VIEWS:
        shutil.copy(os.path.join(TG, 'target-%s-a1.png' % src), os.path.join(d, dst + '.png'))
    json.dump({v: {k: FR[v][k] for k in ('s', 'dx', 'dy')} for v in ('front', 'three_quarter', 'side', 'back')},
              open(os.path.join(d, 'frame.json'), 'w'))
    return d


def fr(view):
    f = FR[view]; s, dx, dy = f['s'], f['dx'], f['dy']
    return s, (lambda r: int(round(s * r + dy))), (lambda c: int(round(s * c + dx)))


def hair_colour(A, r0, r1, c0, c1):
    B = A[r0:r1, c0:c1].reshape(-1, 3); L = B @ W709
    return np.median(B[(L < 0.30) & ((B[:, 1] - B[:, 0]) <= 0.02)], 0)


def plant_s1(A):   # rearward bulge behind the neck: rear outline pushed out by up to 30 canonical px, rows 620-820
    s, R_, C_ = fr('side'); L = A @ W709
    col = hair_colour(A, R_(620), R_(820), C_(700), C_(800))
    for rc in range(620, 820):
        r = R_(rc); cs = np.where((L[r] < 0.47) & ((A[r, :, 1] - A[r, :, 0]) <= 0.02))[0]
        e = cs.max(); b = int(round(30 * s * np.sin(np.pi * (rc - 620) / 200)))
        A[r, e:e + b + 1] = col
    return A


def plant_s2(A):   # sideburn extended: the patch columns filled with hair from the target's sideburn end to 28 mm below the ear top
    s, R_, C_ = fr('side')
    rc_end = SL['earTopRow'] + 28.0 / SL['mmPerPx']
    col = hair_colour(A, R_(SL['earTopRow'] - 30), R_(SL['earTopRow']), C_(SL['cols'][0]), C_(SL['cols'][1]))
    A[R_(SL['earTopRow']):R_(rc_end), C_(SL['cols'][0]):C_(SL['cols'][1])] = col
    return A


def plant_s3(A):   # shoulder shelf: from canonical row 650 down, each outline edge stepped out by 50 canonical px
    s, R_, C_ = fr('back'); L = A @ W709
    col = hair_colour(A, R_(650), R_(850), C_(400), C_(620))
    for rc in range(650, 865):
        r = R_(rc)
        if r >= 1024:
            break
        cs = np.where((L[r] < 0.47) & ((A[r, :, 1] - A[r, :, 0]) <= 0.02))[0]
        cs = cs[(cs > C_(300)) & (cs < C_(724))]
        a, b = cs.min(), cs.max(); w = int(round(50 * s))
        A[r, max(0, a - w):a] = col; A[r, b + 1:b + 1 + w] = col
    return A


def plant_s4(view):   # flat-topped crown: hair filled from the crown apex row down to the outline over canonical cols 392-632
    def fn(A):
        s, R_, C_ = fr(view); L = A @ W709
        hair = (L < 0.47) & ((A[..., 1] - A[..., 0]) <= 0.02)
        tops = {c: int(np.where(hair[:R_(400), c])[0].min()) for c in range(C_(392), C_(632)) if hair[:R_(400), c].any()}
        apex = min(tops.values())
        col = hair_colour(A, apex, apex + int(40 * s), C_(470), C_(554))
        for c, t in tops.items():
            A[apex:t, c] = col
        return A
    return fn


PLANTS = (('S1', 'side', 'profile', plant_s1), ('S2', 'side', 'profile', plant_s2), ('S3', 'back', 'back', plant_s3),
          ('S4.front', 'front', 'front', plant_s4('front')), ('S4.back', 'back', 'back', plant_s4('back')))
rows = []
b0 = grade(target_round('probe4_base'))
for item, dst, src, fn in PLANTS:
    d = target_round('probe4_' + item)
    A = np.asarray(Image.open(os.path.join(d, dst + '.png')).convert('RGB')).astype(float) / 255
    Image.fromarray((np.clip(fn(A), 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(d, dst + '.png'))
    p = grade(d)
    shutil.copy(os.path.join(TG, 'target-%s-a1.png' % src), os.path.join(d, dst + '.png'))   # revert
    rv = grade(d)
    rows.append((item, b0[item], p[item], rv[item], {k: (p[k]['result'], rv[k]['result']) for k in p if k != item and p[k]['result'] != rv[k]['result']}))
for item, a, p, r, other in rows:
    print('%-8s base %s | planted %s | reverted %s | other items changed by the plant: %s' % (item, a['result'], p['result'], r['result'], other or 'none'))
    print('         planted : %s' % p['value'])
    print('         reverted: %s' % r['value'])
