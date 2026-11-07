"""S8 STEP 1c+2 (numpy): clearance, inner layer, flow field, flow UVs.

Reads: WS/shell_dec_{a,b}.obj (Blender decimate, twice), cage1 exact SDF
(body-exact-sdf.npz via cage/exact.py), scalp1 roots.npz + hairline.json
(part derivation), hairline axis. Writes: E/shell.npz (outer + optional
inner layer, flow UVs, tangents, meta) + WS/flow.json (clearance, part,
hashes, determinism).

Winding: marching cubes on the hull grid yields inward winding (negative
divergence volume); faces are flipped once here so normals point
outward (verified by positive volume + positive dot with radial-out).

Clearance: exact-SDF trilinear query at outer verts (world mm). Repair
rule (stated): verts with sdf < 1.5 mm are pushed out along the vertex
normal by (1.5 - sdf), normals recomputed once, re-queried (max 3
rounds). Gate: final min >= 1.0 mm.

Inner layer (optional): outer verts shifted -3 mm along the outward
normal, flipped winding. Included only if its own min clearance stays
>= 1.0 mm; otherwise excluded with the reason recorded.

Flow field (stated method, no hairstyle parameters beyond the part):
part_x = median x of scalp1 roots with z > 1.60 m (crown roots; the
part line is derived from the roots, not assumed). Crown axis
(x=part_x, y=y_crown from hairline.json). Per-vertex strand direction
d = w*rhat + (1-w)*down, w = smoothstep(1560,1620,z_mm)... note z in
metres here: w = smoothstep(1.56, 1.62, z): radial-from-part on the
crown, gravity (-z) below the occiput/temple line. Tangent
t = d - n*(d.n), normalised (degenerate fallback: first perpendicular
of n). UVs aligned to the flow: u across = azimuth around the crown
axis, az = atan2(dx, -dy) (0 = front, seam +-pi at the back midline;
u = ((az+pi) mod 2pi)/2pi, so the 0/1 cut sits at the back midline,
below the crown and at the pole), v along = normalised root->tip run
((zmax-z) + 0.5*max(0, rh-0.02)) / span, v=0 at the crown top.

Determinism: fixed-order numpy only (no RNG). The two-run mesh-hash
gate compares the parsed verts/faces of decimate runs A and B.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

S8 = Path(__file__).resolve().parent
sys.path.insert(0, str(S8))
sys.path.insert(0, str(S8.parent / "cage"))
from common import log_open, smoothstep  # noqa: E402
import exact as EXACT  # noqa: E402

ROOT = S8.parents[3]
E = ROOT / "tools/openclinxr/evidence/hair-shell0"
WS = E / "workspace"
S1 = ROOT / "tools/openclinxr/evidence/hair-scalp1"
CAGE1 = ROOT / "tools/openclinxr/evidence/hair-cage1"

INNER_MM = 3.0
REPAIR_TARGET_MM = 2.0  # 1.0 mm margin over the 1.0 mm gate
GATE_MM = 1.0


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


def mesh_volume(verts, faces) -> float:
    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]
    return float(np.sum(np.einsum("ij,ij->i", v0, np.cross(v1, v2))) / 6.0)


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
    """Outward unit gradient of the exact SDF (central differences)."""
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


def main():
    E.mkdir(parents=True, exist_ok=True)
    WS.mkdir(parents=True, exist_ok=True)
    log_open(Path(__file__))
    va, fa = load_obj(WS / "shell_dec_a.obj")
    vb, fb = load_obj(WS / "shell_dec_b.obj")
    log_open(WS / "shell_dec_a.obj")
    log_open(WS / "shell_dec_b.obj")
    ha = hashlib.sha256(
        np.ascontiguousarray(va).tobytes()
        + np.ascontiguousarray(fa).tobytes()).hexdigest()
    hb = hashlib.sha256(
        np.ascontiguousarray(vb).tobytes()
        + np.ascontiguousarray(fb).tobytes()).hexdigest()
    print("MESH_HASH runA=%s runB=%s identical=%s" % (
        ha[:16], hb[:16], ha == hb), flush=True)
    assert ha == hb, "decimate nondeterminism"
    verts, faces = va, fa

    vol = mesh_volume(verts, faces)
    grid = EXACT.load_exact(str(CAGE1 / "body-exact-sdf.npz"))
    log_open(CAGE1 / "body-exact-sdf.npz")
    print("DEC_VOLUME_RAW %.6f m^3 (open surface: ~0, winding undecided)" % vol,
          flush=True)
    # The hull occupancy is a volumetric rind (carve + shell around the
    # head, curtains to the shoulders: centroid SDF p50 4.6 / p90 33.9 mm),
    # so marching cubes yields the FULL boundary: head-facing wall, outer
    # wall, and rim. All of it is kept as the shell (rendered double-sided).
    # Per-face orientation (stated): each face normal is flipped to ascend
    # the exact SDF (away from the body), decided at the face centroid via
    # the SDF gradient. A global volume-sign flip is meaningless here (open
    # surface, volume ~0) and was tried and rejected (align -0.08 either way
    # because the two walls cancel).
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
    n = vertex_normals(verts, faces)
    align = float((n * sdf_gradient(grid, verts * 1000.0)).sum(
        axis=1).mean())
    print("WINDING per-face SDF-ascent; mean vert align=%+.4f" % align,
          flush=True)
    sdf0 = EXACT.query_exact(grid, verts * 1000.0)
    print("CLEARANCE pre-repair min=%.3f p1=%.3f p50=%.3f mm n=%d" % (
        sdf0.min(), np.percentile(sdf0, 1), np.percentile(sdf0, 50),
        len(verts)), flush=True)
    rounds = 0
    sdf = sdf0
    # Repair along the SDF gradient (outward by definition), NOT the mesh
    # normal: in hug-tight concave spots the mesh normal can point into
    # the body and normal-push repair drives verts deeper (observed:
    # min -0.077 -> -2.129 mm on the first attempt).
    while float(sdf.min()) < REPAIR_TARGET_MM and rounds < 5:
        low = sdf < REPAIR_TARGET_MM
        g = sdf_gradient(grid, verts[low] * 1000.0)
        verts[low] = verts[low] + (
            g * ((REPAIR_TARGET_MM - sdf[low]) / 1000.0)[:, None])
        sdf = EXACT.query_exact(grid, verts * 1000.0)
        rounds += 1
    n = vertex_normals(verts, faces)
    sdf = EXACT.query_exact(grid, verts * 1000.0)
    print("CLEARANCE post-repair rounds=%d min=%.3f p1=%.3f p50=%.3f mm" % (
        rounds, sdf.min(), np.percentile(sdf, 1),
        np.percentile(sdf, 50)), flush=True)

    # inner layer at -3 mm along outward normals, flipped winding
    inner = verts - n * (INNER_MM / 1000.0)
    inner_faces = faces[:, ::-1].copy()
    inner_sdf = EXACT.query_exact(grid, inner * 1000.0)
    print("INNER min=%.3f p1=%.3f mm" % (
        inner_sdf.min(), np.percentile(inner_sdf, 1)), flush=True)
    inner_ok = bool(inner_sdf.min() >= GATE_MM)

    # part from the roots (crown roots z > 1.60 m), not assumed
    roots = np.load(str(S1 / "roots.npz"))
    log_open(S1 / "roots.npz")
    rxyz = np.array(roots["xyz"], dtype=np.float64)
    crown_roots = rxyz[rxyz[:, 2] > 1.60]
    part_x = float(np.median(crown_roots[:, 0]))
    hl = json.loads((S1 / "hairline.json").read_text())
    log_open(S1 / "hairline.json")
    y_crown = float(hl["axis"]["y"])
    print("PART x=%.4f m from %d crown roots (z>1.60); y_crown=%.4f" % (
        part_x, len(crown_roots), y_crown), flush=True)

    dx = verts[:, 0] - part_x
    dy = verts[:, 1] - y_crown
    rh = np.hypot(dx, dy)
    rhat = np.stack([dx / np.maximum(rh, 1e-9),
                     dy / np.maximum(rh, 1e-9),
                     np.zeros_like(rh)], axis=1)
    rhat[rh < 1e-6] = (0.0, -1.0, 0.0)
    w = smoothstep(1.56, 1.62, verts[:, 2])[:, None]
    down = np.array([0.0, 0.0, -1.0])
    d = w * rhat + (1.0 - w) * down
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

    az = np.arctan2(dx, -dy)  # 0 = front, +-pi = back midline
    u = ((az + np.pi) % (2 * np.pi)) / (2 * np.pi)
    zmax, zmin = float(verts[:, 2].max()), float(verts[:, 2].min())
    rhmax = float(rh.max())
    v = (((zmax - verts[:, 2]) + 0.5 * np.maximum(0.0, rh - 0.02))
         / ((zmax - zmin) + 0.5 * max(0.0, rhmax - 0.02)))
    uv = np.ascontiguousarray(np.stack([u, np.clip(v, 0, 1)], axis=1))
    iv = np.ascontiguousarray(uv.copy())

    out = {
        "verts": np.ascontiguousarray(verts),
        "faces": np.ascontiguousarray(faces),
        "uv": uv,
        "tangent": np.ascontiguousarray(t),
        "normal": np.ascontiguousarray(n),
        "clearanceMm": np.ascontiguousarray(sdf),
        "partX": np.float64(part_x),
        "yCrown": np.float64(y_crown),
        "budgetTris": np.int64(40000),
        "innerIncluded": np.bool_(inner_ok),
    }
    if inner_ok:
        out["innerVerts"] = np.ascontiguousarray(inner)
        out["innerFaces"] = np.ascontiguousarray(inner_faces)
        out["innerUv"] = iv
        out["innerClearanceMm"] = np.ascontiguousarray(inner_sdf)
    np.savez(str(E / "shell.npz"), **out)
    log_open(E / "shell.npz")
    mh = hashlib.sha256()
    for k in ("verts", "faces", "uv", "tangent"):
        mh.update(np.ascontiguousarray(out[k]).tobytes())
    rec = {
        "meshHashA": ha, "meshHashB": hb, "meshHashIdentical": ha == hb,
        "shellNpzHash": mh.hexdigest(),
        "verts": int(len(verts)), "tris": int(len(faces)),
        "volumeM3": round(vol, 6),
        "clearancePreMinMm": round(float(sdf0.min()), 3),
        "clearancePreP1Mm": round(float(np.percentile(sdf0, 1)), 3),
        "clearancePreP50Mm": round(float(np.percentile(sdf0, 50)), 3),
        "repairRounds": int(rounds),
        "clearanceMinMm": round(float(sdf.min()), 3),
        "clearanceP1Mm": round(float(np.percentile(sdf, 1)), 3),
        "clearanceP50Mm": round(float(np.percentile(sdf, 50)), 3),
        "innerMinMm": round(float(inner_sdf.min()), 3),
        "innerIncluded": bool(inner_ok),
        "partX": round(part_x, 4),
        "nCrownRoots": int(len(crown_roots)),
        "uvSpan": [round(zmax, 4), round(zmin, 4)],
    }
    (WS / "flow.json").write_text(json.dumps(rec, indent=1) + "\n")
    print("FLOW %s" % json.dumps(rec), flush=True)


if __name__ == "__main__":
    main()
