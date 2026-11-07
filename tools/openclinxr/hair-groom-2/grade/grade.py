# Rubric instrument v3 (+ v3.1 I12-I14) for hair-groom-2 (tools/openclinxr/hair-groom-2/briefs/accuracy-rubric.md).
# Usage: <blender python> grade.py <round-dir> [out-dir]. Writes measures.json to out-dir (default: round-dir).
# A round dir holds front.png, three_quarter_left.png, side.png, back.png (+ stats.json, strands.npz when produced by
# groom.py). v2 items (A, B, C) are computed exactly as in v2; v3 adds the back-view items D1-D5 (vs target-back-a1)
# and the root-coverage items E1.L / E1.R (strands.npz roots against body_back.json patches).
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
    skin &= ~hair_textured(L, skin, f, (r0, r1, c0, c1))
    shirt_green = (A[..., 1] - A[..., 0]) > 0.02
    hair = (L < 0.47) & ~skin & ~shirt_green
    return L, hair, skin


TEX_SIGMA, TEX_ERODE, TEX_MULT = 3.0, 3, 2.0  # texture window (I6 sigma), interior erosion, multiple of the cheek p99
TEX_CORE = 14                                  # diamond radius: core width 29 > A1 pass limit 2 x 14 canonical px


def hair_textured(L, skin, f, cheek):
    # I12 (v3.1): skin-coloured hair. Light or tan hair (cards-r1 crown) passes the cheek-calibrated colour rule, so
    # skin candidates above the brow line (canonical row BROW - 10, A2's lower bound) are dropped when they carry
    # strand texture over a region wider than any passing part. Texture = local RMS of (L - gaussian 1 px) over the
    # 3 px-eroded skin candidates (gaussian 3 px window, the I6 sigma; erosion keeps the mixed edge px out). A px is
    # textured above 2x the 99th percentile of the same measure in the image's own cheek box (per-image calibration
    # as I4; 2x = A1's multiple). Textured regions count only if they hold a core that survives erosion by a diamond
    # of radius 14 canonical px (width 29 > 28 = A1's pass limit, 2x the target part width 17.6 px / s 1.255 = 14.0
    # canonical px), so a part line that A1 could pass is never removed; the whole connected textured region around
    # such a core is then removed (geodesic reconstruction). Skin-candidate islands above the brow line that touch the
    # removed region and do not connect to the cheek box through skin (untextured card faces, the region's eroded
    # rim) go with it; bare-scalp specks away from a removed region are untouched (A11).
    m = erode(skin, f.px(TEX_ERODE))
    s = TEX_SIGMA * f.s
    hp = (L - gblur(L, f.s)) * m
    w = gblur(m.astype(float), s)
    t = np.sqrt(gblur(hp * hp, s) / np.maximum(w, 1e-6))
    r0, r1, c0, c1 = cheek
    ck = t[r0:r1, c0:c1][m[r0:r1, c0:c1]]
    zone = np.zeros_like(skin); zone[:max(0, f.r(BROW - 10))] = True
    thr = TEX_MULT * np.percentile(ck, 99)
    T = (t > thr) & (w > 0.05) & zone
    g = erode(T, f.px(TEX_CORE))
    if not g.any():
        return g
    g = reconstruct(g, T)
    seed = np.zeros_like(skin); seed[r0:r1, c0:c1] = skin[r0:r1, c0:c1]
    main = reconstruct(seed, skin & ~g)
    # the 3 px window spreads card texture up to 3 sigma (9 px) into adjacent smooth skin (the bare part): px of the
    # removed region within that reach of the cheek-connected skin, smooth at 1 px window, connected to it, go back
    t1 = np.sqrt(gblur(hp * hp, f.s) / np.maximum(gblur(m.astype(float), f.s), 1e-6))
    band = g & dilate(main, f.px(3 * TEX_SIGMA)) & (t1 <= thr)
    g &= ~(reconstruct(main | band, main | band) & band)
    rest = skin & ~g
    island = rest & ~reconstruct(seed & rest, rest) & zone
    return g | reconstruct(island & dilate(g, 1), island)


