"""sheen_gate.py: hair appearance metrics for hair-groom-2 (DESIGN-realism.md, Appearance metrics).

Ported from the gitignored sheen-round tools (EV = .openclinxr/evidence/hair-groom-2): EV/sheen/tools/seg.py
(load, luma, dilate, target_masks), EV/sheen/tools/sheen.py (render_hair, target_hair, metrics),
EV/sheen3b/tools/score3b.py (hf, black). Behaviour of the ported functions is unchanged; `port-check` proves it
by reproducing EV/sheen3b/score.json from the sheen3b crops and the grader's v3 masks.

New definitions (P1), reported beside the ported ones:
- band_cols: crown = top 30% of hair-mask rows per column; per crown column, row of max L after a 5-row box
  smooth; bandRowCol = median of those rows as a fraction of crop height; bandCont = fraction of crown columns
  whose max > 1.15 x the column median. First-run constants (30%, 5 rows, 1.15) are swept by `sensitivity`.
- streak = hf (mean |dL/dx| / mean L over crown rows), as streakhf.

Usage (Blender's python with numpy + PIL on PYTHONPATH):
  sheen_gate.py port-check
  sheen_gate.py score <out.json> <label>=<crop prefix>[:<nohair prefix>[:<matte prefix>]] ...   (target scored as 'target')
A matte prefix (P3 Cycles strand renders, strands_in_target_scene.py --matte) replaces the diff mask with
erode(matte alpha > .5, 2): on Cycles renders the diff mask also holds shirt and skin pixels the hair shades.
"""
import colorsys
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

W = np.array([0.2126, 0.7152, 0.0722])
VIEWS = {'front': 'front', 'three_quarter_left': 'three_quarter', 'side': 'profile', 'back': 'back'}
TARGETS = 'tools/openclinxr/hair-groom-2/targets/target-%s-a1.png'
EV = '.openclinxr/evidence/hair-groom-2'


def load(p):
    return np.asarray(Image.open(p).convert('RGB'), float) / 255.


def luma(a):
    return a @ W


def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def erode(m, r):
    return ~dilate(~m, r)


def shirt_top(shirt):
    rows = np.where(shirt.sum(1) > 40)[0]
    return int(rows.min()) if len(rows) else shirt.shape[0]


def target_masks(img):
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    L = luma(img)
    chroma = img.max(2) - img.min(2)
    bg = (chroma < 0.05) & (L > 0.42)
    shirt0 = (R > G + 0.03) & (B > G) & (L > 0.5)
    top = shirt_top(shirt0)
    rows = np.arange(img.shape[0])[:, None] * np.ones((1, img.shape[1]))
    shirt = shirt0 & (rows >= top)
    hair = ((L < 0.34) | ((R - B < 0.12) & (L < 0.45) & ~bg)) & ~shirt
    hair_d = dilate(hair, 6)
    skin = (R > G + 0.03) & (G > B + 0.02) & (R - B > 0.12) & (L > 0.40) & ~hair_d & ~bg & ~shirt0 & (rows < top + 60)
    return dict(hair=hair & ~bg, bg=bg & ~dilate(hair, 2), shirt=shirt, skin=skin)


def render_hair(img, nohair):
    return erode(np.abs(img - nohair).max(2) > 3 / 255., 2)


def target_hair(img):
    L = luma(img)
    core = (img[..., 0] > img[..., 1] + 0.004) & (L < 0.30)
    closed = erode(dilate(core, 3), 3)
    m = target_masks(img)
    return erode(closed & ~m['bg'] & ~m['skin'] & ~m['shirt'], 2)


def _runs(row):
    d = np.diff(np.r_[0, row.astype(int), 0])
    return np.where(d == -1)[0] - np.where(d == 1)[0]


def metrics(img, hair):
    L = luma(img)
    rows = np.where(hair.sum(1) > 3)[0]
    top = int(rows.min())
    w = hair.sum(1)
    s = float(w[top:top + 200].max())
    r1 = int(top + 0.8 * s)
    crown = hair.copy()
    crown[:top] = False
    crown[r1:] = False
    P = np.full(img.shape[0], np.nan)
    for r in range(top, r1):
        if crown[r].sum() >= 0.3 * s:
            P[r] = np.percentile(L[r][crown[r]], 95)
    peak = float(np.nanmax(P))
    pr = int(np.nanargmax(P))
    band = P > 0.8 * peak
    base = float(np.median(L[crown]))
    hi = crown & (L > 0.8 * peak)
    hsv = np.array([colorsys.rgb_to_hsv(*c) for c in img[hi]]) if hi.sum() else np.zeros((1, 3))
    hue = float(np.degrees(np.angle(np.exp(2j * np.pi * hsv[:, 0]).mean())) % 360)
    cont, rpr = [], []
    for r in np.where(band)[0]:
        rr = _runs(hi[r])
        if len(rr):
            cont.append(rr.max() / rr.sum())
            rpr.append(len(rr))
    return dict(hairTop=top, s=s, bandRow=round((pr - top) / s, 3), bandWidth=round(int(band.sum()) / s, 3),
                bandRows=int(band.sum()), peakL=round(peak, 3), base=round(base, 3), contrast=round(peak / base, 2),
                hiPx=int(hi.sum()), hiFrac=round(float(hi.sum() / crown.sum()), 4), hue=round(hue, 1),
                sat=round(float(hsv[:, 1].mean()), 3), continuity=round(float(np.mean(cont)) if cont else 0, 3),
                runsPerRow=round(float(np.mean(rpr)) if rpr else 0, 2))


