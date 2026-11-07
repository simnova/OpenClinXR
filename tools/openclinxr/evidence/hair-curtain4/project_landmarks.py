"""Project anatomical landmarks through the exact children render cameras.

Runs in Blender.  The scene and cameras are loaded through the same
children_station/children3 path used by children.py.  Output is the sole
landmark source for every hair-curtain-3 judge call.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = Path(__file__).resolve().parent
CAP = HERE.parent / "hair-cap8" / "cap-v8.npz"
SIZE = 1024
VIEWS = ("front", "profile_90", "back")


def load_station():
    import importlib.util
    path = HERE / "children_station.py"
    spec = importlib.util.spec_from_file_location("hair_curtain3_station", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def project(scene, camera, point):
    q = world_to_camera_view(scene, camera, Vector(tuple(float(v) for v in point)))
    return {"col": float(q.x * SIZE), "row": float((1.0 - q.y) * SIZE)}


def world_vertices(obj):
    mw = obj.matrix_world
    return np.asarray([tuple(mw @ v.co) for v in obj.data.vertices], dtype=float)


def closest_front_midline(points, z):
    ids = np.where(np.abs(points[:, 0]) <= 0.005)[0]
    dz = np.abs(points[ids, 2] - z)
    near = ids[dz <= max(float(dz.min()) + 0.001, 0.0015)]
    # Anterior is -y in this scene.
    return int(near[np.argmin(points[near, 1])])


def shoulder_landmark(handle):
    """Return a reproducible back-registration shoulder point.

    The judge's back triple is crown/shoulder/centre, not crown/menton/centre.
    Use the body/garment silhouette's midline point at the anatomical shoulder
    plane z=1.405 m.  X=0 makes the row invariant to side choice.
    """
    return np.asarray((0.0, 0.0, 1.405), dtype=float)


def main():
    station = load_station()
    c3 = station.import_children3()
    hs = c3.load_hair_scene()
    handle = hs.build_scene()
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    cap = np.load(CAP)
    pts = world_vertices(handle.head)

    crown_id = int(np.argmax(pts[:, 2]))
    menton_id = closest_front_midline(pts, float(cap["menton_z"]))
    brow_id = int(np.asarray(cap["brow_id"]))
    crown = pts[crown_id]
    menton = pts[menton_id]
    brow = pts[brow_id]
    centre = np.asarray((0.0, float(menton[1]), float(menton[2])))
    ear_l = np.asarray(cap["pinna_front_L"], dtype=float)
    ear_r = np.asarray(cap["pinna_front_R"], dtype=float)
    shoulder = shoulder_landmark(handle)

    out = {
        "schemaVersion": 1,
        "resolution": SIZE,
        "scene_builder": "children_station.import_children3().load_hair_scene().build_scene()",
        "camera_setter": "children3.set_final_view",
        "anatomy": {
            "crown": {"vertex": crown_id, "world": crown.tolist(), "rule": "bare head max world-z vertex"},
            "menton": {"vertex": menton_id, "world": menton.tolist(), "requested_z": float(cap["menton_z"]), "rule": "anterior midline head vertex nearest z=1.4492"},
            "brow": {"vertex": brow_id, "world": brow.tolist(), "requested_z": float(cap["brow_z"])},
            "face_centre": {"world": centre.tolist(), "rule": "x=0 at menton y/z"},
            "ear_front_L": {"world": ear_l.tolist(), "source": "cap-v8.pinna_front_L"},
            "ear_front_R": {"world": ear_r.tolist(), "source": "cap-v8.pinna_front_R"},
            "back_shoulder": {"world": shoulder.tolist(), "rule": "judge back-registration shoulder plane z=1.405m"},
        },
        "judge_semantics": {
            "front": "skull mode: crown_top_row=projected bare-head crown; chin_row=projected menton; face_centre_col=projected x=0",
            "profile": "crown_top_row=projected bare-head crown; chin_row=projected menton; forehead_front_col=projected brow/anterior reference",
            "back": "crown_top_row=projected bare-head crown; shoulder_row=projected shoulder plane; hair_centre_col=projected x=0",
            "source_lines": "hair_judge.py:15-24,38-39,124-149,668-680,814-836,996-1018",
        },
        "views": {},
    }
    for view in VIEWS:
        c3.set_final_view(handle, view)
        bpy.context.view_layer.update()
        cam = scene.camera
        projected = {name: project(scene, cam, p) for name, p in (
            ("crown", crown), ("menton", menton), ("brow", brow),
            ("face_centre", centre), ("ear_front_L", ear_l),
            ("ear_front_R", ear_r), ("back_shoulder", shoulder))}
        out["views"][view] = {
            "camera_location": [float(x) for x in cam.location],
            "camera_lens_mm": float(cam.data.lens),
            "projected": projected,
        }

    def rnd(view, point, axis):
        return int(round(out["views"][view]["projected"][point][axis]))

    out["judge"] = {
        "front": {"crown_top_row": rnd("front", "crown", "row"), "chin_row": rnd("front", "menton", "row"), "face_centre_col": rnd("front", "face_centre", "col")},
        "profile": {"crown_top_row": rnd("profile_90", "crown", "row"), "chin_row": rnd("profile_90", "menton", "row"), "forehead_front_col": rnd("profile_90", "brow", "col")},
        "back": {"crown_top_row": rnd("back", "crown", "row"), "shoulder_row": rnd("back", "back_shoulder", "row"), "hair_centre_col": rnd("back", "face_centre", "col")},
    }
    (HERE / "landmarks.json").write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    print("LANDMARKS", json.dumps(out["judge"], sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