def reconstruct(seed, within):
    # geodesic reconstruction: everything in `within` 4-connected to `seed`
    g = seed & within
    while True:
        n = g
        for _ in range(16):
            n = dilate(n, 1) & within
        if (n == g).all():
            return g
        g = n


def dilate(m, n):
    m = m.copy()
    for _ in range(n):
        q = m.copy()
        q[1:] |= m[:-1]; q[:-1] |= m[1:]; q[:, 1:] |= m[:, :-1]; q[:, :-1] |= m[:, 1:]
        m = q
    return m


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


# ---- v3: back view (D1-D5) -------------------------------------------------------------
# canonical regions (rows/cols in the groom back render, azimuth 180); the target maps through frames.json 'back'
D1_REGION, D1_TILE, D1_TILT = (200, 600, 430, 590), 16, 10.0  # seam region, tile px, strand tilt off vertical (deg)
D2_ROWS, D2_WIN, D2_OUT = (640, 1000), (90, 30), 20           # rows; window outside/inside the opaque edge; backdrop px
D2_CORE = (640, 1000, 450, 570)                                # opaque hair core box (core luminance)
D3_BAND = (540, 720)                                           # shoulder band: contains both images' hair/shoulder junction
D4_ROWS, D4_RIM = (140, 330), 50                               # crown rows; rim band width from each outline edge
D5_BOX, D5_EDGE, D5_PALE = (130, 200, 480, 545), 6, 0.25       # crown box; skip rows within 6 px of the hair top; pale L
BACK_DARK, BACK_OPAQUE = 0.20, 0.25                            # opaque-hair luminance for the D2 edge walk / D3 mask


def run_len(v):
    best = cur = 0
    for x in v:
        cur = cur + 1 if x else 0
        best = max(best, cur)
    return best


