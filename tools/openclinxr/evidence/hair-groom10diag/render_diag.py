"""Blender/Cycles isolated A/B/C renders for the four defect boxes."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--evidence", required=True)
    p.add_argument("--raw", required=True)
    p.add_argument("--final", required=True)
    p.add_argument("--guides", required=True)
    p.add_argument("--body", required=True)
    p.add_argument("--cameras", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


STAGE_COLORS = {
    "baseline_lt5mm": (0.12, 0.32, 0.80, 1),
    "far_snap": (0.95, 0.95, 0.95, 1),
    "part_sweep": (0.10, 0.75, 0.95, 1),
    "persistent_offset": (0.10, 0.85, 0.55, 1),
    "depth_servo": (0.55, 0.90, 0.10, 1),
    "coarse_clump": (1.00, 0.70, 0.05, 1),
    "fine_clump": (1.00, 0.35, 0.05, 1),
    "length_jitter": (0.90, 0.10, 0.55, 1),
    "hairline_taper": (0.70, 0.15, 0.95, 1),
    "ear_keepout": (0.20, 1.00, 0.20, 1),
    "sdf_project_outside": (1.00, 0.05, 0.05, 1),
    "part_clamp_reproject": (0.55, 0.05, 0.05, 1),
}

DEFECTS = {
    "back-knot": ("back", [150, 420, 512, 765]),
    "behind-ear-loops": ("profile_90", [270, 550, 250, 530]),
    "sideburn-tuft": ("three_quarter", [330, 610, 380, 660]),
    "hairline-band": ("front", [98, 196, 291, 733]),
}


def mat(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.7
    bsdf.inputs["Metallic"].default_value = 0.0
    return m


def hair_obj(name, points, radii, material):
    points = np.asarray(points, dtype=np.float32)
    radii = np.asarray(radii, dtype=np.float32)
    if len(points) == 0:
        return None
    n, P, _ = points.shape
    data = bpy.data.hair_curves.new(name + "_data")
    data.add_curves([P] * n)
    data.attributes["position"].data.foreach_set("vector", points.ravel())
    if "radius" in data.attributes:
        data.attributes["radius"].data.foreach_set("value", radii.ravel())
    else:
        a = data.attributes.new("radius", "FLOAT", "POINT")
        a.data.foreach_set("value", radii.ravel())
    data.materials.append(material)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def remove_hair_objects():
    for obj in list(bpy.data.objects):
        if obj.type == "CURVES":
            bpy.data.objects.remove(obj, do_unlink=True)


def load_body(path):
    bpy.ops.import_scene.gltf(filepath=str(path))
    grey = mat("diagnostic_body_grey", (0.30, 0.32, 0.35, 1))
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        low = obj.name.lower()
        if "hair" in low and "brow" not in low and "lash" not in low:
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        obj.data.materials.clear()
        obj.data.materials.append(grey)


def setup_scene(cameras):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 1024
    sc.render.resolution_y = 1024
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.film_transparent = False
    sc.render.image_settings.color_depth = "8"
    world = sc.world or bpy.data.worlds.new("WORLD")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.015, 0.015, 0.02, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    for name, loc, energy, size in (
            ("KEY", (-1.5, -2.0, 2.2), 900.0, 2.0),
            ("FILL", (1.5, -2.0, 1.8), 500.0, 2.0),
            ("RIM", (0.0, 2.0, 2.6), 700.0, 1.5)):
        bpy.ops.object.light_add(type="AREA", location=loc)
        lamp = bpy.context.active_object
        lamp.name = name
        lamp.data.energy = energy
        lamp.data.shape = "DISK"
        lamp.data.size = size
    cd = bpy.data.cameras.new("scorer_v3_camera")
    cd.sensor_width = float(cameras["sensorWidthMm"])
    cam = bpy.data.objects.new("scorer_v3_camera", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def set_crop(box):
    r0, r1, c0, c1 = box
    sc = bpy.context.scene
    sc.render.use_border = True
    sc.render.use_crop_to_border = True
    sc.render.border_min_x = c0 / 1024.0
    sc.render.border_max_x = c1 / 1024.0
    sc.render.border_min_y = 1.0 - r1 / 1024.0
    sc.render.border_max_y = 1.0 - r0 / 1024.0


def main():
    a = cli()
    E = Path(a.evidence)
    out = E / "renders"
    out.mkdir(parents=True, exist_ok=True)
    raw = np.load(a.raw, allow_pickle=True)
    final = np.load(a.final, allow_pickle=True)
    sel = np.load(E / "defect-strands.npz", allow_pickle=True)
    stages = np.load(E / "stage-displacements.npz", allow_pickle=True)
    gd = np.load(a.guides, allow_pickle=True)
    cams = json.loads(Path(a.cameras).read_text())
    # Same head/world transform used by interp9.
    sys.path.insert(0, str(Path(a.evidence).parents[1] / "hair-groom/strands"))
    import frames as F
    guides_world = F.head_to_world(np.asarray(gd["curves_head"]),
                                   np.asarray(gd["crown"])).astype(np.float32)
    raw_points = np.asarray(raw["points"], dtype=np.float32)
    final_points = np.asarray(final["points"], dtype=np.float32)
    final_radii = np.asarray(final["radii"], dtype=np.float32)
    stage_names = [str(x) for x in stages["stage_names"]]
    stage_max = np.asarray(stages["max_mm"], dtype=np.float32)
    guide_idx = np.asarray(stages["final_guide_idx"], dtype=np.int32)
    guide_w = np.asarray(stages["final_guide_w"], dtype=np.float32)
    load_body(Path(a.body))
    camera = setup_scene(cams)
    materials = {k: mat("stage_" + k, v) for k, v in STAGE_COLORS.items()}
    guide_mat = mat("guides_only_cyan", (0.00, 0.95, 1.00, 1))
    raw_mat = mat("raw_interpolation_magenta", (1.00, 0.10, 0.75, 1))
    render_log = {"engine": "BLENDER_EEVEE", "cameraManifest": str(a.cameras),
                  "stageColors": {k: list(v) for k, v in STAGE_COLORS.items()},
                  "panels": {}}
    sc = bpy.context.scene
    for defect, (view, box) in DEFECTS.items():
        ids = np.asarray(sel["ids_" + defect.replace("-", "_")], dtype=np.int64)
        rec = cams["views"][view]
        camera.matrix_world = Matrix(rec["matrixWorld"])
        camera.data.lens = float(rec["lensMm"])
        set_crop(box)
        recout = {"view": view, "boxRowCol": box, "nChildren": int(len(ids))}

        # A: only guides used by visible selected children, rendered as tubes.
        used = np.unique(guide_idx[ids][guide_w[ids] > 0])
        gr = np.full((len(used), guides_world.shape[1]), 0.00040, dtype=np.float32)
        hair_obj("A_guides", guides_world[used], gr, guide_mat)
        sc.render.filepath = str(out / (defect + "-a.png"))
        bpy.ops.render.render(write_still=True)
        remove_hair_objects()

        # B: raw interpolation, before snap/projection/shove/clump.
        rr = np.maximum(final_radii[ids], 0.000045) * 1.35
        hair_obj("B_raw", raw_points[ids], rr, raw_mat)
        sc.render.filepath = str(out / (defect + "-b.png"))
        bpy.ops.render.render(write_still=True)
        remove_hair_objects()

        # C: final geometry. >5 mm rows take the colour of their largest
        # stage displacement; all others are the blue baseline.
        sm = stage_max[ids]
        dom = np.argmax(sm, axis=1)
        hot = sm[np.arange(len(ids)), dom] > 5.0
        labels = np.full(len(ids), -1, dtype=np.int16)
        labels[hot] = dom[hot]
        groups = {"baseline_lt5mm": int((labels < 0).sum())}
        base = ids[labels < 0]
        hair_obj("C_baseline", final_points[base], final_radii[base] * 1.35,
                 materials["baseline_lt5mm"])
        for j, name in enumerate(stage_names):
            rows = ids[labels == j]
            if not len(rows):
                continue
            groups[name] = int(len(rows))
            hair_obj("C_" + name, final_points[rows], final_radii[rows] * 1.35,
                     materials[name])
        sc.render.filepath = str(out / (defect + "-c.png"))
        bpy.ops.render.render(write_still=True)
        remove_hair_objects()
        recout["guideCount"] = int(len(used))
        recout["finalColorGroups"] = groups
        render_log["panels"][defect] = recout
        print("DIAG_RENDER", defect, recout, flush=True)
    (E / "render-manifest.json").write_text(json.dumps(render_log, indent=2) + "\n")


if __name__ == "__main__":
    main()
