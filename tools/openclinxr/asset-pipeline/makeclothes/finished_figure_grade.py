#!/usr/bin/env python3
"""#226 — lit EEVEE grade of finished library figures, framed on feet/footwear.

Imports 1–2 library GLBs side-by-side, frames the camera on the lower legs/feet so
footwear is visible. EEVEE preferred so Principled Base Color is visible (Workbench
ignores it — #215).

Usage:
  blender --background --python finished_figure_grade.py -- \\
    --out .openclinxr/evidence/issue-226/finished-figure-grade.png \\
    --glb path/to/lean.glb --glb path/to/heavy.glb
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional, Tuple

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="#226 finished-figure feet grade")
    p.add_argument("--out", required=True, help="Output PNG path")
    p.add_argument("--glb", action="append", default=[], help="Library GLB (repeatable)")
    return p.parse_args(args)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for b in list(block):
            block.remove(b)


def world_mesh_bounds() -> Optional[Tuple[Vector, Vector]]:
    mins = [1e9, 1e9, 1e9]
    maxs = [-1e9, -1e9, -1e9]
    any_mesh = False
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        any_mesh = True
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], w[i])
                maxs[i] = max(maxs[i], w[i])
    if not any_mesh:
        return None
    return Vector(mins), Vector(maxs)


def choose_grade_engine() -> str:
    scene = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "EEVEE"):
        try:
            scene.render.engine = eng
            if scene.render.engine == eng or eng in str(scene.render.engine):
                return str(scene.render.engine)
        except Exception:
            continue
    scene.render.engine = "BLENDER_WORKBENCH"
    return "BLENDER_WORKBENCH"


def main() -> None:
    args = parse_args()
    glbs: List[Path] = [Path(g).resolve() for g in args.glb]
    glbs = [g for g in glbs if g.is_file()]
    if not glbs:
        raise SystemExit("no --glb files found")

    clear_scene()
    # Import each GLB; offset subsequent figures on X so both are visible.
    for i, glb in enumerate(glbs):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(glb))
        imported = [o for o in bpy.data.objects if o not in before]
        # Parent roots: objects with no parent among imported
        roots = [o for o in imported if o.parent is None or o.parent not in imported]
        offset_x = (i - (len(glbs) - 1) / 2.0) * 1.1
        for root in roots:
            root.location.x += offset_x
            # Force update
            bpy.context.view_layer.update()

    bounds = world_mesh_bounds()
    if bounds is None:
        raise SystemExit("no meshes after import")
    bmin, bmax = bounds
    center = (bmin + bmax) * 0.5
    height = max(0.01, bmax.z - bmin.z)
    width = max(0.01, bmax.x - bmin.x)

    # Frame on lower legs / feet (bottom ~25% of figure height).
    # Use world bounds so footwear is in-frame without cropping to tips only.
    feet_z = bmin.z + height * 0.14
    cam_data = bpy.data.cameras.new("finish_grade_cam")
    cam = bpy.data.objects.new("finish_grade_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    dist = max(1.6, width * 1.8, height * 0.55)
    cam.location = (center.x, -dist, feet_z)
    direction = Vector((center.x, center.y, feet_z)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = 45.0

    light_data = bpy.data.lights.new(name="finish_key", type="AREA")
    light_data.energy = 180.0
    light = bpy.data.objects.new(name="finish_key", object_data=light_data)
    bpy.context.scene.collection.objects.link(light)
    light.location = (center.x + 1.0, -1.4, feet_z + 0.6)

    fill_data = bpy.data.lights.new(name="finish_fill", type="AREA")
    fill_data.energy = 70.0
    fill = bpy.data.objects.new(name="finish_fill", object_data=fill_data)
    bpy.context.scene.collection.objects.link(fill)
    fill.location = (center.x - 1.2, 0.5, feet_z + 0.3)

    # Ground plane under feet for readability
    bpy.ops.mesh.primitive_plane_add(size=max(4.0, width * 3), location=(center.x, center.y, bmin.z - 0.001))
    ground = bpy.context.active_object
    mat = bpy.data.materials.new("ground")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.18, 0.22, 0.2, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.9
    mat.diffuse_color = (0.18, 0.22, 0.2, 1.0)
    ground.data.materials.append(mat)

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    engine = choose_grade_engine()
    try:
        scene.eevee.taa_render_samples = 24
    except Exception:
        pass
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.filepath = str(out)
    scene.render.image_settings.file_format = "PNG"
    try:
        bpy.ops.render.render(write_still=True)
    except Exception:
        if engine != "BLENDER_WORKBENCH":
            scene.render.engine = "BLENDER_WORKBENCH"
            bpy.ops.render.render(write_still=True)
        else:
            raise
    print(f"[blender] #226 finished-figure grade wrote {out} engine={scene.render.engine}")


if __name__ == "__main__":
    main()
