"""Identity gate measures (mise python, card tsk_2c547dda8753bba0).

M1 geometric (primary): the fitter's landmark embedding
(tools/openclinxr/evidence/face-fit/embedding.json barycentric triples)
evaluated on the SHIPPED bake's body mesh, projected with the fitter's front
camera (cameras.json front + correspond.json centre), RMS mm against the case
goal targets (any-subject-targets.json) after the fitter's own STABLE
similarity alignment. This is the fitter's own metric (fit_facefit2.py:358-376
front block) moved onto the mesh the station renders. If the bake topology
differs from hm08 (subdiv), hm08 verts map by nearest vertex and the max
mapping distance is reported.

M2 appearance-free render: 35-point Procrustes RMS (similarity-aligned
residual RMS / 1024, same scale as the D4 probe) between MediaPipe detections
on a FLAT-ALBEDO front render of the shipped bake and the goal detections.

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/evidence/face-fit/identity_gate.py \
    --case body2 --glb <shipped.glb> --flat-render <flat-front.png> \
    --out <out.json>
"""

import argparse
import hashlib
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
D = HERE
STORE = os.environ.get("OPENCLINXR_ASSET_STORE",
                       "/Volumes/files/openclinxr-assets/store/face-fit")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, HERE)

import fit_facefit2 as ff  # noqa: E402  (landed fitter: LANDMARKS/TRACK/STABLE/umeyama)


