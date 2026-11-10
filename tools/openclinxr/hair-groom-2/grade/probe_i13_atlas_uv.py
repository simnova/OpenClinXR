# Probe for the I13 atlas-UV fix. <blender python> probe_i13_atlas_uv.py <round-dir> <scratch-dir>
# Runs card_side_silhouette (I13) on the round's cards.npz regardless of censoring, twice: as-is (card_atlas_uv when
# present) and with card_atlas_uv dropped (the pre-fix sampling: per-card card_uv over the whole atlas). Prints the A3
# bottom row/z, frame check and silhouette counts for each.
import json, os, shutil, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RD, SCR = (os.path.abspath(a) for a in sys.argv[1:3])
src = open(os.path.join(HERE, 'grade.py')).read()
ns = {'__file__': os.path.join(HERE, 'grade.py')}
exec(src.split('# ---- per-view measurement')[0], ns)
exec(src[src.index('def card_round('):src.index('def measure_e1_cards(')], ns)
st = ns['card_round'](RD)
cp = os.path.join(ns['WT'], st['cards'])
os.makedirs(SCR, exist_ok=True)
c = dict(np.load(cp)); c.pop('card_atlas_uv', None)
np.savez(os.path.join(SCR, 'cards.npz'), **c)
shutil.copy(os.path.join(os.path.dirname(cp), 'body-geo.npz'), os.path.join(SCR, 'body-geo.npz'))
st2 = dict(st, cards=os.path.join(SCR, 'cards.npz'))
for name, s in (('card_atlas_uv (fixed)', st), ('card_uv (pre-fix)', st2)):
    o = ns['card_side_silhouette'](RD, s)
    if 'error' in o:
        print(name, 'ERROR', o['error']); continue
    print('%-22s bottom row %d z %.4f m (target %.4f: %+.1f mm) frameCheck mean %.1f max %d px/row countAtRow1023 %d' % (
        name, o['row'], o['z'], 1.171, (o['z'] - 1.171) * 1000, o['frameCheckMeanAbsPx'], o['frameCheckMaxAbsPx'], o['countAtFrameBottom']))
    print('   rows/geom/image every 40:', o['countsEvery40Rows'])