def measure_back(A, f, ref=None):
    # ref: the target's measures (None when measuring the target itself); D3 and D4 take their cut values from it.
    L = A @ W709
    neutral = (A.max(-1) - A.min(-1)) < 0.015           # studio background is exactly grey in round and target
    o = {}
    # D1 strand orientation: structure tensor per tile; tilt = strand direction off vertical (gradient off horizontal)
    gy, gx = np.gradient(gblur(L, 1.0 * f.s))
    Jxx, Jyy, Jxy = gblur(gx * gx, f.s), gblur(gy * gy, f.s), gblur(gx * gy, f.s)
    r0, r1, c0, c1 = f.box(D1_REGION); T_ = f.px(D1_TILE); tiles = []
    for r in range(r0, r1 - T_ + 1, T_):
        for c in range(c0, c1 - T_ + 1, T_):
            xx, yy, xy = Jxx[r:r + T_, c:c + T_].sum(), Jyy[r:r + T_, c:c + T_].sum(), Jxy[r:r + T_, c:c + T_].sum()
            th = 0.5 * np.degrees(np.arctan2(2 * xy, xx - yy))
            tiles.append((r, c, float(((th + 90) % 180) - 90)))
    tl = np.array([t[2] for t in tiles])
    bad = [(t[0], t[1], round(t[2], 1)) for t in tiles if abs(t[2]) > D1_TILT]
    o['D1'] = dict(region=[r0, r1, c0, c1], tilePx=T_, tiles=len(tiles), fracTiltOver=float(np.mean(np.abs(tl) > D1_TILT)),
                   medianAbsTiltDeg=float(np.median(np.abs(tl))), tiltedTiles=bad,
                   maxAbsTiltBelowCanonical280=float(np.max([abs(t[2]) for t in tiles if f.rc(t[0]) >= 280] or [0])))
    # D2 translucent outer sheets: per row and side, px within the edge window whose luminance sits 30-70% of the way
    # from the local backdrop (garment/background, outermost px of the window) to the opaque hair core
    q0, q1, d0, d1 = f.box(D2_CORE); Lc = float(np.median(L[q0:q1, d0:d1]))
    dark = L < BACK_DARK; widths = {'L': [], 'R': []}
    for r in range(f.r(D2_ROWS[0]), min(1024, f.r(D2_ROWS[1]))):
        c = f.c(512); a = c
        while a > 0 and dark[r, max(0, a - 4):a].any():
            a -= 1
        b = c
        while b < 1023 and dark[r, b + 1:b + 5].any():
            b += 1
        for side, e, sg in (('L', a, -1), ('R', b, 1)):
            lo, hi = (e - f.px(D2_WIN[0]), e + f.px(D2_WIN[1])) if sg < 0 else (e - f.px(D2_WIN[1]), e + f.px(D2_WIN[0]))
            if lo < 0 or hi > 1024:
                continue
            seg = L[r, lo:hi]
            Lo = float(np.median(seg[:f.px(D2_OUT)] if sg < 0 else seg[-f.px(D2_OUT):]))
            if Lo - Lc < 0.1:
                continue
            al = (Lo - seg) / (Lo - Lc)
            widths[side].append(float(np.sum((al >= 0.3) & (al <= 0.7)) / f.s))
    o['D2'] = dict(rows=[f.r(D2_ROWS[0]), min(1024, f.r(D2_ROWS[1]))], coreLum=Lc,
                   **{k: dict(rows=len(v), medianWidthCanonPx=float(np.median(v)) if v else None,
                              p90WidthCanonPx=float(np.percentile(v, 90)) if v else None) for k, v in widths.items()})
    # D3 shoulder shelf: horizontal edges inside the opaque hair (straight hanging strands make vertical edges only)
    Lb = gblur(L, 1.5 * f.s); hy, hx = np.gradient(Lb)
    m = erode(L < BACK_OPAQUE, f.px(8))
    m[:max(0, f.r(D3_BAND[0]))] = False; m[min(1024, f.r(D3_BAND[1])):] = False
    ay, ax = np.abs(hy[m]), np.abs(hx[m])
    g0 = float(np.percentile(ay, 99)) if ref is None else ref['D3']['g0']
    hz = np.zeros_like(m); hz[m] = (ay > g0) & (ay > ax)
    hr, hc = np.where(hz)
    o['D3'] = dict(rows=[f.r(D3_BAND[0]), f.r(D3_BAND[1])], hairPx=int(m.sum()), g0=g0, horizEdgePx=int(hz.sum()),
                   frac=float(hz.sum() / max(1, m.sum())),
                   horizEdgeRowsCols=[int(np.percentile(hr, 5)), int(np.percentile(hr, 95)), int(np.percentile(hc, 5)), int(np.percentile(hc, 95))] if len(hr) else None)
    # D3 report-only: hair outline width per 10 canonical rows over the band (the flare), max step
    wd = []
    for rc in range(D3_BAND[0], D3_BAND[1] + 1, 10):
        r = f.r(rc); c = f.c(512); a = c
        while a > 0 and dark[r, max(0, a - 4):a].any():
            a -= 1
        b = c
        while b < 1023 and dark[r, b + 1:b + 5].any():
            b += 1
        wd.append((rc, round((b - a) / f.s, 1)))
    o['D3']['outlineWidthCanonPx'] = wd
    o['D3']['maxWidthStepPer10Rows'] = float(np.max(np.diff([w for _, w in wd])))
    # D4 copper rim: px in the outer rim band (50 canonical px in from each outline edge, crown rows) warmer (R-B) than
    # the target's rim-band 99th percentile
    hairish = ~neutral & (L < 0.6)
    rb = A[..., 0] - A[..., 2]; vals, boxes = [], []
    for rc in range(D4_ROWS[0], D4_ROWS[1] + 1):
        r = f.r(rc); cs = np.where(hairish[r])[0]
        if len(cs) < 10:
            continue
        a, b = cs.min(), cs.max(); w = f.px(D4_RIM)
        for lo, hi in ((a, a + w), (b - w + 1, b + 1)):
            sel = hairish[r, lo:hi]
            vals.append(rb[r, lo:hi][sel])
    vals = np.concatenate(vals)
    rb99 = float(np.percentile(vals, 99)) if ref is None else ref['D4']['rb99']
    o['D4'] = dict(rows=[f.r(D4_ROWS[0]), f.r(D4_ROWS[1])], rimPx=int(len(vals)), rb99=rb99, meanRminusB=float(vals.mean()),
                   warmPx=int(np.sum(vals > rb99)), frac=float(np.mean(vals > rb99)))
    # D5 pale crown: widest run of pale (L >= 0.25), non-background px per row in the crown box, starting 6 px below
    # the hair top; value = max over rows of a 5-row running median (canonical px)
    r0, r1, c0, c1 = f.box(D5_BOX)
    top = int(np.where((~neutral[r0:r1, c0:c1] & (L[r0:r1, c0:c1] < 0.47)).any(1))[0].min()) + r0
    rs = range(top + f.px(D5_EDGE), r1)
    pale = (L >= D5_PALE) & ~neutral
    runs = np.array([run_len(pale[r, c0:c1]) / f.s for r in rs])
    med = np.array([np.median(runs[max(0, i - 2):i + 3]) for i in range(len(runs))])
    i = int(np.argmax(med))
    box = L[r0:r1, c0:c1]
    o['D5'] = dict(box=[r0, r1, c0, c1], hairTopRow=top, firstRow=top + f.px(D5_EDGE), maxRunCanonPx=float(med[i]),
                   atRow=int(list(rs)[i]), rawRunsCanonPx=[round(float(x), 1) for x in runs],
                   crownHairMedianLum=float(np.median(box[(box < 0.47) & ~neutral[r0:r1, c0:c1]])))
    return o