def sha_file(pth):
    h = hashlib.sha256()
    with open(pth, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_glb_body(glb_path):
    sys.path.insert(
        0,
        os.path.join(
            REPO,
            "tools/openclinxr/asset-pipeline/realism-head/lid-conform",
        ),
    )
    import lid_conform_core as core  # noqa: E402  (landed GLB accessor)

    js, blob = core.load_glb(glb_path)
    body = core.resolve_body_mesh_name(js)
    mi = next(i for i, m in enumerate(js.get("meshes", [])) if m.get("name") == body)
    prim = (js["meshes"][mi].get("primitives") or [{}])[0]
    pos_idx = (prim.get("attributes") or {}).get("POSITION")
    if pos_idx is None:
        raise SystemExit("identity gate refuse: body mesh %r has no POSITION" % body)
    pos = np.asarray(core.accessor(js, blob, pos_idx), dtype=np.float64)
    # Apply the body node's transform (identity on factory GLBs; applied if present).
    node = next(
        (n for n in js.get("nodes", []) if n.get("mesh") == mi),
        None,
    )
    if node is not None:
        if "matrix" in node:
            mat = np.asarray(node["matrix"], dtype=np.float64).reshape(4, 4).T
        else:
            t = np.asarray(node.get("translation", [0, 0, 0]), dtype=np.float64)
            q = np.asarray(node.get("rotation", [0, 0, 0, 1]), dtype=np.float64)
            s = np.asarray(node.get("scale", [1, 1, 1]), dtype=np.float64)
            x, y, z, w = q
            mat = np.eye(4)
            mat[:3, :3] = np.array([
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
            ]) * s
            mat[:3, 3] = t
        homo = np.concatenate([pos, np.ones((pos.shape[0], 1))], axis=1)
        pos = (homo @ mat.T)[:, :3]
    # Shipped GLBs are glTF Y-up; the fitter works in Blender Z-up
    # (export maps (x,y,z)->(x,z,-y)): convert back before mapping.
    pos = np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], axis=1)
    return body, pos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=True)
    ap.add_argument("--glb", required=True)
    ap.add_argument("--flat-render", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument(
        "--goal-case",
        default=None,
        help="goal detections case override for cross-subject M2 (default: --case)",
    )
    a = ap.parse_args()
    goal_case = a.goal_case or a.case

    emb = json.load(open(os.path.join(D, "embedding.json")))
    cams = json.load(open(os.path.join(D, "cameras.json")))
    corr = json.load(open(os.path.join(D, "correspond.json")))
    targets_doc = json.load(open(os.path.join(D, "any-subject-targets.json")))
    if a.case not in targets_doc["cases"]:
        raise SystemExit("identity gate refuse: unknown case %r" % a.case)
    if goal_case not in targets_doc["cases"]:
        raise SystemExit("identity gate refuse: unknown goal case %r" % goal_case)
    case_rec = targets_doc["cases"][goal_case]

    ortho = float(cams["front"]["ortho_scale"])
    res = int(cams["front"]["res"])
    cx, cz = float(corr["cx"]), float(corr["cz"])
    mmpp = float(corr["mmPerPix"])

    pts_base = np.load(os.path.join(D, "pts_base_front.npy"))
    tgt_rel = case_rec["targetNpy"].split("tools/openclinxr/evidence/face-fit/")[-1]
    tgt_path = os.path.join(D, tgt_rel)
    if sha_file(tgt_path) != case_rec["targetSha256"]:
        raise SystemExit("identity gate refuse: target npy sha drift for %r" % a.case)
    pts_tgt = np.load(tgt_path)

    # Fitter's own goal alignment (fit_facefit2.py:273-277).
    sidx = [ff.TRACK.index(i) for i in ff.STABLE]
    s, rm, t = ff.umeyama_similarity(
        np.array([pts_tgt[i] for i in ff.STABLE]),
        np.array([pts_base[i] for i in ff.STABLE]),
    )
    tgt_al = s * (pts_tgt @ rm.T) + t

    # Shipped body mesh + nearest-vertex map from hm08.
    body_name, shipped = load_glb_body(a.glb)
    base_path = os.path.join(STORE, "base_verts.npy")
    if not os.path.isfile(base_path):
        raise SystemExit("identity gate refuse: missing %s" % base_path)
    base = np.load(base_path)
    from scipy.spatial import cKDTree

    tree = cKDTree(shipped)
    dists, mapped = tree.query(base, k=1)
    map_max_mm = float(dists.max() * 1000.0)
    map_mean_mm = float(dists.mean() * 1000.0)

    proj = {}
    for lm in ff.LANDMARKS:
        e = emb["points"][str(lm)]
        vv, ww = e["verts"], e["w"]
        p3 = shipped[mapped[vv[0]]] * ww[0] + shipped[mapped[vv[1]]] * ww[1] + shipped[mapped[vv[2]]] * ww[2]
        proj[lm] = ((0.5 + (p3[0] - cx) / ortho) * res, (0.5 + (cz - p3[2]) / ortho) * res)

    resid = []
    ship_px = np.array([proj[lm] for lm in ff.LANDMARKS])
    ps0, prm0, pt0 = ff.umeyama_similarity(
        np.array([ship_px[ff.LANDMARKS.index(i)] for i in ff.STABLE]),
        np.array([pts_base[i] for i in ff.STABLE]),
    )
    ship_al = ps0 * (ship_px @ prm0.T) + pt0
    for lm in ff.TRACK:
        r = ff.LANDMARKS.index(lm)
        resid.append((tgt_al[lm, 0] - ship_al[r, 0]) * mmpp)
        resid.append((tgt_al[lm, 1] - ship_al[r, 1]) * mmpp)
    d = np.array(resid)
    m1 = float(np.sqrt((d ** 2).mean()))

    # M2: Procrustes RMS on the flat render vs goal detections.
    pts_flat = ff.detect_points(a.flat_render)
    if pts_flat is None or pts_flat.shape != (478, 2):
        raise SystemExit("identity gate refuse: no 478-point face in %s" % a.flat_render)
    goal_track = np.array([pts_tgt[i] for i in ff.TRACK])
    flat_track = np.array([pts_flat[i] for i in ff.TRACK])
    ps, prm, pt = ff.umeyama_similarity(flat_track, goal_track)
    aligned = ps * (flat_track @ prm.T) + pt
    m2 = float(np.sqrt(((aligned - goal_track) ** 2).mean())) / 1024.0

    out = {
        "case": a.case,
        "goalCase": goal_case,
        "glb": {"path": a.glb, "sha256": sha_file(a.glb)},
        "flatRender": {"path": a.flat_render, "sha256": sha_file(a.flat_render)},
        "m1Mm": round(m1, 4),
        "m1MappingMaxMm": round(map_max_mm, 4),
        "m1MappingMeanMm": round(map_mean_mm, 4),
        "m1BodyMesh": body_name,
        "m1BodyVerts": int(shipped.shape[0]),
        "m1Hm08Verts": int(base.shape[0]),
        "m2": round(m2, 5),
        "method": {
            "m1": "fitter embedding triples on shipped body mesh (nearest-vertex map if subdiv), "
                  "fitter front camera; shipped projections AND goal both STABLE-aligned to the base frame "
                  "(same as score_render_facefit2.py:80-85); RMS mm over 35 TRACK",
            "m2": "similarity-aligned residual RMS / 1024 over 35 TRACK: flat render vs goal detections",
            "sources": {
                "embedding": "tools/openclinxr/evidence/face-fit/embedding.json",
                "camera": "tools/openclinxr/evidence/face-fit/cameras.json:front",
                "centre": "tools/openclinxr/evidence/face-fit/correspond.json:cx,cz,mmPerPix",
                "targets": "tools/openclinxr/evidence/face-fit/any-subject-targets.json:%s" % goal_case,
            },
        },
    }
    with open(a.out, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("IDENTITY_GATE case=%s goal=%s m1=%.4fmm mapmax=%.4fmm m2=%.5f" % (a.case, goal_case, m1, map_max_mm, m2))


main()
