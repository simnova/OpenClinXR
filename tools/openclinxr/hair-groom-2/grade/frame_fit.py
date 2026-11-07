# Fits the canonical->target pixel frames used by grade.py v2 and writes frames.json.
#   <blender python> frame_fit.py [reference-round-dir]
# Canonical frame = the groom renderer's camera (groom.py camera_rig: 85 mm, frame height 0.57 m at the head plane,
# horizontal axis), i.e. the pixel grid of every groom round. A frame (s, dx, dy) maps canonical (row, col) to target
# pixels: row_t = s*row + dy, col_t = s*col + dx.
#   side  : body-landmark fit. The shipped body's side face silhouette (body_side.json, faceFront) is fitted to the
#           target profile's skin front edge, rows 380-565 (nose to chin; the target forehead deviates from the body by
#           up to 6 px), solving z = (r0 - row)*k. The same fit on the reference round's side render recovers the known
#           camera (check printed). The eye row (eye bone z) is the independent check.
#   front : image-to-image fit of the jaw skin edges (both sides) of the reference round's front render to the target.
#   three_quarter: the target camera azimuth differs from ours (eye spacing / eye-chin height 0.35 vs 0.40), so a
#           similarity is fitted by least squares to four hand-measured landmarks (both pupils, lip line, chin).
import json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '../../../..'))
REF = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(WT, '.openclinxr/evidence/hair-groom-2/groom-r1/r6')
TG = os.path.join(WT, 'tools/openclinxr/hair-groom-2/targets')
W709 = np.array([0.2126, 0.7152, 0.0722])
K_R = 0.57 / 1024  # canonical metres per pixel at the head plane
body = json.load(open(os.path.join(HERE, 'body_side.json')))
fz = np.array(body['faceFront_z_minY'])
yf = lambda z: np.interp(z, fz[:, 0], fz[:, 1])
st = json.load(open(os.path.join(REF, 'stats.json')))
ZC = st['render']['camera']['targetZ']


def load(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(float) / 255


def skin(A):
    return ((A[..., 0] - A[..., 2]) > 0.07) & (A @ W709 > 0.35)


def front_edge(A, rows):
    S = skin(A); out = []
    for r in rows:
        c = np.where(S[r, :700])[0]
        if len(c):
            out.append((r, c.min()))
    return np.array(out, float)


def fit_profile(xs, k_fixed=None, r0_fixed=None):
    best = None
    ks = [k_fixed] if k_fixed else np.arange(0.00045, 0.00070, 0.000001)
    for k in ks:
        r0s = [r0_fixed] if r0_fixed else np.arange(2400, 4200, 0.5)
        for r0 in r0s:
            z = (r0 - xs[:, 0]) * k
            if z.min() < 1.405 or z.max() > 1.675:
                continue
            pc = yf(z) / k
            x0 = np.median(xs[:, 1] - pc)
            e = np.mean(np.abs(xs[:, 1] - pc - x0))
            if best is None or e < best[0]:
                best = (float(e), float(k), float(r0), float(x0))
    return best


out = {'canonical': dict(kMetresPerPx=K_R, targetZ=ZC, reference=os.path.relpath(REF, WT))}
# ---- side ----
ref_side = front_edge(load(os.path.join(REF, 'side.png')), range(380, 566))
free = fit_profile(ref_side)
known = fit_profile(ref_side, K_R, 511.5 + ZC / K_R)
tgt = front_edge(load(os.path.join(TG, 'target-profile-a1.png')), range(380, 566))
ft = fit_profile(tgt)
ft_wide = fit_profile(front_edge(load(os.path.join(TG, 'target-profile-a1.png')), range(240, 566)))
e, kt, r0t, x0t = ft
s = K_R / kt
x0r = known[3]
out['side'] = dict(s=s, dy=r0t - ZC / kt - 511.5 * s, dx=x0t - s * x0r,
                   fit=dict(target_k=kt, target_r0=r0t, target_x0=x0t, meanAbsErrPx=e, rows=[380, 565]),
                   fit_rows240_565=dict(k=ft_wide[1], r0=ft_wide[2], meanAbsErrPx=ft_wide[0]),
                   reference_free_fit=dict(k=free[1], zc=(free[2] - 511.5) * free[1], meanAbsErrPx=free[0],
                                           known_k=K_R, known_zc=ZC),
                   canonical_headPlaneY=(511.5 - x0r) * K_R,
                   eyeRowPredicted=r0t - body['eyeZ'] / kt, eyeZ=body['eyeZ'])
# ---- front ----
def jaw_edges(A, rows, cc=512):
    S = skin(A); out = []
    for r in rows:
        row = S[r]
        if not row[cc]:
            continue
        a = cc
        while a > 0 and row[a - 1]: a -= 1
        b = cc
        while b < 1023 and row[b + 1]: b += 1
        out.append((r, a, b))
    return np.array(out, float)
er = jaw_edges(load(os.path.join(REF, 'front.png')), range(440, 575))
et = jaw_edges(load(os.path.join(TG, 'target-front-a1.png')), range(430, 600))
dt = {int(r): (a, b) for r, a, b in et}
best = None
for s_ in np.arange(1.0, 1.5, 0.0025):
    for dy in np.arange(-250, 50, 0.5):
        res = []
        for r, a, b in er:
            rt = int(round(s_ * r + dy))
            if rt in dt:
                res.append((dt[rt][0] - s_ * a, dt[rt][1] - s_ * b))
        if len(res) < 0.8 * len(er):
            continue
        res = np.array(res); dx = float(np.median(res))
        e = float(np.mean(np.abs(res - dx)))
        if best is None or e < best[0]:
            best = (e, float(s_), float(dy), dx)
out['front'] = dict(s=best[1], dy=best[2], dx=best[3], fit=dict(meanAbsErrPx=best[0], canonicalRows=[440, 574]))
# ---- three-quarter ----
LM_C = np.array([[355, 370], [350, 452], [478, 400], [555, 425]], float)  # (row, col) reference round tq
LM_T = np.array([[338, 243], [330, 330], [485, 275], [580, 290]], float)  # target tq
A = []; bvec = []
for (rc, cc), (rt, ct) in zip(LM_C, LM_T):
    A.append([rc, 0, 1]); bvec.append(rt)
    A.append([cc, 1, 0]); bvec.append(ct)
sol, *_ = np.linalg.lstsq(np.array(A), np.array(bvec), rcond=None)
pred = np.array([[sol[0] * r + sol[2], sol[0] * c + sol[1]] for r, c in LM_C])
out['three_quarter'] = dict(s=float(sol[0]), dx=float(sol[1]), dy=float(sol[2]),
                            fit=dict(landmarks_canonical=LM_C.tolist(), landmarks_target=LM_T.tolist(),
                                     residualPx=np.abs(pred - LM_T).round(1).tolist()))
json.dump(out, open(os.path.join(HERE, 'frames.json'), 'w'), indent=1)
print(json.dumps(out, indent=1))
