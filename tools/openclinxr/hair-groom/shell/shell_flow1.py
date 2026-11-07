"""S8 shell1 STEP 1 (numpy): repair + length diagnosis + face cut + inner.

Reads: shell0 WS shell_dec_{a,b}.obj (Blender decimate x2, read-only),
shell0 WS shell_raw.obj (pre-decimate, read-only, length diagnosis only),
hull0c hull.npz (length diagnosis only), cage1 exact SDF, scalp1
roots.npz + hairline.json (part), scorer-v3 front camera (projection),
judge target front mask mask-front-v2.png (face hole, read-only).
Writes: E1/shell.npz (cut outer + partial inner, flow UVs, tangents) +
E1/WS/flow1.json.

Length diagnosis (stated): hull0c occupancy voxel count by z band below
the 1.405 m shoulder plane + shell mesh lowest z per 40-degree azimuth
sector at three stages (raw marching-cubes mesh, decimated pre-repair,
repaired). Verdict from the numbers, not assumed.

Face cut (stated): the target front mask's face hole = gap between the
two hair runs on rows with exactly two runs (gap >= 8 px; the mask has
no enclosed hole: the gap reaches the frame bottom). Hole mapped from
the target frame to the render frame by the INVERSE skull registration
(render = (target - t)/s, nearest px), eroded 2 px (curtain margin),
then to the mesh: faces whose centroid projects inside the eroded hole
AND whose centroid is anterior of YCUT are removed. Anterior-only so
the back mass (posterior, projects into the hole through the head) is
kept. Curtains project outside the hole and are kept by construction.

Clearance: exact-SDF trilinear query at outer verts (world mm); repair
pushes verts with sdf < 2.0 mm out along the SDF gradient (same rule as
shell0; mesh normals can point into the body in hug-tight spots). Gate:
final min >= 1.0 mm.

Inner layer: outer verts shifted -3 mm along the outward normal, flipped
winding, FULL coverage (all outer faces): inner verts with sdf < 1.5 mm
are repaired out along the SDF gradient to 1.5 mm (same gradient rule
as the outer repair; 0.5 mm margin over the 1.0 mm gate), so the inner
min clears the gate by construction and there is no inner rim edge
inside the curtain. Kept-vert minima are stated in flow1.json. The
inner carries an opaque dark-hair material at render (alpha 1), so
strand gaps in the outer show hair, never skin.

Flow/tangent/UV: identical stated formulas to shell0 (part from crown
roots, smoothstep(1.56,1.62,z) crown->gravity blend, u = azimuth around
the crown axis with the 0/1 cut at the back midline, v = root->tip run).

Determinism: fixed-order numpy only (no RNG). Two-run mesh-hash gate
compares parsed verts/faces of decimate runs A and B (same files shell0
used); the face cut is fixed-order over face indices.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

S8 = Path(__file__).resolve().parent
sys.path.insert(0, str(S8))
sys.path.insert(0, str(S8.parent / "cage"))
from common import log_open, smoothstep  # noqa: E402
import exact as EXACT  # noqa: E402

ROOT = S8.parents[3]
E0 = ROOT / "tools/openclinxr/evidence/hair-shell0"
E = ROOT / "tools/openclinxr/evidence/hair-shell1"
WS = E / "workspace"
WS0 = E0 / "workspace"
S1 = ROOT / "tools/openclinxr/evidence/hair-scalp1"
CAGE1 = ROOT / "tools/openclinxr/evidence/hair-cage1"
HULL = ROOT / "tools/openclinxr/evidence/hair-hull0c"
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")

INNER_MM = 3.0
REPAIR_TARGET_MM = 2.0
GATE_MM = 1.0
SHOULDER_M = 1.405
YCUT = -0.008  # anterior keep/cut plane (m, world y; camera side is -y)
FOCAL_PX = 50.0 * 1024 / 36.0
# front skull registration (render -> target), from the scorer v3
# orientation block (bit-identical to rulers skull mode)
REG_S = 0.9545143883864126
REG_TX = 24.28863314615677
REG_TY = 51.51811157072147
SECTORS = [(-22.5, 22.5, "front"), (22.5, 67.5, "frontR"),
           (67.5, 112.5, "right"), (112.5, 157.5, "backR"),
           (157.5, 180.0, "backMid"), (-180.0, -157.5, "backMid2"),
           (-157.5, -112.5, "backL"), (-112.5, -67.5, "left"),
           (-67.5, -22.5, "frontL")]


def load_obj(path):
    v, f = [], []
    with open(path) as fh:
        for ln in fh:
            if ln.startswith("v "):
                v.append([float(x) for x in ln.split()[1:4]])
            elif ln.startswith("f "):
                f.append([int(x.split("/")[0]) - 1
                          for x in ln.split()[1:4]])
    return (np.ascontiguousarray(np.array(v, dtype=np.float64)),
            np.ascontiguousarray(np.array(f, dtype=np.int64)))


def vertex_normals(verts, faces):
    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]
    fn = np.cross(v1 - v0, v2 - v0)
    n = np.zeros_like(verts)
    np.add.at(n, faces[:, 0], fn)
    np.add.at(n, faces[:, 1], fn)
    np.add.at(n, faces[:, 2], fn)
    L = np.linalg.norm(n, axis=1)
    L[L < 1e-12] = 1.0
    return n / L[:, None]


def sdf_gradient(grid, pts_mm):
    h = 1.0
    g = np.empty_like(pts_mm)
    for ax in range(3):
        d = np.zeros(3)
        d[ax] = h
        g[:, ax] = (EXACT.query_exact(grid, pts_mm + d)
                    - EXACT.query_exact(grid, pts_mm - d)) / (2 * h)
    L = np.linalg.norm(g, axis=1)
    L[L < 1e-12] = 1.0
    return g / L[:, None]


def minz_by_sector(verts, part_x, y_crown):
    az = np.degrees(np.arctan2(verts[:, 0] - part_x,
                               -(verts[:, 1] - y_crown)))
    out = {}
    for lo, hi, nm in SECTORS:
        m = (az >= lo) & (az < hi)
        out[nm] = round(float(verts[m, 2].min()), 4) if m.any() else None
    return out


def main():
    E.mkdir(parents=True, exist_ok=True)
    WS.mkdir(parents=True, exist_ok=True)
    log_open(Path(__file__))
    va, fa = load_obj(WS0 / "shell_dec_a.obj")
    vb, fb = load_obj(WS0 / "shell_dec_b.obj")
    log_open(WS0 / "shell_dec_a.obj")
    log_open(WS0 / "shell_dec_b.obj")
    ha = hashlib.sha256(np.ascontiguousarray(va).tobytes()
                        + np.ascontiguousarray(fa).tobytes()).hexdigest()
    hb = hashlib.sha256(np.ascontiguousarray(vb).tobytes()
                        + np.ascontiguousarray(fb).tobytes()).hexdigest()
    print("MESH_HASH runA=%s runB=%s identical=%s" % (
        ha[:16], hb[:16], ha == hb), flush=True)
    assert ha == hb, "decimate nondeterminism"
    verts, faces = va, fa

    grid = EXACT.load_exact(str(CAGE1 / "body-exact-sdf.npz"))
    log_open(CAGE1 / "body-exact-sdf.npz")

    # ---- length diagnosis: hull occupancy by z band + azimuth ----
    hn = HULL / "hull.npz"
    log_open(hn)
    h = np.load(str(hn))
    occ = np.array(h["occupancy"], dtype=bool)
    xs, ys, zs = np.array(h["xs"]), np.array(h["ys"]), np.array(h["zs"])
    XX, YY = np.meshgrid(xs, ys, indexing="ij")
    azh = np.degrees(np.arctan2(XX - 0.8, -(YY + 53.2)))  # mm crown axis
    bands = [(1250, 1300), (1300, 1350), (1350, 1405), (1405, 1450),
             (1450, 1500)]
    hull_bands = {}
    for lo, hi in bands:
        m = (zs >= lo) & (zs < hi)
        hull_bands["%d-%d" % (lo, hi)] = int(occ[:, :, m].sum())
    hull_sect = {}
    zb = np.array([i for i, z in enumerate(zs) if z < 1405])
    for lo, hi, nm in SECTORS:
        m = (azh >= lo) & (azh < hi)
        hull_sect[nm] = int(occ[m][:, zb].sum())
    print("HULL_BELOW bands=%s" % json.dumps(hull_bands), flush=True)
    print("HULL_BELOW_SECT1405=%s" % json.dumps(hull_sect), flush=True)

    # ---- length diagnosis: mesh lowest z per sector, 3 stages ----
    roots = np.load(str(S1 / "roots.npz"))
    log_open(S1 / "roots.npz")
    rxyz = np.array(roots["xyz"], dtype=np.float64)
    crown_roots = rxyz[rxyz[:, 2] > 1.60]
    part_x = float(np.median(crown_roots[:, 0]))
    hl = json.loads((S1 / "hairline.json").read_text())
    log_open(S1 / "hairline.json")
    y_crown = float(hl["axis"]["y"])
    vr, _ = load_obj(WS0 / "shell_raw.obj")
    log_open(WS0 / "shell_raw.obj")
    minz_raw = minz_by_sector(vr, part_x, y_crown)
    minz_dec = minz_by_sector(verts, part_x, y_crown)
    print("MINZ_RAW=%s" % json.dumps(minz_raw), flush=True)
    print("MINZ_DEC=%s" % json.dumps(minz_dec), flush=True)

    # ---- orientation: per-face SDF ascent (same stated rule as shell0) --
    n = vertex_normals(verts, faces)
    cen = verts[faces].mean(axis=1)
    grad_c = sdf_gradient(grid, cen * 1000.0)
    fn = np.cross(verts[faces[:, 1]] - verts[faces[:, 0]],
                  verts[faces[:, 2]] - verts[faces[:, 0]])
    fnl = np.linalg.norm(fn, axis=1)
    ok = fnl > 1e-15
    back = np.zeros(len(faces), dtype=bool)
    back[ok] = ((fn[ok] / fnl[ok, None]) * grad_c[ok]).sum(axis=1) < 0
    print("ORIENT faces=%d flipped=%d (%.1f%%)" % (
        len(faces), int(back.sum()), 100.0 * back.mean()), flush=True)
    faces[back] = faces[back][:, ::-1]

    # ---- clearance repair (SDF gradient, same rule as shell0) ----
    sdf0 = EXACT.query_exact(grid, verts * 1000.0)
    print("CLEARANCE pre-repair min=%.3f p1=%.3f p50=%.3f mm n=%d" % (
        sdf0.min(), np.percentile(sdf0, 1), np.percentile(sdf0, 50),
        len(verts)), flush=True)
    rounds = 0
    sdf = sdf0
    while float(sdf.min()) < REPAIR_TARGET_MM and rounds < 5:
        low = sdf < REPAIR_TARGET_MM
        g = sdf_gradient(grid, verts[low] * 1000.0)
        verts[low] = verts[low] + (
            g * ((REPAIR_TARGET_MM - sdf[low]) / 1000.0)[:, None])
        sdf = EXACT.query_exact(grid, verts * 1000.0)
        rounds += 1
    print("CLEARANCE post-repair rounds=%d min=%.3f p1=%.3f p50=%.3f mm" % (
        rounds, sdf.min(), np.percentile(sdf, 1),
        np.percentile(sdf, 50)), flush=True)
    minz_rep = minz_by_sector(verts, part_x, y_crown)
    print("MINZ_REP=%s" % json.dumps(minz_rep), flush=True)

    # ---- face cut: target front gap -> render frame -> mesh ----
    cams = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json").read_text())
    log_open(ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json")
    mw = np.array(cams["views"]["front"]["matrixWorld"], dtype=float)
    tmask = JUDGE / "target-set-back/mask-front-v2.png"
    log_open(tmask)
    m = np.array(Image.open(tmask).convert("L")) > 127
    hole = np.zeros_like(m)
    for r in range(1024):
        row = m[r]
        d = np.diff(row.astype(np.int8))
        starts = list(np.nonzero(d == 1)[0] + 1)
        ends = list(np.nonzero(d == -1)[0] + 1)
        if row[0]:
            starts = [0] + starts
        if row[-1]:
            ends = ends + [1024]
        if len(starts) == 2 and starts[1] - ends[0] >= 8:
            hole[r, ends[0]:starts[1]] = True
    hole_px = int(hole.sum())
    ys_h, xs_h = np.nonzero(hole)
    rx = np.round((xs_h - REG_TX) / REG_S).astype(int)
    ry = np.round((ys_h - REG_TY) / REG_S).astype(int)
    okp = (rx >= 0) & (rx < 1024) & (ry >= 0) & (ry < 1024)
    rh = np.zeros_like(hole)
    rh[ry[okp], rx[okp]] = True
    render_hole_px = int(rh.sum())
    er = np.array(Image.fromarray(
        (rh.astype(np.uint8) * 255)).filter(ImageFilter.MinFilter(5))) > 127
    eroded_px = int(er.sum())
    cen = verts[faces].mean(axis=1)
    w = np.concatenate([cen, np.ones((len(cen), 1))], axis=1)
    cam = np.linalg.inv(mw) @ w.T
    X, Y, Z = cam[0], cam[1], cam[2]
    px = np.round(512 + FOCAL_PX * (X / -Z)).astype(int)
    py = np.round(512 - FOCAL_PX * (Y / -Z)).astype(int)
    inside = (px >= 0) & (px < 1024) & (py >= 0) & (py < 1024)
    proj_hit = np.zeros(len(faces), dtype=bool)
    proj_hit[inside] = er[py[inside], px[inside]]
    anterior = cen[:, 1] < YCUT
    cut = proj_hit & anterior
    keep_faces = faces[~cut]
    print("FACECUT hole_tgt=%d hole_render=%d eroded=%d projHit=%d "
          "anterior=%d CUT=%d KEEP=%d" % (
              hole_px, render_hole_px, eroded_px, int(proj_hit.sum()),
              int((proj_hit & anterior).sum()), int(cut.sum()),
              int((~cut).sum())), flush=True)
    removed_xmax = round(float(np.abs(cen[cut][:, 0]).max()), 4) if cut.any() else 0.0
    removed_z = [round(float(cen[cut][:, 2].min()), 4),
                 round(float(cen[cut][:, 2].max()), 4)] if cut.any() else [0, 0]
    print("FACECUT removed |x|max=%.4f zrange=%s (curtains live at "
          "|x|>0.06: kept by hole geometry)" % (removed_xmax, removed_z),
          flush=True)
    faces = np.ascontiguousarray(keep_faces)
    n = vertex_normals(verts, faces)
    sdf = EXACT.query_exact(grid, verts * 1000.0)

    # ---- inner layer: -3 mm, full coverage, gradient repair to 1.5 --
    inner = verts - n * (INNER_MM / 1000.0)
    inner_sdf = EXACT.query_exact(grid, inner * 1000.0)
    inner_rounds = 0
    while float(inner_sdf.min()) < 1.5 and inner_rounds < 5:
        low = inner_sdf < 1.5
        g = sdf_gradient(grid, inner[low] * 1000.0)
        inner[low] = inner[low] + (
            g * ((1.5 - inner_sdf[low]) / 1000.0)[:, None])
        inner_sdf = EXACT.query_exact(grid, inner * 1000.0)
        inner_rounds += 1
    inner_faces = faces[:, ::-1].copy()
    print("INNER full=%d faces rounds=%d min=%.3f p1=%.3f mm" % (
        len(inner_faces), inner_rounds, float(inner_sdf.min()),
        float(np.percentile(inner_sdf, 1))), flush=True)

    # ---- flow tangents + UVs (same stated formulas as shell0) ----
    dx = verts[:, 0] - part_x
    dy = verts[:, 1] - y_crown
    rh_ = np.hypot(dx, dy)
    rhat = np.stack([dx / np.maximum(rh_, 1e-9),
                     dy / np.maximum(rh_, 1e-9),
                     np.zeros_like(rh_)], axis=1)
    rhat[rh_ < 1e-6] = (0.0, -1.0, 0.0)
    w_ = smoothstep(1.56, 1.62, verts[:, 2])[:, None]
    down = np.array([0.0, 0.0, -1.0])
    d = w_ * rhat + (1.0 - w_) * down
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-12)
    t = d - n * (d * n).sum(axis=1, keepdims=True)
    tl = np.linalg.norm(t, axis=1)
    bad = tl < 1e-9
    if bad.any():
        alt = np.cross(n[bad], np.array([0.0, 0.0, 1.0]))
        altl = np.linalg.norm(alt, axis=1, keepdims=True)
        altl[altl < 1e-12] = 1.0
        t[bad] = alt / altl
        tl = np.linalg.norm(t, axis=1)
    t /= tl[:, None]
    az = np.arctan2(dx, -dy)
    u = ((az + np.pi) % (2 * np.pi)) / (2 * np.pi)
    zmax, zmin = float(verts[:, 2].max()), float(verts[:, 2].min())
    rhmax = float(rh_.max())
    v = (((zmax - verts[:, 2]) + 0.5 * np.maximum(0.0, rh_ - 0.02))
         / ((zmax - zmin) + 0.5 * max(0.0, rhmax - 0.02)))
    uv = np.ascontiguousarray(np.stack([u, np.clip(v, 0, 1)], axis=1))

    out = {
        "verts": np.ascontiguousarray(verts),
        "faces": np.ascontiguousarray(faces),
        "uv": uv,
        "tangent": np.ascontiguousarray(t),
        "normal": np.ascontiguousarray(n),
        "clearanceMm": np.ascontiguousarray(sdf),
        "innerVerts": np.ascontiguousarray(inner),
        "innerFaces": np.ascontiguousarray(inner_faces),
        "innerUv": np.ascontiguousarray(uv.copy()),
        "innerClearanceMm": np.ascontiguousarray(inner_sdf),
        "partX": np.float64(part_x),
        "yCrown": np.float64(y_crown),
        "budgetTris": np.int64(40000),
        "innerIncluded": np.bool_(True),
    }
    np.savez(str(E / "shell.npz"), **out)
    log_open(E / "shell.npz")
    mh = hashlib.sha256()
    for k in ("verts", "faces", "uv", "tangent"):
        mh.update(np.ascontiguousarray(out[k]).tobytes())
    rec = {
        "meshHashA": ha, "meshHashB": hb, "meshHashIdentical": ha == hb,
        "shellNpzHash": mh.hexdigest(),
        "verts": int(len(verts)), "tris": int(len(faces)),
        "facesRemoved": int(cut.sum()),
        "clearancePreMinMm": round(float(sdf0.min()), 3),
        "repairRounds": int(rounds),
        "clearanceMinMm": round(float(sdf.min()), 3),
        "clearanceP1Mm": round(float(np.percentile(sdf, 1)), 3),
        "clearanceP50Mm": round(float(np.percentile(sdf, 50)), 3),
        "hullBandsBelow": hull_bands,
        "hullBelow1405BySector": hull_sect,
        "minzRaw": minz_raw, "minzDec": minz_dec, "minzRepaired": minz_rep,
        "faceHoleTgtPx": int(hole_px),
        "faceHoleRenderPx": int(render_hole_px),
        "faceHoleErodedPx": int(eroded_px),
        "faceCutYcutM": YCUT,
        "faceCutProjHit": int(proj_hit.sum()),
        "faceCutRemoved": int(cut.sum()),
        "faceCutRemovedAbsXmaxM": removed_xmax,
        "faceCutRemovedZrangeM": removed_z,
        "innerOffsetMm": INNER_MM,
        "innerFaces": int(len(inner_faces)),
        "innerRepairRounds": int(inner_rounds),
        "innerMinMm": round(float(inner_sdf.min()), 3),
        "innerP1Mm": round(float(np.percentile(inner_sdf, 1)), 3),
        "partX": round(part_x, 4),
        "nCrownRoots": int(len(crown_roots)),
        "uvSpan": [round(zmax, 4), round(zmin, 4)],
    }
    (WS / "flow1.json").write_text(json.dumps(rec, indent=1) + "\n")
    print("FLOW1 %s" % json.dumps(rec), flush=True)


if __name__ == "__main__":
    main()
