#!/usr/bin/env python3
"""st-waist — lit EEVEE waistband grade of the street adult male.

Reuses tools/openclinxr/asset-pipeline/makeclothes/finished_figure_grade.py
(#226: scene clear, grade lighting, EEVEE choice, ground plane, render) and
adds what #226 lacks: a waist frame plus a garment-hide flag for the
inspection render (shirt hidden so the mask rim / restored skin band can be
judged), and a normal full-body render (nothing hidden: no skin may show
between shirt and jeans).

Usage (Blender via the repo station/bake path only):
  blender --background --python waistband_grade.py -- \\
    --glb apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb \\
    --out-dir <evidence stills dir> --tag before
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import finished_figure_grade as ffg  # noqa: E402  (proven #226 lighting/scene path)


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="st-waist waistband grade")
    p.add_argument("--glb", required=True, help="Shipped street-male GLB")
    p.add_argument("--out-dir", required=True, help="Directory for PNG stills")
    p.add_argument("--tag", required=True, help="Filename tag, e.g. before/after")
    p.add_argument(
        "--hide-substring",
        default="toigo_t_shirt",
        help="Case-insensitive object-name substring to hide for the inspection render",
    )
    return p.parse_args(args)


def import_single(glb: Path) -> None:
    ffg.clear_scene()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb.resolve()))
    imported = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in imported if o.parent is None or o.parent not in imported]
    for root in roots:
        root.location.x += 0.0
    bpy.context.view_layer.update()


def frame_camera(focus_z: float, dist: float, lens: float, tag: str) -> None:
    bounds = ffg.world_mesh_bounds()
    if bounds is None:
        raise SystemExit("no meshes after import")
    bmin, bmax = bounds
    center = (bmin + bmax) * 0.5
    cam_data = bpy.data.cameras.new(f"waist_grade_cam_{tag}")
    cam = bpy.data.objects.new(f"waist_grade_cam_{tag}", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = (center.x, -dist, focus_z)
    direction = Vector((center.x, center.y, focus_z)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = lens
    lighting = ffg.apply_grade_lighting(
        bpy.context.scene, center=center, key_z=focus_z + 0.6, focus_z=focus_z
    )
    print(f"[blender] grade lighting {lighting}")
    width = max(0.01, bmax.x - bmin.x)
    bpy.ops.mesh.primitive_plane_add(
        size=max(4.0, width * 3), location=(center.x, center.y, bmin.z - 0.001)
    )
    ground = bpy.context.active_object
    mat = bpy.data.materials.new("ground")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.18, 0.22, 0.2, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.9
    ground.data.materials.append(mat)


def render_out(out: Path, width_px: int, height_px: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    engine = ffg.choose_grade_engine()
    try:
        scene.eevee.taa_render_samples = 24
    except Exception:
        pass
    scene.render.resolution_x = width_px
    scene.render.resolution_y = height_px
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
    print(f"[blender] st-waist grade wrote {out} engine={scene.render.engine}")


def set_hidden(substring: str, hide: bool) -> List[str]:
    touched: List[str] = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if substring.lower() in (obj.name or "").lower():
            obj.hide_render = hide
            obj.hide_viewport = hide
            touched.append(obj.name)
    return touched


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir)
    glb = Path(args.glb)

    # Shot 1: waist close-up, shirt hidden (inspection render).
    import_single(glb)
    hidden = set_hidden(str(args.hide_substring), True)
    print(f"[blender] inspection hide {args.hide_substring}: {hidden}")
    frame_camera(focus_z=1.055, dist=0.85, lens=55.0, tag=f"{args.tag}-waist")
    render_out(out_dir / f"waist-inspection-{args.tag}.png", 1280, 720)

    # Shot 2: waist close-up, normal (nothing hidden): no skin may show.
    set_hidden(str(args.hide_substring), False)
    frame_camera(focus_z=1.055, dist=0.85, lens=55.0, tag=f"{args.tag}-waist-normal")
    render_out(out_dir / f"waist-normal-{args.tag}.png", 1280, 720)

    # Shot 3: full body, normal.
    import_single(glb)
    bounds = ffg.world_mesh_bounds()
    if bounds is None:
        raise SystemExit("no meshes after import")
    bmin, bmax = bounds
    center = (bmin + bmax) * 0.5
    height = max(0.01, bmax.z - bmin.z)
    width = max(0.01, bmax.x - bmin.x)
    frame_camera(
        focus_z=center.z,
        dist=max(2.4, width * 2.2, height * 1.35),
        lens=40.0,
        tag=f"{args.tag}-full",
    )
    render_out(out_dir / f"full-{args.tag}.png", 1280, 1280)


if __name__ == "__main__":
    main()
