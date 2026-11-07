# Rubric instrument v2 for hair-groom-2 (tools/openclinxr/hair-groom-2/briefs/accuracy-rubric.md).
# Usage: <blender python> grade.py <round-dir> [out-dir]. Writes measures.json to out-dir (default: round-dir).
# A round dir holds front.png, three_quarter_left.png, side.png (+ stats.json, strands.npz when produced by groom.py).
# Every region is defined once in the CANONICAL pixel frame (the groom renderer's camera, 1024^2) and mapped into an
# image by a frame (s, dx, dy): row_img = s*row + dy, col_img = s*col + dx. Rounds use the identity frame unless the
# round dir carries frame.json ({view: {s, dx, dy}}); the a1 targets use grade/frames.json (frame_fit.py).
# The target references are measured by the same code path as the round.
import json, os, sys, colorsys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '../../../..'))
RD = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(WT, '.openclinxr/evidence/hair-groom-2/groom-r1/r6')
OUT_DIR = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else RD
TG = os.path.join(WT, 'tools/openclinxr/hair-groom-2/targets')
TARGETS = {'front': 'target-front-a1.png', 'three_quarter': 'target-three_quarter-a1.png', 'side': 'target-profile-a1.png'}
ROUND = {'front': 'front.png', 'three_quarter': 'three_quarter_left.png', 'side': 'side.png'}
W709 = np.array([0.2126, 0.7152, 0.0722])
FR = json.load(open(os.path.join(HERE, 'frames.json')))
BODY = json.load(open(os.path.join(HERE, 'body_side.json')))
K = FR['canonical']['kMetresPerPx']          # canonical metres per px at the head plane
ZC = FR['canonical']['targetZ']              # canonical camera height (groom.py camera_rig)
HEAD_Y = FR['side']['canonical_headPlaneY']  # canonical side-view head plane y (col 511.5)

# ---- canonical regions (rows/cols in the groom render frame) --------------
FACE_ROW = 470                     # jaw skin width row, below both ear lobes in round and target
PART_ROWS, PART_C, PART_MAXW = (120, 280), 512, 16
BROW = 318
FACE_BOX = (210, 570, 400, 625)    # r0, r1, c0, c1 excluded from front hair masks
MOUTH = 482
SHOULDER_ROW = 590                 # A9 hair outline row, above the shoulder top in round and target
A4_BOXES = {'L': (660, 900, 250, 420), 'R': (660, 900, 600, 780)}
EAR_F = {'L': (362, 452, 365, 388), 'R': (362, 452, 635, 658)}
EAR_F_LAT = {'L': (362, 452, 335, 362), 'R': (362, 452, 661, 688)}
A11_ROWS, A11_PART = (110, 330), (490, 535)
EAR_Q = (346, 449, 605, 666)
EAR_S = (339, 452, 495, 561)
B5_Q_BOXES = {'near': (700, 900, 480, 640), 'far': (700, 900, 230, 470)}
LIFT_Y = (-0.10, -0.04)            # C1 head-top span, metres (body y; face at -y)


class Frame:
    def __init__(self, s=1.0, dx=0.0, dy=0.0):
        self.s, self.dx, self.dy = float(s), float(dx), float(dy)

    def r(self, rc):
        return int(round(self.s * rc + self.dy))

    def c(self, cc):
        return int(round(self.s * cc + self.dx))

    def box(self, b):
        r0, r1, c0, c1 = b
        return max(0, self.r(r0)), min(1024, self.r(r1)), max(0, self.c(c0)), min(1024, self.c(c1))

    def px(self, n):
        return max(1, int(round(n * self.s)))

    def rc(self, r):  # image row -> canonical row
        return (r - self.dy) / self.s

    def d(self):
        return dict(s=self.s, dx=self.dx, dy=self.dy)


