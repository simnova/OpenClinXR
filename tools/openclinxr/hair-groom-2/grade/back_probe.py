# Blender headless: body landmarks for rubric v3 (back view frame, E1 root-coverage patches).
#   Blender -b --factory-startup -P back_probe.py -- <body.glb> <out.json>
# Uses groom.py's own load_body / head_frame / eye_height / camera_rig, so the head-local frame matches
# strands.npz localPositions and the projection matches the canonical back render (azimuth 180) exactly.
# Writes:
#   back.bodyRows / back.garmentRows: per canonical back-view row, [min col, max col] of the body (skin) and of the
#     visible garments, from points sampled densely on every triangle (20x20 barycentric grid).
#   ear[L|R]: ear landmarks in head-local mm (x subject left, y back, z up; origin head bone). An ear cell is a
#     3 mm (y, z) cell whose max |x| exceeds the skull reference by > 5 mm; the skull reference at each z is linear in y
#     between the max |x| at y -45..-33 (in front of the ear) and y 24..36 (behind it). Tragus z = z of the concha
#     (lowest |x| excess over the ear interior, cells >= 2 cells inside the ear's y extent), the ear-canal entrance the tragus fronts.
#   patches[L|R]: E1 patch boxes (head-local mm) and the body surface area in each (lateral side only, |x| >= 40 mm).
import bpy, sys, json
from pathlib import Path
import numpy as np
from bpy_extras.object_utils import world_to_camera_view

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "groom"))
import groom  # noqa: E402  (helpers only; main() is guarded)
import bmesh  # noqa: E402

glb, out = sys.argv[sys.argv.index('--') + 1:][:2]
body, garments, rig, hidden = groom.load_body(Path(glb))
bm = groom.world_bmesh(body)
origin, R, centre, ztop = groom.head_frame(rig, bm)
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=groom.WELD_M)
V = np.array([v.co[:] for v in bm.verts]); F = np.array([[v.index for v in f.verts] for f in bm.faces])
bm.free()
n = 20
u, v = np.meshgrid(np.linspace(0, 1, n), np.linspace(0, 1, n)); m = (u + v) <= 1; u = u[m]; v = v[m]
W = np.stack([1 - u - v, u, v], 1)                       # (k, 3) barycentric weights


def samples(V, F):
    T = V[F]
    area = 0.5 * np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1)
    P = np.einsum('kj,fjd->fkd', W, T).reshape(-1, 3)
    A = np.repeat(area / len(W), len(W))                # area carried by each sample
    return P, A


# ---- back view silhouettes in the canonical frame -----------------------------------------
eye_z = groom.eye_height()
place, cam = groom.camera_rig(origin, R, centre, ztop, eye_z)
place(groom.VIEW_AZIMUTH_DEG["back"])
sc = bpy.context.scene
sc.render.resolution_x = sc.render.resolution_y = groom.RES
sc.render.resolution_percentage = 100
bpy.context.view_layer.update()
camo = sc.camera


def project(P):
    # numpy pinhole projection of the scene camera; checked against world_to_camera_view below
    Mi = np.array(camo.matrix_world.inverted())
    q = (Mi[:3, :3] @ P.T).T + Mi[:3, 3]
    f = camo.data.lens / camo.data.sensor_height        # sensor_fit VERTICAL, square frame
    col = (0.5 + f * q[:, 0] / -q[:, 2]) * groom.RES
    row = (0.5 - f * q[:, 1] / -q[:, 2]) * groom.RES
    return row, col


def rows_extent(P):
    row, col = project(P)
    ok = (row >= 0) & (row < groom.RES) & (col >= 0) & (col < groom.RES)
    ri = np.floor(row[ok]).astype(int); c = col[ok]
    o = np.argsort(ri, kind='stable'); ri, c = ri[o], c[o]
    out_ = {}
    us, st = np.unique(ri, return_index=True)
    en = np.append(st[1:], len(ri))
    for r, a, b in zip(us, st, en):
        out_[int(r)] = [round(float(c[a:b].min()), 2), round(float(c[a:b].max()), 2)]
    return out_


