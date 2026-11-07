# Rubric instrument for hair-groom-2 (tools/openclinxr/hair-groom-2/briefs/accuracy-rubric.md).
# Written by the independent grader for groom-r1/r6 (score 21/28); frozen here as the shared scorer.
# Usage: <blender python> grade.py <round-dir> [out-dir]. Writes measures.json to out-dir (default: round-dir).
import json, os, sys, colorsys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '../../../..'))
RD = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(WT, '.openclinxr/evidence/hair-groom-2/groom-r1/r6')
OUT_DIR = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else RD
TGT = os.path.join(WT, 'tools/openclinxr/evidence/hair-eval/fixtures/target.png')
W709 = np.array([0.2126, 0.7152, 0.0722])


def load(p, size=None):
    im = Image.open(p).convert('RGB')
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im).astype(float) / 255


def lum(a):
    return a @ W709


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


def hp_rms(L, m, s):
    hp = L - gblur(L, s)
    return float(np.sqrt(np.mean(hp[m] ** 2))), int(m.sum())


# ---- masks -------------------------------------------------------------
def target_masks(T):
    L = lum(T)
    reg = np.zeros(L.shape, bool); reg[50:440, 100:420] = True  # head region
    hair = (L < 0.30) & reg
    face = np.zeros(L.shape, bool); face[105:310, 205:300] = True
    skin = ((T[..., 0] - T[..., 2]) > 0.13) & (L > 0.2)
    return L, hair & ~face, skin


def render_masks(A, scale=1.0, face_box=None):
    L = lum(A)
    skin = ((A[..., 0] - A[..., 2]) > 0.04) & (L > 0.30)
    shirt = (A[..., 1] - A[..., 0]) > 0.02
    hair = (L < 0.47) & ~skin & ~shirt
    if face_box is not None:
        r0, r1, c0, c1 = [int(v * scale) for v in face_box]
        hair[r0:r1, c0:c1] = False
    return L, hair, skin


def run_from(mask_nonhair, row, c_center, maxw):
    """width of the non-hair run containing c_center on a row (searches +-maxw for a start)."""
    r = mask_nonhair[row]
    cands = [c for c in range(c_center - maxw, c_center + maxw + 1) if r[c]]
    if not cands:
        return 0, None, None
    c = min(cands, key=lambda x: abs(x - c_center))
    a = c
    while a > 0 and r[a - 1]:
        a -= 1
    b = c
    while b < len(r) - 1 and r[b + 1]:
        b += 1
    return b - a + 1, a, b


def face_span(nonhair, row, c_center, minrun):
    """scan outward from centre until a run of >= minrun hair pixels; returns (left_edge, right_edge)."""
    r = ~nonhair[row]
    def scan(step):
        c = c_center; cnt = 0
        while 0 < c < len(r) - 1:
            c += step
            cnt = cnt + 1 if r[c] else 0
            if cnt >= minrun:
                return c - step * (minrun - 1)
        return c
    return scan(-1), scan(+1)


def hair_extent(hair, row):
    cs = np.where(hair[row])[0]
    return (int(cs.min()), int(cs.max())) if len(cs) else (None, None)


