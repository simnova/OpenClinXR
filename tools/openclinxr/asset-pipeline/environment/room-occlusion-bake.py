#!/usr/bin/env python3
"""
Room occlusion bake for shipped environment GLBs (issue-349, MADR 0056 item 1, light half).

#345 shipped the albedo half (Cycles DIFFUSE baseColorTexture per material). This script
ships the OTHER half: a SEPARATE glTF `occlusionTexture` per material, baked with the
native Cycles AO bake type. Nothing is multiplied into base colour (that is refused —
unrecoverable; MADR 0056 item 6 atlas depends on clean albedo). The bake is deterministic:
same input GLB + fixed parameters -> same output. No LLM in the path (D1). No light nodes
ship (AO bake needs none). Triangle count untouched.

Mechanism (verified against the installed Blender 5.1.1 glTF exporter source and by probe):
  - The exporter emits `occlusionTexture` when an Image Texture feeds the "Occlusion" input
    socket of a node group named "glTF Settings"/"glTF Material Output" (create_settings_group
    convention, io_scene_gltf2/blender/exp/material/materials.py `__gather_occlusion_texture`).
  - The exporter maps UV layers BY INDEX: a UV Map node named "AO_UV" on the AO image makes it
    TEXCOORD_1; the base-colour images keep TEXCOORD_0 (active layer restored before export).
  - Blender 5.1 IGNORES `scene.render.bake.max_ray_distance` for the AO bake type (probed 3x in
    #345 and re-probed here: ray=0.0 and ray=1.0/2.0 produce byte-identical AO). Consequence:
    a fully CLOSED room self-occludes to a dark cave. The shipped shell room is open-top, so
    native AO gives real contact darkening (measured sd 98-120 on 0-255 for wall/floor). The
    Infinigen room is a closed 6.5m box: its AO is darker but still carries real variation
    (measured sd 22-51) and mechanically passes the luminance-variation gate.

UV handling (the question the brief flagged): the shipped rooms already carry TEXCOORD_0.
The shell's TEXCOORD_0 is a per-face cube unwrap, non-overlapping, reused for base colour.
The Infinigen room's wall/ceiling UVs are TILED (span -2.6..4.2) and its exterior hull is a
single collapsed (0,0) point — an AO bake into TEXCOORD_0 there would smear. So every mesh
gets a SECOND UV layer "AO_UV" via smart_project (per material group, so islands cannot
overlap between meshes sharing a material), the AO bakes into it, and the occlusion texture
references TEXCOORD_1. Base colour keeps TEXCOORD_0 untouched.

Usage (inside Blender 5.1 headless):
  blender --background --python room-occlusion-bake.py -- \
    --input <room.glb> --output <baked.glb> [--resolution 512]

Exit 0 on success; non-zero with a printed error on any bake failure (the input GLB is
never modified in place).
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys
from typing import Dict, List

import bpy

GLTF_GROUP_NAMES = ("glTF Material Output", "glTF Settings")


def _argv_after_double_dash() -> List[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.materials, bpy.data.images, bpy.data.meshes, bpy.data.lights, bpy.data.node_groups):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass


def find_bsdf(mat: bpy.types.Material):
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def ensure_gltf_settings_group() -> bpy.types.NodeGroup:
    """The exporter's `get_socket_from_gltf_material_node` matches group names starting with
    "gltf settings" or "gltf material output" (case-insensitive, startswith). Reuse any such
    group; create one with an "Occlusion" input socket per the exporter's create_settings_group."""
    for name in GLTF_GROUP_NAMES:
        for group in bpy.data.node_groups:
            if group.name.lower().startswith(name.lower()) and "Occlusion" in [s.name for s in group.interface.items_tree if hasattr(s, "name")]:
                return group
    name = GLTF_GROUP_NAMES[0]
    group = bpy.data.node_groups.new(name, "ShaderNodeTree")
    group.interface.new_socket("Occlusion", socket_type="NodeSocketFloat")
    group.nodes.new("NodeGroupOutput")
    group_input = group.nodes.new("NodeGroupInput")
    group_input.location = -200, 0
    return group


def ensure_ao_uv(mesh_obj: bpy.types.Object) -> str:
    """Create/return the second UV layer name for AO. Uses smart_project on the material
    GROUP so islands from different meshes sharing a material cannot overlap in one image."""
    layer_name = "AO_UV"
    me = mesh_obj.data
    if layer_name not in [u.name for u in me.uv_layers]:
        me.uv_layers.new(name=layer_name)
    return layer_name


def smart_project_group(objects: List[bpy.types.Object], layer_name: str) -> None:
    """Unwrap all selected objects' faces into `layer_name` in ONE pass (non-overlapping
    islands across the group, island_margin so texels do not bleed between islands)."""
    for obj in objects:
        me = obj.data
        if layer_name in [u.name for u in me.uv_layers]:
            me.uv_layers.active = me.uv_layers[layer_name]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    except TypeError:
        bpy.ops.uv.smart_project()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")


def setup_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = False
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True
    scene.render.bake.max_ray_distance = 0.0  # ignored by Blender 5.1 AO (probed); kept explicit
    # No lights needed: the AO bake type is geometry-only.