def measure_e1(strands_path):
    # E1 root coverage: roots (first point of each strand, groom.py head-local frame, mm) per patch and side, against
    # the body surface area of the patch (body_back.json, back_probe.py). Density ratio = patch / reference patch.
    bb = json.load(open(os.path.join(HERE, 'body_back.json')))
    d = np.load(strands_path)
    roots = d['localPositions'][d['offsets'][:-1]] * 1000.0
    o = {}
    for name, sg in (('L', 1.0), ('R', -1.0)):
        q = roots * np.array([sg, 1, 1]); res = {}
        for k, b in bb['patches'][name].items():
            m = (q[:, 0] >= 40.0) & (q[:, 1] >= b['y'][0]) & (q[:, 1] < b['y'][1]) & (q[:, 2] >= b['z'][0]) & (q[:, 2] < b['z'][1])
            res[k] = dict(y=b['y'], z=b['z'], areaMm2=b['areaMm2'], roots=int(m.sum()), perCm2=100.0 * m.sum() / b['areaMm2'])
        for k in ('aboveEar', 'sideburn'):
            res[k]['ratioToReference'] = res[k]['perCm2'] / res['reference']['perCm2'] if res['reference']['perCm2'] else 0.0
        lat = (q[:, 0] >= 40.0) & (q[:, 1] >= bb['patches'][name]['sideburn']['y'][0]) & (q[:, 1] < bb['ear'][name]['yBackMm'])
        res['lowestLateralRootZMm'] = float(q[lat, 2].min()) if lat.any() else None
        res['ear'] = bb['ear'][name]
        o[name] = res
    return o


def card_round(rd):
    # a card round: stats.json kind 'hair-cards' (render_cards.py); its strands.npz holds card centrelines, not strands
    p = os.path.join(rd, 'stats.json')
    st = json.load(open(p)) if os.path.exists(p) else {}
    return st if st.get('kind') == 'hair-cards' else None


