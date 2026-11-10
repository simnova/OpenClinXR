"""matte_check.py: STEP A proof + STEP B contamination + STEP C (A3 E1/E2/E3 on matte masks). Writes matte/check.json.
Run with Blender's python (numpy+PIL). Paths are the lane's evidence dirs (read only) and W2's matte dir."""
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "grade"))
sys.path.insert(0, str(HERE))
import matte as mt  # noqa: E402
import sheen_gate as sg  # noqa: E402

EV = Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-groom-2/.openclinxr/evidence/hair-groom-2')
W2 = HERE.parents[3]
OPT = W2 / '.openclinxr/opt/hair-groom-2'
MD = OPT / 'matte'
VIEWS = mt.VIEWS
COLOUR = {t: str(EV / 'p1/crops') + '/tsAgX-' + t for t in ('r10', 'best3', 'ns15')}
COLOUR.update(g2=str(EV / 'p2/st1/crops/ts-g2'), p2a=str(EV / 'p2/st1/crops/ts-p2a'))
NOHAIR = {t: str(EV / 'p1/crops') + '/tsAgX-nohair' for t in ('r10', 'best3', 'ns15')}
NOHAIR.update(g2=str(OPT / 'nohair/nohair-g2'), p2a=str(OPT / 'nohair/nohair-p2a'))


def edge(L):
    return np.hypot(np.diff(L, axis=0, append=L[-1:]), np.diff(L, axis=1, append=L[:, -1:]))


def planes(tag, v):
    return (sg.load('%s-%s.png' % (COLOUR[tag], v)), sg.load('%s-%s.png' % (NOHAIR[tag], v)),
            sg.load('%s/m-%s-%s.png' % (MD, tag, v)), sg.load('%s/m-%s-%s-hair.png' % (MD, tag, v)),
            sg.load('%s/m-%s-%s-empty.png' % (MD, tag, v)))


def geometry():
    out = {}
    for tag in COLOUR:
        for v in VIEWS:
            c, n, c2, h, e = planes(tag, v)
            raw = mt.raw_matte(c, n, h, e)
            ho = mt.hair_only_mask(h, e)
            same_render = float(np.abs(c - c2).max())
            nsame = float((np.abs(c - c2).max(2) <= 1 / 255.).mean())
            # in the visible-hair matte the hair-only render and the colour render are the same pixels except where hair
            # blends over body or other hair layers are depth-sorted differently; share of exact (<=1/255) equality
            eq = float((np.abs(c - h).max(2)[raw] <= 1 / 255.).mean())
            # silhouette alignment: edges of the hair-only silhouette vs edges of the colour-vs-nohair diff, 1 px tolerance
            d = np.abs(c - n).max(2) > 3 / 255.
            eh = ho ^ sg.erode(ho, 1)
            ed = d ^ sg.erode(d, 1)
            near = sg.dilate(ed, 1)
            # edge overlay: share of hair-only silhouette edge px (restricted to where colour differs from nohair, i.e.
            # visible hair) that lie within 1 px of a colour-vs-nohair diff edge
            vis = eh & sg.dilate(d, 1)
            share = float((vis & near).sum() / max(vis.sum(), 1))
            out['%s/%s' % (tag, v)] = dict(colour_rerender_maxabs=round(same_render, 5), colour_rerender_eq_share=round(nsame, 6),
                                          matte_px=int(raw.sum()), hair_equals_colour_share=round(eq, 4),
                                          silhouette_edge_px=int(vis.sum()), silhouette_edge_within1px_of_diff_edge=round(share, 4))
    return out


