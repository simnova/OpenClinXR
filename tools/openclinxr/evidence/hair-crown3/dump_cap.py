#!/usr/bin/env python3
"""hair-crown3: dump live cap mesh + material colors (Blender)."""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"


def load_score():
    spec = importlib.util.spec_from_file_location("hc3_dump_score", SCORE)
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return m


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def main():
    import bpy
    args = cli()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    S = load_score()
    state = S.R.ST.build_state()
    cap = state["cap"]
    mesh = cap.data
    V = np.array([tuple(v.co) for v in mesh.vertices])
    F = np.array([tuple(p.vertices) for p in mesh.polygons])
    mw = np.array(cap.matrix_world)
    np.savez_compressed(out / "cap_live.npz", verts=V.astype(np.float64),
                        faces=np.asarray(F, dtype=np.int64), matrix_world=mw)
    mats = {}
    for m in bpy.data.materials:
        try:
            if m.use_nodes:
                bsdf = m.node_tree.nodes.get("Principled BSDF")
                c = list(bsdf.inputs["Base Color"].default_value)[:3] if bsdf is not None else None
            else:
                c = None
        except Exception:
            c = None
        users = [o.name for o in bpy.data.objects if o.type == "MESH" and m.name in [mm.name if mm else "" for mm in o.data.materials]]
        mats[m.name] = {"baseColor": c, "users": users}
    (out / "materials.json").write_text(json.dumps(mats, indent=1) + "\n")
    print("DUMP verts", V.shape, "faces", F.shape, "mats", len(mats), flush=True)


if __name__ == "__main__":
    main()