def hf(L, m):
    rows = np.where(m.sum(1) > 3)[0]
    top = rows.min()
    s = m.sum(1)[top:top + 200].max()
    mm = m.copy()
    mm[:top] = 0
    mm[int(top + .8 * s):] = 0
    pair = mm[:, 1:] & mm[:, :-1]
    d = np.abs(L[:, 1:] - L[:, :-1])[pair]
    return round(float(d.mean() / L[mm].mean()), 4)


def score3b_row(img, m):
    """EV/sheen3b/tools/score3b.py row(): the port-check unit."""
    L = luma(img)
    r = metrics(img, m)
    return dict(peak=r['peakL'], base=r['base'], runs=r['runsPerRow'], bandRow=r['bandRow'],
                black=round(float((L[m] < .06).mean()), 4), hf=hf(L, m))


def band_cols(img, m, crown_frac=0.30, smooth=5, k=1.15):
    """Per-column crown band (new definition, P1). Returns median band row (fraction of crop height) and continuity."""
    L = luma(img)
    rows_of, cont = [], []
    ker = np.ones(smooth) / smooth
    for x in range(m.shape[1]):
        ys = np.where(m[:, x])[0]
        if len(ys) < 10:
            continue
        n = max(int(round(crown_frac * len(ys))), 3)
        cy = ys[:n]
        prof = np.convolve(L[cy, x], ker, mode='same')
        rows_of.append(cy[int(np.argmax(prof))])
        cont.append(prof.max() > k * np.median(prof))
    if not rows_of:
        return dict(bandRowCol=None, bandCont=None, cols=0)
    return dict(bandRowCol=round(float(np.median(rows_of)) / m.shape[0], 4), bandCont=round(float(np.mean(cont)), 4),
                cols=len(rows_of))


def full_row(img, m):
    L = luma(img)
    r = metrics(img, m)
    out = dict(peak=r['peakL'], base=r['base'], black=round(float((L[m] < .06).mean()), 4), streak=hf(L, m),
               bandRow=r['bandRow'], runs=r['runsPerRow'], hue=r['hue'], sat=r['sat'])
    out.update(band_cols(img, m))
    return out


def port_check():
    ref = json.load(open(EV + '/sheen3b/score.json'))
    D = EV + '/sheen3b/run/crops'
    worst, n = 0.0, 0
    for v, tv in VIEWS.items():
        t = load(TARGETS % tv)
        cells = [('target', t, target_hair(t))]
        m = np.load(EV + '/grades/sheen2-v1/masks/m3-%s.npy' % v)
        for k in ('r10', 'BEST3'):
            for lt, suf in (('fit', ''), ('def', '-def')):
                cells.append(('%s/%s' % (k, lt), load('%s/%s%s-%s.png' % (D, k, suf, v)), m))
        for label, img, mask in cells:
            got = score3b_row(img, mask)
            want = ref[label][v]
            for key in ('peak', 'base', 'hf'):
                d = abs(got[key] - want[key])
                worst = max(worst, d)
                n += 1
                if round(got[key], 3) != round(want[key], 3):
                    print('MISMATCH', label, v, key, got[key], want[key])
    ok = worst < 5e-4
    print('PORT_CHECK %s values=%d maxAbsDiff=%.6f' % ('PASS' if ok else 'FAIL', n, worst))
    return ok


def score(out_path, specs, targets=TARGETS):
    out = {}
    for v, tv in VIEWS.items():
        t = load(targets % (tv if targets == TARGETS else v))
        out.setdefault('target', {})[v] = full_row(t, target_hair(t))
    for spec in specs:
        label, _, pre = spec.partition('=')
        pre, _, nh = pre.partition(':')
        nh, _, mt = nh.partition(':')
        for v in VIEWS:
            img = load('%s-%s.png' % (pre, v))
            if mt:
                alpha = np.asarray(Image.open('%s-%s.png' % (mt, v)).convert('RGBA'), float)[..., 3] / 255.
                m = erode(alpha > 0.5, 2)
            else:
                nohair = load('%s-%s.png' % (nh or pre.rsplit('-', 1)[0] + '-nohair', v))
                m = render_hair(img, nohair)
            out.setdefault(label, {})[v] = full_row(img, m)
    Path(out_path).write_text(json.dumps(out, indent=1))
    keys = ('peak', 'base', 'black', 'streak', 'bandRowCol', 'bandCont')
    for label, d in out.items():
        print('%-14s' % label, ' | '.join('%s ' % v[:4] + ' '.join('%s' % d[v][k] for k in keys) for v in VIEWS))
    return out


if __name__ == '__main__':
    if sys.argv[1] == 'port-check':
        sys.exit(0 if port_check() else 1)
    if sys.argv[1] == 'score':
        args = sys.argv[3:]
        tg = TARGETS
        if args and args[0].startswith('--targets='):
            tg = args.pop(0).split('=', 1)[1]  # printf pattern with the RUNTIME view name, e.g. dir/target-%s.png
        score(sys.argv[2], args, tg)
