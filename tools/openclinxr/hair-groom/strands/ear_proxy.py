"""hair-groom34: symmetric ear proxy stage (NEW; default-off-safe standalone CLI).

One ear proxy per side: the +x pinna vertex set (hair-hull4 ear_pinna.npz
idx_earXpos) as faces of the body mesh (aisha-meshes.npz body_v/body_f:
faces with all 3 verts in the set), mirrored across x=0 for -x (the
idx_earXneg definition is NOT used: it names a different, smaller,
offset ear). Each patch is inflated to a smooth shell INFLATE_MM
(default 3.0) outside the skin along smoothed outward vertex normals;
the gate solid per side = outer patch + inner (skin) patch + rim skirt
as one triangle soup with provenance.

Writes --out (npz, store/): per side patch verts/faces (reindexed),
shell verts/faces, boundary loop lengths, stats. --stats-out (json, E/):
human-readable provenance + coverage numbers. --fig-out (png, E/):
orthographic +/-x coverage figure (neighbourhood verts, patch fill,
pinna dots, boundary loop).

Existing behaviour untouched: this file adds a new CLI only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[4]
MESHES = Path("/Volumes/files/openclinxr-assets/store/hair-groom31"
              "/aisha-meshes.npz")
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull4/workspace/ear_pinna.npz"


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def patch_from_idx(faces: np.ndarray, idx: np.ndarray):
    sel = np.isin(faces, idx)
    whole = faces[sel.sum(1) == 3]
    # reindex to patch-local verts
    uverts = np.unique(whole)
    remap = np.full(int(faces.max()) + 1, -1, dtype=np.int64)
    remap[uverts] = np.arange(len(uverts))
    return uverts, remap[whole]


def boundary_loops(pfaces: np.ndarray):
    from collections import defaultdict
    ecnt: dict = defaultdict(int)
    for a, b, c in pfaces.tolist():
        for e in (tuple(sorted((a, b))), tuple(sorted((b, c))),
                  tuple(sorted((c, a)))):
            ecnt[e] += 1
    bedges = [e for e, n in ecnt.items() if n == 1]
    adj: dict = defaultdict(list)
    for a, b in bedges:
        adj[a].append(b)
        adj[b].append(a)
    loops = []
    used = set()
    for s, _ in bedges:
        if (s, s) in used:
            continue
        loop = [s]
        prev, cur = -1, s
        while True:
            nxt = [w for w in adj[cur] if w != prev
                   and (min(cur, w), max(cur, w)) not in used]
            if not nxt:
                break
            nx = nxt[0]
            used.add((min(cur, nx), max(cur, nx)))
            if nx == s:
                break
            prev, cur = cur, nx
            loop.append(cur)
            if len(loop) > len(bedges) + 2:
                break
        if len(loop) > 2:
            loops.append(loop)
    return bedges, loops


def vertex_normals(verts: np.ndarray, faces: np.ndarray):
    v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    fn = np.cross(v1 - v0, v2 - v0)
    area = np.linalg.norm(fn, axis=1, keepdims=True)
    fn = fn / np.maximum(area, 1e-12)
    n = np.zeros_like(verts)
    w = np.maximum(area[:, 0], 1e-12)
    for k in range(3):
        np.add.at(n, faces[:, k], fn * w[:, None])
    L = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.maximum(L, 1e-12)


def smooth_field(verts: np.ndarray, faces: np.ndarray, field: np.ndarray,
                 iters: int):
    adj = [set() for _ in range(len(verts))]
    for a, b, c in faces.tolist():
        adj[a] |= {b, c}
        adj[b] |= {a, c}
        adj[c] |= {a, b}
    f = field.copy()
    for _ in range(iters):
        g = f.copy()
        for i, nb in enumerate(adj):
            if nb:
                g[i] = 0.5 * f[i] + 0.5 * np.mean(f[list(nb)], axis=0)
        f = g
    L = np.linalg.norm(f, axis=1, keepdims=True)
    return f / np.maximum(L, 1e-12)


def build_side(verts: np.ndarray, faces: np.ndarray, inflate: float,
               smooth_iters: int):
    n = vertex_normals(verts, faces)
    # outward = away from head centre line at ear height
    c = np.array([0.0, verts[:, 1].mean(), verts[:, 2].mean()])
    sgn = np.sign(np.einsum("ij,ij->i", n, verts - c))
    sgn[sgn == 0] = 1.0
    n = n * sgn[:, None]
    ns = smooth_field(verts, faces, n, smooth_iters)
    outer = verts + inflate * ns
    bedges, loops = boundary_loops(faces)
    # shell = outer patch + inner patch (reversed) + skirt quads
    nv = len(verts)
    shell_v = np.vstack([outer, verts]).astype(np.float64)
    outer_f = faces
    inner_f = faces[:, ::-1] + nv
    edge_index = {tuple(sorted(e)): k for k, e in enumerate(bedges)}
    skirt = []
    for li, loop in enumerate(loops):
        L = len(loop)
        for i in range(L):
            a, b = loop[i], loop[(i + 1) % L]
            e = tuple(sorted((a, b)))
            if e not in edge_index:
                continue
            # orientation: outer a->b, inner b->a
            skirt.append([a, b, b + nv])
            skirt.append([a, b + nv, a + nv])
    shell_f = np.vstack([outer_f, inner_f,
                         np.asarray(skirt, dtype=np.int64)]).astype(np.int64)
    return {"verts": verts, "faces": faces, "normals": ns,
            "outer": outer, "shell_v": shell_v, "shell_f": shell_f,
            "bedges": bedges, "loops": loops}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--stats-out", default="")
    ap.add_argument("--fig-out", default="")
    ap.add_argument("--inflate-mm", type=float, default=3.0)
    ap.add_argument("--smooth-iters", type=int, default=3)
    ap.add_argument("--mesh", default=str(MESHES))
    ap.add_argument("--pinna", default=str(PINNA))
    ap.add_argument("--fill-bowl", action="store_true", default=False,
                    help="groom34: the file xpos selection excludes the "
                    "recessed concha/fossa bowl (85 skin verts inside the "
                    "selection bbox are not selected). With this flag, "
                    "neighbourhood skin verts inside the outer boundary "
                    "loop (y-z polygon) join the patch so the proxy covers "
                    "helix + concha + lobe. Default off.")
    args = ap.parse_args()

    m = np.load(args.mesh, allow_pickle=True)
    bv = np.asarray(m["body_v"], dtype=np.float64)
    bf = np.asarray(m["body_f"], dtype=np.int64)
    p = np.load(args.pinna, allow_pickle=True)
    idx_pos = np.asarray(p["idx_earXpos"])
    idx_neg_file = np.asarray(p["idx_earXneg"])

    uverts, pfaces = patch_from_idx(bf, idx_pos)
    fill_info = {"on": bool(args.fill_bowl), "nAdded": 0}
    if args.fill_bowl:
        # outer boundary loop of the raw patch, as a (y,z) polygon
        _, loops0 = boundary_loops(
            pfaces if len(pfaces) else np.zeros((0, 3), dtype=np.int64))
        # map patch-local loop ids back to global verts for polygon
        bv_all = bv  # global
        # rebuild with global ids: patch_from_idx returned local faces;
        # recover global faces first
        glo_faces = uverts[pfaces]
        _, loops0g = boundary_loops(glo_faces)
        outer = max(loops0g, key=len)
        poly = bv_all[np.array(outer)][:, 1:3]
        from matplotlib.path import Path as _Path
        side_nb = np.nonzero(
            (bv_all[:, 0] > 0.04) & (bv_all[:, 0] < 0.10)
            & (bv_all[:, 1] > -0.14) & (bv_all[:, 1] < -0.03)
            & (bv_all[:, 2] > 1.48) & (bv_all[:, 2] < 1.57))[0]
        inside = _Path(poly).contains_points(bv_all[side_nb][:, 1:3])
        add = np.array([i for i in side_nb[inside]
                        if i not in set(idx_pos.tolist())])
        idx_pos = np.concatenate([idx_pos, add])
        fill_info["nAdded"] = int(len(add))
        fill_info["addedXmeanMm"] = round(
            float(np.abs(bv_all[add][:, 0]).mean() * 1000.0), 3) \
            if len(add) else 0.0
        uverts, pfaces = patch_from_idx(bf, idx_pos)
    stats_fill = fill_info
    pverts = bv[uverts]
    infl = float(args.inflate_mm) / 1000.0
    sm = int(args.smooth_iters)

    sides = {}
    stats = {"mesh": str(args.mesh), "meshSha256": sha256(args.mesh),
             "pinna": str(args.pinna), "pinnaSha256": sha256(args.pinna),
             "idx_earXposN": int(len(idx_pos)),
             "idx_earXnegN_file": int(len(idx_neg_file)),
             "idx_earXnegUsed": False,
             "inflateMm": float(args.inflate_mm),
             "smoothIters": sm,
             "note": "-x proxy is the +x patch mirrored across x=0; "
                     "idx_earXneg ignored (smaller, offset ear).",
             "fillBowl": stats_fill}
    out = {}
    # +x
    b = build_side(pverts, pfaces, infl, sm)
    sides["xpos"] = b
    # -x: mirror across x=0 (positions; faces keep orientation, normals
    # recomputed inside build_side from mirrored geometry)
    mv = pverts.copy()
    mv[:, 0] *= -1.0
    bneg = build_side(mv, pfaces.copy(), infl, sm)
    sides["xneg"] = bneg

    for nm, b in sides.items():
        nl = [len(L) for L in b["loops"]]
        stats[nm] = {
            "patchVerts": int(len(b["verts"])),
            "patchFaces": int(len(b["faces"])),
            "boundaryEdges": int(len(b["bedges"])),
            "loops": len(b["loops"]), "loopLens": nl,
            "shellVerts": int(len(b["shell_v"])),
            "shellTris": int(len(b["shell_f"])),
            "xRange": [round(float(b["verts"][:, 0].min()), 6),
                       round(float(b["verts"][:, 0].max()), 6)],
            "yRange": [round(float(b["verts"][:, 1].min()), 6),
                       round(float(b["verts"][:, 1].max()), 6)],
            "zRange": [round(float(b["verts"][:, 2].min()), 6),
                       round(float(b["verts"][:, 2].max()), 6)],
            "outerClearMm": round(float(
                np.linalg.norm(b["outer"] - b["verts"], axis=1).mean()
                * 1000.0), 4)}
        out[nm + "_verts"] = b["verts"].astype(np.float32)
        out[nm + "_faces"] = b["faces"].astype(np.int64)
        out[nm + "_shell_v"] = b["shell_v"].astype(np.float32)
        out[nm + "_shell_f"] = b["shell_f"].astype(np.int64)
    # mirror check: -x shell mirrored back onto +x shell
    mx = sides["xneg"]["shell_v"].copy()
    mx[:, 0] *= -1.0
    stats["mirrorMaxDiffMm"] = round(float(
        np.abs(mx - sides["xpos"]["shell_v"]).max() * 1000.0), 6)

    # coverage: neighbourhood verts vs patch (per side, mirrored check)
    nb = ((np.abs(bv[:, 0]) > 0.04) & (np.abs(bv[:, 0]) < 0.10)
          & (bv[:, 1] > -0.14) & (bv[:, 1] < -0.03)
          & (bv[:, 2] > 1.48) & (bv[:, 2] < 1.57))
    nb_idx = np.nonzero(nb)[0]
    inset = set(uverts.tolist())
    stats["coverage"] = {
        "neighbourhoodN": int(nb.sum()),
        "neighbourhoodInPatchFrac":
            round(float(np.isin(nb_idx, uverts).mean()), 4),
        "patchDef": "faces-all-3-verts-in-idx_earXpos"}
    # anatomical extent: helix top / concha / lobe bottom reach, from
    # the +x pinna verts vs the patch bbox
    pv = bv[idx_pos]
    stats["xposPinnaExtent"] = {
        "z": [round(float(pv[:, 2].min()), 4),
              round(float(pv[:, 2].max()), 4)],
        "y": [round(float(pv[:, 1].min()), 4),
              round(float(pv[:, 1].max()), 4)]}
    stats["coverage"]["patchIsWholeXposSelection"] = True

    np.savez_compressed(args.out, **out)
    if args.stats_out:
        Path(args.stats_out).write_text(json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats, indent=1))
    if args.fig_out:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(1, 2, figsize=(12, 6))
        for ai, (nm, sgn) in enumerate((("xpos", 1.0), ("xneg", -1.0))):
            a = ax[ai]
            sel = nb & (np.sign(bv[:, 0]) == sgn)
            pts = bv[sel]
            a.scatter(pts[:, 1] * 1000, pts[:, 2] * 1000, s=1, c="grey",
                      label="neighbourhood skin")
            b = sides[nm]
            fv = b["verts"][b["faces"]]
            # project patch faces (y-z plane)
            import matplotlib.collections as mc
            polys = [[(y * 1000, z * 1000) for y, z in f[:, 1:3]]
                     for f in fv]
            a.add_collection(mc.PolyCollection(
                polys, facecolor="orange", alpha=0.5, edgecolor="none"))
            for L in b["loops"]:
                Lp = b["verts"][L]
                a.plot(list(Lp[:, 1] * 1000) + [Lp[0, 1] * 1000],
                       list(Lp[:, 2] * 1000) + [Lp[0, 2] * 1000],
                       "r-", lw=1)
            src = idx_pos if nm == "xpos" else idx_neg_file
            a.scatter(bv[src][:, 1] * 1000, bv[src][:, 2] * 1000, s=3,
                      c="blue", label="file pinna idx")
            a.set_title("%s (y-z mm), inflate %s mm" % (nm, args.inflate_mm))
            a.set_aspect("equal")
            a.legend(markerscale=3, fontsize=8)
        fig.tight_layout()
        fig.savefig(args.fig_out, dpi=100)
        print("wrote", args.fig_out)


if __name__ == "__main__":
    main()