def load(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(float) / 255


SKIN_REF = {'front': (395, 425, 440, 470), 'three_quarter': (395, 425, 395, 430), 'side': (470, 510, 365, 395)}


def masks(A, f, view):
    # skin is calibrated per image on a canonical cheek box (skin in rounds and targets): chromaticity within 0.08 of the
    # cheek mean, luminance >= 0.68 x and R-B >= 0.6 x the cheek mean (the latter drops the target's pink shirt). A fixed R-B rule cannot separate the target's skin (L ~0.63) from
    # warm-cast render hair highlights (L ~0.55, same chromaticity).
    L = A @ W709
    ch = A / np.maximum(A.sum(-1, keepdims=True), 1e-6)
    r0, r1, c0, c1 = f.box(SKIN_REF[view])
    rb = A[..., 0] - A[..., 2]
    cs = ch[r0:r1, c0:c1].reshape(-1, 3).mean(0); Ls = float(L[r0:r1, c0:c1].mean()); RBs = float(rb[r0:r1, c0:c1].mean())
    skin = (np.linalg.norm(ch - cs, axis=-1) < 0.08) & (L >= 0.68 * Ls) & (rb >= 0.6 * RBs)
    shirt_green = (A[..., 1] - A[..., 0]) > 0.02
    hair = (L < 0.47) & ~skin & ~shirt_green
    return L, hair, skin


def gblur(x, s):
    r = int(3 * s + 0.5)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / s) ** 2); k /= k.sum()
    y = np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode='edge'), k, 'valid'), 0, x)
    return np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode='edge'), k, 'valid'), 1, y)


def erode(m, n):
    m = m.copy()
    for _ in range(n):
        m[1:-1, 1:-1] = m[1:-1, 1:-1] & m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:]
        m[0, :] = m[-1, :] = m[:, 0] = m[:, -1] = False
    return m


def hp_rms(L, m, s=3.0):
    hp = L - gblur(L, s)
    return float(np.sqrt(np.mean(hp[m] ** 2))), int(m.sum())


def run_at(mask, row, cc, maxw):
    r = mask[row]
    cands = [c for c in range(cc - maxw, cc + maxw + 1) if r[c]]
    if not cands:
        return 0, None, None
    c = min(cands, key=lambda x: abs(x - cc))
    a = c
    while a > 0 and r[a - 1]:
        a -= 1
    b = c
    while b < len(r) - 1 and r[b + 1]:
        b += 1
    return b - a + 1, a, b


