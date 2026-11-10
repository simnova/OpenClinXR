# Rubric v4 S2 landmarks: the left sideburn patch and ear top (body_back.json, head-local mm) projected into the canonical
# side view (groom.py camera_rig, azimuth 90: camera on +x looking -x; col = 511.5 + (y - headPlaneY) k, row = 511.5 -
# (z - targetZ) k, k = distM / (distM - x) / kMetresPerPx). Head-local -> world: the rigid transform fitted (Kabsch, as I15)
# from groom-r4/s4 strands.npz localPositions to positions; the head frame depends on the body only, so it is one constant
# for every round on the shipped body. <blender python> shape_landmarks.py -> shape_landmarks.json
import json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '../../../..'))
SRC = '.openclinxr/evidence/hair-groom-2/groom-r4/s4/strands.npz'
FR = json.load(open(os.path.join(HERE, 'frames.json')))
BB = json.load(open(os.path.join(HERE, 'body_back.json')))
K, ZC, HY, DIST = FR['canonical']['kMetresPerPx'], FR['canonical']['targetZ'], FR['side']['canonical_headPlaneY'], BB['camera']['distM']

d = np.load(os.path.join(WT, SRC)); P = d['positions'][::20].astype(float); Q = d['localPositions'][::20].astype(float)
pm, qm = P.mean(0), Q.mean(0); U, _, Vt = np.linalg.svd((Q - qm).T @ (P - pm)); Rm = U @ Vt; t = qm - pm @ Rm.T
resid = float(np.abs((P @ Rm.T + t) - Q).max() * 1000)


def proj(x, y, z):
    p = (np.array([x, y, z]) / 1000.0 - t) @ Rm
    k = DIST / (DIST - p[0]) / K
    return float(511.5 - (p[2] - ZC) * k), float(511.5 + (p[1] - HY) * k), float(1000 * K * (DIST - p[0]) / DIST)


sb = BB['patches']['L']['sideburn']; x = sb['meanAbsXMm']
c = {(y, z): proj(x, y, z) for y in sb['y'] for z in sb['z']}
out = dict(source='%s (Kabsch head-local -> world, max residual %.5f mm); body_back.json patches.L.sideburn, ear.L' % (SRC, resid),
           xMm=x, sideburnYMm=sb['y'], earTopZMm=sb['z'][1], tragusZMm=sb['z'][0],
           earTopRow=round(0.5 * (c[(sb['y'][0], sb['z'][1])][0] + c[(sb['y'][1], sb['z'][1])][0]), 2),
           tragusRow=round(0.5 * (c[(sb['y'][0], sb['z'][0])][0] + c[(sb['y'][1], sb['z'][0])][0]), 2),
           cols=[round(0.5 * (c[(sb['y'][0], sb['z'][0])][1] + c[(sb['y'][0], sb['z'][1])][1]), 2),
                 round(0.5 * (c[(sb['y'][1], sb['z'][0])][1] + c[(sb['y'][1], sb['z'][1])][1]), 2)],
           mmPerPx=round(float(np.mean([v[2] for v in c.values()])), 5),
           corners={'%g,%g' % kk: [round(v[0], 2), round(v[1], 2)] for kk, v in c.items()})
json.dump(out, open(os.path.join(HERE, 'shape_landmarks.json'), 'w'), indent=1)
print(json.dumps(out, indent=1))
