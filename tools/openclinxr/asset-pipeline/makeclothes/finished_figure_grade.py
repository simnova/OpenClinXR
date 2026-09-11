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
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import bpy
from mathutils import Vector

GRADE_LIGHTING_PATH = Path(__file__).with_name("grade-lighting.json")


def load_grade_lighting() -> Dict[str, Any]:
    """SSOT for the public isolated-figure bake. World Background is the ambient term."""
    data = json.loads(GRADE_LIGHTING_PATH.read_text(encoding="utf-8"))
    strength = float(data["worldBackgroundStrength"])
    if strength <= 0:
        raise ValueError("grade-lighting.json worldBackgroundStrength must be > 0")
    return data


def apply_grade_lighting(
    scene: Any,
    *,
    center: Vector,
    key_z: float,
    focus_z: float,
) -> Dict[str, float]:
    """Key + fill AREA lights plus a world Background ambient term.

    Key-only AREA lights produced the 2026-09-10 public street still's two-tone
    (dark chest, pale thighs). Background strength must stay > 0.
    """
    cfg = load_grade_lighting()
    strength = float(cfg["worldBackgroundStrength"])
    color = cfg.get("worldBackgroundColor") or [0.82, 0.85, 0.9]
    r, g, b = (float(color[0]), float(color[1]), float(color[2]))

    world = scene.world
    if world is None:
        world = bpy.data.worlds.new("grade_world")
        scene.world = world
    world.use_nodes = True
    tree = world.node_tree
    bg = next((n for n in tree.nodes if n.type == "BACKGROUND"), None)
    if bg is None:
        bg = tree.nodes.new("ShaderNodeBackground")
        out = next((n for n in tree.nodes if n.type == "OUTPUT_WORLD"), None)
        if out is not None:
            tree.links.new(bg.outputs["Background"], out.inputs["Surface"])
    bg.inputs["Strength"].default_value = strength
    bg.inputs["Color"].default_value = (r, g, b, 1.0)

    key_energy = float(cfg["keyEnergy"])
    fill_energy = float(cfg["fillEnergy"])
    light_data = bpy.data.lights.new(name="finish_key", type="AREA")
    light_data.energy = key_energy
    light = bpy.data.objects.new(name="finish_key", object_data=light_data)
    scene.collection.objects.link(light)
    light.location = (center.x + 1.0, -1.4, key_z)

    fill_data = bpy.data.lights.new(name="finish_fill", type="AREA")
    fill_data.energy = fill_energy
    fill = bpy.data.objects.new(name="finish_fill", object_data=fill_data)
    scene.collection.objects.link(fill)
    fill.location = (center.x - 1.2, 0.5, focus_z + 0.3)

    return {
        "worldBackgroundStrength": strength,
        "keyEnergy": key_energy,
        "fillEnergy": fill_energy,
    }


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="#226 finished-figure feet grade")
    p.add_argument("--out", required=True, help="Output PNG path")
    p.add_argument("--glb", action="append", default=[], help="Library GLB (repeatable)")
    p.add_argument(
        "--frame",
        choices=("feet", "full"),
        default="feet",
        help="Camera frame: feet (default, #226 footwear) or full body (#220 lower hem)",
    )
    p.add_argument(
        "--dump-lighting",
        action="store_true",
        help="Print applied world/key/fill JSON and exit (no GLB, no PNG)",
    )
    p.add_argument(
        "--dump-bounds",
        action="store_true",
        help="Import --glb, print subject AABB JSON (Icosphere excluded), exit",
    )
    return p.parse_args(args)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for b in list(block):
            block.remove(b)


def _is_grade_subject_mesh(obj: Any) -> bool:
    """Skip unparented helper meshes (MPFB Icosphere z=-1) so the floor sits under soles."""
    if obj.type != "MESH":
        return False
    name = (obj.name or "").lower()
    if "icosphere" in name:
        return False
    keep = ("mpfb", "makeclothes", "openclinxr", "garment", "body")
    if any(tok in name for tok in keep):
        return True
    parent = obj.parent
    return parent is not None and parent.type == "ARMATURE"


def world_mesh_bounds() -> Optional[Tuple[Vector, Vector]]:
    mins = [1e9, 1e9, 1e9]
    maxs = [-1e9, -1e9, -1e9]
    any_mesh = False
    for obj in bpy.data.objects:
        if not _is_grade_subject_mesh(obj):
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
    if args.dump_lighting:
        scene = bpy.context.scene
        report = apply_grade_lighting(
            scene, center=Vector((0.0, 0.0, 1.0)), key_z=1.2, focus_z=0.9
        )
        world = scene.world
        bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
        live = float(bg.inputs["Strength"].default_value) if bg is not None else 0.0
        report["liveWorldBackgroundStrength"] = live
        print(json.dumps(report, indent=2))
        return

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
    print(
        json.dumps(
            {
                "bmin": [bmin.x, bmin.y, bmin.z],
                "bmax": [bmax.x, bmax.y, bmax.z],
                "floorZ": bmin.z - 0.001,
            }
        )
    )
    if args.dump_bounds:
        return
    center = (bmin + bmax) * 0.5
    height = max(0.01, bmax.z - bmin.z)
    width = max(0.01, bmax.x - bmin.x)

    # Frame on lower legs / feet (default) or full body (#220 hem + footwear).
    if args.frame == "full":
        focus_z = center.z
        dist = max(2.4, width * 2.2, height * 1.35)
        lens = 40.0
        key_z = center.z + height * 0.15
    else:
        focus_z = bmin.z + height * 0.14
        dist = max(1.6, width * 1.8, height * 0.55)
        lens = 45.0
        key_z = focus_z + 0.6
    cam_data = bpy.data.cameras.new("finish_grade_cam")
    cam = bpy.data.objects.new("finish_grade_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = (center.x, -dist, focus_z if args.frame == "full" else focus_z)
    direction = Vector((center.x, center.y, focus_z)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = lens

    lighting = apply_grade_lighting(
        bpy.context.scene, center=center, key_z=key_z, focus_z=focus_z
    )
    print(f"[blender] grade lighting {json.dumps(lighting)}")

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
    if args.frame == "full":
        scene.render.resolution_x = 1280
        scene.render.resolution_y = 1280
    else:
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
