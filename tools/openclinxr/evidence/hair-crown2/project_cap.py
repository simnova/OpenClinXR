#!/usr/bin/env python3
"""hair-crown2 STEP 1: project cap mesh + forehead (hairline) loop to pixels.

Mechanism for the new ruler's "above OUR hairline": the cap (hair-cap8,
built from the head-mesh UV region that hair covers) ends at the forehead
loop (cap-v8 'forehead' idx); its projection IS our hairline in pixels.
Face/forehead skin below that line is excluded by construction.

Run inside Blender:
  Blender --background --python project_cap.py -- \
    --strands STRANDS.npz --params PARAMS.json --out OUTDIR
Writes OUTDIR/cap_projection.npz (per-view cap pixel coords + forehead loop
pixels + camera records).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"
CAPNPZ = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
SIZE = 1024


def load_score():
    spec = importlib.util.spec_from_file_location("hair_crown2_score_v3", SCORE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--strands", required=True)
    parser.add_argument("--params", required=True)
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def main():
    args = cli()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    S = load_score()
    params, _, rig = S.read_params(Path(args.params))
    landmarks = json.loads(S.LANDMARKS.read_text())
    state = S.R.ST.build_state()
    cap = state["cap"]
    capnpz = np.load(CAPNPZ)
    cap_verts_obj = np.asarray(capnpz["verts"], float)
    fore_idx = np.asarray(capnpz["forehead"]).ravel()
    # Object-space -> world via the live cap object matrix (not assumed identity).
    mw = cap.matrix_world
    world = np.array([mw @ Vector(tuple(v)) for v in cap_verts_obj])
    payload = {
        "cap_object": cap.name,
        "cap_matrix_world": [list(r) for r in mw],
        "forehead_idx_count": int(len(fore_idx)),
        "size": SIZE,
    }
    scene = bpy.context.scene
    for view in ("front", "back"):
        S.canonical_camera(state, view, landmarks)
        S.C.place_camera_relative(state, params, view)
        bpy.context.view_layer.update()
        cam = state["handle"].camera
        rec = dict(location=[float(v) for v in cam.location],
                   lensMm=float(cam.data.lens))
        n = len(world)
        px = np.empty((n, 2), float)
        depth = np.empty(n, float)
        for i in range(n):
            ndc = world_to_camera_view(scene, cam, Vector(tuple(world[i])))
            px[i, 0] = float(ndc.x) * SIZE
            px[i, 1] = (1.0 - float(ndc.y)) * SIZE
            depth[i] = float(ndc.z)
        payload[f"{view}_cap_px"] = px.astype(np.float32)
        payload[f"{view}_cap_depth"] = depth.astype(np.float32)
        payload[f"{view}_forehead_px"] = px[fore_idx].astype(np.float32)
        payload[f"{view}_camera"] = rec
        inside = ((px[:, 0] >= 0) & (px[:, 0] < SIZE) & (px[:, 1] >= 0) & (px[:, 1] < SIZE)).mean()
        print(f"CAP_PROJECT {view} frac_in_frame={inside:.3f}", flush=True)
    arrs = {k: np.asarray(v, dtype=np.float32)
            for k, v in payload.items() if isinstance(v, np.ndarray)}
    arrs["meta"] = np.asarray(json.dumps(
        {k: v for k, v in payload.items() if not isinstance(v, np.ndarray)}))
    np.savez_compressed(out / "cap_projection.npz", **arrs)
    # Save JSON sidecar summary (arrays stay in the .npz).
    side = {k: (f"array{np.asarray(v).shape}" if isinstance(v, np.ndarray) else v)
            for k, v in payload.items()}
    (out / "cap_projection.json").write_text(json.dumps(side, indent=1) + "\n")
    print("CAP_PROJECT_DONE", out, flush=True)


if __name__ == "__main__":
    main()
