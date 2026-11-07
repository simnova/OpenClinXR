#!/usr/bin/env python3
"""hair-crown3 probe: cap mesh facts for fade/front_roots/part design (Blender).

Dumps: cap name/nverts, boundary loops, forehead-loop world pos, slit world
pos, head skin material base color, roots-vs-cap gap stats.
Run: Blender --background --python probe_cap.py -- --strands STRANDS --out OUT.json
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import bpy
import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"
CAPNPZ = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"


def load_score():
    spec = importlib.util.spec_from_file_location("hc3_probe_score", SCORE)
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return m


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--strands", required=True)
    p.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def main():
    args = cli()
    S = load_score()
    state = S.R.ST.build_state()
    cap = state["cap"]
    mesh = cap.data
    mw = cap.matrix_world
    capnpz = np.load(CAPNPZ)
    nv = len(mesh.vertices)
    # boundary edges: edges with one linked face
    bnd = set()
    for e in mesh.edges:
        if len(e.link_faces) == 1 if hasattr(e, "link_faces") else False:
            pass
    # use polygons to find boundary
    from collections import Counter
    ec = Counter()
    for poly in mesh.polygons:
        vs = list(poly.vertices)
        for a, b in zip(vs, vs[1:] + vs[:1]):
            ec[(min(a, b), max(a, b))] += 1
    bnd_edges = [k for k, v in ec.items() if v == 1]
    bnd_verts = sorted({v for e in bnd_edges for v in e})
    # world coords of verts
    W = np.array([tuple(mw @ v.co) for v in mesh.vertices])
    fore_idx = np.asarray(capnpz["forehead"]).ravel().tolist()
    slit_idx = np.asarray(capnpz["slit"]).ravel().tolist()
    # cap-v8.npz verts should match live cap object verts 1:1?
    cv = np.asarray(capnpz["verts"], float)
    same_order = bool(cv.shape[0] == nv and np.allclose(cv[:5], W[:, :3][:5] if False else np.array([tuple(v.co) for v in mesh.vertices])[:5], atol=1e-9))
    # forehead loop world bbox
    F = W[np.array(fore_idx)]
    SL = W[np.array(slit_idx)]
    # UV layer?
    uv_names = [uv.name for uv in mesh.uv_layers]
    # skin material: head mesh material base color
    skin = {}
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj is not cap and "head" in obj.name.lower():
            for m in obj.data.materials:
                if m and m.use_nodes:
                    bsdf = m.node_tree.nodes.get("Principled BSDF")
                    if bsdf is not None:
                        try:
                            c = list(bsdf.inputs["Base Color"].default_value)[:3]
                        except KeyError:
                            c = None
                        skin[obj.name] = {"material": m.name, "baseColor": c}
    # all mesh object names containing head/body/cap
    names = [o.name for o in bpy.data.objects if o.type == "MESH"]
    # roots gap: strands roots vs forehead loop
    data = S.strand_data(Path(args.strands))
    pts = np.asarray(data["points"], float)
    roots = pts[:, 0, :]
    # roots space vs cap object space: compare bbox
    out = {
        "capName": cap.name,
        "nverts": nv,
        "nfaces": len(mesh.polygons),
        "nBndEdges": len(bnd_edges),
        "nBndVerts": len(bnd_verts),
        "capv8MatchLiveOrder": same_order,
        "capv8Nverts": int(cv.shape[0]),
        "foreheadIdx": fore_idx,
        "slitIdx": slit_idx,
        "foreheadWorldBBox": {"min": F.min(0).tolist(), "max": F.max(0).tolist(),
                              "mean": F.mean(0).tolist()},
        "slitWorldBBox": {"min": SL.min(0).tolist(), "max": SL.max(0).tolist(),
                          "mean": SL.mean(0).tolist()},
        "worldBBox": {"min": W.min(0).tolist(), "max": W.max(0).tolist()},
        "uvLayers": uv_names,
        "skinMats": skin,
        "meshNames": names,
        "rootsBBox": {"min": roots.min(0).tolist(), "max": roots.max(0).tolist(),
                      "mean": roots.mean(0).tolist()},
        "nStrands": int(len(roots)),
    }
    # gap: for front roots (y < apex region?) distance to forehead loop segment
    # coordinate check: roots y range vs forehead mean y
    Path(args.out).write_text(json.dumps(out, indent=1) + "\n")
    print("PROBE", json.dumps({k: out[k] for k in ("capName", "nverts", "nBndVerts", "capv8MatchLiveOrder", "uvLayers")}), flush=True)
    print("PROBE foreheadMean", out["foreheadWorldBBox"]["mean"], flush=True)
    print("PROBE slitMean", out["slitWorldBBox"]["mean"], flush=True)
    print("PROBE rootsMax", out["rootsBBox"]["max"], flush=True)
    print("PROBE skin", json.dumps(skin)[:600], flush=True)


if __name__ == "__main__":
    main()