def hue_offcast(A, m, sat_min=0.10, thr=25.0):
    px = A[m]
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in px[:: max(1, len(px) // 60000)]])
    h = hsv[:, 0] * 360; s = hsv[:, 1]
    ok = s >= sat_min
    ang = np.deg2rad(h[ok])
    med = np.rad2deg(np.arctan2(np.median(np.sin(ang)), np.median(np.cos(ang)))) % 360
    d = np.abs((h - med + 180) % 360 - 180)
    off_all = float(np.mean(d > thr))  # ungated (neutral pixels have arbitrary hue)
    off_gated = float(np.mean(ok & (d > thr)))  # off-hue AND chromatic, over all hair px
    warm = px[:: max(1, len(px) // 60000)]
    redcast = float(np.mean((warm[:, 0] - warm[:, 2]) > 0.05))
    return dict(medianHueDeg=float(med), fracOffUngated=off_all, fracOffSatGated=off_gated,
                satGate=sat_min, fracChromatic=float(ok.mean()), fracRminusBgt005=redcast, n=int(len(hsv)))


out = {}
T = load(TGT)
F = load(os.path.join(RD, 'front.png'))
F512 = load(os.path.join(RD, 'front.png'), 512)
TQ = load(os.path.join(RD, 'three_quarter_left.png'))
SD = load(os.path.join(RD, 'side.png'))

LT, hairT, skinT = target_masks(T)
FACE_BOX_R = (210, 570, 400, 625)  # rows r0,r1 cols c0,c1 at 1024
LF, hairF, skinF = render_masks(F, 1.0, FACE_BOX_R)
LF5, hairF5, skinF5 = render_masks(F512, 0.5, FACE_BOX_R)

# ---- face widths ----
nonhairT = ~(LT < 0.30)
nonhairF = ~((LF < 0.47) & ~skinF)
CHEEK_T, CHEEK_F = 215, 400
fT = face_span(nonhairT, CHEEK_T, 256, 10); fF = face_span(nonhairF, CHEEK_F, 512, 20)
faceT = fT[1] - fT[0]; faceF = fF[1] - fF[0]
out['faceWidth'] = dict(target=dict(row=CHEEK_T, cols=fT, px=faceT), render=dict(row=CHEEK_F, cols=fF, px=faceF))

# ---- A1 part width at hairline ----
def part_profile(nonhair, rows, cc, maxw, face):
    prof = []
    for r in rows:
        w, a, b = run_from(nonhair, r, cc, maxw)
        prof.append((r, w, a, b))
    seen_hair = False
    for r, w, a, b in prof:
        if w < 0.2 * face:
            seen_hair = True
        elif seen_hair:
            return prof, r
    raise RuntimeError('no hairline')
partT_nonhair = nonhairT
skinF_strict = skinF & (LF > 0.5)
partF_nonhair = skinF_strict  # bright skin-coloured pixels only (hair highlights reach bg grey; warm-cast hair has R>B)
profT, hlT = part_profile(partT_nonhair, range(60, 140), 257, 8, faceT)
profF, hlF = part_profile(partF_nonhair, range(120, 280), 512, 16, faceF)
wT = np.mean([w for r, w, a, b in profT if hlT - 5 <= r < hlT])
wF = np.mean([w for r, w, a, b in profF if hlF - 10 <= r < hlF])
# also the part above the wedge: 20-40 px (render) / 10-20 px (target) above hairline
wT_up = np.mean([w for r, w, a, b in profT if hlT - 20 <= r < hlT - 10])
wF_up = np.mean([w for r, w, a, b in profF if hlF - 40 <= r < hlF - 20])
out['A1'] = dict(hairlineRowTarget=hlT, hairlineRowRender=hlF,
                 partWidthTargetPx=wT, partWidthRenderPx=wF,
                 ratioTarget=wT / faceT, ratioRender=wF / faceF,
                 multiple=(wF / faceF) / (wT / faceT),
                 above_ratioTarget=wT_up / faceT, above_ratioRender=wF_up / faceF,
                 above_multiple=(wF_up / faceF) / (wT_up / faceT),
                 profileTarget=[(r, w) for r, w, a, b in profT if hlT - 25 <= r <= hlT + 2],
                 profileRender=[(r, w) for r, w, a, b in profF if hlF - 50 <= r <= hlF + 4])

# ---- A2 fringe: hair px below hairline in centre 40% of face width, down to brow-10 ----
c0 = int(512 - 0.2 * faceF); c1 = int(512 + 0.2 * faceF)
BROW_F = 318
band = (LF < 0.47) & ~skinF_strict
out['A2'] = dict(cols=[c0, c1], rows=[hlF + 3, BROW_F - 10], hairPx=int(band[hlF + 3:BROW_F - 10, c0:c1].sum()),
                 areaPx=int((BROW_F - 10 - hlF - 3) * (c1 - c0)))

# ---- A3 length ----
d = np.load(os.path.join(RD, 'strands.npz'))
P = d['positions']; o = d['offsets']
tips = P[o[1:] - 1]
clav = json.load(open(os.path.join(HERE, 'clavicle.json')))
clavZ = float(np.mean([clav['clavicle.L'][0][2], clav['clavicle.L'][1][2], clav['clavicle.R'][0][2], clav['clavicle.R'][1][2]]))
tipMed = float(np.median(tips[:, 2]))
lowest_hair_row = int(np.where(((LF < 0.47) & ~skinF & ~((F[..., 1] - F[..., 0]) > 0.02)).any(1))[0].max())
SHOULDER_ROW_F = 630  # top of shirt shoulder at frame edge cols 200-300 / 720-800
out['A3'] = dict(tipMedianZ=tipMed, clavicleZ_boneMean=clavZ, deltaMm=(tipMed - clavZ) * 1000,
                 tipZpct10_90=[float(np.percentile(tips[:, 2], 10)), float(np.percentile(tips[:, 2], 90))],
                 lowestHairRowFront=lowest_hair_row, shoulderRowFront=SHOULDER_ROW_F,
                 note='clavicle not in stats.json; taken from body GLB clavicle.L/R bone head+tail mean')

# ---- A4 hair over shirt, both sides ----
shirtF = (F[..., 1] - F[..., 0]) > 0.02
hair_over = (LF < 0.47) & ~skinF
out['A4'] = dict(leftHairPxRows640_900=int(hair_over[640:900, 250:420].sum()),
                 rightHairPxRows640_900=int(hair_over[640:900, 600:780].sum()))

# ---- A5 colour ----
out['A5'] = dict(targetHairMeanLum=float(LT[hairT].mean()), renderHairMeanLum=float(LF[hairF].mean()),
                 renderHairMeanLum_excl_black=float(LF[hairF & (LF > 0.02)].mean()),
                 renderHairMeanLum512=float(LF5[hairF5].mean()), targetN=int(hairT.sum()), renderN=int(hairF.sum()))

# ---- A6 silhouette at mouth row ----
MOUTH_T, MOUTH_F = 266, 482
skinT_row = ((T[..., 0] - T[..., 2]) > 0.13) & (LT > 0.2)
sT = np.where(skinT_row[MOUTH_T, 200:320])[0] + 200
sF = np.where(skinF[MOUTH_F, 380:660])[0] + 380
hT = np.where((LT < 0.30)[MOUTH_T, 100:420])[0] + 100
hF = np.where(((LF < 0.47) & ~skinF)[MOUTH_F, 200:820])[0] + 200
rT = (hT.max() - hT.min()) / (sT.max() - sT.min()); rF = (hF.max() - hF.min()) / (sF.max() - sF.min())
out['A6'] = dict(target=dict(row=MOUTH_T, hair=[int(hT.min()), int(hT.max())], face=[int(sT.min()), int(sT.max())], ratio=float(rT)),
                 render=dict(row=MOUTH_F, hair=[int(hF.min()), int(hF.max())], face=[int(sF.min()), int(sF.max())], ratio=float(rF)),
                 deviation=float(rF / rT - 1))

# ---- A9 tip line ----
hm = (LF < 0.47) & ~skinF
bottoms = []
for c in range(250, 800):
    rs = np.where(hm[640:1000, c])[0]
    if len(rs) > 20:
        bottoms.append((c, int(rs.max() + 640)))
bt = np.array(bottoms)
# longest run of adjacent columns whose bottom is within +-3 px of the run's first bottom
best = 0
for i in range(len(bt)):
    j = i
    while j + 1 < len(bt) and bt[j + 1, 0] == bt[j, 0] + 1 and abs(bt[j + 1, 1] - bt[i, 1]) <= 3:
        j += 1
    best = max(best, j - i + 1)
out['A9'] = dict(hairColumnsWithTips=int(len(bt)), longestFlatRunCols=int(best),
                 flatFraction=float(best / len(bt)), bottomStd=float(bt[:, 1].std()))

# ---- A10 / B8 strand detail ----
mT = erode(hairT, 2)
mF5 = erode(hairF5, 2)
hpT = hp_rms(LT, mT, 1.5); hpF5 = hp_rms(LF5, mF5, 1.5)
mF = erode(hairF, 3)
hpF = hp_rms(LF, mF, 3.0)
LQ, hairQ, skinQ = render_masks(TQ)
LS, hairS, skinS = render_masks(SD)
hpQ = hp_rms(LQ, erode(hairQ, 3), 3.0); hpS = hp_rms(LS, erode(hairS, 3), 3.0)
out['A10'] = dict(filter='lum - gaussian(sigma=1.5px) at 512; RMS over 2px-eroded hair mask',
                  target=hpT, render512=hpF5, ratio=hpF5[0] / hpT[0])
out['B8'] = dict(filter='lum - gaussian(sigma=3px) at native 1024; RMS over 3px-eroded hair mask',
                 front=hpF, threeQuarter=hpQ, side=hpS, ratioTQ=hpQ[0] / hpF[0], ratioSide=hpS[0] / hpF[0])

# ---- A11 skin inside hair silhouette above ears (excluding part band and face/forehead) ----
sk = skinF_strict.copy(); sk[:, 490:535] = False
hh = (LF < 0.47) & ~skinF_strict
inside = np.zeros_like(sk)
for r in range(110, 330):
    for c in np.where(sk[r])[0]:
        if hh[r, max(0, c - 25):c].any() and hh[r, c + 1:c + 26].any():
            inside[r, c] = True
# discount the face/forehead connected skin by requiring hair within 25 px on both sides AND above
inside2 = inside.copy()
for r, c in zip(*np.where(inside)):
    if not hh[max(0, r - 25):r, c].any():
        inside2[r, c] = False
out['A11'] = dict(skinPxBracketedByHair=int(inside2.sum()), rows=[110, 330])

# ---- A12 / B7 colour cast ----
out['A12'] = hue_offcast(F, hairF)
out['A12_target_reference'] = hue_offcast(T, hairT)
out['B7_tq'] = hue_offcast(TQ, hairQ)
out['B7_side'] = hue_offcast(SD, hairS)

json.dump(out, open(os.path.join(OUT_DIR, 'measures.json'), 'w'), indent=1, default=lambda x: x.item() if hasattr(x, 'item') else str(x))
print(json.dumps(out, indent=1, default=lambda x: x.item() if hasattr(x, 'item') else str(x)))