from mathutils import Vector  # noqa: E402
_chk = V[:: max(1, len(V) // 50)]
_r, _c = project(_chk)
_w = np.array([world_to_camera_view(sc, camo, Vector(p))[:] for p in _chk])
PROJ_ERR = float(max(np.abs(_c - _w[:, 0] * groom.RES).max(), np.abs(_r - (1 - _w[:, 1]) * groom.RES).max()))

Pb, _ = samples(V, F)
Pb = Pb[Pb[:, 2] > origin[2] - 0.45]                    # head to upper arms; the frame bottom is ~0.33 m below
body_rows = rows_extent(Pb)
gar_rows = {}
for g in garments:
    gb = groom.world_bmesh(g)
    gv = np.array([x.co[:] for x in gb.verts]); gf = np.array([[x.index for x in f.verts] for f in gb.faces if len(f.verts) == 3])
    gb.free()
    if not len(gf):
        continue
    Pg, _ = samples(gv, gf)
    Pg = Pg[Pg[:, 2] > origin[2] - 0.45]
    for r, (a, b) in rows_extent(Pg).items():
        if r in gar_rows:
            gar_rows[r] = [min(gar_rows[r][0], a), max(gar_rows[r][1], b)]
        else:
            gar_rows[r] = [a, b]

# ---- ear landmarks and E1 patches (head-local mm) -------------------------------------------
Rm = np.array(R)
Vl = (Rm @ (V - np.array(origin)).T).T * 1000.0
G = 3.0
YS = np.arange(-45, 39, G); ZS = np.arange(-39, 72, G)
ear, patches = {}, {}
for name, side in (('L', 1.0), ('R', -1.0)):
    P, A = samples(Vl * np.array([side, 1, 1]), F)       # mirror the right side onto +x
    lat = P[:, 0] >= 40.0
    iy = np.floor((P[:, 1] - YS[0]) / G).astype(int); iz = np.floor((P[:, 2] - ZS[0]) / G).astype(int)
    ok = lat & (iy >= 0) & (iy < len(YS)) & (iz >= 0) & (iz < len(ZS))
    M = np.full((len(ZS), len(YS)), -np.inf)
    np.maximum.at(M, (iz[ok], iy[ok]), P[ok, 0])
    fr, bk = M[:, :4].max(1), M[:, -4:].max(1)
    yc = YS + G / 2; yf, yb = yc[:4].mean(), yc[-4:].mean()
    ref = fr[:, None] + (bk - fr)[:, None] * (yc[None] - yf) / (yb - yf)
    ex = M - ref
    E = ex > 5.0
    zi, yi = np.where(E)
    z_top = float(ZS[zi].max() + G); z_bot = float(ZS[zi].min())
    y_front = float(YS[yi].min()); y_back = float(YS[yi].max() + G)
    # concha: lowest |x| excess over the ear interior (cells >= 2 cells inside the ear's y extent in their row, ear
    # cell or not); on this decimated mesh the concha is a shallow dip, not always below the 5 mm ear threshold
    best = None
    for k in range(len(ZS)):
        js = np.where(E[k])[0]
        if len(js) < 5:
            continue
        for j in range(js.min() + 2, js.max() - 1):
            if best is None or ex[k, j] < best[0]:
                best = (float(ex[k, j]), float(ZS[k] + G / 2), float(YS[j] + G / 2))
    z_tragus = best[1]
    ear[name] = dict(zTopMm=z_top, zBottomMm=z_bot, yFrontMm=y_front, yBackMm=y_back, zTragusMm=z_tragus,
                     concha=dict(excessMm=best[0], zMm=best[1], yMm=best[2]), cells=int(E.sum()))
    boxes = {
        'aboveEar': dict(y=[y_front, y_back], z=[z_top, z_top + 10.0]),
        'sideburn': dict(y=[y_front - 12.0, y_front], z=[z_tragus, z_top]),
        'reference': dict(y=[y_front - 12.0, y_back], z=[z_top + 20.0, z_top + 40.0]),
    }
    for k_, b in boxes.items():
        inb = lat & (P[:, 1] >= b['y'][0]) & (P[:, 1] < b['y'][1]) & (P[:, 2] >= b['z'][0]) & (P[:, 2] < b['z'][1])
        b['areaMm2'] = float(A[inb].sum())
        b['meanAbsXMm'] = float(P[inb, 0].mean()) if inb.any() else None
    patches[name] = boxes

res = dict(body=glb, headOrigin=list(origin), camera=cam, eyeZ=eye_z, projectionCheckMaxErrPx=PROJ_ERR,
           note='canonical back view (azimuth 180); rows/cols are continuous canonical pixel coordinates',
           back=dict(bodyRows=body_rows, garmentRows=gar_rows, garments=[g.name for g in garments]),
           ear=ear, patches=patches,
           patchRule=dict(aboveEar='y over the ear front..back, z from the ear top to +10 mm',
                          sideburn='y from 12 mm in front of the ear front edge to the ear front edge, z from the tragus to the ear top',
                          reference='same side, y from the sideburn front to the ear back, z from ear top +20 to +40 mm (temporal scalp above both patches)'))
json.dump(res, open(out, 'w'), indent=1)
print('BACK_PROBE', out, 'projErrPx', PROJ_ERR, json.dumps(ear), json.dumps({k: {p: round(v['areaMm2']) for p, v in b.items()} for k, b in patches.items()}))