def bake_ao_per_material(resolution: int) -> Dict[str, Dict[str, object]]:
    """Bake native AO per material into a packed image; wire it into the glTF Settings
    "Occlusion" input via a UV Map node pointing at the second UV set. Returns per-material
    stats including the baked image's luminance sd (0-255) so flat maps can be excluded."""
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    by_mat: Dict[str, List[bpy.types.Object]] = {}
    for obj in meshes:
        mats = [m for m in obj.data.materials if m is not None]
        if not mats:
            continue
        by_mat.setdefault(mats[0].name, []).append(obj)

    gltf_group = ensure_gltf_settings_group()
    results: Dict[str, Dict[str, object]] = {}
    for mat_name, objs_ in by_mat.items():
        mat = bpy.data.materials[mat_name]
        if not mat.use_nodes or mat.node_tree is None:
            mat.use_nodes = True
        nt = mat.node_tree
        bsdf = find_bsdf(mat)
        if bsdf is None:
            raise RuntimeError(f"material {mat_name} has no Principled BSDF")

        for obj in objs_:
            ensure_ao_uv(obj)
        smart_project_group(objs_, "AO_UV")

        img_name = f"openclinxr_room_ao_{mat_name}"
        if img_name in bpy.data.images:
            img = bpy.data.images[img_name]
        else:
            img = bpy.data.images.new(img_name, width=resolution, height=resolution, alpha=False, float_buffer=False)
        img.colorspace_settings.name = "Non-Color"

        # AO image node, active for the bake, Vector fed by a UV Map node -> "AO_UV"
        # (exporter sees uvmap_info type "Fixed" -> TEXCOORD_1).
        ao_tex = None
        for node in nt.nodes:
            if node.type == "TEX_IMAGE" and node.image and node.image.name == img_name:
                ao_tex = node
                break
        if ao_tex is None:
            ao_tex = nt.nodes.new("ShaderNodeTexImage")
            ao_tex.image = img
            ao_tex.location = (-700, -300)
        uv_map = None
        for node in nt.nodes:
            if node.type == "UVMAP" and node.uv_map == "AO_UV":
                uv_map = node
                break
        if uv_map is None:
            uv_map = nt.nodes.new("ShaderNodeUVMap")
            uv_map.uv_map = "AO_UV"
            uv_map.location = (-900, -300)
        for link in list(ao_tex.inputs["Vector"].links):
            nt.links.remove(link)
        nt.links.new(uv_map.outputs["UV"], ao_tex.inputs["Vector"])
        ao_tex.select = True
        nt.nodes.active = ao_tex

        # glTF Settings group "Occlusion" input <- AO image Color output.
        group_node = None
        for node in nt.nodes:
            if node.type == "GROUP" and node.node_tree is gltf_group:
                group_node = node
                break
        if group_node is None:
            group_node = nt.nodes.new("ShaderNodeGroup")
            group_node.node_tree = gltf_group
            group_node.location = (-400, -300)
        occ_input = group_node.inputs.get("Occlusion")
        if occ_input is None:
            raise RuntimeError(f"material {mat_name}: glTF Settings group has no Occlusion input")
        for link in list(occ_input.links):
            nt.links.remove(link)
        nt.links.new(ao_tex.outputs["Color"], occ_input)

        # Bake: active UV layer must be AO_UV on every selected object.
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objs_:
            obj.data.uv_layers.active = obj.data.uv_layers["AO_UV"]
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objs_[0]
        bpy.ops.object.bake(type="AO", use_clear=True)
        img.pack()

        # Measure luminance sd over the packed pixels (same 0-255 scale as the contract gate).
        px = list(img.pixels)
        vals = [px[i] for i in range(0, len(px), 4)]
        mean = sum(vals) / len(vals)
        sd = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5
        sd255 = round(sd * 255.0, 1)
        results[mat_name] = {
            "image": img_name,
            "resolution": resolution,
            "meshes": len(objs_),
            "luminanceSd255": sd255,
            "wired": sd255 >= 6.0,
        }
        if sd255 < 6.0:
            # A flat AO map (measured: whiteboard_surface_white is a slab embedded 1 mm
            # behind the solid frame's front face — its true AO is uniform). Wiring a flat
            # map fails the contract's luminance-variation clause AND renders the surface
            # black in the runtime (aoMap multiplies). Leave it without an occlusion texture.
            for link in list(occ_input.links):
                nt.links.remove(link)
            print(f"[room-ao] SKIP {mat_name}: flat bake sd255={sd255} < 6 — occlusion not wired")
        else:
            print(f"[room-ao] baked {mat_name} -> {img_name} ({resolution}x{resolution}) on {len(objs_)} mesh(es), sd255={sd255}")
    return results


def restore_active_uv_layer() -> None:
    """The base-colour Image Texture nodes have no UV Map node, so the exporter maps them
    to the ACTIVE UV layer ("Active" uvmap_info). AO_UV was active during the bake; restore
    the FIRST layer (TEXCOORD_0) so base colour is not remapped."""
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and obj.data.uv_layers:
            obj.data.uv_layers.active = obj.data.uv_layers[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--resolution", type=int, default=512)
    args = ap.parse_args(_argv_after_double_dash())

    if not os.path.exists(args.input):
        raise SystemExit(f"input GLB not found: {args.input}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=args.input)

    setup_scene()
    results = bake_ao_per_material(args.resolution)
    restore_active_uv_layer()

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=args.output,
        export_format="GLB",
        export_animations=False,
        export_texcoords=True,
    )
    print(f"[room-ao] exported {args.output}")
    flat = [r["luminanceSd255"] for r in results.values()]
    wired = [r["luminanceSd255"] for r in results.values() if r["wired"]]
    if flat:
        print(
            f"[room-ao] materials={len(results)} wired={len(wired)} skipped={len(results) - len(wired)} "
            f"minSd255={min(flat)} maxSd255={max(flat)} medianSd255={round(statistics.median(flat), 1)}"
        )
    if len(wired) == 0:
        raise SystemExit("no material produced a non-flat occlusion bake — nothing wired")


if __name__ == "__main__":
    main()