def card_side_silhouette(rd, st, rows=1600):
    # I13: A3 for a card round whose side render is cut by the frame. The side silhouette is re-drawn below the frame
    # from the card geometry: card triangles (stats.cards -> cards.npz, world m) sampled at >= 2 per canonical px, kept
    # where the atlas alpha >= the render's alpha cutoff (stats.material.renderAlphaCutoff), depth-tested against the
    # body and garment triangles (body-geo.npz beside cards.npz, bodySha256 must equal stats.bodySha256; the low-poly
    # proxy is excluded), projected through the groom side camera (stats.render.camera, azimuth 90; head-plane y from
    # frames.json side; camera x centre = mean card-root x). The A3 20-canonical-px rule then runs on that silhouette.
    # Frame check, not fitted: per-row geometric vs image hair count over canonical rows 640-1000.
    cards = os.path.join(WT, st['cards']); geo = os.path.join(os.path.dirname(cards), 'body-geo.npz')
    if not os.path.exists(cards) or not os.path.exists(geo):
        return dict(error='missing %s' % (cards if not os.path.exists(cards) else geo))
    c = np.load(cards); b = np.load(geo)
    if str(b['bodySha256']) != st['bodySha256']:
        return dict(error='body-geo.npz bodySha256 differs from stats.bodySha256')
    cam = st['render']['camera']; cut = float(st['material']['renderAlphaCutoff'])
    al = np.asarray(Image.open(os.path.join(WT, st['atlas'])))[..., 3].astype(float) / 255; H, W = al.shape
    dist, zc, tx, ty = cam['distM'], cam['targetZ'], float(c['card_root'][:, 0].mean()), HEAD_Y

    def proj(P):
        d = (tx + dist) - P[:, 0]; k = dist / d / K
        return 512 - (P[:, 2] - zc) * k, 511.5 + (P[:, 1] - ty) * k, d

    def samples(T, attr=None):
        r, cc, _ = proj(T.reshape(-1, 3)); r = r.reshape(-1, 3); cc = cc.reshape(-1, 3)
        nn = np.clip(np.ceil(np.maximum(np.ptp(r, 1), np.ptp(cc, 1)) * 2).astype(int), 2, None)
        for n in np.unique(nn):
            sel = np.where(nn == n)[0]
            u, v = np.meshgrid(np.linspace(0, 1, n + 1), np.linspace(0, 1, n + 1)); m = (u + v) <= 1
            Wb = np.stack([1 - u[m] - v[m], u[m], v[m]], 1)
            P = np.einsum('kj,fjd->fkd', Wb, T[sel]).reshape(-1, 3)
            Q = np.einsum('kj,fjd->fkd', Wb, attr[sel]).reshape(-1, attr.shape[-1]) if attr is not None else None
            yield P, Q

    def pix(P):
        r, cc, d = proj(P); ri = np.floor(r).astype(int); ci = np.floor(cc).astype(int)
        ok = (ri >= 0) & (ri < rows) & (ci >= 0) & (ci < 1024)
        return ri[ok], ci[ok], d[ok]

    occ = [i for i, n in enumerate(b['meshNames']) if not str(n).endswith('low-poly')]
    zb = np.full((rows, 1024), np.inf)
    for P, _ in samples(b['verts'][b['tris'][np.isin(b['triMesh'], occ)]]):
        ri, ci, d = pix(P); np.minimum.at(zb, (ri, ci), d)
    sil = np.zeros((rows, 1024), bool)
    F = c['card_tris']
    for P, Q in samples(c['card_verts'][F], c['card_uv'][F]):
        a = al[np.clip(((1 - Q[:, 1]) * H).astype(int), 0, H - 1), np.clip((Q[:, 0] * W).astype(int), 0, W - 1)]
        ri, ci, d = pix(P[a >= cut]); vis = d < zb[ri, ci]; sil[ri[vis], ci[vis]] = True
    cnt = sil.sum(1)
    _, hair, _ = masks(load(os.path.join(rd, ROUND['side'])), Frame(), 'side'); ic = hair.sum(1)
    chk = np.abs(cnt[640:1001] - ic[640:1001])
    for r in range(600, rows):
        if cnt[r] < 20:
            return dict(row=r - 1, z=ZC + (511.5 - (r - 0.5)) * K, countAtFrameBottom=int(cnt[1023]),
                        frameCheckMeanAbsPx=float(chk.mean()), frameCheckMaxAbsPx=int(chk.max()),
                        countsEvery40Rows=[(int(q), int(cnt[q]), int(ic[q])) for q in range(600, 1024, 40)],
                        cameraXCentre=tx, alphaCutoff=cut)
    return dict(error='silhouette still >= 20 px at geometric row %d' % (rows - 1))


