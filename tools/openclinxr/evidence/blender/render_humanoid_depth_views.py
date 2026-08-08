"""Render multi-view depth maps and before stills of a humanoid GLB for ComfyUI texturing.

Headless Blender script — no modal operators, no viewport context required.
Outputs: {depth_front,depth_back,depth_left,depth_right}.png + before.png (beauty pass).

Usage:
  blender --background --python render_humanoid_depth_views.py -- \
    --glb <path> --output-dir <dir> [--resolution 1024]
"""

from __future__ import annotations

import argparse
import math
import pathlib
import sys
from typing import List, Tuple

import bpy
from mathutils import Vector, Matrix, Euler


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    argv = [arg for arg in argv if arg != "--"]
    parser = argparse.ArgumentParser(description="Render multi-view depth maps of a humanoid.")
    parser.add_argument("--glb", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--resolution", type=int, default=1024)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)
    for block in bpy.data.images:
        bpy.data.images.remove(block)


def import_glb(glb_path: str) -> bpy.types.Object:
    bpy.ops.import_scene.gltf(filepath=glb_path)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh objects found in {glb_path}")
    # Find the main body mesh (largest by vertex count)
    main = max(meshes, key=lambda o: len(o.data.vertices))
    return main


def get_mesh_aabb(obj: bpy.types.Object) -> Tuple[Vector, Vector]:
    """World-space AABB of the mesh."""
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def setup_depth_render(resolution: int) -> None:
    """Configure render settings for depth pass output via a material override.

    Blender 5.x no longer uses scene.use_nodes / scene.node_tree for compositing.
    Instead we render the Z pass by using a material override with a depth shader,
    or we save OpenEXR multi-layer with the Z channel for post-processing.

    Simpler approach: render with a flat shader override that outputs normalized
    depth using the Camera Data → Map Range → Emission node chain.
    """
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "16"

    # Enable Z depth pass
    view_layer = bpy.context.view_layer
    view_layer.use_pass_z = True

    # Create a depth-visualisation material override for EEVEE
    depth_mat = bpy.data.materials.new("__depth_viz__")
    depth_mat.use_nodes = True
    nodes = depth_mat.node_tree.nodes
    links = depth_mat.node_tree.links
    nodes.clear()

    # Camera Data (view distance) → Map Range → Emission → Output
    cam_data = nodes.new("ShaderNodeCameraData")
    cam_data.location = (-400, 0)

    map_range = nodes.new("ShaderNodeMapRange")
    map_range.location = (-200, 0)
    map_range.inputs["From Min"].default_value = 0.0
    map_range.inputs["From Max"].default_value = 5.0  # Will be adjusted per scene
    map_range.inputs["To Min"].default_value = 1.0  # White = near
    map_range.inputs["To Max"].default_value = 0.0  # Black = far
    map_range.clamp = True

    emission = nodes.new("ShaderNodeEmission")
    emission.location = (0, 0)

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (200, 0)

    links.new(cam_data.outputs["View Distance"], map_range.inputs["Value"])
    links.new(map_range.outputs["Result"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])

    # Apply to all mesh objects in scene
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            if obj.data.materials:
                obj.data.materials.clear()
            obj.data.materials.append(depth_mat)

    # Update map range max based on mesh extent
    scene.frame_set(0)
    bpy.context.view_layer.update()

    # Estimate max view distance from all mesh bounding boxes
    max_dist = 3.0
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            for corner in obj.bound_box:
                wc = obj.matrix_world @ Vector(corner)
                d = wc.length
                if d > max_dist:
                    max_dist = d
    map_range.inputs["From Max"].default_value = max_dist * 1.2


def setup_beauty_render(resolution: int) -> None:
    """Configure render settings for beauty (lit colour) pass."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "16"

    # Add lighting
    world = bpy.data.worlds.new("LightingWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.5
    scene.world = world

    # Key light
    bpy.ops.object.light_add(type="SUN", location=(5, -5, 8))
    sun = bpy.context.active_object
    sun.data.energy = 4.0
    sun.data.angle = 0.1


def position_camera(camera: bpy.types.Object, target: Vector, azimuth_deg: float,
                    elevation_deg: float, distance: float) -> None:
    """Position camera looking at target from given azimuth/elevation/distance."""
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    x = target.x + distance * math.cos(el) * math.sin(az)
    y = target.y + distance * math.cos(el) * math.cos(az)
    z = target.z + distance * math.sin(el)
    camera.location = Vector((x, y, z))

    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_camera() -> bpy.types.Object:
    """Create and return a perspective camera."""
    cam_data = bpy.data.cameras.new("DepthCam")
    cam_data.type = "PERSP"
    cam_data.lens = 50
    cam_obj = bpy.data.objects.new("DepthCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    return cam_obj


def main() -> None:
    args = parse_args()
    output_dir = pathlib.Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Views: front (0°), right (90°), back (180°), left (270°)
    views: List[Tuple[str, float, float]] = [
        ("front", 0, 5),
        ("right", 90, 5),
        ("back", 180, 5),
        ("left", 270, 5),
    ]

    # ---- Phase 1: Depth renders (with material override) ----
    clear_scene()
    camera_obj = setup_camera()
    main_obj = import_glb(args.glb)
    bbox_min, bbox_max = get_mesh_aabb(main_obj)
    center = (bbox_min + bbox_max) / 2
    extent = (bbox_max - bbox_min).length
    distance = extent * 1.8

    setup_depth_render(args.resolution)

    for name, azimuth, elevation in views:
        position_camera(camera_obj, center, azimuth, elevation, distance)
        depth_path = output_dir / f"depth_{name}.png"
        bpy.context.scene.render.filepath = str(depth_path)
        bpy.ops.render.render(write_still=True)
        print(f"DEPTH {name}: {depth_path}")

    # ---- Phase 2: Before beauty still (re-import clean GLB) ----
    # Clean up depth material + old camera so they don't leak
    depth_mat = bpy.data.materials.get("__depth_viz__")
    if depth_mat:
        bpy.data.materials.remove(depth_mat)

    clear_scene()
    camera_obj = setup_camera()
    main_obj = import_glb(args.glb)
    bbox_min2, bbox_max2 = get_mesh_aabb(main_obj)
    center2 = (bbox_min2 + bbox_max2) / 2
    extent2 = (bbox_max2 - bbox_min2).length
    distance2 = extent2 * 1.8

    setup_beauty_render(args.resolution)
    position_camera(camera_obj, center2, 0, 5, distance2)
    before_path = output_dir / "before.png"
    bpy.context.scene.render.filepath = str(before_path)
    bpy.ops.render.render(write_still=True)
    print(f"BEFORE: {before_path}")

    # Write a manifest
    manifest = {
        "schemaVersion": "openclinxr.humanoid-depth-views.v1",
        "glbPath": args.glb,
        "resolution": args.resolution,
        "views": [
            {"name": name, "azimuth": az, "elevation": el,
             "depthPath": str(output_dir / f"depth_{name}.png")}
            for name, az, el in views
        ],
        "beforeStill": str(before_path),
    }
    import json
    (output_dir / "depth_manifest.json").write_text(json.dumps(manifest, indent=2))
    print("DONE")


if __name__ == "__main__":
    main()
