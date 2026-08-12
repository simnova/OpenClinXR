#!/usr/bin/env python3
"""
Room albedo+AO bake for shipped environment GLBs (issue-345, MADR 0055 item 1).

Every shipped room carried zero textured materials and zero lights (measured
2026-08-12: infinigen-ed-exam-bay.glb 440 tris / 3 mats / 0 textured;
ed-exam-bay-shell.glb 492 tris / 15 mats / 0 textured). This is the
highest-leverage MADR 0055 item and it has a PROVEN path in this repo:

  #343 established that Blender 5.1's glTF exporter does NOT bake a procedural
  node tree (flat [1,1,1,1] on export), while an explicit Cycles bake DOES
  produce a baseColorTexture that survives export. Mechanism used here: bake to
  a packed image, wire Image Texture -> BSDF Base Color, export GLB.

Bake target: albedo with ambient occlusion folded in. The room is a closed
shell, so the bake light is placed INSIDE it (a soft area light just below the
ceiling) — the room interior is otherwise unlit by the world (measured: a
world-only bake leaves the interior ~black because the shell is opaque). Contact
darkening at wall-floor junctions comes from the area light's soft penumbra.

Measured tuning (see .openclinxr/evidence/room-bake/probe/):
  - DIFFUSE DIRECT+INDIRECT, samples 32, white world 0.12, interior area light
    sized ~0.45 * min(span), energy 110 * (6.4 / min(span)):
    walls ~0.95 mean, floor ~0.87 mean, junction 1st-pct ~0.64-0.74.
  - bake_type=AO was rejected: without max_ray_distance support (Blender 5.1
    ignores it for AO here, probed 3x) a closed room fully self-occludes
    (walls 0.19 median, ceiling 0.22), which reads as a dark cave.
  - DIFFUSE with a world-only light leaves the interior black (closed shell).

Deterministic: same input GLB + fixed parameters -> same output. No LLM in the
path (D1). No light nodes ship in the GLB (the probe light is deleted before
export). Triangle count is untouched — the bake only replaces material colours.

Usage (inside Blender 5.1 headless):
  blender --background --python room-albedo-ao-bake.py -- \\
    --input <room.glb> --output <baked.glb> [--resolution 1024]

Exit 0 on success; non-zero with a printed error on any bake failure (the input
GLB is never modified in place).
"""
from __future__ import annotations

import argparse
import math
import os
import sys
from typing import Dict, List

import bpy
from mathutils import Vector


def _argv_after_double_dash() -> List[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.materials, bpy.data.images, bpy.data.meshes, bpy.data.lights):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass


def scene_bbox() -> Dict[str, float]:
    """World-space AABB over all mesh objects (Z-up room: floor z=minZ, ceiling z=maxZ)."""
    mins = [math.inf] * 3
    maxs = [-math.inf] * 3
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mx = obj.matrix_world
        for corner in obj.bound_box:
            w = mx @ Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], w[i])
                maxs[i] = max(maxs[i], w[i])
    return {
        "minX": mins[0], "minY": mins[1], "minZ": mins[2],
        "maxX": maxs[0], "maxY": maxs[1], "maxZ": maxs[2],
    }


def find_bsdf(mat: bpy.types.Material):
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def ensure_uv(mesh_obj: bpy.types.Object) -> None:
    if mesh_obj.data.uv_layers and len(mesh_obj.data.uv_layers) > 0:
        return
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    except TypeError:
        bpy.ops.uv.smart_project()
    bpy.ops.object.mode_set(mode="OBJECT")


