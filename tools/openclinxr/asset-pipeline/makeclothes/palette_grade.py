#!/usr/bin/env python3
"""st-palette — lit EEVEE full-body grade of a shipped GLB (before/after).

Reuses tools/openclinxr/asset-pipeline/makeclothes/finished_figure_grade.py
(#226: scene clear, grade lighting, EEVEE choice, ground plane, render):
full body only, 1280x1280 native, no geometry authored.

Usage (Blender via the repo station/bake path only):
  blender --background --python palette_grade.py -- \\
    --glb apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb \\
    --out-dir /Volumes/files/openclinxr-assets/store/st-palette/ --tag before
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import finished_figure_grade as ffg  # noqa: E402  (proven #226 lighting/scene path)


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="st-palette full-body grade")
    p.add_argument("--glb", required=True, help="Shipped GLB")
    p.add_argument("--out-dir", required=True, help="Directory for PNG stills")
    p.add_argument("--tag", required=True, help="Filename tag, e.g. before/after")
    p.add_argument("--stem", required=True, help="Filename stem, e.g. nurse-adult")
    p.add_argument(
        "--focus",
        choices=("full", "hem"),
        default="full",
        help="full: whole figure (default). hem: frame the garment hem loop "
        "(waist height, closer camera) for hem-finish evidence.",
    )
    p.add_argument(
        "--bg",
        choices=("grade", "dark"),
        default="grade",
        help="grade: #226 grade lighting (default). dark: near-black world "
        "background for hem close-ups (lights unchanged).",
    )
    return p.parse_args(args)


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir)
    glb = Path(args.glb)

    ffg.clear_scene()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb.resolve()))
    imported = [o for o in bpy.data.objects if o not in before]
    for root in [o for o in imported if o.parent is None or o.parent not in imported]:
        root.location.x += 0.0
    bpy.context.view_layer.update()

    bounds = ffg.world_mesh_bounds()
    if bounds is None:
        raise SystemExit("no meshes after import")
    bmin, bmax = bounds
    center = (bmin + bmax) * 0.5
    height = max(0.01, bmax.z - bmin.z)
    width = max(0.01, bmax.x - bmin.x)

    cam_data = bpy.data.cameras.new(f"palette_grade_cam_{args.tag}")
    cam = bpy.data.objects.new(f"palette_grade_cam_{args.tag}", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    focus_z = center.z
    dist = max(2.4, width * 2.2, height * 1.35)
    cam.location = (center.x, -dist, focus_z)
    if args.focus == "hem":
        # Hem close-up: waist height (~0.6 of figure height), closer camera.
        # Measured hem heights on shipped bytes: fever 0.59, nurse 0.98, family
        # 0.96 — all within 0.55-0.60 of figure height from the ground plane.
        focus_z = bmin.z + height * 0.58
        hem_dist = max(0.55, width * 0.55)
        cam.location = (center.x, center.y - hem_dist, focus_z)
    # Aim the camera at the focus in both modes (st-palette fix 2026-11-03: the
    # --focus/--bg edit left this inside the hem branch, so full renders lost
    # their aim and framed empty ground).
    direction = Vector((center.x, center.y, focus_z)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = 40.0
    lighting = ffg.apply_grade_lighting(
        bpy.context.scene, center=center, key_z=focus_z + 0.6, focus_z=focus_z
    )
    print(f"[blender] grade lighting {lighting}")
    if args.bg == "dark":
        # AFTER apply_grade_lighting: it rebuilds the world Background node.
        world = bpy.context.scene.world
        if world is not None and world.use_nodes:
            bg = next(
                (n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None
            )
            if bg is not None:
                bg.inputs["Color"].default_value = (0.005, 0.005, 0.006, 1.0)
                bg.inputs["Strength"].default_value = 1.0
        print("[blender] st-palette grade: near-black background (lights unchanged)")
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

    out = out_dir / f"full-{args.stem}-{args.tag}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    engine = ffg.choose_grade_engine()
    try:
        scene.eevee.taa_render_samples = 24
    except Exception:
        pass
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 1280
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
    print(f"[blender] st-palette grade wrote {out} engine={scene.render.engine}")


if __name__ == "__main__":
    main()
