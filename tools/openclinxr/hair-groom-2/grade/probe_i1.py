# Destructive probe for I12 (skin-coloured hair). <blender python> probe_i1.py <scratch-dir> [old-grade.py]
# Paints tan hair (the cards-r1 front left crown, canonical rows 140-220 cols 395-475, rescaled by the target front frame
# s) into a copy of target-front-a1 at image rows 85-185 cols 400-500, only over px the target's own mask calls hair (the
# patch replaces dark hair with tan hair, never forehead or background); counts skin px in the patch with the pre-I12
# mask (old grade.py, if given) and the current mask; grades the planted self-score dir and a reverted copy.
import json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '../../../..'))
SCR = os.path.abspath(sys.argv[1]); OLD = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else None
TG = os.path.join(WT, 'tools/openclinxr/hair-groom-2/targets')
FR = json.load(open(os.path.join(HERE, 'frames.json')))
CARDS = os.path.join(WT, '.openclinxr/evidence/hair-groom-2/cards-r1/round/front.png')


def mask_fn(path):
    ns = {'__file__': os.path.join(HERE, 'grade.py')}  # frames.json etc. resolve beside the current grade.py
    exec(open(path).read().split('# ---- per-view measurement')[0], ns)
    return ns


def self_dir(name, front):
    d = os.path.join(SCR, name)
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for src, dst in (('front', 'front'), ('three_quarter', 'three_quarter_left'), ('profile', 'side'), ('back', 'back')):
        shutil.copy(os.path.join(TG, 'target-%s-a1.png' % src), os.path.join(d, dst + '.png'))
    front.save(os.path.join(d, 'front.png'))
    json.dump({v: {k: FR[v][k] for k in ('s', 'dx', 'dy')} for v in ('front', 'three_quarter', 'side', 'back')},
              open(os.path.join(d, 'frame.json'), 'w'))
    return d


f = FR['front']; s, dx, dy = f['s'], f['dx'], f['dy']
tgt = Image.open(os.path.join(TG, 'target-front-a1.png')).convert('RGB')
patch = Image.open(CARDS).convert('RGB').crop((395, 140, 475, 220))
n = int(round(80 * s)); patch = np.asarray(patch.resize((n, n), Image.BICUBIC))
r0, c0 = 85, 400
_ns = mask_fn(os.path.join(HERE, 'grade.py'))
_, thair, _ = _ns['masks'](np.asarray(tgt).astype(float) / 255, _ns['Frame'](s, dx, dy), 'front')
P = np.asarray(tgt).copy(); sel = thair[r0:r0 + n, c0:c0 + n]
P[r0:r0 + n, c0:c0 + n][sel] = patch[sel]
planted = Image.fromarray(P)
box = (r0, r0 + n, c0, c0 + n)
res = dict(patchBoxImagePx=list(box), paintedPx=int(sel.sum()))
for tag, path in (('old', OLD), ('new', os.path.join(HERE, 'grade.py'))):
    if path is None:
        continue
    ns = mask_fn(path)
    F = ns['Frame'](s, dx, dy)
    for img, nm in ((tgt, 'target'), (planted, 'planted')):
        A = np.asarray(img).astype(float) / 255
        _, hair, skin = ns['masks'](A, F, 'front')
        res['%s_%s_skinPxInPatch' % (tag, nm)] = int(skin[box[0]:box[1], box[2]:box[3]].sum())
        res['%s_%s_skinPxTotal' % (tag, nm)] = int(skin.sum())
for nm, img in (('planted', planted), ('reverted', tgt)):
    d = self_dir('i1-' + nm, img)
    subprocess.run([sys.executable, os.path.join(HERE, 'grade.py'), d], check=True, capture_output=True)
    it = json.load(open(os.path.join(d, 'measures.json')))['numericItems']
    res[nm] = {k: (it[k]['result'], it[k]['value']) for k in ('A1', 'A2', 'A5', 'A11')}
    res[nm + '_numericPass'] = sum(v['result'] == 'PASS' for v in it.values())
print(json.dumps(res, indent=1))