def setup_scene(bbox: Dict[str, float]) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = False
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True

    # World fill (low — the interior light is the key).
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg is None:
        bg = world.node_tree.nodes.new("ShaderNodeBackground")
        world.node_tree.links.new(
            bg.outputs["Background"],
            world.node_tree.nodes["World Output"].inputs["Surface"],
        )
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = 0.12

    # Interior area light just below the ceiling, pointing down. Size and energy
    # scale with the room so a 6.4 m room and a 3.6 m bay expose similarly.
    span_x = bbox["maxX"] - bbox["minX"]
    span_y = bbox["maxY"] - bbox["minY"]
    span = max(1.0, min(span_x, span_y))
    light_data = bpy.data.lights.new("openclinxr_room_bake_key", type="AREA")
    light = bpy.data.objects.new("openclinxr_room_bake_key", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (
        (bbox["minX"] + bbox["maxX"]) / 2.0,
        (bbox["minY"] + bbox["maxY"]) / 2.0,
        bbox["maxZ"] - 0.25,
    )
    light.rotation_euler = (0.0, 0.0, 0.0)
    light.data.size = 0.45 * span
    light.data.size_y = 0.45 * span
    light.data.energy = 110.0 * (6.4 / span)


def bake_materials(resolution: int) -> Dict[str, Dict[str, object]]:
    """Bake DIFFUSE (direct+indirect+colour) per material to a packed image."""
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in objs:
        ensure_uv(o)

    by_mat: Dict[str, List[bpy.types.Object]] = {}
    for obj in objs:
        mats = [m for m in obj.data.materials if m is not None]
        if not mats:
            continue
        by_mat.setdefault(mats[0].name, []).append(obj)

    scene = bpy.context.scene
    results: Dict[str, Dict[str, object]] = {}
    for mat_name, objs_ in by_mat.items():
        mat = bpy.data.materials[mat_name]
        if not mat.use_nodes or mat.node_tree is None:
            mat.use_nodes = True
        nt = mat.node_tree
        bsdf = find_bsdf(mat)
        if bsdf is None:
            raise RuntimeError(f"material {mat_name} has no Principled BSDF to bake")

        img_name = f"openclinxr_room_bake_{mat_name}"
        if img_name in bpy.data.images:
            img = bpy.data.images[img_name]
        else:
            img = bpy.data.images.new(img_name, width=resolution, height=resolution, alpha=True, float_buffer=False)
        img.colorspace_settings.name = "sRGB"

        img_tex = None
        for node in nt.nodes:
            if node.type == "TEX_IMAGE" and node.image and node.image.name == img_name:
                img_tex = node
                break
        if img_tex is None:
            img_tex = nt.nodes.new("ShaderNodeTexImage")
            img_tex.image = img
        img_tex.select = True
        nt.nodes.active = img_tex

        bpy.ops.object.select_all(action="DESELECT")
        for obj in objs_:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objs_[0]

        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, use_clear=True)
        img.pack()

        results[mat_name] = {
            "image": img_name,
            "resolution": resolution,
            "meshes": len(objs_),
        }
        print(f"[room-bake] baked {mat_name} -> {img_name} ({resolution}x{resolution}) on {len(objs_)} mesh(es)")
    return results


def wire_textures_to_base_color() -> None:
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.node_tree is None:
            continue
        nt = mat.node_tree
        bsdf = find_bsdf(mat)
        if bsdf is None:
            continue
        img_tex = None
        for node in nt.nodes:
            if node.type == "TEX_IMAGE" and node.image and node.image.name.startswith("openclinxr_room_bake_"):
                img_tex = node
                break
        if img_tex is None:
            continue
        for link in list(bsdf.inputs["Base Color"].links):
            nt.links.remove(link)
        nt.links.new(img_tex.outputs["Color"], bsdf.inputs["Base Color"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--resolution", type=int, default=1024)
    args = ap.parse_args(_argv_after_double_dash())

    if not os.path.exists(args.input):
        raise SystemExit(f"input GLB not found: {args.input}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=args.input)

    bbox = scene_bbox()
    setup_scene(bbox)
    bake_materials(args.resolution)
    wire_textures_to_base_color()

    # Remove the probe light so no light node ships in the GLB.
    if "openclinxr_room_bake_key" in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects["openclinxr_room_bake_key"], do_unlink=True)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", export_animations=False)
    print(f"[room-bake] exported {args.output}")


if __name__ == "__main__":
    main()