def measure_e1_cards(cards_path, groom_dir, step_mm=1.0):
    # I15: E1 on a card round. Card root edge = the two vertices of each card with card_uv v = 0 (cards are built with
    # v running root -> tip; their midpoint is card_root). World -> groom head-local frame: the rigid transform fitted
    # (Kabsch) from the source groom round's strands.npz positions to its localPositions (stats.groomRound; residual
    # reported). Each root edge is sampled every 1 mm; density = root-edge length (mm) in the patch per cm2 of body
    # surface (body_back.json areas, |x| >= 40 mm as for strands). E1 is a patch / temporal-reference ratio within one
    # hair set, so the per-card strand count cancels if cards carry strands at a constant density per width: a card
    # set that leaves the sideburn bare scores 0, one with root edges there at the reference density scores ~1.
    bb = json.load(open(os.path.join(HERE, 'body_back.json')))
    d = np.load(os.path.join(groom_dir, 'strands.npz')); P = d['positions'][::20].astype(float); Q = d['localPositions'][::20].astype(float)
    pm, qm = P.mean(0), Q.mean(0); U, _, Vt = np.linalg.svd((Q - qm).T @ (P - pm)); Rm = U @ Vt; t = qm - pm @ Rm.T
    resid = float(np.abs((P @ Rm.T + t) - Q).max() * 1000)
    c = np.load(cards_path); V, uv, vc = c['card_verts'], c['card_uv'], c['vert_card']
    rv = np.where(uv[:, 1] == 0.0)[0]; rv = rv[np.argsort(vc[rv], kind='stable')]
    if len(rv) != 2 * int(vc.max() + 1):
        return None, 'root edge not 2 vertices per card (%d for %d cards)' % (len(rv), vc.max() + 1)
    A, B = (V[rv[0::2]] @ Rm.T + t) * 1000, (V[rv[1::2]] @ Rm.T + t) * 1000
    ln = np.linalg.norm(B - A, axis=1); n = np.maximum(1, np.ceil(ln / step_mm)).astype(int)
    pts = np.concatenate([A[i] + (B[i] - A[i]) * ((np.arange(n[i]) + 0.5) / n[i])[:, None] for i in range(len(A))])
    wts = np.repeat(ln / n, n)
    o = dict(rule='card root-edge length (mm) per cm2', groomFrameFitResidMm=resid, cards=int(len(A)), rootEdgeMmTotal=float(ln.sum()))
    for name, sg in (('L', 1.0), ('R', -1.0)):
        q = pts * np.array([sg, 1, 1]); res = {}
        for k, b in bb['patches'][name].items():
            m = (q[:, 0] >= 40.0) & (q[:, 1] >= b['y'][0]) & (q[:, 1] < b['y'][1]) & (q[:, 2] >= b['z'][0]) & (q[:, 2] < b['z'][1])
            res[k] = dict(y=b['y'], z=b['z'], areaMm2=b['areaMm2'], rootEdgeMm=float(wts[m].sum()), perCm2=100.0 * float(wts[m].sum()) / b['areaMm2'])
        for k in ('aboveEar', 'sideburn'):
            res[k]['ratioToReference'] = res[k]['perCm2'] / res['reference']['perCm2'] if res['reference']['perCm2'] else 0.0
        o[name] = res
    return o, None


tf = {v: Frame(FR[v]['s'], FR[v]['dx'], FR[v]['dy']) for v in TARGETS}
rf = round_frames()
T = {v: MEASURE[v](load(os.path.join(TG, TARGETS[v])), tf[v]) for v in TARGETS}
R = {v: MEASURE[v](load(os.path.join(RD, ROUND[v])), rf[v]) for v in ROUND}
_fj = os.path.join(RD, 'frame.json')
_fb = json.load(open(_fj)).get('back') if os.path.exists(_fj) else None
tf['back'] = Frame(FR['back']['s'], FR['back']['dx'], FR['back']['dy'])
rf['back'] = Frame(**{k: _fb[k] for k in ('s', 'dx', 'dy')}) if _fb else Frame()
T['back'] = measure_back(load(os.path.join(TG, 'target-back-a1.png')), tf['back'])
R['back'] = measure_back(load(os.path.join(RD, 'back.png')), rf['back'], T['back']) if os.path.exists(os.path.join(RD, 'back.png')) else None

# ---- items -------------------------------------------------------------------
items = {}


def item(i, ok, value, src):
    items[i] = dict(result='INCONCLUSIVE' if ok is None else 'PASS' if ok else 'FAIL', value=value, threshold=src)