def contamination(tags=('best3', 'r10', 'g2')):
    out = {}
    for tag in tags:
        for v in VIEWS:
            c, n, _, h, e = planes(tag, v)
            diff = sg.render_hair(c, n)
            raw = mt.raw_matte(c, n, h, e)
            matte = sg.erode(raw, 2)
            ho = mt.hair_only_mask(h, e)
            L = sg.luma(c)
            out_m = diff & ~matte
            out_s = diff & ~ho
            out['%s/%s' % (tag, v)] = dict(
                diff_px=int(diff.sum()), matte_px=int(matte.sum()),
                diff_outside_matte_px=int(out_m.sum()), diff_outside_matte_share=round(float(out_m.sum() / max(diff.sum(), 1)), 4),
                diff_outside_matte_meanL=round(float(L[out_m].mean()), 4) if out_m.any() else None,
                diff_outside_silhouette_px=int(out_s.sum()), diff_outside_silhouette_share=round(float(out_s.sum() / max(diff.sum(), 1)), 4),
                diff_outside_silhouette_meanL=round(float(L[out_s].mean()), 4) if out_s.any() else None,
                matte_not_in_diff_px=int((matte & ~diff).sum()))
    return out


# ---------- STEP C: compute.py logic on matte masks (frame p1-rt: EV/p1/tgt-rt targets, as A3) ----------
SHEEN = [('peak', 'peak', lambda t: .3 * t, 1), ('base', 'base', lambda t: .3 * t, 1), ('black', 'black', lambda t: .05, 1),
         ('hue', 'hue', lambda t: 10., .5), ('sat', 'sat', lambda t: .3 * t, 1), ('bandRowCol', 'bandRowCol', lambda t: .05, 1),
         ('bandCont', 'bandCont', lambda t: .10, .5), ('streak', 'streak', lambda t: .5 * t, 1)]


def dterms(c, t):
    o = {}
    for n, f, s, w in SHEEN:
        if c.get(f) is None or t.get(f) is None:
            o[n] = None
            continue
        o[n] = w * abs(c[f] - t[f]) / s(t[f])
    return o


def e123():
    tg = {}
    for v in VIEWS:
        t = sg.load(str(EV / 'p1/tgt-rt') + '/target-%s.png' % v)
        tg[v] = sg.full_row(t, sg.target_hair(t))
    res = {}
    for mode in ('diff', 'matte'):
        res[mode] = {}
        for tag in ('r10', 'best3', 'ns15'):
            res[mode][tag] = {}
            for v in VIEWS:
                c, n, _, h, e = planes(tag, v)
                m = sg.render_hair(c, n) if mode == 'diff' else sg.erode(mt.raw_matte(c, n, h, e), 2)
                row = sg.full_row(c, m)
                tt = dterms(row, tg[v])
                res[mode][tag][v] = dict(D_v=sum(x for x in tt.values() if x is not None), terms=tt, row=row,
                                         missing=[k for k, x in tt.items() if x is None])
    rows = {}
    for mode in res:
        r = res[mode]
        rows[mode] = dict(
            E1={v: dict(best3=r['best3'][v]['D_v'], r10=r['r10'][v]['D_v'], pass_=r['best3'][v]['D_v'] < r['r10'][v]['D_v']) for v in VIEWS},
            E2={v: dict(best3=r['best3'][v]['D_v'], ns15=r['ns15'][v]['D_v'], pass_=r['best3'][v]['D_v'] < r['ns15'][v]['D_v']) for v in VIEWS})
    P = json.load(open(EV / 'p2/part-p2ab.json'))
    e3 = lambda c: (abs(P[c]['partWidthMedPx'] - P['target']['partWidthMedPx']) / 2. + abs(P[c]['hairlineFalloffMedPx'] - P['target']['hairlineFalloffMedPx']) / 4.)
    rows['E3'] = dict(p2a=e3('p2a'), best3=e3('best3'), pass_=e3('p2a') < e3('best3'),
                      note='part_width.measure reads image luminance only (no hair mask), so the matte changes nothing; part-p2ab.json as in A3')
    return res, rows


if __name__ == '__main__':
    out = dict(geometry=geometry(), contamination=contamination())
    res, rows = e123()
    out['e123'] = rows
    out['e123_detail'] = res
    (MD / 'check.json').write_text(json.dumps(out, indent=1, default=float))
    for k, g in out['geometry'].items():
        print('GEOM', k, g)
    for k, g in out['contamination'].items():
        print('CONT', k, g)
    print(json.dumps(rows, indent=1, default=float))
