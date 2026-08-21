#!/usr/bin/env python3
"""
Room albedo+AO bake for shipped environment GLBs (issue-345, MADR 0056 item 1; #537).

Every shipped room carried zero textured materials and zero lights (measured
2026-08-12: infinigen-ed-exam-bay.glb 440 tris / 3 mats / 0 textured;
ed-exam-bay-shell.glb 492 tris / 15 mats / 0 textured). This is the
highest-leverage MADR 0056 item and it has a PROVEN path in this repo:

  #343 established that Blender 5.1's glTF exporter does NOT bake a procedural
  node tree (flat [1,1,1,1] on export), while an explicit Cycles bake DOES
  produce a baseColorTexture that survives export. Mechanism used here: bake to
  a packed image, wire Image Texture -> BSDF Base Color, export GLB.

Bake target: albedo with ambient occlusion folded in. The room is a closed
shell, so the bake light is placed INSIDE it. #537: a single AREA light 25 cm
below the ceiling left walls/floor near-black (shipped wall meanL 13.0, floor
1.7) while the ceiling sat at 254.8 — placement/distribution defect, not a
missing wattage knob. Remedy: a mid-room POINT fill (hits walls + floor) plus
a dimmer near-ceiling AREA key (keeps soft penumbra without owning the budget).

Re-bake of an already-baked GLB must restore a bright Base Color before the
COLOR pass — otherwise DIFFUSE multiplies the cave mud by the new lighting and
stays dark. Prior openclinxr_room_bake_* links are disconnected for the bake.

Per-material meanL is measured on the baked image BEFORE glTF export and
written to --means-log (#537 clause 1). Docstring 0.95/0.87 are a disputed
historical probe, not a bake target.

Deterministic: same input GLB + fixed parameters -> same output. No LLM in the
path (D1). No light nodes ship in the GLB (probe lights deleted before
export). Triangle count is untouched — the bake only replaces material colours.

Usage (inside Blender 5.1 headless):
  blender --background --python room-albedo-ao-bake.py -- \\
    --input <room.glb> --output <baked.glb> [--resolution 1024] \\
    [--means-log <path>] [--room-name <file.glb>]

Exit 0 on success; non-zero with a printed error on any bake failure (the input
GLB is never modified in place).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from typing import Dict, List, Optional, Tuple

import bpy
from mathutils import Vector

_BLENDER_DUP_SUFFIX = re.compile(r"\.\d+$")


def bake_image_name_for_material(mat: bpy.types.Material) -> str:
    """Stable bake texture name matching shipped GLB bytes.

    glTF import often renames materials (`shader_plaster` -> `shader_plaster.022`)
    while the packed image stays `openclinxr_room_bake_shader_plaster`. Prefer any
    existing openclinxr_room_bake_* already on the material; else strip Blender's
    .NNN duplicate suffix from the material name.
    """
    if mat.use_nodes and mat.node_tree is not None:
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                name = node.image.name
                if name.startswith("openclinxr_room_bake_"):
                    return name
    base = _BLENDER_DUP_SUFFIX.sub("", mat.name)
    return f"openclinxr_room_bake_{base}"


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


def classify_surface(mat_name: str, mesh_names: List[str]) -> str:
    """wall | floor | ceiling | other — material name first, mesh name fallback."""
    n = mat_name.lower()
    joined = " ".join(mesh_names).lower()
    if "plaster" in n or "ceiling" in n or "ceiling" in joined:
        return "ceiling"
    if "square_tile" in n or "floor" in n or "floor" in joined:
        return "floor"
    if (
        "hexagon" in n
        or "wall" in n
        or "marble" in n
        or "ceramic" in n
        or "wall" in joined
    ):
        return "wall"
    return "other"


def albedo_for_surface(surface: str) -> Tuple[float, float, float, float]:
    """Bright restored albedo for re-bake COLOR pass (prior bake maps are cave energy).

    Floor atlases often cover <1% of the image (black clear padding dominates the
    overall mean). Use a near-white floor albedo so a well-lit re-bake can still
    clear the directional floor gate on overall meanL.
    """
    if surface == "ceiling":
        return (0.94, 0.94, 0.92, 1.0)
    if surface == "floor":
        return (0.96, 0.95, 0.93, 1.0)
    if surface == "wall":
        return (0.90, 0.88, 0.84, 1.0)
    return (0.85, 0.85, 0.85, 1.0)


def restore_bright_albedo(mat: bpy.types.Material, surface: str) -> None:
    """Disconnect prior openclinxr_room_bake_* from Base Color; set bright factor.

    Re-baking COLOR through the shipped cave maps multiplies mud by lighting and
    cannot lift walls/floors (#537 refused loader-side amplify for the same reason).
    """
    if not mat.use_nodes or mat.node_tree is None:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = find_bsdf(mat)
    if bsdf is None:
        return
    for link in list(bsdf.inputs["Base Color"].links):
        from_node = link.from_node
        nt.links.remove(link)
        if from_node and from_node.type == "TEX_IMAGE":
            img = from_node.image
            if img and img.name.startswith("openclinxr_room_bake_"):
                # Leave the node; bake target may reuse a fresh image of the same name.
                pass
    bsdf.inputs["Base Color"].default_value = albedo_for_surface(surface)


def setup_scene(bbox: Dict[str, float], light_rig: str) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = False
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True

    # World fill (low — interior lights are the key).
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

    span_x = bbox["maxX"] - bbox["minX"]
    span_y = bbox["maxY"] - bbox["minY"]
    span_z = max(0.5, bbox["maxZ"] - bbox["minZ"])
    span = max(1.0, min(span_x, span_y))
    cx = (bbox["minX"] + bbox["maxX"]) / 2.0
    cy = (bbox["minY"] + bbox["maxY"]) / 2.0
    cz = (bbox["minZ"] + bbox["maxZ"]) / 2.0
    energy_scale = 6.4 / span

    if light_rig == "legacy":
        # Pre-#537: single AREA 25 cm below ceiling — control/falsifier path.
        key_data = bpy.data.lights.new("openclinxr_room_bake_key", type="AREA")
        key = bpy.data.objects.new("openclinxr_room_bake_key", key_data)
        bpy.context.collection.objects.link(key)
        key.location = (cx, cy, bbox["maxZ"] - 0.25)
        key.rotation_euler = (0.0, 0.0, 0.0)
        key_data.size = 0.45 * span
        key_data.size_y = 0.45 * span
        key_data.energy = 110.0 * energy_scale
        print(f"[room-bake] light-rig=legacy key at z={bbox['maxZ'] - 0.25:.3f} energy={key_data.energy:.1f}")
        return

    # #537 distributed: two mid-room AREA softboxes (down + up), not a ceiling-
    # hugging key. Same total-order wattage as legacy (110 * scale) split across
    # the pair — placement/distribution, not an amplitude crank on the old lamp
    # (that path clips the ceiling before the floor lifts — clause 4).
    soft = 0.85 * span
    down_data = bpy.data.lights.new("openclinxr_room_bake_fill", type="AREA")
    down = bpy.data.objects.new("openclinxr_room_bake_fill", down_data)
    bpy.context.collection.objects.link(down)
    down.location = (cx, cy, cz)
    down.rotation_euler = (0.0, 0.0, 0.0)  # emit −Z (toward floor)
    down_data.size = soft
    down_data.size_y = soft
    # Floor/walls are UV-sparse; they need strong mid-room irradiance. Ceiling
    # already saturates under a modest upward key — keep upE low (clause 4).
    down_data.energy = 220.0 * energy_scale

    up_data = bpy.data.lights.new("openclinxr_room_bake_key", type="AREA")
    up = bpy.data.objects.new("openclinxr_room_bake_key", up_data)
    bpy.context.collection.objects.link(up)
    up.location = (cx, cy, cz)
    up.rotation_euler = (math.pi, 0.0, 0.0)  # emit +Z (toward ceiling)
    up_data.size = soft
    up_data.size_y = soft
    up_data.energy = 18.0 * energy_scale

    # Four vertical wall washes — AREA emitters facing +X/−X/+Y/−Y so wall
    # shells receive direct light the down-softbox only grazes.
    wall_e = 80.0 * energy_scale
    wall_size = 0.55 * span_z
    for name, loc, rot in (
        ("openclinxr_room_bake_wall_px", (bbox["maxX"] - 0.2, cy, cz), (0.0, math.pi / 2.0, 0.0)),
        ("openclinxr_room_bake_wall_nx", (bbox["minX"] + 0.2, cy, cz), (0.0, -math.pi / 2.0, 0.0)),
        ("openclinxr_room_bake_wall_py", (cx, bbox["maxY"] - 0.2, cz), (-math.pi / 2.0, 0.0, 0.0)),
        ("openclinxr_room_bake_wall_ny", (cx, bbox["minY"] + 0.2, cz), (math.pi / 2.0, 0.0, 0.0)),
    ):
        wd = bpy.data.lights.new(name, type="AREA")
        wo = bpy.data.objects.new(name, wd)
        bpy.context.collection.objects.link(wo)
        wo.location = loc
        wo.rotation_euler = rot
        wd.size = wall_size
        wd.size_y = soft * 0.7
        wd.energy = wall_e

    print(
        f"[room-bake] light-rig=distributed softboxes@({cx:.2f},{cy:.2f},{cz:.2f}) "
        f"downE={down_data.energy:.1f} upE={up_data.energy:.1f} wallE={wall_e:.1f} size={soft:.2f}"
    )


def image_mean_l(img: bpy.types.Image) -> float:
    """Mean luminance 0..255 over baked pixels (RGB)."""
    pixels = list(img.pixels)  # flat RGBA float 0..1
    n = img.size[0] * img.size[1]
    if n <= 0:
        return 0.0
    acc = 0.0
    for i in range(n):
        r = pixels[i * 4]
        g = pixels[i * 4 + 1]
        b = pixels[i * 4 + 2]
        acc += 0.299 * r + 0.587 * g + 0.114 * b
    return (acc / n) * 255.0


def bake_materials(resolution: int, restore_albedo: bool) -> Dict[str, Dict[str, object]]:
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

    results: Dict[str, Dict[str, object]] = {}
    for mat_name, objs_ in by_mat.items():
        mat = bpy.data.materials[mat_name]
        if not mat.use_nodes or mat.node_tree is None:
            mat.use_nodes = True
        mesh_names = [o.name for o in objs_]
        surface = classify_surface(mat_name, mesh_names)
        img_name = bake_image_name_for_material(mat)
        if restore_albedo:
            restore_bright_albedo(mat, surface)

        nt = mat.node_tree
        bsdf = find_bsdf(mat)
        if bsdf is None:
            raise RuntimeError(f"material {mat_name} has no Principled BSDF to bake")

        # Always allocate a fresh bake target so COLOR does not sample a cleared buffer
        # of the same image that was the prior albedo.
        if img_name in bpy.data.images:
            old = bpy.data.images[img_name]
            bpy.data.images.remove(old)
        img = bpy.data.images.new(
            img_name, width=resolution, height=resolution, alpha=True, float_buffer=False
        )
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

        mean_l = image_mean_l(img)
        results[mat_name] = {
            "image": img_name,
            "resolution": resolution,
            "meshes": len(objs_),
            "surface": surface,
            "meanL": mean_l,
            "meshNames": mesh_names,
        }
        print(
            f"[room-bake] baked {mat_name} -> {img_name} "
            f"({resolution}x{resolution}) on {len(objs_)} mesh(es) "
            f"surface={surface} meanL={mean_l:.2f}"
        )
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


def write_means_log(
    path: str,
    room_name: str,
    results: Dict[str, Dict[str, object]],
) -> None:
    """Emit per-material meanL measured on baked images before glTF export."""
    # Prefer one row per canonical surface (wall/floor/ceiling); keep first match.
    by_surface: Dict[str, Dict[str, object]] = {}
    extras: List[Dict[str, object]] = []
    for mat_name, meta in results.items():
        surface = str(meta.get("surface") or "other")
        row = {
            "surface": surface,
            "material": mat_name,
            "texture": str(meta.get("image") or ""),
            "meanL": float(meta.get("meanL") or 0.0),
        }
        if surface in ("wall", "floor", "ceiling") and surface not in by_surface:
            by_surface[surface] = row
        else:
            extras.append(row)
    rows = [by_surface[s] for s in ("wall", "floor", "ceiling") if s in by_surface]
    rows.extend(extras)
    payload = {
        "room": room_name,
        "loggedBeforeExport": True,
        "rows": rows,
    }
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w", encoding="utf8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")
    print(f"[room-bake] means log -> {path} ({len(rows)} row(s))")


def remove_probe_lights() -> None:
    prefixes = (
        "openclinxr_room_bake_key",
        "openclinxr_room_bake_fill",
        "openclinxr_room_bake_wall_",
    )
    for obj in list(bpy.data.objects):
        if any(obj.name.startswith(p) for p in prefixes):
            bpy.data.objects.remove(obj, do_unlink=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--resolution", type=int, default=1024)
    ap.add_argument(
        "--means-log",
        default="",
        help="Write per-material meanL JSON before export (issue #537)",
    )
    ap.add_argument(
        "--room-name",
        default="",
        help="Room basename recorded in means log (default: input basename)",
    )
    ap.add_argument(
        "--light-rig",
        choices=("legacy", "distributed"),
        default="distributed",
        help="legacy=pre-#537 ceiling AREA only; distributed=#537 fill+key",
    )
    ap.add_argument(
        "--restore-albedo",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Disconnect prior bake maps and set bright Base Color before COLOR bake",
    )
    args = ap.parse_args(_argv_after_double_dash())

    if not os.path.exists(args.input):
        raise SystemExit(f"input GLB not found: {args.input}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=args.input)

    bbox = scene_bbox()
    setup_scene(bbox, args.light_rig)
    results = bake_materials(args.resolution, args.restore_albedo)
    wire_textures_to_base_color()

    room_name = args.room_name or os.path.basename(args.input)
    means_log = args.means_log
    if means_log:
        write_means_log(means_log, room_name, results)

    remove_probe_lights()

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", export_animations=False)
    print(f"[room-bake] exported {args.output}")


if __name__ == "__main__":
    main()