def hue_offcast(A, m, sat_min=0.10, thr=25.0, val_min=0.04):
    px = A[m]
    px = px[px.max(1) >= val_min]  # near-black: hue is 8-bit quantisation noise
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in px[:: max(1, len(px) // 60000)]])
    h = hsv[:, 0] * 360; s = hsv[:, 1]
    ok = s >= sat_min
    ang = np.deg2rad(h[ok])
    med = np.rad2deg(np.arctan2(np.median(np.sin(ang)), np.median(np.cos(ang)))) % 360
    d = np.abs((h - med + 180) % 360 - 180)
    return dict(medianHueDeg=float(med), fracOffSatGated=float(np.mean(ok & (d > thr))),
                fracOffUngated=float(np.mean(d > thr)), fracChromatic=float(ok.mean()), n=int(len(hsv)))


def head_mask(hair, f, rows=(60, 1000)):
    m = hair.copy()
    r0, r1, c0, c1 = f.box(FACE_BOX)
    m[r0:r1, c0:c1] = False
    m[:max(0, f.r(rows[0]))] = False
    m[min(1024, f.r(rows[1])):] = False
    return m


# ---- per-view measurement --------------------------------------------------
def measure_front(A, f):
    L, hair, skin = masks(A, f, 'front')
    o = {}
    w, a, b = run_at(skin, f.r(FACE_ROW), f.c(512), f.px(10))
    face = b - a + 1
    o['faceWidth'] = dict(row=f.r(FACE_ROW), cols=[a, b], px=face)
    # A1 part width at the hairline (first midline row below the hair top whose skin run is >= 0.2 face)
    prof = [(r,) + run_at(skin, r, f.c(PART_C), f.px(PART_MAXW)) for r in range(f.r(PART_ROWS[0]), f.r(PART_ROWS[1]))]
    seen, hl = False, None
    for r, w_, a_, b_ in prof:
        if w_ < 0.2 * face:
            seen = True
        elif seen:
            hl = r; break
    wpart = float(np.mean([w_ for r, w_, a_, b_ in prof if hl - f.px(10) <= r < hl]))
    o['A1'] = dict(hairlineRow=hl, partWidthPx=wpart, partOverFace=wpart / face,
                   profile=[(r, w_) for r, w_, a_, b_ in prof if hl - f.px(30) <= r <= hl + 2])
    # A2 hair in the centre 40% of the face from 0.1 face-width below the midline hairline (the hairline curves down
    # away from the midline in round and target alike) down to brow-10
    c0, c1 = int(f.c(512) - 0.2 * face), int(f.c(512) + 0.2 * face)
    r0, r1 = hl + int(round(0.1 * face)), f.r(BROW - 10)
    n = int(hair[r0:r1, c0:c1].sum()); area = max(1, (r1 - r0) * (c1 - c0))
    o['A2'] = dict(rows=[r0, r1], cols=[c0, c1], hairPx=n, frac=n / area)
    # A4 hair over the chest/shoulder boxes
    o['A4'] = {}
    for k_, bx in A4_BOXES.items():
        r0, r1, c0, c1 = f.box(bx)
        n = int(hair[r0:r1, c0:c1].sum()); o['A4'][k_] = dict(box=[r0, r1, c0, c1], hairPx=n, frac=n / ((r1 - r0) * (c1 - c0)))
    # A5 colour
    hm = head_mask(hair, f)
    o['A5'] = dict(meanLum=float(L[hm].mean()), meanRminusB=float((A[..., 0] - A[..., 2])[hm].mean()), n=int(hm.sum()))
    # A6 / A9 hair outline width over jaw skin width
    def outline(row_c):
        r = f.r(row_c)
        hs = np.where(hair[r, f.c(200):f.c(820)])[0] + f.c(200)
        return dict(row=r, hair=[int(hs.min()), int(hs.max())], ratio=float((hs.max() - hs.min()) / face))
    o['A6'] = outline(MOUTH)
    o['A9'] = outline(SHOULDER_ROW)
    # A7 ear skin and lateral hair
    o['A7'] = {}
    for k_ in ('L', 'R'):
        r0, r1, c0, c1 = f.box(EAR_F[k_]); e = int(skin[r0:r1, c0:c1].sum())
        q0, q1, d0, d1 = f.box(EAR_F_LAT[k_]); h = int(hair[q0:q1, d0:d1].sum())
        o['A7'][k_] = dict(earBox=[r0, r1, c0, c1], earSkinPx=e, earSkinFrac=e / ((r1 - r0) * (c1 - c0)),
                           latBox=[q0, q1, d0, d1], latHairPx=h, latHairFrac=h / ((q1 - q0) * (d1 - d0)))
    # A10 strand detail
    o['A10'] = dict(filter='lum - gaussian(sigma=3px) native; RMS over 3px-eroded head hair mask',
                    hpRms=hp_rms(L, erode(hm, 3))[0])
    # A11 skin bracketed by hair above the ears (part band excluded)
    sk = skin.copy()
    sk[:, f.c(A11_PART[0]):f.c(A11_PART[1])] = False
    hh = (L < 0.47) & ~sk
    win = f.px(25); cnt = 0
    for r in range(f.r(A11_ROWS[0]), f.r(A11_ROWS[1])):
        for c in np.where(sk[r])[0]:
            if hh[r, max(0, c - win):c].any() and hh[r, c + 1:c + win + 1].any() and hh[max(0, r - win):r, c].any():
                cnt += 1
    o['A11'] = dict(rows=[f.r(A11_ROWS[0]), f.r(A11_ROWS[1])], skinPxBracketedByHair=cnt)
    o['A12'] = hue_offcast(A, hm)
    return o


def hair_bottom(hair, f):
    # scan down from canonical row 600: the first row with < 20 canonical px of hair ends the hair mass.
    # If the hair is still that wide at the frame bottom, the bottom is censored; it is then extrapolated by a
    # line fitted to the per-row hair count over the last 60 rows.
    need = f.px(20); cnt = hair.sum(1)
    for r in range(max(0, f.r(600)), 1024):
        if cnt[r] < need:
            return dict(row=r - 1, z=ZC + (511.5 - f.rc(r - 0.5)) * K, censored=False)
    rr = np.arange(1024 - 60, 1024); a, b = np.polyfit(rr, cnt[rr], 1)
    r_ex = float((need - b) / a) if a < 0 else float('nan')
    return dict(row=1023, z=ZC + (511.5 - f.rc(r_ex + 0.5)) * K, censored=True, extrapolatedRow=r_ex,
                zFrameBottom=ZC + (511.5 - f.rc(1024)) * K, countAtFrameBottom=int(cnt[1023]), slopePxPerRow=float(a))


def measure_side(A, f):
    L, hair, skin = masks(A, f, 'side')
    o = {}
    o['A3'] = dict(rule='side view: last row of the hair mass with >= 20 canonical px of hair, scanning down from canonical row 600',
                   **hair_bottom(hair, f))
    r0, r1, c0, c1 = f.box(EAR_S); e = int(skin[r0:r1, c0:c1].sum())
    o['B2'] = dict(earBox=[r0, r1, c0, c1], earSkinPx=e, earSkinFrac=e / ((r1 - r0) * (c1 - c0)))
    # B5 tip line: longest run of adjacent tip columns with bottoms within +-3 canonical px
    bottoms = []
    for c in range(1024):
        rs = np.where(hair[f.r(600):, c])[0]
        if len(rs) > f.px(20):
            bottoms.append((c, int(rs.max()) + f.r(600)))
    bt = np.array(bottoms); best = 0; tol = f.px(3)
    for i in range(len(bt)):
        j = i
        while j + 1 < len(bt) and bt[j + 1, 0] == bt[j, 0] + 1 and abs(bt[j + 1, 1] - bt[i, 1]) <= tol:
            j += 1
        best = max(best, j - i + 1)
    o['B5'] = dict(tipColumns=int(len(bt)), longestFlatRun=int(best), flatFrac=best / len(bt), bottomStdPx=float(bt[:, 1].std()))
    hm = hair.copy(); hm[:max(0, f.r(60))] = False
    o['B7'] = hue_offcast(A, hm)
    o['B8'] = dict(hpRms=hp_rms(L, erode(hm, 3))[0])
    # C1 hair top above the body's scalp silhouette over the front head-top span
    sc = np.array(BODY['scalpTop_y_maxZ'])
    # running max over +-2 mm: sparse 0.5 mm bins under-read the silhouette
    sc = np.array([[y, sc[np.abs(sc[:, 0] - y) <= 0.002, 1].max()] for y in sc[:, 0]])
    offs = []
    for y in np.arange(LIFT_Y[0], LIFT_Y[1] + 1e-9, 0.002):
        cc = 511.5 + (y - HEAD_Y) / K
        zs = float(np.interp(y, sc[:, 0], sc[:, 1]))
        ci = f.c(cc)
        col = np.where(hair[:, ci])[0]
        if not len(col):
            continue
        ztop = ZC + (511.5 - f.rc(col.min() + 0.5)) * K
        offs.append((round(float(y), 3), ci, int(col.min()), round((ztop - zs) * 1000, 2)))
    o['C1'] = dict(yRange=list(LIFT_Y), samples=offs, medianOffsetMm=float(np.median([x[3] for x in offs])),
                   maxOffsetMm=float(np.max([x[3] for x in offs])))
    return o


def measure_tq(A, f):
    L, hair, skin = masks(A, f, 'three_quarter')
    o = {}
    r0, r1, c0, c1 = f.box(EAR_Q); e = int(skin[r0:r1, c0:c1].sum())
    o['B2'] = dict(earBox=[r0, r1, c0, c1], earSkinPx=e, earSkinFrac=e / ((r1 - r0) * (c1 - c0)))
    o['B5'] = {}
    for k_, bx in B5_Q_BOXES.items():
        r0, r1, c0, c1 = f.box(bx)
        n = int(hair[r0:r1, c0:c1].sum()); o['B5'][k_] = dict(box=[r0, r1, c0, c1], hairPx=n, frac=n / ((r1 - r0) * (c1 - c0)))
    hm = hair.copy(); hm[:max(0, f.r(60))] = False
    o['B7'] = hue_offcast(A, hm)
    o['B8'] = dict(hpRms=hp_rms(L, erode(hm, 3))[0])
    return o


MEASURE = {'front': measure_front, 'three_quarter': measure_tq, 'side': measure_side}


def round_frames():
    p = os.path.join(RD, 'frame.json')
    j = json.load(open(p)) if os.path.exists(p) else {}
    return {v: Frame(**{k: j[v][k] for k in ('s', 'dx', 'dy')}) if v in j else Frame() for v in ROUND}


tf = {v: Frame(FR[v]['s'], FR[v]['dx'], FR[v]['dy']) for v in TARGETS}
rf = round_frames()
T = {v: MEASURE[v](load(os.path.join(TG, TARGETS[v])), tf[v]) for v in TARGETS}
R = {v: MEASURE[v](load(os.path.join(RD, ROUND[v])), rf[v]) for v in ROUND}

# ---- items -------------------------------------------------------------------
items = {}


def item(i, ok, value, src):
    items[i] = dict(result='PASS' if ok else 'FAIL', value=value, threshold=src)


tF, rF, tS, rS, tQ, rQ = T['front'], R['front'], T['side'], R['side'], T['three_quarter'], R['three_quarter']
mult = rF['A1']['partOverFace'] / tF['A1']['partOverFace']
item('A1', mult <= 2.0, 'part/face at hairline %.4f vs target %.4f = %.2fx' % (rF['A1']['partOverFace'], tF['A1']['partOverFace'], mult),
     '<= 2x target')
item('A2', rF['A2']['frac'] <= 0.01, 'hair px below hairline %d = %.2f%% of band (target %.2f%%)' % (
    rF['A2']['hairPx'], 100 * rF['A2']['frac'], 100 * tF['A2']['frac']), '<= 1% of band')
dz = (rS['A3']['z'] - tS['A3']['z']) * 1000
item('A3', abs(dz) <= 25, 'side hair bottom z %.3f m vs target %.3f m = %+.1f mm' % (rS['A3']['z'], tS['A3']['z'], dz), '+-25 mm')
a4 = max(rF['A4']['L']['frac'], rF['A4']['R']['frac'])
item('A4', a4 <= 0.01, 'hair over chest boxes L %.2f%% R %.2f%% (target L %.2f%% R %.2f%%)' % (
    100 * rF['A4']['L']['frac'], 100 * rF['A4']['R']['frac'], 100 * tF['A4']['L']['frac'], 100 * tF['A4']['R']['frac']), '<= 1% each box')
dl = rF['A5']['meanLum'] - tF['A5']['meanLum']; drb = rF['A5']['meanRminusB'] - tF['A5']['meanRminusB']
item('A5', abs(dl) <= 0.05 and abs(drb) <= 0.5 * tF['A5']['meanRminusB'],
     'hair mean lum %.3f vs target %.3f (%+.3f); mean R-B %.3f vs target %.3f (%+.3f)' % (
         rF['A5']['meanLum'], tF['A5']['meanLum'], dl, rF['A5']['meanRminusB'], tF['A5']['meanRminusB'], drb),
     '|dLum| <= 0.05 and |dR-B| <= 0.5 x target R-B')
d6 = rF['A6']['ratio'] / tF['A6']['ratio'] - 1
item('A6', abs(d6) <= 0.15, 'hair/jaw width at mouth row %.3f vs target %.3f = %+.1f%%' % (rF['A6']['ratio'], tF['A6']['ratio'], 100 * d6), '+-15%')
e7 = {k: rF['A7'][k]['earSkinPx'] / tF['A7'][k]['earSkinPx'] for k in 'LR'}
h7 = {k: rF['A7'][k]['latHairPx'] / tF['A7'][k]['latHairPx'] for k in 'LR'}
item('A7', min(e7.values()) >= 0.5 and min(h7.values()) >= 0.5,
     'ear skin vs target L %.0f%% R %.0f%%; hair lateral of ear vs target L %.0f%% R %.0f%%' % (
         100 * e7['L'], 100 * e7['R'], 100 * h7['L'], 100 * h7['R']), 'each >= 50% of target')
d9 = rF['A9']['ratio'] / tF['A9']['ratio'] - 1
item('A9', abs(d9) <= 0.15, 'hair/jaw width at shoulder row %.3f vs target %.3f = %+.1f%%' % (rF['A9']['ratio'], tF['A9']['ratio'], 100 * d9), '+-15%')
r10 = rF['A10']['hpRms'] / tF['A10']['hpRms']
item('A10', r10 >= 0.5, 'hp RMS %.4f vs target %.4f = %.0f%%' % (rF['A10']['hpRms'], tF['A10']['hpRms'], 100 * r10), '>= 50% of target')
item('A11', rF['A11']['skinPxBracketedByHair'] <= 300, 'skin px bracketed by hair %d (target %d)' % (
    rF['A11']['skinPxBracketedByHair'], tF['A11']['skinPxBracketedByHair']), '<= 300 px')
item('A12', rF['A12']['fracOffSatGated'] < 0.02, 'chromatic off-hue %.2f%% (target %.2f%%)' % (
    100 * rF['A12']['fracOffSatGated'], 100 * tF['A12']['fracOffSatGated']), '< 2%')
for v, rv, tv in (('tq', rQ, tQ), ('side', rS, tS)):
    e = rv['B2']['earSkinPx'] / tv['B2']['earSkinPx']
    item('B2.' + v, e >= 0.5, 'ear-box skin %d px vs target %d = %.0f%% (numeric half; split streak is visual)' % (
        rv['B2']['earSkinPx'], tv['B2']['earSkinPx'], 100 * e), '>= 50% of target')
    item('B7.' + v, rv['B7']['fracOffSatGated'] < 0.02, 'chromatic off-hue %.2f%% (target %.2f%%)' % (
        100 * rv['B7']['fracOffSatGated'], 100 * tv['B7']['fracOffSatGated']), '< 2%')
    r8 = rv['B8']['hpRms'] / tv['B8']['hpRms']
    item('B8.' + v, r8 >= 0.5, 'hp RMS %.4f vs target %.4f = %.0f%%' % (rv['B8']['hpRms'], tv['B8']['hpRms'], 100 * r8), '>= 50% of target')
b5q = max(rQ['B5']['near']['frac'], rQ['B5']['far']['frac'])
item('B5.tq', b5q <= 0.01, 'hair over shoulder boxes near %.2f%% far %.2f%% (target %.2f%% / %.2f%%)' % (
    100 * rQ['B5']['near']['frac'], 100 * rQ['B5']['far']['frac'], 100 * tQ['B5']['near']['frac'], 100 * tQ['B5']['far']['frac']),
     '<= 1% each box')
item('B5.side', rS['B5']['flatFrac'] <= 0.20, 'longest flat hem %d of %d tip columns = %.1f%% (target %.1f%%)' % (
    rS['B5']['longestFlatRun'], rS['B5']['tipColumns'], 100 * rS['B5']['flatFrac'], 100 * tS['B5']['flatFrac']), '<= 20%')
lift = rS['C1']['medianOffsetMm'] - tS['C1']['medianOffsetMm']
item('C1', lift <= 6.0, 'hair top above scalp, front head-top median %.1f mm vs target %.1f mm = %+.1f mm' % (
    rS['C1']['medianOffsetMm'], tS['C1']['medianOffsetMm'], lift), '<= target + 6 mm')

strands = os.path.join(RD, 'strands.npz')
extra = {}
if os.path.exists(strands):
    d = np.load(strands); P = d['positions']; o = d['offsets']; tips = P[o[1:] - 1][:, 2]
    extra['strandTipsZ'] = dict(median=float(np.median(tips)), p10=float(np.percentile(tips, 10)), p90=float(np.percentile(tips, 90)),
                                targetHairBottomZ=tS['A3']['z'])
out = dict(rubric='v2', round=os.path.relpath(RD, WT) if RD.startswith(WT) else RD, frames=dict(round={v: rf[v].d() for v in rf},
           target={v: tf[v].d() for v in tf}), numericItems=items, numericPass=sum(v['result'] == 'PASS' for v in items.values()),
           numericCount=len(items), round_measures=R, target_measures=T, **extra)
os.makedirs(OUT_DIR, exist_ok=True)
json.dump(out, open(os.path.join(OUT_DIR, 'measures.json'), 'w'), indent=1, default=lambda x: x.item() if hasattr(x, 'item') else str(x))
for k_ in sorted(items):
    print('%-8s %s  %s  [%s]' % (k_, items[k_]['result'], items[k_]['value'], items[k_]['threshold']))
print('NUMERIC %d/%d' % (out['numericPass'], out['numericCount']))