tF, rF, tS, rS, tQ, rQ = T['front'], R['front'], T['side'], R['side'], T['three_quarter'], R['three_quarter']
mult = rF['A1']['partOverFace'] / tF['A1']['partOverFace']
item('A1', mult <= 2.0, 'part/face at hairline %.4f vs target %.4f = %.2fx' % (rF['A1']['partOverFace'], tF['A1']['partOverFace'], mult),
     '<= 2x target')
item('A2', rF['A2']['frac'] <= 0.01, 'hair px below hairline %d = %.2f%% of band (target %.2f%%)' % (
    rF['A2']['hairPx'], 100 * rF['A2']['frac'], 100 * tF['A2']['frac']), '<= 1% of band')
CARD = card_round(RD)
if CARD and rS['A3']['censored']:
    rS['A3']['cardSilhouette'] = cs_ = card_side_silhouette(RD, CARD)
    if cs_.get('z') is None:
        item('A3', False, 'card round, side silhouette censored and not measurable from geometry: %s' % cs_['error'], 'I13')
    else:
        dz = (cs_['z'] - tS['A3']['z']) * 1000
        item('A3', abs(dz) <= 25, 'card round (I13): geometric side silhouette bottom z %.3f m (row %d) vs target %.3f m = %+.1f mm; '
             'frame check rows 640-1000 mean |geom - image| %.1f px/row' % (cs_['z'], cs_['row'], tS['A3']['z'], dz, cs_['frameCheckMeanAbsPx']),
             '+-25 mm')
else:
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

# ---- v3 items ----------------------------------------------------------------------------------
tB, rB = T['back'], R['back']
if rB is None:
    for i in ('D1', 'D2', 'D3', 'D4', 'D5'):
        item(i, False, 'no back.png in the round dir', 'back.png required (v3 INPUT)')
else:
    item('D1', rB['D1']['fracTiltOver'] <= 2 * tB['D1']['fracTiltOver'],
         'tiles with strands > %.0f deg off vertical %.1f%% (%d of %d) vs target %.1f%%; median |tilt| %.1f vs %.1f deg [region rows %d-%d cols %d-%d]' % (
             D1_TILT, 100 * rB['D1']['fracTiltOver'], len(rB['D1']['tiltedTiles']), rB['D1']['tiles'], 100 * tB['D1']['fracTiltOver'],
             rB['D1']['medianAbsTiltDeg'], tB['D1']['medianAbsTiltDeg'], *rB['D1']['region']),
         '<= 2x target fraction')
    d2 = {k: rB['D2'][k]['medianWidthCanonPx'] / tB['D2'][k]['medianWidthCanonPx'] if rB['D2'][k]['rows'] else float('nan') for k in 'LR'}
    if not all(rB['D2'][k]['rows'] for k in 'LR'):  # no row had a backdrop >= 0.1 brighter than the core on that side
        # I14: no row with a backdrop >= 0.1 above the core means no translucency was measured (a light core, e.g. tan
        # cards); that is no evidence of a sheet either way, so the grader scores D2 visually (as the v2 visual items)
        item('D2', None, 'INCONCLUSIVE, grader scores visually: no row has a backdrop >= 0.1 above the core lum %.3f (rows L %d, R %d)' % (
            rB['D2']['coreLum'], rB['D2']['L']['rows'], rB['D2']['R']['rows']), 'measurable each side, then <= 2x target')
    else:
        item('D2', max(d2.values()) <= 2.0,
             'translucent edge width (median over rows %d-%d) L %.1f px vs target %.1f (%.2fx), R %.1f px vs target %.1f (%.2fx)' % (
                 rB['D2']['rows'][0], rB['D2']['rows'][1] - 1, rB['D2']['L']['medianWidthCanonPx'], tB['D2']['L']['medianWidthCanonPx'], d2['L'],
                 rB['D2']['R']['medianWidthCanonPx'], tB['D2']['R']['medianWidthCanonPx'], d2['R']),
             '<= 2x target, each side')
    item('D3', rB['D3']['frac'] <= 0.01,
         'horizontal-edge px in shoulder-band hair %.2f%% (%d of %d; rows/cols %s) vs target %.2f%%; outline max width step %.0f vs target %.0f px/10 rows (reported)' % (
             100 * rB['D3']['frac'], rB['D3']['horizEdgePx'], rB['D3']['hairPx'], rB['D3']['horizEdgeRowsCols'], 100 * tB['D3']['frac'],
             rB['D3']['maxWidthStepPer10Rows'], tB['D3']['maxWidthStepPer10Rows']),
         '<= 1% (edge cut = target p99 |d/drow|)')
    item('D4', rB['D4']['frac'] <= 0.02,
         'rim-band px warmer than target rim p99 (R-B > %.3f) %.2f%% (%d of %d) vs target %.2f%% [rows %d-%d, %d px rim]' % (
             tB['D4']['rb99'], 100 * rB['D4']['frac'], rB['D4']['warmPx'], rB['D4']['rimPx'], 100 * tB['D4']['frac'],
             rB['D4']['rows'][0], rB['D4']['rows'][1], D4_RIM),
         '<= 2%')
    item('D5', rB['D5']['maxRunCanonPx'] <= 2 * tB['D5']['maxRunCanonPx'],
         'widest pale crown run %.1f px at row %d vs target %.1f px [box rows %d-%d cols %d-%d]' % (
             rB['D5']['maxRunCanonPx'], rB['D5']['atRow'], tB['D5']['maxRunCanonPx'], *rB['D5']['box']),
         '<= 2x target')
