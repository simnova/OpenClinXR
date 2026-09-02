"""Render a clean 4-view TRELLIS pack from a GLB (no HUD / labels).

Views (canonical pack names):
  front.png, side.png, three_quarter_left.png, three_quarter_right.png

Usage:
  blender --background --python tools/openclinxr/factory/equipment-lane/render-glb-multiview-pack.py -- \\
    --glb path/to/model.glb --out-dir path/to/pack --resolution 1024

claimScope: multi-view conditioning inputs for TRELLIS Metal bake.
notEvidenceFor: clinical accuracy, Quest readiness, TRELLIS quality.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def argv_map() -> dict[str, str]:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out: dict[str, str] = {}
    i = 0
    while i < len(raw):
        if raw[i].startswith("--") and i + 1 < len(raw):
            out[raw[i][2:]] = raw[i + 1]
            i += 2
        else:
            i += 1
    return out


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        if block.users == 0:
            bpy.data.images.remove(block)


def mesh_bounds() -> tuple[Vector, Vector]:
    mins = Vector((math.inf, math.inf, math.inf))
    maxs = Vector((-math.inf, -math.inf, -math.inf))
    n = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        mw = obj.matrix_world
        for v in obj.data.vertices:
            w = mw @ v.co
            for i in range(3):
                mins[i] = min(mins[i], w[i])
                maxs[i] = max(maxs[i], w[i])
            n += 1
    if n == 0:
        raise RuntimeError("no mesh")
    return mins, maxs


def setup_world_light() -> None:
    world = bpy.data.worlds.new("Studio")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    bg = nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.72, 0.74, 0.76, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    out = nodes.new("ShaderNodeOutputWorld")
    links.new(bg.outputs["Background"], out.inputs["Surface"])

    # Key + fill + rim area lights
    def area(name: str, loc: Vector, energy: float, size: float) -> None:
        light_data = bpy.data.lights.new(name=name, type="AREA")
        light_data.energy = energy
        light_data.size = size
        light_obj = bpy.data.objects.new(name, light_data)
        bpy.context.collection.objects.link(light_obj)
        light_obj.location = loc
        # aim at origin
        direction = Vector((0, 0, 0.5)) - loc
        light_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    area("Key", Vector((2.5, -2.8, 2.4)), 250, 2.0)
    area("Fill", Vector((-2.2, -1.5, 1.6)), 80, 2.5)
    area("Rim", Vector((0.2, 2.5, 2.0)), 60, 1.5)


def setup_camera(center: Vector, radius: float, elev_deg: float, azim_deg: float) -> bpy.types.Object:
    cam_data = bpy.data.cameras.new("PackCam")
    cam_data.lens = 50
    cam_data.clip_start = 0.01
    cam_data.clip_end = 100.0
    cam = bpy.data.objects.new("PackCam", cam_data)
    bpy.context.collection.objects.link(cam)
    elev = math.radians(elev_deg)
    azim = math.radians(azim_deg)
    # Blender: +Y forward-ish for product shots; orbit around center
    offset = Vector(
        (
            radius * math.cos(elev) * math.sin(azim),
            -radius * math.cos(elev) * math.cos(azim),
            radius * math.sin(elev),
        )
    )
    cam.location = center + offset
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def render_view(out_path: Path, resolution: int) -> None:
    scene = bpy.context.scene
    # Prefer EEVEE (Blender 5.1 enum is BLENDER_EEVEE; some builds expose EEVEE_NEXT).
    engines = {e.identifier for e in scene.render.bl_rna.properties["engine"].enum_items}
    if "BLENDER_EEVEE_NEXT" in engines:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    elif "BLENDER_EEVEE" in engines:
        scene.render.engine = "BLENDER_EEVEE"
    else:
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 32
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.render.filepath = str(out_path)
    bpy.ops.render.render(write_still=True)


def main() -> None:
    args = argv_map()
    glb = args.get("glb")
    out_dir = args.get("out-dir")
    resolution = int(args.get("resolution", "1024"))
    if not glb or not out_dir:
        raise SystemExit("need --glb and --out-dir")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=glb)
    bpy.context.view_layer.update()
    mins, maxs = mesh_bounds()
    size = maxs - mins
    center = (mins + maxs) * 0.5
    # Lift feet to z≈0 visual ground is optional; center on subject
    extent = max(size.x, size.y, size.z)
    radius = extent * 1.85
    freeze_in = args.get("freeze-in")
    freeze_out = args.get("freeze-out")
    if freeze_in:
        freeze = json.loads(Path(freeze_in).read_text(encoding="utf-8"))
        center = Vector((float(freeze["center"][0]), float(freeze["center"][1]), float(freeze["center"][2])))
        radius = float(freeze["radius"])
    if freeze_out:
        Path(freeze_out).write_text(
            json.dumps(
                {
                    "center": [center.x, center.y, center.z],
                    "radius": radius,
                    "elevDeg": 14.0,
                    "azimDeg": 40.0,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    setup_world_light()

    # Azimuth: 0 = front (looking toward −Y), +azim = right, −azim = left.
    # elev: + = above horizon, − = below (underside / bottom).
    only_view = args.get("only-view")
    preset = args.get("preset", "standard4")
    if preset == "six_cardinal_oblique":
        # Operator request: top, left, right, bottom, ¾ top+left+front, ¾ bottom+right+back.
        # Slight elev on L/R keeps horizon context; bottom is steep under-look.
        views = [
            ("top.png", 88.0, 0.0),
            ("left.png", 8.0, -90.0),
            ("right.png", 8.0, 90.0),
            ("bottom.png", -78.0, 180.0),
            ("three_quarter_top_left_front.png", 42.0, -38.0),
            ("three_quarter_bottom_right_back.png", -32.0, 145.0),
        ]
        radius = extent * 2.15  # extra room for extreme elev
    else:
        # Canonical TRELLIS pack (front / side / ¾L / ¾R)
        views = [
            ("front.png", 12.0, 0.0),
            ("side.png", 10.0, 90.0),
            ("three_quarter_left.png", 14.0, -40.0),
            ("three_quarter_right.png", 14.0, 40.0),
        ]
    if only_view:
        views = [v for v in views if v[0] == only_view]
        if not views:
            raise SystemExit(f"unknown --only-view {only_view}")
    written: list[dict] = []
    for name, elev, azim in views:
        # remove previous camera
        for obj in list(bpy.data.objects):
            if obj.type == "CAMERA":
                bpy.data.objects.remove(obj, do_unlink=True)
        setup_camera(center, radius, elev, azim)
        path = out / name
        render_view(path, resolution)
        written.append(
            {
                "view": name,
                "path": str(path),
                "bytes": path.stat().st_size,
                "elevDeg": elev,
                "azimDeg": azim,
            }
        )
        print(json.dumps({"rendered": name, "bytes": path.stat().st_size, "elev": elev, "azim": azim}))

    report = {
        "glb": glb,
        "outDir": str(out),
        "preset": preset,
        "resolution": resolution,
        "center": [center.x, center.y, center.z],
        "extentM": extent,
        "radiusM": radius,
        "views": written,
        "claimScope": "clean_multiview_pack_for_trellis_conditioning",
        "notEvidenceFor": ["clinical_accuracy", "quest_readiness", "trellis_quality"],
    }
    (out / "pack-manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"ok": True, "views": len(written), "outDir": str(out)}))


if __name__ == "__main__":
    main()
