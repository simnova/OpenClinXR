#!/usr/bin/env python3
"""G-probe: Blender side of the aisha-parity geometry check.

Imports the shipped GLB with stock defaults, parks armatures at REST,
prints per-mesh shape-key values, and renders a world-space-normal pass
(RGB = N*0.5+0.5, transparent film, PNG16) at the P1a cameras.

Usage:
  blender --background --python geometry_probe_blender.py -- \
    --glb <aisha.glb> --cameras <p1a cameras.json> \
    --cams body_front,head_front --out <E/p2b/iterG/blender>
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def log(msg):
    print("[GPROBE] %s" % msg, flush=True)


def cli():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", default=os.environ.get("GPROBE_GLB", ""))
    ap.add_argument("--cameras", default=os.environ.get("GPROBE_CAMERAS", ""))
    ap.add_argument("--cams", default=os.environ.get("GPROBE_CAMS", ""))
    ap.add_argument("--out", default=os.environ.get("GPROBE_OUT", ""))
    ap.add_argument("--pose", default=os.environ.get("GPROBE_POSE", "rest"),
                    choices=("rest", "pose"))
    ns, _unknown = ap.parse_known_args(sys.argv[1:])
    for key in ("glb", "cameras", "cams", "out"):
        if not getattr(ns, key):
            raise SystemExit("REFUSE: missing --%s (argv=%r)" % (key, sys.argv))
    return ns


def main():
    t_all = time.time()
    args = cli()
    glb = Path(args.glb)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cam_names = [c.strip() for c in args.cams.split(",") if c.strip()]

    cameras_doc = json.loads(Path(args.cameras).read_text())
    recs = {c["name"]: c for c in cameras_doc["cameras"]}
    for name in cam_names:
        if name not in recs:
            raise SystemExit("REFUSE: cam %r not in cameras.json" % name)

    sc = bpy.context.scene
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    log("SCENE_CLEARED")

    bpy.ops.import_scene.gltf(filepath=str(glb))
    log("IMPORTED_OBJECTS %d" % len(bpy.context.selected_objects))

    # mirror blender_reference.py: drop actions, REST pose
    action_names = sorted(a.name for a in bpy.data.actions)
    for o in bpy.data.objects:
        if o.animation_data is not None:
            o.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    for arm in armatures:
        if args.pose == "rest":
            arm.data.pose_position = "REST"
        else:
            arm.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    log("ANIM actions_removed=%s armatures_rest=%s pose_mode=%s"
        % (action_names, sorted(a.name for a in armatures), args.pose))

    # pose-vs-rest readback for chest bones (decides whether REST forcing
    # flattens scaled/posed joints): recorded BEFORE any REST switch above
    # takes effect on the matrices we print? No: read both explicitly.
    pose_check = {"mode": args.pose, "bones": {}}
    for arm in armatures:
        for pb in arm.pose.bones:
            if any(k in pb.name.lower() for k in ("breast", "spine03", "spine04", "spine05", "spine02")):
                rb = arm.data.bones[pb.name]
                pose_check["bones"][pb.name] = {
                    "pose_loc": list(pb.location),
                    "pose_rot_quat": list(pb.rotation_quaternion),
                    "pose_scale": list(pb.scale),
                    "rest_head": list(rb.head_local),
                    "rest_tail": list(rb.tail_local),
                    "rest_matrix": [list(r) for r in rb.matrix_local],
                    "pose_matrix": [list(r) for r in pb.matrix],
                    "rest_equals_pose": all(
                        abs(a - b) < 1e-6
                        for ra, rb_ in zip(rb.matrix_local, pb.matrix)
                        for a, b in zip(ra, rb_)),
                }
    (out / "pose_check.json").write_text(json.dumps(pose_check, indent=2))
    log("WROTE pose_check.json bones=%d" % len(pose_check["bones"]))

    # shape-key values per mesh (the morph-equivalence readback)
    shape_state = {}
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        sk = getattr(o.data, "shape_keys", None)
        if sk is None or sk.key_blocks is None:
            shape_state[o.name] = None
        else:
            shape_state[o.name] = {kb.name: float(kb.value) for kb in sk.key_blocks}
    n_nonzero = sum(1 for v in shape_state.values() if v for w in v.values() if w != 0.0)
    log("SHAPE_KEYS meshes=%d nonzero_values=%d" % (len(shape_state), n_nonzero))
    (out / "shape_keys.json").write_text(json.dumps(
        {"actions_removed": action_names,
         "armatures_rest": sorted(a.name for a in armatures),
         "shape_keys": shape_state}, indent=2))
    log("WROTE shape_keys.json")

    # world-normal emission override: RGB = worldN*0.5+0.5
    mat = bpy.data.materials.new("GPROBE_WORLD_NORMAL")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out_node = nodes.new("ShaderNodeOutputMaterial")
    emis = nodes.new("ShaderNodeEmission")
    geo = nodes.new("ShaderNodeNewGeometry")
    scale = nodes.new("ShaderNodeVectorMath")
    scale.operation = "MULTIPLY"
    scale.inputs[1].default_value = (0.5, 0.5, 0.5)
    add = nodes.new("ShaderNodeVectorMath")
    add.operation = "ADD"
    add.inputs[1].default_value = (0.5, 0.5, 0.5)
    links.new(geo.outputs["Normal"], scale.inputs[0])
    links.new(scale.outputs[0], add.inputs[0])
    links.new(add.outputs[0], emis.inputs["Color"])
    links.new(emis.outputs[0], out_node.inputs[0])
    sc.view_layers[0].material_override = mat
    log("NORMAL_OVERRIDE set")

    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 1
    # data pass: no view-transform, just linear -> sRGB encode on save
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "16"
    sc.render.image_settings.color_mode = "RGBA"

    timings = {}
    for name in cam_names:
        rec = recs[name]
        res = rec["resolution"]
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.resolution_percentage = 100
        import math
        vfov = float(rec["vfov_deg"])
        cd = bpy.data.cameras.new("GPROBE_%s" % name)
        cd.sensor_fit = "VERTICAL"
        cd.sensor_width = 36.0
        cd.sensor_height = 24.0
        cd.lens = (cd.sensor_height / 2.0) / math.tan(math.radians(vfov / 2.0))
        cd.clip_start = float(rec.get("near", 0.01))
        cd.clip_end = float(rec.get("far", 100.0))
        co = bpy.data.objects.new("GPROBE_%s" % name, cd)
        sc.collection.objects.link(co)
        co.matrix_world = Matrix(rec["blender"]["matrix_world"])
        sc.camera = co
        bpy.context.view_layer.update()
        png = str(out / ("%s.normal.png" % name))
        sc.render.filepath = png
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        timings[name] = round(time.time() - t0, 2)
        log("RENDERED %s %dx%d in %.1fs" % (name, res[0], res[1], timings[name]))

    sc.view_layers[0].material_override = None
    (out / "probe.json").write_text(json.dumps(
        {"glb": str(glb), "cams": cam_names, "seconds": timings,
         "total_s": round(time.time() - t_all, 1)}, indent=2))
    log("WROTE probe.json total=%.1fs" % (time.time() - t_all))


main()
