# Destructive probe for I15 (E1 on a card round). <blender python> probe_e1_cards.py <cards.npz> <groom-round-dir> <scratch-dir>
# Base = the given cards.npz (pass expected, e.g. cards rebuilt from groom-r4/s4). Planted = a copy with every card whose
# root-edge midpoint lies in either sideburn patch deleted (vertices, triangles, per-card arrays). Reverted = the base again.
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CP, GD, SCR = (os.path.abspath(a) for a in sys.argv[1:4])
src = open(os.path.join(HERE, 'grade.py')).read()
ns = {'__file__': os.path.join(HERE, 'grade.py')}
exec(src.split('# ---- per-view measurement')[0], ns)
exec(src[src.index('def measure_e1('):src.index("tf = {v: Frame(")], ns)
bb = json.load(open(os.path.join(HERE, 'body_back.json')))


def ratios(path):
    o, err = ns['measure_e1_cards'](path, GD)
    if err:
        return err
    return {s: {k: round(o[s][k]['ratioToReference'], 2) for k in ('aboveEar', 'sideburn')} for s in 'LR'}


c = dict(np.load(CP))
d = np.load(os.path.join(GD, 'strands.npz')); P = d['positions'][::20].astype(float); Q = d['localPositions'][::20].astype(float)
pm, qm = P.mean(0), Q.mean(0); U, _, Vt = np.linalg.svd((Q - qm).T @ (P - pm)); Rm = U @ Vt; t = qm - pm @ Rm.T
V, uv, vc = c['card_verts'], c['card_uv'], c['vert_card']; nc = int(vc.max() + 1)
mid = np.zeros((nc, 3)); rv = np.where(uv[:, 1] == 0.0)[0]
np.add.at(mid, vc[rv], (V[rv] @ Rm.T + t) * 1000 / 2)
kill = np.zeros(nc, bool)
for name, sg in (('L', 1.0), ('R', -1.0)):
    b = bb['patches'][name]['sideburn']; q = mid * np.array([sg, 1, 1])
    kill |= (q[:, 0] >= 40) & (q[:, 1] >= b['y'][0]) & (q[:, 1] < b['y'][1]) & (q[:, 2] >= b['z'][0]) & (q[:, 2] < b['z'][1])
keepv = ~kill[vc]; newidx = np.cumsum(keepv) - 1
tri = c['card_tris']; kt = keepv[tri].all(1)
cardmap = np.cumsum(~kill) - 1
pl = dict(c)
pl.update(card_verts=V[keepv], card_uv=uv[keepv], vert_card=cardmap[vc[keepv]], card_tris=newidx[tri[kt]])
for k, v in c.items():
    if k not in pl or k in ('card_verts', 'card_uv', 'vert_card', 'card_tris'):
        continue
    if isinstance(v, np.ndarray) and v.ndim >= 1 and len(v) == nc:
        pl[k] = v[~kill]
os.makedirs(SCR, exist_ok=True)
pp = os.path.join(SCR, 'cards-no-sideburn.npz'); np.savez(pp, **pl)
print(json.dumps(dict(base=ratios(CP), deletedCards=int(kill.sum()), planted=ratios(pp), reverted=ratios(CP))))