E1, E1_ERR = None, None
if CARD:
    E1, E1_ERR = measure_e1_cards(os.path.join(WT, CARD['cards']), os.path.join(WT, CARD['groomRound']))
elif os.path.exists(os.path.join(RD, 'strands.npz')):
    E1 = measure_e1(os.path.join(RD, 'strands.npz'))
for side in 'LR':
    if E1 is None:
        item('E1.' + side, False, E1_ERR or 'no strands.npz', 'cards.npz root edges (I15) required' if CARD else 'strands.npz required')
        continue
    e = E1[side]
    item('E1.' + side, e['aboveEar']['ratioToReference'] >= 0.5 and e['sideburn']['ratioToReference'] >= 0.5,
         '%s above ear %.1f/cm2, sideburn %.1f/cm2 vs temporal reference %.1f/cm2 = %.2f / %.2f (numeric half; visual half scored by the grader)' % (
             'card root-edge mm (I15)' if CARD else 'root density', e['aboveEar']['perCm2'], e['sideburn']['perCm2'], e['reference']['perCm2'],
             e['aboveEar']['ratioToReference'], e['sideburn']['ratioToReference']),
         'each >= 0.5 x reference')


strands = os.path.join(RD, 'strands.npz')
extra = {}
if os.path.exists(strands):
    d = np.load(strands); P = d['positions']; o = d['offsets']; tips = P[o[1:] - 1][:, 2]
    extra['cardCentrelineTipsZ' if CARD else 'strandTipsZ'] = dict(median=float(np.median(tips)), p10=float(np.percentile(tips, 10)), p90=float(np.percentile(tips, 90)),
                                targetHairBottomZ=tS['A3']['z'])
out = dict(rubric='v3', e1=E1, round=os.path.relpath(RD, WT) if RD.startswith(WT) else RD, frames=dict(round={v: rf[v].d() for v in rf},
           target={v: tf[v].d() for v in tf}), numericItems=items, numericPass=sum(v['result'] == 'PASS' for v in items.values()),
           numericCount=len(items), round_measures=R, target_measures=T, **extra)
os.makedirs(OUT_DIR, exist_ok=True)
json.dump(out, open(os.path.join(OUT_DIR, 'measures.json'), 'w'), indent=1, default=lambda x: x.item() if hasattr(x, 'item') else str(x))
for k_ in sorted(items):
    print('%-8s %s  %s  [%s]' % (k_, items[k_]['result'], items[k_]['value'], items[k_]['threshold']))
_inc = sum(v['result'] == 'INCONCLUSIVE' for v in items.values())
print('NUMERIC %d/%d' % (out['numericPass'], out['numericCount']) + (' (%d INCONCLUSIVE, grader scores visually)' % _inc if _inc else ''))
